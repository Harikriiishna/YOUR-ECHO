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

interface StoredSession {
  id: string;
  token: string;
  userId: string;
  deviceLabel: string;
  createdAt: string;
}

interface StoredUser extends AuthUser {
  passwordHash: string;
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
  return new Date().toISOString().slice(0, 10);
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
  const { passwordHash: _ignored, ...pub } = u;
  return pub;
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
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
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
    const token = uid('tok');
    db.sessions.push({
      id: uid('ses'),
      token,
      userId: user.id,
      deviceLabel: String(body.deviceLabel || 'Android On-Device'),
      createdAt: nowIso(),
    });
    db.currentToken = token;
    saveDb(db);
    return { user: toPublicUser(user), token } as T;
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
    if (!userId || newPassword.length < 6) {
      throw new Error('Invalid reset token or password too short.');
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
    if (nextPw.length < 6) throw new Error('New password must be at least 6 characters.');
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
    db.sessions = db.sessions.filter((s) => !(s.id === id && s.userId === user.id));
    saveDb(db);
    return { ok: true } as T;
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
    return { ok: true } as T;
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
    let streak = 0;
    const cursor = new Date(`${localDate}T12:00:00Z`);
    while (checkInDates.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    const mmdd = localDate.slice(5);
    const onThisDay = userMemories
      .filter((m) => m.memoryDate.slice(5) === mmdd && m.memoryDate !== localDate)
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

    const periodKey = localDate.slice(0, 7);
    const savedReflection = db.monthlyReflections[`${user.id}_${periodKey}`] || null;

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
        todayEntries: todayEntries.map((m) => ({
          id: m.id,
          title: m.title,
          content: m.content,
          mood: m.mood,
          memoryDate: m.memoryDate,
          createdAt: m.createdAt,
        })),
        history: checkIns.slice(0, 30).map((m) => ({
          id: m.id,
          title: m.title,
          memoryDate: m.memoryDate,
          mood: m.mood,
          sentimentTone: m.sentimentTone,
          emotionalImpact: m.emotionalImpact,
          sentimentScore: m.sentimentScore,
          sentimentRationale: m.sentimentRationale,
          aiExcluded: m.aiExcluded,
          excerpt: m.content.slice(0, 140),
          createdAt: m.createdAt,
        })),
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
    const impact = qs.get('impact');
    const fav = qs.get('favorite') === 'true';
    const colId = qs.get('collectionId');
    const person = qs.get('person');
    const tagsRaw = qs.get('tags');
    const tagMode = qs.get('tagMode') === 'all' ? 'all' : 'any';
    const month = qs.get('month');

    const filtered = userMemories.filter((m) => {
      if (q) {
        const hay = `${m.title} ${m.content} ${m.locationName} ${m.tags.join(' ')} ${m.people.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (cat && m.category.toLowerCase() !== cat.toLowerCase()) return false;
      if (mood && m.mood.toLowerCase() !== mood.toLowerCase() && m.sentimentTone.toLowerCase() !== mood.toLowerCase()) return false;
      if (impact && m.emotionalImpact.toLowerCase() !== impact.toLowerCase()) return false;
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
      .filter((med) => mediaIds.includes(med.id))
      .map((med) => ({
        id: med.id,
        original_name: med.originalName,
        mime_type: med.mimeType,
        size_bytes: med.sizeBytes,
        transcript: med.transcript,
      }));
    const item: MemoryItem & { userId: string } = {
      id: uid('mem'),
      userId: user.id,
      title: String(body.title || '').trim() || 'Untitled Memory',
      content: String(body.content || '').trim(),
      memoryDate: String(body.memoryDate || todayIso()),
      locationName: String(body.locationName || ''),
      latitude: typeof body.latitude === 'number' ? body.latitude : null,
      longitude: typeof body.longitude === 'number' ? body.longitude : null,
      mood: String(body.mood || 'Reflective'),
      category: String(body.category || 'Personal'),
      isFavorite: Boolean(body.isFavorite),
      aiExcluded: Boolean(body.aiExcluded),
      aiSummary: String(body.aiSummary || ''),
      sentimentTone: String(body.sentimentTone || ''),
      emotionalImpact: String(body.emotionalImpact || ''),
      sentimentScore: typeof body.sentimentScore === 'number' ? body.sentimentScore : null,
      sentimentRationale: String(body.sentimentRationale || ''),
      collectionId: body.collectionId ? String(body.collectionId) : null,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
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
      if (body.aiExcluded !== undefined) mem.aiExcluded = Boolean(body.aiExcluded);
      if (body.aiSummary !== undefined) mem.aiSummary = String(body.aiSummary);
      if (body.collectionId !== undefined) mem.collectionId = body.collectionId ? String(body.collectionId) : null;
      if (Array.isArray(body.tags)) mem.tags = body.tags.map(String);
      if (Array.isArray(body.people)) mem.people = body.people.map(String);
      if (Array.isArray(body.mediaIds)) {
        const ids = body.mediaIds.map(String);
        mem.media = db.media
          .filter((med) => ids.includes(med.id))
          .map((med) => ({
            id: med.id,
            original_name: med.originalName,
            mime_type: med.mimeType,
            size_bytes: med.sizeBytes,
          }));
      }
      mem.updatedAt = nowIso();
      saveDb(db);
      return { memory: mem } as T;
    }

    if (!sub && method === 'DELETE') {
      db.memories = db.memories.filter((m) => m.id !== id);
      saveDb(db);
      return { ok: true } as T;
    }

    if (sub === 'favorite' && method === 'POST') {
      mem.isFavorite = !mem.isFavorite;
      mem.updatedAt = nowIso();
      saveDb(db);
      return { isFavorite: mem.isFavorite } as T;
    }

    if (sub === 'tags' && method === 'POST') {
      mem.tags = Array.isArray(body.tags) ? Array.from(new Set(body.tags.map(String))) : mem.tags;
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
      const res = classifySentiment(`${mem.title} ${mem.content}`, mem.mood);
      mem.sentimentTone = res.sentimentTone;
      mem.emotionalImpact = res.emotionalImpact;
      mem.sentimentScore = res.sentimentScore;
      mem.sentimentRationale = res.sentimentRationale;
      mem.updatedAt = nowIso();
      saveDb(db);
      return { memory: mem } as T;
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

  // ==================== OBJECTS ====================
  if (pathname === '/objects' && method === 'GET') {
    const q = (qs.get('q') || '').trim().toLowerCase();
    const list = db.objects
      .filter((o) => o.userId === user.id)
      .filter((o) => !q || `${o.name} ${o.story} ${o.category}`.toLowerCase().includes(q));
    return { objects: list } as T;
  }

  if (pathname === '/objects' && method === 'POST') {
    const obj: EchoObject & { userId: string } = {
      id: uid('obj'),
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
      shareSlug: null,
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
        tags: Array.isArray(body.tags) ? body.tags.map(String) : obj.tags,
        updatedAt: nowIso(),
      });
      saveDb(db);
      return { object: obj } as T;
    }
    if (!sub && method === 'DELETE') {
      db.objects = db.objects.filter((o) => o.id !== id);
      saveDb(db);
      return { ok: true } as T;
    }
    if (sub === 'share' && method === 'POST') {
      obj.isPublic = Boolean(body.isPublic ?? true);
      if (!obj.shareSlug) obj.shareSlug = `obj-${obj.id.slice(-8)}`;
      saveDb(db);
      const shareUrl = `${window.location.origin}/?sharedObject=${encodeURIComponent(obj.shareSlug)}`;
      return {
        qrDataUrl: '',
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
      if (d.emotion) emotions.set(d.emotion, (emotions.get(d.emotion) || 0) + 1);
      for (const t of d.tags) tags.set(t, (tags.get(t) || 0) + 1);
      if (d.isRecurring) recurringCount += 1;
    }
    return {
      totalDreams: userDreams.length,
      recurringCount,
      emotions: Array.from(emotions.entries()).map(([emotion, count]) => ({ emotion, count })),
      topThemes: Array.from(tags.entries()).map(([tag, count]) => ({ tag, count })).slice(0, 8),
    } as T;
  }

  if (pathname === '/dreams' && method === 'GET') {
    const q = (qs.get('q') || '').trim().toLowerCase();
    const list = db.dreams
      .filter((d) => d.userId === user.id)
      .filter((d) => !q || `${d.title} ${d.content} ${d.tags.join(' ')}`.toLowerCase().includes(q))
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
      db.dreams = db.dreams.filter((d) => d.id !== id);
      saveDb(db);
      return { ok: true } as T;
    }
  }

  // ==================== TIME CAPSULES ====================
  if (pathname === '/capsules' && method === 'GET') {
    const list = db.capsules
      .filter((c) => c.userId === user.id)
      .map((c) => {
        const matured = Date.parse(c.unlockAt) <= Date.now();
        return {
          ...c,
          isMatured: matured,
          isOpenable: c.isLocked && matured,
          message: c.isLocked && !c.openedAt ? null : c.message,
        };
      });
    return { capsules: list } as T;
  }

  if (pathname === '/capsules' && method === 'POST') {
    const cap: TimeCapsuleItem & { userId: string } = {
      id: uid('cap'),
      userId: user.id,
      title: String(body.title || 'Future Letter'),
      message: String(body.message || ''),
      capsuleType: String(body.capsuleType || 'Letter'),
      unlockOccasion: String(body.unlockOccasion || ''),
      unlockAt: String(body.unlockAt || nowIso()),
      timezone: String(body.timezone || user.timezone || 'UTC'),
      isLocked: false,
      isMatured: false,
      isOpenable: false,
      openedAt: null,
      media: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.capsules.push(cap);
    saveDb(db);
    return { capsule: cap } as T;
  }

  if (pathname.startsWith('/capsules/')) {
    const parts = pathname.split('/').filter(Boolean);
    const id = decodeURIComponent(parts[1] || '');
    const sub = parts[2];
    const cap = db.capsules.find((c) => c.id === id && c.userId === user.id);
    if (!cap) throw new Error('Time capsule not found.');

    if (!sub && method === 'PUT') {
      if (cap.isLocked) throw new Error('Sealed capsules cannot be edited.');
      Object.assign(cap, {
        title: body.title !== undefined ? String(body.title) : cap.title,
        message: body.message !== undefined ? String(body.message) : cap.message,
        capsuleType: body.capsuleType !== undefined ? String(body.capsuleType) : cap.capsuleType,
        unlockOccasion: body.unlockOccasion !== undefined ? String(body.unlockOccasion) : cap.unlockOccasion,
        unlockAt: body.unlockAt !== undefined ? String(body.unlockAt) : cap.unlockAt,
        updatedAt: nowIso(),
      });
      saveDb(db);
      return { capsule: cap } as T;
    }
    if (!sub && method === 'DELETE') {
      db.capsules = db.capsules.filter((c) => c.id !== id);
      saveDb(db);
      return { ok: true } as T;
    }
    if (sub === 'lock' && method === 'POST') {
      cap.isLocked = true;
      cap.updatedAt = nowIso();
      saveDb(db);
      return { capsule: cap } as T;
    }
    if (sub === 'open' && method === 'POST') {
      if (Date.parse(cap.unlockAt) > Date.now()) {
        throw new Error('This capsule has not reached its unlock date yet.');
      }
      cap.openedAt = nowIso();
      cap.isLocked = false;
      saveDb(db);
      return { capsule: cap } as T;
    }
  }

  // ==================== WISDOM & HUMANITY ====================
  if (pathname === '/wisdom' && method === 'GET') {
    return { posts: db.wisdomPosts } as T;
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
      const kind = String(body.reaction || 'helpful');
      if (kind === 'helpful') {
        post.userHelpful = !post.userHelpful;
        post.helpfulCount += post.userHelpful ? 1 : -1;
      } else if (kind === 'resonate') {
        post.userResonate = !post.userResonate;
        post.resonateCount += post.userResonate ? 1 : -1;
      } else if (kind === 'save') {
        post.userSaved = !post.userSaved;
      }
      saveDb(db);
      return { post } as T;
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
    return { posts: db.humanityPosts } as T;
  }
  if (pathname === '/humanity' && method === 'POST') {
    const post: HumanityPost = {
      id: uid('hum'),
      anonymousHandle: 'Local Witness',
      isMine: true,
      category: String(body.category || 'Kindness'),
      title: String(body.title || ''),
      content: String(body.content || ''),
      approxRegion: String(body.approxRegion || 'Local'),
      approxLat: typeof body.approxLat === 'number' ? body.approxLat : null,
      approxLng: typeof body.approxLng === 'number' ? body.approxLng : null,
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
      const kind = String(body.reaction || 'helpful');
      if (kind === 'helpful') {
        post.userHelpful = !post.userHelpful;
        post.helpfulCount += post.userHelpful ? 1 : -1;
      } else if (kind === 'save') {
        post.userSaved = !post.userSaved;
      }
      saveDb(db);
      return { post } as T;
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
  if ((pathname === '/community/block' || pathname === '/community/report') && method === 'POST') {
    return { ok: true } as T;
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
        mode: 'Remote',
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
        mode: 'Remote',
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
    return { listings: db.skillProfiles.filter((s) => s.userId !== user.id) } as T;
  }
  if (pathname === '/skills/exchanges' && method === 'GET') {
    return {
      exchanges: db.skillExchanges.filter(
        (e) => e.requesterId === user.id || e.recipientId === user.id
      ),
    } as T;
  }
  if (pathname === '/skills/exchanges' && method === 'POST') {
    const ex: SkillExchange = {
      id: uid('exc'),
      requesterId: user.id,
      recipientId: String(body.recipientId || ''),
      requesterName: user.displayName,
      recipientName: String(body.recipientName || 'Partner'),
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
    return { exchange: ex } as T;
  }
  if (pathname.startsWith('/skills/exchanges/')) {
    const parts = pathname.split('/').filter(Boolean);
    const id = decodeURIComponent(parts[2] || '');
    const sub = parts[3];
    if (sub === 'messages' && method === 'GET') {
      return { messages: db.exchangeMessages[id] || [] } as T;
    }
    if (sub === 'messages' && method === 'POST') {
      const msg: ExchangeMessage = {
        id: uid('msg'),
        sender_id: user.id,
        sender_name: user.displayName,
        content: String(body.content || ''),
        created_at: nowIso(),
      };
      db.exchangeMessages[id] = [...(db.exchangeMessages[id] || []), msg];
      saveDb(db);
      return { message: msg } as T;
    }
    const ex = db.skillExchanges.find((e) => e.id === id);
    if (!ex) throw new Error('Exchange not found.');
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
    const text = String(body.text || body.content || '').trim();
    const firstLine = text.split(/[.!?\n]/)[0]?.trim() || 'Captured Moment';
    return {
      title: firstLine.slice(0, 52),
      summary: text.slice(0, 180),
      suggestion: text
        ? `Notice the recurring mood and anchor details in "${firstLine.slice(0, 40)}".`
        : 'Add a few sensory details about where you were and how the moment felt.',
      disclaimer: 'Generated locally in on-device standalone mode.',
    } as T;
  }

  if (pathname === '/ai/transcribe' && method === 'POST') {
    return {
      transcript: 'Voice note saved on device. Connect a live ECHO server for cloud transcription.',
    } as T;
  }

  if (pathname === '/ai/monthly-reflection' && method === 'POST') {
    const localDate = String(body.localDate || todayIso());
    const periodKey = localDate.slice(0, 7);
    const monthCheckIns = userMemories.filter(
      (m) =>
        !m.aiExcluded &&
        (m.category.toLowerCase() === 'daily check-in' ||
          m.tags.some((t) => t.toLowerCase() === 'daily-checkin'))
    );
    const reflection = {
      periodKey,
      summary:
        monthCheckIns.length > 0
          ? `You logged ${monthCheckIns.length} check-in(s) in your private on-device archive.`
          : 'Log daily check-ins to build a personal reflection.',
      themes: monthCheckIns.slice(0, 2).map((m) => ({
        name: m.mood || 'Reflection',
        insight: m.content.slice(0, 120),
        memoryIds: [m.id],
      })),
      emotionalArc: monthCheckIns[0]?.mood ? `Anchored around ${monthCheckIns[0].mood}` : 'Steady',
      gentlePrompt: 'What small detail from this week do you want your future self to remember?',
      checkInCount: monthCheckIns.length,
      sourceIds: monthCheckIns.map((m) => m.id),
      generatedAt: nowIso(),
    };
    db.monthlyReflections[`${user.id}_${periodKey}`] = reflection;
    saveDb(db);
    return { reflection } as T;
  }

  // ==================== SEARCH, NOTIFICATIONS, MEDIA USAGE ====================
  if (pathname === '/search' && method === 'GET') {
    const q = (qs.get('q') || '').trim().toLowerCase();
    const results: SearchResult[] = [];
    for (const m of userMemories) {
      if (`${m.title} ${m.content} ${m.tags.join(' ')}`.toLowerCase().includes(q)) {
        results.push({ id: m.id, module: 'memories', title: m.title, subtitle: m.category, date: m.memoryDate });
      }
    }
    for (const d of db.dreams.filter((x) => x.userId === user.id)) {
      if (`${d.title} ${d.content}`.toLowerCase().includes(q)) {
        results.push({ id: d.id, module: 'dreams', title: d.title, subtitle: d.emotion, date: d.dreamDate });
      }
    }
    for (const o of db.objects.filter((x) => x.userId === user.id)) {
      if (`${o.name} ${o.story}`.toLowerCase().includes(q)) {
        results.push({ id: o.id, module: 'objects', title: o.name, subtitle: o.category, date: o.acquisitionDate });
      }
    }
    return { results: results.slice(0, 20) } as T;
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
