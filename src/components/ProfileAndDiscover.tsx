import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  Clock,
  Download,
  Feather,
  HeartHandshake,
  KeyRound,
  LogOut,
  Moon,
  Palette,
  Repeat,
  ShieldCheck,
  Sparkles,
  Trash2,
  Watch,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import { ECHO_THEMES } from '../lib/themes';
import type { ModuleId } from '../types/echo';
import { AuthMedia, MediaPicker } from './MediaElements';

export function DiscoverHub() {
  const { navigateTo } = useEcho();

  const destinations: Array<{
    id: ModuleId;
    title: string;
    description: string;
    accent: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'ai',
      title: 'AI Life Memory',
      description: 'Ask grounded questions across your memories, dreams, and objects.',
      accent: 'text-cyan-600 dark:text-cyan-300',
      icon: Sparkles,
    },
    {
      id: 'capsules',
      title: 'Time Capsule Vault',
      description: 'Seal letters, promises, and voice notes for future milestones.',
      accent: 'text-amber-600 dark:text-amber-300',
      icon: Clock,
    },
    {
      id: 'wisdom',
      title: "Stranger's Wisdom",
      description: 'Exchange anonymous life lessons and advice without identity exposure.',
      accent: 'text-violet-600 dark:text-violet-300',
      icon: Feather,
    },
    {
      id: 'skillswap',
      title: 'SkillSwap',
      description: 'Trade skills directly with mutually matched partners and live chat.',
      accent: 'text-emerald-600 dark:text-emerald-300',
      icon: Repeat,
    },
    {
      id: 'objects',
      title: 'Life Behind Objects',
      description: 'Document heirloom lineage, attach voice stories, and generate QR tags.',
      accent: 'text-rose-600 dark:text-rose-300',
      icon: Watch,
    },
    {
      id: 'dreams',
      title: 'Dream Archive',
      description: 'Log dreams, vividness, recurring symbols, and reflective prompts.',
      accent: 'text-indigo-600 dark:text-indigo-300',
      icon: Moon,
    },
    {
      id: 'humanity',
      title: 'Humanity Feed',
      description: 'Read and share anonymous moments of kindness across global regions.',
      accent: 'text-teal-600 dark:text-teal-300',
      icon: HeartHandshake,
    },
    {
      id: 'memories',
      title: 'ECHO Memory',
      description: 'Browse your timeline, calendar, map, collections, and slideshows.',
      accent: 'text-sky-600 dark:text-sky-300',
      icon: BookOpen,
    },
  ];

  return (
    <div className="space-y-6 min-w-0 w-full">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink">Discover ECHO</h1>
        <p className="text-sm text-ink-muted">
          Every module shares your single account, privacy preferences, search index, and real-time sync.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {destinations.map((d) => {
          const Icon = d.icon;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => navigateTo(d.id)}
              className="text-left rounded-2xl border border-hairline bg-surface hover:border-hairline-strong hover:bg-surface-raised p-6 space-y-3 transition-colors"
            >
              <Icon className={`w-6 h-6 ${d.accent}`} />
              <div className="font-display text-base font-bold text-ink">{d.title}</div>
              <p className="text-xs text-ink-muted leading-relaxed">{d.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ProfileSettingsView() {
  const { user, theme, setTheme, refreshUser, logout } = useEcho();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [locationHint, setLocationHint] = useState(user?.locationHint || '');
  const [timezone, setTimezone] = useState(user?.timezone || 'UTC');
  const [aiConsent, setAiConsent] = useState(user?.aiConsent ?? true);
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(user?.avatarMediaId || null);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(user?.notificationPrefs || {});

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [sessions, setSessions] = useState<Array<{ id: string; deviceLabel: string; createdAt: string; isCurrent: boolean }>>([]);
  const [storageUsage, setStorageUsage] = useState<{ totalBytes: number; fileCount: number }>({ totalBytes: 0, fileCount: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAccountDetails = async () => {
    try {
      const [sessRes, usageRes] = await Promise.all([
        apiRequest<{ sessions: typeof sessions }>('/auth/sessions'),
        apiRequest<{ totalBytes: number; fileCount: number }>('/media/usage'),
      ]);
      setSessions(sessRes.sessions);
      setStorageUsage(usageRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load account details.');
    }
  };

  useEffect(() => {
    void loadAccountDetails();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          displayName,
          bio,
          locationHint,
          timezone,
          theme,
          aiConsent,
          avatarMediaId,
          notificationPrefs: notifPrefs,
        }),
      });
      await refreshUser();
      setNotice('Profile and privacy preferences saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setNotice('Password changed successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed.');
    }
  };

  const handleRevokeSession = async (id: string) => {
    setError(null);
    try {
      await apiRequest(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadAccountDetails();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke session.');
    }
  };

  const handleExportAll = async () => {
    setError(null);
    try {
      const data = await apiRequest<Record<string, unknown>>('/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `echo-full-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export archive.');
    }
  };

  const handleDeleteAccount = async () => {
    setError(null);
    try {
      await apiRequest('/account', { method: 'DELETE' });
      await logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete account.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto min-w-0 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink">Profile & Privacy</h1>
          <p className="text-sm text-ink-muted">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex items-center gap-2 rounded-xl border border-hairline-strong bg-surface px-4 py-2 text-xs font-medium text-ink-secondary hover:text-ink hover:bg-tint-hover whitespace-nowrap shrink-0"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-100">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-800 dark:text-rose-100">
          {error}
        </div>
      )}

      {/* Custom Themes & Frosted Glass Gallery */}
      <section className="rounded-2xl border border-hairline bg-surface p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-ink inline-flex items-center gap-2">
              <Palette className="w-4 h-4 text-accent-text" /> Appearance & Social Themes
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Choose vibrant Social Bloom, Social Pulse Dark, Frosted Glass, Nordic Aurora, Amber Hearth, or Nebula Dusk. Synced across devices.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ECHO_THEMES.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => void setTheme(t.id)}
                className={`touch-manipulation text-left rounded-xl border p-3.5 space-y-3 transition-all ${
                  active
                    ? 'border-accent-border bg-accent-soft ring-1 ring-accent-border'
                    : 'border-hairline bg-inset hover:border-hairline-strong'
                }`}
              >
                {/* Live Theme Preview Box */}
                <div
                  className="relative h-16 rounded-lg overflow-hidden border border-white/15 p-2 flex flex-col justify-between"
                  style={{
                    background: t.isGlass
                      ? `radial-gradient(circle at 20% 20%, ${t.swatches.accent}44, transparent 60%), radial-gradient(circle at 85% 80%, ${t.swatches.secondary}44, transparent 60%), ${t.swatches.canvas}`
                      : t.swatches.canvas,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="h-1.5 w-10 rounded-full"
                      style={{ backgroundColor: t.swatches.accent }}
                    />
                    {t.isGlass && (
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: t.swatches.surface,
                          color: t.isDark ? '#E2E8F0' : '#0F172A',
                          backdropFilter: 'blur(8px)',
                        }}
                      >
                        Frosted Glass
                      </span>
                    )}
                  </div>
                  <div
                    className="h-6 rounded-md border flex items-center px-2 gap-1.5"
                    style={{
                      backgroundColor: t.swatches.surface,
                      borderColor: t.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.12)',
                      backdropFilter: t.isGlass ? 'blur(10px)' : 'none',
                    }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.swatches.accent }} />
                    <span className="w-12 h-1.5 rounded-full opacity-40" style={{ backgroundColor: t.isDark ? '#F8FAFC' : '#0F172A' }} />
                  </div>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display text-sm font-semibold text-ink truncate">{t.name}</div>
                    <p className="text-[11px] text-ink-muted leading-snug mt-0.5">{t.tagline}</p>
                  </div>
                  {active && (
                    <span className="w-5 h-5 rounded-full bg-accent text-accent-ink flex items-center justify-center shrink-0">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <form onSubmit={handleSaveProfile} className="rounded-2xl border border-hairline bg-surface p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-inset border border-hairline-strong flex items-center justify-center shrink-0">
            {avatarMediaId ? (
              <AuthMedia mediaId={avatarMediaId} className="w-full h-full object-cover" />
            ) : (
              <span className="font-display text-xl font-bold text-accent-text">
                {(user?.displayName || 'E').slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-ink">{user?.displayName}</div>
            <MediaPicker
              contextType="avatar"
              accept="image/*"
              label="Upload Profile Photo"
              onUploaded={(m) => setAvatarMediaId(m.id)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-ink-muted block mb-1">Display Name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div>
            <label className="text-xs text-ink-muted block mb-1">Timezone</label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink font-mono"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-ink-muted block mb-1">Location Hint (approximate city/region)</label>
            <input
              type="text"
              value={locationHint}
              onChange={(e) => setLocationHint(e.target.value)}
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-ink-muted block mb-1">Bio</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
        </div>

        <div className="border-t border-hairline pt-4 space-y-3">
          <div className="text-xs font-semibold text-ink inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-cyan-600 dark:text-cyan-300" /> AI & Notification Preferences
          </div>
          <label className="flex items-center gap-2.5 text-xs text-ink-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={aiConsent}
              onChange={(e) => setAiConsent(e.target.checked)}
              className="rounded border-hairline-strong bg-inset"
            />
            Allow ECHO AI to read non-excluded personal memories for reflection and search
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {[
              ['capsuleUnlocks', 'Time capsule unlock alerts'],
              ['onThisDay', 'On-this-day reminders'],
              ['wisdomReplies', "Stranger's Wisdom replies"],
              ['skillMatches', 'SkillSwap requests & sessions'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifPrefs[key] !== false}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="rounded border-hairline-strong bg-inset"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong transition-colors"
        >
          Save Changes
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <form onSubmit={handleChangePassword} className="rounded-2xl border border-hairline bg-surface p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-ink inline-flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-sky-600 dark:text-sky-400" /> Change Password
          </h2>
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
          />
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (8+ characters)"
            className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
          />
          <button type="submit" className="rounded-xl bg-tint px-4 py-2 text-xs font-medium text-ink hover:bg-tint-hover border border-hairline">
            Update Password
          </button>
        </form>

        <div className="rounded-2xl border border-hairline bg-surface p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-ink">Active Sessions & Storage</h2>
          <div className="text-xs text-ink-muted font-mono tabular-nums">
            Media used: {(storageUsage.totalBytes / (1024 * 1024)).toFixed(2)} MB across {storageUsage.fileCount} file(s)
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs border-b border-hairline pb-2">
                <div className="truncate pr-2">
                  <div className="text-ink-secondary truncate">{s.deviceLabel}</div>
                  <div className="text-[11px] text-ink-muted font-mono">
                    {s.isCurrent ? 'Current session' : new Date(s.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    onClick={() => void handleRevokeSession(s.id)}
                    className="text-rose-600 dark:text-rose-300 hover:underline shrink-0"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Data Export & Account Deletion */}
      <div className="rounded-2xl border border-hairline bg-surface p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-bold text-ink">Archive Export & Account Deletion</h2>
          <p className="text-xs text-ink-muted">
            Download all your personal records as JSON, or permanently erase your account and uploaded media.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void handleExportAll()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline-strong px-4 py-2 text-xs font-medium text-ink hover:bg-tint"
          >
            <Download className="w-4 h-4" /> Export Archive
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-700 dark:text-rose-200"
            >
              <Trash2 className="w-4 h-4" /> Delete Account
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleDeleteAccount()}
              className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-white"
            >
              Confirm Permanent Deletion
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
