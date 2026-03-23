/**
 * Score Calculator — purely constraint-driven.
 *
 * Score = 100 - sum of active constraint penalties.
 * No constraints = 100. Full throughput.
 * Every constraint drags the score down by its penalty.
 *
 * 8 constraints, 100 total possible penalty points:
 * - Context (52): no_claude_md(25), thin_claude_md(15), no_memory(12)
 * - Efficiency (15): repeated_context(15)
 * - Workflow (15): no_subagents(10), short_sessions(5)
 * - Automation (10): no_hooks_skills(10)
 * - Integration (8): no_mcp(8)
 */

import { detectConstraints, CONSTRAINTS } from './constraints.js';

export function calculateScore(data) {
  const activeConstraints = detectConstraints(data);

  // Score = 100 minus the sum of all active constraint penalties
  const totalPenalty = activeConstraints.reduce((sum, c) => sum + c.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

  // Total possible waste if all constraints fixed
  let totalWasteTokens = 0;
  let totalWasteUSD = 0;
  for (const c of activeConstraints) {
    totalWasteTokens += c.tokensWasted || 0;
    totalWasteUSD += c.monthlyCostUSD || 0;
  }

  // Tier — directly maps to how constraint-free you are
  let tier, label;
  if (score >= 90) { tier = 'S'; label = 'Full Throughput'; }
  else if (score >= 75) { tier = 'A'; label = 'Near Optimal'; }
  else if (score >= 60) { tier = 'B'; label = 'Solid Setup'; }
  else if (score >= 40) { tier = 'C'; label = 'Constraints Active'; }
  else if (score >= 20) { tier = 'D'; label = 'Major Bottlenecks'; }
  else { tier = 'F'; label = 'Severely Constrained'; }

  // Category breakdown
  const categories = {};
  for (const def of CONSTRAINTS) {
    if (!categories[def.category]) {
      categories[def.category] = { maxPoints: 0, penalty: 0, constraints: [] };
    }
    categories[def.category].maxPoints += def.weight;
  }

  for (const c of activeConstraints) {
    if (categories[c.category]) {
      categories[c.category].penalty += c.penalty;
      categories[c.category].constraints.push(c.id);
    }
  }

  for (const [, cat] of Object.entries(categories)) {
    cat.score = Math.round(((cat.maxPoints - cat.penalty) / cat.maxPoints) * 100);
  }

  return {
    score,
    tier,
    label,
    categories,
    constraintsFound: activeConstraints.length,
    totalConstraints: CONSTRAINTS.length,
    constraintsCleared: CONSTRAINTS.length - activeConstraints.length,
    totalPenalty,
    totalWasteTokens,
    totalWasteUSD: Math.round(totalWasteUSD * 100) / 100,
    topConstraint: activeConstraints[0] || null,
    allConstraints: activeConstraints,
  };
}
