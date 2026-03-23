/**
 * Score Calculator — weighted score 0-100 across all constraint categories.
 * Higher = fewer bottlenecks = better Claude Code usage.
 *
 * Categories and max weights:
 * - context (CLAUDE.md + memory): 52 points
 * - efficiency (repeated context): 15 points
 * - workflow (subagents, sessions): 15 points
 * - automation (hooks, skills): 10 points
 * - integration (MCP): 8 points
 * Total: 100
 */

import { CONSTRAINTS, detectConstraints } from './constraints.js';

/**
 * Calculate the Narrow Score.
 * Starts at 100, subtracts based on detected constraints weighted by severity.
 */
export function calculateScore(data) {
  const constraints = detectConstraints(data);

  // Build a map of constraint results by id
  const constraintMap = new Map(constraints.map(c => [c.id, c]));

  let totalPossible = 0;
  let totalLost = 0;
  const breakdown = {};

  for (const def of CONSTRAINTS) {
    totalPossible += def.weight;

    const detected = constraintMap.get(def.id);
    if (detected) {
      // Points lost = weight * (severity / 100)
      const lost = Math.round(def.weight * (detected.severity / 100));
      totalLost += lost;

      if (!breakdown[def.category]) breakdown[def.category] = { possible: 0, lost: 0 };
      breakdown[def.category].possible += def.weight;
      breakdown[def.category].lost += lost;
    } else {
      // No constraint found — full points earned
      if (!breakdown[def.category]) breakdown[def.category] = { possible: 0, lost: 0 };
      breakdown[def.category].possible += def.weight;
    }
  }

  const score = Math.max(0, Math.min(100, totalPossible - totalLost));

  // Calculate category scores
  const categories = {};
  for (const [cat, data] of Object.entries(breakdown)) {
    categories[cat] = {
      score: Math.round(((data.possible - data.lost) / data.possible) * 100),
      pointsEarned: data.possible - data.lost,
      pointsPossible: data.possible,
    };
  }

  // Determine tier
  let tier, label;
  if (score >= 90) { tier = 'S'; label = 'Claude Whisperer'; }
  else if (score >= 75) { tier = 'A'; label = 'Power User'; }
  else if (score >= 60) { tier = 'B'; label = 'Solid Operator'; }
  else if (score >= 40) { tier = 'C'; label = 'Getting There'; }
  else if (score >= 20) { tier = 'D'; label = 'Room to Grow'; }
  else { tier = 'F'; label = 'Fresh Start'; }

  return {
    score,
    tier,
    label,
    categories,
    constraintsFound: constraints.length,
    totalConstraints: CONSTRAINTS.length,
    topConstraint: constraints[0] || null,
    allConstraints: constraints,
  };
}

/**
 * Generate a shareable score card (text-based).
 */
export function generateScoreCard(scoreData, username = 'anon') {
  const { score, tier, label, constraintsFound, totalConstraints } = scoreData;
  const bar = generateBar(score);
  const cleared = totalConstraints - constraintsFound;

  return [
    '',
    `  @${username}'s Claude Code Score`,
    '',
    `  ${bar}  ${score}/100  [${tier}]`,
    `  ${label}`,
    '',
    `  Bottlenecks cleared: ${cleared}/${totalConstraints}`,
    '',
    `  Find your narrow: npx narrowscore`,
    '',
  ].join('\n');
}

/**
 * Generate a visual progress bar.
 */
function generateBar(score, width = 20) {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}
