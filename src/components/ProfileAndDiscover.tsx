import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  BookOpen,
  Check,
  Clock,
  Copy,
  Download,
  Feather,
  HeartHandshake,
  KeyRound,
  LogOut,
  MapPin,
  Moon,
  Palette,
  QrCode,
  Repeat,
  ShieldCheck,
  Sparkles,
  Trash2,
  Watch,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import {
  type MultiFactorInfo,
  type TotpSecret,
  firebaseAuth,
  finalizeFirebaseTotpEnrollment,
  getFirebaseEnrolledFactors,
  mapFirebaseAuthError,
  requestFirebaseEmailVerification,
  startFirebaseTotpEnrollment,
  unenrollFirebaseTotpFactor,
} from '../lib/firebase';
import { isStandaloneLocalMode } from '../lib/localStandaloneApi';
import { ECHO_THEMES } from '../lib/themes';
import type { AuthUser, ModuleId } from '../types/echo';
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
    {
      id: 'memory-map',
      title: 'Memory Map',
      description: 'Explore every memory on an interactive galaxy constellation, relationship web, and world atlas.',
      accent: 'text-emerald-600 dark:text-emerald-300',
      icon: MapPin,
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

  // Built-in Authenticator TOTP MFA state
  const [totpCurrentPassword, setTotpCurrentPassword] = useState('');
  const [totpRotateCode, setTotpRotateCode] = useState('');
  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    totpUri: string;
    qrDataUrl: string;
    accountLabel: string;
    expiresInSeconds: number;
  } | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');
  const [totpDisplayName, setTotpDisplayName] = useState('Authenticator App');
  const [totpBusy, setTotpBusy] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [showUnenrollForm, setShowUnenrollForm] = useState(false);
  const [unenrollCode, setUnenrollCode] = useState('');
  const [unenrollPassword, setUnenrollPassword] = useState('');

  // Firebase Identity Platform TOTP MFA state (when signed into Firebase in browser)
  const [fbFactors, setFbFactors] = useState<MultiFactorInfo[]>(() => getFirebaseEnrolledFactors());
  const [fbTotpSetup, setFbTotpSetup] = useState<{
    totpSecret: TotpSecret;
    secretKey: string;
    totpUri: string;
    qrDataUrl: string;
  } | null>(null);
  const [fbVerifyCode, setFbVerifyCode] = useState('');
  const [fbDisplayName, setFbDisplayName] = useState('Google Authenticator');
  const [fbReauthPassword, setFbReauthPassword] = useState('');
  const [fbBusy, setFbBusy] = useState(false);
  const [fbCopiedSecret, setFbCopiedSecret] = useState(false);

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
    if (!user) return;
    setDisplayName(user.displayName || '');
    setBio(user.bio || '');
    setLocationHint(user.locationHint || '');
    setTimezone(user.timezone || 'UTC');
    setAiConsent(user.aiConsent ?? true);
    setAvatarMediaId(user.avatarMediaId || null);
    setNotifPrefs(user.notificationPrefs || {});
  }, [user]);

  useEffect(() => {
    void loadAccountDetails();
    setFbFactors(getFirebaseEnrolledFactors());
  }, [user?.id]);

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

  const usesEchoPassword =
    !user?.authProvider || user.authProvider === 'email';

  const handleStartTotpSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setTotpBusy(true);
    try {
      const res = await apiRequest<{
        secret: string;
        totpUri: string;
        qrDataUrl: string;
        accountLabel: string;
        expiresInSeconds: number;
      }>('/auth/mfa/totp/setup', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: usesEchoPassword ? totpCurrentPassword : undefined,
          currentCode: user?.totpEnabled ? totpRotateCode : undefined,
        }),
      });
      setTotpSetup(res);
      setTotpVerifyCode('');
      setTotpCurrentPassword('');
      setTotpRotateCode('');
      setShowUnenrollForm(false);
      setNotice('Scan the QR code or enter the setup key in your authenticator app, then enter the 6-digit code below.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initialize authenticator setup.');
    } finally {
      setTotpBusy(false);
    }
  };

  const handleVerifyTotpEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setTotpBusy(true);
    try {
      await apiRequest<{ user: AuthUser }>('/auth/mfa/totp/verify-enroll', {
        method: 'POST',
        body: JSON.stringify({
          code: totpVerifyCode.replace(/\D/g, ''),
          displayName: totpDisplayName.trim() || 'Authenticator App',
        }),
      });
      setTotpSetup(null);
      setTotpVerifyCode('');
      await refreshUser();
      setNotice('Two-factor authentication is now active on your ECHO account.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify authenticator code.');
    } finally {
      setTotpBusy(false);
    }
  };

  const handleUnenrollTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setTotpBusy(true);
    try {
      await apiRequest<{ user: AuthUser }>('/auth/mfa/totp/unenroll', {
        method: 'POST',
        body: JSON.stringify({
          code: unenrollCode.replace(/\D/g, '') || undefined,
          currentPassword: usesEchoPassword ? unenrollPassword || undefined : undefined,
        }),
      });
      setShowUnenrollForm(false);
      setUnenrollCode('');
      setUnenrollPassword('');
      setTotpSetup(null);
      await refreshUser();
      await loadAccountDetails();
      setNotice('Two-factor authentication has been disabled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disable two-factor authentication.');
    } finally {
      setTotpBusy(false);
    }
  };

  const copySecretText = async (secretValue: string, isFirebase = false) => {
    try {
      await navigator.clipboard.writeText(secretValue);
      if (isFirebase) {
        setFbCopiedSecret(true);
        window.setTimeout(() => setFbCopiedSecret(false), 2000);
      } else {
        setCopiedSecret(true);
        window.setTimeout(() => setCopiedSecret(false), 2000);
      }
    } catch {
      setError('Copy failed. Select and copy the setup key manually.');
    }
  };

  const handleStartFirebaseTotp = async () => {
    setError(null);
    setNotice(null);
    setFbBusy(true);
    try {
      const setup = await startFirebaseTotpEnrollment();
      const qrDataUrl = await QRCode.toDataURL(setup.totpUri, { width: 220, margin: 2 });
      setFbTotpSetup({ ...setup, qrDataUrl });
      setFbVerifyCode('');
      setNotice('Scan the Firebase TOTP QR code or enter the secret key, then confirm with a 6-digit code.');
    } catch (err) {
      setError(mapFirebaseAuthError(err, 'mfa'));
    } finally {
      setFbBusy(false);
    }
  };

  const handleFinalizeFirebaseTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fbTotpSetup) return;
    setError(null);
    setNotice(null);
    setFbBusy(true);
    try {
      const nextFactors = await finalizeFirebaseTotpEnrollment(
        fbTotpSetup.totpSecret,
        fbVerifyCode,
        fbDisplayName
      );
      setFbFactors(nextFactors);
      setFbTotpSetup(null);
      setFbVerifyCode('');
      setNotice('Firebase Identity Platform TOTP MFA enrolled successfully.');
    } catch (err) {
      setError(mapFirebaseAuthError(err, 'mfa'));
    } finally {
      setFbBusy(false);
    }
  };

  const handleUnenrollFirebaseTotp = async (enrollmentUid: string) => {
    setError(null);
    setNotice(null);
    setFbBusy(true);
    try {
      const nextFactors = await unenrollFirebaseTotpFactor(
        enrollmentUid,
        fbReauthPassword || undefined
      );
      setFbFactors(nextFactors);
      setFbReauthPassword('');
      setNotice('Removed Firebase TOTP second factor.');
    } catch (err) {
      setError(mapFirebaseAuthError(err, 'mfa'));
    } finally {
      setFbBusy(false);
    }
  };

  const handleSendFirebaseEmailVerification = async () => {
    setError(null);
    setNotice(null);
    setFbBusy(true);
    try {
      await requestFirebaseEmailVerification();
      setNotice('Verification email sent. Confirm your email address and sign back in to enroll Firebase TOTP.');
    } catch (err) {
      setError(mapFirebaseAuthError(err, 'mfa'));
    } finally {
      setFbBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto min-w-0 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink">Profile & Privacy</h1>
          <p className="text-sm text-ink-muted">
            {user?.email && !user.email.endsWith('@phone.echo.local')
              ? user.email
              : user?.phoneNumber || 'Verified Member'}
            {user?.phoneNumber && user?.email && !user.email.endsWith('@phone.echo.local') ? ` · ${user.phoneNumber}` : ''}
          </p>
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

      {/* Two-Factor Authentication (TOTP Authenticator) */}
      <section className="rounded-2xl border border-hairline bg-surface p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-base font-bold text-ink inline-flex items-center gap-2">
              <QrCode className="w-4 h-4 text-emerald-500" /> Two-Factor Authentication (Authenticator TOTP)
            </h2>
            <p className="text-xs text-ink-muted leading-relaxed">
              Protect sign-ins with time-based 6-digit codes from Google Authenticator, 1Password, Authy, or any standard TOTP app.
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg border shrink-0 self-start ${
              user?.totpEnabled
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-hairline-strong bg-inset text-ink-muted'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {user?.totpEnabled ? `Enabled (${user.totpDisplayName || 'Authenticator App'})` : 'Not enabled'}
          </span>
        </div>

        {user?.totpEnabled && !totpSetup && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-ink-secondary space-y-0.5">
              <div className="font-semibold text-ink">
                Active authenticator: {user.totpDisplayName || 'Authenticator App'}
              </div>
              {user.totpEnrolledAt && (
                <div className="text-ink-muted">
                  Enrolled on {new Date(user.totpEnrolledAt).toLocaleDateString()}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowUnenrollForm((v) => !v)}
                className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2 text-xs font-medium text-rose-700 dark:text-rose-200 hover:bg-rose-500/15"
              >
                {showUnenrollForm ? 'Cancel' : 'Disable 2FA'}
              </button>
            </div>
          </div>
        )}

        {showUnenrollForm && user?.totpEnabled && (
          <form onSubmit={handleUnenrollTotp} className="rounded-xl border border-rose-500/25 bg-inset p-4 space-y-3">
            <div className="text-xs font-semibold text-ink">Confirm Two-Factor Removal</div>
            <p className="text-xs text-ink-muted">
              {usesEchoPassword
                ? 'Enter a current 6-digit code from your authenticator app or your account password. Other active sessions will be signed out.'
                : 'Enter a current 6-digit code from your authenticator app. Other active sessions will be signed out.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={unenrollCode}
                onChange={(e) => setUnenrollCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit authenticator code"
                className="w-full rounded-xl border border-hairline-strong bg-surface px-3.5 py-2.5 text-sm font-mono text-ink"
              />
              {usesEchoPassword && (
                <input
                  type="password"
                  value={unenrollPassword}
                  onChange={(e) => setUnenrollPassword(e.target.value)}
                  placeholder="Or current account password"
                  className="w-full rounded-xl border border-hairline-strong bg-surface px-3.5 py-2.5 text-sm text-ink"
                />
              )}
            </div>
            <button
              type="submit"
              disabled={totpBusy || (unenrollCode.length !== 6 && !unenrollPassword)}
              className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {totpBusy ? 'Disabling...' : 'Confirm Disable 2FA'}
            </button>
          </form>
        )}

        {!totpSetup ? (
          <form onSubmit={handleStartTotpSetup} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {usesEchoPassword && (
                <div>
                  <label className="text-xs text-ink-muted block mb-1">Current Password (re-authentication)</label>
                  <input
                    type="password"
                    required
                    value={totpCurrentPassword}
                    onChange={(e) => setTotpCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
                  />
                </div>
              )}
              {user?.totpEnabled && (
                <div>
                  <label className="text-xs text-ink-muted block mb-1">Current 6-Digit Code (required to rotate key)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    maxLength={6}
                    value={totpRotateCode}
                    onChange={(e) => setTotpRotateCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit code"
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm font-mono text-ink"
                  />
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={totpBusy}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong transition-colors disabled:opacity-60"
            >
              <QrCode className="w-4 h-4" />
              {totpBusy
                ? 'Generating Secret...'
                : user?.totpEnabled
                ? 'Rotate Authenticator QR & Secret'
                : 'Set Up Authenticator App'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyTotpEnroll} className="rounded-xl border border-hairline-strong bg-inset p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5 items-center">
              <div className="bg-white p-2.5 rounded-xl border border-hairline mx-auto md:mx-0">
                <img
                  src={totpSetup.qrDataUrl}
                  alt="Authenticator QR code"
                  className="w-44 h-44 object-contain block"
                />
              </div>
              <div className="space-y-3 min-w-0">
                <div className="text-xs font-semibold text-ink">
                  1. Scan QR code or enter this setup key manually
                </div>
                <div className="rounded-xl border border-hairline bg-surface p-3 space-y-2">
                  <div className="text-[11px] text-ink-muted">
                    Account: <span className="font-mono text-ink-secondary">{totpSetup.accountLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs font-mono font-semibold text-ink break-all select-all">
                      {totpSetup.secret}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copySecretText(totpSetup.secret)}
                      className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-[11px] font-medium text-ink-secondary hover:text-ink shrink-0"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedSecret ? 'Copied' : 'Copy Key'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-xs text-ink-muted block mb-1">2. Label for this authenticator</label>
                    <input
                      type="text"
                      maxLength={60}
                      value={totpDisplayName}
                      onChange={(e) => setTotpDisplayName(e.target.value)}
                      placeholder="Google Authenticator"
                      className="w-full rounded-xl border border-hairline-strong bg-surface px-3.5 py-2.5 text-sm text-ink"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-muted block mb-1">3. Enter 6-digit code to activate</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      value={totpVerifyCode}
                      onChange={(e) => setTotpVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className="w-full rounded-xl border border-hairline-strong bg-surface px-3.5 py-2.5 text-sm font-mono tracking-[0.25em] text-ink"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={totpBusy || totpVerifyCode.replace(/\D/g, '').length !== 6}
                    className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-60"
                  >
                    {totpBusy ? 'Verifying...' : 'Verify & Enable MFA'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTotpSetup(null);
                      setTotpVerifyCode('');
                    }}
                    className="rounded-xl border border-hairline-strong bg-surface px-4 py-2 text-xs font-medium text-ink-secondary hover:text-ink"
                  >
                    Cancel Setup
                  </button>
                </div>
              </div>
            </div>
          </form>
        )}

        {!isStandaloneLocalMode() && firebaseAuth.currentUser && (
          <div className="border-t border-hairline pt-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-ink">
                  Firebase Identity Platform Second Factor
                </div>
                <p className="text-[11px] text-ink-muted">
                  Optional cloud-level TOTP factor on your signed-in Google/Firebase session ({firebaseAuth.currentUser.email || 'Firebase user'}).
                </p>
              </div>
              {firebaseAuth.currentUser.email && !firebaseAuth.currentUser.emailVerified && (
                <button
                  type="button"
                  disabled={fbBusy}
                  onClick={() => void handleSendFirebaseEmailVerification()}
                  className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-200 shrink-0"
                >
                  Send Email Verification
                </button>
              )}
            </div>

            {fbFactors.length > 0 && (
              <div className="space-y-2">
                {fbFactors.map((factor) => (
                  <div
                    key={factor.uid}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-hairline bg-inset px-3.5 py-2.5 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-ink">{factor.displayName || 'Authenticator'}</span>
                      <span className="text-ink-muted ml-2 font-mono">({factor.factorId})</span>
                    </div>
                    <button
                      type="button"
                      disabled={fbBusy}
                      onClick={() => void handleUnenrollFirebaseTotp(factor.uid)}
                      className="text-rose-600 dark:text-rose-300 font-medium hover:underline self-start sm:self-auto"
                    >
                      Remove Factor
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!fbTotpSetup ? (
              <button
                type="button"
                disabled={fbBusy}
                onClick={() => void handleStartFirebaseTotp()}
                className="rounded-xl border border-hairline-strong bg-inset hover:bg-tint px-3.5 py-2 text-xs font-medium text-ink disabled:opacity-60"
              >
                {fbBusy ? 'Preparing Firebase TOTP...' : 'Enroll Firebase TOTP Factor'}
              </button>
            ) : (
              <form onSubmit={handleFinalizeFirebaseTotp} className="rounded-xl border border-hairline bg-inset p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[170px_1fr] gap-4 items-center">
                  <div className="bg-white p-2 rounded-xl border border-hairline mx-auto md:mx-0">
                    <img src={fbTotpSetup.qrDataUrl} alt="Firebase TOTP QR code" className="w-36 h-36 object-contain block" />
                  </div>
                  <div className="space-y-2.5 min-w-0">
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-surface px-3 py-2">
                      <code className="text-xs font-mono text-ink break-all select-all">{fbTotpSetup.secretKey}</code>
                      <button
                        type="button"
                        onClick={() => void copySecretText(fbTotpSetup.secretKey, true)}
                        className="text-[11px] font-medium text-accent-text hover:underline shrink-0"
                      >
                        {fbCopiedSecret ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={fbDisplayName}
                        onChange={(e) => setFbDisplayName(e.target.value)}
                        placeholder="Google Authenticator"
                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs text-ink"
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        maxLength={6}
                        value={fbVerifyCode}
                        onChange={(e) => setFbVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code"
                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-xs font-mono text-ink"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={fbBusy || fbVerifyCode.replace(/\D/g, '').length !== 6}
                        className="rounded-xl bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-60"
                      >
                        Finalize Firebase Enrollment
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFbTotpSetup(null);
                          setFbVerifyCode('');
                        }}
                        className="rounded-xl border border-hairline px-3.5 py-1.5 text-xs text-ink-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {user?.authProvider === 'google' || user?.authProvider === 'phone' || user?.authProvider === 'phone_email' ? (
          <div className="rounded-2xl border border-hairline bg-surface p-6 space-y-3">
            <h2 className="font-display text-base font-bold text-ink inline-flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" /> Sign-In Method
            </h2>
            <p className="text-xs text-ink-secondary leading-relaxed">
              {user.authProvider === 'google'
                ? 'Your account uses verified Google Sign-In. Password management is handled through your Google Account.'
                : `Your account signs in via SMS OTP to ${user.phoneNumber || 'your verified mobile number'}.`}
            </p>
          </div>
        ) : (
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
        )}

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
