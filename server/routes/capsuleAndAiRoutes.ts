import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import {
  analyzeMemorySentiment,
  generateMemoryAssist,
  generateMonthlyCheckInReflection,
  runMemoryAiQuery,
  transcribeAudioBuffer,
} from '../ai.ts';
import { type AuthenticatedRequest, rateLimit, requireAuth } from '../auth.ts';
import { db, newId, UPLOADS_DIR } from '../db.ts';
import { pushNotification } from '../ws.ts';

export const capsuleAndAiRouter = Router();

function serializeCapsule(row: Record<string, unknown>) {
  const isLocked = Boolean(row.is_locked);
  const unlockAt = String(row.unlock_at);
  const unlockMs = Date.parse(unlockAt);
  const isMatured = Number.isFinite(unlockMs) && unlockMs <= Date.now();
  const canRevealContent = !isLocked || isMatured;

  let mediaIds: string[] = [];
  if (canRevealContent) {
    try {
      mediaIds = JSON.parse(String(row.media_ids_json || '[]'));
    } catch {
      mediaIds = [];
    }
  }

  const media =
    canRevealContent && mediaIds.length > 0
      ? db
          .prepare(`SELECT id, original_name, mime_type, size_bytes FROM media_files WHERE id IN (${mediaIds.map(() => '?').join(',')})`)
          .all(...mediaIds)
      : [];

  return {
    id: String(row.id),
    title: String(row.title),
    // Server-side enforcement: locked capsules before unlock date NEVER expose message or media
    message: canRevealContent ? String(row.message) : null,
    capsuleType: String(row.capsule_type),
    unlockOccasion: String(row.unlock_occasion),
    unlockAt,
    timezone: String(row.timezone || 'UTC'),
    isLocked,
    isMatured,
    isOpenable: isLocked && isMatured,
    openedAt: row.opened_at ? String(row.opened_at) : null,
    media,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

capsuleAndAiRouter.get('/capsules', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const nowIso = new Date().toISOString();

  // Trigger unlock notifications for newly matured locked capsules
  const due = db
    .prepare('SELECT id, title FROM time_capsules WHERE user_id = ? AND is_locked = 1 AND unlock_at <= ? AND unlocked_notified = 0')
    .all(userId, nowIso) as Array<{ id: string; title: string }>;

  for (const cap of due) {
    db.prepare('UPDATE time_capsules SET unlocked_notified = 1 WHERE id = ?').run(cap.id);
    const notifId = newId('notif');
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body, link_module, link_id, is_read, created_at)
      VALUES (?, ?, 'capsule_unlock', 'Time Capsule Ready', ?, 'capsules', ?, 0, ?)
    `).run(notifId, userId, `Your sealed capsule "${cap.title}" has reached its unlock date.`, cap.id, createdAt);
    pushNotification(userId, {
      id: notifId,
      type: 'capsule_unlock',
      title: 'Time Capsule Ready',
      body: `Your sealed capsule "${cap.title}" has reached its unlock date.`,
      linkModule: 'capsules',
      linkId: cap.id,
      createdAt,
    });
  }

  const rows = db
    .prepare('SELECT * FROM time_capsules WHERE user_id = ? ORDER BY is_locked ASC, unlock_at ASC')
    .all(userId) as Array<Record<string, unknown>>;

  res.json({ capsules: rows.map(serializeCapsule) });
});

capsuleAndAiRouter.get('/capsules/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const row = db
    .prepare('SELECT * FROM time_capsules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Time capsule not found.' });
    return;
  }
  res.json({ capsule: serializeCapsule(row) });
});

capsuleAndAiRouter.post('/capsules', requireAuth, (req: AuthenticatedRequest, res) => {
  const { title, message, capsuleType, unlockOccasion, unlockAt, timezone, mediaIds, lockImmediately } = req.body as {
    title?: string;
    message?: string;
    capsuleType?: string;
    unlockOccasion?: string;
    unlockAt?: string;
    timezone?: string;
    mediaIds?: string[];
    lockImmediately?: boolean;
  };

  if (!title?.trim() || !message?.trim() || !unlockAt) {
    res.status(400).json({ error: 'Title, message, and unlock date are required.' });
    return;
  }

  const parsedDate = Date.parse(unlockAt);
  if (!Number.isFinite(parsedDate)) {
    res.status(400).json({ error: 'Invalid unlock date format.' });
    return;
  }
  if (lockImmediately && parsedDate <= Date.now()) {
    res.status(400).json({ error: 'A locked Time Capsule must have a future unlock date.' });
    return;
  }

  const id = newId('cap');
  const now = new Date().toISOString();
  const cleanMedia = Array.isArray(mediaIds) ? mediaIds.filter(Boolean).slice(0, 10) : [];

  db.prepare(`
    INSERT INTO time_capsules (id, user_id, title, message, capsule_type, unlock_occasion, unlock_at, timezone, is_locked, media_ids_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.authUser!.id,
    title.trim().slice(0, 160),
    message.trim(),
    (capsuleType || 'letter').slice(0, 40),
    (unlockOccasion || 'specific_date').slice(0, 40),
    new Date(parsedDate).toISOString(),
    (timezone || req.authUser!.timezone || 'UTC').slice(0, 60),
    lockImmediately ? 1 : 0,
    JSON.stringify(cleanMedia),
    now,
    now
  );

  const created = db.prepare('SELECT * FROM time_capsules WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json({ capsule: serializeCapsule(created) });
});

capsuleAndAiRouter.put('/capsules/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT * FROM time_capsules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Time capsule not found.' });
    return;
  }
  if (existing.is_locked) {
    res.status(403).json({ error: 'Sealed Time Capsules cannot be edited once locked.' });
    return;
  }

  const { title, message, capsuleType, unlockOccasion, unlockAt, timezone, mediaIds } = req.body as {
    title?: string;
    message?: string;
    capsuleType?: string;
    unlockOccasion?: string;
    unlockAt?: string;
    timezone?: string;
    mediaIds?: string[];
  };

  const nextTitle = title !== undefined ? title.trim() : String(existing.title).trim();
  const nextMessage = message !== undefined ? message.trim() : String(existing.message).trim();
  if (!nextTitle || !nextMessage) {
    res.status(400).json({ error: 'Capsule title and message cannot be empty.' });
    return;
  }

  let nextUnlock = String(existing.unlock_at);
  if (unlockAt !== undefined) {
    const parsedUnlock = Date.parse(unlockAt);
    if (!Number.isFinite(parsedUnlock)) {
      res.status(400).json({ error: 'Invalid unlock date format.' });
      return;
    }
    nextUnlock = new Date(parsedUnlock).toISOString();
  }

  db.prepare(`
    UPDATE time_capsules
    SET title = ?, message = ?, capsule_type = ?, unlock_occasion = ?, unlock_at = ?, timezone = ?, media_ids_json = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    nextTitle.slice(0, 160),
    nextMessage,
    capsuleType ?? String(existing.capsule_type),
    unlockOccasion ?? String(existing.unlock_occasion),
    nextUnlock,
    timezone ?? String(existing.timezone),
    Array.isArray(mediaIds) ? JSON.stringify(mediaIds) : String(existing.media_ids_json),
    new Date().toISOString(),
    req.params.id,
    req.authUser!.id
  );

  const updated = db.prepare('SELECT * FROM time_capsules WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  res.json({ capsule: serializeCapsule(updated) });
});

capsuleAndAiRouter.post('/capsules/:id/lock', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT * FROM time_capsules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Time capsule not found.' });
    return;
  }
  if (Date.parse(String(existing.unlock_at)) <= Date.now()) {
    res.status(400).json({ error: 'Unlock date must be in the future before sealing this capsule.' });
    return;
  }

  db.prepare('UPDATE time_capsules SET is_locked = 1, updated_at = ? WHERE id = ? AND user_id = ?').run(
    new Date().toISOString(),
    req.params.id,
    req.authUser!.id
  );
  const updated = db.prepare('SELECT * FROM time_capsules WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  res.json({ capsule: serializeCapsule(updated) });
});

capsuleAndAiRouter.post('/capsules/:id/open', requireAuth, (req: AuthenticatedRequest, res) => {
  const existing = db
    .prepare('SELECT * FROM time_capsules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.authUser!.id) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Time capsule not found.' });
    return;
  }
  if (existing.is_locked && Date.parse(String(existing.unlock_at)) > Date.now()) {
    res.status(403).json({ error: 'This Time Capsule is still locked until its scheduled unlock time.' });
    return;
  }

  const now = new Date().toISOString();
  if (!existing.opened_at) {
    db.prepare('UPDATE time_capsules SET opened_at = ?, updated_at = ? WHERE id = ?').run(now, now, req.params.id);
  }
  const updated = db.prepare('SELECT * FROM time_capsules WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  res.json({ capsule: serializeCapsule(updated) });
});

capsuleAndAiRouter.delete('/capsules/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const result = db
    .prepare('DELETE FROM time_capsules WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.authUser!.id);
  res.json({ deleted: result.changes > 0 });
});

// ==================== ECHO AI ENDPOINTS ====================

capsuleAndAiRouter.get('/ai/history', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY created_at ASC LIMIT 80')
    .all(req.authUser!.id) as Array<Record<string, unknown>>;
  res.json({
    messages: rows.map((r) => ({
      id: r.id,
      module: r.module,
      role: r.role,
      content: r.content,
      sources: (() => {
        try {
          return JSON.parse(String(r.sources_json || '[]'));
        } catch {
          return [];
        }
      })(),
      createdAt: r.created_at,
    })),
  });
});

capsuleAndAiRouter.delete('/ai/history', requireAuth, (req: AuthenticatedRequest, res) => {
  db.prepare('DELETE FROM ai_conversations WHERE user_id = ?').run(req.authUser!.id);
  res.json({ cleared: true });
});

capsuleAndAiRouter.post('/ai/query', requireAuth, rateLimit('ai', 20, 60_000), async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (!user.aiConsent) {
    res.status(403).json({ error: 'AI memory access is currently disabled in your privacy settings.' });
    return;
  }

  const { question } = req.body as { question?: string };
  if (!question || !question.trim()) {
    res.status(400).json({ error: 'Please enter a question for ECHO AI.' });
    return;
  }

  const cleanQ = question.trim().slice(0, 600);

  try {
    const result = await runMemoryAiQuery(user.id, cleanQ);
    const formatted = [
      result.answer,
      result.factsSummary ? `\n\nRecorded Facts:\n${result.factsSummary}` : '',
      result.reflection ? `\n\nAI Reflection:\n${result.reflection}` : '',
    ]
      .join('')
      .trim();

    const nowUser = new Date().toISOString();
    const assistantId = newId('ai');
    const nowAi = new Date().toISOString();

    db.transaction(() => {
      const insertStmt = db.prepare(
        'INSERT INTO ai_conversations (id, user_id, module, role, content, sources_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      insertStmt.run(newId('ai'), user.id, 'memory_ai', 'user', cleanQ, '[]', nowUser);
      insertStmt.run(
        assistantId,
        user.id,
        'memory_ai',
        'assistant',
        formatted,
        JSON.stringify(result.sources),
        nowAi
      );
    })();

    res.json({
      id: assistantId,
      ...result,
      formatted,
      createdAt: nowAi,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ECHO AI service failed.';
    res.status(502).json({ error: message });
  }
});

capsuleAndAiRouter.post('/ai/assist', requireAuth, rateLimit('ai', 25, 60_000), async (req: AuthenticatedRequest, res) => {
  if (!req.authUser!.aiConsent) {
    res.status(403).json({ error: 'AI features are disabled in your privacy settings.' });
    return;
  }
  const { mode, text, context } = req.body as {
    mode?: 'title_and_summary' | 'writing_polish' | 'dream_reflection' | 'connection_suggest';
    text?: string;
    context?: string;
  };

  if (!text || !text.trim()) {
    res.status(400).json({ error: 'Text input is required.' });
    return;
  }

  try {
    const result = await generateMemoryAssist({
      mode: mode || 'writing_polish',
      text: text.slice(0, 4000),
      context: context?.slice(0, 200),
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ECHO AI assist failed.';
    res.status(502).json({ error: message });
  }
});

capsuleAndAiRouter.post('/ai/transcribe', requireAuth, rateLimit('ai', 15, 60_000), async (req: AuthenticatedRequest, res) => {
  const { mediaId } = req.body as { mediaId?: string };
  if (!mediaId) {
    res.status(400).json({ error: 'mediaId is required.' });
    return;
  }

  const media = db
    .prepare('SELECT id, stored_name, mime_type FROM media_files WHERE id = ? AND user_id = ?')
    .get(mediaId, req.authUser!.id) as { id: string; stored_name: string; mime_type: string } | undefined;

  if (!media) {
    res.status(404).json({ error: 'Audio media not found.' });
    return;
  }

  const resolvedPath = path.resolve(UPLOADS_DIR, path.basename(media.stored_name));
  if (!resolvedPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: 'Audio file not found.' });
    return;
  }

  try {
    const buf = fs.readFileSync(resolvedPath);
    const transcript = await transcribeAudioBuffer(buf, media.mime_type);
    db.prepare('UPDATE media_files SET transcript = ? WHERE id = ?').run(transcript, media.id);
    res.json({ transcript });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Audio transcription failed.';
    res.status(502).json({ error: message });
  }
});

capsuleAndAiRouter.post(
  '/ai/analyze-sentiment',
  requireAuth,
  rateLimit('ai', 25, 60_000),
  async (req: AuthenticatedRequest, res) => {
    if (!req.authUser!.aiConsent) {
      res.status(403).json({ error: 'AI features are disabled in your privacy settings.' });
      return;
    }
    const { title, content, mood } = req.body as { title?: string; content?: string; mood?: string };
    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Memory content is required for sentiment analysis.' });
      return;
    }
    try {
      const result = await analyzeMemorySentiment({
        title: title?.slice(0, 160),
        content: content.slice(0, 4000),
        currentMood: mood?.slice(0, 40),
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sentiment analysis failed.';
      res.status(502).json({ error: message });
    }
  }
);

capsuleAndAiRouter.post(
  '/ai/monthly-reflection',
  requireAuth,
  rateLimit('ai', 10, 60_000),
  async (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    if (!user.aiConsent) {
      res.status(403).json({ error: 'AI features are currently disabled in your privacy settings.' });
      return;
    }

    const rawLocalDate =
      typeof (req.body as { localDate?: string })?.localDate === 'string'
        ? (req.body as { localDate?: string }).localDate!.trim()
        : '';
    const localDate = /^\d{4}-\d{2}-\d{2}$/.test(rawLocalDate)
      ? rawLocalDate
      : new Date().toISOString().slice(0, 10);

    const [y, m, d] = localDate.split('-').map(Number);
    const start30Date = new Date(Date.UTC(y, m - 1, d - 29)).toISOString().slice(0, 10);

    const rows = db
      .prepare(`
        SELECT m.id, m.title, m.content, m.memory_date, m.mood, m.emotional_impact
        FROM memories m
        WHERE m.user_id = ?
          AND m.ai_excluded = 0
          AND m.memory_date >= ?
          AND m.memory_date <= ?
          AND EXISTS (
            SELECT 1 FROM memory_tags mt
            WHERE mt.memory_id = m.id AND LOWER(mt.tag) = 'daily-checkin'
          )
        ORDER BY m.memory_date ASC, m.created_at ASC
        LIMIT 45
      `)
      .all(user.id, start30Date, localDate) as Array<{
      id: string;
      title: string;
      content: string;
      memory_date: string;
      mood: string;
      emotional_impact: string;
    }>;

    if (rows.length === 0) {
      res.status(400).json({
        error: 'Save at least one AI-accessible daily check-in from the last 30 days to generate your Monthly Reflection.',
      });
      return;
    }

    try {
      const entries = rows.map((r) => ({
        id: r.id,
        title: r.title,
        memoryDate: r.memory_date,
        mood: r.mood,
        emotionalImpact: r.emotional_impact,
        content: r.content,
      }));
      const result = await generateMonthlyCheckInReflection(entries);
      const sourceIds = entries.map((e) => e.id);
      const generatedAt = new Date().toISOString();
      const reflectionId = newId('mref');

      db.prepare(`
        INSERT INTO monthly_reflections (
          id, user_id, period_key, summary, themes_json, emotional_arc, gentle_prompt, checkin_count, source_ids_json, generated_at
        )
        VALUES (?, ?, 'last-30-days', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, period_key) DO UPDATE SET
          summary = excluded.summary,
          themes_json = excluded.themes_json,
          emotional_arc = excluded.emotional_arc,
          gentle_prompt = excluded.gentle_prompt,
          checkin_count = excluded.checkin_count,
          source_ids_json = excluded.source_ids_json,
          generated_at = excluded.generated_at
      `).run(
        reflectionId,
        user.id,
        result.summary,
        JSON.stringify(result.themes),
        result.emotionalArc,
        result.gentlePrompt,
        entries.length,
        JSON.stringify(sourceIds),
        generatedAt
      );

      res.json({
        reflection: {
          periodKey: 'last-30-days',
          summary: result.summary,
          themes: result.themes,
          emotionalArc: result.emotionalArc,
          gentlePrompt: result.gentlePrompt,
          checkInCount: entries.length,
          sourceIds,
          generatedAt,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to generate Monthly Reflection.';
      res.status(502).json({ error: message });
    }
  }
);

