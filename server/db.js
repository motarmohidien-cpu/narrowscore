/**
 * Database layer — SQLite via better-sqlite3.
 * Handles schema, seeding, and all queries.
 */

import Database from 'better-sqlite3';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'narrowscore.db');
const SEED_PATH = join(__dirname, '..', 'data', 'seed-profiles.json');

let db;

export function getDb() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create schema
  db.exec(`
    -- Users (real accounts via GitHub OAuth)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id INTEGER UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      email TEXT,
      github_token TEXT,
      price_locked_cents INTEGER DEFAULT 0,
      price_locked_at TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'free',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Profiles (scores — linked to users, or simulated)
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      username TEXT UNIQUE NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'F',
      label TEXT NOT NULL DEFAULT 'Fresh Start',
      spend_tier TEXT DEFAULT 'NEWCOMER',
      spend_usd REAL DEFAULT 0,
      tokens_total INTEGER DEFAULT 0,
      days_active INTEGER DEFAULT 1,
      projects INTEGER DEFAULT 1,
      sessions INTEGER DEFAULT 0,
      narrows_cleared INTEGER DEFAULT 0,
      narrows_total INTEGER DEFAULT 8,
      top_tools TEXT DEFAULT '[]',
      avatar_color TEXT DEFAULT '#4ECDC4',
      join_date TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      simulated BOOLEAN DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_score ON profiles(score DESC);
    CREATE INDEX IF NOT EXISTS idx_spend ON profiles(spend_usd DESC);
    CREATE INDEX IF NOT EXISTS idx_tokens ON profiles(tokens_total DESC);
    CREATE INDEX IF NOT EXISTS idx_join_date ON profiles(join_date DESC);
    CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

    -- Follow graph
    CREATE TABLE IF NOT EXISTS follows (
      follower_id INTEGER NOT NULL REFERENCES users(id),
      following_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower_id, following_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
    CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

    -- Score history (for graphs over time)
    CREATE TABLE IF NOT EXISTS score_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      score INTEGER NOT NULL,
      tier TEXT NOT NULL,
      spend_usd REAL DEFAULT 0,
      tokens_total INTEGER DEFAULT 0,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_score_history_user ON score_history(user_id, recorded_at);

    -- Activity feed events
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      event_type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

    -- Reactions on events
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      event_id INTEGER NOT NULL REFERENCES events(id),
      emoji TEXT NOT NULL DEFAULT 'fire',
      created_at TEXT NOT NULL,
      UNIQUE(user_id, event_id)
    );

    -- Comments on profiles
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      profile_user_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_profile ON comments(profile_user_id, created_at DESC);

    -- Badges/achievements
    CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      badge_id TEXT NOT NULL,
      earned_at TEXT NOT NULL,
      UNIQUE(user_id, badge_id)
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);
  `);

  return db;
}

/**
 * Seed the database from seed-profiles.json if empty.
 */
export async function seedIfEmpty() {
  const database = getDb();
  const count = database.prepare('SELECT COUNT(*) as c FROM profiles').get();

  if (count.c > 0) {
    console.log(`Database already has ${count.c} profiles, skipping seed.`);
    return count.c;
  }

  if (!existsSync(SEED_PATH)) {
    console.log('No seed file found. Run: node scripts/seed-generator.js');
    return 0;
  }

  console.log('Seeding database from seed-profiles.json...');
  const data = JSON.parse(await readFile(SEED_PATH, 'utf-8'));

  const insert = database.prepare(`
    INSERT INTO profiles (username, score, tier, label, spend_tier, spend_usd, tokens_total,
      days_active, projects, sessions, narrows_cleared, narrows_total, top_tools,
      avatar_color, join_date, updated_at, simulated)
    VALUES (@username, @score, @tier, @label, @spendTier, @totalSpendUSD, @totalTokens,
      @daysActive, @projects, @sessions, @narrowsCleared, @narrowsTotal, @topTools,
      @avatarColor, @joinDate, @updatedAt, @simulated)
  `);

  const insertMany = database.transaction((profiles) => {
    for (const p of profiles) {
      insert.run({
        ...p,
        topTools: JSON.stringify(p.topTools),
        updatedAt: new Date().toISOString(),
        simulated: p.simulated ? 1 : 0,
      });
    }
  });

  insertMany(data.profiles);
  console.log(`Seeded ${data.profiles.length} profiles.`);
  return data.profiles.length;
}

// --- Query functions ---

export function getLeaderboard({ sort = 'score', page = 1, limit = 50 } = {}) {
  const database = getDb();

  const validSorts = {
    score: 'score DESC, spend_usd DESC',
    spend: 'spend_usd DESC',
    tokens: 'tokens_total DESC',
    recent: 'join_date DESC',
  };
  const orderBy = validSorts[sort] || validSorts.score;
  const offset = (page - 1) * limit;

  const profiles = database.prepare(`
    SELECT id, username, score, tier, label, spend_tier, spend_usd, tokens_total,
      days_active, projects, sessions, narrows_cleared, narrows_total, top_tools,
      avatar_color, join_date
    FROM profiles
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = database.prepare('SELECT COUNT(*) as c FROM profiles').get().c;

  return {
    profiles: profiles.map(p => ({
      ...p,
      top_tools: JSON.parse(p.top_tools),
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

export function getProfile(username) {
  const database = getDb();

  const profile = database.prepare(`
    SELECT * FROM profiles WHERE username = ?
  `).get(username);

  if (!profile) return null;

  // Get rank
  const rank = database.prepare(`
    SELECT COUNT(*) + 1 as rank FROM profiles WHERE score > ?
  `).get(profile.score);

  return {
    ...profile,
    top_tools: JSON.parse(profile.top_tools),
    simulated: undefined, // never expose
    rank: rank.rank,
  };
}

export function submitScore(profileData) {
  const database = getDb();

  const existing = database.prepare('SELECT id FROM profiles WHERE username = ?').get(profileData.username);

  if (existing) {
    // Update
    database.prepare(`
      UPDATE profiles SET
        score = @score, tier = @tier, label = @label, spend_tier = @spendTier,
        spend_usd = @spendUSD, tokens_total = @tokensTotal, days_active = @daysActive,
        projects = @projects, sessions = @sessions, narrows_cleared = @narrowsCleared,
        narrows_total = @narrowsTotal, top_tools = @topTools, updated_at = @updatedAt,
        user_id = COALESCE(@userId, user_id)
      WHERE username = @username
    `).run({
      ...profileData,
      topTools: JSON.stringify(profileData.topTools),
      updatedAt: new Date().toISOString(),
      userId: profileData.userId || null,
    });
  } else {
    // Insert
    database.prepare(`
      INSERT INTO profiles (user_id, username, score, tier, label, spend_tier, spend_usd, tokens_total,
        days_active, projects, sessions, narrows_cleared, narrows_total, top_tools,
        avatar_color, join_date, updated_at, simulated)
      VALUES (@userId, @username, @score, @tier, @label, @spendTier, @spendUSD, @tokensTotal,
        @daysActive, @projects, @sessions, @narrowsCleared, @narrowsTotal, @topTools,
        @avatarColor, @joinDate, @updatedAt, 0)
    `).run({
      ...profileData,
      topTools: JSON.stringify(profileData.topTools),
      avatarColor: profileData.avatarColor || '#4ECDC4',
      joinDate: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString(),
      userId: profileData.userId || null,
    });
  }

  // Return rank
  const rank = database.prepare(`
    SELECT COUNT(*) + 1 as rank FROM profiles WHERE score > ?
  `).get(profileData.score);
  const total = database.prepare('SELECT COUNT(*) as c FROM profiles').get().c;

  return { rank: rank.rank, total };
}

export function getGlobalStats() {
  const database = getDb();

  const stats = database.prepare(`
    SELECT
      COUNT(*) as totalUsers,
      AVG(score) as avgScore,
      SUM(spend_usd) as totalSpend,
      SUM(tokens_total) as totalTokens,
      MAX(score) as topScore
    FROM profiles
  `).get();

  const tierCounts = database.prepare(`
    SELECT tier, COUNT(*) as count FROM profiles GROUP BY tier ORDER BY tier
  `).all();

  const recentJoins = database.prepare(`
    SELECT COUNT(*) as count FROM profiles
    WHERE join_date >= date('now', '-7 days')
  `).get();

  return {
    totalUsers: stats.totalUsers,
    avgScore: Math.round(stats.avgScore),
    totalSpend: Math.round(stats.totalSpend * 100) / 100,
    totalTokens: stats.totalTokens,
    topScore: stats.topScore,
    tierDistribution: Object.fromEntries(tierCounts.map(t => [t.tier, t.count])),
    newUsersThisWeek: recentJoins.count,
  };
}

// ============================
// USER MANAGEMENT
// ============================

/**
 * Find or create a user from GitHub OAuth data.
 */
export function findOrCreateUser(db, ghUser, accessToken) {
  const existing = db.prepare('SELECT * FROM users WHERE github_id = ?').get(ghUser.id);

  if (existing) {
    // Update token and profile info
    db.prepare(`
      UPDATE users SET github_token = ?, display_name = ?, avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).run(accessToken, ghUser.name || ghUser.login, ghUser.avatar_url, new Date().toISOString(), existing.id);
    return existing;
  }

  // Create new user
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO users (github_id, username, display_name, avatar_url, email, github_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ghUser.id, ghUser.login.toLowerCase(), ghUser.name || ghUser.login, ghUser.avatar_url, ghUser.email, accessToken, now, now);

  // Link existing profile if username matches
  const profile = db.prepare('SELECT id FROM profiles WHERE username = ?').get(ghUser.login.toLowerCase());
  if (profile) {
    db.prepare('UPDATE profiles SET user_id = ? WHERE id = ?').run(result.lastInsertRowid, profile.id);
  }

  return { id: result.lastInsertRowid, username: ghUser.login.toLowerCase(), display_name: ghUser.name || ghUser.login };
}

/**
 * Get user by username.
 */
export function getUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}
