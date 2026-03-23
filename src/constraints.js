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
 * Each constraint returns monetary estimates:
 * - tokensWasted: estimated tokens wasted per month
 * - monthlyCostUSD: dollar value of that waste
 * - scoreGain: points gained by fixing this constraint
 */

// Blended token cost: mix of Sonnet ($3/$15 in/out) and Opus ($15/$75 in/out)
// Average Claude Code user: ~70% Sonnet, ~30% Opus
// Blended rate: ~$12 per 1M tokens (weighted input+output)
const COST_PER_1K_TOKENS = 0.012;

/**
 * Estimate monthly token waste and cost from a constraint.
 */
function estimateCost(tokensWasted) {
  const monthlyCostUSD = (tokensWasted / 1000) * COST_PER_1K_TOKENS;
  return {
    tokensWasted,
    monthlyCostUSD: Math.round(monthlyCostUSD * 100) / 100,
  };
}

const CONSTRAINTS = [
  {
    id: 'no_claude_md',
    name: 'No CLAUDE.md',
    priority: 1,
    category: 'context',
    weight: 25,
    detect({ claudeMd, stats }) {
      const hasGlobal = !!claudeMd.globalClaudeMd;
      const activeProjects = Object.entries(stats.sessionsPerProject)
        .filter(([, count]) => count >= 3)
        .map(([path]) => path);

      const projectsWithMd = new Set(
        claudeMd.projectClaudeMds.map(p => p.project)
      );

      const missing = activeProjects.filter(p => !projectsWithMd.has(p));

      // Estimate: without CLAUDE.md, ~3,000 tokens wasted per session re-explaining context
      // Monthly sessions estimate from recent data
      const weeklySessions = stats.recentSessions.length || 10;
      const monthlySessions = weeklySessions * 4;

      if (!hasGlobal && missing.length > 0) {
        const wastedPerSession = 4000;
        const totalWaste = monthlySessions * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 95,
          details: `No global CLAUDE.md and ${missing.length} active project(s) without context files.`,
          waste: `You're re-explaining your stack every session.`,
          impact: `~${wastedPerSession.toLocaleString()} tokens wasted per session, ${monthlySessions} sessions/month.`,
          scoreGain: 24,
          ...cost,
        };
      }

      if (!hasGlobal) {
        const wastedPerSession = 3000;
        const totalWaste = monthlySessions * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 80,
          details: 'No global ~/.claude/CLAUDE.md found.',
          waste: 'Claude starts every session with zero knowledge about you.',
          impact: `~${wastedPerSession.toLocaleString()} tokens/session x ${monthlySessions} sessions/month.`,
          scoreGain: 20,
          ...cost,
        };
      }

      if (missing.length > 0) {
        const wastedPerSession = 1500 * missing.length;
        const totalWaste = monthlySessions * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 60,
          details: `${missing.length} active project(s) have no CLAUDE.md: ${missing.join(', ')}`,
          waste: 'Project-specific context not persisted between sessions.',
          impact: `~${wastedPerSession.toLocaleString()} tokens/session across missing projects.`,
          scoreGain: 15,
          ...cost,
        };
      }

      return { found: false };
    },
    fix: 'Run `narrowscore fix` to auto-generate CLAUDE.md from your session history.',
    fixCommand: 'generate-claude-md',
  },

  {
    id: 'thin_claude_md',
    name: 'Thin CLAUDE.md',
    priority: 2,
    category: 'context',
    weight: 15,
    detect({ claudeMd, stats }) {
      const global = claudeMd.globalClaudeMd;
      if (!global) return { found: false };

      const weeklySessions = stats.recentSessions.length || 10;
      const monthlySessions = weeklySessions * 4;

      if (global.lines < 5) {
        const wastedPerSession = 2000;
        const totalWaste = monthlySessions * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 70,
          details: `Global CLAUDE.md exists but is only ${global.lines} lines.`,
          waste: 'A thin context file is almost as bad as no context file.',
          impact: `~${wastedPerSession.toLocaleString()} tokens/session from missing context.`,
          scoreGain: 10,
          ...cost,
        };
      }

      if (global.lines < 15) {
        const wastedPerSession = 800;
        const totalWaste = monthlySessions * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 40,
          details: `Global CLAUDE.md is ${global.lines} lines. Could encode more of your workflow.`,
          waste: 'Opportunities to reduce repeated explanations.',
          impact: `~${wastedPerSession.toLocaleString()} tokens/session from gaps in context.`,
          scoreGain: 6,
          ...cost,
        };
      }

      return { found: false };
    },
    fix: 'Run `narrowscore evolve` to analyze your sessions and suggest additions to CLAUDE.md.',
    fixCommand: 'evolve-claude-md',
  },

  {
    id: 'no_memory',
    name: 'No memory system',
    priority: 3,
    category: 'context',
    weight: 12,
    detect({ claudeMd, stats }) {
      const hasMemory = claudeMd.memoryDir &&
        claudeMd.memoryDir.files &&
        claudeMd.memoryDir.files.length > 0;

      const weeklySessions = stats.recentSessions.length || 10;
      const monthlySessions = weeklySessions * 4;

      if (!hasMemory) {
        const wastedPerSession = 1500;
        const totalWaste = monthlySessions * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 55,
          details: 'No memory files found. Claude forgets everything between sessions.',
          waste: 'Decisions, preferences, and context lost after every conversation.',
          impact: `~${wastedPerSession.toLocaleString()} tokens/session re-teaching Claude.`,
          scoreGain: 7,
          ...cost,
        };
      }

      if (claudeMd.memoryDir.files.length < 3) {
        const wastedPerSession = 500;
        const totalWaste = monthlySessions * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 30,
          details: `Only ${claudeMd.memoryDir.files.length} memory file(s). Memory system is underutilized.`,
          waste: 'Claude is only remembering a fraction of what it could.',
          impact: `~${wastedPerSession.toLocaleString()} tokens/session from gaps in memory.`,
          scoreGain: 4,
          ...cost,
        };
      }

      return { found: false };
    },
    fix: 'Ask Claude to "remember" key facts about your projects, preferences, and workflows.',
    fixCommand: 'suggest-memories',
  },

  {
    id: 'repeated_context',
    name: 'Repeated context in messages',
    priority: 4,
    category: 'efficiency',
    weight: 15,
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
        // Each repeated phrase ~ 25 tokens, plus Claude re-processing context around it
        const tokensPerRepeat = 200;
        const totalWaste = totalRepeats * tokensPerRepeat;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: Math.min(70, 30 + totalRepeats * 5),
          details: `Found ${repeatedPhrases.length} phrase(s) repeated ${totalRepeats}+ times across sessions.`,
          waste: `You're typing the same context repeatedly. This should be in CLAUDE.md or memory.`,
          impact: `~${totalWaste.toLocaleString()} tokens wasted on repeated context.`,
          scoreGain: 11,
          ...cost,
          repeatedPhrases: repeatedPhrases.map(([phrase, count]) => ({ phrase, count })),
        };
      }

      return { found: false };
    },
    fix: 'Run `narrowscore fix` to extract repeated context into your CLAUDE.md.',
    fixCommand: 'evolve-claude-md',
  },

  {
    id: 'no_subagents',
    name: 'No subagent usage',
    priority: 5,
    category: 'workflow',
    weight: 10,
    detect({ stats }) {
      if (stats.totalSessions < 5) return { found: false };

      const agentUsage = stats.toolUsage['Agent'] || 0;
      const agentRatio = agentUsage / Math.max(1, stats.totalSessions);

      if (agentRatio < 0.1) {
        // Serial execution wastes time, not tokens directly — but time = money
        // Estimate: 20% of sessions could benefit from parallelism, saving ~5 min each
        const sessionsPerMonth = (stats.recentSessions.length || 10) * 4;
        const parallelizableSessions = Math.round(sessionsPerMonth * 0.2);
        const minutesSaved = parallelizableSessions * 5;
        // Time value: developer time at ~$50/hr = $0.83/min
        const timeSavingsUSD = Math.round(minutesSaved * 0.83 * 100) / 100;
        return {
          found: true,
          severity: 45,
          details: `Agent/subagent tool used only ${agentUsage} times across ${stats.totalSessions} sessions.`,
          waste: 'Tasks running serially that could be parallelized.',
          impact: `~${minutesSaved} minutes/month of dev time recoverable with subagents.`,
          scoreGain: 5,
          tokensWasted: 0,
          monthlyCostUSD: timeSavingsUSD,
          isTimeSaving: true,
        };
      }

      return { found: false };
    },
    fix: 'Ask Claude to "use subagents" or "research this in parallel" for complex tasks.',
    fixCommand: null,
  },

  {
    id: 'no_hooks_skills',
    name: 'No hooks or custom skills',
    priority: 6,
    category: 'automation',
    weight: 10,
    detect({ features, stats }) {
      const hasHooks = features.hooks;
      const hasSkills = features.skills.length > 0;
      const hasCommands = features.commands.length > 0;

      const sessionsPerMonth = (stats.recentSessions.length || 10) * 4;

      if (!hasHooks && !hasSkills && !hasCommands) {
        // Estimate: 500 tokens/session typing repetitive workflow instructions
        const wastedPerSession = 500;
        const totalWaste = sessionsPerMonth * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 40,
          details: 'No hooks, custom skills, or slash commands configured.',
          waste: 'Repetitive workflows typed manually every time.',
          impact: `~${wastedPerSession} tokens/session on workflow instructions.`,
          scoreGain: 4,
          ...cost,
        };
      }

      if (!hasHooks) {
        const wastedPerSession = 200;
        const totalWaste = sessionsPerMonth * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 25,
          details: 'No hooks configured. Missing event-driven automation.',
          waste: 'Post-commit formatting, auto-testing could be automated.',
          impact: `~${wastedPerSession} tokens/session on manual triggers.`,
          scoreGain: 2,
          ...cost,
        };
      }

      return { found: false };
    },
    fix: 'Configure hooks in settings.json for common workflows (auto-format, auto-test, etc.).',
    fixCommand: null,
  },

  {
    id: 'no_mcp',
    name: 'No MCP servers',
    priority: 7,
    category: 'integration',
    weight: 8,
    detect({ features, stats }) {
      if (features.mcpServers.length === 0) {
        const sessionsPerMonth = (stats.recentSessions.length || 10) * 4;
        // Estimate: 300 tokens/session copy-pasting from external tools
        const wastedPerSession = 300;
        const totalWaste = sessionsPerMonth * wastedPerSession;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 30,
          details: 'No MCP servers configured. Claude can\'t reach external tools.',
          waste: 'Manual copy-pasting from databases, APIs, or external services.',
          impact: `~${wastedPerSession} tokens/session on manual data transfer.`,
          scoreGain: 2,
          ...cost,
        };
      }

      return { found: false };
    },
    fix: 'Add MCP servers in ~/.claude/mcp_config.json for tools you use daily.',
    fixCommand: null,
  },

  {
    id: 'short_sessions',
    name: 'Abandoned sessions',
    priority: 8,
    category: 'workflow',
    weight: 5,
    detect({ stats, sessions }) {
      if (sessions.length < 5) return { found: false };

      const abandoned = sessions.filter(s =>
        s.turnCount <= 1 && s.userMessages.length <= 1
      );

      const abandonRate = abandoned.length / sessions.length;

      if (abandonRate > 0.25) {
        // Each abandoned session wastes ~2,000 tokens on system prompt + initial context load
        const abandonedPerMonth = Math.round(abandoned.length * (4 / Math.max(1, Math.ceil(sessions.length / (stats.recentSessions.length || 10)))));
        const wastedPerAbandon = 2000;
        const totalWaste = abandonedPerMonth * wastedPerAbandon;
        const cost = estimateCost(totalWaste);
        return {
          found: true,
          severity: 35,
          details: `${Math.round(abandonRate * 100)}% of sessions abandoned after 1 turn (${abandoned.length}/${sessions.length}).`,
          waste: 'Each abandoned session wastes ~2,000 tokens on initialization.',
          impact: `~${abandonedPerMonth} abandoned sessions/month = ${totalWaste.toLocaleString()} wasted tokens.`,
          scoreGain: 2,
          ...cost,
        };
      }

      return { found: false };
    },
    fix: 'Write clearer initial prompts. A good CLAUDE.md reduces the need to restart.',
    fixCommand: null,
  },
];

/**
 * Run all constraints and return sorted by severity.
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
        priority: constraint.priority,
        category: constraint.category,
        weight: constraint.weight,
        fix: constraint.fix,
        fixCommand: constraint.fixCommand,
        ...result,
      });
    }
  }

  results.sort((a, b) => b.severity - a.severity);

  return results;
}

/**
 * Get total savings across all constraints.
 */
export function getTotalSavings(data) {
  const constraints = detectConstraints(data);
  let totalTokens = 0;
  let totalCostUSD = 0;
  let totalScoreGain = 0;

  for (const c of constraints) {
    totalTokens += c.tokensWasted || 0;
    totalCostUSD += c.monthlyCostUSD || 0;
    totalScoreGain += c.scoreGain || 0;
  }

  return {
    totalTokens,
    totalCostUSD: Math.round(totalCostUSD * 100) / 100,
    totalScoreGain: Math.min(100, totalScoreGain),
    constraints,
  };
}

export function getTopConstraint(data) {
  const constraints = detectConstraints(data);
  return constraints[0] || null;
}

export { CONSTRAINTS };
