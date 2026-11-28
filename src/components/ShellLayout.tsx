import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Check,
  Clock,
  Compass,
  Feather,
  HeartHandshake,
  Home,
  MapPin,
  Mic,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Sparkles,
  User,
  Watch,
  WifiOff,
  X,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import { useMobileKeyboardState } from '../lib/mobileKeyboard';
import { ECHO_THEMES } from '../lib/themes';
import type { ModuleId, SearchResult } from '../types/echo';

const SIDEBAR_ITEMS: Array<{ id: ModuleId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'memories', label: 'ECHO Memory', icon: BookOpen },
  { id: 'memory-map', label: 'Memory Map', icon: MapPin },
  { id: 'ai', label: 'AI Life Memory', icon: Sparkles },
  { id: 'capsules', label: 'Time Capsules', icon: Clock },
  { id: 'wisdom', label: "Stranger's Wisdom", icon: Feather },
  { id: 'skillswap', label: 'SkillSwap', icon: Repeat },
  { id: 'objects', label: 'Life Behind Objects', icon: Watch },
  { id: 'dreams', label: 'Dream Archive', icon: Moon },
  { id: 'humanity', label: 'Humanity Feed', icon: HeartHandshake },
];

const QUICK_ACTIONS: Array<{
  target: string;
  module: ModuleId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}> = [
  { target: 'memory', module: 'memories', label: 'Create memory', icon: BookOpen, accent: 'text-sky-600 dark:text-sky-300' },
  { target: 'voice', module: 'memories', label: 'Record voice', icon: Mic, accent: 'text-cyan-600 dark:text-cyan-300' },
  { target: 'capsule', module: 'capsules', label: 'Create time capsule', icon: Clock, accent: 'text-amber-600 dark:text-amber-300' },
  { target: 'wisdom', module: 'wisdom', label: 'Share wisdom', icon: Feather, accent: 'text-violet-600 dark:text-violet-300' },
  { target: 'humanity', module: 'humanity', label: 'Share humanity story', icon: HeartHandshake, accent: 'text-teal-600 dark:text-teal-300' },
  { target: 'object', module: 'objects', label: 'Add object', icon: Watch, accent: 'text-rose-600 dark:text-rose-300' },
  { target: 'dream', module: 'dreams', label: 'Record dream', icon: Moon, accent: 'text-indigo-600 dark:text-indigo-300' },
  { target: 'skill', module: 'skillswap', label: 'Offer skill', icon: Repeat, accent: 'text-emerald-600 dark:text-emerald-300' },
];

export function ShellLayout({ children }: { children: React.ReactNode }) {
  const {
    user,
    theme,
    setTheme,
    activeModule,
    navigateTo,
    canGoBack,
    goBack,
    notifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    isOnline,
    pendingMutations,
    syncNow,
    setQuickCaptureTarget,
    searchOpen,
    setSearchOpen,
  } = useEcho();

  const [notifOpen, setNotifOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isKeyboardOpen, keyboardOverlapPx } = useMobileKeyboardState();

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiRequest<{ results: SearchResult[] }>(
          `/search?q=${encodeURIComponent(searchQuery.trim())}`
        );
        setSearchResults(res.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [searchQuery, searchOpen]);

  const triggerQuickAction = (module: ModuleId, target: string) => {
    setFabOpen(false);
    navigateTo(module);
    setQuickCaptureTarget(target);
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
  };

  const currentLabel =
    SIDEBAR_ITEMS.find((i) => i.id === activeModule)?.label ||
    (activeModule === 'discover' ? 'Discover' : 'Profile & Privacy');
  const activeThemeDef = ECHO_THEMES.find((t) => t.id === theme) || ECHO_THEMES[0];

  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-clip bg-transparent text-ink flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-hairline bg-shell">
        <div className="h-16 px-6 flex items-center justify-between border-b border-hairline">
          <button
            type="button"
            onClick={() => navigateTo('home')}
            className="touch-manipulation inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight text-ink whitespace-nowrap"
          >
            <span className="w-6 h-6 rounded-lg bg-brand-gradient inline-flex items-center justify-center text-[11px] font-bold text-accent-ink shadow-sm">
              E
            </span>
            <span>ECHO</span>
          </button>
          <button
            type="button"
            onClick={() => setFabOpen(true)}
            title="Quick Capture"
            className="touch-manipulation inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-gradient text-accent-ink hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`touch-manipulation w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-accent-soft text-accent-text border border-accent-border font-semibold'
                    : 'text-ink-muted hover:text-ink hover:bg-tint border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-accent-text' : ''}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-hairline space-y-1">
          {themeMenuOpen && (
            <div className="mb-2 rounded-xl border border-hairline bg-surface p-2 space-y-1">
              <div className="px-2 py-1 text-[11px] font-semibold text-ink-muted">Choose Theme</div>
              {ECHO_THEMES.map((t) => {
                const selected = t.id === theme;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      void setTheme(t.id);
                      setThemeMenuOpen(false);
                    }}
                      className={`touch-manipulation w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors min-h-[36px] ${
                        selected
                          ? 'bg-accent-soft text-accent-text font-semibold'
                          : 'text-ink-secondary hover:bg-tint hover:text-ink'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-hairline-strong shrink-0"
                          style={{
                            background: `linear-gradient(135deg, ${t.swatches.canvas} 50%, ${t.swatches.accent} 50%)`,
                          }}
                        />
                        <span className="truncate">{t.name}</span>
                      </span>
                      {selected && <Check className="w-3.5 h-3.5 shrink-0 text-accent-text" />}
                    </button>
                  );
                })}
              </div>
            )}

          <button
            type="button"
            onClick={() => setThemeMenuOpen((prev) => !prev)}
            className={`touch-manipulation w-full flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              themeMenuOpen ? 'bg-tint-hover text-ink' : 'text-ink-muted hover:text-ink hover:bg-tint'
            }`}
          >
            <span className="inline-flex items-center gap-3 min-w-0">
              <Palette className="w-4 h-4 shrink-0 text-accent-text" />
              <span className="truncate">{activeThemeDef.name}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo('discover')}
            className={`touch-manipulation w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              activeModule === 'discover' ? 'bg-tint-hover text-ink' : 'text-ink-muted hover:text-ink hover:bg-tint'
            }`}
          >
            <Compass className="w-4 h-4 shrink-0" />
            <span>Discover</span>
          </button>
          <button
            type="button"
            onClick={() => navigateTo('profile')}
            className={`touch-manipulation w-full flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              activeModule === 'profile' ? 'bg-tint-hover text-ink' : 'text-ink-muted hover:text-ink hover:bg-tint'
            }`}
          >
            <User className="w-4 h-4 shrink-0" />
            <span className="truncate">{user?.displayName || 'Profile'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 w-full lg:pl-64 flex flex-col min-h-dvh">
        {/* Sticky Top Bar (compact <= 56px on mobile, opaque shell so scrolled text never bleeds through) */}
        <header
          data-echo-header
          className="sticky top-0 z-30 min-h-14 pt-[env(safe-area-inset-top)] w-full bg-shell border-b border-hairline shadow-[0_1px_0_var(--echo-hairline)] px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4"
        >
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <button
              type="button"
              onClick={goBack}
              disabled={!canGoBack}
              aria-label="Go back"
              title={canGoBack ? 'Go back to previous tab' : 'Home tab'}
              className="touch-manipulation inline-flex items-center justify-center w-9 h-9 rounded-xl border border-hairline-strong bg-surface text-ink-secondary hover:text-ink hover:bg-tint-hover disabled:opacity-35 disabled:pointer-events-none shrink-0 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => navigateTo('home')}
              className="touch-manipulation lg:hidden font-display text-sm sm:text-base font-bold text-ink truncate max-w-[108px] sm:max-w-[180px]"
            >
              {activeModule === 'home' ? 'ECHO' : currentLabel}
            </button>
            <span className="hidden lg:inline font-display text-sm font-semibold text-ink truncate">
              {currentLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="touch-manipulation flex-1 min-w-0 flex items-center gap-2 rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs text-ink-muted hover:text-ink hover:border-hairline-strong max-w-xs justify-between"
          >
            <span className="inline-flex items-center gap-2 min-w-0 truncate">
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Search ECHO...</span>
            </span>
            <span className="hidden sm:inline font-mono text-[10px] text-ink-muted shrink-0">⌘K</span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              aria-label="Notifications"
              className="touch-manipulation relative inline-flex items-center justify-center w-10 h-10 rounded-xl border border-hairline-strong bg-surface text-ink-secondary hover:text-ink"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-accent text-accent-ink font-mono text-[10px] font-bold flex items-center justify-center px-1 tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Honest Offline & Pending Sync Banner */}
        {(!isOnline || pendingMutations.length > 0) && (
          <div className="bg-amber-500/10 border-b border-amber-500/25 px-4 sm:px-6 py-2 flex items-center justify-between gap-3 text-xs text-amber-800 dark:text-amber-100">
            <div className="inline-flex items-center gap-2">
              {!isOnline && <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300 shrink-0" />}
              <span>
                {!isOnline
                  ? `Offline mode — cached memories readable. ${pendingMutations.length} pending change(s) queued.`
                  : `${pendingMutations.length} offline change(s) waiting for server confirmation.`}
              </span>
            </div>
            {isOnline && pendingMutations.length > 0 && (
              <button
                type="button"
                onClick={() => void handleManualSync()}
                disabled={syncing}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-slate-950 shrink-0"
              >
                <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            )}
          </div>
        )}

        {/* Main Viewport */}
        <main
          className={`flex-1 min-w-0 w-full px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-7xl mx-auto ${
            isKeyboardOpen ? 'pb-6 lg:pb-10' : 'pb-28 lg:pb-10'
          }`}
          style={
            isKeyboardOpen && keyboardOverlapPx > 0
              ? { paddingBottom: `${keyboardOverlapPx + 24}px` }
              : undefined
          }
        >
          {children}
        </main>
      </div>

      {/* Mobile Floating Quick Action Button (hidden while soft keyboard is open) */}
      {!isKeyboardOpen && (
        <button
          type="button"
          onClick={() => setFabOpen(true)}
          aria-label="Quick capture menu"
          className="touch-manipulation lg:hidden fixed right-4 bottom-[74px] z-40 w-12 h-12 rounded-2xl bg-brand-gradient text-accent-ink shadow-lg flex items-center justify-center"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* Mobile Bottom Navigation (hidden while typing/entering so inputs stay clear above keyboard) */}
      {!isKeyboardOpen && (
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 min-h-[58px] pb-[env(safe-area-inset-bottom)] bg-shell border-t border-hairline grid grid-cols-5 items-center px-1">
          {[
            { id: 'home' as ModuleId, label: 'Home', icon: Home },
            { id: 'memories' as ModuleId, label: 'Memories', icon: BookOpen },
            { id: 'humanity' as ModuleId, label: 'Humanity', icon: HeartHandshake },
            { id: 'discover' as ModuleId, label: 'Discover', icon: Compass },
            { id: 'profile' as ModuleId, label: 'Profile', icon: User },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeModule === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigateTo(tab.id)}
                className={`touch-manipulation flex flex-col items-center justify-center min-h-[44px] text-[10px] font-medium ${
                  active ? 'text-accent-text font-semibold' : 'text-ink-muted'
                }`}
              >
                <Icon className="w-5 h-5 mb-0.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* QUICK CAPTURE SHEET */}
      {fabOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-hairline-strong bg-surface p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">Create in ECHO</h2>
              <button type="button" onClick={() => setFabOpen(false)} className="touch-manipulation text-ink-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {QUICK_ACTIONS.map((qa) => {
                const Icon = qa.icon;
                return (
                  <button
                    key={qa.target}
                    type="button"
                    onClick={() => triggerQuickAction(qa.module, qa.target)}
                    className="touch-manipulation flex items-center gap-2.5 rounded-xl border border-hairline bg-inset hover:border-hairline-strong p-3 text-left text-xs font-medium text-ink min-h-[48px]"
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${qa.accent}`} />
                    <span className="truncate">{qa.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* UNIFIED SEARCH MODAL */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-start justify-center p-3 sm:p-4 pt-4 sm:pt-16 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl border border-hairline-strong bg-surface overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-hairline shrink-0">
              <Search className="w-4 h-4 text-sky-500 dark:text-sky-400 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search memories, capsules, objects, dreams, wisdom, skills..."
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
              />
              <button type="button" onClick={() => setSearchOpen(false)} className="text-ink-muted hover:text-ink">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 max-h-96 overflow-y-auto p-3 space-y-1.5">
              {searching ? (
                <p className="text-xs text-ink-muted p-4 text-center">Searching your ECHO network...</p>
              ) : searchQuery.trim() && searchResults.length === 0 ? (
                <p className="text-xs text-ink-muted p-4 text-center">No matching entries found.</p>
              ) : !searchQuery.trim() ? (
                <p className="text-xs text-ink-muted p-4 text-center">
                  Type a keyword, person, place, emotion, or skill to search across all modules.
                </p>
              ) : (
                searchResults.map((res) => (
                  <button
                    key={`${res.module}-${res.id}`}
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      navigateTo(res.module, res.id);
                    }}
                    className="w-full text-left rounded-xl hover:bg-tint px-3.5 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{res.title}</div>
                      <div className="text-xs text-ink-muted truncate">
                        {res.module} · {res.subtitle}
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-ink-muted shrink-0">
                      {res.date ? res.date.slice(0, 10) : ''}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATIONS DRAWER */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-sm bg-shell border-l border-hairline h-full p-5 flex flex-col justify-between">
            <div className="space-y-4 overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-ink">Notifications</h2>
                <div className="flex items-center gap-3">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void markAllNotificationsRead()}
                      className="text-xs text-sky-600 dark:text-sky-300 hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                  <button type="button" onClick={() => setNotifOpen(false)} className="text-ink-muted hover:text-ink">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {notifications.length === 0 ? (
                <p className="text-xs text-ink-muted py-8 text-center">No notifications yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        void markNotificationRead(n.id);
                        setNotifOpen(false);
                        navigateTo(n.linkModule || 'home', n.linkId);
                      }}
                      className={`w-full text-left rounded-xl border p-3.5 space-y-1 transition-colors ${
                        n.isRead
                          ? 'border-hairline bg-surface/60 text-ink-muted'
                          : 'border-sky-400/35 bg-surface-raised text-ink'
                      }`}
                    >
                      <div className="text-xs font-semibold">{n.title}</div>
                      <div className="text-xs text-ink-secondary">{n.body}</div>
                      <div className="text-[10px] font-mono text-ink-muted">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
