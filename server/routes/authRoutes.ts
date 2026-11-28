import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import QRCode from 'qrcode';
import {
  getApp as getFirebaseAdminApp,
  getApps as getFirebaseAdminApps,
  initializeApp as initFirebaseAdminApp,
} from 'firebase-admin/app';
import { getAuth as getFirebaseAdminAuth } from 'firebase-admin/auth';
import {
  type AuthenticatedRequest,
  clearSessionCookie,
  createSession,
  hashPassword,
  hashSessionToken,
  rateLimit,
  requireAuth,
  rowToAuthUser,
  setSessionCookie,
  verifyPassword,
} from '../auth.ts';
import { db, newId, UPLOADS_DIR } from '../db.ts';
import { buildTotpUri, generateBase32Secret, verifyTotpCode } from '../totp.ts';
import { pushNotification } from '../ws.ts';

export const authRouter = Router();

function getVerifiedFirebaseAdminAuth() {
  if (!getFirebaseAdminApps().length) {
    let projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!projectId && fs.existsSync(configPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
        if (typeof parsed.projectId === 'string' && parsed.projectId.trim()) {
          projectId = parsed.projectId.trim();
        }
      } catch {
        // Fallback to ADC defaults if config cannot be parsed
      }
    }
    initFirebaseAdminApp(projectId ? { projectId } : undefined);
  }
  return getFirebaseAdminAuth(getFirebaseAdminApp());
}

const ALLOWED_THEMES = new Set([
  'social',
  'social-dark',
  'midnight',
  'glass',
  'crystal',
  'aurora',
  'amber',
  'violet',
]);

function sanitizeTheme(value: unknown, fallback = 'social'): string {
  return typeof value === 'string' && ALLOWED_THEMES.has(value) ? value : fallback;
}

function createNotificationRecord(
  userId: string,
  type: string,
  title: string,
  body: string,
  linkModule: string,
  linkId?: string | null
): void {
  const id = newId('notif');
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, link_module, link_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, userId, type, title, body, linkModule, linkId ?? null, createdAt);
  pushNotification(userId, { id, type, title, body, linkModule, linkId: linkId ?? null, createdAt });
}

function maskAccountHint(row: Record<string, unknown>): string {
  const email = String(row.email || '');
  const phone = row.phone_number ? String(row.phone_number) : '';
  if (phone) {
    return `•••${phone.slice(-4)}`;
  }
  const atIdx = email.indexOf('@');
  if (atIdx > 1) {
    return `${email.slice(0, 2)}•••${email.slice(atIdx)}`;
  }
  return 'your account';
}

function issueMfaChallengeOrSession(
  req: import('express').Request,
  res: import('express').Response,
  userRow: Record<string, unknown>,
  deviceLabel: string,
  status = 200
): void {
  const userId = String(userRow.id);
  if (Boolean(userRow.totp_enabled) && Boolean(userRow.totp_secret)) {
    const rawChallenge = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(rawChallenge);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();

    db.prepare('DELETE FROM mfa_challenges WHERE user_id = ? AND expires_at <= ?').run(userId, now.toISOString());
    db.prepare(`
      INSERT INTO mfa_challenges (token_hash, user_id, device_label, attempts, expires_at, created_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(tokenHash, userId, deviceLabel.slice(0, 80), expiresAt, now.toISOString());

    res.status(200).json({
      mfaRequired: true,
      challengeToken: rawChallenge,
      factors: [
        {
          factorId: 'totp',
          uid: 'totp-primary',
          displayName: String(userRow.totp_display_name || 'Authenticator App'),
        },
      ],
      hintLabel: maskAccountHint(userRow),
    });
    return;
  }

  const { token } = createSession(userId, deviceLabel);
  setSessionCookie(req, res, token);
  res.status(status).json({
    user: rowToAuthUser(userRow),
    token,
  });
}

authRouter.post('/auth/register', rateLimit('auth', 20, 60_000), (req, res) => {
  const { email, password, displayName, timezone, theme } = req.body as {
    email?: string;
    password?: string;
    displayName?: string;
    timezone?: string;
    theme?: string;
  };

  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanName = (displayName || '').trim();
  if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length > 160 || cleanEmail.endsWith('@phone.echo.local')) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    return;
  }
  if (!cleanName || cleanName.length < 2) {
    res.status(400).json({ error: 'Display name must be at least 2 characters.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const userId = newId('usr');
  const now = new Date().toISOString();
  const pwHash = hashPassword(password);
  const tz = typeof timezone === 'string' && timezone.length <= 60 ? timezone : 'UTC';
  const cleanTheme = sanitizeTheme(theme, 'social');

  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, timezone, theme, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, cleanEmail, pwHash, cleanName.slice(0, 80), tz, cleanTheme, now, now);

    db.prepare(`
      INSERT INTO skill_profiles (user_id, updated_at) VALUES (?, ?)
    `).run(userId, now);
  })();

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
  const deviceLabel = String(req.headers['user-agent'] || 'Web Browser').slice(0, 60);
  const { token } = createSession(userId, deviceLabel);
  setSessionCookie(req, res, token);

  createNotificationRecord(
    userId,
    'system',
    'Welcome to ECHO',
    'Your private archive is ready. Save your first memory, record a dream, or seal a message for your future self.',
    'memories'
  );

  res.status(201).json({
    user: rowToAuthUser(userRow),
    token,
  });
});

authRouter.post('/auth/login', rateLimit('auth', 25, 60_000), (req, res) => {
  const { email, password, deviceLabel } = req.body as {
    email?: string;
    password?: string;
    deviceLabel?: string;
  };
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as
    | Record<string, unknown>
    | undefined;
  if (!userRow || !verifyPassword(password, String(userRow.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const label = deviceLabel || String(req.headers['user-agent'] || 'Web Browser').slice(0, 60);
  issueMfaChallengeOrSession(req, res, userRow, label, 200);
});

authRouter.post('/auth/firebase', rateLimit('auth', 25, 60_000), async (req, res) => {
  const { idToken, displayName, timezone, theme, deviceLabel } = req.body as {
    idToken?: string;
    displayName?: string;
    timezone?: string;
    theme?: string;
    deviceLabel?: string;
  };

  if (typeof idToken !== 'string' || idToken.trim().length < 20) {
    res.status(400).json({ error: 'A valid Firebase ID token is required.' });
    return;
  }

  let decoded;
  try {
    decoded = await getVerifiedFirebaseAdminAuth().verifyIdToken(idToken.trim());
  } catch {
    res.status(401).json({ error: 'Invalid or expired authentication token. Please sign in again.' });
    return;
  }

  const uid = decoded.uid;
  const signInProvider = decoded.firebase?.sign_in_provider || 'firebase';
  const authProvider =
    signInProvider === 'google.com'
      ? 'google'
      : signInProvider === 'phone'
      ? 'phone'
      : 'firebase';

  const verifiedEmail =
    typeof decoded.email === 'string' && decoded.email.includes('@') && decoded.email_verified
      ? decoded.email.trim().toLowerCase()
      : null;

  const phoneNumber =
    typeof decoded.phone_number === 'string' && decoded.phone_number.trim()
      ? decoded.phone_number.trim()
      : null;

  if (!verifiedEmail && !phoneNumber) {
    res.status(400).json({ error: 'Verified email or verified phone number is required to sign in.' });
    return;
  }

  const customName = typeof displayName === 'string' ? displayName.trim().slice(0, 80) : '';
  const tokenName = typeof decoded.name === 'string' ? decoded.name.trim().slice(0, 80) : '';
  const fallbackName = verifiedEmail
    ? verifiedEmail.split('@')[0].slice(0, 40)
    : phoneNumber
    ? `ECHO Member ••••${phoneNumber.slice(-4)}`
    : 'ECHO Member';
  const resolvedDisplayName =
    tokenName.length >= 2 ? tokenName : customName.length >= 2 ? customName : fallbackName;

  const tz = typeof timezone === 'string' && timezone.length <= 60 ? timezone : 'UTC';
  const cleanTheme = sanitizeTheme(theme, 'social');
  const now = new Date().toISOString();

  let userRow = db.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(uid) as
    | Record<string, unknown>
    | undefined;
  let isNewUser = false;

  if (!userRow && verifiedEmail) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(verifiedEmail) as
      | Record<string, unknown>
      | undefined;
    if (byEmail) {
      if (byEmail.firebase_uid && String(byEmail.firebase_uid) !== uid) {
        res.status(409).json({ error: 'This email is already linked to another sign-in identity.' });
        return;
      }
      userRow = byEmail;
    }
  }

  if (!userRow && phoneNumber) {
    const byPhone = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(phoneNumber) as
      | Record<string, unknown>
      | undefined;
    if (byPhone) {
      if (byPhone.firebase_uid && String(byPhone.firebase_uid) !== uid) {
        res.status(409).json({ error: 'This phone number is already linked to another account.' });
        return;
      }
      userRow = byPhone;
    }
  }

  if (userRow) {
    const nextPhone = userRow.phone_number ? String(userRow.phone_number) : phoneNumber;
    const nextEmail =
      String(userRow.email).endsWith('@phone.echo.local') && verifiedEmail
        ? verifiedEmail
        : String(userRow.email);
    const nextName =
      customName.length >= 2 && String(userRow.display_name).startsWith('ECHO Member')
        ? customName
        : String(userRow.display_name);

    db.prepare(`
      UPDATE users
      SET firebase_uid = ?, phone_number = ?, email = ?, display_name = ?, updated_at = ?
      WHERE id = ?
    `).run(uid, nextPhone, nextEmail, nextName, now, String(userRow.id));

    userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(String(userRow.id)) as Record<string, unknown>;
  } else {
    isNewUser = true;
    const userId = newId('usr');
    const syntheticEmail = `phone.${crypto.createHash('sha256').update(uid).digest('hex').slice(0, 12)}@phone.echo.local`;
    const emailToStore = verifiedEmail || syntheticEmail;
    const sentinelHash = `firebase:${uid}`;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO users (
          id, email, password_hash, display_name, phone_number, firebase_uid, auth_provider,
          timezone, theme, email_verified, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        userId,
        emailToStore,
        sentinelHash,
        resolvedDisplayName,
        phoneNumber,
        uid,
        authProvider,
        tz,
        cleanTheme,
        now,
        now
      );

      db.prepare(`
        INSERT INTO skill_profiles (user_id, updated_at) VALUES (?, ?)
      `).run(userId, now);
    })();

    userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;

    createNotificationRecord(
      userId,
      'system',
      'Welcome to ECHO',
      'Your private archive is ready. Save your first memory, record a dream, or seal a message for your future self.',
      'memories'
    );
  }

  const label = deviceLabel || String(req.headers['user-agent'] || 'Web Browser').slice(0, 60);
  issueMfaChallengeOrSession(req, res, userRow, label, isNewUser ? 201 : 200);
});

authRouter.get('/auth/phone/status', (_req, res) => {
  res.json({
    serverSmsEnabled: false,
    mode: 'in_app',
  });
});

authRouter.post('/auth/phone/send-otp', rateLimit('phone-otp-send', 10, 60_000), (req, res) => {
  const { phoneNumber } = req.body as { phoneNumber?: string };
  const cleanPhone = typeof phoneNumber === 'string' ? phoneNumber.trim() : '';
  if (!/^\+[1-9]\d{6,14}$/.test(cleanPhone)) {
    res.status(400).json({ error: 'Enter a valid international phone number in E.164 format (e.g. +919876543210).' });
    return;
  }

  const existingOtp = db
    .prepare('SELECT last_sent_at FROM phone_otps WHERE phone_number = ?')
    .get(cleanPhone) as { last_sent_at: string } | undefined;

  if (existingOtp && Date.now() - Date.parse(existingOtp.last_sent_at) < 30_000) {
    res.status(429).json({ error: 'Please wait 30 seconds before requesting another OTP code.' });
    return;
  }

  const existingUser = db
    .prepare('SELECT id, password_hash FROM users WHERE phone_number = ?')
    .get(cleanPhone) as { id: string; password_hash: string } | undefined;

  if (existingUser && !String(existingUser.password_hash).startsWith('scrypt:')) {
    const provider = String((db.prepare('SELECT auth_provider FROM users WHERE id = ?').get(existingUser.id) as { auth_provider?: string } | undefined)?.auth_provider || '');
    res.status(403).json({
      error:
        provider === 'phone_email'
          ? 'This phone number uses Phone.Email OTP verification. Please use the Sign in with Phone button below.'
          : 'This phone number is linked to Google / Firebase verification. Please sign in with Google.',
    });
    return;
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  const otpHash = crypto.createHash('sha256').update(`${salt}:${otp}`).digest('hex');

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();

  db.prepare(`
    INSERT INTO phone_otps (phone_number, otp_hash, salt, attempts, expires_at, last_sent_at, created_at)
    VALUES (?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(phone_number) DO UPDATE SET
      otp_hash = excluded.otp_hash,
      salt = excluded.salt,
      attempts = 0,
      expires_at = excluded.expires_at,
      last_sent_at = excluded.last_sent_at
  `).run(cleanPhone, otpHash, salt, expiresAt, nowIso, nowIso);

  res.json({
    ok: true,
    delivery: 'in_app',
    previewOtp: otp,
    requiresPin: true,
    isExistingAccount: Boolean(existingUser),
    expiresInSeconds: 300,
  });
});

authRouter.post('/auth/phone/verify-otp', rateLimit('phone-otp-verify', 15, 60_000), (req, res) => {
  const { phoneNumber, code, pin, displayName, timezone, theme, deviceLabel } = req.body as {
    phoneNumber?: string;
    code?: string;
    pin?: string;
    displayName?: string;
    timezone?: string;
    theme?: string;
    deviceLabel?: string;
  };

  const cleanPhone = typeof phoneNumber === 'string' ? phoneNumber.trim() : '';
  const cleanCode = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  const cleanPin = typeof pin === 'string' ? pin.trim() : '';

  if (!/^\+[1-9]\d{6,14}$/.test(cleanPhone) || !/^\d{6}$/.test(cleanCode)) {
    res.status(400).json({ error: 'Valid phone number and 6-digit OTP code are required.' });
    return;
  }

  if (cleanPin.length < 4 || cleanPin.length > 24) {
    res.status(400).json({ error: 'A Security PIN (4 to 24 characters) is required to protect your phone account.' });
    return;
  }

  const customName = typeof displayName === 'string' ? displayName.trim().slice(0, 80) : '';
  const tz = typeof timezone === 'string' && timezone.length <= 60 ? timezone : 'UTC';
  const cleanTheme = sanitizeTheme(theme, 'social');
  const nowIso = new Date().toISOString();

  type VerifyResult =
    | { ok: true; userRow: Record<string, unknown>; isNewUser: boolean }
    | { ok: false; status: number; error: string };

  const outcome: VerifyResult = db.transaction((): VerifyResult => {
    const otpRow = db
      .prepare('SELECT otp_hash, salt, attempts, expires_at FROM phone_otps WHERE phone_number = ?')
      .get(cleanPhone) as
      | { otp_hash: string; salt: string; attempts: number; expires_at: string }
      | undefined;

    if (!otpRow || Date.parse(otpRow.expires_at) <= Date.now()) {
      db.prepare('DELETE FROM phone_otps WHERE phone_number = ?').run(cleanPhone);
      return { ok: false, status: 400, error: 'OTP code expired or not found. Please request a new code.' };
    }

    if (otpRow.attempts >= 5) {
      db.prepare('DELETE FROM phone_otps WHERE phone_number = ?').run(cleanPhone);
      return { ok: false, status: 429, error: 'Too many invalid attempts. Please request a new OTP code.' };
    }

    const candidateBuf = crypto.createHash('sha256').update(`${otpRow.salt}:${cleanCode}`).digest();
    const storedBuf = Buffer.from(otpRow.otp_hash, 'hex');
    const otpMatches = candidateBuf.length === storedBuf.length && crypto.timingSafeEqual(candidateBuf, storedBuf);

    if (!otpMatches) {
      db.prepare('UPDATE phone_otps SET attempts = attempts + 1 WHERE phone_number = ?').run(cleanPhone);
      return { ok: false, status: 401, error: 'Incorrect 6-digit OTP code. Please check and try again.' };
    }

    let userRow = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(cleanPhone) as
      | Record<string, unknown>
      | undefined;

    if (userRow) {
      const storedHash = String(userRow.password_hash || '');
      if (!storedHash.startsWith('scrypt:')) {
        const provider = String(userRow.auth_provider || '');
        return {
          ok: false,
          status: 403,
          error:
            provider === 'phone_email'
              ? 'This phone number uses Phone.Email OTP verification. Please use the Sign in with Phone button below.'
              : 'This phone number is linked to Google / Firebase verification. Please sign in with Google.',
        };
      }
      if (!verifyPassword(cleanPin, storedHash)) {
        db.prepare('UPDATE phone_otps SET attempts = attempts + 1 WHERE phone_number = ?').run(cleanPhone);
        return { ok: false, status: 401, error: 'Incorrect Security PIN for this phone number.' };
      }
    }

    const consumed = db.prepare('DELETE FROM phone_otps WHERE phone_number = ?').run(cleanPhone);
    if (consumed.changes === 0) {
      return { ok: false, status: 400, error: 'OTP code was already used. Please request a new code.' };
    }

    let isNewUser = false;
    if (userRow) {
      if (customName.length >= 2 && String(userRow.display_name).startsWith('ECHO Member')) {
        db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(
          customName,
          nowIso,
          String(userRow.id)
        );
        userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(String(userRow.id)) as Record<string, unknown>;
      }
    } else {
      isNewUser = true;
      const userId = newId('usr');
      const phoneHash = crypto.createHash('sha256').update(`phone:${cleanPhone}`).digest('hex').slice(0, 12);
      const syntheticEmail = `phone.${phoneHash}@phone.echo.local`;
      const resolvedName = customName.length >= 2 ? customName : `ECHO Member ••••${cleanPhone.slice(-4)}`;
      const storedPasswordHash = hashPassword(cleanPin);

      db.prepare(`
        INSERT INTO users (
          id, email, password_hash, display_name, phone_number, auth_provider,
          timezone, theme, email_verified, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'phone', ?, ?, 1, ?, ?)
      `).run(userId, syntheticEmail, storedPasswordHash, resolvedName, cleanPhone, tz, cleanTheme, nowIso, nowIso);

      db.prepare('INSERT INTO skill_profiles (user_id, updated_at) VALUES (?, ?)').run(userId, nowIso);

      userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
    }

    return { ok: true, userRow, isNewUser };
  })();

  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  if (outcome.isNewUser) {
    createNotificationRecord(
      String(outcome.userRow.id),
      'system',
      'Welcome to ECHO',
      'Your private archive is ready. Save your first memory, record a dream, or seal a message for your future self.',
      'memories'
    );
  }

  const label = deviceLabel || String(req.headers['user-agent'] || 'Web Browser').slice(0, 60);
  issueMfaChallengeOrSession(req, res, outcome.userRow, label, outcome.isNewUser ? 201 : 200);
});

function validatePhoneEmailJsonUrl(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return null;
  }
  if (parsed.port && parsed.port !== '443') {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const isAllowedHost = host === 'user.phone.email' || (host.endsWith('.phone.email') && host.length > '.phone.email'.length);
  if (!isAllowedHost || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    return null;
  }
  if (!parsed.pathname || parsed.pathname === '/') {
    return null;
  }
  return parsed;
}

authRouter.post('/auth/phone/email-verify', rateLimit('phone-email-verify', 15, 60_000), async (req, res) => {
  const { userJsonUrl, displayName, timezone, theme, deviceLabel } = req.body as {
    userJsonUrl?: string;
    displayName?: string;
    timezone?: string;
    theme?: string;
    deviceLabel?: string;
  };

  const validatedUrl = validatePhoneEmailJsonUrl(userJsonUrl);
  if (!validatedUrl) {
    res.status(400).json({ error: 'A valid Phone.Email verification URL is required.' });
    return;
  }

  let payload: {
    user_country_code?: unknown;
    user_phone_number?: unknown;
    user_first_name?: unknown;
    user_last_name?: unknown;
  };

  try {
    const response = await fetch(validatedUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      res.status(401).json({ error: 'Phone verification could not be confirmed by Phone.Email.' });
      return;
    }
    payload = (await response.json()) as typeof payload;
  } catch {
    res.status(502).json({ error: 'Unable to retrieve verified phone details from Phone.Email.' });
    return;
  }

  const countryDigits = String(payload?.user_country_code || '').replace(/\D/g, '');
  const phoneDigits = String(payload?.user_phone_number || '').replace(/\D/g, '');
  const combinedPhone = `+${countryDigits}${phoneDigits}`;
  if (!countryDigits || !phoneDigits || !/^\+[1-9]\d{6,14}$/.test(combinedPhone)) {
    res.status(400).json({ error: 'Verified phone payload did not include a valid phone number.' });
    return;
  }

  const firstName = typeof payload?.user_first_name === 'string' ? payload.user_first_name.trim() : '';
  const lastName = typeof payload?.user_last_name === 'string' ? payload.user_last_name.trim() : '';
  const verifiedName = [firstName, lastName].filter(Boolean).join(' ').trim().slice(0, 80);
  const customName = typeof displayName === 'string' ? displayName.trim().slice(0, 80) : '';
  const resolvedName =
    verifiedName.length >= 2
      ? verifiedName
      : customName.length >= 2
      ? customName
      : `ECHO Member ••••${combinedPhone.slice(-4)}`;

  const tz = typeof timezone === 'string' && timezone.length <= 60 ? timezone : 'UTC';
  const cleanTheme = sanitizeTheme(theme, 'social');
  const nowIso = new Date().toISOString();

  let userRow = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(combinedPhone) as
    | Record<string, unknown>
    | undefined;
  let isNewUser = false;

  if (userRow) {
    const currentName = String(userRow.display_name || '');
    if (currentName.startsWith('ECHO Member') && resolvedName !== currentName && !resolvedName.startsWith('ECHO Member')) {
      db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(
        resolvedName,
        nowIso,
        String(userRow.id)
      );
      userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(String(userRow.id)) as Record<string, unknown>;
    }
  } else {
    isNewUser = true;
    const userId = newId('usr');
    const phoneHash = crypto.createHash('sha256').update(`phone-email:${combinedPhone}`).digest('hex').slice(0, 12);
    const syntheticEmail = `phone.${phoneHash}@phone.echo.local`;
    const sentinelHash = `phone-email:${userId}`;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO users (
          id, email, password_hash, display_name, phone_number, auth_provider,
          timezone, theme, email_verified, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'phone_email', ?, ?, 1, ?, ?)
      `).run(userId, syntheticEmail, sentinelHash, resolvedName, combinedPhone, tz, cleanTheme, nowIso, nowIso);

      db.prepare('INSERT INTO skill_profiles (user_id, updated_at) VALUES (?, ?)').run(userId, nowIso);
    })();

    userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;

    createNotificationRecord(
      userId,
      'system',
      'Welcome to ECHO',
      'Your private archive is ready. Save your first memory, record a dream, or seal a message for your future self.',
      'memories'
    );
  }

  const label = deviceLabel || String(req.headers['user-agent'] || 'Web Browser').slice(0, 60);
  issueMfaChallengeOrSession(req, res, userRow, label, isNewUser ? 201 : 200);
});

// ==================== TOTP MULTI-FACTOR AUTHENTICATION ====================

authRouter.post('/auth/mfa/totp/challenge', rateLimit('mfa-challenge', 20, 60_000), (req, res) => {
  const { challengeToken, code, deviceLabel } = req.body as {
    challengeToken?: string;
    code?: string;
    deviceLabel?: string;
  };

  const rawChallenge = typeof challengeToken === 'string' ? challengeToken.trim() : '';
  const cleanCode = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  if (!rawChallenge || !/^\d{6}$/.test(cleanCode)) {
    res.status(400).json({ error: 'Valid challenge token and 6-digit authenticator code are required.' });
    return;
  }

  const tokenHash = hashSessionToken(rawChallenge);
  type ChallengeResult =
    | { ok: true; userRow: Record<string, unknown>; label: string }
    | { ok: false; status: number; error: string };

  const outcome: ChallengeResult = db.transaction((): ChallengeResult => {
    const challenge = db
      .prepare('SELECT token_hash, user_id, device_label, attempts, expires_at FROM mfa_challenges WHERE token_hash = ?')
      .get(tokenHash) as
      | { token_hash: string; user_id: string; device_label: string; attempts: number; expires_at: string }
      | undefined;

    if (!challenge || Date.parse(challenge.expires_at) <= Date.now()) {
      db.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?').run(tokenHash);
      return { ok: false, status: 401, error: 'Sign-in verification expired. Please sign in again.' };
    }

    if (challenge.attempts >= 5) {
      db.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?').run(tokenHash);
      return { ok: false, status: 429, error: 'Too many invalid authenticator codes. Please sign in again.' };
    }

    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(challenge.user_id) as
      | Record<string, unknown>
      | undefined;

    if (!userRow || !userRow.totp_enabled || !userRow.totp_secret) {
      db.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?').run(tokenHash);
      return { ok: false, status: 400, error: 'Authenticator MFA is not active on this account.' };
    }

    const lastStep =
      userRow.totp_last_step !== null && userRow.totp_last_step !== undefined
        ? Number(userRow.totp_last_step)
        : null;

    const check = verifyTotpCode(String(userRow.totp_secret), cleanCode, {
      adjacentIntervals: 2,
      lastAcceptedStep: lastStep,
    });

    if (!check.valid || check.matchedStep === null) {
      const nextAttempts = challenge.attempts + 1;
      if (nextAttempts >= 5) {
        db.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?').run(tokenHash);
      } else {
        db.prepare('UPDATE mfa_challenges SET attempts = ? WHERE token_hash = ?').run(nextAttempts, tokenHash);
      }
      return { ok: false, status: 401, error: 'Invalid or already used 6-digit authenticator code.' };
    }

    db.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?').run(tokenHash);
    db.prepare('UPDATE users SET totp_last_step = ?, updated_at = ? WHERE id = ?').run(
      check.matchedStep,
      new Date().toISOString(),
      challenge.user_id
    );

    const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(challenge.user_id) as Record<string, unknown>;
    return {
      ok: true,
      userRow: refreshed,
      label: deviceLabel || challenge.device_label || String(req.headers['user-agent'] || 'Web Browser').slice(0, 60),
    };
  })();

  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  const { token } = createSession(String(outcome.userRow.id), outcome.label);
  setSessionCookie(req, res, token);
  res.json({
    user: rowToAuthUser(outcome.userRow),
    token,
  });
});

authRouter.post('/auth/mfa/totp/setup', requireAuth, rateLimit('mfa-setup', 15, 60_000), async (req: AuthenticatedRequest, res) => {
  const { currentPassword, currentCode } = req.body as {
    currentPassword?: string;
    currentCode?: string;
  };

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.authUser!.id) as
    | Record<string, unknown>
    | undefined;
  if (!userRow) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }

  const passwordHash = String(userRow.password_hash || '');
  const provider = String(userRow.auth_provider || 'email');
  if (provider === 'email' && passwordHash.startsWith('scrypt:')) {
    if (!currentPassword || !verifyPassword(currentPassword, passwordHash)) {
      res.status(401).json({ error: 'Enter your current password to configure authenticator MFA.' });
      return;
    }
  }

  if (Boolean(userRow.totp_enabled) && Boolean(userRow.totp_secret)) {
    const cleanCurrent = typeof currentCode === 'string' ? currentCode.replace(/\D/g, '') : '';
    const lastStep =
      userRow.totp_last_step !== null && userRow.totp_last_step !== undefined
        ? Number(userRow.totp_last_step)
        : null;
    const verified = verifyTotpCode(String(userRow.totp_secret), cleanCurrent, {
      adjacentIntervals: 2,
      lastAcceptedStep: lastStep,
    });
    if (!verified.valid) {
      res.status(401).json({ error: 'Enter a valid 6-digit code from your existing authenticator before rotating keys.' });
      return;
    }
  }

  const secret = generateBase32Secret(20);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  db.prepare(`
    INSERT INTO totp_pending_setups (user_id, secret, expires_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      secret = excluded.secret,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `).run(req.authUser!.id, secret, expiresAt, now.toISOString());

  const emailStr = String(userRow.email || '');
  const accountLabel =
    emailStr && !emailStr.endsWith('@phone.echo.local')
      ? emailStr
      : String(userRow.phone_number || userRow.display_name || 'ECHO Member');
  const totpUri = buildTotpUri({ accountName: accountLabel, issuer: 'ECHO', secret });

  try {
    const qrDataUrl = await QRCode.toDataURL(totpUri, { width: 240, margin: 2 });
    res.json({
      secret,
      totpUri,
      qrDataUrl,
      accountLabel,
      expiresInSeconds: 600,
    });
  } catch {
    res.status(500).json({ error: 'Unable to generate authenticator QR code.' });
  }
});

authRouter.post('/auth/mfa/totp/verify-enroll', requireAuth, rateLimit('mfa-enroll', 15, 60_000), (req: AuthenticatedRequest, res) => {
  const { code, displayName } = req.body as {
    code?: string;
    displayName?: string;
  };
  const cleanCode = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  if (!/^\d{6}$/.test(cleanCode)) {
    res.status(400).json({ error: 'Enter the 6-digit verification code from your authenticator app.' });
    return;
  }

  const label =
    typeof displayName === 'string' && displayName.trim().length >= 2
      ? displayName.trim().slice(0, 60)
      : 'Authenticator App';

  const pending = db
    .prepare('SELECT secret, expires_at FROM totp_pending_setups WHERE user_id = ?')
    .get(req.authUser!.id) as { secret: string; expires_at: string } | undefined;

  if (!pending || Date.parse(pending.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM totp_pending_setups WHERE user_id = ?').run(req.authUser!.id);
    res.status(400).json({ error: 'Authenticator setup expired. Please generate a new QR code.' });
    return;
  }

  const check = verifyTotpCode(pending.secret, cleanCode, { adjacentIntervals: 2 });
  if (!check.valid || check.matchedStep === null) {
    res.status(400).json({ error: 'Invalid 6-digit code. Check your authenticator app and try again.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET totp_secret = ?, totp_enabled = 1, totp_display_name = ?, totp_enrolled_at = ?, totp_last_step = ?, updated_at = ?
      WHERE id = ?
    `).run(pending.secret, label, nowIso, check.matchedStep, nowIso, req.authUser!.id);
    db.prepare('DELETE FROM totp_pending_setups WHERE user_id = ?').run(req.authUser!.id);
  })();

  createNotificationRecord(
    req.authUser!.id,
    'security',
    'Authenticator MFA enabled',
    `Two-factor authentication (${label}) is now protecting your ECHO archive.`,
    'profile'
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.authUser!.id) as Record<string, unknown>;
  res.json({ user: rowToAuthUser(updated) });
});

authRouter.post('/auth/mfa/totp/unenroll', requireAuth, rateLimit('mfa-unenroll', 15, 60_000), (req: AuthenticatedRequest, res) => {
  const { currentPassword, code } = req.body as {
    currentPassword?: string;
    code?: string;
  };

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.authUser!.id) as
    | Record<string, unknown>
    | undefined;
  if (!userRow) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }

  if (!userRow.totp_enabled || !userRow.totp_secret) {
    res.json({ user: rowToAuthUser(userRow) });
    return;
  }

  const cleanCode = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  const lastStep =
    userRow.totp_last_step !== null && userRow.totp_last_step !== undefined
      ? Number(userRow.totp_last_step)
      : null;
  const codeVerified = /^\d{6}$/.test(cleanCode)
    ? verifyTotpCode(String(userRow.totp_secret), cleanCode, {
        adjacentIntervals: 2,
        lastAcceptedStep: lastStep,
      }).valid
    : false;

  const passwordHash = String(userRow.password_hash || '');
  const passwordVerified =
    Boolean(currentPassword) && passwordHash.startsWith('scrypt:') && verifyPassword(currentPassword!, passwordHash);

  if (!codeVerified && !passwordVerified) {
    res.status(401).json({
      error: passwordHash.startsWith('scrypt:')
        ? 'Enter your 6-digit authenticator code or current password to disable two-factor authentication.'
        : 'Enter your current 6-digit authenticator code to disable two-factor authentication.',
    });
    return;
  }

  const currentHash = req.authToken ? hashSessionToken(req.authToken) : '';
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET totp_secret = NULL, totp_enabled = 0, totp_display_name = '', totp_enrolled_at = NULL, totp_last_step = NULL, updated_at = ?
      WHERE id = ?
    `).run(nowIso, req.authUser!.id);
    if (currentHash) {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.authUser!.id, currentHash);
    }
  })();

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.authUser!.id) as Record<string, unknown>;
  res.json({ user: rowToAuthUser(updated) });
});

authRouter.post('/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.authToken) {
    const tokenHash = hashSessionToken(req.authToken);
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

authRouter.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.authUser });
});

authRouter.get('/auth/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
  const currentHash = req.authToken ? hashSessionToken(req.authToken) : '';
  const rows = db
    .prepare('SELECT id, token_hash, device_label, expires_at, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.authUser!.id) as Array<Record<string, unknown>>;

  res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      deviceLabel: r.device_label,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      isCurrent: r.token_hash === currentHash,
    })),
  });
});

authRouter.delete('/auth/sessions/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const result = db
    .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.authUser!.id);
  res.json({ deleted: result.changes > 0 });
});

authRouter.post('/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'Current password and a new password (8+ chars) are required.' });
    return;
  }

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.authUser!.id) as
    | { password_hash: string }
    | undefined;
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPassword),
    new Date().toISOString(),
    req.authUser!.id
  );
  res.json({ ok: true });
});

authRouter.post('/auth/request-reset', rateLimit('reset', 10, 60_000), (req, res) => {
  const { email } = req.body as { email?: string };
  const cleanEmail = (email || '').trim().toLowerCase();
  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(cleanEmail) as
    | { id: string; password_hash: string }
    | undefined;

  // Always respond gracefully; issue reset code only for valid user accounts
  if (!user || !user.password_hash.startsWith('scrypt:')) {
    res.json({ ok: true, message: 'If that account exists, a reset code has been generated.' });
    return;
  }

  const rawCode = crypto.randomBytes(16).toString('hex');
  const tokenHash = hashSessionToken(rawCode);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 30).toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO password_resets (token_hash, user_id, expires_at, used, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(tokenHash, user.id, expiresAt, now.toISOString());

  res.json({
    ok: true,
    message: 'Reset token issued (valid for 30 minutes).',
    resetToken: rawCode,
  });
});

authRouter.post('/auth/confirm-reset', rateLimit('reset', 10, 60_000), (req, res) => {
  const { resetToken, newPassword } = req.body as { resetToken?: string; newPassword?: string };
  if (!resetToken || !newPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'Valid reset token and new password (8+ chars) are required.' });
    return;
  }

  const tokenHash = hashSessionToken(resetToken.trim());
  const row = db
    .prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0')
    .get(tokenHash) as { user_id: string; expires_at: string } | undefined;

  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    res.status(400).json({ error: 'Reset token is invalid or expired.' });
    return;
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(newPassword),
      new Date().toISOString(),
      row.user_id
    );
    db.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').run(tokenHash);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
  })();

  res.json({ ok: true });
});

authRouter.put('/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const { displayName, bio, avatarMediaId, locationHint, timezone, theme, aiConsent, notificationPrefs } = req.body as {
    displayName?: string;
    bio?: string;
    avatarMediaId?: string | null;
    locationHint?: string;
    timezone?: string;
    theme?: string;
    aiConsent?: boolean;
    notificationPrefs?: Record<string, boolean>;
  };

  const user = req.authUser!;
  const cleanName = typeof displayName === 'string' && displayName.trim().length >= 2 ? displayName.trim().slice(0, 80) : user.displayName;
  const cleanBio = typeof bio === 'string' ? bio.slice(0, 500) : user.bio;
  const cleanLocation = typeof locationHint === 'string' ? locationHint.slice(0, 100) : user.locationHint;
  const cleanTz = typeof timezone === 'string' ? timezone.slice(0, 60) : user.timezone;
  const cleanTheme = theme !== undefined ? sanitizeTheme(theme, user.theme) : user.theme;
  const cleanAiConsent = typeof aiConsent === 'boolean' ? (aiConsent ? 1 : 0) : user.aiConsent ? 1 : 0;
  const cleanPrefs = notificationPrefs ? JSON.stringify(notificationPrefs) : JSON.stringify(user.notificationPrefs);

  let verifiedAvatar = user.avatarMediaId;
  if (avatarMediaId !== undefined) {
    if (avatarMediaId === null) {
      verifiedAvatar = null;
    } else {
      const ownMedia = db
        .prepare('SELECT id FROM media_files WHERE id = ? AND user_id = ?')
        .get(avatarMediaId, user.id);
      if (ownMedia) verifiedAvatar = avatarMediaId;
    }
  }

  db.prepare(`
    UPDATE users
    SET display_name = ?, bio = ?, avatar_media_id = ?, location_hint = ?, timezone = ?, theme = ?, ai_consent = ?, notification_prefs_json = ?, updated_at = ?
    WHERE id = ?
  `).run(cleanName, cleanBio, verifiedAvatar, cleanLocation, cleanTz, cleanTheme, cleanAiConsent, cleanPrefs, new Date().toISOString(), user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as Record<string, unknown>;
  res.json({ user: rowToAuthUser(updated) });
});

authRouter.get('/export', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const nowIso = new Date().toISOString();

  const memories = db.prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY memory_date DESC').all(userId);
  const collections = db.prepare('SELECT * FROM memory_collections WHERE user_id = ?').all(userId);
  const dreams = db.prepare('SELECT * FROM dreams WHERE user_id = ? ORDER BY dream_date DESC').all(userId);
  const objects = db.prepare('SELECT * FROM objects WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  // Export only unlocked capsules or capsules whose unlock date has arrived
  const capsules = db
    .prepare('SELECT id, title, capsule_type, unlock_at, unlock_occasion, is_locked, created_at, CASE WHEN is_locked = 0 OR unlock_at <= ? THEN message ELSE NULL END AS message FROM time_capsules WHERE user_id = ?')
    .all(nowIso, userId);

  res.setHeader('Content-Disposition', `attachment; filename="echo-archive-${nowIso.slice(0, 10)}.json"`);
  res.json({
    exportedAt: nowIso,
    account: req.authUser,
    collections,
    memories,
    capsules,
    objects,
    dreams,
  });
});

authRouter.delete('/account', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const files = db.prepare('SELECT stored_name FROM media_files WHERE user_id = ?').all(userId) as Array<{ stored_name: string }>;

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  for (const f of files) {
    const full = path.resolve(UPLOADS_DIR, path.basename(f.stored_name));
    if (full.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(full)) {
      fs.unlinkSync(full);
    }
  }

  clearSessionCookie(req, res);
  res.json({ deleted: true });
});

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === value;
}

authRouter.get('/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const nowIso = new Date().toISOString();
  const rawLocalDate = typeof req.query.localDate === 'string' ? req.query.localDate.trim() : '';
  const localDate = isValidIsoDate(rawLocalDate) ? rawLocalDate : nowIso.slice(0, 10);
  const monthDay = localDate.slice(5, 10);
  const localYear = localDate.slice(0, 4);

  // Check and trigger due capsule unlock notifications
  const dueCapsules = db
    .prepare('SELECT id, title, unlock_at FROM time_capsules WHERE user_id = ? AND is_locked = 1 AND unlock_at <= ? AND unlocked_notified = 0')
    .all(userId, nowIso) as Array<{ id: string; title: string; unlock_at: string }>;

  const markNotifiedStmt = db.prepare('UPDATE time_capsules SET unlocked_notified = 1 WHERE id = ? AND unlocked_notified = 0');
  for (const cap of dueCapsules) {
    const upd = markNotifiedStmt.run(cap.id);
    if (upd.changes !== 1) continue;
    createNotificationRecord(
      userId,
      'capsule_unlock',
      'A Time Capsule has unlocked',
      `"${cap.title}" is now ready to open.`,
      'capsules',
      cap.id
    );
  }

  const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE user_id = ?').get(userId) as { c: number }).c;
  const dreamCount = (db.prepare('SELECT COUNT(*) as c FROM dreams WHERE user_id = ?').get(userId) as { c: number }).c;
  const objectCount = (db.prepare('SELECT COUNT(*) as c FROM objects WHERE user_id = ?').get(userId) as { c: number }).c;
  const capsuleCount = (db.prepare('SELECT COUNT(*) as c FROM time_capsules WHERE user_id = ?').get(userId) as { c: number }).c;

  const recentMemories = db
    .prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY memory_date DESC, created_at DESC LIMIT 4')
    .all(userId);

  const featuredMemory =
    db
      .prepare('SELECT * FROM memories WHERE user_id = ? AND is_favorite = 1 ORDER BY memory_date DESC LIMIT 1')
      .get(userId) || recentMemories[0] || null;

  const onThisDay = db
    .prepare("SELECT * FROM memories WHERE user_id = ? AND substr(memory_date, 6, 5) = ? AND substr(memory_date, 1, 4) != ? ORDER BY memory_date DESC LIMIT 3")
    .all(userId, monthDay, localYear);

  const nextCapsule = db
    .prepare('SELECT id, title, capsule_type, unlock_occasion, unlock_at, is_locked, opened_at FROM time_capsules WHERE user_id = ? AND is_locked = 1 AND unlock_at > ? ORDER BY unlock_at ASC LIMIT 1')
    .get(userId, nowIso) || null;

  const readyCapsules = (db
    .prepare('SELECT COUNT(*) as c FROM time_capsules WHERE user_id = ? AND is_locked = 1 AND unlock_at <= ? AND opened_at IS NULL')
    .get(userId, nowIso) as { c: number }).c;

  const checkInRows = db
    .prepare(`
      SELECT m.id, m.title, m.content, m.mood, m.memory_date, m.created_at,
        m.sentiment_tone, m.emotional_impact, m.sentiment_score, m.sentiment_rationale, m.ai_excluded
      FROM memories m
      WHERE m.user_id = ?
        AND EXISTS (
          SELECT 1 FROM memory_tags mt
          WHERE mt.memory_id = m.id AND LOWER(mt.tag) = 'daily-checkin'
        )
      ORDER BY m.memory_date DESC, m.created_at DESC
    `)
    .all(userId) as Array<{
    id: string;
    title: string;
    content: string;
    mood: string;
    memory_date: string;
    created_at: string;
    sentiment_tone: string;
    emotional_impact: string;
    sentiment_score: number | null;
    sentiment_rationale: string;
    ai_excluded: number;
  }>;

  const todayCheckInRow = checkInRows.find((r) => r.memory_date === localDate) || null;
  const checkInDateSet = new Set(checkInRows.map((r) => r.memory_date));
  const shiftIsoDate = (isoDate: string, deltaDays: number): string => {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
    return dt.toISOString().slice(0, 10);
  };
  let checkInStreak = 0;
  let cursorDate = checkInDateSet.has(localDate) ? localDate : shiftIsoDate(localDate, -1);
  while (checkInDateSet.has(cursorDate)) {
    checkInStreak += 1;
    cursorDate = shiftIsoDate(cursorDate, -1);
  }

  const thirtyDaysStart = shiftIsoDate(localDate, -29);
  const checkInHistory = checkInRows
    .filter((r) => r.memory_date >= thirtyDaysStart && r.memory_date <= localDate)
    .slice()
    .reverse()
    .map((r) => {
      const stripped = r.content.replace(/^Daily Check-In Prompt:\s*"[^"]*"\s*/i, '').trim();
      return {
        id: r.id,
        title: r.title,
        memoryDate: r.memory_date,
        mood: r.mood,
        sentimentTone: r.sentiment_tone || '',
        emotionalImpact: r.emotional_impact || '',
        sentimentScore: r.sentiment_score !== null && r.sentiment_score !== undefined ? Number(r.sentiment_score) : null,
        sentimentRationale: r.sentiment_rationale || '',
        aiExcluded: Boolean(r.ai_excluded),
        excerpt: stripped.slice(0, 140),
        createdAt: r.created_at,
      };
    });

  const humanityHighlights = db
    .prepare(`
      SELECT hp.id, hp.category, hp.title, hp.content, hp.approx_region, hp.created_at,
        (SELECT COUNT(*) FROM community_reactions cr WHERE cr.target_type = 'humanity' AND cr.target_id = hp.id AND cr.reaction_type = 'helpful') AS helpful_count
      FROM humanity_posts hp
      WHERE hp.author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
      ORDER BY hp.created_at DESC LIMIT 3
    `)
    .all(userId);

  const skillDiscovery = db
    .prepare(`
      SELECT sp.user_id, u.display_name, sp.teach_skills_json, sp.learn_skills_json, sp.mode, sp.location_city
      FROM skill_profiles sp
      JOIN users u ON u.id = sp.user_id
      WHERE sp.user_id != ?
        AND sp.user_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
      ORDER BY sp.updated_at DESC LIMIT 3
    `)
    .all(userId, userId);

  const unreadNotifications = (db
    .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(userId) as { c: number }).c;

  const monthlyRefRow = db
    .prepare(
      "SELECT summary, themes_json, emotional_arc, gentle_prompt, checkin_count, source_ids_json, generated_at FROM monthly_reflections WHERE user_id = ? AND period_key = 'last-30-days'"
    )
    .get(userId) as
    | {
        summary: string;
        themes_json: string;
        emotional_arc: string;
        gentle_prompt: string;
        checkin_count: number;
        source_ids_json: string;
        generated_at: string;
      }
    | undefined;

  let monthlyReflection: {
    periodKey: string;
    summary: string;
    themes: Array<{ name: string; insight: string; memoryIds: string[] }>;
    emotionalArc: string;
    gentlePrompt: string;
    checkInCount: number;
    sourceIds: string[];
    generatedAt: string;
  } | null = null;

  if (monthlyRefRow) {
    let parsedThemes: Array<{ name: string; insight: string; memoryIds: string[] }> = [];
    let parsedSourceIds: string[] = [];
    try {
      const t = JSON.parse(monthlyRefRow.themes_json || '[]');
      if (Array.isArray(t)) parsedThemes = t;
    } catch {
      parsedThemes = [];
    }
    try {
      const s = JSON.parse(monthlyRefRow.source_ids_json || '[]');
      if (Array.isArray(s)) parsedSourceIds = s;
    } catch {
      parsedSourceIds = [];
    }
    monthlyReflection = {
      periodKey: 'last-30-days',
      summary: monthlyRefRow.summary,
      themes: parsedThemes,
      emotionalArc: monthlyRefRow.emotional_arc,
      gentlePrompt: monthlyRefRow.gentle_prompt,
      checkInCount: monthlyRefRow.checkin_count,
      sourceIds: parsedSourceIds,
      generatedAt: monthlyRefRow.generated_at,
    };
  }

  res.json({
    stats: { memoryCount, dreamCount, objectCount, capsuleCount, readyCapsules, unreadNotifications },
    featuredMemory,
    recentMemories,
    onThisDay,
    nextCapsule,
    dailyCheckIn: {
      date: localDate,
      streak: checkInStreak,
      totalCheckIns: checkInRows.length,
      history: checkInHistory,
      monthlyReflection,
      todayEntry: todayCheckInRow
        ? {
            id: todayCheckInRow.id,
            title: todayCheckInRow.title,
            content: todayCheckInRow.content,
            mood: todayCheckInRow.mood,
            memoryDate: todayCheckInRow.memory_date,
            createdAt: todayCheckInRow.created_at,
          }
        : null,
    },
    humanityHighlights,
    skillDiscovery,
  });
});
