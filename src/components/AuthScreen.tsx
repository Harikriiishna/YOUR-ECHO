import React, { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Lock, Mail, Sparkles, User as UserIcon } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import type { AuthUser, EchoObject } from '../types/echo';
import { SafeImage } from './MediaElements';

export function AuthScreen() {
  const { loginSuccess } = useEcho();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [issuedResetCode, setIssuedResetCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sharedObjectSlug, setSharedObjectSlug] = useState<string | null>(null);
  const [sharedObject, setSharedObject] = useState<EchoObject | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('sharedObject');
    if (slug) {
      setSharedObjectSlug(slug);
      apiRequest<{ object: EchoObject }>(`/shared/object/${encodeURIComponent(slug)}`)
        .then((res) => setSharedObject(res.object))
        .catch(() => setSharedObject(null));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      if (mode === 'register') {
        const res = await apiRequest<{ user: AuthUser; token: string }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, displayName, timezone: tz }),
        });
        loginSuccess(res.user, res.token);
      } else if (mode === 'login') {
        const res = await apiRequest<{ user: AuthUser; token: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password, deviceLabel: navigator.userAgent.slice(0, 50) }),
        });
        loginSuccess(res.user, res.token);
      } else {
        if (!issuedResetCode && !resetToken) {
          const res = await apiRequest<{ message: string; resetToken?: string }>('/auth/request-reset', {
            method: 'POST',
            body: JSON.stringify({ email }),
          });
          setNotice(res.message);
          if (res.resetToken) {
            setIssuedResetCode(res.resetToken);
            setResetToken(res.resetToken);
          }
        } else {
          await apiRequest('/auth/confirm-reset', {
            method: 'POST',
            body: JSON.stringify({ resetToken, newPassword: password }),
          });
          setNotice('Password updated. You can now sign in with your new password.');
          setMode('login');
          setPassword('');
          setIssuedResetCode(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  if (sharedObjectSlug) {
    return (
      <div className="min-h-screen bg-[#070B14] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full rounded-2xl border border-white/10 bg-[#0D1424] p-8 space-y-5">
          <div className="flex items-center justify-between">
            <span className="font-display text-lg font-bold tracking-tight text-sky-300">ECHO</span>
            <button
              type="button"
              onClick={() => {
                window.history.replaceState({}, '', '/');
                setSharedObjectSlug(null);
              }}
              className="text-xs font-medium text-slate-300 hover:text-white underline underline-offset-4"
            >
              Open ECHO App
            </button>
          </div>
          {sharedObject ? (
            <>
              <div className="text-xs text-amber-300/90">
                {sharedObject.category} · {sharedObject.acquisitionDate || 'Undated heirloom'} · {sharedObject.location || 'Shared story'}
              </div>
              <h1 className="font-display text-3xl font-bold text-white">{sharedObject.name}</h1>
              {sharedObject.description && <p className="text-sm text-slate-300">{sharedObject.description}</p>}
              <p className="text-base leading-relaxed text-slate-200 whitespace-pre-wrap">{sharedObject.story}</p>
              <div className="pt-4 border-t border-white/10 text-xs text-slate-400">
                Current Steward: {sharedObject.currentOwner || 'Private'}
                {sharedObject.previousOwners.length > 0 && ` · Previous Owners: ${sharedObject.previousOwners.join(' -> ')}`}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">This shared object story is either private or no longer available.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-[#070B14] text-slate-100 grid lg:grid-cols-12">
      <div className="relative lg:col-span-7 flex flex-col justify-between overflow-hidden min-h-[230px] sm:min-h-[280px] lg:min-h-screen">
        <SafeImage
          src="/src/assets/images/echo_hero_cosmos_1795260972427.jpg"
          alt="Serene midnight horizon with glowing light trails over calm water"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#070B14] via-[#070B14]/60 to-[#070B14]/35" />

        <div className="relative z-10 p-5 sm:p-10">
          <span className="font-display text-xl font-bold tracking-tight text-white">ECHO</span>
        </div>

        <div className="relative z-10 p-5 sm:p-12 max-w-2xl space-y-3 sm:space-y-4">
          <p className="text-xs font-medium text-sky-300 tracking-wide">
            The Human Memory Network
          </p>
          <h1 className="font-display text-2xl sm:text-5xl font-bold text-white leading-tight [text-wrap:balance]">
            Save what matters. Understand your life. Connect with humanity.
          </h1>
          <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
            One unified archive for life memories, grounded AI reflection, locked future time capsules, anonymous wisdom, skill exchanges, heirloom objects, and dreams.
          </p>
          <div className="pt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-300/90">
            <span>Private by default</span>
            <span aria-hidden="true">·</span>
            <span>Real-time cross-device sync</span>
            <span aria-hidden="true">·</span>
            <span>Server-sealed time capsules</span>
          </div>
        </div>
      </div>

      <div className="lg:col-span-5 flex items-center justify-center p-5 sm:p-12 bg-[#090F1D] border-t lg:border-t-0 lg:border-l border-white/[0.07]">
        <div className="w-full max-w-md space-y-6 sm:space-y-7 min-w-0">
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold text-white">
              {mode === 'register' && 'Create your ECHO archive'}
              {mode === 'login' && 'Welcome back to ECHO'}
              {mode === 'reset' && 'Reset your password'}
            </h2>
            <p className="text-sm text-slate-400">
              {mode === 'register' && 'Your memories, capsules, and dreams stay private and synchronized.'}
              {mode === 'login' && 'Sign in to access your memories, capsules, and live SkillSwap conversations.'}
              {mode === 'reset' && 'Generate a one-time reset token to regain access to your account.'}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#0D1424] border border-white/[0.08]">
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-2 px-1 text-[11px] sm:text-xs font-medium rounded-lg transition-colors truncate ${
                mode === 'register' ? 'bg-sky-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-2 px-1 text-[11px] sm:text-xs font-medium rounded-lg transition-colors truncate ${
                mode === 'login' ? 'bg-sky-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setError(null);
              }}
              className={`py-2 px-1 text-[11px] sm:text-xs font-medium rounded-lg transition-colors truncate ${
                mode === 'reset' ? 'bg-sky-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Reset
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Display Name</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-xl border border-white/10 bg-[#0D1424] pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className="w-full rounded-xl border border-white/10 bg-[#0D1424] pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>

            {mode === 'reset' && issuedResetCode && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-amber-300">Reset Token (auto-filled)</label>
                <input
                  type="text"
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  className="w-full rounded-xl border border-amber-500/30 bg-[#0D1424] px-3.5 py-2.5 text-xs font-mono text-amber-200 focus:outline-none"
                />
              </div>
            )}

            {(mode !== 'reset' || Boolean(issuedResetCode)) && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  {mode === 'reset' ? 'New Password (8+ characters)' : 'Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full rounded-xl border border-white/10 bg-[#0D1424] pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
                {error}
              </div>
            )}

            {notice && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:opacity-95 disabled:opacity-60 transition-opacity min-h-[44px]"
            >
              {mode === 'register' && <Sparkles className="w-4 h-4" />}
              {mode === 'reset' && <KeyRound className="w-4 h-4" />}
              <span>
                {loading
                  ? 'Please wait...'
                  : mode === 'register'
                  ? 'Create Personal Archive'
                  : mode === 'login'
                  ? 'Sign In to ECHO'
                  : issuedResetCode
                  ? 'Confirm New Password'
                  : 'Request Reset Token'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
