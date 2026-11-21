import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Clock,
  Download,
  Feather,
  HeartHandshake,
  KeyRound,
  LogOut,
  Moon,
  Repeat,
  ShieldCheck,
  Sparkles,
  Trash2,
  Watch,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
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
      accent: 'text-cyan-300',
      icon: Sparkles,
    },
    {
      id: 'capsules',
      title: 'Time Capsule Vault',
      description: 'Seal letters, promises, and voice notes for future milestones.',
      accent: 'text-amber-300',
      icon: Clock,
    },
    {
      id: 'wisdom',
      title: "Stranger's Wisdom",
      description: 'Exchange anonymous life lessons and advice without identity exposure.',
      accent: 'text-violet-300',
      icon: Feather,
    },
    {
      id: 'skillswap',
      title: 'SkillSwap',
      description: 'Trade skills directly with mutually matched partners and live chat.',
      accent: 'text-emerald-300',
      icon: Repeat,
    },
    {
      id: 'objects',
      title: 'Life Behind Objects',
      description: 'Document heirloom lineage, attach voice stories, and generate QR tags.',
      accent: 'text-rose-300',
      icon: Watch,
    },
    {
      id: 'dreams',
      title: 'Dream Archive',
      description: 'Log dreams, vividness, recurring symbols, and reflective prompts.',
      accent: 'text-indigo-300',
      icon: Moon,
    },
    {
      id: 'humanity',
      title: 'Humanity Feed',
      description: 'Read and share anonymous moments of kindness across global regions.',
      accent: 'text-teal-300',
      icon: HeartHandshake,
    },
    {
      id: 'memories',
      title: 'ECHO Memory',
      description: 'Browse your timeline, calendar, map, collections, and slideshows.',
      accent: 'text-sky-300',
      icon: BookOpen,
    },
  ];

  return (
    <div className="space-y-6 min-w-0 w-full">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Discover ECHO</h1>
        <p className="text-sm text-slate-400">
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
              className="text-left rounded-2xl border border-white/[0.08] bg-[#0D1424] hover:border-white/20 hover:bg-[#111A2E] p-6 space-y-3 transition-colors"
            >
              <Icon className={`w-6 h-6 ${d.accent}`} />
              <div className="font-display text-base font-bold text-white">{d.title}</div>
              <p className="text-xs text-slate-400 leading-relaxed">{d.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ProfileSettingsView() {
  const { user, refreshUser, logout } = useEcho();
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
    const [sessRes, usageRes] = await Promise.all([
      apiRequest<{ sessions: typeof sessions }>('/auth/sessions'),
      apiRequest<{ totalBytes: number; fileCount: number }>('/media/usage'),
    ]);
    setSessions(sessRes.sessions);
    setStorageUsage(usageRes);
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
    await apiRequest(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadAccountDetails();
  };

  const handleExportAll = async () => {
    const data = await apiRequest<Record<string, unknown>>('/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-full-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAccount = async () => {
    await apiRequest('/account', { method: 'DELETE' });
    await logout();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto min-w-0 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Profile & Privacy</h1>
          <p className="text-sm text-slate-400">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-[#0D1424] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.06] whitespace-nowrap shrink-0"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-xs text-emerald-100">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-xs text-rose-100">
          {error}
        </div>
      )}

      <form onSubmit={handleSaveProfile} className="rounded-2xl border border-white/[0.08] bg-[#0D1424] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-[#070B14] border border-white/10 flex items-center justify-center shrink-0">
            {avatarMediaId ? (
              <AuthMedia mediaId={avatarMediaId} className="w-full h-full object-cover" />
            ) : (
              <span className="font-display text-xl font-bold text-sky-300">
                {(user?.displayName || 'E').slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-white">{user?.displayName}</div>
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
            <label className="text-xs text-slate-400 block mb-1">Display Name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#070B14] px-3.5 py-2.5 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Timezone</label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#070B14] px-3.5 py-2.5 text-sm text-white font-mono"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-slate-400 block mb-1">Location Hint (approximate city/region)</label>
            <input
              type="text"
              value={locationHint}
              onChange={(e) => setLocationHint(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#070B14] px-3.5 py-2.5 text-sm text-white"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-slate-400 block mb-1">Bio</label>
            <textarea
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#070B14] px-3.5 py-2.5 text-sm text-white"
            />
          </div>
        </div>

        <div className="border-t border-white/[0.08] pt-4 space-y-3">
          <div className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-cyan-300" /> AI & Notification Preferences
          </div>
          <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={aiConsent}
              onChange={(e) => setAiConsent(e.target.checked)}
              className="rounded border-white/20 bg-[#070B14]"
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
              <label key={key} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifPrefs[key] !== false}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="rounded border-white/20 bg-[#070B14]"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="rounded-xl bg-sky-400 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-300"
        >
          Save Changes
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <form onSubmit={handleChangePassword} className="rounded-2xl border border-white/[0.08] bg-[#0D1424] p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-white inline-flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-sky-400" /> Change Password
          </h2>
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="w-full rounded-xl border border-white/10 bg-[#070B14] px-3.5 py-2.5 text-sm text-white"
          />
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (8+ characters)"
            className="w-full rounded-xl border border-white/10 bg-[#070B14] px-3.5 py-2.5 text-sm text-white"
          />
          <button type="submit" className="rounded-xl bg-white/[0.08] px-4 py-2 text-xs font-medium text-white hover:bg-white/15">
            Update Password
          </button>
        </form>

        <div className="rounded-2xl border border-white/[0.08] bg-[#0D1424] p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-white">Active Sessions & Storage</h2>
          <div className="text-xs text-slate-400 font-mono tabular-nums">
            Media used: {(storageUsage.totalBytes / (1024 * 1024)).toFixed(2)} MB across {storageUsage.fileCount} file(s)
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs border-b border-white/[0.06] pb-2">
                <div className="truncate pr-2">
                  <div className="text-slate-200 truncate">{s.deviceLabel}</div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {s.isCurrent ? 'Current session' : new Date(s.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    onClick={() => void handleRevokeSession(s.id)}
                    className="text-rose-300 hover:underline shrink-0"
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
      <div className="rounded-2xl border border-white/[0.08] bg-[#0D1424] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-bold text-white">Archive Export & Account Deletion</h2>
          <p className="text-xs text-slate-400">
            Download all your personal records as JSON, or permanently erase your account and uploaded media.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void handleExportAll()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.06]"
          >
            <Download className="w-4 h-4" /> Export Archive
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-200"
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
