#!/usr/bin/env node
/**
 * NarrowScore API Server — v10.
 * Express + SQLite. Auth, social, leaderboard, Stripe.
 */

import express from 'express';
import cors from 'cors';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { getDb, seedIfEmpty, getLeaderboard, getProfile, submitScore, getGlobalStats, findOrCreateUser, getUserByUsername } from './db.js';
import { startDeviceFlow, pollDeviceFlow, exchangeCode, getGitHubUser, generateJWT, requireAuth, optionalAuth, GITHUB_CLIENT_ID } from './auth.js';
import { getCurrentPriceCents, formatPrice, getUrgencyMessage } from './pricing.js';
import { checkAndAwardBadges, BADGES } from './badges.js';
import * as social from './social.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3457;

app.use(cors());
app.use(express.json());

// Serve website static files
app.use(express.static(join(__dirname, '..', 'website')));

// ============================
// AUTH ROUTES
// ============================

// Start device flow (CLI)
app.post('/auth/device', async (_req, res) => {
  try {
    const data = await startDeviceFlow();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start device flow', details: err.message });
  }
});

// Poll device flow (CLI)
app.post('/auth/device/poll', async (req, res) => {
  try {
    const result = await pollDeviceFlow(req.body.device_code);

    if (result.access_token) {
      const ghUser = await getGitHubUser(result.access_token);
      const db = getDb();
      const user = findOrCreateUser(db, ghUser, result.access_token);
      const token = generateJWT({ userId: user.id, username: user.username });
      return res.json({ success: true, token, username: user.username, userId: user.id });
    }

    res.json(result); // Still pending or errored
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GitHub OAuth callback (web flow)
app.get('/auth/github/callback', async (req, res) => {
  try {
    const result = await exchangeCode(req.query.code);
    if (!result.access_token) {
      return res.redirect('/?error=auth_failed');
    }

    const ghUser = await getGitHubUser(result.access_token);
    const db = getDb();
    const user = findOrCreateUser(db, ghUser, result.access_token);
    const token = generateJWT({ userId: user.id, username: user.username });

    // Redirect to frontend with token
    res.redirect(`/?token=${token}&username=${user.username}`);
  } catch (err) {
    res.redirect('/?error=auth_failed');
  }
});

// Get auth URL for web flow
app.get('/auth/github', (_req, res) => {
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=read:user%20user:email`;
  res.json({ url });
});

// Get current user info
app.get('/api/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, display_name, avatar_url, subscription_status, price_locked_cents, created_at FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const profile = getProfile(user.username);
  const badges = db.prepare('SELECT badge_id, earned_at FROM user_badges WHERE user_id = ?').all(user.id);

  res.json({ ...user, profile, badges });
});

// ============================
// LEADERBOARD + PROFILES
// ============================

app.get('/api/leaderboard', (req, res) => {
  const sort = req.query.sort || 'score';
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  res.json(getLeaderboard({ sort, page, limit }));
});

app.get('/api/profile/:username', optionalAuth, (req, res) => {
  const profile = getProfile(req.params.username);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const db = getDb();

  // Add social data
  const user = getUserByUsername(db, req.params.username);
  if (user) {
    const followers = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(user.id).c;
    const following = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(user.id).c;
    const badges = db.prepare('SELECT badge_id, earned_at FROM user_badges WHERE user_id = ?').all(user.id);

    profile.followers = followers;
    profile.following = following;
    profile.badges = badges.map(b => ({ ...b, ...BADGES[b.badge_id] }));
    profile.avatar_url = user.avatar_url;

    // Check if current user follows this profile
    if (req.user) {
      const isFollowing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.userId, user.id);
      profile.isFollowing = !!isFollowing;
    }
  }

  res.json(profile);
});

// Submit score (now creates feed events + badges)
app.post('/api/submit', optionalAuth, (req, res) => {
  const { username, score, tier, label, spendTier, spendUSD, tokensTotal,
    daysActive, projects, sessions, narrowsCleared, narrowsTotal, topTools } = req.body;

  if (!username || score === undefined) {
    return res.status(400).json({ error: 'username and score are required' });
  }

  const db = getDb();

  // Get previous score for comparison
  const existingProfile = db.prepare('SELECT score, tier FROM profiles WHERE username = ?').get(username);
  const prevScore = existingProfile?.score;
  const prevTier = existingProfile?.tier;

  const result = submitScore({
    username,
    score: Math.max(0, Math.min(100, parseInt(score))),
    tier: tier || 'F',
    label: label || 'Fresh Start',
    spendTier: spendTier || 'NEWCOMER',
    spendUSD: parseFloat(spendUSD) || 0,
    tokensTotal: parseInt(tokensTotal) || 0,
    daysActive: parseInt(daysActive) || 1,
    projects: parseInt(projects) || 1,
    sessions: parseInt(sessions) || 0,
    narrowsCleared: parseInt(narrowsCleared) || 0,
    narrowsTotal: parseInt(narrowsTotal) || 8,
    topTools: Array.isArray(topTools) ? topTools.slice(0, 5) : [],
    userId: req.user?.userId || null,
  });

  // Create feed events if authenticated
  if (req.user) {
    const newScore = parseInt(score);

    // Score change event
    if (prevScore !== undefined && newScore !== prevScore) {
      social.createEvent(db, req.user.userId, 'score_change', {
        oldScore: prevScore, newScore, change: newScore - prevScore,
      });
    }

    // Tier up event
    if (prevTier && tier && tier < prevTier) { // S < A < B etc (string compare works)
      social.createEvent(db, req.user.userId, 'tier_up', {
        oldTier: prevTier, newTier: tier,
      });
    }

    // Record score history
    db.prepare('INSERT INTO score_history (user_id, score, tier, spend_usd, tokens_total, recorded_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      req.user.userId, newScore, tier, parseFloat(spendUSD) || 0, parseInt(tokensTotal) || 0, new Date().toISOString()
    );

    // Check badges
    const newBadges = checkAndAwardBadges(db, req.user.userId);
    for (const badgeId of newBadges) {
      social.createEvent(db, req.user.userId, 'badge_earned', {
        badge_id: badgeId, badge: BADGES[badgeId],
      });
    }

    result.newBadges = newBadges.map(id => ({ id, ...BADGES[id] }));
  }

  res.json({
    success: true,
    rank: result.rank,
    total: result.total,
    message: `You're #${result.rank} out of ${result.total} users!`,
    newBadges: result.newBadges || [],
  });
});

app.get('/api/stats', (_req, res) => {
  const stats = getGlobalStats();
  stats.pricing = {
    currentPriceCents: getCurrentPriceCents(),
    currentPrice: formatPrice(getCurrentPriceCents()),
    urgencyMessage: getUrgencyMessage(),
  };
  res.json(stats);
});

// ============================
// SOCIAL ROUTES
// ============================

// Follow/unfollow
app.post('/api/follow/:username', requireAuth, (req, res) => {
  const db = getDb();
  const target = getUserByUsername(db, req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const ok = social.follow(db, req.user.userId, target.id);
  res.json({ success: ok });
});

app.delete('/api/follow/:username', requireAuth, (req, res) => {
  const db = getDb();
  const target = getUserByUsername(db, req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  social.unfollow(db, req.user.userId, target.id);
  res.json({ success: true });
});

app.get('/api/users/:username/followers', (req, res) => {
  const db = getDb();
  const user = getUserByUsername(db, req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(social.getFollowers(db, user.id, parseInt(req.query.page) || 1));
});

app.get('/api/users/:username/following', (req, res) => {
  const db = getDb();
  const user = getUserByUsername(db, req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(social.getFollowing(db, user.id, parseInt(req.query.page) || 1));
});

// Feed
app.get('/api/feed', requireAuth, (req, res) => {
  const db = getDb();
  res.json(social.getFeed(db, req.user.userId, parseInt(req.query.page) || 1));
});

app.get('/api/feed/global', optionalAuth, (req, res) => {
  const db = getDb();
  res.json(social.getGlobalFeed(db, req.user?.userId, parseInt(req.query.page) || 1));
});

// Reactions
app.post('/api/events/:id/react', requireAuth, (req, res) => {
  const db = getDb();
  const ok = social.addReaction(db, req.user.userId, parseInt(req.params.id), req.body.emoji);
  res.json({ success: ok });
});

app.delete('/api/events/:id/react', requireAuth, (req, res) => {
  const db = getDb();
  social.removeReaction(db, req.user.userId, parseInt(req.params.id));
  res.json({ success: true });
});

// Comments
app.get('/api/users/:username/comments', (req, res) => {
  const db = getDb();
  const user = getUserByUsername(db, req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(social.getComments(db, user.id, parseInt(req.query.page) || 1));
});

app.post('/api/users/:username/comments', requireAuth, (req, res) => {
  const db = getDb();
  const user = getUserByUsername(db, req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const id = social.addComment(db, req.user.userId, user.id, req.body.text);
  if (!id) return res.status(400).json({ error: 'Invalid comment' });
  res.json({ success: true, id });
});

// Notifications
app.get('/api/notifications', requireAuth, (req, res) => {
  const db = getDb();
  res.json(social.getNotifications(db, req.user.userId, parseInt(req.query.page) || 1));
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  const db = getDb();
  social.markNotificationsRead(db, req.user.userId);
  res.json({ success: true });
});

// Badges
app.get('/api/users/:username/badges', (req, res) => {
  const db = getDb();
  const user = getUserByUsername(db, req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const badges = db.prepare('SELECT badge_id, earned_at FROM user_badges WHERE user_id = ?').all(user.id);
  res.json(badges.map(b => ({ ...b, ...BADGES[b.badge_id] })));
});

// Score history
app.get('/api/users/:username/history', (req, res) => {
  const db = getDb();
  const user = getUserByUsername(db, req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const history = db.prepare('SELECT score, tier, spend_usd, tokens_total, recorded_at FROM score_history WHERE user_id = ? ORDER BY recorded_at').all(user.id);
  res.json(history);
});

// ============================
// PRICING
// ============================

app.get('/api/pricing', (_req, res) => {
  res.json({
    currentPriceCents: getCurrentPriceCents(),
    currentPrice: formatPrice(getCurrentPriceCents()),
    urgencyMessage: getUrgencyMessage(),
  });
});

// Health
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch-all: serve index.html for client-side routing
app.get('/u/:username', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'website', 'profile.html'));
});

// ============================
// START
// ============================

async function start() {
  await seedIfEmpty();

  app.listen(PORT, () => {
    console.log(`\n  NarrowScore API running at http://localhost:${PORT}`);
    console.log(`  Leaderboard: http://localhost:${PORT}/api/leaderboard`);
    console.log(`  Stats:       http://localhost:${PORT}/api/stats`);
    console.log(`  Pricing:     ${getUrgencyMessage()}\n`);
  });
}

start();
