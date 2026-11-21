import crypto from 'node:crypto';
import { Router } from 'express';
import QRCode from 'qrcode';
import { type AuthenticatedRequest, requireAuth } from '../auth.ts';
import { db, newId } from '../db.ts';

export const objectDreamAndSyncRouter = Router();

function safeJsonArray(val: unknown): string[] {
  try {
    const parsed = JSON.parse(String(val || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function hydrateObjectRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    photoMediaId: row.photo_media_id ? String(row.photo_media_id) : null,
    voiceMediaId: row.voice_media_id ? String(row.voice_media_id) : null,
    description: String(row.description || ''),
    story: String(row.story),
    acquisitionDate: String(row.acquisition_date || ''),
    currentOwner: String(row.current_owner || ''),
    previousOwners: safeJsonArray(row.previous_owners_json),
    connectedPeople: safeJsonArray(row.connected_people_json),
    location: String(row.location || ''),
    historicalNotes: String(row.historical_notes || ''),
    relatedMemoryIds: safeJsonArray(row.related_memory_ids_json),
    tags: safeJsonArray(row.tags_json),
    isPublic: Boolean(row.is_public),
    shareSlug: row.share_slug ? String(row.share_slug) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ==================== LIFE BEHIND OBJECTS ====================

objectDreamAndSyncRouter.get('/objects', requireAuth, (req: AuthenticatedRequest, res) => {
  const { q, category } = req.query as Record<string, string | undefined>;
  const wheres = ['user_id = ?'];
  const params: unknown[] = [req.authUser!.id];

  if (category && category !== 'All') {
    wheres.push('category = ?');
    params.push(category);
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    wheres.push('(name LIKE ? OR story LIKE ? OR description LIKE ? OR current_owner LIKE ? OR location LIKE ?)');
    params.push(like, like, like, like, like);
  }

  const rows = db
    .prepare(`SELECT * FROM objects WHERE ${wheres.join(' AND ')} ORDER BY created_at DESC`)
    .all(...params) as Array<Record<string, unknown>>;

  res.json({ objects: rows.map(hydrateObjectRow) });
});

objectDreamAndSyncRouter.post('/objects', requireAuth, (req: AuthenticatedRequest, res) => {
  const body = req.body as {
    name?: string;
    category?: string;
    photoMediaId?: string | null;
    voiceMediaId?: string | null;
    description?: string;
    story?: string;
    acquisitionDate?: string;
    currentOwner?: string;
    previousOwners?: string[];
    connectedPeople?: string[];
    location?: string;
    historicalNotes?: string;
    relatedMemoryIds?: string[];
    tags?: string[];
    isPublic?: boolean;
  };

  if (!body.name?.trim() || !body.story?.trim()) {
    res.status(400).json({ error: 'Object name and story are required.' });
    return;
  }

  const id = newId('obj');
  const slug = `echo-${crypto.randomBytes(5).toString('hex')}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO objects (id, user_id, name, category, photo_media_id, voice_media_id, description, story, acquisition_date, current_owner, previous_owners_json, connected_people_json, location, historical_notes, related_memory_ids_json, tags_json, is_public, share_slug, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.authUser!.id,
    body.name.trim().slice(0, 140),
    (body.category || 'Other').slice(0, 50),
    body.photoMediaId || null,
    body.voiceMediaId || null,
    (body.description || '').slice(0, 500),
    body.story.trim(),
    (body.acquisitionDate || '').slice(0, 40),
    (body.currentOwner || req.authUser!.displayName).slice(0, 100),
    JSON.stringify(Array.isArray(body.previousOwners) ? body.previousOwners.filter(Boolean).slice(0, 20) : []),
    JSON.stringify(Array.isArray(body.connectedPeople) ? body.connectedPeople.filter(Boolean).slice(0, 20) : []),
    (body.location || '').slice(0, 140),
    (body.historicalNotes || '').slice(0, 1500),
    JSON.stringify(Array.isArray(body.relatedMemoryIds) ? body.relatedMemoryIds.filter(Boolean).slice(0, 20) : []),
    JSON.stringify(Array.isArray(body.tags) ? body.tags.filter(Boolean).slice(0, 15) : []),
    body.isPublic ? 1 : 0,
    slug,
    now,
    now
  );

  const created = db.prepare('SELECT * FROM objects WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json({ object: hydrateObjectRow(created) });
});

objectDreamAndSyncRouter.put('/objects/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT * FROM objects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Object not found.' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE objects
    SET name = ?, category = ?, photo_media_id = ?, voice_media_id = ?, description = ?, story = ?, acquisition_date = ?, current_owner = ?, previous_owners_json = ?, connected_people_json = ?, location = ?, historical_notes = ?, related_memory_ids_json = ?, tags_json = ?, is_public = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    String(body.name ?? existing.name).trim().slice(0, 140),
    String(body.category ?? existing.category).slice(0, 50),
    body.photoMediaId !== undefined ? (body.photoMediaId as string | null) : (existing.photo_media_id as string | null),
    body.voiceMediaId !== undefined ? (body.voiceMediaId as string | null) : (existing.voice_media_id as string | null),
    String(body.description ?? existing.description).slice(0, 500),
    String(body.story ?? existing.story).trim(),
    String(body.acquisitionDate ?? existing.acquisition_date).slice(0, 40),
    String(body.currentOwner ?? existing.current_owner).slice(0, 100),
    Array.isArray(body.previousOwners) ? JSON.stringify(body.previousOwners) : String(existing.previous_owners_json),
    Array.isArray(body.connectedPeople) ? JSON.stringify(body.connectedPeople) : String(existing.connected_people_json),
    String(body.location ?? existing.location).slice(0, 140),
    String(body.historicalNotes ?? existing.historical_notes).slice(0, 1500),
    Array.isArray(body.relatedMemoryIds) ? JSON.stringify(body.relatedMemoryIds) : String(existing.related_memory_ids_json),
    Array.isArray(body.tags) ? JSON.stringify(body.tags) : String(existing.tags_json),
    body.isPublic !== undefined ? (body.isPublic ? 1 : 0) : existing.is_public,
    now,
    req.params.id,
    req.authUser!.id
  );

  const updated = db.prepare('SELECT * FROM objects WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  res.json({ object: hydrateObjectRow(updated) });
});

objectDreamAndSyncRouter.delete('/objects/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const result = db.prepare('DELETE FROM objects WHERE id = ? AND user_id = ?').run(req.params.id, req.authUser!.id);
  res.json({ deleted: result.changes > 0 });
});

objectDreamAndSyncRouter.get('/objects/:id/qrcode', requireAuth, async (req: AuthenticatedRequest, res) => {
  const obj = db
    .prepare('SELECT id, name, share_slug, is_public FROM objects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as
    | { id: string; name: string; share_slug: string; is_public: number }
    | undefined;
  if (!obj) {
    res.status(404).json({ error: 'Object not found.' });
    return;
  }

  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const shareUrl = `${baseUrl}/?sharedObject=${encodeURIComponent(obj.share_slug)}`;
  const qrDataUrl = await QRCode.toDataURL(shareUrl, {
    width: 320,
    margin: 2,
    color: { dark: '#070B14', light: '#F8FAFC' },
  });

  res.json({ qrDataUrl, shareUrl, isPublic: Boolean(obj.is_public) });
});

objectDreamAndSyncRouter.get('/shared/object/:slug', (req, res) => {
  const row = db
    .prepare('SELECT id, name, category, photo_media_id, description, story, acquisition_date, current_owner, previous_owners_json, location, historical_notes, tags_json, created_at FROM objects WHERE share_slug = ? AND is_public = 1')
    .get(req.params.slug) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Shared object story not found or is private.' });
    return;
  }
  res.json({ object: hydrateObjectRow({ ...row, is_public: 1 }) });
});

// ==================== DREAM ARCHIVE ====================

function hydrateDreamRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    dreamDate: String(row.dream_date),
    emotion: String(row.emotion),
    location: String(row.location || ''),
    category: String(row.category),
    vividness: Number(row.vividness || 3),
    isRecurring: Boolean(row.is_recurring),
    tags: safeJsonArray(row.tags_json),
    imageMediaId: row.image_media_id ? String(row.image_media_id) : null,
    voiceMediaId: row.voice_media_id ? String(row.voice_media_id) : null,
    transcript: String(row.transcript || ''),
    aiReflection: String(row.ai_reflection || ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

objectDreamAndSyncRouter.get('/dreams', requireAuth, (req: AuthenticatedRequest, res) => {
  const { q, category, recurring } = req.query as Record<string, string | undefined>;
  const wheres = ['user_id = ?'];
  const params: unknown[] = [req.authUser!.id];

  if (category && category !== 'All') {
    wheres.push('category = ?');
    params.push(category);
  }
  if (recurring === 'true') {
    wheres.push('is_recurring = 1');
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    wheres.push('(title LIKE ? OR content LIKE ? OR location LIKE ? OR tags_json LIKE ?)');
    params.push(like, like, like, like);
  }

  const rows = db
    .prepare(`SELECT * FROM dreams WHERE ${wheres.join(' AND ')} ORDER BY dream_date DESC, created_at DESC`)
    .all(...params) as Array<Record<string, unknown>>;

  res.json({ dreams: rows.map(hydrateDreamRow) });
});

objectDreamAndSyncRouter.get('/dreams/patterns', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM dreams WHERE user_id = ? ORDER BY dream_date DESC LIMIT 200')
    .all(req.authUser!.id) as Array<Record<string, unknown>>;

  const tagCounts = new Map<string, number>();
  const emotionCounts = new Map<string, number>();
  const recurringCount = rows.filter((r) => Boolean(r.is_recurring)).length;

  for (const r of rows) {
    const emotion = String(r.emotion || 'Wonder');
    emotionCounts.set(emotion, (emotionCounts.get(emotion) || 0) + 1);
    for (const t of safeJsonArray(r.tags_json)) {
      const clean = t.toLowerCase();
      tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
    }
  }

  res.json({
    totalDreams: rows.length,
    recurringCount,
    topTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count })),
    topEmotions: [...emotionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([emotion, count]) => ({ emotion, count })),
  });
});

objectDreamAndSyncRouter.post('/dreams', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const body = req.body as {
    clientMutationId?: string;
    title?: string;
    content?: string;
    dreamDate?: string;
    emotion?: string;
    location?: string;
    category?: string;
    vividness?: number;
    isRecurring?: boolean;
    tags?: string[];
    imageMediaId?: string | null;
    voiceMediaId?: string | null;
    transcript?: string;
    aiReflection?: string;
  };

  if (body.clientMutationId) {
    const receipt = db
      .prepare('SELECT resource_id FROM offline_sync_receipts WHERE user_id = ? AND client_mutation_id = ?')
      .get(userId, body.clientMutationId) as { resource_id: string } | undefined;
    if (receipt) {
      const existing = db.prepare('SELECT * FROM dreams WHERE id = ? AND user_id = ?').get(receipt.resource_id, userId) as
        | Record<string, unknown>
        | undefined;
      if (existing) {
        res.json({ dream: hydrateDreamRow(existing), deduplicated: true });
        return;
      }
    }
  }

  if (!body.title?.trim() || !body.content?.trim()) {
    res.status(400).json({ error: 'Dream title and description are required.' });
    return;
  }

  const id = newId('drm');
  const now = new Date().toISOString();
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 15) : [];

  db.transaction(() => {
    db.prepare(`
      INSERT INTO dreams (id, user_id, title, content, dream_date, emotion, location, category, vividness, is_recurring, tags_json, image_media_id, voice_media_id, transcript, ai_reflection, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      body.title!.trim().slice(0, 160),
      body.content!.trim(),
      body.dreamDate || now.slice(0, 10),
      (body.emotion || 'Wonder').slice(0, 40),
      (body.location || '').slice(0, 120),
      (body.category || 'Lucid').slice(0, 40),
      Math.min(Math.max(Number(body.vividness) || 3, 1), 5),
      body.isRecurring ? 1 : 0,
      JSON.stringify(tags),
      body.imageMediaId || null,
      body.voiceMediaId || null,
      (body.transcript || '').slice(0, 4000),
      (body.aiReflection || '').slice(0, 2000),
      now,
      now
    );

    if (body.clientMutationId) {
      db.prepare('INSERT INTO offline_sync_receipts (user_id, client_mutation_id, resource_id, created_at) VALUES (?, ?, ?, ?)').run(
        userId,
        body.clientMutationId,
        id,
        now
      );
    }
  })();

  const created = db.prepare('SELECT * FROM dreams WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json({ dream: hydrateDreamRow(created) });
});

objectDreamAndSyncRouter.put('/dreams/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT * FROM dreams WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Dream not found.' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  db.prepare(`
    UPDATE dreams
    SET title = ?, content = ?, dream_date = ?, emotion = ?, location = ?, category = ?, vividness = ?, is_recurring = ?, tags_json = ?, ai_reflection = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    String(body.title ?? existing.title).trim().slice(0, 160),
    String(body.content ?? existing.content).trim(),
    String(body.dreamDate ?? existing.dream_date),
    String(body.emotion ?? existing.emotion),
    String(body.location ?? existing.location),
    String(body.category ?? existing.category),
    Math.min(Math.max(Number(body.vividness ?? existing.vividness) || 3, 1), 5),
    body.isRecurring !== undefined ? (body.isRecurring ? 1 : 0) : existing.is_recurring,
    Array.isArray(body.tags) ? JSON.stringify(body.tags) : String(existing.tags_json),
    String(body.aiReflection ?? existing.ai_reflection),
    new Date().toISOString(),
    req.params.id,
    req.authUser!.id
  );

  const updated = db.prepare('SELECT * FROM dreams WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  res.json({ dream: hydrateDreamRow(updated) });
});

objectDreamAndSyncRouter.delete('/dreams/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const result = db.prepare('DELETE FROM dreams WHERE id = ? AND user_id = ?').run(req.params.id, req.authUser!.id);
  res.json({ deleted: result.changes > 0 });
});

// ==================== UNIFIED SEARCH & NOTIFICATIONS ====================

objectDreamAndSyncRouter.get('/search', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ results: [] });
    return;
  }

  const like = `%${q}%`;
  const nowIso = new Date().toISOString();

  const memories = db
    .prepare("SELECT id, title, memory_date AS date, category AS subtitle FROM memories WHERE user_id = ? AND (title LIKE ? OR content LIKE ? OR location_name LIKE ?) LIMIT 8")
    .all(userId, like, like, like) as Array<Record<string, unknown>>;

  const capsules = db
    .prepare("SELECT id, title, unlock_at AS date, capsule_type AS subtitle FROM time_capsules WHERE user_id = ? AND (title LIKE ? OR ((is_locked = 0 OR unlock_at <= ?) AND message LIKE ?)) LIMIT 6")
    .all(userId, like, nowIso, like) as Array<Record<string, unknown>>;

  const objects = db
    .prepare("SELECT id, name AS title, acquisition_date AS date, category AS subtitle FROM objects WHERE user_id = ? AND (name LIKE ? OR story LIKE ? OR description LIKE ?) LIMIT 6")
    .all(userId, like, like, like) as Array<Record<string, unknown>>;

  const dreams = db
    .prepare("SELECT id, title, dream_date AS date, emotion AS subtitle FROM dreams WHERE user_id = ? AND (title LIKE ? OR content LIKE ? OR tags_json LIKE ?) LIMIT 6")
    .all(userId, like, like, like) as Array<Record<string, unknown>>;

  const wisdom = db
    .prepare("SELECT id, title, created_at AS date, category AS subtitle FROM wisdom_posts WHERE (title LIKE ? OR content LIKE ?) AND author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?) LIMIT 6")
    .all(like, like, userId) as Array<Record<string, unknown>>;

  const humanity = db
    .prepare("SELECT id, title, created_at AS date, approx_region AS subtitle FROM humanity_posts WHERE (title LIKE ? OR content LIKE ?) AND author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?) LIMIT 6")
    .all(like, like, userId) as Array<Record<string, unknown>>;

  const skills = db
    .prepare("SELECT sp.user_id AS id, u.display_name AS title, sp.updated_at AS date, sp.teach_skills_json AS subtitle FROM skill_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id != ? AND (u.display_name LIKE ? OR sp.teach_skills_json LIKE ? OR sp.learn_skills_json LIKE ?) LIMIT 6")
    .all(userId, like, like, like) as Array<Record<string, unknown>>;

  const results = [
    ...memories.map((r) => ({ ...r, module: 'memories' })),
    ...capsules.map((r) => ({ ...r, module: 'capsules' })),
    ...objects.map((r) => ({ ...r, module: 'objects' })),
    ...dreams.map((r) => ({ ...r, module: 'dreams' })),
    ...wisdom.map((r) => ({ ...r, module: 'wisdom' })),
    ...humanity.map((r) => ({ ...r, module: 'humanity' })),
    ...skills.map((r) => ({ ...r, module: 'skillswap' })),
  ];

  res.json({ results });
});

objectDreamAndSyncRouter.get('/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
    .all(req.authUser!.id) as Array<Record<string, unknown>>;

  res.json({
    notifications: rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      title: String(r.title),
      body: String(r.body),
      linkModule: String(r.link_module),
      linkId: r.link_id ? String(r.link_id) : null,
      isRead: Boolean(r.is_read),
      createdAt: String(r.created_at),
    })),
  });
});

objectDreamAndSyncRouter.post('/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.authUser!.id);
  res.json({ ok: true });
});

objectDreamAndSyncRouter.post('/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.authUser!.id);
  res.json({ ok: true });
});
