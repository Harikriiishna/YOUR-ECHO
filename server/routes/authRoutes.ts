import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
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
import { pushNotification } from '../ws.ts';

export const authRouter = Router();

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

authRouter.post('/auth/register', rateLimit('auth', 20, 60_000), (req, res) => {
  const { email, password, displayName, timezone } = req.body as {
    email?: string;
    password?: string;
    displayName?: string;
    timezone?: string;
  };

  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanName = (displayName || '').trim();
  if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length > 160) {
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

  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, cleanEmail, pwHash, cleanName.slice(0, 80), tz, now, now);

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
  const { token } = createSession(String(userRow.id), label);
  setSessionCookie(req, res, token);

  res.json({
    user: rowToAuthUser(userRow),
    token,
  });
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
  const { displayName, bio, avatarMediaId, locationHint, timezone, aiConsent, notificationPrefs } = req.body as {
    displayName?: string;
    bio?: string;
    avatarMediaId?: string | null;
    locationHint?: string;
    timezone?: string;
    aiConsent?: boolean;
    notificationPrefs?: Record<string, boolean>;
  };

  const user = req.authUser!;
  const cleanName = typeof displayName === 'string' && displayName.trim().length >= 2 ? displayName.trim().slice(0, 80) : user.displayName;
  const cleanBio = typeof bio === 'string' ? bio.slice(0, 500) : user.bio;
  const cleanLocation = typeof locationHint === 'string' ? locationHint.slice(0, 100) : user.locationHint;
  const cleanTz = typeof timezone === 'string' ? timezone.slice(0, 60) : user.timezone;
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
    SET display_name = ?, bio = ?, avatar_media_id = ?, location_hint = ?, timezone = ?, ai_consent = ?, notification_prefs_json = ?, updated_at = ?
    WHERE id = ?
  `).run(cleanName, cleanBio, verifiedAvatar, cleanLocation, cleanTz, cleanAiConsent, cleanPrefs, new Date().toISOString(), user.id);

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

authRouter.get('/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const nowIso = new Date().toISOString();
  const monthDay = nowIso.slice(5, 10);

  // Check and trigger due capsule unlock notifications
  const dueCapsules = db
    .prepare('SELECT id, title, unlock_at FROM time_capsules WHERE user_id = ? AND is_locked = 1 AND unlock_at <= ? AND unlocked_notified = 0')
    .all(userId, nowIso) as Array<{ id: string; title: string; unlock_at: string }>;

  for (const cap of dueCapsules) {
    db.prepare('UPDATE time_capsules SET unlocked_notified = 1 WHERE id = ?').run(cap.id);
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
    .all(userId, monthDay, nowIso.slice(0, 4));

  const nextCapsule = db
    .prepare('SELECT id, title, capsule_type, unlock_occasion, unlock_at, is_locked, opened_at FROM time_capsules WHERE user_id = ? AND is_locked = 1 AND unlock_at > ? ORDER BY unlock_at ASC LIMIT 1')
    .get(userId, nowIso) || null;

  const readyCapsules = (db
    .prepare('SELECT COUNT(*) as c FROM time_capsules WHERE user_id = ? AND is_locked = 1 AND unlock_at <= ? AND opened_at IS NULL')
    .get(userId, nowIso) as { c: number }).c;

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

  res.json({
    stats: { memoryCount, dreamCount, objectCount, capsuleCount, readyCapsules, unreadNotifications },
    featuredMemory,
    recentMemories,
    onThisDay,
    nextCapsule,
    humanityHighlights,
    skillDiscovery,
  });
});
