import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Copy,
  KeyRound,
  Lock,
  Mail,
  MessageSquareText,
  Palette,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import heroCosmosImg from '../assets/images/echo_hero_cosmos_1795260972427.jpg';
import { useEcho } from '../context/EchoContext';
import { apiRequest } from '../lib/api';
import {
  type MultiFactorInfo,
  type MultiFactorResolver,
  formatE164Phone,
  mapFirebaseAuthError,
  resolveFirebaseTotpSignIn,
  signInWithGooglePopup,
} from '../lib/firebase';
import { isStandaloneLocalMode } from '../lib/localStandaloneApi';
import { ECHO_THEMES } from '../lib/themes';
import type { AuthSessionOrMfaResponse, AuthUser, MfaFactorHint } from '../types/echo';
import { SafeImage } from './MediaElements';

declare global {
  interface Window {
    phoneEmailListener?: (userObj: { user_json_url?: string }) => void;
  }
}

const COUNTRY_DIAL_CODES: Array<{ code: string; label: string }> = [
  { code: '+1', label: 'US / CA (+1)' },
  { code: '+91', label: 'IN (+91)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+61', label: 'AU (+61)' },
  { code: '+65', label: 'SG (+65)' },
  { code: '+971', label: 'AE (+971)' },
  { code: '+49', label: 'DE (+49)' },
  { code: '+33', label: 'FR (+33)' },
  { code: '+81', label: 'JP (+81)' },
  { code: '+82', label: 'KR (+82)' },
  { code: '+55', label: 'BR (+55)' },
  { code: '+52', label: 'MX (+52)' },
  { code: '+34', label: 'ES (+34)' },
  { code: '+39', label: 'IT (+39)' },
  { code: '+31', label: 'NL (+31)' },
  { code: '+46', label: 'SE (+46)' },
  { code: '+64', label: 'NZ (+64)' },
  { code: '+27', label: 'ZA (+27)' },
  { code: '+234', label: 'NG (+234)' },
  { code: '+62', label: 'ID (+62)' },
  { code: '+63', label: 'PH (+63)' },
];

interface SendOtpResponse {
  ok: boolean;
  delivery: 'sms' | 'in_app';
  previewOtp?: string;
  requiresPin?: boolean;
  isExistingAccount?: boolean;
  expiresInSeconds?: number;
}

export function AuthScreen() {
  const { loginSuccess, theme, setTheme } = useEcho();
  const [mode, setMode] = useState<'register' | 'login' | 'phone' | 'reset'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [issuedResetCode, setIssuedResetCode] = useState<string | null>(null);

  // Phone OTP state (works without external SMS APIs via built-in OTP + PIN, or real SMS when configured)
  const [dialCode, setDialCode] = useState('+91');
  const [phoneInput, setPhoneInput] = useState('');
  const [formattedPhone, setFormattedPhone] = useState('');
  const [phoneStep, setPhoneStep] = useState<'enter-phone' | 'enter-otp'>('enter-phone');
  const [otpCode, setOtpCode] = useState('');
  const [securityPin, setSecurityPin] = useState('');
  const [previewOtp, setPreviewOtp] = useState<string | null>(null);
  const [requiresPin, setRequiresPin] = useState(true);
  const [isExistingPhoneAccount, setIsExistingPhoneAccount] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [phoneEmailLoading, setPhoneEmailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [echoMfaChallenge, setEchoMfaChallenge] = useState<{
    challengeToken: string;
    factors: MfaFactorHint[];
    hintLabel?: string;
  } | null>(null);
  const [firebaseMfaChallenge, setFirebaseMfaChallenge] = useState<{
    resolver: MultiFactorResolver;
    hints: MultiFactorInfo[];
    selectedUid: string;
    fallbackDisplayName?: string;
  } | null>(null);
  const [mfaOtpCode, setMfaOtpCode] = useState('');

  const handleAuthResponse = (res: AuthSessionOrMfaResponse) => {
    if (res.mfaRequired && res.challengeToken) {
      setFirebaseMfaChallenge(null);
      setEchoMfaChallenge({
        challengeToken: res.challengeToken,
        factors: res.factors?.length
          ? res.factors
          : [{ factorId: 'totp', uid: 'totp-primary', displayName: 'Authenticator App' }],
        hintLabel: res.hintLabel,
      });
      setMfaOtpCode('');
      setError(null);
      setNotice('Enter the 6-digit code from your authenticator app to finish signing in.');
      return;
    }
    if (res.user && res.token) {
      loginSuccess(res.user, res.token);
      return;
    }
    throw new Error('Unexpected authentication response.');
  };

  const latestAuthContextRef = useRef({ displayName, theme, handleAuthResponse });
  latestAuthContextRef.current = { displayName, theme, handleAuthResponse };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (mode !== 'phone' || phoneStep !== 'enter-phone' || isStandaloneLocalMode()) {
      return;
    }

    let cancelled = false;

    window.phoneEmailListener = async (userObj) => {
      const userJsonUrl = userObj?.user_json_url;
      if (!userJsonUrl || cancelled) return;

      setError(null);
      setNotice(null);
      setPhoneEmailLoading(true);
      try {
        const { displayName: currentName, theme: currentTheme, handleAuthResponse: completeOrChallenge } =
          latestAuthContextRef.current;
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const res = await apiRequest<AuthSessionOrMfaResponse>('/auth/phone/email-verify', {
          method: 'POST',
          body: JSON.stringify({
            userJsonUrl,
            displayName: currentName.trim() || undefined,
            timezone: tz,
            theme: currentTheme,
            deviceLabel: navigator.userAgent.slice(0, 50),
          }),
        });
        if (!cancelled) {
          completeOrChallenge(res);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Phone.Email verification failed.');
        }
      } finally {
        if (!cancelled) {
          setPhoneEmailLoading(false);
        }
      }
    };

    const existingScripts = document.querySelectorAll('script[src="https://www.phone.email/sign_in_button_v1.js"]');
    existingScripts.forEach((node) => node.remove());

    const script = document.createElement('script');
    script.src = 'https://www.phone.email/sign_in_button_v1.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      cancelled = true;
      script.remove();
      delete window.phoneEmailListener;
    };
  }, [mode, phoneStep]);

  const cycleTheme = () => {
    const idx = ECHO_THEMES.findIndex((t) => t.id === theme);
    const next = ECHO_THEMES[(idx + 1) % ECHO_THEMES.length];
    void setTheme(next.id);
  };

  const currentThemeDef = ECHO_THEMES.find((t) => t.id === theme) || ECHO_THEMES[0];

  const cancelMfaChallenge = () => {
    setEchoMfaChallenge(null);
    setFirebaseMfaChallenge(null);
    setMfaOtpCode('');
    setError(null);
    setNotice(null);
  };

  const switchMode = (nextMode: 'register' | 'login' | 'phone' | 'reset') => {
    if (nextMode !== 'phone') {
      setPhoneStep('enter-phone');
      setOtpCode('');
      setSecurityPin('');
      setPreviewOtp(null);
    }
    setEchoMfaChallenge(null);
    setFirebaseMfaChallenge(null);
    setMfaOtpCode('');
    setMode(nextMode);
    setError(null);
    setNotice(null);
  };

  const exchangeFirebaseToken = async (idToken: string, fallbackDisplayName?: string) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const res = await apiRequest<AuthSessionOrMfaResponse>('/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({
        idToken,
        displayName: fallbackDisplayName?.trim() || undefined,
        timezone: tz,
        theme,
        deviceLabel: navigator.userAgent.slice(0, 50),
      }),
    });
    handleAuthResponse(res);
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setNotice(null);

    if (isStandaloneLocalMode()) {
      setError('Google sign-in requires connecting to your live ECHO server (tap Server URL below) or use Phone OTP / email.');
      return;
    }

    setGoogleLoading(true);
    try {
      const result = await signInWithGooglePopup();
      if (result.status === 'mfa_required') {
        const totpHint = result.hints.find((h) => h.factorId === 'totp') || result.hints[0];
        if (!totpHint) {
          setError('Your account requires a second factor that cannot be verified in this form.');
          return;
        }
        setEchoMfaChallenge(null);
        setFirebaseMfaChallenge({
          resolver: result.resolver,
          hints: result.hints,
          selectedUid: totpHint.uid,
          fallbackDisplayName: displayName,
        });
        setMfaOtpCode('');
        setNotice('Open your authenticator app and enter the 6-digit verification code.');
        return;
      }
      await exchangeFirebaseToken(result.idToken, result.displayName || displayName);
    } catch (err) {
      setError(mapFirebaseAuthError(err, 'google'));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleMfaChallengeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = mfaOtpCode.replace(/\D/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }

    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (firebaseMfaChallenge) {
        const resolved = await resolveFirebaseTotpSignIn(
          firebaseMfaChallenge.resolver,
          firebaseMfaChallenge.selectedUid,
          cleanCode
        );
        setFirebaseMfaChallenge(null);
        setMfaOtpCode('');
        await exchangeFirebaseToken(
          resolved.idToken,
          resolved.displayName || firebaseMfaChallenge.fallbackDisplayName
        );
      } else if (echoMfaChallenge) {
        const res = await apiRequest<AuthSessionOrMfaResponse>('/auth/mfa/totp/challenge', {
          method: 'POST',
          body: JSON.stringify({
            challengeToken: echoMfaChallenge.challengeToken,
            code: cleanCode,
            deviceLabel: navigator.userAgent.slice(0, 50),
          }),
        });
        setEchoMfaChallenge(null);
        setMfaOtpCode('');
        if (res.user && res.token) {
          loginSuccess(res.user, res.token);
        } else {
          throw new Error('Verification did not complete.');
        }
      }
    } catch (err) {
      if (firebaseMfaChallenge) {
        setError(mapFirebaseAuthError(err, 'mfa'));
      } else {
        setError(err instanceof Error ? err.message : 'Authenticator verification failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (overridePhone?: string) => {
    setError(null);
    setNotice(null);

    let e164 = '';
    try {
      e164 = overridePhone || formatE164Phone(dialCode, phoneInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enter a valid mobile phone number.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<SendOtpResponse>('/auth/phone/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: e164 }),
      });

      setFormattedPhone(e164);
      setPhoneStep('enter-otp');
      setOtpCode('');
      setSecurityPin('');
      setPreviewOtp(res.delivery === 'in_app' && res.previewOtp ? res.previewOtp : null);
      setRequiresPin(res.requiresPin ?? res.delivery === 'in_app');
      setIsExistingPhoneAccount(Boolean(res.isExistingAccount));
      setResendCooldown(30);
      setNotice(
        res.delivery === 'sms'
          ? `6-digit verification code sent via SMS to ${e164}.`
          : `6-digit verification code generated for ${e164}. Enter it below along with your Security PIN.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate OTP code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const cleanCode = otpCode.replace(/\D/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      setError('Please enter the 6-digit OTP verification code.');
      return;
    }
    if (requiresPin && securityPin.trim().length < 4) {
      setError('Please enter a 4 to 24 character Security PIN.');
      return;
    }

    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const res = await apiRequest<AuthSessionOrMfaResponse>('/auth/phone/verify-otp', {
        method: 'POST',
        body: JSON.stringify({
          phoneNumber: formattedPhone,
          code: cleanCode,
          pin: requiresPin ? securityPin.trim() : undefined,
          displayName: displayName.trim() || undefined,
          timezone: tz,
          theme,
          deviceLabel: navigator.userAgent.slice(0, 50),
        }),
      });
      handleAuthResponse(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'phone') {
      if (phoneStep === 'enter-phone') {
        await handleSendOtp();
      } else {
        await handleVerifyOtp();
      }
      return;
    }

    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      if (mode === 'register') {
        const res = await apiRequest<{ user: AuthUser; token: string }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, displayName, timezone: tz, theme }),
        });
        loginSuccess(res.user, res.token);
      } else if (mode === 'login') {
        const res = await apiRequest<AuthSessionOrMfaResponse>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password, deviceLabel: navigator.userAgent.slice(0, 50) }),
        });
        handleAuthResponse(res);
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

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-transparent text-ink grid lg:grid-cols-12">
      <div className="relative lg:col-span-7 flex flex-col justify-between overflow-hidden min-h-[230px] sm:min-h-[280px] lg:min-h-screen">
        <SafeImage
          src={heroCosmosImg}
          alt="Serene midnight horizon with glowing light trails over calm water"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#130824] via-[#270D3E]/65 to-[#0F172A]/40" />

        <div className="relative z-10 p-5 sm:p-10">
          <span className="inline-flex items-center gap-2 font-display text-xl font-bold tracking-tight text-white">
            <span className="w-7 h-7 rounded-lg bg-brand-gradient inline-flex items-center justify-center text-xs font-bold text-accent-ink shadow-sm">
              E
            </span>
            ECHO
          </span>
        </div>

        <div className="relative z-10 p-5 sm:p-12 max-w-2xl space-y-3 sm:space-y-4">
          <p className="text-xs font-semibold text-rose-300 tracking-wide">
            The Human Memory Network
          </p>
          <h1 className="font-display text-2xl sm:text-5xl font-bold text-white leading-tight [text-wrap:balance]">
            Save what matters. Understand your life. Connect with humanity.
          </h1>
          <p className="text-sm sm:text-base text-slate-200 leading-relaxed max-w-xl">
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

      <div className="lg:col-span-5 flex items-center justify-center p-5 pb-20 sm:p-12 bg-shell border-t lg:border-t-0 lg:border-l border-hairline">
        <div className="w-full max-w-md space-y-5 sm:space-y-6 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-ink-muted">Theme: {currentThemeDef.name}</span>
            <button
              type="button"
              onClick={cycleTheme}
              className="touch-manipulation inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink hover:border-hairline-strong transition-colors min-h-[36px]"
            >
              <Palette className="w-3.5 h-3.5 text-accent-text" />
              Switch Theme
            </button>
          </div>

          {(firebaseMfaChallenge || echoMfaChallenge) ? (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="w-4 h-4" /> Two-Factor Authentication Required
                </div>
                <h2 className="font-display text-2xl font-bold text-ink">Verify with Authenticator</h2>
                <p className="text-sm text-ink-muted">
                  {firebaseMfaChallenge
                    ? 'Enter the 6-digit verification code from your enrolled Google Authenticator or TOTP app.'
                    : `Enter the 6-digit authenticator code for ${echoMfaChallenge?.hintLabel || 'your account'}.`}
                </p>
              </div>

              <form onSubmit={handleMfaChallengeSubmit} className="space-y-4">
                {firebaseMfaChallenge && firebaseMfaChallenge.hints.length > 1 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ink-secondary">Enrolled Authenticator</label>
                    <select
                      value={firebaseMfaChallenge.selectedUid}
                      onChange={(e) =>
                        setFirebaseMfaChallenge((prev) =>
                          prev ? { ...prev, selectedUid: e.target.value } : prev
                        )
                      }
                      className="w-full rounded-xl border border-hairline-strong bg-inset px-3.5 py-2.5 text-sm text-ink"
                    >
                      {firebaseMfaChallenge.hints.map((h) => (
                        <option key={h.uid} value={h.uid}>
                          {h.displayName || 'Authenticator App'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-secondary">
                    6-Digit Authenticator Code
                    {echoMfaChallenge?.factors[0]?.displayName
                      ? ` (${echoMfaChallenge.factors[0].displayName})`
                      : ''}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    maxLength={6}
                    value={mfaOtpCode}
                    onChange={(e) => setMfaOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    className="w-full rounded-xl border border-hairline-strong bg-inset px-4 py-3 text-center text-lg font-mono tracking-[0.45em] text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                  />
                </div>

                {error && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-rose-700 dark:text-rose-200">
                    {error}
                  </div>
                )}

                {notice && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-200">
                    {notice}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || mfaOtpCode.replace(/\D/g, '').length !== 6}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-accent-ink hover:opacity-95 disabled:opacity-60 transition-opacity min-h-[44px] shadow-md"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{loading ? 'Verifying Code...' : 'Verify Authenticator Code'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={cancelMfaChallenge}
                  className="w-full rounded-xl border border-hairline-strong bg-surface px-4 py-2.5 text-xs font-medium text-ink-secondary hover:text-ink transition-colors"
                >
                  Cancel & Back to Sign In
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <h2 className="font-display text-2xl font-bold text-ink">
                  {mode === 'register' && 'Create your ECHO archive'}
                  {mode === 'login' && 'Welcome back to ECHO'}
                  {mode === 'phone' && (phoneStep === 'enter-otp' ? 'Verify your OTP code' : 'Sign in with Phone OTP')}
                  {mode === 'reset' && 'Reset your password'}
                </h2>
                <p className="text-sm text-ink-muted">
                  {mode === 'register' && 'Your memories, capsules, and dreams stay private and synchronized.'}
                  {mode === 'login' && 'Sign in to access your memories, capsules, and live SkillSwap conversations.'}
                  {mode === 'phone' &&
                    (phoneStep === 'enter-otp'
                      ? 'Enter the 6-digit verification code and your Security PIN.'
                      : 'Verify instantly with our built-in OTP + Security PIN (no API keys required).')}
                  {mode === 'reset' && 'Generate a one-time reset token to regain access to your account.'}
                </p>
              </div>

              <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-surface border border-hairline">
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className={`py-2 px-1 text-[11px] sm:text-xs font-medium rounded-lg transition-colors truncate ${
                    mode === 'register' ? 'bg-accent text-accent-ink font-semibold' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`py-2 px-1 text-[11px] sm:text-xs font-medium rounded-lg transition-colors truncate ${
                    mode === 'login' ? 'bg-accent text-accent-ink font-semibold' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('phone')}
                  className={`py-2 px-1 text-[11px] sm:text-xs font-medium rounded-lg transition-colors truncate ${
                    mode === 'phone' ? 'bg-accent text-accent-ink font-semibold' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  Phone OTP
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('reset')}
                  className={`py-2 px-1 text-[11px] sm:text-xs font-medium rounded-lg transition-colors truncate ${
                    mode === 'reset' ? 'bg-accent text-accent-ink font-semibold' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  Reset
                </button>
              </div>

              {mode !== 'reset' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => void handleGoogleSignIn()}
                    disabled={googleLoading || loading || phoneEmailLoading}
                    className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-hairline-strong bg-surface hover:bg-surface-raised px-4 py-2.5 text-sm font-semibold text-ink transition-colors min-h-[44px] disabled:opacity-60"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                      />
                    </svg>
                    <span>{googleLoading ? 'Connecting to Google...' : 'Continue with Google'}</span>
                  </button>

                  <div className="relative flex items-center gap-3">
                    <div className="h-px flex-1 bg-hairline" />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                      or continue with {mode === 'phone' ? 'Phone OTP' : 'email'}
                    </span>
                    <div className="h-px flex-1 bg-hairline" />
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'phone' ? (
                  phoneStep === 'enter-phone' ? (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-ink-secondary">
                          Display Name <span className="text-ink-muted font-normal">(optional for new accounts)</span>
                        </label>
                        <div className="relative">
                          <UserIcon className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Your name"
                            className="w-full rounded-xl border border-hairline-strong bg-inset pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-ink-secondary">Mobile Phone Number</label>
                        <div className="flex gap-2">
                          <select
                            aria-label="Country code"
                            value={dialCode}
                            onChange={(e) => setDialCode(e.target.value)}
                            className="w-[126px] shrink-0 rounded-xl border border-hairline-strong bg-inset px-2.5 py-2.5 text-xs sm:text-sm text-ink focus:outline-none focus:border-sky-400"
                          >
                            {COUNTRY_DIAL_CODES.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <div className="relative flex-1 min-w-0">
                            <Smartphone className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="tel"
                              required
                              autoComplete="tel-national"
                              value={phoneInput}
                              onChange={(e) => setPhoneInput(e.target.value)}
                              placeholder="98765 43210"
                              className="w-full rounded-xl border border-hairline-strong bg-inset pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                            />
                          </div>
                        </div>
                        <p className="text-[11px] text-ink-muted">
                          Works immediately with zero SMS API keys using an in-app 6-digit OTP and your Security PIN.
                        </p>
                      </div>

                      {!isStandaloneLocalMode() && (
                        <div className="space-y-3 pt-1">
                          <div className="relative flex items-center gap-3">
                            <div className="h-px flex-1 bg-hairline" />
                            <span className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                              or verify via Phone.Email SMS
                            </span>
                            <div className="h-px flex-1 bg-hairline" />
                          </div>
                          <div className="rounded-xl border border-hairline-strong bg-surface p-3.5 space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-ink">
                                Optional SMS via Phone.Email
                              </span>
                              <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                                External SMS
                              </span>
                            </div>
                            <div id="signInContainer" className="flex justify-center min-h-[44px] items-center">
                              <div
                                className="pe_signin_button"
                                data-client-id="12892347125451774475"
                              />
                            </div>
                            {phoneEmailLoading && (
                              <p className="text-xs text-center text-accent-text font-medium">
                                Completing phone verification...
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-hairline bg-surface px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                        <span className="text-ink-secondary truncate">
                          Verifying <strong className="text-ink font-mono">{formattedPhone}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPhoneStep('enter-phone');
                            setOtpCode('');
                            setSecurityPin('');
                            setPreviewOtp(null);
                            setError(null);
                            setNotice(null);
                          }}
                          className="text-accent-text font-medium hover:underline shrink-0"
                        >
                          Change number
                        </button>
                      </div>

                      {previewOtp && (
                        <div className="rounded-xl border border-sky-500/35 bg-sky-500/10 p-3.5 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                              <MessageSquareText className="w-3.5 h-3.5" />
                              Instant Verification Code
                            </span>
                            <button
                              type="button"
                              onClick={() => setOtpCode(previewOtp)}
                              className="inline-flex items-center gap-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 px-2.5 py-1 text-[11px] font-semibold text-sky-800 dark:text-sky-200 transition-colors"
                            >
                              <Copy className="w-3 h-3" />
                              Fill OTP
                            </button>
                          </div>
                          <div className="font-mono text-2xl font-bold tracking-[0.35em] text-ink">
                            {previewOtp}
                          </div>
                          <p className="text-[11px] text-ink-muted">
                            Delivered directly in-app (no external SMS API needed). Valid for 5 minutes.
                          </p>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-ink-secondary">6-Digit OTP Code</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          required
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="••••••"
                          className="w-full rounded-xl border border-hairline-strong bg-inset px-4 py-3 text-center text-lg font-mono tracking-[0.45em] text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                        />
                      </div>

                      {requiresPin && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-ink-secondary">
                            {isExistingPhoneAccount ? 'Enter Your Security PIN' : 'Create Security PIN (4–8 digits)'}
                          </label>
                          <div className="relative">
                            <Lock className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="password"
                              inputMode="numeric"
                              required
                              minLength={4}
                              maxLength={24}
                              value={securityPin}
                              onChange={(e) => setSecurityPin(e.target.value)}
                              placeholder={isExistingPhoneAccount ? 'Your saved Security PIN' : 'e.g. 4829'}
                              className="w-full rounded-xl border border-hairline-strong bg-inset pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                            />
                          </div>
                          <p className="text-[11px] text-ink-muted">
                            {isExistingPhoneAccount
                              ? 'Verifies your phone archive without requiring an external SMS gateway.'
                              : 'Protects your phone account on future sign-ins.'}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs text-ink-muted">
                        <span>Need a fresh code?</span>
                        <button
                          type="button"
                          disabled={resendCooldown > 0 || loading}
                          onClick={() => void handleSendOtp(formattedPhone)}
                          className="inline-flex items-center gap-1.5 font-medium text-accent-text hover:underline disabled:opacity-50 disabled:no-underline"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend OTP'}
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <>
                    {mode === 'register' && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-ink-secondary">Display Name</label>
                        <div className="relative">
                          <UserIcon className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            required
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Your name"
                            className="w-full rounded-xl border border-hairline-strong bg-inset pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-ink-secondary">Email Address</label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Enter your email address"
                          className="w-full rounded-xl border border-hairline-strong bg-inset pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                        />
                      </div>
                    </div>

                    {mode === 'reset' && issuedResetCode && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-amber-700 dark:text-amber-300">
                          Reset Token (auto-filled)
                        </label>
                        <input
                          type="text"
                          required
                          value={resetToken}
                          onChange={(e) => setResetToken(e.target.value)}
                          className="w-full rounded-xl border border-amber-500/30 bg-inset px-3.5 py-2.5 text-xs font-mono text-amber-800 dark:text-amber-200 focus:outline-none"
                        />
                      </div>
                    )}

                    {(mode !== 'reset' || Boolean(issuedResetCode)) && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-ink-secondary">
                          {mode === 'reset' ? 'New Password (8+ characters)' : 'Password'}
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="password"
                            required
                            minLength={8}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="At least 8 characters"
                            className="w-full rounded-xl border border-hairline-strong bg-inset pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-sky-400"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}

                {error && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-rose-700 dark:text-rose-200">
                    {error}
                  </div>
                )}

                {notice && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-200">
                    {notice}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    loading ||
                    googleLoading ||
                    phoneEmailLoading ||
                    (mode === 'phone' &&
                      phoneStep === 'enter-otp' &&
                      (otpCode.replace(/\D/g, '').length !== 6 || (requiresPin && securityPin.trim().length < 4)))
                  }
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-accent-ink hover:opacity-95 disabled:opacity-60 transition-opacity min-h-[44px] shadow-md"
                >
                  {mode === 'register' && <Sparkles className="w-4 h-4" />}
                  {mode === 'phone' && phoneStep === 'enter-phone' && <Smartphone className="w-4 h-4" />}
                  {mode === 'phone' && phoneStep === 'enter-otp' && <ShieldCheck className="w-4 h-4" />}
                  {mode === 'reset' && <KeyRound className="w-4 h-4" />}
                  <span>
                    {loading
                      ? mode === 'phone'
                        ? phoneStep === 'enter-phone'
                          ? 'Generating OTP...'
                          : 'Verifying...'
                        : 'Please wait...'
                      : mode === 'register'
                      ? 'Create Personal Archive'
                      : mode === 'login'
                      ? 'Sign In to ECHO'
                      : mode === 'phone'
                      ? phoneStep === 'enter-phone'
                        ? 'Send OTP Verification Code'
                        : 'Verify OTP & Sign In'
                      : issuedResetCode
                      ? 'Confirm New Password'
                      : 'Request Reset Token'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </>
          )}

          {typeof window !== 'undefined' &&
            Boolean((window as unknown as { EchoAndroid?: { configureServer?: () => void } }).EchoAndroid?.configureServer) && (
              <div className="pt-3 border-t border-hairline flex items-center justify-between gap-2 text-[11px] text-ink-muted">
                <span>
                  {window.location.hostname === 'echo.local'
                    ? 'On-Device Mode (saved locally)'
                    : 'Connected to ECHO server'}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    (window as unknown as { EchoAndroid?: { configureServer?: () => void } }).EchoAndroid?.configureServer?.()
                  }
                  className="font-medium text-accent-text hover:underline whitespace-nowrap shrink-0"
                >
                  Server URL
                </button>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
