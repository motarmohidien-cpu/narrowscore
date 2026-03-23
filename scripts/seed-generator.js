#!/usr/bin/env node
/**
 * Seed Generator — creates thousands of realistic simulated profiles
 * for the NarrowScore leaderboard. Bell-curve scores, power-law spend,
 * GitHub-style usernames. Run once, commit the output.
 *
 * Usage: node scripts/seed-generator.js [count]
 * Output: data/seed-profiles.json
 */

import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, '..', 'data', 'seed-profiles.json');

const COUNT = parseInt(process.argv[2]) || 3000;

// --- Random utilities ---

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

// Box-Muller transform for normal distribution
function gaussian(mean, stddev) {
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  return mean + stddev * u * mul;
}

// Clamp a value
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// Power-law distribution (for spend — most low, few high)
function powerLaw(min, max, alpha = 2.5) {
  const u = Math.random();
  return min + (max - min) * Math.pow(u, alpha);
}

// Weighted random pick from array
function weightedPick(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

// --- Username generation ---

const ADJECTIVES = [
  'swift', 'cosmic', 'quantum', 'neural', 'cyber', 'pixel', 'hyper', 'mega',
  'turbo', 'ultra', 'nano', 'micro', 'macro', 'deep', 'dark', 'bright',
  'fast', 'sharp', 'clever', 'smart', 'wild', 'calm', 'zen', 'iron',
  'steel', 'silver', 'golden', 'crystal', 'shadow', 'flame', 'frost', 'storm',
  'thunder', 'laser', 'neon', 'vapor', 'crypto', 'fuzzy', 'lazy', 'eager',
  'bold', 'brave', 'chill', 'cool', 'epic', 'frosty', 'grim', 'happy',
  'indie', 'jolly', 'keen', 'lone', 'mighty', 'noble', 'odd', 'prime',
  'rad', 'rogue', 'sage', 'tiny', 'vast', 'wired', 'xenon', 'zippy',
];

const NOUNS = [
  'coder', 'dev', 'hacker', 'builder', 'maker', 'ninja', 'wizard', 'pirate',
  'robot', 'phoenix', 'falcon', 'hawk', 'wolf', 'fox', 'bear', 'tiger',
  'dragon', 'serpent', 'raven', 'octopus', 'mantis', 'scorpion', 'panther',
  'cobra', 'viper', 'shark', 'whale', 'dolphin', 'eagle', 'lion', 'lynx',
  'byte', 'bit', 'node', 'stack', 'pixel', 'vector', 'tensor', 'kernel',
  'daemon', 'agent', 'cipher', 'proxy', 'socket', 'buffer', 'cache', 'forge',
  'nexus', 'vault', 'pulse', 'flux', 'spark', 'arc', 'beam', 'core',
  'grid', 'mesh', 'link', 'loop', 'gate', 'hub', 'lab', 'ops',
];

const FIRST_NAMES = [
  'alex', 'jordan', 'sam', 'riley', 'morgan', 'casey', 'jamie', 'drew',
  'avery', 'blake', 'cameron', 'dakota', 'eli', 'finley', 'hayden', 'kai',
  'luca', 'max', 'nico', 'parker', 'quinn', 'reese', 'sage', 'taylor',
  'marco', 'anna', 'chen', 'priya', 'yuki', 'omar', 'lars', 'sofia',
  'aiden', 'zara', 'leo', 'mia', 'noah', 'emma', 'liam', 'ava',
  'ethan', 'isla', 'jake', 'luna', 'ryan', 'nora', 'ben', 'lily',
];

const LAST_NAMES = [
  'chen', 'smith', 'patel', 'kim', 'garcia', 'wang', 'silva', 'johnson',
  'lee', 'brown', 'kumar', 'park', 'wilson', 'yang', 'taylor', 'zhang',
  'moore', 'anderson', 'thomas', 'jackson', 'white', 'harris', 'martin',
  'thompson', 'clark', 'lewis', 'walker', 'hall', 'allen', 'young',
  'king', 'wright', 'scott', 'green', 'baker', 'adams', 'hill', 'cox',
];

function generateUsername(usedNames) {
  const styles = [
    // adjective-noun: swift-coder
    () => `${pick(ADJECTIVES)}-${pick(NOUNS)}`,
    // adjective_noun42: cyber_hawk42
    () => `${pick(ADJECTIVES)}_${pick(NOUNS)}${randInt(1, 99)}`,
    // firstname.lastname: alex.chen
    () => `${pick(FIRST_NAMES)}.${pick(LAST_NAMES)}`,
    // firstnameNN: jordan42
    () => `${pick(FIRST_NAMES)}${randInt(1, 999)}`,
    // noun-noun: pixel-forge
    () => `${pick(NOUNS)}-${pick(NOUNS)}`,
    // firstname_noun: sam_dev
    () => `${pick(FIRST_NAMES)}_${pick(NOUNS)}`,
    // adjective.noun: quantum.flux
    () => `${pick(ADJECTIVES)}.${pick(NOUNS)}`,
    // xXnounXx style: xXdragonXx
    () => `${pick(NOUNS)}${pick(ADJECTIVES)}`,
    // the-noun: the-wizard
    () => `the-${pick(NOUNS)}`,
    // firstlast: alexchen
    () => `${pick(FIRST_NAMES)}${pick(LAST_NAMES)}`,
  ];

  let name;
  let attempts = 0;
  do {
    const styleFn = pick(styles);
    name = styleFn();
    attempts++;
  } while (usedNames.has(name) && attempts < 100);

  usedNames.add(name);
  return name;
}

// --- Claude Code tool names (realistic) ---

const TOOLS = [
  'Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Agent',
  'WebSearch', 'WebFetch', 'NotebookEdit', 'AskUserQuestion',
  'TaskCreate', 'TaskUpdate', 'Skill',
];

const TOOL_WEIGHTS = [
  30, 25, 15, 20, 12, 10, 5,
  3, 3, 2, 4,
  3, 3, 2,
];

// --- Tier from score ---

function getTier(score) {
  if (score >= 90) return { tier: 'S', label: 'Near-Perfect Throughput' };
  if (score >= 75) return { tier: 'A', label: 'Power User' };
  if (score >= 60) return { tier: 'B', label: 'Solid Operator' };
  if (score >= 40) return { tier: 'C', label: 'Getting There' };
  if (score >= 20) return { tier: 'D', label: 'Room to Grow' };
  return { tier: 'F', label: 'Fresh Start' };
}

function getSpendTier(usd) {
  if (usd >= 500) return 'WHALE';
  if (usd >= 200) return 'POWER SPENDER';
  if (usd >= 50) return 'COMMITTED';
  if (usd >= 10) return 'GETTING STARTED';
  return 'NEWCOMER';
}

// --- Avatar colors ---

const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8C471', '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
  '#A3E4D7', '#FAD7A0', '#A9CCE3', '#D5F5E3', '#FADBD8',
];

// --- Generate profiles ---

function generateProfile(usedNames) {
  const username = generateUsername(usedNames);

  // Score: bell curve centered at 52, stddev 22
  const score = clamp(Math.round(gaussian(52, 22)), 2, 99);
  const { tier, label } = getTier(score);

  // Spend: power law — most users $5-50, some $50-200, few $200+
  // Higher scores correlate somewhat with higher spend
  const spendBase = powerLaw(2, 300, 1.8);
  const scoreBonus = score > 70 ? rand(1.5, 4) : score > 50 ? rand(1, 2) : 1;
  const totalSpendUSD = Math.round(spendBase * scoreBonus * 100) / 100;
  const spendTier = getSpendTier(totalSpendUSD);

  // Tokens correlated with spend (~$12/1M tokens)
  const totalTokens = Math.round(totalSpendUSD / 0.012 * 1000 * rand(0.7, 1.3));

  // Days active: 1-90, newer users more common
  const daysActive = clamp(Math.round(powerLaw(1, 90, 1.2)), 1, 90);

  // Projects: correlated with days active
  const projects = clamp(Math.round(rand(1, Math.max(2, daysActive / 7))), 1, 25);

  // Narrows: out of 8 total
  const narrowsTotal = 8;
  // Higher score = more cleared
  const maxCleared = Math.min(narrowsTotal, Math.round(score / 12));
  const narrowsCleared = clamp(randInt(Math.max(0, maxCleared - 2), maxCleared), 0, narrowsTotal);

  // Top tools: pick 3-5 weighted random
  const toolCount = randInt(3, 5);
  const topTools = [];
  const usedTools = new Set();
  for (let i = 0; i < toolCount; i++) {
    let tool;
    do {
      tool = weightedPick(TOOLS, TOOL_WEIGHTS);
    } while (usedTools.has(tool));
    usedTools.add(tool);
    topTools.push(tool);
  }

  // Join date: within last 90 days, biased toward recent
  const now = Date.now();
  const daysAgo = clamp(Math.round(powerLaw(0, 90, 1.5)), 0, 90);
  const joinDate = new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Sessions: correlated with days active and spend
  const sessions = clamp(Math.round(daysActive * rand(0.5, 3)), 1, 500);

  // Avatar color
  const avatarColor = pick(AVATAR_COLORS);

  return {
    username,
    score,
    tier,
    label,
    spendTier,
    totalSpendUSD,
    totalTokens,
    daysActive,
    projects,
    sessions,
    narrowsCleared,
    narrowsTotal,
    topTools,
    joinDate,
    avatarColor,
    simulated: true,
  };
}

// --- Main ---

console.log(`Generating ${COUNT} simulated profiles...`);

const usedNames = new Set();
const profiles = [];

for (let i = 0; i < COUNT; i++) {
  profiles.push(generateProfile(usedNames));
}

// Sort by score descending for leaderboard
profiles.sort((a, b) => b.score - a.score);

// Add rank
profiles.forEach((p, i) => { p.rank = i + 1; });

// Stats
const scores = profiles.map(p => p.score);
const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
const totalSpend = profiles.reduce((a, p) => a + p.totalSpendUSD, 0);
const tierCounts = {};
profiles.forEach(p => { tierCounts[p.tier] = (tierCounts[p.tier] || 0) + 1; });
const spendTierCounts = {};
profiles.forEach(p => { spendTierCounts[p.spendTier] = (spendTierCounts[p.spendTier] || 0) + 1; });

console.log(`\nGenerated ${profiles.length} profiles`);
console.log(`Average score: ${avgScore}`);
console.log(`Total spend: $${totalSpend.toFixed(2)}`);
console.log(`\nTier distribution:`);
for (const [tier, count] of Object.entries(tierCounts).sort()) {
  console.log(`  ${tier}: ${count} (${(count/profiles.length*100).toFixed(1)}%)`);
}
console.log(`\nSpend tier distribution:`);
for (const [tier, count] of Object.entries(spendTierCounts)) {
  console.log(`  ${tier}: ${count} (${(count/profiles.length*100).toFixed(1)}%)`);
}

const output = {
  generated: new Date().toISOString(),
  count: profiles.length,
  stats: { avgScore, totalSpend: Math.round(totalSpend * 100) / 100, tierCounts, spendTierCounts },
  profiles,
};

await writeFile(OUTPUT, JSON.stringify(output, null, 2), 'utf-8');
console.log(`\nSaved to ${OUTPUT}`);
