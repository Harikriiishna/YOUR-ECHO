import { Router } from 'express';
import { type AuthenticatedRequest, requireAuth } from '../auth.ts';
import { anonymousAlias, db, newId } from '../db.ts';
import { broadcastExchangeMessage, pushNotification } from '../ws.ts';

export const communityAndSkillRouter = Router();

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function createNotif(userId: string, type: string, title: string, body: string, linkModule: string, linkId?: string) {
  const id = newId('notif');
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, link_module, link_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, userId, type, title, body, linkModule, linkId ?? null, createdAt);
  pushNotification(userId, { id, type, title, body, linkModule, linkId: linkId ?? null, createdAt });
}

// ==================== STRANGER'S WISDOM (ANONYMOUS) ====================

communityAndSkillRouter.get('/wisdom', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const { category, q, savedOnly, limit = '30', offset = '0' } = req.query as Record<string, string | undefined>;
  const lim = Math.min(Math.max(parseInt(limit || '30', 10) || 30, 1), 60);
  const off = Math.max(parseInt(offset || '0', 10) || 0, 0);

  const wheres: string[] = ['wp.author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)'];
  const params: unknown[] = [userId];

  if (category && category !== 'All') {
    wheres.push('wp.category = ?');
    params.push(category);
  }
  if (q && q.trim()) {
    const like = `%${escapeLike(q.trim())}%`;
    wheres.push("(wp.title LIKE ? ESCAPE '\\' OR wp.content LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (savedOnly === 'true') {
    wheres.push("EXISTS (SELECT 1 FROM community_reactions cr WHERE cr.target_type = 'wisdom' AND cr.target_id = wp.id AND cr.user_id = ? AND cr.reaction_type = 'save')");
    params.push(userId);
  }

  const rows = db
    .prepare(`
      SELECT wp.id, wp.author_id, wp.post_type, wp.category, wp.title, wp.content, wp.created_at,
        (SELECT COUNT(*) FROM community_reactions cr WHERE cr.target_type = 'wisdom' AND cr.target_id = wp.id AND cr.reaction_type = 'helpful') AS helpful_count,
        (SELECT COUNT(*) FROM community_reactions cr WHERE cr.target_type = 'wisdom' AND cr.target_id = wp.id AND cr.reaction_type = 'resonate') AS resonate_count,
        EXISTS(SELECT 1 FROM community_reactions cr WHERE cr.target_type = 'wisdom' AND cr.target_id = wp.id AND cr.user_id = ? AND cr.reaction_type = 'helpful') AS user_helpful,
        EXISTS(SELECT 1 FROM community_reactions cr WHERE cr.target_type = 'wisdom' AND cr.target_id = wp.id AND cr.user_id = ? AND cr.reaction_type = 'resonate') AS user_resonate,
        EXISTS(SELECT 1 FROM community_reactions cr WHERE cr.target_type = 'wisdom' AND cr.target_id = wp.id AND cr.user_id = ? AND cr.reaction_type = 'save') AS user_saved
      FROM wisdom_posts wp
      WHERE ${wheres.join(' AND ')}
      ORDER BY wp.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(userId, userId, userId, ...params, lim, off) as Array<Record<string, unknown>>;

  const posts = rows.map((r) => {
    const postId = String(r.id);
    const replies = db
      .prepare(`
        SELECT wr.id, wr.author_id, wr.content, wr.created_at
        FROM wisdom_replies wr
        WHERE wr.post_id = ?
          AND wr.author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
        ORDER BY wr.created_at ASC
      `)
      .all(postId, userId) as Array<Record<string, unknown>>;

    // Never expose author_id in anonymous API payload
    return {
      id: postId,
      anonymousHandle: anonymousAlias(postId),
      isMine: r.author_id === userId,
      postType: String(r.post_type),
      category: String(r.category),
      title: String(r.title),
      content: String(r.content),
      helpfulCount: Number(r.helpful_count || 0),
      resonateCount: Number(r.resonate_count || 0),
      userHelpful: Boolean(r.user_helpful),
      userResonate: Boolean(r.user_resonate),
      userSaved: Boolean(r.user_saved),
      replies: replies.map((rep) => ({
        id: String(rep.id),
        anonymousHandle: anonymousAlias(String(rep.id)),
        isMine: rep.author_id === userId,
        content: String(rep.content),
        createdAt: String(rep.created_at),
      })),
      createdAt: String(r.created_at),
    };
  });

  res.json({ posts });
});

communityAndSkillRouter.post('/wisdom', requireAuth, (req: AuthenticatedRequest, res) => {
  const { postType, category, title, content } = req.body as {
    postType?: string;
    category?: string;
    title?: string;
    content?: string;
  };
  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: 'Title and content are required.' });
    return;
  }
  const id = newId('wis');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO wisdom_posts (id, author_id, post_type, category, title, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.authUser!.id, (postType || 'lesson').slice(0, 30), (category || 'Life').slice(0, 40), title.trim().slice(0, 160), content.trim().slice(0, 3000), now);

  res.status(201).json({
    post: {
      id,
      anonymousHandle: anonymousAlias(id),
      isMine: true,
      postType: postType || 'lesson',
      category: category || 'Life',
      title: title.trim(),
      content: content.trim(),
      helpfulCount: 0,
      resonateCount: 0,
      userHelpful: false,
      userResonate: false,
      userSaved: false,
      replies: [],
      createdAt: now,
    },
  });
});

communityAndSkillRouter.post('/wisdom/:id/replies', requireAuth, (req: AuthenticatedRequest, res) => {
  const { content } = req.body as { content?: string };
  if (!content?.trim()) {
    res.status(400).json({ error: 'Reply content is required.' });
    return;
  }
  const post = db.prepare('SELECT id, author_id, title FROM wisdom_posts WHERE id = ?').get(req.params.id) as
    | { id: string; author_id: string; title: string }
    | undefined;
  if (!post) {
    res.status(404).json({ error: 'Wisdom post not found.' });
    return;
  }

  const id = newId('wrep');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO wisdom_replies (id, post_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    post.id,
    req.authUser!.id,
    content.trim().slice(0, 2000),
    now
  );

  if (post.author_id !== req.authUser!.id) {
    createNotif(post.author_id, 'wisdom_reply', 'New wisdom reply', `Someone replied anonymously to "${post.title}".`, 'wisdom', post.id);
  }

  res.status(201).json({
    reply: {
      id,
      anonymousHandle: anonymousAlias(id),
      isMine: true,
      content: content.trim(),
      createdAt: now,
    },
  });
});

communityAndSkillRouter.post('/wisdom/:id/react', requireAuth, (req: AuthenticatedRequest, res) => {
  const { reactionType } = req.body as { reactionType?: 'helpful' | 'resonate' | 'save' };
  if (!reactionType || !['helpful', 'resonate', 'save'].includes(reactionType)) {
    res.status(400).json({ error: 'Invalid reactionType.' });
    return;
  }

  const postExists = db.prepare('SELECT id FROM wisdom_posts WHERE id = ?').get(req.params.id);
  if (!postExists) {
    res.status(404).json({ error: 'Wisdom post not found.' });
    return;
  }

  const existing = db
    .prepare("SELECT id FROM community_reactions WHERE target_type = 'wisdom' AND target_id = ? AND user_id = ? AND reaction_type = ?")
    .get(req.params.id, req.authUser!.id, reactionType) as { id: string } | undefined;

  if (existing) {
    db.prepare('DELETE FROM community_reactions WHERE id = ?').run(existing.id);
    res.json({ active: false });
  } else {
    db.prepare("INSERT INTO community_reactions (id, target_type, target_id, user_id, reaction_type, created_at) VALUES (?, 'wisdom', ?, ?, ?, ?)").run(
      newId('rxn'),
      req.params.id,
      req.authUser!.id,
      reactionType,
      new Date().toISOString()
    );
    res.json({ active: true });
  }
});

// ==================== HUMANITY FEED (ANONYMOUS) ====================

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

communityAndSkillRouter.get('/humanity', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const { category, q, savedOnly } = req.query as Record<string, string | undefined>;
  const wheres: string[] = ['hp.author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)'];
  const params: unknown[] = [userId];

  if (category && category !== 'All') {
    wheres.push('hp.category = ?');
    params.push(category);
  }
  if (q && q.trim()) {
    const like = `%${escapeLike(q.trim())}%`;
    wheres.push("(hp.title LIKE ? ESCAPE '\\' OR hp.content LIKE ? ESCAPE '\\' OR hp.approx_region LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  if (savedOnly === 'true') {
    wheres.push("EXISTS (SELECT 1 FROM community_reactions cr WHERE cr.target_type = 'humanity' AND cr.target_id = hp.id AND cr.user_id = ? AND cr.reaction_type = 'save')");
    params.push(userId);
  }

  const rows = db
    .prepare(`
      SELECT hp.id, hp.author_id, hp.category, hp.title, hp.content, hp.approx_region, hp.approx_lat, hp.approx_lng, hp.created_at,
        (SELECT COUNT(*) FROM community_reactions cr WHERE cr.target_type = 'humanity' AND cr.target_id = hp.id AND cr.reaction_type = 'helpful') AS helpful_count,
        EXISTS(SELECT 1 FROM community_reactions cr WHERE cr.target_type = 'humanity' AND cr.target_id = hp.id AND cr.user_id = ? AND cr.reaction_type = 'helpful') AS user_helpful,
        EXISTS(SELECT 1 FROM community_reactions cr WHERE cr.target_type = 'humanity' AND cr.target_id = hp.id AND cr.user_id = ? AND cr.reaction_type = 'save') AS user_saved
      FROM humanity_posts hp
      WHERE ${wheres.join(' AND ')}
      ORDER BY hp.created_at DESC
      LIMIT 60
    `)
    .all(userId, userId, ...params) as Array<Record<string, unknown>>;

  const posts = rows.map((r) => {
    const postId = String(r.id);
    const replies = db
      .prepare(`
        SELECT hr.id, hr.author_id, hr.content, hr.created_at
        FROM humanity_replies hr
        WHERE hr.post_id = ?
          AND hr.author_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
        ORDER BY hr.created_at ASC
      `)
      .all(postId, userId) as Array<Record<string, unknown>>;

    return {
      id: postId,
      anonymousHandle: anonymousAlias(postId),
      isMine: r.author_id === userId,
      category: String(r.category),
      title: String(r.title),
      content: String(r.content),
      approxRegion: String(r.approx_region),
      approxLat: r.approx_lat !== null ? Number(r.approx_lat) : null,
      approxLng: r.approx_lng !== null ? Number(r.approx_lng) : null,
      helpfulCount: Number(r.helpful_count || 0),
      userHelpful: Boolean(r.user_helpful),
      userSaved: Boolean(r.user_saved),
      replies: replies.map((rep) => ({
        id: String(rep.id),
        anonymousHandle: anonymousAlias(String(rep.id)),
        isMine: rep.author_id === userId,
        content: String(rep.content),
        createdAt: String(rep.created_at),
      })),
      createdAt: String(r.created_at),
    };
  });

  res.json({ posts });
});

communityAndSkillRouter.post('/humanity', requireAuth, (req: AuthenticatedRequest, res) => {
  const { category, title, content, approxRegion } = req.body as {
    category?: string;
    title?: string;
    content?: string;
    approxRegion?: string;
  };
  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: 'Title and story content are required.' });
    return;
  }

  const region = approxRegion && REGION_COORDS[approxRegion] ? approxRegion : 'Global';
  const coords = REGION_COORDS[region];
  const id = newId('hum');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO humanity_posts (id, author_id, category, title, content, approx_region, approx_lat, approx_lng, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.authUser!.id, (category || 'Hope').slice(0, 40), title.trim().slice(0, 160), content.trim().slice(0, 3000), region, coords.lat, coords.lng, now);

  res.status(201).json({
    post: {
      id,
      anonymousHandle: anonymousAlias(id),
      isMine: true,
      category: category || 'Hope',
      title: title.trim(),
      content: content.trim(),
      approxRegion: region,
      approxLat: coords.lat,
      approxLng: coords.lng,
      helpfulCount: 0,
      userHelpful: false,
      userSaved: false,
      replies: [],
      createdAt: now,
    },
  });
});

communityAndSkillRouter.post('/humanity/:id/replies', requireAuth, (req: AuthenticatedRequest, res) => {
  const { content } = req.body as { content?: string };
  if (!content?.trim()) {
    res.status(400).json({ error: 'Reply content is required.' });
    return;
  }
  const post = db.prepare('SELECT id, author_id, title FROM humanity_posts WHERE id = ?').get(req.params.id) as
    | { id: string; author_id: string; title: string }
    | undefined;
  if (!post) {
    res.status(404).json({ error: 'Story not found.' });
    return;
  }
  const id = newId('hrep');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO humanity_replies (id, post_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    post.id,
    req.authUser!.id,
    content.trim().slice(0, 2000),
    now
  );
  if (post.author_id !== req.authUser!.id) {
    createNotif(post.author_id, 'humanity_reply', 'Someone answered your Humanity story', `A reader shared a warm reflection on "${post.title}".`, 'humanity', post.id);
  }
  res.status(201).json({
    reply: {
      id,
      anonymousHandle: anonymousAlias(id),
      isMine: true,
      content: content.trim(),
      createdAt: now,
    },
  });
});

communityAndSkillRouter.post('/humanity/:id/react', requireAuth, (req: AuthenticatedRequest, res) => {
  const { reactionType } = req.body as { reactionType?: 'helpful' | 'save' };
  if (!reactionType || !['helpful', 'save'].includes(reactionType)) {
    res.status(400).json({ error: 'Invalid reactionType.' });
    return;
  }
  const postExists = db.prepare('SELECT id FROM humanity_posts WHERE id = ?').get(req.params.id);
  if (!postExists) {
    res.status(404).json({ error: 'Story not found.' });
    return;
  }
  const existing = db
    .prepare("SELECT id FROM community_reactions WHERE target_type = 'humanity' AND target_id = ? AND user_id = ? AND reaction_type = ?")
    .get(req.params.id, req.authUser!.id, reactionType) as { id: string } | undefined;

  if (existing) {
    db.prepare('DELETE FROM community_reactions WHERE id = ?').run(existing.id);
    res.json({ active: false });
  } else {
    db.prepare("INSERT INTO community_reactions (id, target_type, target_id, user_id, reaction_type, created_at) VALUES (?, 'humanity', ?, ?, ?, ?)").run(
      newId('rxn'),
      req.params.id,
      req.authUser!.id,
      reactionType,
      new Date().toISOString()
    );
    res.json({ active: true });
  }
});

// ==================== MODERATION: REPORT & BLOCK ====================

communityAndSkillRouter.post('/community/report', requireAuth, (req: AuthenticatedRequest, res) => {
  const { targetType, targetId, reason, details } = req.body as {
    targetType?: string;
    targetId?: string;
    reason?: string;
    details?: string;
  };
  if (!targetType || !targetId || !reason?.trim()) {
    res.status(400).json({ error: 'targetType, targetId, and reason are required.' });
    return;
  }
  const id = newId('rep');
  db.prepare(`
    INSERT INTO content_reports (id, reporter_id, target_type, target_id, reason, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.authUser!.id, targetType.slice(0, 30), targetId, reason.trim().slice(0, 100), (details || '').slice(0, 500), new Date().toISOString());
  res.status(201).json({ reported: true, id });
});

communityAndSkillRouter.post('/community/block', requireAuth, (req: AuthenticatedRequest, res) => {
  const { targetType, targetId, userId: directUserId } = req.body as {
    targetType?: 'wisdom' | 'humanity' | 'skill_user';
    targetId?: string;
    userId?: string;
  };

  let blockedId: string | null = null;
  if (targetType === 'wisdom' && targetId) {
    const row = db.prepare('SELECT author_id FROM wisdom_posts WHERE id = ?').get(targetId) as { author_id: string } | undefined;
    if (row) blockedId = row.author_id;
  } else if (targetType === 'humanity' && targetId) {
    const row = db.prepare('SELECT author_id FROM humanity_posts WHERE id = ?').get(targetId) as { author_id: string } | undefined;
    if (row) blockedId = row.author_id;
  } else if (directUserId) {
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(directUserId) as { id: string } | undefined;
    if (!targetUser) {
      res.status(404).json({ error: 'Target account not found.' });
      return;
    }
    blockedId = targetUser.id;
  }

  if (!blockedId || blockedId === req.authUser!.id) {
    res.status(400).json({ error: 'Unable to block target account.' });
    return;
  }

  db.prepare('INSERT OR IGNORE INTO user_blocks (id, blocker_id, blocked_user_id, created_at) VALUES (?, ?, ?, ?)').run(
    newId('blk'),
    req.authUser!.id,
    blockedId,
    new Date().toISOString()
  );

  // Never echo back the blocked anonymous author's user ID
  res.json({ blocked: true });
});

// ==================== SKILLSWAP MODULE ====================

function parseSkillRow(row: Record<string, unknown>) {
  const safeParse = (v: unknown) => {
    try {
      return JSON.parse(String(v || '[]'));
    } catch {
      return [];
    }
  };
  return {
    userId: String(row.user_id),
    displayName: row.display_name ? String(row.display_name) : undefined,
    teachSkills: safeParse(row.teach_skills_json) as string[],
    learnSkills: safeParse(row.learn_skills_json) as string[],
    experienceLevel: String(row.experience_level || 'Intermediate'),
    bio: String(row.bio || ''),
    languages: safeParse(row.languages_json) as string[],
    availability: String(row.availability || ''),
    mode: String(row.mode || 'Online & In-Person'),
    locationCity: String(row.location_city || ''),
    portfolioUrl: String(row.portfolio_url || ''),
    interests: safeParse(row.interests_json) as string[],
  };
}

communityAndSkillRouter.get('/skills/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const row = db
    .prepare('SELECT sp.*, u.display_name FROM skill_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = ?')
    .get(req.authUser!.id) as Record<string, unknown> | undefined;

  if (!row) {
    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO skill_profiles (user_id, updated_at) VALUES (?, ?)').run(req.authUser!.id, now);
    const created = db
      .prepare('SELECT sp.*, u.display_name FROM skill_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = ?')
      .get(req.authUser!.id) as Record<string, unknown>;
    res.json({ profile: parseSkillRow(created) });
    return;
  }
  res.json({ profile: parseSkillRow(row) });
});

communityAndSkillRouter.put('/skills/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const { teachSkills, learnSkills, experienceLevel, bio, languages, availability, mode, locationCity, portfolioUrl, interests } = req.body as {
    teachSkills?: string[];
    learnSkills?: string[];
    experienceLevel?: string;
    bio?: string;
    languages?: string[];
    availability?: string;
    mode?: string;
    locationCity?: string;
    portfolioUrl?: string;
    interests?: string[];
  };

  const cleanList = (arr: unknown) =>
    Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : [];

  const safeUrl =
    portfolioUrl && /^https?:\/\//i.test(portfolioUrl.trim()) ? portfolioUrl.trim().slice(0, 300) : '';

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO skill_profiles (user_id, teach_skills_json, learn_skills_json, experience_level, bio, languages_json, availability, mode, location_city, portfolio_url, interests_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      teach_skills_json = excluded.teach_skills_json,
      learn_skills_json = excluded.learn_skills_json,
      experience_level = excluded.experience_level,
      bio = excluded.bio,
      languages_json = excluded.languages_json,
      availability = excluded.availability,
      mode = excluded.mode,
      location_city = excluded.location_city,
      portfolio_url = excluded.portfolio_url,
      interests_json = excluded.interests_json,
      updated_at = excluded.updated_at
  `).run(
    req.authUser!.id,
    JSON.stringify(cleanList(teachSkills)),
    JSON.stringify(cleanList(learnSkills)),
    (experienceLevel || 'Intermediate').slice(0, 40),
    (bio || '').slice(0, 500),
    JSON.stringify(cleanList(languages)),
    (availability || 'Weekends & Evenings').slice(0, 100),
    (mode || 'Online & In-Person').slice(0, 40),
    (locationCity || '').slice(0, 80),
    safeUrl,
    JSON.stringify(cleanList(interests)),
    now
  );

  const updated = db
    .prepare('SELECT sp.*, u.display_name FROM skill_profiles sp JOIN users u ON u.id = sp.user_id WHERE sp.user_id = ?')
    .get(req.authUser!.id) as Record<string, unknown>;
  res.json({ profile: parseSkillRow(updated) });
});

communityAndSkillRouter.get('/skills/discover', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const { q, mode } = req.query as Record<string, string | undefined>;

  const myRow = db.prepare('SELECT * FROM skill_profiles WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;
  const myProfile = myRow ? parseSkillRow(myRow) : null;
  const myTeachLower = new Set((myProfile?.teachSkills || []).map((s) => s.toLowerCase()));
  const myLearnLower = new Set((myProfile?.learnSkills || []).map((s) => s.toLowerCase()));

  const others = db
    .prepare(`
      SELECT sp.*, u.display_name
      FROM skill_profiles sp
      JOIN users u ON u.id = sp.user_id
      WHERE sp.user_id != ?
        AND sp.user_id NOT IN (SELECT blocked_user_id FROM user_blocks WHERE blocker_id = ?)
    `)
    .all(userId, userId) as Array<Record<string, unknown>>;

  let listings = others.map((row) => {
    const p = parseSkillRow(row);
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

  if (mode && mode !== 'All') {
    listings = listings.filter((l) => l.mode.toLowerCase().includes(mode.toLowerCase()));
  }
  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();
    listings = listings.filter(
      (l) =>
        (l.displayName || '').toLowerCase().includes(needle) ||
        l.teachSkills.some((s) => s.toLowerCase().includes(needle)) ||
        l.learnSkills.some((s) => s.toLowerCase().includes(needle)) ||
        l.locationCity.toLowerCase().includes(needle)
    );
  }

  listings.sort((a, b) => b.matchScore - a.matchScore);
  res.json({ listings });
});

communityAndSkillRouter.get('/skills/exchanges', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const rows = db
    .prepare(`
      SELECT se.*, req_u.display_name AS requester_name, rec_u.display_name AS recipient_name
      FROM skill_exchanges se
      JOIN users req_u ON req_u.id = se.requester_id
      JOIN users rec_u ON rec_u.id = se.recipient_id
      WHERE se.requester_id = ? OR se.recipient_id = ?
      ORDER BY se.updated_at DESC
    `)
    .all(userId, userId) as Array<Record<string, unknown>>;

  res.json({
    exchanges: rows.map((r) => ({
      id: String(r.id),
      requesterId: String(r.requester_id),
      recipientId: String(r.recipient_id),
      requesterName: String(r.requester_name),
      recipientName: String(r.recipient_name),
      offeredSkill: String(r.offered_skill),
      requestedSkill: String(r.requested_skill),
      message: String(r.message),
      status: String(r.status),
      scheduledAt: r.scheduled_at ? String(r.scheduled_at) : null,
      sessionNotes: String(r.session_notes || ''),
      requesterConfirmed: Boolean(r.requester_confirmed),
      recipientConfirmed: Boolean(r.recipient_confirmed),
      feedbackRating: r.feedback_rating !== null ? Number(r.feedback_rating) : null,
      feedbackNote: String(r.feedback_note || ''),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    })),
  });
});

communityAndSkillRouter.post('/skills/exchanges', requireAuth, (req: AuthenticatedRequest, res) => {
  const { recipientId, offeredSkill, requestedSkill, message } = req.body as {
    recipientId?: string;
    offeredSkill?: string;
    requestedSkill?: string;
    message?: string;
  };
  if (!recipientId || !offeredSkill?.trim() || !requestedSkill?.trim()) {
    res.status(400).json({ error: 'Recipient, offered skill, and requested skill are required.' });
    return;
  }
  if (recipientId === req.authUser!.id) {
    res.status(400).json({ error: 'You cannot send an exchange request to yourself.' });
    return;
  }
  const recipient = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(recipientId) as
    | { id: string; display_name: string }
    | undefined;
  if (!recipient) {
    res.status(404).json({ error: 'SkillSwap partner not found.' });
    return;
  }

  const id = newId('ex');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO skill_exchanges (id, requester_id, recipient_id, offered_skill, requested_skill, message, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, req.authUser!.id, recipientId, offeredSkill.trim().slice(0, 80), requestedSkill.trim().slice(0, 80), (message || '').trim().slice(0, 1000), now, now);

  createNotif(
    recipientId,
    'skill_request',
    'New SkillSwap Request',
    `${req.authUser!.displayName} offered ${offeredSkill.trim()} for ${requestedSkill.trim()}.`,
    'skillswap',
    id
  );

  res.status(201).json({ id, status: 'pending' });
});

communityAndSkillRouter.patch('/skills/exchanges/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const ex = db.prepare('SELECT * FROM skill_exchanges WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;

  if (!ex || (ex.requester_id !== userId && ex.recipient_id !== userId)) {
    res.status(404).json({ error: 'Exchange not found.' });
    return;
  }

  const { action, scheduledAt, sessionNotes, feedbackRating, feedbackNote } = req.body as {
    action?: 'accept' | 'reject' | 'cancel' | 'schedule' | 'confirm_complete' | 'feedback';
    scheduledAt?: string;
    sessionNotes?: string;
    feedbackRating?: number;
    feedbackNote?: string;
  };

  const isRequester = ex.requester_id === userId;
  const isRecipient = ex.recipient_id === userId;
  const partnerId = isRequester ? String(ex.recipient_id) : String(ex.requester_id);
  const currentStatus = String(ex.status);
  const now = new Date().toISOString();

  if (action === 'accept') {
    if (!isRecipient || currentStatus !== 'pending') {
      res.status(400).json({ error: 'Only pending requests can be accepted by the recipient.' });
      return;
    }
    db.prepare("UPDATE skill_exchanges SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, ex.id);
    createNotif(partnerId, 'skill_accepted', 'SkillSwap Request Accepted', `${req.authUser!.displayName} accepted your exchange.`, 'skillswap', String(ex.id));
  } else if (action === 'reject') {
    if (!isRecipient || currentStatus !== 'pending') {
      res.status(400).json({ error: 'Only pending requests can be rejected by the recipient.' });
      return;
    }
    db.prepare("UPDATE skill_exchanges SET status = 'rejected', updated_at = ? WHERE id = ?").run(now, ex.id);
  } else if (action === 'cancel') {
    if (!['pending', 'accepted', 'scheduled'].includes(currentStatus)) {
      res.status(400).json({ error: 'This exchange cannot be cancelled in its current state.' });
      return;
    }
    db.prepare("UPDATE skill_exchanges SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, ex.id);
  } else if (action === 'schedule') {
    const scheduledMs = scheduledAt ? Date.parse(scheduledAt) : NaN;
    if (!['accepted', 'scheduled'].includes(currentStatus) || !Number.isFinite(scheduledMs)) {
      res.status(400).json({ error: 'Accepted exchange and valid session date are required.' });
      return;
    }
    const scheduledDate = new Date(scheduledMs);
    db.prepare("UPDATE skill_exchanges SET status = 'scheduled', scheduled_at = ?, session_notes = ?, updated_at = ? WHERE id = ?").run(
      scheduledDate.toISOString(),
      (sessionNotes || '').slice(0, 500),
      now,
      ex.id
    );
    createNotif(partnerId, 'session_reminder', 'SkillSwap Session Scheduled', `Session scheduled for ${scheduledDate.toLocaleString()}.`, 'skillswap', String(ex.id));
  } else if (action === 'confirm_complete') {
    if (!['accepted', 'scheduled'].includes(currentStatus)) {
      res.status(400).json({ error: 'Only active exchanges can be confirmed for completion.' });
      return;
    }
    const nextReqConf = isRequester ? 1 : Number(ex.requester_confirmed);
    const nextRecConf = isRecipient ? 1 : Number(ex.recipient_confirmed);
    const bothConfirmed = nextReqConf === 1 && nextRecConf === 1;
    const nextStatus = bothConfirmed ? 'completed' : currentStatus;
    db.prepare('UPDATE skill_exchanges SET requester_confirmed = ?, recipient_confirmed = ?, status = ?, updated_at = ? WHERE id = ?').run(
      nextReqConf,
      nextRecConf,
      nextStatus,
      now,
      ex.id
    );
  } else if (action === 'feedback') {
    if (currentStatus !== 'completed') {
      res.status(400).json({ error: 'Feedback can only be left after both parties confirm completion.' });
      return;
    }
    const rating = Math.min(Math.max(Number(feedbackRating) || 5, 1), 5);
    db.prepare('UPDATE skill_exchanges SET feedback_rating = ?, feedback_note = ?, updated_at = ? WHERE id = ?').run(
      rating,
      (feedbackNote || '').slice(0, 500),
      now,
      ex.id
    );
  } else {
    res.status(400).json({ error: 'Invalid exchange action.' });
    return;
  }

  res.json({ ok: true });
});

communityAndSkillRouter.get('/skills/exchanges/:id/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const ex = db.prepare('SELECT requester_id, recipient_id FROM skill_exchanges WHERE id = ?').get(req.params.id) as
    | { requester_id: string; recipient_id: string }
    | undefined;
  if (!ex || (ex.requester_id !== userId && ex.recipient_id !== userId)) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const rows = db
    .prepare(`
      SELECT em.id, em.sender_id, u.display_name AS sender_name, em.content, em.created_at
      FROM exchange_messages em
      JOIN users u ON u.id = em.sender_id
      WHERE em.exchange_id = ?
      ORDER BY em.created_at ASC
    `)
    .all(req.params.id);

  res.json({ messages: rows });
});

communityAndSkillRouter.post('/skills/exchanges/:id/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const ex = db.prepare('SELECT id, requester_id, recipient_id FROM skill_exchanges WHERE id = ?').get(req.params.id) as
    | { id: string; requester_id: string; recipient_id: string }
    | undefined;
  if (!ex || (ex.requester_id !== userId && ex.recipient_id !== userId)) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const { content } = req.body as { content?: string };
  if (!content?.trim()) {
    res.status(400).json({ error: 'Message content cannot be empty.' });
    return;
  }

  const msgId = newId('msg');
  const createdAt = new Date().toISOString();
  const cleanContent = content.trim().slice(0, 2000);

  db.prepare('INSERT INTO exchange_messages (id, exchange_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
    msgId,
    ex.id,
    userId,
    cleanContent,
    createdAt
  );

  const payload = {
    id: msgId,
    sender_id: userId,
    sender_name: req.authUser!.displayName,
    content: cleanContent,
    created_at: createdAt,
  };

  broadcastExchangeMessage(ex.requester_id, ex.recipient_id, ex.id, payload);
  res.status(201).json({ message: payload });
});
