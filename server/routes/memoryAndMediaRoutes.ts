import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import {
  analyzeMemoryBatchSentiment,
  analyzeMemorySentiment,
  EMOTIONAL_IMPACT_LEVELS,
} from '../ai.ts';
import { type AuthenticatedRequest, optionalAuth, rateLimit, requireAuth } from '../auth.ts';
import { db, newId, UPLOADS_DIR } from '../db.ts';

export const memoryMediaRouter = Router();

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === value;
}

const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/'];
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
    cb(null, `${newId('med')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_PREFIXES.some((p) => file.mimetype.startsWith(p))) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Only image, audio, and video files are allowed.'));
    }
  },
});

const handleSingleMediaUpload = upload.single('file');

memoryMediaRouter.post(
  '/media/upload',
  requireAuth,
  (req: AuthenticatedRequest, res, next) => {
    handleSingleMediaUpload(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'File exceeds the 25MB upload limit.'
            : err.message;
        res.status(status).json({ error: message });
        return;
      }
      const message = err instanceof Error ? err.message : 'File upload failed.';
      res.status(400).json({ error: message });
    });
  },
  (req: AuthenticatedRequest, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }

  const contextType = String((req.body as { contextType?: string })?.contextType || 'general').slice(0, 40);
  const contextId = (req.body as { contextId?: string })?.contextId || null;
  const mediaId = newId('media');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO media_files (id, user_id, original_name, stored_name, mime_type, size_bytes, context_type, context_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(mediaId, req.authUser!.id, file.originalname.slice(0, 180), file.filename, file.mimetype, file.size, contextType, contextId, now);

  res.status(201).json({
    media: {
      id: mediaId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      contextType,
      url: `/api/media/${mediaId}`,
    },
  });
  }
);

memoryMediaRouter.get('/media/usage', requireAuth, (req: AuthenticatedRequest, res) => {
  const row = db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS totalBytes, COUNT(*) AS fileCount FROM media_files WHERE user_id = ?')
    .get(req.authUser!.id) as { totalBytes: number; fileCount: number };
  res.json(row);
});

memoryMediaRouter.get('/media/:id', optionalAuth, (req: AuthenticatedRequest, res) => {
  const media = db.prepare('SELECT * FROM media_files WHERE id = ?').get(req.params.id) as
    | {
        id: string;
        user_id: string;
        stored_name: string;
        mime_type: string;
        context_type: string;
        context_id: string | null;
      }
    | undefined;

  if (!media) {
    res.status(404).json({ error: 'Media not found.' });
    return;
  }

  const isOwner = Boolean(req.authUser && media.user_id === req.authUser.id);
  if (!isOwner) {
    // Allow viewing only if attached to a public object
    const publicObj = db
      .prepare('SELECT id FROM objects WHERE is_public = 1 AND (photo_media_id = ? OR voice_media_id = ?)')
      .get(media.id, media.id);
    if (!publicObj) {
      res.status(req.authUser ? 403 : 401).json({
        error: req.authUser ? 'Access denied.' : 'Authentication required.',
      });
      return;
    }
  }

  // Server-side enforcement: block media attached to a locked capsule before its unlock timestamp
  const lockedCapsules = db
    .prepare(`
      SELECT id, media_ids_json FROM time_capsules
      WHERE user_id = ? AND is_locked = 1 AND unlock_at > ?
    `)
    .all(media.user_id, new Date().toISOString()) as Array<{ id: string; media_ids_json: string }>;

  const lockedCapsule = lockedCapsules.some((cap) => {
    try {
      const parsed = JSON.parse(String(cap.media_ids_json || '[]'));
      return Array.isArray(parsed) && parsed.includes(media.id);
    } catch {
      return false;
    }
  });

  if (lockedCapsule) {
    res.status(403).json({ error: 'This media is sealed inside a locked Time Capsule until its unlock date.' });
    return;
  }

  const resolvedPath = path.resolve(UPLOADS_DIR, path.basename(media.stored_name));
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: 'Media file missing on disk.' });
    return;
  }

  res.setHeader('Content-Type', media.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(resolvedPath);
});

memoryMediaRouter.delete('/media/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const media = db
    .prepare('SELECT id, stored_name FROM media_files WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as { id: string; stored_name: string } | undefined;

  if (!media) {
    res.status(404).json({ error: 'Media not found.' });
    return;
  }

  db.prepare('DELETE FROM media_files WHERE id = ?').run(media.id);
  const resolved = path.resolve(UPLOADS_DIR, path.basename(media.stored_name));
  if (resolved.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
  res.json({ deleted: true });
});

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

function syncMemoryTags(memoryId: string, tags: string[]): void {
  db.prepare('UPDATE memories SET tags_json = ? WHERE id = ?').run(JSON.stringify(tags), memoryId);
  db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(memoryId);
  const insTag = db.prepare('INSERT INTO memory_tags (id, memory_id, tag) VALUES (?, ?, ?)');
  for (const t of tags) {
    insTag.run(newId('tag'), memoryId, t);
  }
}

function hydrateMemoryRow(row: Record<string, unknown>) {
  const id = String(row.id);
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(String(row.tags_json || '[]'));
    if (Array.isArray(parsed)) {
      tags = normalizeTags(parsed);
    }
  } catch {
    tags = [];
  }
  if (tags.length === 0) {
    const relTags = (db.prepare('SELECT tag FROM memory_tags WHERE memory_id = ?').all(id) as Array<{ tag: string }>).map(
      (t) => t.tag
    );
    tags = normalizeTags(relTags);
  }

  const people = (
    db.prepare('SELECT person_name FROM memory_people WHERE memory_id = ?').all(id) as Array<{ person_name: string }>
  ).map((p) => p.person_name);

  let mediaIds: string[] = [];
  try {
    mediaIds = JSON.parse(String(row.media_ids_json || '[]'));
  } catch {
    mediaIds = [];
  }

  const media =
    mediaIds.length > 0
      ? db
          .prepare(`SELECT id, original_name, mime_type, size_bytes, transcript FROM media_files WHERE id IN (${mediaIds.map(() => '?').join(',')})`)
          .all(...mediaIds)
      : [];

  return {
    id,
    title: String(row.title),
    content: String(row.content),
    memoryDate: String(row.memory_date),
    locationName: String(row.location_name || ''),
    latitude: row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== null ? Number(row.longitude) : null,
    mood: String(row.mood),
    category: String(row.category),
    isFavorite: Boolean(row.is_favorite),
    aiExcluded: Boolean(row.ai_excluded),
    aiSummary: String(row.ai_summary || ''),
    sentimentTone: String(row.sentiment_tone || ''),
    emotionalImpact: String(row.emotional_impact || ''),
    sentimentScore: row.sentiment_score !== null && row.sentiment_score !== undefined ? Number(row.sentiment_score) : null,
    sentimentRationale: String(row.sentiment_rationale || ''),
    collectionId: row.collection_id ? String(row.collection_id) : null,
    tags,
    people,
    media,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

memoryMediaRouter.get('/memories', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const { q, category, mood, tone, impact, impacts, favorite, collectionId, person, tag, tags, tagMode, month } =
    req.query as Record<string, string | undefined>;

  let sql = 'SELECT DISTINCT m.* FROM memories m';
  const joins: string[] = [];
  const wheres: string[] = ['m.user_id = ?'];
  const params: unknown[] = [userId];

  if (person) {
    joins.push('JOIN memory_people mp ON mp.memory_id = m.id');
    wheres.push('LOWER(mp.person_name) = LOWER(?)');
    params.push(person.trim());
  }

  const requestedTags = tags
    ? tags
        .split(',')
        .map((t) => t.trim().replace(/^#+/, ''))
        .filter(Boolean)
    : tag
      ? [tag.trim().replace(/^#+/, '')].filter(Boolean)
      : [];

  if (requestedTags.length > 0) {
    if (tagMode === 'all') {
      for (const reqTag of requestedTags) {
        wheres.push(
          'EXISTS (SELECT 1 FROM memory_tags mt_all WHERE mt_all.memory_id = m.id AND LOWER(mt_all.tag) = LOWER(?))'
        );
        params.push(reqTag);
      }
    } else {
      wheres.push(
        `EXISTS (SELECT 1 FROM memory_tags mt_any WHERE mt_any.memory_id = m.id AND LOWER(mt_any.tag) IN (${requestedTags
          .map(() => 'LOWER(?)')
          .join(',')}))`
      );
      params.push(...requestedTags);
    }
  }

  if (category && category !== 'All') {
    wheres.push('LOWER(m.category) = LOWER(?)');
    params.push(category.trim());
  }
  if (mood && mood !== 'All') {
    wheres.push('(LOWER(m.mood) = LOWER(?) OR LOWER(m.sentiment_tone) = LOWER(?))');
    params.push(mood, mood);
  }
  if (tone && tone !== 'All') {
    wheres.push('(LOWER(m.sentiment_tone) = LOWER(?) OR LOWER(m.mood) = LOWER(?))');
    params.push(tone, tone);
  }
  const requestedImpacts = impacts
    ? impacts
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : impact && impact !== 'All'
      ? [impact.trim()]
      : [];
  if (requestedImpacts.length > 0) {
    wheres.push(`LOWER(m.emotional_impact) IN (${requestedImpacts.map(() => 'LOWER(?)').join(',')})`);
    params.push(...requestedImpacts);
  }
  if (favorite === 'true') {
    wheres.push('m.is_favorite = 1');
  }
  if (collectionId) {
    wheres.push('m.collection_id = ?');
    params.push(collectionId);
  }
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    wheres.push('substr(m.memory_date, 1, 7) = ?');
    params.push(month);
  }
  if (q && q.trim()) {
    const like = `%${escapeLike(q.trim())}%`;
    wheres.push("(m.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\' OR m.location_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM memory_tags t2 WHERE t2.memory_id = m.id AND t2.tag LIKE ? ESCAPE '\\') OR EXISTS (SELECT 1 FROM memory_people p2 WHERE p2.memory_id = m.id AND p2.person_name LIKE ? ESCAPE '\\'))");
    params.push(like, like, like, like, like);
  }

  sql = `${sql} ${joins.join(' ')} WHERE ${wheres.join(' AND ')} ORDER BY m.memory_date DESC, m.created_at DESC`;
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json({ memories: rows.map(hydrateMemoryRow) });
});

memoryMediaRouter.get('/memories/tags', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare('SELECT id, tags_json FROM memories WHERE user_id = ?')
    .all(req.authUser!.id) as Array<{ id: string; tags_json: string }>;

  const tagCounts = new Map<string, { tag: string; count: number }>();
  for (const row of rows) {
    let list: string[] = [];
    try {
      list = normalizeTags(JSON.parse(row.tags_json || '[]'));
    } catch {
      list = [];
    }
    for (const tag of list) {
      const key = tag.toLowerCase();
      const existing = tagCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        tagCounts.set(key, { tag, count: 1 });
      }
    }
  }

  const tags = [...tagCounts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  res.json({ tags });
});

memoryMediaRouter.put('/memories/tags/rename', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const { oldTag, newTag } = req.body as { oldTag?: string; newTag?: string };
  const cleanOld = (oldTag || '').trim().replace(/^#+/, '').slice(0, 40);
  const cleanNew = (newTag || '').trim().replace(/^#+/, '').slice(0, 40);

  if (!cleanOld || !cleanNew) {
    res.status(400).json({ error: 'Both oldTag and newTag are required.' });
    return;
  }

  const rows = db
    .prepare('SELECT id, tags_json FROM memories WHERE user_id = ?')
    .all(userId) as Array<{ id: string; tags_json: string }>;

  let updatedCount = 0;
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const row of rows) {
      let current: string[] = [];
      try {
        current = normalizeTags(JSON.parse(row.tags_json || '[]'));
      } catch {
        current = [];
      }
      if (!current.some((t) => t.toLowerCase() === cleanOld.toLowerCase())) continue;

      const replaced = normalizeTags(
        current.map((t) => (t.toLowerCase() === cleanOld.toLowerCase() ? cleanNew : t))
      );
      syncMemoryTags(row.id, replaced);
      db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(now, row.id);
      updatedCount += 1;
    }
  })();

  res.json({ updatedCount, oldTag: cleanOld, newTag: cleanNew });
});

memoryMediaRouter.delete('/memories/tags/:tag', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const cleanTarget = decodeURIComponent(req.params.tag || '')
    .trim()
    .replace(/^#+/, '');

  if (!cleanTarget) {
    res.status(400).json({ error: 'Tag name is required.' });
    return;
  }

  const rows = db
    .prepare('SELECT id, tags_json FROM memories WHERE user_id = ?')
    .all(userId) as Array<{ id: string; tags_json: string }>;

  let updatedCount = 0;
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const row of rows) {
      let current: string[] = [];
      try {
        current = normalizeTags(JSON.parse(row.tags_json || '[]'));
      } catch {
        current = [];
      }
      const next = current.filter((t) => t.toLowerCase() !== cleanTarget.toLowerCase());
      if (next.length === current.length) continue;

      syncMemoryTags(row.id, next);
      db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(now, row.id);
      updatedCount += 1;
    }
  })();

  res.json({ updatedCount, deletedTag: cleanTarget });
});

memoryMediaRouter.get('/memories/sentiment-summary', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare('SELECT category, emotional_impact, sentiment_tone, mood, ai_excluded FROM memories WHERE user_id = ?')
    .all(req.authUser!.id) as Array<{
    category: string;
    emotional_impact: string;
    sentiment_tone: string;
    mood: string;
    ai_excluded: number;
  }>;

  const impactCounts: Record<string, number> = {};
  for (const lvl of EMOTIONAL_IMPACT_LEVELS) {
    impactCounts[lvl] = 0;
  }
  let unanalyzedCount = 0;
  let analyzableUnanalyzedCount = 0;
  const toneCounts = new Map<string, { tone: string; count: number }>();
  const categoryCountsMap = new Map<string, { category: string; count: number }>();

  for (const r of rows) {
    const cat = (r.category || '').trim();
    if (cat) {
      const catKey = cat.toLowerCase();
      const prevCat = categoryCountsMap.get(catKey);
      if (prevCat) prevCat.count += 1;
      else categoryCountsMap.set(catKey, { category: cat, count: 1 });
    }
    const imp = (r.emotional_impact || '').trim();
    if (imp) {
      impactCounts[imp] = (impactCounts[imp] || 0) + 1;
    } else {
      unanalyzedCount += 1;
      if (!r.ai_excluded) analyzableUnanalyzedCount += 1;
    }
    const tone = (r.sentiment_tone || r.mood || '').trim();
    if (tone) {
      const key = tone.toLowerCase();
      const prev = toneCounts.get(key);
      if (prev) prev.count += 1;
      else toneCounts.set(key, { tone, count: 1 });
    }
  }

  res.json({
    totalMemories: rows.length,
    unanalyzedCount,
    analyzableUnanalyzedCount,
    impactCounts,
    tones: [...toneCounts.values()].sort((a, b) => b.count - a.count || a.tone.localeCompare(b.tone)),
    categoryCounts: [...categoryCountsMap.values()].sort(
      (a, b) => b.count - a.count || a.category.localeCompare(b.category)
    ),
  });
});

memoryMediaRouter.post(
  '/memories/analyze-sentiment-batch',
  requireAuth,
  rateLimit('ai', 10, 60_000),
  async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    if (!user.aiConsent) {
      res.status(403).json({ error: 'AI features are currently disabled in your privacy settings.' });
      return;
    }

    const { memoryIds, applyMood } = req.body as { memoryIds?: string[]; applyMood?: boolean };
    let candidates: Array<{ id: string; title: string; content: string; mood: string }>;

    if (Array.isArray(memoryIds) && memoryIds.length > 0) {
      const cleanIds = memoryIds.map((x) => String(x)).slice(0, 15);
      candidates = db
        .prepare(
          `SELECT id, title, content, mood FROM memories WHERE user_id = ? AND ai_excluded = 0 AND id IN (${cleanIds
            .map(() => '?')
            .join(',')})`
        )
        .all(user.id, ...cleanIds) as Array<{ id: string; title: string; content: string; mood: string }>;
    } else {
      candidates = db
        .prepare(
          "SELECT id, title, content, mood FROM memories WHERE user_id = ? AND ai_excluded = 0 AND (emotional_impact = '' OR emotional_impact IS NULL) ORDER BY memory_date DESC LIMIT 15"
        )
        .all(user.id) as Array<{ id: string; title: string; content: string; mood: string }>;
    }

    if (candidates.length === 0) {
      res.json({ analyzedCount: 0, memories: [] });
      return;
    }

    try {
      const results = await analyzeMemoryBatchSentiment(candidates);
      if (results.length === 0) {
        res.json({ analyzedCount: 0, memories: [] });
        return;
      }

      const now = new Date().toISOString();
      const updStmt = db.prepare(`
        UPDATE memories
        SET sentiment_tone = ?, emotional_impact = ?, sentiment_score = ?, sentiment_rationale = ?, mood = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `);

      const byId = new Map(candidates.map((c) => [c.id, c]));
      db.transaction(() => {
        for (const r of results) {
          const orig = byId.get(r.id);
          const nextMood = applyMood !== false ? r.suggestedMood : orig?.mood || r.suggestedMood;
          updStmt.run(
            r.tone,
            r.emotionalImpact,
            r.valenceScore,
            r.rationale,
            nextMood.slice(0, 40),
            now,
            r.id,
            user.id
          );
        }
      })();

      const updatedRows = db
        .prepare(
          `SELECT * FROM memories WHERE user_id = ? AND id IN (${results.map(() => '?').join(',')})`
        )
        .all(user.id, ...results.map((r) => r.id)) as Array<Record<string, unknown>>;

      res.json({
        analyzedCount: results.length,
        memories: updatedRows.map(hydrateMemoryRow),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch sentiment analysis failed.';
      res.status(502).json({ error: message });
    }
  }
);

memoryMediaRouter.post(
  '/memories/:id/analyze-sentiment',
  requireAuth,
  rateLimit('ai', 20, 60_000),
  async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    if (!user.aiConsent) {
      res.status(403).json({ error: 'AI features are currently disabled in your privacy settings.' });
      return;
    }

    const existing = db
      .prepare('SELECT id, title, content, mood, ai_excluded FROM memories WHERE id = ? AND user_id = ?')
      .get(req.params.id, user.id) as
      | { id: string; title: string; content: string; mood: string; ai_excluded: number }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Memory not found.' });
      return;
    }
    if (existing.ai_excluded) {
      res.status(403).json({ error: 'This memory is excluded from AI reading and reflection.' });
      return;
    }

    const { applyMood } = req.body as { applyMood?: boolean };
    try {
      const sentiment = await analyzeMemorySentiment({
        title: existing.title,
        content: existing.content,
        currentMood: existing.mood,
      });

      const nextMood = applyMood !== false ? sentiment.suggestedMood : existing.mood;
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE memories
        SET sentiment_tone = ?, emotional_impact = ?, sentiment_score = ?, sentiment_rationale = ?, mood = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(
        sentiment.tone,
        sentiment.emotionalImpact,
        sentiment.valenceScore,
        sentiment.rationale,
        nextMood.slice(0, 40),
        now,
        existing.id,
        user.id
      );

      const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(existing.id) as Record<string, unknown>;
      res.json({ memory: hydrateMemoryRow(updated), sentiment });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sentiment analysis failed.';
      res.status(502).json({ error: message });
    }
  }
);

memoryMediaRouter.get('/memories/on-this-day', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const rawLocalDate = typeof req.query.localDate === 'string' ? req.query.localDate.trim() : '';
  const today = isValidIsoDate(rawLocalDate) ? rawLocalDate : new Date().toISOString().slice(0, 10);
  const mmdd = today.slice(5, 10);
  const year = today.slice(0, 4);
  const rows = db
    .prepare("SELECT * FROM memories WHERE user_id = ? AND substr(memory_date, 6, 5) = ? AND substr(memory_date, 1, 4) != ? ORDER BY memory_date DESC")
    .all(userId, mmdd, year) as Array<Record<string, unknown>>;
  res.json({ memories: rows.map(hydrateMemoryRow) });
});

memoryMediaRouter.get('/memories/random', requireAuth, (req: AuthenticatedRequest, res) => {
  const row = db
    .prepare('SELECT * FROM memories WHERE user_id = ? ORDER BY RANDOM() LIMIT 1')
    .get(req.authUser!.id) as Record<string, unknown> | undefined;
  res.json({ memory: row ? hydrateMemoryRow(row) : null });
});

memoryMediaRouter.get('/memories/:id/related', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const mem = db
    .prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as Record<string, unknown> | undefined;
  if (!mem) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }

  const hydrated = hydrateMemoryRow(mem);
  const others = db
    .prepare('SELECT * FROM memories WHERE user_id = ? AND id != ? ORDER BY memory_date DESC LIMIT 100')
    .all(userId, hydrated.id) as Array<Record<string, unknown>>;

  const related = others
    .map(hydrateMemoryRow)
    .map((other) => {
      let score = 0;
      if (other.category === hydrated.category) score += 2;
      if (other.mood === hydrated.mood) score += 1;
      for (const p of other.people) {
        if (hydrated.people.includes(p)) score += 3;
      }
      for (const t of other.tags) {
        if (hydrated.tags.includes(t)) score += 2;
      }
      if (hydrated.locationName && other.locationName && hydrated.locationName.toLowerCase() === other.locationName.toLowerCase()) {
        score += 2;
      }
      return { memory: other, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.memory);

  res.json({ related });
});

function parseOptionalCoordinate(
  raw: unknown,
  min: number,
  max: number,
  label: string
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
    return { ok: false, error: `${label} must be a valid number between ${min} and ${max}.` };
  }
  return { ok: true, value: raw };
}

function filterOwnedMediaIds(userId: string, rawIds: unknown): string[] {
  if (!Array.isArray(rawIds)) return [];
  const candidateIds = Array.from(new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 10);
  if (candidateIds.length === 0) return [];
  const rows = db
    .prepare(`SELECT id FROM media_files WHERE user_id = ? AND id IN (${candidateIds.map(() => '?').join(',')})`)
    .all(userId, ...candidateIds) as Array<{ id: string }>;
  const owned = new Set(rows.map((r) => r.id));
  return candidateIds.filter((id) => owned.has(id));
}

function resolveOwnedCollectionId(
  userId: string,
  collectionId: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (collectionId === null || collectionId === undefined || collectionId === '') {
    return { ok: true, value: null };
  }
  const cleanId = String(collectionId).trim();
  if (!cleanId) return { ok: true, value: null };
  const owned = db
    .prepare('SELECT id FROM memory_collections WHERE id = ? AND user_id = ?')
    .get(cleanId, userId) as { id: string } | undefined;
  if (!owned) {
    return { ok: false, error: 'Selected collection was not found.' };
  }
  return { ok: true, value: owned.id };
}

memoryMediaRouter.post('/memories', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const body = req.body as {
    clientMutationId?: string;
    title?: string;
    content?: string;
    memoryDate?: string;
    locationName?: string;
    latitude?: number | null;
    longitude?: number | null;
    mood?: string;
    category?: string;
    isFavorite?: boolean;
    aiExcluded?: boolean;
    aiSummary?: string;
    sentimentTone?: string;
    emotionalImpact?: string;
    sentimentScore?: number | null;
    sentimentRationale?: string;
    autoAnalyzeSentiment?: boolean;
    collectionId?: string | null;
    tags?: string[];
    people?: string[];
    mediaIds?: string[];
  };

  if (body.clientMutationId) {
    const receipt = db
      .prepare('SELECT resource_id FROM offline_sync_receipts WHERE user_id = ? AND client_mutation_id = ?')
      .get(userId, body.clientMutationId) as { resource_id: string } | undefined;
    if (receipt) {
      const existing = db.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?').get(receipt.resource_id, userId) as
        | Record<string, unknown>
        | undefined;
      if (existing) {
        res.status(200).json({ memory: hydrateMemoryRow(existing), deduplicated: true });
        return;
      }
    }
  }

  const title = (body.title || '').trim();
  const content = (body.content || '').trim();
  if (!title || !content) {
    res.status(400).json({ error: 'Memory title and content are required.' });
    return;
  }

  const parsedLat = parseOptionalCoordinate(body.latitude, -90, 90, 'Latitude');
  if (!parsedLat.ok) {
    res.status(400).json({ error: parsedLat.error });
    return;
  }
  const parsedLng = parseOptionalCoordinate(body.longitude, -180, 180, 'Longitude');
  if (!parsedLng.ok) {
    res.status(400).json({ error: parsedLng.error });
    return;
  }

  let resolvedMood = (body.mood || 'Reflective').slice(0, 40);
  let resolvedTone = (body.sentimentTone || '').slice(0, 40);
  let resolvedImpact = (body.emotionalImpact || '').slice(0, 40);
  let resolvedScore = typeof body.sentimentScore === 'number' ? Math.round(body.sentimentScore) : null;
  let resolvedRationale = (body.sentimentRationale || '').slice(0, 280);

  if (body.autoAnalyzeSentiment && req.authUser!.aiConsent && !body.aiExcluded && !resolvedImpact) {
    try {
      const analyzed = await analyzeMemorySentiment({ title, content, currentMood: resolvedMood });
      resolvedTone = analyzed.tone;
      resolvedImpact = analyzed.emotionalImpact;
      resolvedScore = analyzed.valenceScore;
      resolvedRationale = analyzed.rationale;
      if (!body.mood || body.mood === 'Reflective') {
        resolvedMood = analyzed.suggestedMood.slice(0, 40);
      }
    } catch {
      // Non-blocking fallback: save memory even if optional auto-sentiment fails
    }
  }

  const resolvedCollection = resolveOwnedCollectionId(userId, body.collectionId);
  if (!resolvedCollection.ok) {
    res.status(400).json({ error: resolvedCollection.error });
    return;
  }

  const id = newId('mem');
  const now = new Date().toISOString();
  const rawMemoryDate = typeof body.memoryDate === 'string' ? body.memoryDate.trim() : '';
  if (rawMemoryDate && !isValidIsoDate(rawMemoryDate)) {
    res.status(400).json({ error: 'Memory date must be a valid YYYY-MM-DD date.' });
    return;
  }
  const memoryDate = rawMemoryDate || now.slice(0, 10);
  const tags = normalizeTags(body.tags);
  const people = Array.isArray(body.people) ? body.people.map((p) => String(p).trim()).filter(Boolean).slice(0, 15) : [];
  const mediaIds = filterOwnedMediaIds(userId, body.mediaIds);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO memories (id, user_id, title, content, memory_date, location_name, latitude, longitude, mood, category, is_favorite, ai_excluded, ai_summary, sentiment_tone, emotional_impact, sentiment_score, sentiment_rationale, collection_id, tags_json, media_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      title.slice(0, 160),
      content,
      memoryDate,
      (body.locationName || '').slice(0, 140),
      parsedLat.value,
      parsedLng.value,
      resolvedMood,
      (body.category || 'Important moments').slice(0, 50),
      body.isFavorite ? 1 : 0,
      body.aiExcluded ? 1 : 0,
      (body.aiSummary || '').slice(0, 600),
      resolvedTone,
      resolvedImpact,
      resolvedScore,
      resolvedRationale,
      resolvedCollection.value,
      JSON.stringify(tags),
      JSON.stringify(mediaIds),
      now,
      now
    );

    const insTag = db.prepare('INSERT INTO memory_tags (id, memory_id, tag) VALUES (?, ?, ?)');
    for (const t of tags) insTag.run(newId('tag'), id, t);

    const insPerson = db.prepare('INSERT INTO memory_people (id, memory_id, person_name) VALUES (?, ?, ?)');
    for (const p of people) insPerson.run(newId('ppl'), id, p.slice(0, 60));

    if (body.clientMutationId) {
      db.prepare('INSERT INTO offline_sync_receipts (user_id, client_mutation_id, resource_id, created_at) VALUES (?, ?, ?, ?)').run(
        userId,
        body.clientMutationId,
        id,
        now
      );
    }
  })();

  const created = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json({ memory: hydrateMemoryRow(created) });
});

memoryMediaRouter.put('/memories/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const existing = db.prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?').get(req.params.id, userId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }

  const body = req.body as {
    title?: string;
    content?: string;
    memoryDate?: string;
    locationName?: string;
    latitude?: number | null;
    longitude?: number | null;
    mood?: string;
    category?: string;
    isFavorite?: boolean;
    aiExcluded?: boolean;
    aiSummary?: string;
    sentimentTone?: string;
    emotionalImpact?: string;
    sentimentScore?: number | null;
    sentimentRationale?: string;
    collectionId?: string | null;
    tags?: string[];
    people?: string[];
    mediaIds?: string[];
  };

  const nextTitle = body.title !== undefined ? String(body.title).trim() : String(existing.title).trim();
  const nextContent = body.content !== undefined ? String(body.content).trim() : String(existing.content).trim();
  if (!nextTitle || !nextContent) {
    res.status(400).json({ error: 'Memory title and content cannot be empty.' });
    return;
  }

  let nextLat: unknown = existing.latitude;
  if (body.latitude !== undefined) {
    const parsedLat = parseOptionalCoordinate(body.latitude, -90, 90, 'Latitude');
    if (!parsedLat.ok) {
      res.status(400).json({ error: parsedLat.error });
      return;
    }
    nextLat = parsedLat.value;
  }

  let nextLng: unknown = existing.longitude;
  if (body.longitude !== undefined) {
    const parsedLng = parseOptionalCoordinate(body.longitude, -180, 180, 'Longitude');
    if (!parsedLng.ok) {
      res.status(400).json({ error: parsedLng.error });
      return;
    }
    nextLng = parsedLng.value;
  }

  const nextSentimentScore =
    body.sentimentScore !== undefined
      ? typeof body.sentimentScore === 'number' && Number.isFinite(body.sentimentScore)
        ? Math.max(-100, Math.min(100, Math.round(body.sentimentScore)))
        : null
      : existing.sentiment_score;

  let nextCollectionId: string | null = existing.collection_id ? String(existing.collection_id) : null;
  if (body.collectionId !== undefined) {
    const resolvedCollection = resolveOwnedCollectionId(userId, body.collectionId);
    if (!resolvedCollection.ok) {
      res.status(400).json({ error: resolvedCollection.error });
      return;
    }
    nextCollectionId = resolvedCollection.value;
  }

  const nextMediaIdsJson =
    body.mediaIds !== undefined
      ? JSON.stringify(filterOwnedMediaIds(userId, body.mediaIds))
      : String(existing.media_ids_json);

  let nextMemoryDate = String(existing.memory_date);
  if (body.memoryDate !== undefined) {
    const cleanDate = String(body.memoryDate).trim();
    if (!isValidIsoDate(cleanDate)) {
      res.status(400).json({ error: 'Memory date must be a valid YYYY-MM-DD date.' });
      return;
    }
    nextMemoryDate = cleanDate;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      UPDATE memories
      SET title = ?, content = ?, memory_date = ?, location_name = ?, latitude = ?, longitude = ?, mood = ?, category = ?, is_favorite = ?, ai_excluded = ?, ai_summary = ?, sentiment_tone = ?, emotional_impact = ?, sentiment_score = ?, sentiment_rationale = ?, collection_id = ?, media_ids_json = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      nextTitle.slice(0, 160),
      nextContent,
      nextMemoryDate,
      (body.locationName ?? String(existing.location_name)).slice(0, 140),
      nextLat,
      nextLng,
      body.mood ?? String(existing.mood),
      body.category ?? String(existing.category),
      body.isFavorite !== undefined ? (body.isFavorite ? 1 : 0) : existing.is_favorite,
      body.aiExcluded !== undefined ? (body.aiExcluded ? 1 : 0) : existing.ai_excluded,
      body.aiSummary !== undefined ? body.aiSummary.slice(0, 600) : String(existing.ai_summary),
      body.sentimentTone !== undefined ? body.sentimentTone.slice(0, 40) : String(existing.sentiment_tone || ''),
      body.emotionalImpact !== undefined ? body.emotionalImpact.slice(0, 40) : String(existing.emotional_impact || ''),
      nextSentimentScore,
      body.sentimentRationale !== undefined
        ? body.sentimentRationale.slice(0, 280)
        : String(existing.sentiment_rationale || ''),
      nextCollectionId,
      nextMediaIdsJson,
      now,
      req.params.id,
      userId
    );

    if (Array.isArray(body.tags)) {
      syncMemoryTags(req.params.id, normalizeTags(body.tags));
    }

    if (Array.isArray(body.people)) {
      db.prepare('DELETE FROM memory_people WHERE memory_id = ?').run(req.params.id);
      const insPerson = db.prepare('INSERT INTO memory_people (id, memory_id, person_name) VALUES (?, ?, ?)');
      for (const p of body.people.map((x) => String(x).trim()).filter(Boolean).slice(0, 15)) {
        insPerson.run(newId('ppl'), req.params.id, p.slice(0, 60));
      }
    }
  })();

  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  res.json({ memory: hydrateMemoryRow(updated) });
});

memoryMediaRouter.post('/memories/:id/tags', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const existing = db
    .prepare('SELECT id FROM memories WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }

  const { tags } = req.body as { tags?: string[] };
  if (!Array.isArray(tags)) {
    res.status(400).json({ error: 'tags array is required.' });
    return;
  }

  const normalized = normalizeTags(tags);
  db.transaction(() => {
    syncMemoryTags(existing.id, normalized);
    db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), existing.id);
  })();

  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(existing.id) as Record<string, unknown>;
  res.json({ memory: hydrateMemoryRow(updated) });
});

memoryMediaRouter.post('/memories/:id/category', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const existing = db
    .prepare('SELECT id FROM memories WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }

  const cleanCategory = String((req.body as { category?: string })?.category || '')
    .trim()
    .slice(0, 48);
  if (!cleanCategory) {
    res.status(400).json({ error: 'Category name is required.' });
    return;
  }

  db.prepare('UPDATE memories SET category = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    cleanCategory,
    new Date().toISOString(),
    existing.id,
    userId
  );

  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(existing.id) as Record<string, unknown>;
  res.json({ memory: hydrateMemoryRow(updated) });
});

memoryMediaRouter.post('/memories/:id/favorite', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT is_favorite FROM memories WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as { is_favorite: number } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }
  const nextVal = existing.is_favorite ? 0 : 1;
  db.prepare('UPDATE memories SET is_favorite = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    nextVal,
    new Date().toISOString(),
    req.params.id,
    req.authUser!.id
  );
  res.json({ isFavorite: Boolean(nextVal) });
});

memoryMediaRouter.delete('/memories/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const result = db.prepare('DELETE FROM memories WHERE id = ? AND user_id = ?').run(req.params.id, req.authUser!.id);
  res.json({ deleted: result.changes > 0 });
});

memoryMediaRouter.get('/collections', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(`
      SELECT mc.*, (SELECT COUNT(*) FROM memories m WHERE m.collection_id = mc.id) AS memory_count
      FROM memory_collections mc
      WHERE mc.user_id = ?
      ORDER BY mc.created_at DESC
    `)
    .all(req.authUser!.id);
  res.json({ collections: rows });
});

memoryMediaRouter.post('/collections', requireAuth, (req: AuthenticatedRequest, res) => {
  const { name, description, color } = req.body as { name?: string; description?: string; color?: string };
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Collection name is required.' });
    return;
  }
  const id = newId('col');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO memory_collections (id, user_id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    req.authUser!.id,
    name.trim().slice(0, 80),
    (description || '').slice(0, 240),
    (color || '#38BDF8').slice(0, 20),
    now
  );
  const created = db.prepare('SELECT *, 0 AS memory_count FROM memory_collections WHERE id = ?').get(id);
  res.status(201).json({ collection: created });
});

memoryMediaRouter.delete('/collections/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const result = db
    .prepare('DELETE FROM memory_collections WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.authUser!.id);
  res.json({ deleted: result.changes > 0 });
});
