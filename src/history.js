/**
 * Local score history — tracks every scan for before/after comparison.
 * Stored at ~/.claude/narrowscore-history.json
 *
 * This is the proof the product works:
 * "Your score went from 42 → 61. You cleared 3 constraints. Saving $23/month."
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const HISTORY_PATH = join(homedir(), '.claude', 'narrowscore-history.json');

/**
 * Load scan history.
 */
export async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_PATH, 'utf-8'));
  } catch {
    return { scans: [] };
  }
}

/**
 * Save a scan result to history.
 */
export async function recordScan(scoreData, spend) {
  const history = await loadHistory();

  const entry = {
    timestamp: new Date().toISOString(),
    score: scoreData.score,
    tier: scoreData.tier,
    label: scoreData.label,
    constraintsFound: scoreData.constraintsFound,
    constraintsCleared: scoreData.constraintsCleared,
    totalPenalty: scoreData.totalPenalty,
    totalWasteUSD: scoreData.totalWasteUSD,
    activeConstraints: scoreData.allConstraints.map(c => c.id),
    spendUSD: spend?.totalSpendUSD || 0,
    tokensTotal: spend?.totalTokens || 0,
  };

  history.scans.push(entry);

  // Keep last 100 scans
  if (history.scans.length > 100) {
    history.scans = history.scans.slice(-100);
  }

  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
  return entry;
}

/**
 * Get the last recorded scan (for comparison before recording a new one).
 */
export async function getLastScan() {
  const history = await loadHistory();
  if (history.scans.length === 0) return null;
  return history.scans[history.scans.length - 1];
}

/**
 * Get the first scan ever (baseline).
 */
export async function getFirstScan() {
  const history = await loadHistory();
  if (history.scans.length === 0) return null;
  return history.scans[0];
}

/**
 * Compare current scan to previous — the before/after proof.
 */
export function compareScan(current, previous) {
  if (!previous) return null;

  const scoreDelta = current.score - previous.score;
  const constraintsDelta = current.constraintsFound - previous.constraintsFound;
  const wasteDelta = current.totalWasteUSD - previous.totalWasteUSD;

  // Which constraints were cleared since last scan?
  const prevSet = new Set(previous.activeConstraints || []);
  const currSet = new Set(current.activeConstraints || []);
  const cleared = [...prevSet].filter(id => !currSet.has(id));
  const newConstraints = [...currSet].filter(id => !prevSet.has(id));

  return {
    scoreDelta,
    constraintsDelta,
    wasteDelta: Math.round(wasteDelta * 100) / 100,
    cleared,
    newConstraints,
    improved: scoreDelta > 0,
    monthlySavings: wasteDelta < 0 ? Math.abs(Math.round(wasteDelta * 100) / 100) : 0,
  };
}

/**
 * Get cumulative stats from all history.
 */
export async function getCumulativeStats() {
  const history = await loadHistory();
  if (history.scans.length === 0) return null;

  const first = history.scans[0];
  const latest = history.scans[history.scans.length - 1];

  const totalScoreGain = latest.score - first.score;
  const totalConstraintsCleared = first.constraintsFound - latest.constraintsFound;
  const totalWasteSaved = first.totalWasteUSD - latest.totalWasteUSD;

  // Calculate monthly savings projection
  const daysSinceFirst = Math.max(1, (new Date(latest.timestamp) - new Date(first.timestamp)) / 86400000);
  const monthlySavingsProjected = totalWasteSaved > 0
    ? Math.round((totalWasteSaved / daysSinceFirst) * 30 * 100) / 100
    : 0;

  return {
    totalScans: history.scans.length,
    firstScan: first,
    latestScan: latest,
    totalScoreGain,
    totalConstraintsCleared: Math.max(0, totalConstraintsCleared),
    totalWasteSaved: Math.round(Math.max(0, totalWasteSaved) * 100) / 100,
    monthlySavingsProjected,
    daysSinceFirst: Math.round(daysSinceFirst),
    history: history.scans,
  };
}
