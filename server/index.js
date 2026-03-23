#!/usr/bin/env node
/**
 * NarrowScore Leaderboard API Server.
 * Express + SQLite. Seeds from seed-profiles.json on first run.
 */

import express from 'express';
import cors from 'cors';
import { seedIfEmpty, getLeaderboard, getProfile, submitScore, getGlobalStats } from './db.js';

const app = express();
const PORT = process.env.PORT || 3457;

app.use(cors());
app.use(express.json());

// Serve website static files
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, '..', 'website')));

// --- API Routes ---

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
  const sort = req.query.sort || 'score';
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(100, parseInt(req.query.limit) || 50);

  const data = getLeaderboard({ sort, page, limit });
  res.json(data);
});

// Profile
app.get('/api/profile/:username', (req, res) => {
  const profile = getProfile(req.params.username);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  res.json(profile);
});

// Submit score from CLI
app.post('/api/submit', (req, res) => {
  const { username, score, tier, label, spendTier, spendUSD, tokensTotal,
    daysActive, projects, sessions, narrowsCleared, narrowsTotal, topTools } = req.body;

  if (!username || score === undefined) {
    return res.status(400).json({ error: 'username and score are required' });
  }

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
  });

  res.json({
    success: true,
    rank: result.rank,
    total: result.total,
    message: `You're #${result.rank} out of ${result.total} users!`,
  });
});

// Global stats
app.get('/api/stats', (_req, res) => {
  const stats = getGlobalStats();
  res.json(stats);
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Start ---

async function start() {
  await seedIfEmpty();

  app.listen(PORT, () => {
    console.log(`\n  NarrowScore API running at http://localhost:${PORT}`);
    console.log(`  Leaderboard: http://localhost:${PORT}/api/leaderboard`);
    console.log(`  Stats:       http://localhost:${PORT}/api/stats\n`);
  });
}

start();
