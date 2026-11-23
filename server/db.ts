import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'echo.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar_media_id TEXT,
      location_hint TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      theme TEXT NOT NULL DEFAULT 'midnight',
      email_verified INTEGER NOT NULL DEFAULT 1,
      ai_consent INTEGER NOT NULL DEFAULT 1,
      notification_prefs_json TEXT NOT NULL DEFAULT '{"memoryReminders":true,"onThisDay":true,"capsuleUnlocks":true,"wisdomReplies":true,"humanityReactions":true,"skillMatches":true,"sessionReminders":true}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_label TEXT NOT NULL DEFAULT 'Web Browser',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      context_type TEXT NOT NULL DEFAULT 'general',
      context_id TEXT,
      transcript TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#38BDF8',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      memory_date TEXT NOT NULL,
      location_name TEXT NOT NULL DEFAULT '',
      latitude REAL,
      longitude REAL,
      mood TEXT NOT NULL DEFAULT 'Reflective',
      category TEXT NOT NULL DEFAULT 'Important moments',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      ai_excluded INTEGER NOT NULL DEFAULT 0,
      ai_summary TEXT NOT NULL DEFAULT '',
      sentiment_tone TEXT NOT NULL DEFAULT '',
      emotional_impact TEXT NOT NULL DEFAULT '',
      sentiment_score INTEGER,
      sentiment_rationale TEXT NOT NULL DEFAULT '',
      collection_id TEXT REFERENCES memory_collections(id) ON DELETE SET NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      media_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_tags (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      tag TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_people (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      person_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS time_capsules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      capsule_type TEXT NOT NULL DEFAULT 'letter',
      unlock_occasion TEXT NOT NULL DEFAULT 'specific_date',
      unlock_at TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      is_locked INTEGER NOT NULL DEFAULT 0,
      unlocked_notified INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT,
      media_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wisdom_posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_type TEXT NOT NULL DEFAULT 'lesson',
      category TEXT NOT NULL DEFAULT 'Life',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wisdom_replies (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES wisdom_posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS humanity_posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'Hope',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      approx_region TEXT NOT NULL DEFAULT 'Global',
      approx_lat REAL,
      approx_lng REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS humanity_replies (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES humanity_posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_reactions (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(target_type, target_id, user_id, reaction_type)
    );

    CREATE TABLE IF NOT EXISTS user_blocks (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(blocker_id, blocked_user_id)
    );

    CREATE TABLE IF NOT EXISTS content_reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      teach_skills_json TEXT NOT NULL DEFAULT '[]',
      learn_skills_json TEXT NOT NULL DEFAULT '[]',
      experience_level TEXT NOT NULL DEFAULT 'Intermediate',
      bio TEXT NOT NULL DEFAULT '',
      languages_json TEXT NOT NULL DEFAULT '["English"]',
      availability TEXT NOT NULL DEFAULT 'Weekends & Evenings',
      mode TEXT NOT NULL DEFAULT 'Online & In-Person',
      location_city TEXT NOT NULL DEFAULT '',
      portfolio_url TEXT NOT NULL DEFAULT '',
      interests_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_exchanges (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      offered_skill TEXT NOT NULL,
      requested_skill TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      scheduled_at TEXT,
      session_notes TEXT NOT NULL DEFAULT '',
      requester_confirmed INTEGER NOT NULL DEFAULT 0,
      recipient_confirmed INTEGER NOT NULL DEFAULT 0,
      feedback_rating INTEGER,
      feedback_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exchange_messages (
      id TEXT PRIMARY KEY,
      exchange_id TEXT NOT NULL REFERENCES skill_exchanges(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      photo_media_id TEXT,
      voice_media_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      story TEXT NOT NULL,
      acquisition_date TEXT NOT NULL DEFAULT '',
      current_owner TEXT NOT NULL DEFAULT '',
      previous_owners_json TEXT NOT NULL DEFAULT '[]',
      connected_people_json TEXT NOT NULL DEFAULT '[]',
      location TEXT NOT NULL DEFAULT '',
      historical_notes TEXT NOT NULL DEFAULT '',
      related_memory_ids_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      is_public INTEGER NOT NULL DEFAULT 0,
      share_slug TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dreams (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      dream_date TEXT NOT NULL,
      emotion TEXT NOT NULL DEFAULT 'Wonder',
      location TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Lucid',
      vividness INTEGER NOT NULL DEFAULT 3,
      is_recurring INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      image_media_id TEXT,
      voice_media_id TEXT,
      transcript TEXT NOT NULL DEFAULT '',
      ai_reflection TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link_module TEXT NOT NULL DEFAULT 'home',
      link_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      module TEXT NOT NULL DEFAULT 'memory_ai',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offline_sync_receipts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_mutation_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, client_mutation_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_user_date ON memories(user_id, memory_date DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_tags_mem ON memory_tags(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_people_mem ON memory_people(memory_id);
    CREATE INDEX IF NOT EXISTS idx_capsules_user_unlock ON time_capsules(user_id, unlock_at);
    CREATE INDEX IF NOT EXISTS idx_wisdom_category ON wisdom_posts(category, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_humanity_category ON humanity_posts(category, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_exchanges_users ON skill_exchanges(requester_id, recipient_id);
    CREATE INDEX IF NOT EXISTS idx_messages_exchange ON exchange_messages(exchange_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_dreams_user_date ON dreams(user_id, dream_date DESC);
    CREATE INDEX IF NOT EXISTS idx_objects_user ON objects(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
  `);

  const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === 'theme')) {
    db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'midnight'");
  }

  const memoryCols = db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>;
  if (!memoryCols.some((c) => c.name === 'tags_json')) {
    db.exec("ALTER TABLE memories ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
    // Backfill tags_json from existing memory_tags rows
    const rows = db
      .prepare('SELECT memory_id, tag FROM memory_tags')
      .all() as Array<{ memory_id: string; tag: string }>;
    const byMemory = new Map<string, string[]>();
    for (const r of rows) {
      const list = byMemory.get(r.memory_id) || [];
      if (!list.some((t) => t.toLowerCase() === r.tag.toLowerCase())) {
        list.push(r.tag);
      }
      byMemory.set(r.memory_id, list);
    }
    const upd = db.prepare('UPDATE memories SET tags_json = ? WHERE id = ?');
    for (const [memId, tags] of byMemory.entries()) {
      upd.run(JSON.stringify(tags), memId);
    }
  }

  const memoryColsAfterTags = db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>;
  if (!memoryColsAfterTags.some((c) => c.name === 'sentiment_tone')) {
    db.exec("ALTER TABLE memories ADD COLUMN sentiment_tone TEXT NOT NULL DEFAULT ''");
  }
  if (!memoryColsAfterTags.some((c) => c.name === 'emotional_impact')) {
    db.exec("ALTER TABLE memories ADD COLUMN emotional_impact TEXT NOT NULL DEFAULT ''");
  }
  if (!memoryColsAfterTags.some((c) => c.name === 'sentiment_score')) {
    db.exec('ALTER TABLE memories ADD COLUMN sentiment_score INTEGER');
  }
  if (!memoryColsAfterTags.some((c) => c.name === 'sentiment_rationale')) {
    db.exec("ALTER TABLE memories ADD COLUMN sentiment_rationale TEXT NOT NULL DEFAULT ''");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_memories_user_impact ON memories(user_id, emotional_impact)');
}

export function newId(prefix = ''): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}-${id}` : id;
}

export function anonymousAlias(postId: string): string {
  const hash = crypto.createHash('sha256').update(`echo-anon:${postId}`).digest('hex').slice(0, 4).toUpperCase();
  const adjectives = ['Quiet', 'Kindred', 'Distant', 'Gentle', 'Luminous', 'Wandering', 'Still', 'Hopeful'];
  const nouns = ['Lantern', 'Traveler', 'Echo', 'Harbor', 'Observer', 'Voice', 'Horizon', 'Compass'];
  const idxA = parseInt(hash.slice(0, 2), 16) % adjectives.length;
  const idxB = parseInt(hash.slice(2, 4), 16) % nouns.length;
  return `${adjectives[idxA]} ${nouns[idxB]} · #${hash}`;
}
