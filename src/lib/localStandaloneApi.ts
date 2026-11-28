import QRCode from 'qrcode';
import type {
  AiChatMessage,
  AiSource,
  AuthUser,
  DreamItem,
  EchoObject,
  ExchangeMessage,
  HumanityPost,
  MediaMeta,
  MemoryCollection,
  MemoryItem,
  NotificationItem,
  SearchResult,
  SkillExchange,
  SkillProfile,
  TimeCapsuleItem,
  WisdomPost,
} from '../types/echo';
import type { EchoThemeId } from './themes';

const REGION_COORDS: Record<string, { lat: number; lng: number }> = {
  'North America': { lat: 41.8, lng: -87.6 },
  'South America': { lat: -12.0, lng: -60.0 },
  'Western Europe': { lat: 48.8, lng: 2.3 },
  'Eastern Europe': { lat: 50.4, lng: 30.5 },
  'Middle East & North Africa': { lat: 30.0, lng: 31.2 },
  'Sub-Saharan Africa': { lat: -1.2, lng: 36.8 },
  'South Asia': { lat: 21.1, lng: 79.0 },
  'East Asia': { lat: 35.6, lng: 139.7 },
  'Southeast Asia': { lat: 13.7, lng: 100.5 },
  Oceania: { lat: -33.8, lng: 151.2 },
  Global: { lat: 20.0, lng: 0.0 },
};

interface StoredSession {
  id: string;
  token: string;
  userId: string;
  deviceLabel: string;
  createdAt: string;
}

interface StoredUser extends AuthUser {
  passwordHash: string;
  totpSecret?: string | null;
  totpLastStep?: number | null;
}

interface StoredMedia {
  id: string;
  userId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  transcript?: string;
  createdAt: string;
}

interface StandaloneDb {
  users: StoredUser[];
  sessions: StoredSession[];
  currentToken: string | null;
  totpPendingSetups?: Record<string, { secret: string; expiresAt: number }>;
  mfaChallenges?: Record<string, { userId: string; deviceLabel: string; attempts: number; expiresAt: number }>;
  memories: Array<MemoryItem & { userId: string }>;
  collections: Array<MemoryCollection & { userId: string }>;
  objects: Array<EchoObject & { userId: string }>;
  dreams: Array<DreamItem & { userId: string }>;
  capsules: Array<TimeCapsuleItem & { userId: string }>;
  wisdomPosts: WisdomPost[];
  humanityPosts: HumanityPost[];
  skillProfiles: SkillProfile[];
  skillExchanges: SkillExchange[];
  exchangeMessages: Record<string, ExchangeMessage[]>;
  aiMessages: Array<AiChatMessage & { userId: string }>;
  notifications: Array<NotificationItem & { userId: string }>;
  media: StoredMedia[];
  blockedTargets?: Record<string, string[]>;
  monthlyReflections: Record<string, {
    periodKey: string;
    summary: string;
    themes: Array<{ name: string; insight: string; memoryIds: string[] }>;
    emotionalArc: string;
    gentlePrompt: string;
    checkInCount: number;
    sourceIds: string[];
    generatedAt: string;
  }>;
}

const STORAGE_KEY = 'echo_standalone_db_v1';

export function isStandaloneLocalMode(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname === 'echo.local' ||
    window.location.protocol === 'file:'
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA');
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const clean = String(raw || '')
      .trim()
      .replace(/^#+/, '')
      .slice(0, 40);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 20) break;
  }
  return out;
}

function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function simpleHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function loadDb(): StandaloneDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as StandaloneDb;
    }
  } catch {
    // Fall back to fresh DB
  }
  return {
    users: [],
    sessions: [],
    currentToken: null,
    memories: [],
    collections: [],
    objects: [],
    dreams: [],
    capsules: [],
    wisdomPosts: [
      {
        id: 'wis-seed-1',
        anonymousHandle: 'Quiet Lantern',
        isMine: false,
        postType: 'lesson',
        category: 'Growth',
        title: 'Write down ordinary Tuesdays',
        content:
          'Years later, the small unhurried afternoons end up carrying as much warmth as the big milestones.',
        helpfulCount: 14,
        resonateCount: 9,
        userHelpful: false,
        userResonate: false,
        userSaved: false,
        replies: [],
        createdAt: nowIso(),
      },
    ],
    humanityPosts: [
      {
        id: 'hum-seed-1',
        anonymousHandle: 'Morning Walk',
        isMine: false,
        category: 'Everyday Kindness',
        title: 'An umbrella shared at a crosswalk',
        content:
          'Someone stepped back into the rain so an elderly neighbor could cross under their umbrella without rushing.',
        approxRegion: 'Kyoto',
        approxLat: 35.0116,
        approxLng: 135.7681,
        helpfulCount: 19,
        userHelpful: false,
        userSaved: false,
        replies: [],
        createdAt: nowIso(),
      },
    ],
    skillProfiles: [],
    skillExchanges: [],
    exchangeMessages: {},
    aiMessages: [],
    notifications: [],
    media: [],
    monthlyReflections: {},
  };
}

function saveDb(db: StandaloneDb): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Ignore quota errors cleanly
  }
}

function toPublicUser(u: StoredUser): AuthUser {
  const { passwordHash: _ignored, totpSecret: _secret, totpLastStep: _step, ...pub } = u;
  return {
    ...pub,
    totpEnabled: Boolean(u.totpEnabled && u.totpSecret),
    totpDisplayName: u.totpEnabled ? u.totpDisplayName || 'Authenticator App' : null,
    totpEnrolledAt: u.totpEnabled ? u.totpEnrolledAt || null : null,
  };
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateBase32SecretWeb(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function decodeBase32Web(base32: string): Uint8Array {
  const cleaned = base32.toUpperCase().replace(/[\s=-]+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) throw new Error('Invalid TOTP secret.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function computeHotpWeb(keyBytes: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const msg = new Uint8Array(8);
  const view = new DataView(msg.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 1_000_000).padStart(6, '0');
}

async function verifyTotpWeb(
  secret: string,
  code: string,
  lastAcceptedStep: number | null | undefined,
  adjacentIntervals = 2
): Promise<{ valid: boolean; matchedStep: number | null }> {
  const cleanCode = code.replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return { valid: false, matchedStep: null };
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase32Web(secret);
  } catch {
    return { valid: false, matchedStep: null };
  }
  const currentStep = Math.floor(Date.now() / 1000 / 30);
  for (let offset = -adjacentIntervals; offset <= adjacentIntervals; offset += 1) {
    const step = currentStep + offset;
    if (step < 0) continue;
    if (typeof lastAcceptedStep === 'number' && step <= lastAcceptedStep) continue;
    const expected = await computeHotpWeb(keyBytes, step);
    let diff = 0;
    for (let i = 0; i < 6; i += 1) {
      diff |= expected.charCodeAt(i) ^ cleanCode.charCodeAt(i);
    }
    if (diff === 0) {
      return { valid: true, matchedStep: step };
    }
  }
  return { valid: false, matchedStep: null };
}

function buildTotpUriWeb(accountName: string, secret: string, issuer = 'ECHO'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function issueStandaloneMfaOrSession(
  db: StandaloneDb,
  user: StoredUser,
  deviceLabel: string
): Record<string, unknown> {
  if (user.totpEnabled && user.totpSecret) {
    const challengeToken = uid('mfa');
    db.mfaChallenges = db.mfaChallenges || {};
    db.mfaChallenges[challengeToken] = {
      userId: user.id,
      deviceLabel,
      attempts: 0,
      expiresAt: Date.now() + 5 * 60_000,
    };
    saveDb(db);
    return {
      mfaRequired: true,
      challengeToken,
      factors: [
        {
          factorId: 'totp',
          uid: 'totp-primary',
          displayName: user.totpDisplayName || 'Authenticator App',
        },
      ],
      hintLabel: user.phoneNumber ? `•••${user.phoneNumber.slice(-4)}` : user.email,
    };
  }
  const token = uid('tok');
  db.sessions.push({
    id: uid('ses'),
    token,
    userId: user.id,
    deviceLabel,
    createdAt: nowIso(),
  });
  db.currentToken = token;
  saveDb(db);
  return { user: toPublicUser(user), token };
}

function requireUser(db: StandaloneDb, explicitToken?: string | null): StoredUser {
  const token = explicitToken || db.currentToken;
  if (!token) {
    throw new Error('Authentication required.');
  }
  const sess = db.sessions.find((s) => s.token === token);
  if (!sess) {
    throw new Error('Session expired. Please sign in again.');
  }
  const user = db.users.find((u) => u.id === sess.userId);
  if (!user) {
    throw new Error('Account not found.');
  }
  return user;
}

function classifySentiment(text: string, mood: string): {
  sentimentTone: string;
  emotionalImpact: string;
  sentimentScore: number;
  sentimentRationale: string;
} {
  const lower = `${text} ${mood}`.toLowerCase();
  const positiveWords = ['joy', 'happy', 'grateful', 'hope', 'peace', 'love', 'laugh', 'proud', 'calm', 'inspire', 'warm'];
  const negativeWords = ['anxious', 'sad', 'loss', 'miss', 'hard', 'fear', 'worry', 'grief', 'tired', 'stress', 'melancholic'];

  let score = 15;
  for (const w of positiveWords) {
    if (lower.includes(w)) score += 16;
  }
  for (const w of negativeWords) {
    if (lower.includes(w)) score -= 22;
  }
  score = Math.max(-95, Math.min(95, score));

  let emotionalImpact = 'Reflective';
  if (score >= 45) emotionalImpact = 'Uplifting';
  else if (score >= 20) emotionalImpact = 'Calm';
  else if (score >= -15) emotionalImpact = 'Reflective';
  else if (score >= -40) emotionalImpact = 'Bittersweet';
  else emotionalImpact = 'Challenging';

  return {
    sentimentTone: mood || emotionalImpact,
    emotionalImpact,
    sentimentScore: score,
    sentimentRationale: 'Analyzed locally on your device from entry mood and narrative cues.',
  };
}

function parseJsonBody(options: RequestInit): Record<string, unknown> {
  if (!options.body || typeof options.body !== 'string') return {};
  try {
    return JSON.parse(options.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function standaloneUploadMedia(
  file: File | Blob,
  filename: string
): Promise<MediaMeta> {
  const db = loadDb();
  const user = requireUser(db);

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read media file.'));
    reader.readAsDataURL(file);
  });

  const mediaId = uid('med');
  const record: StoredMedia = {
    id: mediaId,
    userId: user.id,
    originalName: filename || 'attachment',
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size || dataUrl.length,
    dataUrl,
    createdAt: nowIso(),
  };

  db.media.push(record);
  saveDb(db);

  return {
    id: record.id,
    original_name: record.originalName,
    originalName: record.originalName,
    mime_type: record.mimeType,
    mimeType: record.mimeType,
    size_bytes: record.sizeBytes,
    sizeBytes: record.sizeBytes,
  };
}

export async function standaloneFetchMediaUrl(
  mediaId: string
): Promise<{ url: string; mimeType: string }> {
  const db = loadDb();
  const item = db.media.find((m) => m.id === mediaId);
  if (!item) {
    throw new Error('Protected media unavailable.');
  }
  const lockedCapsule = db.capsules.find(
    (c) =>
      c.userId === item.userId &&
      c.isLocked &&
      Date.parse(c.unlockAt) > Date.now() &&
      c.media.some((m) => m.id === mediaId)
  );
  if (lockedCapsule) {
    throw new Error('This media is sealed inside a locked Time Capsule until its unlock date.');
  }
  const resp = await fetch(item.dataUrl);
  const blob = await resp.blob();
  return {
    url: URL.createObjectURL(blob),
    mimeType: item.mimeType || blob.type || 'application/octet-stream',
  };
}

export async function handleStandaloneApiRequest<T>(
  rawPath: string,
  options: RequestInit = {},
  authToken?: string | null
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const url = new URL(rawPath.startsWith('/') ? `https://echo.local${rawPath}` : `https://echo.local/${rawPath}`);
  const pathname = url.pathname;
  const qs = url.searchParams;
  const body = parseJsonBody(options);
  const db = loadDb();

  // ==================== AUTH & PROFILE ====================
  if (pathname === '/auth/me' && method === 'GET') {
    const user = requireUser(db, authToken);
    return { user: toPublicUser(user) } as T;
  }

  if (pathname === '/auth/register' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim() || email.split('@')[0] || 'Explorer';
    if (!email || !email.includes('@')) throw new Error('Enter a valid email address.');
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      throw new Error('An account with this email already exists on this device.');
    }

    const user: StoredUser = {
      id: uid('usr'),
      email,
      passwordHash: simpleHash(password),
      displayName,
      bio: '',
      avatarMediaId: null,
      locationHint: '',
      timezone: String(body.timezone || 'UTC'),
      theme: (body.theme as EchoThemeId) || 'social-dark',
      emailVerified: true,
      aiConsent: true,
      notificationPrefs: { capsules: true, memories: true, skillswap: true },
      createdAt: nowIso(),
    };
    const token = uid('tok');
    db.users.push(user);
    db.sessions.push({
      id: uid('ses'),
      token,
      userId: user.id,
      deviceLabel: 'Android On-Device',
      createdAt: nowIso(),
    });
    db.currentToken = token;
    db.notifications.push({
      id: uid('not'),
      userId: user.id,
      type: 'welcome',
      title: 'On-device archive ready',
      body: 'Your memories, dreams, and capsules are saved privately on this device.',
      linkModule: 'memories',
      linkId: null,
      isRead: false,
      createdAt: nowIso(),
    });
    saveDb(db);
    return { user: toPublicUser(user), token } as T;
  }

  if (pathname === '/auth/login' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user || user.passwordHash !== simpleHash(password)) {
      throw new Error('Invalid email or password.');
    }
    return issueStandaloneMfaOrSession(
      db,
      user,
      String(body.deviceLabel || 'Android On-Device')
    ) as T;
  }

  if (pathname === '/auth/firebase' && method === 'POST') {
    throw new Error('Google sign-in requires connecting to your live ECHO server.');
  }

  if (pathname === '/auth/phone/email-verify' && method === 'POST') {
    throw new Error('Phone.Email SMS verification requires connecting to your live ECHO server, or use the Instant In-App OTP + PIN below.');
  }

  if (pathname === '/auth/phone/status' && method === 'GET') {
    return { serverSmsEnabled: false, mode: 'in_app' } as T;
  }

  if (pathname === '/auth/phone/send-otp' && method === 'POST') {
    const cleanPhone = String(body.phoneNumber || '').trim();
    if (!/^\+[1-9]\d{6,14}$/.test(cleanPhone)) {
      throw new Error('Enter a valid international phone number.');
    }
    const existing = db.users.find((u) => u.phoneNumber === cleanPhone);
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const otp = String(100000 + (bytes[0] % 900000));
    localStorage.setItem(
      `echo_phone_otp_${cleanPhone}`,
      JSON.stringify({ otp, expiresAt: Date.now() + 5 * 60_000 })
    );
    return {
      ok: true,
      delivery: 'in_app',
      previewOtp: otp,
      requiresPin: true,
      isExistingAccount: Boolean(existing),
      expiresInSeconds: 300,
    } as T;
  }

  if (pathname === '/auth/phone/verify-otp' && method === 'POST') {
    const cleanPhone = String(body.phoneNumber || '').trim();
    const cleanCode = String(body.code || '').replace(/\D/g, '');
    const cleanPin = String(body.pin || '').trim();
    if (!/^\+[1-9]\d{6,14}$/.test(cleanPhone) || !/^\d{6}$/.test(cleanCode)) {
      throw new Error('Valid phone number and 6-digit OTP code are required.');
    }
    if (cleanPin.length < 4) {
      throw new Error('Security PIN must be at least 4 characters.');
    }
    const storedRaw = localStorage.getItem(`echo_phone_otp_${cleanPhone}`);
    if (!storedRaw) throw new Error('OTP expired or not found. Please request a new code.');
    const stored = JSON.parse(storedRaw) as { otp: string; expiresAt: number };
    if (Date.now() > stored.expiresAt || stored.otp !== cleanCode) {
      throw new Error('Invalid or expired OTP code.');
    }

    let user = db.users.find((u) => u.phoneNumber === cleanPhone);
    if (user) {
      if (user.passwordHash !== simpleHash(cleanPin)) {
        throw new Error('Incorrect Security PIN for this phone number.');
      }
    } else {
      const displayName = String(body.displayName || '').trim() || `ECHO Member ••••${cleanPhone.slice(-4)}`;
      user = {
        id: uid('usr'),
        email: `phone.${simpleHash(cleanPhone)}@phone.echo.local`,
        passwordHash: simpleHash(cleanPin),
        displayName,
        phoneNumber: cleanPhone,
        authProvider: 'phone',
        bio: '',
        avatarMediaId: null,
        locationHint: '',
        timezone: String(body.timezone || 'UTC'),
        theme: (body.theme as EchoThemeId) || 'social-dark',
        emailVerified: true,
        aiConsent: true,
        notificationPrefs: { capsules: true, memories: true, skillswap: true },
        createdAt: nowIso(),
      };
      db.users.push(user);
    }

    localStorage.removeItem(`echo_phone_otp_${cleanPhone}`);
    return issueStandaloneMfaOrSession(
      db,
      user,
      String(body.deviceLabel || 'Android On-Device')
    ) as T;
  }

  if (pathname === '/auth/mfa/totp/challenge' && method === 'POST') {
    const challengeToken = String(body.challengeToken || '').trim();
    const cleanCode = String(body.code || '').replace(/\D/g, '');
    const challenges = db.mfaChallenges || {};
    const challenge = challenges[challengeToken];
    if (!challenge || Date.now() > challenge.expiresAt) {
      delete challenges[challengeToken];
      db.mfaChallenges = challenges;
      saveDb(db);
      throw new Error('Sign-in verification expired. Please sign in again.');
    }
    const user = db.users.find((u) => u.id === challenge.userId);
    if (!user || !user.totpEnabled || !user.totpSecret) {
      delete challenges[challengeToken];
      db.mfaChallenges = challenges;
      saveDb(db);
      throw new Error('Authenticator MFA is not active on this account.');
    }
    const check = await verifyTotpWeb(user.totpSecret, cleanCode, user.totpLastStep);
    if (!check.valid || check.matchedStep === null) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) {
        delete challenges[challengeToken];
      }
      db.mfaChallenges = challenges;
      saveDb(db);
      throw new Error('Invalid or already used 6-digit authenticator code.');
    }
    delete challenges[challengeToken];
    db.mfaChallenges = challenges;
    user.totpLastStep = check.matchedStep;
    const token = uid('tok');
    db.sessions.push({
      id: uid('ses'),
      token,
      userId: user.id,
      deviceLabel: String(body.deviceLabel || challenge.deviceLabel || 'Android On-Device'),
      createdAt: nowIso(),
    });
    db.currentToken = token;
    saveDb(db);
    return { user: toPublicUser(user), token } as T;
  }

  if (pathname === '/auth/mfa/totp/setup' && method === 'POST') {
    const user = requireUser(db, authToken);
    if ((!user.authProvider || user.authProvider === 'email') && user.passwordHash !== simpleHash(String(body.currentPassword || ''))) {
      throw new Error('Enter your current password to configure authenticator MFA.');
    }
    if (user.totpEnabled && user.totpSecret) {
      const check = await verifyTotpWeb(user.totpSecret, String(body.currentCode || ''), user.totpLastStep);
      if (!check.valid) {
        throw new Error('Enter a valid 6-digit code from your existing authenticator before rotating keys.');
      }
    }
    const secret = generateBase32SecretWeb(20);
    db.totpPendingSetups = db.totpPendingSetups || {};
    db.totpPendingSetups[user.id] = { secret, expiresAt: Date.now() + 10 * 60_000 };
    saveDb(db);
    const accountLabel =
      user.email && !user.email.endsWith('@phone.echo.local')
        ? user.email
        : user.phoneNumber || user.displayName;
    const totpUri = buildTotpUriWeb(accountLabel, secret, 'ECHO');
    const qrDataUrl = await QRCode.toDataURL(totpUri, { width: 240, margin: 2 });
    return { secret, totpUri, qrDataUrl, accountLabel, expiresInSeconds: 600 } as T;
  }

  if (pathname === '/auth/mfa/totp/verify-enroll' && method === 'POST') {
    const user = requireUser(db, authToken);
    const pending = db.totpPendingSetups?.[user.id];
    if (!pending || Date.now() > pending.expiresAt) {
      if (db.totpPendingSetups) delete db.totpPendingSetups[user.id];
      saveDb(db);
      throw new Error('Authenticator setup expired. Please generate a new QR code.');
    }
    const check = await verifyTotpWeb(pending.secret, String(body.code || ''), null);
    if (!check.valid || check.matchedStep === null) {
      throw new Error('Invalid 6-digit code. Check your authenticator app and try again.');
    }
    user.totpSecret = pending.secret;
    user.totpEnabled = true;
    user.totpDisplayName = String(body.displayName || '').trim().slice(0, 60) || 'Authenticator App';
    user.totpEnrolledAt = nowIso();
    user.totpLastStep = check.matchedStep;
    if (db.totpPendingSetups) delete db.totpPendingSetups[user.id];
    saveDb(db);
    return { user: toPublicUser(user) } as T;
  }

  if (pathname === '/auth/mfa/totp/unenroll' && method === 'POST') {
    const user = requireUser(db, authToken);
    if (user.totpEnabled && user.totpSecret) {
      const check = await verifyTotpWeb(user.totpSecret, String(body.code || ''), user.totpLastStep);
      const pwOk =
        (!user.authProvider || user.authProvider === 'email') &&
        Boolean(body.currentPassword) &&
        user.passwordHash === simpleHash(String(body.currentPassword || ''));
      if (!check.valid && !pwOk) {
        throw new Error('Enter your 6-digit authenticator code or current password to disable two-factor authentication.');
      }
    }
    user.totpSecret = null;
    user.totpEnabled = false;
    user.totpDisplayName = null;
    user.totpEnrolledAt = null;
    user.totpLastStep = null;
    const currentTok = authToken || db.currentToken;
    if (currentTok) {
      db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.token === currentTok);
    }
    saveDb(db);
    return { user: toPublicUser(user) } as T;
  }

  if (pathname === '/auth/logout' && method === 'POST') {
    if (db.currentToken) {
      db.sessions = db.sessions.filter((s) => s.token !== db.currentToken);
      db.currentToken = null;
      saveDb(db);
    }
    return { ok: true } as T;
  }

  if (pathname === '/auth/request-reset' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user) throw new Error('No local account found for that email.');
    const resetToken = `reset-${simpleHash(user.id + Date.now()).slice(1, 7)}`;
    localStorage.setItem(`echo_reset_${resetToken}`, user.id);
    return {
      message: 'Local reset code generated. Enter it below with your new password.',
      resetToken,
    } as T;
  }

  if (pathname === '/auth/confirm-reset' && method === 'POST') {
    const resetToken = String(body.resetToken || '').trim();
    const newPassword = String(body.newPassword || '');
    const userId = localStorage.getItem(`echo_reset_${resetToken}`);
    if (!userId || newPassword.length < 8) {
      throw new Error('Invalid reset token or password must be at least 8 characters.');
    }
    const user = db.users.find((u) => u.id === userId);
    if (!user) throw new Error('Account not found.');
    user.passwordHash = simpleHash(newPassword);
    localStorage.removeItem(`echo_reset_${resetToken}`);
    saveDb(db);
    return { ok: true } as T;
  }

  if (pathname === '/auth/change-password' && method === 'POST') {
    const user = requireUser(db, authToken);
    if (user.passwordHash !== simpleHash(String(body.currentPassword || ''))) {
      throw new Error('Current password is incorrect.');
    }
    const nextPw = String(body.newPassword || '');
    if (nextPw.length < 8) throw new Error('New password must be at least 8 characters.');
    user.passwordHash = simpleHash(nextPw);
    saveDb(db);
    return { ok: true } as T;
  }

  if (pathname === '/auth/sessions' && method === 'GET') {
    const user = requireUser(db, authToken);
    const sessions = db.sessions
      .filter((s) => s.userId === user.id)
      .map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        createdAt: s.createdAt,
        isCurrent: s.token === (authToken || db.currentToken),
      }));
    return { sessions } as T;
  }

  if (pathname.startsWith('/auth/sessions/') && method === 'DELETE') {
    const user = requireUser(db, authToken);
    const id = decodeURIComponent(pathname.split('/').pop() || '');
    const before = db.sessions.length;
    db.sessions = db.sessions.filter((s) => !(s.id === id && s.userId === user.id));
    saveDb(db);
    return { deleted: db.sessions.length < before } as T;
  }

  if (pathname === '/profile' && method === 'PUT') {
    const user = requireUser(db, authToken);
    if (body.displayName !== undefined) user.displayName = String(body.displayName).trim() || user.displayName;
    if (body.bio !== undefined) user.bio = String(body.bio);
    if (body.locationHint !== undefined) user.locationHint = String(body.locationHint);
    if (body.timezone !== undefined) user.timezone = String(body.timezone);
    if (body.theme !== undefined) user.theme = body.theme as EchoThemeId;
    if (body.aiConsent !== undefined) user.aiConsent = Boolean(body.aiConsent);
    if (body.avatarMediaId !== undefined) user.avatarMediaId = body.avatarMediaId ? String(body.avatarMediaId) : null;
    if (body.notificationPrefs && typeof body.notificationPrefs === 'object') {
      user.notificationPrefs = body.notificationPrefs as Record<string, boolean>;
    }
    saveDb(db);
    return { user: toPublicUser(user) } as T;
  }

  if (pathname === '/account' && method === 'DELETE') {
    const user = requireUser(db, authToken);
    db.users = db.users.filter((u) => u.id !== user.id);
    db.sessions = db.sessions.filter((s) => s.userId !== user.id);
    db.memories = db.memories.filter((m) => m.userId !== user.id);
    db.collections = db.collections.filter((c) => c.userId !== user.id);
    db.objects = db.objects.filter((o) => o.userId !== user.id);
    db.dreams = db.dreams.filter((d) => d.userId !== user.id);
    db.capsules = db.capsules.filter((c) => c.userId !== user.id);
    db.aiMessages = db.aiMessages.filter((a) => a.userId !== user.id);
    db.notifications = db.notifications.filter((n) => n.userId !== user.id);
    db.media = db.media.filter((m) => m.userId !== user.id);
    db.currentToken = null;
    saveDb(db);
    return { deleted: true } as T;
  }

  if (pathname === '/export' && method === 'GET') {
    const user = requireUser(db, authToken);
    return {
      exportedAt: nowIso(),
      user: toPublicUser(user),
      memories: db.memories.filter((m) => m.userId === user.id),
      collections: db.collections.filter((c) => c.userId === user.id),
      objects: db.objects.filter((o) => o.userId === user.id),
      dreams: db.dreams.filter((d) => d.userId === user.id),
      capsules: db.capsules.filter((c) => c.userId === user.id),
    } as T;
  }

  // ==================== SHARED PUBLIC OBJECT ====================
  if (pathname.startsWith('/shared/object/') && method === 'GET') {
    const slug = decodeURIComponent(pathname.split('/').pop() || '');
    const obj = db.objects.find((o) => o.shareSlug === slug && o.isPublic);
    if (!obj) throw new Error('Shared object not found.');
    return { object: obj } as T;
  }

  // Require auth for all remaining routes
  const user = requireUser(db, authToken);
  const userMemories = db.memories
    .filter((m) => m.userId === user.id)
    .sort((a, b) => b.memoryDate.localeCompare(a.memoryDate) || b.createdAt.localeCompare(a.createdAt));

  // ==================== DASHBOARD ====================
  if (pathname === '/dashboard' && method === 'GET') {
    const localDate = qs.get('localDate') || todayIso();
    const userDreams = db.dreams.filter((d) => d.userId === user.id);
    const userObjects = db.objects.filter((o) => o.userId === user.id);
    const userCapsules = db.capsules.filter((c) => c.userId === user.id);
    const readyCapsules = userCapsules.filter(
      (c) => c.isLocked && !c.openedAt && Date.parse(c.unlockAt) <= Date.now()
    );
    const lockedUpcoming = userCapsules
      .filter((c) => c.isLocked && !c.openedAt && Date.parse(c.unlockAt) > Date.now())
      .sort((a, b) => Date.parse(a.unlockAt) - Date.parse(b.unlockAt))[0];

    const checkIns = userMemories.filter(
      (m) =>
        m.category.toLowerCase() === 'daily check-in' ||
        m.tags.some((t) => t.toLowerCase() === 'daily-checkin')
    );
    const todayEntries = checkIns.filter((m) => m.memoryDate === localDate);
    const checkInDates = new Set(checkIns.map((m) => m.memoryDate));
    const shiftDate = (iso: string, deltaDays: number) => {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
    };
    let streak = 0;
    let cursorIso = checkInDates.has(localDate) ? localDate : shiftDate(localDate, -1);
    while (checkInDates.has(cursorIso)) {
      streak += 1;
      cursorIso = shiftDate(cursorIso, -1);
    }

    const mmdd = localDate.slice(5);
    const localYear = localDate.slice(0, 4);
    const onThisDay = userMemories
      .filter((m) => m.memoryDate.slice(5) === mmdd && m.memoryDate.slice(0, 4) !== localYear)
      .slice(0, 4)
      .map((m) => ({ id: m.id, title: m.title, memory_date: m.memoryDate, content: m.content }));

    const recentMemories = userMemories.slice(0, 5).map((m) => ({
      id: m.id,
      title: m.title,
      content: m.content,
      memory_date: m.memoryDate,
      category: m.category,
      mood: m.mood,
      location_name: m.locationName,
    }));

    const periodKey = 'last-30-days';
    const savedReflection = db.monthlyReflections[`${user.id}_${periodKey}`] || null;
    const thirtyDaysStart = shiftDate(localDate, -29);
    const checkInHistory = checkIns
      .filter((m) => m.memoryDate >= thirtyDaysStart && m.memoryDate <= localDate)
      .slice()
      .reverse()
      .map((m) => ({
        id: m.id,
        title: m.title,
        memoryDate: m.memoryDate,
        mood: m.mood,
        sentimentTone: m.sentimentTone,
        emotionalImpact: m.emotionalImpact,
        sentimentScore: m.sentimentScore,
        sentimentRationale: m.sentimentRationale,
        aiExcluded: m.aiExcluded,
        excerpt: m.content.replace(/^Daily Check-In Prompt:\s*"[^"]*"\s*/i, '').trim().slice(0, 140),
        createdAt: m.createdAt,
      }));
    const todayPrimary = todayEntries[0] || null;

    return {
      stats: {
        memoryCount: userMemories.length,
        dreamCount: userDreams.length,
        objectCount: userObjects.length,
        capsuleCount: userCapsules.length,
        readyCapsules: readyCapsules.length,
        unreadNotifications: db.notifications.filter((n) => n.userId === user.id && !n.isRead).length,
      },
      featuredMemory: recentMemories[0] || null,
      recentMemories,
      onThisDay,
      nextCapsule: lockedUpcoming
        ? {
            id: lockedUpcoming.id,
            title: lockedUpcoming.title,
            capsule_type: lockedUpcoming.capsuleType,
            unlock_occasion: lockedUpcoming.unlockOccasion,
            unlock_at: lockedUpcoming.unlockAt,
          }
        : null,
      dailyCheckIn: {
        date: localDate,
        streak,
        totalCheckIns: checkIns.length,
        completedToday: todayEntries.length > 0,
        todayCount: todayEntries.length,
        todayEntry: todayPrimary
          ? {
              id: todayPrimary.id,
              title: todayPrimary.title,
              content: todayPrimary.content,
              mood: todayPrimary.mood,
              memoryDate: todayPrimary.memoryDate,
              createdAt: todayPrimary.createdAt,
            }
          : null,
        todayEntries: todayEntries.map((m) => ({
          id: m.id,
          title: m.title,
          content: m.content,
          mood: m.mood,
          memoryDate: m.memoryDate,
          createdAt: m.createdAt,
        })),
        history: checkInHistory,
        monthlyReflection: savedReflection,
      },
      humanityHighlights: db.humanityPosts.slice(0, 3).map((p) => ({
        id: p.id,
        category: p.category,
        title: p.title,
        content: p.content,
        approx_region: p.approxRegion,
        helpful_count: p.helpfulCount,
      })),
      skillDiscovery: db.skillProfiles
        .filter((s) => s.userId !== user.id)
        .slice(0, 4)
        .map((s) => ({
          user_id: s.userId,
          display_name: s.displayName || 'Community Member',
          teach_skills_json: JSON.stringify(s.teachSkills),
          learn_skills_json: JSON.stringify(s.learnSkills),
          mode: s.mode,
          location_city: s.locationCity,
        })),
    } as T;
  }

  // ==================== MEMORIES ====================
  if (pathname === '/memories/tags' && method === 'GET') {
    const counts = new Map<string, number>();
    for (const m of userMemories) {
      for (const t of m.tags) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    const tags = Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return { tags } as T;
  }

  if (pathname === '/memories/tags/rename' && method === 'PUT') {
    const oldTag = String(body.oldTag || '').trim();
    const newTag = String(body.newTag || '').trim().replace(/^#+/, '');
    let updatedCount = 0;
    for (const m of db.memories) {
      if (m.userId !== user.id) continue;
      if (m.tags.some((t) => t.toLowerCase() === oldTag.toLowerCase())) {
        m.tags = Array.from(
          new Set(m.tags.map((t) => (t.toLowerCase() === oldTag.toLowerCase() ? newTag : t)))
        );
        m.updatedAt = nowIso();
        updatedCount += 1;
      }
    }
    saveDb(db);
    return { updatedCount } as T;
  }

  if (pathname.startsWith('/memories/tags/') && method === 'DELETE') {
    const tag = decodeURIComponent(pathname.slice('/memories/tags/'.length));
    let updatedCount = 0;
    for (const m of db.memories) {
      if (m.userId !== user.id) continue;
      const next = m.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
      if (next.length !== m.tags.length) {
        m.tags = next;
        m.updatedAt = nowIso();
        updatedCount += 1;
      }
    }
    saveDb(db);
    return { updatedCount } as T;
  }

  if (pathname === '/memories/sentiment-summary' && method === 'GET') {
    const impactCounts: Record<string, number> = {};
    const toneMap = new Map<string, number>();
    const catMap = new Map<string, number>();
    let unanalyzedCount = 0;
    let analyzableUnanalyzedCount = 0;

    for (const m of userMemories) {
      const cat = (m.category || 'Personal').trim();
      catMap.set(cat, (catMap.get(cat) || 0) + 1);
      if (m.emotionalImpact) {
        impactCounts[m.emotionalImpact] = (impactCounts[m.emotionalImpact] || 0) + 1;
      } else {
        unanalyzedCount += 1;
        if (!m.aiExcluded) analyzableUnanalyzedCount += 1;
      }
      const tone = m.sentimentTone || m.mood;
      if (tone) toneMap.set(tone, (toneMap.get(tone) || 0) + 1);
    }

    return {
      totalMemories: userMemories.length,
      unanalyzedCount,
      analyzableUnanalyzedCount,
      impactCounts,
      tones: Array.from(toneMap.entries()).map(([tone, count]) => ({ tone, count })),
      categoryCounts: Array.from(catMap.entries()).map(([category, count]) => ({ category, count })),
    } as T;
  }

  if (pathname === '/memories/analyze-sentiment-batch' && method === 'POST') {
    const updated: MemoryItem[] = [];
    for (const m of db.memories) {
      if (m.userId === user.id && !m.aiExcluded && !m.emotionalImpact) {
        const res = classifySentiment(`${m.title} ${m.content}`, m.mood);
        m.sentimentTone = res.sentimentTone;
        m.emotionalImpact = res.emotionalImpact;
        m.sentimentScore = res.sentimentScore;
        m.sentimentRationale = res.sentimentRationale;
        m.updatedAt = nowIso();
        updated.push(m);
        if (updated.length >= 15) break;
      }
    }
    saveDb(db);
    return { analyzedCount: updated.length, memories: updated } as T;
  }

  if (pathname === '/memories/on-this-day' && method === 'GET') {
    const rawLocal = (qs.get('localDate') || '').trim();
    const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(rawLocal) ? rawLocal : todayIso();
    const mmdd = baseDate.slice(5, 10);
    const year = baseDate.slice(0, 4);
    const matches = userMemories.filter(
      (m) => m.memoryDate.slice(5, 10) === mmdd && m.memoryDate.slice(0, 4) !== year
    );
    return { memories: matches } as T;
  }

  if (pathname === '/memories/random' && method === 'GET') {
    const memory = userMemories.length > 0
      ? userMemories[Math.floor(Math.random() * userMemories.length)]
      : null;
    return { memory } as T;
  }

  if (pathname === '/memories' && method === 'GET') {
    const q = (qs.get('q') || '').trim().toLowerCase();
    const cat = qs.get('category');
    const mood = qs.get('mood');
    const tone = qs.get('tone');
    const impact = qs.get('impact');
    const impactsRaw = qs.get('impacts');
    const fav = qs.get('favorite') === 'true';
    const colId = qs.get('collectionId');
    const person = qs.get('person');
    const tagsRaw = qs.get('tags');
    const tagMode = qs.get('tagMode') === 'all' ? 'all' : 'any';
    const month = qs.get('month');

    const requestedImpacts = impactsRaw
      ? impactsRaw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
      : impact && impact !== 'All'
      ? [impact.trim().toLowerCase()]
      : [];

    const filtered = userMemories.filter((m) => {
      if (q) {
        const hay = `${m.title} ${m.content} ${m.locationName} ${m.tags.join(' ')} ${m.people.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (cat && cat !== 'All' && m.category.toLowerCase() !== cat.toLowerCase()) return false;
      if (mood && mood !== 'All' && m.mood.toLowerCase() !== mood.toLowerCase() && m.sentimentTone.toLowerCase() !== mood.toLowerCase()) return false;
      if (tone && tone !== 'All' && m.sentimentTone.toLowerCase() !== tone.toLowerCase() && m.mood.toLowerCase() !== tone.toLowerCase()) return false;
      if (requestedImpacts.length > 0 && !requestedImpacts.includes(m.emotionalImpact.toLowerCase())) return false;
      if (fav && !m.isFavorite) return false;
      if (colId && m.collectionId !== colId) return false;
      if (person && !m.people.some((p) => p.toLowerCase() === person.toLowerCase())) return false;
      if (month && !m.memoryDate.startsWith(month)) return false;
      if (tagsRaw) {
        const wanted = tagsRaw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        if (wanted.length > 0) {
          const has = (w: string) => m.tags.some((t) => t.toLowerCase() === w);
          if (tagMode === 'all' ? !wanted.every(has) : !wanted.some(has)) return false;
        }
      }
      return true;
    });
    return { memories: filtered } as T;
  }

  if (pathname === '/memories' && method === 'POST') {
    const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds.map(String) : [];
    const mediaList: MediaMeta[] = db.media
      .filter((med) => med.userId === user.id && mediaIds.includes(med.id))
      .map((med) => ({
        id: med.id,
        original_name: med.originalName,
        mime_type: med.mimeType,
        size_bytes: med.sizeBytes,
        transcript: med.transcript,
      }));
    const title = String(body.title || '').trim() || 'Untitled Memory';
    const content = String(body.content || '').trim();
    const aiExcluded = Boolean(body.aiExcluded);
    let resolvedMood = String(body.mood || 'Reflective');
    let resolvedTone = String(body.sentimentTone || '');
    let resolvedImpact = String(body.emotionalImpact || '');
    let resolvedScore = typeof body.sentimentScore === 'number' ? body.sentimentScore : null;
    let resolvedRationale = String(body.sentimentRationale || '');

    if (body.autoAnalyzeSentiment && user.aiConsent && !aiExcluded && !resolvedImpact) {
      const s = classifySentiment(`${title} ${content}`, resolvedMood);
      resolvedTone = s.sentimentTone;
      resolvedImpact = s.emotionalImpact;
      resolvedScore = s.sentimentScore;
      resolvedRationale = s.sentimentRationale;
      if (!body.mood || body.mood === 'Reflective') {
        resolvedMood = s.sentimentTone || resolvedMood;
      }
    }

    const item: MemoryItem & { userId: string } = {
      id: uid('mem'),
      userId: user.id,
      title,
      content,
      memoryDate: String(body.memoryDate || todayIso()),
      locationName: String(body.locationName || ''),
      latitude: typeof body.latitude === 'number' ? body.latitude : null,
      longitude: typeof body.longitude === 'number' ? body.longitude : null,
      mood: resolvedMood,
      category: String(body.category || 'Personal'),
      isFavorite: Boolean(body.isFavorite),
      aiExcluded,
      aiSummary: String(body.aiSummary || ''),
      sentimentTone: resolvedTone,
      emotionalImpact: resolvedImpact,
      sentimentScore: resolvedScore,
      sentimentRationale: resolvedRationale,
      collectionId: body.collectionId ? String(body.collectionId) : null,
      tags: normalizeTags(body.tags),
      people: Array.isArray(body.people) ? body.people.map(String) : [],
      media: mediaList,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.memories.push(item);
    saveDb(db);
    return { memory: item } as T;
  }

  if (pathname.startsWith('/memories/')) {
    const parts = pathname.split('/').filter(Boolean);
    const id = decodeURIComponent(parts[1] || '');
    const sub = parts[2];
    const mem = db.memories.find((m) => m.id === id && m.userId === user.id);

    if (sub === 'related' && method === 'GET') {
      if (!mem) return { related: [] } as T;
      const related = userMemories
        .filter((other) => other.id !== mem.id)
        .filter(
          (other) =>
            other.category === mem.category ||
            other.tags.some((t) => mem.tags.includes(t)) ||
            other.people.some((p) => mem.people.includes(p))
        )
        .slice(0, 4);
      return { related } as T;
    }

    if (!mem) throw new Error('Memory not found.');

    if (!sub && method === 'PUT') {
      if (body.title !== undefined) mem.title = String(body.title).trim() || mem.title;
      if (body.content !== undefined) mem.content = String(body.content);
      if (body.memoryDate !== undefined) mem.memoryDate = String(body.memoryDate);
      if (body.locationName !== undefined) mem.locationName = String(body.locationName);
      if (body.latitude !== undefined) mem.latitude = typeof body.latitude === 'number' ? body.latitude : null;
      if (body.longitude !== undefined) mem.longitude = typeof body.longitude === 'number' ? body.longitude : null;
      if (body.mood !== undefined) mem.mood = String(body.mood);
      if (body.category !== undefined) mem.category = String(body.category);
      if (body.isFavorite !== undefined) mem.isFavorite = Boolean(body.isFavorite);
      if (body.aiExcluded !== undefined) mem.aiExcluded = Boolean(body.aiExcluded);
      if (body.aiSummary !== undefined) mem.aiSummary = String(body.aiSummary);
      if (body.sentimentTone !== undefined) mem.sentimentTone = String(body.sentimentTone);
      if (body.emotionalImpact !== undefined) mem.emotionalImpact = String(body.emotionalImpact);
      if (body.sentimentScore !== undefined) {
        mem.sentimentScore = typeof body.sentimentScore === 'number' ? body.sentimentScore : null;
      }
      if (body.sentimentRationale !== undefined) mem.sentimentRationale = String(body.sentimentRationale);
      if (body.collectionId !== undefined) mem.collectionId = body.collectionId ? String(body.collectionId) : null;
      if (Array.isArray(body.tags)) mem.tags = normalizeTags(body.tags);
      if (Array.isArray(body.people)) mem.people = body.people.map(String);
      if (Array.isArray(body.mediaIds)) {
        const ids = body.mediaIds.map(String);
        mem.media = db.media
          .filter((med) => med.userId === user.id && ids.includes(med.id))
          .map((med) => ({
            id: med.id,
            original_name: med.originalName,
            mime_type: med.mimeType,
            size_bytes: med.sizeBytes,
            transcript: med.transcript,
          }));
      }
      mem.updatedAt = nowIso();
      saveDb(db);
      return { memory: mem } as T;
    }

    if (!sub && method === 'DELETE') {
      const before = db.memories.length;
      db.memories = db.memories.filter((m) => m.id !== id);
      saveDb(db);
      return { deleted: db.memories.length < before } as T;
    }

    if (sub === 'favorite' && method === 'POST') {
      mem.isFavorite = !mem.isFavorite;
      mem.updatedAt = nowIso();
      saveDb(db);
      return { isFavorite: mem.isFavorite } as T;
    }

    if (sub === 'tags' && method === 'POST') {
      mem.tags = Array.isArray(body.tags) ? normalizeTags(body.tags) : mem.tags;
      mem.updatedAt = nowIso();
      saveDb(db);
      return { memory: mem } as T;
    }

    if (sub === 'category' && method === 'POST') {
      mem.category = String(body.category || mem.category);
      mem.updatedAt = nowIso();
      saveDb(db);
      return { memory: mem } as T;
    }

    if (sub === 'analyze-sentiment' && method === 'POST') {
      if (mem.aiExcluded) {
        throw new Error('This memory is excluded from AI reading and reflection.');
      }
      const res = classifySentiment(`${mem.title} ${mem.content}`, mem.mood);
      mem.sentimentTone = res.sentimentTone;
      mem.emotionalImpact = res.emotionalImpact;
      mem.sentimentScore = res.sentimentScore;
      mem.sentimentRationale = res.sentimentRationale;
      if (body.applyMood !== false && res.sentimentTone) {
        mem.mood = res.sentimentTone;
      }
      mem.updatedAt = nowIso();
      saveDb(db);
      return {
        memory: mem,
        sentiment: {
          tone: res.sentimentTone,
          suggestedMood: res.sentimentTone || mem.mood,
          emotionalImpact: res.emotionalImpact,
          valenceScore: res.sentimentScore,
          rationale: res.sentimentRationale,
        },
      } as T;
    }
  }

  // ==================== COLLECTIONS ====================
  if (pathname === '/collections' && method === 'GET') {
    const cols = db.collections
      .filter((c) => c.userId === user.id)
      .map((c) => ({
        ...c,
        memory_count: userMemories.filter((m) => m.collectionId === c.id).length,
      }));
    return { collections: cols } as T;
  }

  if (pathname === '/collections' && method === 'POST') {
    const col: MemoryCollection & { userId: string } = {
      id: uid('col'),
      userId: user.id,
      name: String(body.name || 'Collection').trim(),
      description: String(body.description || ''),
      color: String(body.color || '#38bdf8'),
      memory_count: 0,
      created_at: nowIso(),
    };
    db.collections.push(col);
    saveDb(db);
    return { collection: col } as T;
  }

  if (pathname.startsWith('/collections/') && method === 'DELETE') {
    const colId = decodeURIComponent(pathname.slice('/collections/'.length));
    const before = db.collections.length;
    db.collections = db.collections.filter((c) => !(c.id === colId && c.userId === user.id));
    for (const m of db.memories) {
      if (m.userId === user.id && m.collectionId === colId) {
        m.collectionId = null;
      }
    }
    saveDb(db);
    return { deleted: db.collections.length < before } as T;
  }

  // ==================== OBJECTS ====================
  if (pathname === '/objects' && method === 'GET') {
    const q = (qs.get('q') || '').trim().toLowerCase();
    const cat = qs.get('category');
    const list = db.objects
      .filter((o) => o.userId === user.id)
      .filter((o) => !cat || cat === 'All' || o.category === cat)
      .filter((o) => !q || `${o.name} ${o.story} ${o.description} ${o.currentOwner} ${o.location} ${o.category}`.toLowerCase().includes(q));
    return { objects: list } as T;
  }

  if (pathname === '/objects' && method === 'POST') {
    const id = uid('obj');
    const obj: EchoObject & { userId: string } = {
      id,
      userId: user.id,
      name: String(body.name || 'Heirloom Object'),
      category: String(body.category || 'Keepsake'),
      photoMediaId: body.photoMediaId ? String(body.photoMediaId) : null,
      voiceMediaId: body.voiceMediaId ? String(body.voiceMediaId) : null,
      description: String(body.description || ''),
      story: String(body.story || ''),
      acquisitionDate: String(body.acquisitionDate || ''),
      currentOwner: String(body.currentOwner || user.displayName),
      previousOwners: Array.isArray(body.previousOwners) ? body.previousOwners.map(String) : [],
      connectedPeople: Array.isArray(body.connectedPeople) ? body.connectedPeople.map(String) : [],
      location: String(body.location || ''),
      historicalNotes: String(body.historicalNotes || ''),
      relatedMemoryIds: Array.isArray(body.relatedMemoryIds) ? body.relatedMemoryIds.map(String) : [],
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      isPublic: Boolean(body.isPublic),
      shareSlug: `echo-${id.slice(-8)}`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.objects.push(obj);
    saveDb(db);
    return { object: obj } as T;
  }

  if (pathname.startsWith('/objects/')) {
    const parts = pathname.split('/').filter(Boolean);
    const id = decodeURIComponent(parts[1] || '');
    const sub = parts[2];
    const obj = db.objects.find((o) => o.id === id && o.userId === user.id);
    if (!obj) throw new Error('Object not found.');

    if (!sub && method === 'PUT') {
      Object.assign(obj, {
        name: body.name !== undefined ? String(body.name) : obj.name,
        category: body.category !== undefined ? String(body.category) : obj.category,
        photoMediaId: body.photoMediaId !== undefined ? (body.photoMediaId ? String(body.photoMediaId) : null) : obj.photoMediaId,
        voiceMediaId: body.voiceMediaId !== undefined ? (body.voiceMediaId ? String(body.voiceMediaId) : null) : obj.voiceMediaId,
        description: body.description !== undefined ? String(body.description) : obj.description,
        story: body.story !== undefined ? String(body.story) : obj.story,
        acquisitionDate: body.acquisitionDate !== undefined ? String(body.acquisitionDate) : obj.acquisitionDate,
        currentOwner: body.currentOwner !== undefined ? String(body.currentOwner) : obj.currentOwner,
        previousOwners: Array.isArray(body.previousOwners) ? body.previousOwners.map(String) : obj.previousOwners,
        connectedPeople: Array.isArray(body.connectedPeople) ? body.connectedPeople.map(String) : obj.connectedPeople,
        location: body.location !== undefined ? String(body.location) : obj.location,
        historicalNotes: body.historicalNotes !== undefined ? String(body.historicalNotes) : obj.historicalNotes,
        relatedMemoryIds: Array.isArray(body.relatedMemoryIds) ? body.relatedMemoryIds.map(String) : obj.relatedMemoryIds,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : obj.tags,
        isPublic: body.isPublic !== undefined ? Boolean(body.isPublic) : obj.isPublic,
        updatedAt: nowIso(),
      });
      saveDb(db);
      return { object: obj } as T;
    }
    if (!sub && method === 'DELETE') {
      const before = db.objects.length;
      db.objects = db.objects.filter((o) => o.id !== id);
      saveDb(db);
      return { deleted: db.objects.length < before } as T;
    }
    if (sub === 'qrcode' && method === 'GET') {
      if (!obj.shareSlug) {
        obj.shareSlug = `echo-${obj.id.slice(-8)}`;
        saveDb(db);
      }
      const shareUrl = `${window.location.origin}/?sharedObject=${encodeURIComponent(obj.shareSlug)}`;
      const qrDataUrl = await QRCode.toDataURL(shareUrl, {
        width: 320,
        margin: 2,
        color: { dark: '#070B14', light: '#F8FAFC' },
      });
      return {
        qrDataUrl,
        shareUrl,
        isPublic: Boolean(obj.isPublic),
      } as T;
    }
    if (sub === 'share' && method === 'POST') {
      obj.isPublic = Boolean(body.isPublic ?? true);
      if (!obj.shareSlug) obj.shareSlug = `echo-${obj.id.slice(-8)}`;
      saveDb(db);
      const shareUrl = `${window.location.origin}/?sharedObject=${encodeURIComponent(obj.shareSlug)}`;
      const qrDataUrl = await QRCode.toDataURL(shareUrl, {
        width: 320,
        margin: 2,
        color: { dark: '#070B14', light: '#F8FAFC' },
      });
      return {
        qrDataUrl,
        shareUrl,
        isPublic: obj.isPublic,
      } as T;
    }
  }

  // ==================== DREAMS ====================
  if (pathname === '/dreams/patterns' && method === 'GET') {
    const userDreams = db.dreams.filter((d) => d.userId === user.id);
    const emotions = new Map<string, number>();
    const tags = new Map<string, number>();
    let recurringCount = 0;
    for (const d of userDreams) {
      const em = d.emotion || 'Wonder';
      emotions.set(em, (emotions.get(em) || 0) + 1);
      for (const t of d.tags) {
        const clean = t.toLowerCase();
        tags.set(clean, (tags.get(clean) || 0) + 1);
      }
      if (d.isRecurring) recurringCount += 1;
    }
    return {
      totalDreams: userDreams.length,
      recurringCount,
      topTags: Array.from(tags.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([tag, count]) => ({ tag, count })),
      topEmotions: Array.from(emotions.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([emotion, count]) => ({ emotion, count })),
    } as T;
  }

  if (pathname === '/dreams' && method === 'GET') {
    const q = (qs.get('q') || '').trim().toLowerCase();
    const cat = qs.get('category');
    const recurring = qs.get('recurring') === 'true';
    const list = db.dreams
      .filter((d) => d.userId === user.id)
      .filter((d) => !cat || cat === 'All' || d.category === cat)
      .filter((d) => !recurring || d.isRecurring)
      .filter((d) => !q || `${d.title} ${d.content} ${d.location} ${d.tags.join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => b.dreamDate.localeCompare(a.dreamDate));
    return { dreams: list } as T;
  }

  if (pathname === '/dreams' && method === 'POST') {
    const d: DreamItem & { userId: string } = {
      id: uid('drm'),
      userId: user.id,
      title: String(body.title || 'Untitled Dream'),
      content: String(body.content || ''),
      dreamDate: String(body.dreamDate || todayIso()),
      emotion: String(body.emotion || 'Curious'),
      location: String(body.location || ''),
      category: String(body.category || 'Lucid'),
      vividness: Number(body.vividness || 3),
      isRecurring: Boolean(body.isRecurring),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      imageMediaId: body.imageMediaId ? String(body.imageMediaId) : null,
      voiceMediaId: body.voiceMediaId ? String(body.voiceMediaId) : null,
      transcript: String(body.transcript || ''),
      aiReflection: String(body.aiReflection || ''),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.dreams.push(d);
    saveDb(db);
    return { dream: d } as T;
  }

  if (pathname.startsWith('/dreams/')) {
    const id = decodeURIComponent(pathname.split('/')[2] || '');
    const drm = db.dreams.find((d) => d.id === id && d.userId === user.id);
    if (!drm) throw new Error('Dream not found.');
    if (method === 'PUT') {
      Object.assign(drm, {
        title: body.title !== undefined ? String(body.title) : drm.title,
        content: body.content !== undefined ? String(body.content) : drm.content,
        dreamDate: body.dreamDate !== undefined ? String(body.dreamDate) : drm.dreamDate,
        emotion: body.emotion !== undefined ? String(body.emotion) : drm.emotion,
        location: body.location !== undefined ? String(body.location) : drm.location,
        category: body.category !== undefined ? String(body.category) : drm.category,
        vividness: body.vividness !== undefined ? Number(body.vividness) : drm.vividness,
        isRecurring: body.isRecurring !== undefined ? Boolean(body.isRecurring) : drm.isRecurring,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : drm.tags,
        updatedAt: nowIso(),
      });
      saveDb(db);
      return { dream: drm } as T;
    }
    if (method === 'DELETE') {
      const before = db.dreams.length;
      db.dreams = db.dreams.filter((d) => d.id !== id);
      saveDb(db);
      return { deleted: db.dreams.length < before } as T;
    }
  }

  // ==================== TIME CAPSULES ====================
  if (pathname === '/capsules' && method === 'GET') {
    const list = db.capsules
      .filter((c) => c.userId === user.id)
      .map((c) => {
        const unlockMs = Date.parse(c.unlockAt);
        const matured = Number.isFinite(unlockMs) && unlockMs <= Date.now();
        const canRevealContent = !c.isLocked || matured;
        return {
          ...c,
          isMatured: matured,
          isOpenable: c.isLocked && matured,
          message: canRevealContent ? c.message : null,
          media: canRevealContent ? c.media : [],
        };
      });
    return { capsules: list } as T;
  }

  if (pathname === '/capsules' && method === 'POST') {
    const parsedUnlock = Date.parse(String(body.unlockAt || ''));
    if (!Number.isFinite(parsedUnlock)) {
      throw new Error('Invalid unlock date format.');
    }
    const lockImmediately = Boolean(body.lockImmediately);
    if (lockImmediately && parsedUnlock <= Date.now()) {
      throw new Error('A locked Time Capsule must have a future unlock date.');
    }
    const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds.map(String) : [];
    const mediaList: MediaMeta[] = db.media
      .filter((med) => med.userId === user.id && mediaIds.includes(med.id))
      .map((med) => ({
        id: med.id,
        original_name: med.originalName,
        mime_type: med.mimeType,
        size_bytes: med.sizeBytes,
      }));
    const unlockIso = new Date(parsedUnlock).toISOString();
    const matured = parsedUnlock <= Date.now();
    const cap: TimeCapsuleItem & { userId: string } = {
      id: uid('cap'),
      userId: user.id,
      title: String(body.title || 'Future Letter'),
      message: String(body.message || ''),
      capsuleType: String(body.capsuleType || 'letter'),
      unlockOccasion: String(body.unlockOccasion || 'specific_date'),
      unlockAt: unlockIso,
      timezone: String(body.timezone || user.timezone || 'UTC'),
      isLocked: lockImmediately,
      isMatured: matured,
      isOpenable: lockImmediately && matured,
      openedAt: null,
      media: mediaList,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.capsules.push(cap);
    saveDb(db);
    return {
      capsule: {
        ...cap,
        message: cap.isLocked && !matured ? null : cap.message,
        media: cap.isLocked && !matured ? [] : cap.media,
      },
    } as T;
  }

  if (pathname.startsWith('/capsules/')) {
    const parts = pathname.split('/').filter(Boolean);
    const id = decodeURIComponent(parts[1] || '');
    const sub = parts[2];
    const cap = db.capsules.find((c) => c.id === id && c.userId === user.id);
    if (!cap) throw new Error('Time capsule not found.');

    if (!sub && method === 'PUT') {
      if (cap.isLocked) throw new Error('Sealed capsules cannot be edited.');
      let nextUnlock = cap.unlockAt;
      if (body.unlockAt !== undefined) {
        const parsedUnlock = Date.parse(String(body.unlockAt));
        if (!Number.isFinite(parsedUnlock)) throw new Error('Invalid unlock date format.');
        nextUnlock = new Date(parsedUnlock).toISOString();
      }
      let nextMedia = cap.media;
      if (Array.isArray(body.mediaIds)) {
        const mediaIds = body.mediaIds.map(String);
        nextMedia = db.media
          .filter((med) => med.userId === user.id && mediaIds.includes(med.id))
          .map((med) => ({
            id: med.id,
            original_name: med.originalName,
            mime_type: med.mimeType,
            size_bytes: med.sizeBytes,
          }));
      }
      Object.assign(cap, {
        title: body.title !== undefined ? String(body.title) : cap.title,
        message: body.message !== undefined ? String(body.message) : cap.message,
        capsuleType: body.capsuleType !== undefined ? String(body.capsuleType) : cap.capsuleType,
        unlockOccasion: body.unlockOccasion !== undefined ? String(body.unlockOccasion) : cap.unlockOccasion,
        unlockAt: nextUnlock,
        timezone: body.timezone !== undefined ? String(body.timezone) : cap.timezone,
        media: nextMedia,
        updatedAt: nowIso(),
      });
      saveDb(db);
      return { capsule: cap } as T;
    }
    if (!sub && method === 'DELETE') {
      const before = db.capsules.length;
      db.capsules = db.capsules.filter((c) => c.id !== id);
      saveDb(db);
      return { deleted: db.capsules.length < before } as T;
    }
    if (sub === 'lock' && method === 'POST') {
      if (Date.parse(cap.unlockAt) <= Date.now()) {
        throw new Error('Unlock date must be in the future before sealing this capsule.');
      }
      cap.isLocked = true;
      cap.updatedAt = nowIso();
      saveDb(db);
      return {
        capsule: {
          ...cap,
          message: null,
          media: [],
        },
      } as T;
    }
    if (sub === 'open' && method === 'POST') {
      if (cap.isLocked && Date.parse(cap.unlockAt) > Date.now()) {
        throw new Error('This Time Capsule is still locked until its scheduled unlock time.');
      }
      const openTime = nowIso();
      if (!cap.openedAt) {
        cap.openedAt = openTime;
        cap.updatedAt = openTime;
      }
      cap.isMatured = Date.parse(cap.unlockAt) <= Date.now();
      cap.isOpenable = cap.isLocked && cap.isMatured;
      saveDb(db);
      return { capsule: cap } as T;
    }
  }

  // ==================== WISDOM & HUMANITY ====================
  const myBlockedSet = new Set(db.blockedTargets?.[user.id] || []);

  if (pathname === '/wisdom' && method === 'GET') {
    const cat = qs.get('category');
    const q = (qs.get('q') || '').trim().toLowerCase();
    const savedOnly = qs.get('savedOnly') === 'true';
    const filtered = db.wisdomPosts.filter((p) => {
      if (myBlockedSet.has(p.id)) return false;
      if (cat && cat !== 'All' && p.category !== cat) return false;
      if (savedOnly && !p.userSaved) return false;
      if (q && !`${p.title} ${p.content}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return { posts: filtered } as T;
  }
  if (pathname === '/wisdom' && method === 'POST') {
    const post: WisdomPost = {
      id: uid('wis'),
      anonymousHandle: 'Local Voice',
      isMine: true,
      postType: String(body.postType || 'lesson'),
      category: String(body.category || 'Life'),
      title: String(body.title || ''),
      content: String(body.content || ''),
      helpfulCount: 0,
      resonateCount: 0,
      userHelpful: false,
      userResonate: false,
      userSaved: false,
      replies: [],
      createdAt: nowIso(),
    };
    db.wisdomPosts.unshift(post);
    saveDb(db);
    return { post } as T;
  }
  if (pathname.startsWith('/wisdom/') && method === 'POST') {
    const parts = pathname.split('/').filter(Boolean);
    const id = decodeURIComponent(parts[1] || '');
    const sub = parts[2];
    const post = db.wisdomPosts.find((p) => p.id === id);
    if (!post) throw new Error('Post not found.');
    if (sub === 'react') {
      const kind = String(body.reactionType || body.reaction || 'helpful');
      let active = false;
      if (kind === 'helpful') {
        post.userHelpful = !post.userHelpful;
        post.helpfulCount = Math.max(0, post.helpfulCount + (post.userHelpful ? 1 : -1));
        active = post.userHelpful;
      } else if (kind === 'resonate') {
        post.userResonate = !post.userResonate;
        post.resonateCount = Math.max(0, post.resonateCount + (post.userResonate ? 1 : -1));
        active = post.userResonate;
      } else if (kind === 'save') {
        post.userSaved = !post.userSaved;
        active = post.userSaved;
      }
      saveDb(db);
      return { active, post } as T;
    }
    if (sub === 'replies') {
      post.replies.push({
        id: uid('rep'),
        anonymousHandle: 'Local Voice',
        isMine: true,
        content: String(body.content || ''),
        createdAt: nowIso(),
      });
      saveDb(db);
      return { post } as T;
    }
  }

  if (pathname === '/humanity' && method === 'GET') {
    const cat = qs.get('category');
    const q = (qs.get('q') || '').trim().toLowerCase();
    const savedOnly = qs.get('savedOnly') === 'true';
    const filtered = db.humanityPosts.filter((p) => {
      if (myBlockedSet.has(p.id)) return false;
      if (cat && cat !== 'All' && p.category !== cat) return false;
      if (savedOnly && !p.userSaved) return false;
      if (q && !`${p.title} ${p.content} ${p.approxRegion}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return { posts: filtered } as T;
  }
  if (pathname === '/humanity' && method === 'POST') {
    const regionRaw = String(body.approxRegion || 'Global');
    const region = REGION_COORDS[regionRaw] ? regionRaw : 'Global';
    const coords = REGION_COORDS[region];
    const post: HumanityPost = {
      id: uid('hum'),
      anonymousHandle: 'Local Witness',
      isMine: true,
      category: String(body.category || 'Kindness'),
      title: String(body.title || ''),
      content: String(body.content || ''),
      approxRegion: region,
      approxLat: typeof body.approxLat === 'number' ? body.approxLat : coords.lat,
      approxLng: typeof body.approxLng === 'number' ? body.approxLng : coords.lng,
      helpfulCount: 0,
      userHelpful: false,
      userSaved: false,
      replies: [],
      createdAt: nowIso(),
    };
    db.humanityPosts.unshift(post);
    saveDb(db);
    return { post } as T;
  }
  if (pathname.startsWith('/humanity/') && method === 'POST') {
    const parts = pathname.split('/').filter(Boolean);
    const id = decodeURIComponent(parts[1] || '');
    const sub = parts[2];
    const post = db.humanityPosts.find((p) => p.id === id);
    if (!post) throw new Error('Story not found.');
    if (sub === 'react') {
      const kind = String(body.reactionType || body.reaction || 'helpful');
      let active = false;
      if (kind === 'helpful') {
        post.userHelpful = !post.userHelpful;
        post.helpfulCount = Math.max(0, post.helpfulCount + (post.userHelpful ? 1 : -1));
        active = post.userHelpful;
      } else if (kind === 'save') {
        post.userSaved = !post.userSaved;
        active = post.userSaved;
      }
      saveDb(db);
      return { active, post } as T;
    }
    if (sub === 'replies') {
      post.replies.push({
        id: uid('rep'),
        anonymousHandle: 'Local Witness',
        isMine: true,
        content: String(body.content || ''),
        createdAt: nowIso(),
      });
      saveDb(db);
      return { post } as T;
    }
  }
  if (pathname === '/community/block' && method === 'POST') {
    const targetId = String(body.targetId || body.userId || '').trim();
    if (targetId) {
      db.blockedTargets = db.blockedTargets || {};
      const existing = db.blockedTargets[user.id] || [];
      if (!existing.includes(targetId)) {
        db.blockedTargets[user.id] = [...existing, targetId];
        saveDb(db);
      }
    }
    return { blocked: true, ok: true } as T;
  }
  if (pathname === '/community/report' && method === 'POST') {
    return { reported: true, ok: true } as T;
  }

  // ==================== SKILLSWAP ====================
  if (pathname === '/skills/profile' && method === 'GET') {
    let profile = db.skillProfiles.find((s) => s.userId === user.id);
    if (!profile) {
      profile = {
        userId: user.id,
        displayName: user.displayName,
        teachSkills: [],
        learnSkills: [],
        experienceLevel: 'Intermediate',
        bio: user.bio || '',
        languages: ['English'],
        availability: 'Weekends',
        mode: 'Online & In-Person',
        locationCity: user.locationHint || '',
        portfolioUrl: '',
        interests: [],
      };
      db.skillProfiles.push(profile);
      saveDb(db);
    }
    return { profile } as T;
  }
  if (pathname === '/skills/profile' && method === 'PUT') {
    let profile = db.skillProfiles.find((s) => s.userId === user.id);
    if (!profile) {
      profile = {
        userId: user.id,
        displayName: user.displayName,
        teachSkills: [],
        learnSkills: [],
        experienceLevel: 'Intermediate',
        bio: '',
        languages: ['English'],
        availability: 'Flexible',
        mode: 'Online & In-Person',
        locationCity: '',
        portfolioUrl: '',
        interests: [],
      };
      db.skillProfiles.push(profile);
    }
    Object.assign(profile, body, { userId: user.id, displayName: user.displayName });
    saveDb(db);
    return { profile } as T;
  }
  if (pathname === '/skills/discover' && method === 'GET') {
    const q = (qs.get('q') || '').trim().toLowerCase();
    const modeFilter = qs.get('mode');
    const myProfile = db.skillProfiles.find((s) => s.userId === user.id);
    const myTeachLower = new Set((myProfile?.teachSkills || []).map((s) => s.toLowerCase()));
    const myLearnLower = new Set((myProfile?.learnSkills || []).map((s) => s.toLowerCase()));

    let listings = db.skillProfiles
      .filter((s) => s.userId !== user.id && !myBlockedSet.has(s.userId))
      .map((p) => {
        const theyTeachWhatIWant = p.teachSkills.filter((s) => myLearnLower.has(s.toLowerCase()));
        const theyWantWhatITeach = p.learnSkills.filter((s) => myTeachLower.has(s.toLowerCase()));
        const isMutualMatch = theyTeachWhatIWant.length > 0 && theyWantWhatITeach.length > 0;
        const matchScore = theyTeachWhatIWant.length * 40 + theyWantWhatITeach.length * 40 + (isMutualMatch ? 20 : 0);
        return {
          ...p,
          theyTeachWhatIWant,
          theyWantWhatITeach,
          isMutualMatch,
          matchScore,
        };
      });

    if (modeFilter && modeFilter !== 'All') {
      listings = listings.filter((l) => l.mode.toLowerCase().includes(modeFilter.toLowerCase()));
    }
    if (q) {
      listings = listings.filter(
        (l) =>
          (l.displayName || '').toLowerCase().includes(q) ||
          l.teachSkills.some((s) => s.toLowerCase().includes(q)) ||
          l.learnSkills.some((s) => s.toLowerCase().includes(q)) ||
          l.locationCity.toLowerCase().includes(q)
      );
    }
    listings.sort((a, b) => b.matchScore - a.matchScore);
    return { listings } as T;
  }
  if (pathname === '/skills/exchanges' && method === 'GET') {
    return {
      exchanges: db.skillExchanges.filter(
        (e) => e.requesterId === user.id || e.recipientId === user.id
      ),
    } as T;
  }
  if (pathname === '/skills/exchanges' && method === 'POST') {
    const recipient = db.users.find((u) => u.id === String(body.recipientId || ''));
    const ex: SkillExchange = {
      id: uid('exc'),
      requesterId: user.id,
      recipientId: String(body.recipientId || ''),
      requesterName: user.displayName,
      recipientName: String(body.recipientName || recipient?.displayName || 'Partner'),
      offeredSkill: String(body.offeredSkill || ''),
      requestedSkill: String(body.requestedSkill || ''),
      message: String(body.message || ''),
      status: 'pending',
      scheduledAt: null,
      sessionNotes: '',
      requesterConfirmed: false,
      recipientConfirmed: false,
      feedbackRating: null,
      feedbackNote: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.skillExchanges.push(ex);
    saveDb(db);
    return { id: ex.id, status: ex.status, exchange: ex } as T;
  }
  if (pathname.startsWith('/skills/exchanges/')) {
    const parts = pathname.split('/').filter(Boolean);
    const id = decodeURIComponent(parts[2] || '');
    const sub = parts[3];
    const ex = db.skillExchanges.find((e) => e.id === id && (e.requesterId === user.id || e.recipientId === user.id));
    if (!ex) throw new Error(sub === 'messages' ? 'Access denied.' : 'Exchange not found.');
    if (sub === 'messages' && method === 'GET') {
      return { messages: db.exchangeMessages[id] || [] } as T;
    }
    if (sub === 'messages' && method === 'POST') {
      const content = String(body.content || '').trim();
      if (!content) throw new Error('Message content cannot be empty.');
      const msg: ExchangeMessage = {
        id: uid('msg'),
        sender_id: user.id,
        sender_name: user.displayName,
        content: content.slice(0, 2000),
        created_at: nowIso(),
      };
      db.exchangeMessages[id] = [...(db.exchangeMessages[id] || []), msg];
      saveDb(db);
      return { message: msg } as T;
    }
    if (method === 'PATCH') {
      const action = String(body.action || '');
      const isRequester = ex.requesterId === user.id;
      const isRecipient = ex.recipientId === user.id;
      if (action === 'accept') {
        if (!isRecipient || ex.status !== 'pending') throw new Error('Only pending requests can be accepted by the recipient.');
        ex.status = 'accepted';
      } else if (action === 'reject') {
        if (!isRecipient || ex.status !== 'pending') throw new Error('Only pending requests can be rejected by the recipient.');
        ex.status = 'rejected';
      } else if (action === 'cancel') {
        if (!['pending', 'accepted', 'scheduled'].includes(ex.status)) throw new Error('This exchange cannot be cancelled.');
        ex.status = 'cancelled';
      } else if (action === 'schedule') {
        const scheduledMs = body.scheduledAt ? Date.parse(String(body.scheduledAt)) : NaN;
        if (!['accepted', 'scheduled'].includes(ex.status) || !Number.isFinite(scheduledMs)) {
          throw new Error('Accepted exchange and valid session date are required.');
        }
        ex.status = 'scheduled';
        ex.scheduledAt = new Date(scheduledMs).toISOString();
        ex.sessionNotes = String(body.sessionNotes || '').slice(0, 500);
      } else if (action === 'confirm_complete') {
        if (!['accepted', 'scheduled'].includes(ex.status)) throw new Error('Only active exchanges can be confirmed.');
        if (isRequester) ex.requesterConfirmed = true;
        if (isRecipient) ex.recipientConfirmed = true;
        if (ex.requesterConfirmed && ex.recipientConfirmed) ex.status = 'completed';
      } else if (action === 'feedback') {
        if (ex.status !== 'completed') throw new Error('Feedback can only be left after completion.');
        ex.feedbackRating = Math.min(Math.max(Number(body.feedbackRating) || 5, 1), 5);
        ex.feedbackNote = String(body.feedbackNote || '').slice(0, 500);
      } else {
        throw new Error('Invalid exchange action.');
      }
      ex.updatedAt = nowIso();
      saveDb(db);
      return { ok: true, exchange: ex } as T;
    }
    if (method === 'PUT') {
      Object.assign(ex, body, { updatedAt: nowIso() });
      saveDb(db);
      return { exchange: ex } as T;
    }
  }

  // ==================== AI MEMORY & ASSISTANCE ====================
  if (pathname === '/ai/history' && method === 'GET') {
    return { messages: db.aiMessages.filter((m) => m.userId === user.id) } as T;
  }
  if (pathname === '/ai/history' && method === 'DELETE') {
    db.aiMessages = db.aiMessages.filter((m) => m.userId !== user.id);
    saveDb(db);
    return { ok: true } as T;
  }
  if (pathname === '/ai/query' && method === 'POST') {
    const question = String(body.question || '').trim();
    const tokens = question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const sources: AiSource[] = [];
    const snippets: string[] = [];

    for (const m of userMemories) {
      if (m.aiExcluded) continue;
      const hay = `${m.title} ${m.content} ${m.tags.join(' ')} ${m.people.join(' ')}`.toLowerCase();
      if (tokens.length === 0 || tokens.some((t) => hay.includes(t))) {
        sources.push({ kind: 'memory', id: m.id, title: m.title, date: m.memoryDate });
        snippets.push(`- **${m.title}** (${m.memoryDate}): ${m.content.slice(0, 140)}`);
        if (sources.length >= 4) break;
      }
    }

    const formatted =
      snippets.length > 0
        ? `From your on-device ECHO archive, here are the closest entries matching "${question}":\n\n${snippets.join('\n')}`
        : `No saved memories matched "${question}" yet in your on-device archive. Add memories or connect a live ECHO server for deeper synthesis.`;

    const userMsg: AiChatMessage & { userId: string } = {
      id: uid('ai'),
      userId: user.id,
      module: 'memory_ai',
      role: 'user',
      content: question,
      sources: [],
      createdAt: nowIso(),
    };
    const asstMsg: AiChatMessage & { userId: string } = {
      id: uid('ai'),
      userId: user.id,
      module: 'memory_ai',
      role: 'assistant',
      content: formatted,
      sources,
      createdAt: nowIso(),
    };
    db.aiMessages.push(userMsg, asstMsg);
    saveDb(db);

    return {
      id: asstMsg.id,
      formatted,
      followUpQuestions: ['What moments stood out most this month?', 'Summarize my favorite memories'],
      sources,
      createdAt: asstMsg.createdAt,
    } as T;
  }

  if (pathname === '/ai/assist' && method === 'POST') {
    if (!user.aiConsent) {
      throw new Error('AI features are disabled in your privacy settings.');
    }
    const mode = String(body.mode || 'writing_polish');
    const text = String(body.text || body.content || '').trim();
    const firstLine = text.split(/[.!?\n]/)[0]?.trim() || 'Captured Moment';
    if (mode === 'dream_reflection') {
      return {
        title: firstLine.slice(0, 52),
        summary: text.slice(0, 180),
        suggestion: text
          ? `What feeling lingered most strongly when waking from "${firstLine.slice(0, 40)}", and what waking-life thread does that imagery echo?`
          : 'Describe the main symbol or atmosphere of your dream to explore a personal journaling prompt.',
        disclaimer: 'Personal journaling aid in on-device mode — never medical advice or dream prediction.',
      } as T;
    }
    return {
      title: firstLine.slice(0, 52),
      summary: text.slice(0, 180),
      suggestion: text
        ? `Notice the recurring mood and anchor details in "${firstLine.slice(0, 40)}".`
        : 'Add a few sensory details about where you were and how the moment felt.',
      disclaimer: 'Generated locally in on-device standalone mode.',
    } as T;
  }

  if (pathname === '/ai/analyze-sentiment' && method === 'POST') {
    if (!user.aiConsent) {
      throw new Error('AI features are disabled in your privacy settings.');
    }
    const title = String(body.title || '');
    const content = String(body.content || '').trim();
    const mood = String(body.mood || '');
    if (!content) {
      throw new Error('Memory content is required for sentiment analysis.');
    }
    const res = classifySentiment(`${title} ${content}`, mood);
    return {
      tone: res.sentimentTone,
      suggestedMood: res.sentimentTone || mood || 'Reflective',
      emotionalImpact: res.emotionalImpact,
      valenceScore: res.sentimentScore,
      rationale: res.sentimentRationale,
    } as T;
  }

  if (pathname === '/ai/transcribe' && method === 'POST') {
    return {
      transcript: '',
      fallbackMode: 'browser_speech',
    } as T;
  }

  if (pathname === '/ai/monthly-reflection' && method === 'POST') {
    const localDate = String(body.localDate || todayIso());
    const periodKey = 'last-30-days';
    const [y, m, d] = localDate.split('-').map(Number);
    const start30Date = new Date(Date.UTC(y, m - 1, d - 29)).toISOString().slice(0, 10);
    const monthCheckIns = userMemories.filter(
      (mem) =>
        !mem.aiExcluded &&
        mem.memoryDate >= start30Date &&
        mem.memoryDate <= localDate &&
        (mem.category.toLowerCase() === 'daily check-in' ||
          mem.tags.some((t) => t.toLowerCase() === 'daily-checkin'))
    );
    const reflection = {
      periodKey,
      summary:
        monthCheckIns.length > 0
          ? `You logged ${monthCheckIns.length} check-in(s) over the last 30 days in your private on-device archive.`
          : 'Log daily check-ins to build a personal reflection.',
      themes: monthCheckIns.slice(0, 2).map((mem) => ({
        name: mem.mood || 'Reflection',
        insight: mem.content.slice(0, 120),
        memoryIds: [mem.id],
      })),
      emotionalArc: monthCheckIns[0]?.mood ? `Anchored around ${monthCheckIns[0].mood}` : 'Steady',
      gentlePrompt: 'What small detail from this week do you want your future self to remember?',
      checkInCount: monthCheckIns.length,
      sourceIds: monthCheckIns.map((mem) => mem.id),
      generatedAt: nowIso(),
    };
    db.monthlyReflections[`${user.id}_${periodKey}`] = reflection;
    saveDb(db);
    return { reflection } as T;
  }

  // ==================== SEARCH, NOTIFICATIONS, MEDIA USAGE ====================
  if (pathname === '/search' && method === 'GET') {
    const q = (qs.get('q') || '').trim().toLowerCase();
    if (!q) return { results: [] } as T;
    const results: SearchResult[] = [];
    for (const m of userMemories) {
      if (`${m.title} ${m.content} ${m.locationName} ${m.tags.join(' ')}`.toLowerCase().includes(q)) {
        results.push({ id: m.id, module: 'memories', title: m.title, subtitle: m.category, date: m.memoryDate });
      }
    }
    for (const c of db.capsules.filter((x) => x.userId === user.id)) {
      const canReveal = !c.isLocked || Date.parse(c.unlockAt) <= Date.now();
      const hay = canReveal ? `${c.title} ${c.message || ''}` : c.title;
      if (hay.toLowerCase().includes(q)) {
        results.push({ id: c.id, module: 'capsules', title: c.title, subtitle: c.capsuleType, date: c.unlockAt });
      }
    }
    for (const o of db.objects.filter((x) => x.userId === user.id)) {
      if (`${o.name} ${o.story} ${o.description}`.toLowerCase().includes(q)) {
        results.push({ id: o.id, module: 'objects', title: o.name, subtitle: o.category, date: o.acquisitionDate });
      }
    }
    for (const d of db.dreams.filter((x) => x.userId === user.id)) {
      if (`${d.title} ${d.content} ${d.tags.join(' ')}`.toLowerCase().includes(q)) {
        results.push({ id: d.id, module: 'dreams', title: d.title, subtitle: d.emotion, date: d.dreamDate });
      }
    }
    for (const w of db.wisdomPosts) {
      if (!myBlockedSet.has(w.id) && `${w.title} ${w.content}`.toLowerCase().includes(q)) {
        results.push({ id: w.id, module: 'wisdom', title: w.title, subtitle: w.category, date: w.createdAt });
      }
    }
    for (const h of db.humanityPosts) {
      if (!myBlockedSet.has(h.id) && `${h.title} ${h.content}`.toLowerCase().includes(q)) {
        results.push({ id: h.id, module: 'humanity', title: h.title, subtitle: h.approxRegion, date: h.createdAt });
      }
    }
    for (const s of db.skillProfiles) {
      if (s.userId !== user.id && !myBlockedSet.has(s.userId)) {
        const hay = `${s.displayName || ''} ${s.teachSkills.join(' ')} ${s.learnSkills.join(' ')}`.toLowerCase();
        if (hay.includes(q)) {
          results.push({
            id: s.userId,
            module: 'skillswap',
            title: s.displayName || 'Community Member',
            subtitle: s.teachSkills.length > 0 ? `Teaches: ${s.teachSkills.slice(0, 3).join(', ')}` : 'SkillSwap member',
            date: nowIso(),
          });
        }
      }
    }
    return { results: results.slice(0, 24) } as T;
  }

  if (pathname === '/notifications' && method === 'GET') {
    return {
      notifications: db.notifications
        .filter((n) => n.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    } as T;
  }
  if (pathname.startsWith('/notifications/') && pathname.endsWith('/read') && method === 'POST') {
    const id = decodeURIComponent(pathname.split('/')[2] || '');
    const notif = db.notifications.find((n) => n.id === id && n.userId === user.id);
    if (notif) notif.isRead = true;
    saveDb(db);
    return { ok: true } as T;
  }
  if (pathname === '/notifications/read-all' && method === 'POST') {
    for (const n of db.notifications) {
      if (n.userId === user.id) n.isRead = true;
    }
    saveDb(db);
    return { ok: true } as T;
  }

  if (pathname === '/media/usage' && method === 'GET') {
    const mine = db.media.filter((m) => m.userId === user.id);
    const totalBytes = mine.reduce((sum, m) => sum + (m.sizeBytes || 0), 0);
    return { totalBytes, fileCount: mine.length } as T;
  }

  throw new Error(`Endpoint not supported in on-device mode: ${pathname}`);
}
