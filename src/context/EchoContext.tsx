import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  apiRequest,
  enqueueOfflineMutation,
  getAuthToken,
  listOfflineMutations,
  removeOfflineMutation,
  setAuthToken,
} from '../lib/api';
import { signOutFirebase } from '../lib/firebase';
import { isStandaloneLocalMode } from '../lib/localStandaloneApi';
import {
  applyThemeToDocument,
  type EchoThemeId,
  getSavedThemeId,
  normalizeThemeId,
} from '../lib/themes';
import type { AuthUser, ModuleId, NotificationItem, PendingOfflineMutation } from '../types/echo';

interface EchoContextValue {
  user: AuthUser | null;
  authLoading: boolean;
  theme: EchoThemeId;
  setTheme: (nextTheme: EchoThemeId) => Promise<void>;
  activeModule: ModuleId;
  setActiveModule: (mod: ModuleId) => void;
  focusItemId: string | null;
  navigateTo: (mod: ModuleId, itemId?: string | null) => void;
  canGoBack: boolean;
  goBack: () => void;
  notifications: NotificationItem[];
  unreadCount: number;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  isOnline: boolean;
  pendingMutations: PendingOfflineMutation[];
  queueMutation: (mutation: Omit<PendingOfflineMutation, 'clientMutationId' | 'queuedAt'>) => Promise<void>;
  syncNow: () => Promise<number>;
  wsConnected: boolean;
  lastWsEvent: { type: string; [key: string]: unknown } | null;
  loginSuccess: (user: AuthUser, token: string) => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  quickCaptureTarget: string | null;
  setQuickCaptureTarget: (target: string | null) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

const EchoContext = createContext<EchoContextValue | null>(null);

export function EchoProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setThemeState] = useState<EchoThemeId>(() => getSavedThemeId());
  const [navState, setNavState] = useState<{ current: ModuleId; history: ModuleId[] }>({
    current: 'home',
    history: [],
  });
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const activeModule = navState.current;
  const canGoBack = navState.history.length > 0 || activeModule !== 'home';
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [pendingMutations, setPendingMutations] = useState<PendingOfflineMutation[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastWsEvent, setLastWsEvent] = useState<{ type: string; [key: string]: unknown } | null>(null);
  const [quickCaptureTarget, setQuickCaptureTarget] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const syncThemeFromUser = useCallback((authUser: AuthUser | null) => {
    if (authUser?.theme) {
      const resolved = normalizeThemeId(authUser.theme);
      setThemeState(resolved);
      applyThemeToDocument(resolved);
    }
  }, []);

  const setTheme = useCallback(
    async (nextTheme: EchoThemeId) => {
      const resolved = normalizeThemeId(nextTheme);
      setThemeState(resolved);
      applyThemeToDocument(resolved);
      if (!user) return;
      try {
        const res = await apiRequest<{ user: AuthUser }>('/profile', {
          method: 'PUT',
          body: JSON.stringify({ theme: resolved }),
        });
        setUser(res.user);
      } catch {
        // Local theme already applied; ignore transient offline save failure
      }
    },
    [user]
  );

  const navigateTo = useCallback((mod: ModuleId, itemId: string | null = null) => {
    setNavState((prev) =>
      prev.current === mod
        ? prev
        : { current: mod, history: [...prev.history.slice(-29), prev.current] }
    );
    setFocusItemId(itemId);
  }, []);

  const setActiveModule = useCallback(
    (mod: ModuleId) => {
      navigateTo(mod, null);
    },
    [navigateTo]
  );

  const goBack = useCallback(() => {
    setFocusItemId(null);
    setNavState((prev) => {
      if (prev.history.length > 0) {
        const previousModule = prev.history[prev.history.length - 1];
        return {
          current: previousModule,
          history: prev.history.slice(0, -1),
        };
      }
      if (prev.current !== 'home') {
        return { current: 'home', history: [] };
      }
      return prev;
    });
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiRequest<{ user: AuthUser }>('/auth/me');
      setUser(data.user);
      syncThemeFromUser(data.user);
    } catch {
      setUser(null);
    }
  }, [syncThemeFromUser]);

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await apiRequest<{ notifications: NotificationItem[] }>('/notifications');
      setNotifications(data.notifications);
    } catch {
      // ignore if offline
    }
  }, []);

  const markNotificationRead = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      try {
        await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
      } catch {
        void refreshNotifications();
      }
    },
    [refreshNotifications]
  );

  const markAllNotificationsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await apiRequest('/notifications/read-all', { method: 'POST' });
    } catch {
      void refreshNotifications();
    }
  }, [refreshNotifications]);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine || !user) return 0;
    const queued = await listOfflineMutations();
    let synced = 0;
    for (const item of queued) {
      try {
        await apiRequest(item.endpoint, {
          method: 'POST',
          body: JSON.stringify({ ...item.payload, clientMutationId: item.clientMutationId }),
        });
        await removeOfflineMutation(item.clientMutationId);
        synced += 1;
      } catch {
        // Leave in queue to retry later
      }
    }
    const remaining = await listOfflineMutations();
    setPendingMutations(remaining);
    return synced;
  }, [user]);

  const queueMutation = useCallback(
    async (mutation: Omit<PendingOfflineMutation, 'clientMutationId' | 'queuedAt'>) => {
      const full: PendingOfflineMutation = {
        ...mutation,
        clientMutationId: `mut-${crypto.randomUUID()}`,
        queuedAt: new Date().toISOString(),
      };
      await enqueueOfflineMutation(full);
      const updated = await listOfflineMutations();
      setPendingMutations(updated);
    },
    []
  );

  // Initial session hydration (uses HttpOnly cookie if present on reload)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await apiRequest<{ user: AuthUser }>('/auth/me');
        if (active) {
          setUser(data.user);
          syncThemeFromUser(data.user);
        }
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setAuthLoading(false);
      }
      const pending = await listOfflineMutations();
      if (active) setPendingMutations(pending);
    })();
    return () => {
      active = false;
    };
  }, [syncThemeFromUser]);

  // Online / Offline listeners + automatic sync retry
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      void syncNow();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [syncNow]);

  // Global Cmd/Ctrl+K search shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Real-time WebSocket connection when authenticated
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      return;
    }

    void refreshNotifications();

    if (isStandaloneLocalMode()) {
      setWsConnected(false);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      const tok = getAuthToken();
      if (tok) {
        ws.send(JSON.stringify({ type: 'auth', token: tok }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type: string; notification?: NotificationItem; [key: string]: unknown };
        if (data.type === 'auth:ok') {
          setWsConnected(true);
        } else if (data.type === 'notification:new' && data.notification) {
          setNotifications((prev) => [data.notification!, ...prev.filter((n) => n.id !== data.notification!.id)]);
        }
        setLastWsEvent(data);
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [userId, refreshNotifications]);

  const loginSuccess = useCallback(
    (nextUser: AuthUser, token: string) => {
      setAuthToken(token);
      setUser(nextUser);
      syncThemeFromUser(nextUser);
    },
    [syncThemeFromUser]
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    try {
      await signOutFirebase();
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setNotifications([]);
    setNavState({ current: 'home', history: [] });
    setFocusItemId(null);
  }, []);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <EchoContext.Provider
      value={{
        user,
        authLoading,
        theme,
        setTheme,
        activeModule,
        setActiveModule,
        focusItemId,
        navigateTo,
        canGoBack,
        goBack,
        notifications,
        unreadCount,
        refreshNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        isOnline,
        pendingMutations,
        queueMutation,
        syncNow,
        wsConnected,
        lastWsEvent,
        loginSuccess,
        refreshUser,
        logout,
        quickCaptureTarget,
        setQuickCaptureTarget,
        searchOpen,
        setSearchOpen,
      }}
    >
      {children}
    </EchoContext.Provider>
  );
}

export function useEcho(): EchoContextValue {
  const ctx = useContext(EchoContext);
  if (!ctx) throw new Error('useEcho must be used inside EchoProvider');
  return ctx;
}
