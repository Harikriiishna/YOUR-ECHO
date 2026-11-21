import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { type AuthenticatedRequest, requireAuth } from '../auth.ts';
import { db, newId, UPLOADS_DIR } from '../db.ts';

export const memoryMediaRouter = Router();

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

memoryMediaRouter.post('/media/upload', requireAuth, upload.single('file'), (req: AuthenticatedRequest, res) => {
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
});

memoryMediaRouter.get('/media/usage', requireAuth, (req: AuthenticatedRequest, res) => {
  const row = db
    .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS totalBytes, COUNT(*) AS fileCount FROM media_files WHERE user_id = ?')
    .get(req.authUser!.id) as { totalBytes: number; fileCount: number };
  res.json(row);
});

memoryMediaRouter.get('/media/:id', requireAuth, (req: AuthenticatedRequest, res) => {
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

  const isOwner = media.user_id === req.authUser!.id;
  if (!isOwner) {
    // Allow viewing only if attached to a public object
    const publicObj = db
      .prepare('SELECT id FROM objects WHERE is_public = 1 AND (photo_media_id = ? OR voice_media_id = ?)')
      .get(media.id, media.id);
    if (!publicObj) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
  }

  // Server-side enforcement: block media attached to a locked capsule before its unlock timestamp
  const lockedCapsule = db
    .prepare(`
      SELECT id, unlock_at FROM time_capsules
      WHERE user_id = ? AND is_locked = 1 AND unlock_at > ? AND media_ids_json LIKE ?
    `)
    .get(media.user_id, new Date().toISOString(), `%${media.id}%`);

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

function hydrateMemoryRow(row: Record<string, unknown>) {
  const id = String(row.id);
  const tags = (db.prepare('SELECT tag FROM memory_tags WHERE memory_id = ?').all(id) as Array<{ tag: string }>).map(
    (t) => t.tag
  );
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
  const { q, category, mood, favorite, collectionId, person, tag, month } = req.query as Record<string, string | undefined>;

  let sql = 'SELECT DISTINCT m.* FROM memories m';
  const joins: string[] = [];
  const wheres: string[] = ['m.user_id = ?'];
  const params: unknown[] = [userId];

  if (person) {
    joins.push('JOIN memory_people mp ON mp.memory_id = m.id');
    wheres.push('LOWER(mp.person_name) = LOWER(?)');
    params.push(person.trim());
  }
  if (tag) {
    joins.push('JOIN memory_tags mt ON mt.memory_id = m.id');
    wheres.push('LOWER(mt.tag) = LOWER(?)');
    params.push(tag.trim());
  }
  if (category && category !== 'All') {
    wheres.push('m.category = ?');
    params.push(category);
  }
  if (mood && mood !== 'All') {
    wheres.push('m.mood = ?');
    params.push(mood);
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
    const like = `%${q.trim()}%`;
    wheres.push('(m.title LIKE ? OR m.content LIKE ? OR m.location_name LIKE ? OR EXISTS (SELECT 1 FROM memory_tags t2 WHERE t2.memory_id = m.id AND t2.tag LIKE ?) OR EXISTS (SELECT 1 FROM memory_people p2 WHERE p2.memory_id = m.id AND p2.person_name LIKE ?))');
    params.push(like, like, like, like, like);
  }

  sql = `${sql} ${joins.join(' ')} WHERE ${wheres.join(' AND ')} ORDER BY m.memory_date DESC, m.created_at DESC`;
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json({ memories: rows.map(hydrateMemoryRow) });
});

memoryMediaRouter.get('/memories/on-this-day', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const today = new Date().toISOString();
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

memoryMediaRouter.post('/memories', requireAuth, (req: AuthenticatedRequest, res) => {
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

  const id = newId('mem');
  const now = new Date().toISOString();
  const memoryDate = body.memoryDate || now.slice(0, 10);
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 15) : [];
  const people = Array.isArray(body.people) ? body.people.map((p) => String(p).trim()).filter(Boolean).slice(0, 15) : [];
  const mediaIds = Array.isArray(body.mediaIds) ? body.mediaIds.filter(Boolean).slice(0, 10) : [];

  db.transaction(() => {
    db.prepare(`
      INSERT INTO memories (id, user_id, title, content, memory_date, location_name, latitude, longitude, mood, category, is_favorite, ai_excluded, ai_summary, collection_id, media_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      title.slice(0, 160),
      content,
      memoryDate,
      (body.locationName || '').slice(0, 140),
      typeof body.latitude === 'number' ? body.latitude : null,
      typeof body.longitude === 'number' ? body.longitude : null,
      (body.mood || 'Reflective').slice(0, 40),
      (body.category || 'Important moments').slice(0, 50),
      body.isFavorite ? 1 : 0,
      body.aiExcluded ? 1 : 0,
      (body.aiSummary || '').slice(0, 600),
      body.collectionId || null,
      JSON.stringify(mediaIds),
      now,
      now
    );

    const insTag = db.prepare('INSERT INTO memory_tags (id, memory_id, tag) VALUES (?, ?, ?)');
    for (const t of tags) insTag.run(newId('tag'), id, t.slice(0, 40));

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
    collectionId?: string | null;
    tags?: string[];
    people?: string[];
    mediaIds?: string[];
  };

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      UPDATE memories
      SET title = ?, content = ?, memory_date = ?, location_name = ?, latitude = ?, longitude = ?, mood = ?, category = ?, is_favorite = ?, ai_excluded = ?, ai_summary = ?, collection_id = ?, media_ids_json = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      (body.title ?? String(existing.title)).trim().slice(0, 160),
      (body.content ?? String(existing.content)).trim(),
      body.memoryDate ?? String(existing.memory_date),
      (body.locationName ?? String(existing.location_name)).slice(0, 140),
      body.latitude !== undefined ? body.latitude : existing.latitude,
      body.longitude !== undefined ? body.longitude : existing.longitude,
      body.mood ?? String(existing.mood),
      body.category ?? String(existing.category),
      body.isFavorite !== undefined ? (body.isFavorite ? 1 : 0) : existing.is_favorite,
      body.aiExcluded !== undefined ? (body.aiExcluded ? 1 : 0) : existing.ai_excluded,
      body.aiSummary !== undefined ? body.aiSummary.slice(0, 600) : String(existing.ai_summary),
      body.collectionId !== undefined ? body.collectionId : existing.collection_id,
      body.mediaIds !== undefined ? JSON.stringify(body.mediaIds) : String(existing.media_ids_json),
      now,
      req.params.id,
      userId
    );

    if (Array.isArray(body.tags)) {
      db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(req.params.id);
      const insTag = db.prepare('INSERT INTO memory_tags (id, memory_id, tag) VALUES (?, ?, ?)');
      for (const t of body.tags.map((x) => String(x).trim()).filter(Boolean).slice(0, 15)) {
        insTag.run(newId('tag'), req.params.id, t.slice(0, 40));
      }
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

memoryMediaRouter.post('/memories/:id/favorite', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT is_favorite FROM memories WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as { is_favorite: number } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }
  const nextVal = existing.is_favorite ? 0 : 1;
  db.prepare('UPDATE memories SET is_favorite = ?, updated_at = ? WHERE id = ?').run(
    nextVal,
    new Date().toISOString(),
    req.params.id
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
