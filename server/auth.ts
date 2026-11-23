import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, newId } from './db.ts';

const EPHEMERAL_PEPPER = crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
export const SESSION_COOKIE_NAME = 'echo_session';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  bio: string;
  avatarMediaId: string | null;
  locationHint: string;
  timezone: string;
  theme: string;
  emailVerified: boolean;
  aiConsent: boolean;
  notificationPrefs: Record<string, boolean>;
  createdAt: string;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  authToken?: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt:')) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(`${rawToken}:${EPHEMERAL_PEPPER}`).digest('hex');
}

export function hashSessionToken(rawToken: string): string {
  // Persisted across server restarts using SHA-256 of the high-entropy random token
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function createSession(userId: string, deviceLabel = 'Web Browser'): { token: string; sessionId: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(token);
  const sessionId = newId('sess');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO sessions (token_hash, id, user_id, device_label, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tokenHash, sessionId, userId, deviceLabel.slice(0, 80), expiresAt, now.toISOString());

  return { token, sessionId, expiresAt };
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  return null;
}

export function rowToAuthUser(row: Record<string, unknown>): AuthUser {
  let notificationPrefs: Record<string, boolean> = {};
  try {
    notificationPrefs = JSON.parse(String(row.notification_prefs_json || '{}'));
  } catch {
    notificationPrefs = {};
  }
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    bio: String(row.bio ?? ''),
    avatarMediaId: row.avatar_media_id ? String(row.avatar_media_id) : null,
    locationHint: String(row.location_hint ?? ''),
    timezone: String(row.timezone ?? 'UTC'),
    theme: typeof row.theme === 'string' && row.theme ? row.theme : 'social',
    emailVerified: Boolean(row.email_verified),
    aiConsent: Boolean(row.ai_consent),
    notificationPrefs,
    createdAt: String(row.created_at),
  };
}

export function getUserFromToken(token: string | null): AuthUser | null {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const row = db
    .prepare(`
      SELECT u.*, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `)
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!row) return null;
  if (Date.parse(String(row.expires_at)) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return rowToAuthUser(row);
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const user = getUserFromToken(token);
  if (!user || !token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  // CSRF defense for cookie-based mutations when Bearer header is absent
  const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
  if (!hasBearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const requestedWith = req.headers['x-requested-with'];
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const originMatchesHost =
      origin &&
      host &&
      (() => {
        try {
          return new URL(origin).host === String(host);
        } catch {
          return false;
        }
      })();

    if (requestedWith !== 'ECHO' && !originMatchesHost) {
      res.status(403).json({ error: 'CSRF check failed.' });
      return;
    }
  }

  req.authUser = user;
  req.authToken = token;
  next();
}

export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const user = getUserFromToken(token);
  if (user && token) {
    req.authUser = user;
    req.authToken = token;
  }
  next();
}

// Simple in-memory sliding window rate limiter
const rateBuckets = new Map<string, number[]>();

export function rateLimit(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const identity = req.authUser?.id || req.ip || 'anon';
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    const recent = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      res.status(429).json({ error: 'Rate limit exceeded. Please pause briefly and try again.' });
      return;
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    next();
  };
}
