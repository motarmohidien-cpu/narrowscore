/**
 * Constraint Engine — Theory of Constraints applied to Claude Code usage.
 *
 * Goldratt's 5 Focusing Steps:
 * 1. IDENTIFY the constraint
 * 2. EXPLOIT it (maximize what you can without investment)
 * 3. SUBORDINATE everything else
 * 4. ELEVATE (invest to break it)
 * 5. REPEAT — find the next constraint
 *
 * Score = 100 - sum of active constraint penalties.
 * No constraints = 100. You're at full throughput.
 *
 * Each constraint returns monetary estimates:
 * - tokensWasted: estimated tokens wasted per month
 * - monthlyCostUSD: dollar value of that waste
 */

// Blended token cost: mix of Sonnet ($3/$15 in/out) and Opus ($15/$75 in/out)
// Average Claude Code user: ~70% Sonnet, ~30% Opus
// Blended rate: ~$12 per 1M tokens (weighted input+output)
const COST_PER_1K_TOKENS = 0.012;

function estimateCost(tokensWasted) {
  const monthlyCostUSD = (tokensWasted / 1000) * COST_PER_1K_TOKENS;
  return {
    tokensWasted,
    monthlyCostUSD: Math.round(monthlyCostUSD * 100) / 100,
  };
}

/**
 * 8 constraints, 100 total points.
 * Each constraint has a fixed max penalty (weight).
 * Severity (0-100) scales how bad it is — but even partial = points lost.
 */
const CONSTRAINTS = [
  // ─── CONTEXT (52 pts) ───────────────────────────────
  {
    id: 'no_claude_md',
    name: 'No CLAUDE.md',
    category: 'context',
    weight: 25,
    step: 'IDENTIFY',
    detect({ claudeMd, stats }) {
      const hasGlobal = !!claudeMd.globalClaudeMd;
      const activeProjects = Object.entries(stats.sessionsPerProject)
        .filter(([, count]) => count >= 3)
        .map(([path]) => path);
      const projectsWithMd = new Set(claudeMd.projectClaudeMds.map(p => p.project));
      const missing = activeProjects.filter(p => !projectsWithMd.has(p));

      const monthlySessions = (stats.recentSessions.length || 10) * 4;

      if (!hasGlobal && missing.length > 0) {
        const waste = monthlySessions * 4000;
        return {
          found: true,
          severity: 95,
          penalty: 24,
          details: `No global CLAUDE.md and ${missing.length} active project(s) without context files.`,
          narrow: 'Claude re-learns your entire stack every session. This is your #1 bottleneck.',
          fix: 'Run `narrowscore fix` to auto-generate CLAUDE.md from your session history.',
          fixCommand: 'generate-claude-md',
          ...estimateCost(waste),
        };
      }

      if (!hasGlobal) {
        const waste = monthlySessions * 3000;
        return {
          found: true,
          severity: 80,
          penalty: 20,
          details: 'No global ~/.claude/CLAUDE.md found.',
          narrow: 'Claude starts every session with zero knowledge about you.',
          fix: 'Run `narrowscore fix` to auto-generate CLAUDE.md.',
          fixCommand: 'generate-claude-md',
          ...estimateCost(waste),
        };
      }

      if (missing.length > 0) {
        const waste = monthlySessions * 1500 * missing.length;
        return {
          found: true,
          severity: 60,
          penalty: 15,
          details: `${missing.length} active project(s) have no CLAUDE.md: ${missing.slice(0, 3).join(', ')}`,
          narrow: 'Project-specific context not persisted between sessions.',
          fix: 'Run `narrowscore fix` to generate project-level CLAUDE.md files.',
          fixCommand: 'generate-claude-md',
          ...estimateCost(waste),
        };
      }

      return { found: false };
    },
  },

  {
    id: 'thin_claude_md',
    name: 'Thin CLAUDE.md',
    category: 'context',
    weight: 15,
    step: 'EXPLOIT',
    detect({ claudeMd, stats }) {
      const global = claudeMd.globalClaudeMd;
      if (!global) return { found: false }; // Caught by no_claude_md

      const monthlySessions = (stats.recentSessions.length || 10) * 4;

      if (global.lines < 5) {
        return {
          found: true,
          severity: 70,
          penalty: 11,
          details: `Global CLAUDE.md exists but only ${global.lines} lines.`,
          narrow: 'A thin context file is almost as bad as none. Claude still guesses your preferences.',
          fix: 'Run `narrowscore fix` to enrich your CLAUDE.md from session patterns.',
          fixCommand: 'evolve-claude-md',
          ...estimateCost(monthlySessions * 2000),
        };
      }

      if (global.lines < 15) {
        return {
          found: true,
          severity: 40,
          penalty: 6,
          details: `Global CLAUDE.md is ${global.lines} lines. Could encode more of your workflow.`,
          narrow: 'Missing stack details, preferences, or project context that Claude keeps asking about.',
          fix: 'Run `narrowscore fix` to suggest additions based on your session history.',
          fixCommand: 'evolve-claude-md',
          ...estimateCost(monthlySessions * 800),
        };
      }

      return { found: false };
    },
  },

  {
    id: 'no_memory',
    name: 'No memory system',
    category: 'context',
    weight: 12,
    step: 'EXPLOIT',
    detect({ claudeMd, stats }) {
      const hasMemory = claudeMd.memoryDir?.files?.length > 0;
      const monthlySessions = (stats.recentSessions.length || 10) * 4;

      if (!hasMemory) {
        return {
          found: true,
          severity: 55,
          penalty: 7,
          details: 'No memory files found. Claude forgets everything between sessions.',
          narrow: 'Decisions, preferences, and context lost after every conversation.',
          fix: 'Tell Claude to "remember" key facts. E.g. "Remember our API uses REST with JWT auth."',
          fixCommand: 'suggest-memories',
          ...estimateCost(monthlySessions * 1500),
        };
      }

      if (claudeMd.memoryDir.files.length < 3) {
        return {
          found: true,
          severity: 30,
          penalty: 4,
          details: `Only ${claudeMd.memoryDir.files.length} memory file(s). Memory system underutilized.`,
          narrow: 'Claude only remembers a fraction of what it could about your projects.',
          fix: 'Tell Claude to remember your top 5-10 project facts, team conventions, and preferences.',
          fixCommand: 'suggest-memories',
          ...estimateCost(monthlySessions * 500),
        };
      }

      return { found: false };
    },
  },

  // ─── EFFICIENCY (15 pts) ────────────────────────────
  {
    id: 'repeated_context',
    name: 'Repeated context in messages',
    category: 'efficiency',
    weight: 15,
    step: 'IDENTIFY',
    detect({ stats, sessions }) {
      const allUserMessages = sessions.flatMap(s =>
        s.userMessages.map(m => m.text.toLowerCase().trim())
      );

      if (allUserMessages.length < 5) return { found: false };

      const phraseCounts = {};
      for (const msg of allUserMessages) {
        const words = msg.split(/\s+/).filter(w => w.length > 2);
        for (let i = 0; i <= words.length - 5; i++) {
          const phrase = words.slice(i, i + 5).join(' ');
          phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
        }
      }

      const repeatedPhrases = Object.entries(phraseCounts)
        .filter(([, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      if (repeatedPhrases.length > 0) {
        const totalRepeats = repeatedPhrases.reduce((sum, [, c]) => sum + c, 0);
        const tokensPerRepeat = 200;
        const totalWaste = totalRepeats * tokensPerRepeat;
        const penalty = Math.min(15, Math.round(3 + totalRepeats * 0.8));
        return {
          found: true,
          severity: Math.min(70, 30 + totalRepeats * 5),
          penalty,
          details: `${repeatedPhrases.length} phrase(s) repeated ${totalRepeats}+ times across sessions.`,
          narrow: 'You type the same context repeatedly. This should be in CLAUDE.md or memory.',
          fix: 'Run `narrowscore fix` to extract repeated context into your CLAUDE.md.',
          fixCommand: 'evolve-claude-md',
          ...estimateCost(totalWaste),
          repeatedPhrases: repeatedPhrases.map(([phrase, count]) => ({ phrase, count })),
        };
      }

      return { found: false };
    },
  },

  // ─── WORKFLOW (15 pts) ──────────────────────────────
  {
    id: 'no_subagents',
    name: 'No subagent usage',
    category: 'workflow',
    weight: 10,
    step: 'ELEVATE',
    detect({ stats }) {
      if (stats.totalSessions < 5) return { found: false };

      const agentUsage = stats.toolUsage['Agent'] || 0;
      const agentRatio = agentUsage / Math.max(1, stats.totalSessions);

      if (agentRatio < 0.1) {
        const sessionsPerMonth = (stats.recentSessions.length || 10) * 4;
        const parallelizableSessions = Math.round(sessionsPerMonth * 0.2);
        const minutesSaved = parallelizableSessions * 5;
        const timeSavingsUSD = Math.round(minutesSaved * 0.83 * 100) / 100;
        return {
          found: true,
          severity: 45,
          penalty: 5,
          details: `Agent/subagent tool used only ${agentUsage} times across ${stats.totalSessions} sessions.`,
          narrow: 'Tasks running serially that could run in parallel. You wait while Claude works one thing at a time.',
          fix: 'Ask Claude to "use subagents" or "research this in parallel" for complex tasks.',
          fixCommand: null,
          tokensWasted: 0,
          monthlyCostUSD: timeSavingsUSD,
          isTimeSaving: true,
        };
      }

      return { found: false };
    },
  },

  {
    id: 'short_sessions',
    name: 'Abandoned sessions',
    category: 'workflow',
    weight: 5,
    step: 'IDENTIFY',
    detect({ stats, sessions }) {
      if (sessions.length < 5) return { found: false };

      const abandoned = sessions.filter(s =>
        s.turnCount <= 1 && s.userMessages.length <= 1
      );
      const abandonRate = abandoned.length / sessions.length;

      if (abandonRate > 0.25) {
        const abandonedPerMonth = Math.round(abandoned.length * 4);
        const totalWaste = abandonedPerMonth * 2000;
        return {
          found: true,
          severity: 35,
          penalty: 2,
          details: `${Math.round(abandonRate * 100)}% of sessions abandoned after 1 turn (${abandoned.length}/${sessions.length}).`,
          narrow: 'Each abandoned session wastes ~2,000 tokens on initialization. Something is causing restarts.',
          fix: 'Write clearer initial prompts. A good CLAUDE.md reduces false starts.',
          fixCommand: null,
          ...estimateCost(totalWaste),
        };
      }

      return { found: false };
    },
  },

  // ─── AUTOMATION (10 pts) ────────────────────────────
  {
    id: 'no_hooks_skills',
    name: 'No hooks or custom skills',
    category: 'automation',
    weight: 10,
    step: 'ELEVATE',
    detect({ features, stats }) {
      const hasHooks = features.hooks;
      const hasSkills = features.skills.length > 0;
      const hasCommands = features.commands.length > 0;
      const monthlySessions = (stats.recentSessions.length || 10) * 4;

      if (!hasHooks && !hasSkills && !hasCommands) {
        const waste = monthlySessions * 500;
        return {
          found: true,
          severity: 40,
          penalty: 4,
          details: 'No hooks, custom skills, or slash commands configured.',
          narrow: 'Repetitive workflows typed manually every session. No automation layer.',
          fix: 'Configure hooks in settings.json for auto-format, auto-test, deploy triggers.',
          fixCommand: null,
          ...estimateCost(waste),
        };
      }

      if (!hasHooks) {
        const waste = monthlySessions * 200;
        return {
          found: true,
          severity: 25,
          penalty: 2,
          details: 'No hooks configured. Missing event-driven automation.',
          narrow: 'Post-commit formatting, auto-testing, CI triggers — all manual.',
          fix: 'Add hooks in settings.json for common workflows.',
          fixCommand: null,
          ...estimateCost(waste),
        };
      }

      return { found: false };
    },
  },

  // ─── INTEGRATION (8 pts) ────────────────────────────
  {
    id: 'no_mcp',
    name: 'No MCP servers',
    category: 'integration',
    weight: 8,
    step: 'ELEVATE',
    detect({ features, stats }) {
      if (features.mcpServers.length === 0) {
        const monthlySessions = (stats.recentSessions.length || 10) * 4;
        const waste = monthlySessions * 300;
        return {
          found: true,
          severity: 30,
          penalty: 2,
          details: 'No MCP servers configured. Claude can\'t reach external tools.',
          narrow: 'Manual copy-pasting from databases, APIs, or external services.',
          fix: 'Add MCP servers in ~/.claude/mcp_config.json for tools you use daily.',
          fixCommand: null,
          ...estimateCost(waste),
        };
      }

      return { found: false };
    },
  },
];

/**
 * Run all constraints and return sorted by penalty (highest first).
 * This IS the narrow — the top result is the #1 bottleneck.
 */
export function detectConstraints(data) {
  const results = [];
  const allSessions = data.projectsData.flatMap(p => p.sessions);

  for (const constraint of CONSTRAINTS) {
    const result = constraint.detect({
      claudeMd: data.claudeMd,
      stats: data.stats,
      features: data.features,
      sessions: allSessions,
    });

    if (result.found) {
      results.push({
        id: constraint.id,
        name: constraint.name,
        category: constraint.category,
        weight: constraint.weight,
        step: constraint.step,
        ...result,
      });
    }
  }

  // Sort by penalty descending — the biggest bottleneck first
  results.sort((a, b) => b.penalty - a.penalty);
  return results;
}

/**
 * Get total savings if ALL constraints were fixed.
 */
export function getTotalSavings(data) {
  const constraints = detectConstraints(data);
  let totalTokens = 0;
  let totalCostUSD = 0;

  for (const c of constraints) {
    totalTokens += c.tokensWasted || 0;
    totalCostUSD += c.monthlyCostUSD || 0;
  }

  return {
    totalTokens,
    totalCostUSD: Math.round(totalCostUSD * 100) / 100,
    constraints,
  };
}

export { CONSTRAINTS };
