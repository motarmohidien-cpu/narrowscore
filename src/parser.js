/**
 * Session parser — reads Claude Code JSONL session files from ~/.claude/projects/
 * Extracts: user messages, assistant responses, tool usage, turn durations,
 * session metadata, project paths, corrections patterns.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

/**
 * Discover all project directories under ~/.claude/projects/
 */
export async function discoverProjects() {
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== '.' && entry.name !== '..') {
      // Convert directory name back to path: -Users-foo-bar → /Users/foo/bar
      const projectPath = entry.name.replace(/^-/, '/').replace(/-/g, '/');
      projects.push({
        dirName: entry.name,
        fullDir: join(PROJECTS_DIR, entry.name),
        projectPath,
      });
    }
  }

  return projects;
}

/**
 * Parse a single JSONL session file into structured data.
 */
export function parseSessionLines(lines) {
  const session = {
    id: null,
    timestamp: null,
    endTimestamp: null,
    cwd: null,
    version: null,
    gitBranch: null,
    slug: null,
    userMessages: [],
    assistantMessages: [],
    toolsUsed: new Set(),
    toolUseCounts: {},
    turnDurations: [],
    totalDurationMs: 0,
    turnCount: 0,
    agentSpawns: 0,
    // Real token tracking
    actualInputTokens: 0,
    actualOutputTokens: 0,
    actualCacheCreationTokens: 0,
    actualCacheReadTokens: 0,
    hasActualTokenData: false,
    models: new Set(),
  };

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Capture session metadata from first entry that has it
    if (!session.id && entry.sessionId) session.id = entry.sessionId;
    if (!session.cwd && entry.cwd) session.cwd = entry.cwd;
    if (!session.version && entry.version) session.version = entry.version;
    if (!session.gitBranch && entry.gitBranch) session.gitBranch = entry.gitBranch;
    if (!session.slug && entry.slug) session.slug = entry.slug;

    // Track timestamps
    if (entry.timestamp) {
      const ts = entry.timestamp;
      if (!session.timestamp || ts < session.timestamp) session.timestamp = ts;
      if (!session.endTimestamp || ts > session.endTimestamp) session.endTimestamp = ts;
    }

    switch (entry.type) {
      case 'user': {
        const msg = extractTextContent(entry.message);
        if (msg) {
          session.userMessages.push({
            text: msg,
            timestamp: entry.timestamp,
            uuid: entry.uuid,
          });
          session.turnCount++;
        }
        break;
      }

      case 'assistant': {
        const msg = entry.message;
        if (msg && msg.content) {
          const textParts = [];
          const tools = [];

          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'text' && block.text) {
                textParts.push(block.text);
              } else if (block.type === 'tool_use') {
                const toolName = block.name;
                tools.push(toolName);
                session.toolsUsed.add(toolName);
                session.toolUseCounts[toolName] = (session.toolUseCounts[toolName] || 0) + 1;
              }
            }
          } else if (typeof msg.content === 'string') {
            textParts.push(msg.content);
          }

          // Extract real token usage
          if (msg.usage) {
            session.hasActualTokenData = true;
            session.actualInputTokens += (msg.usage.input_tokens || 0);
            session.actualOutputTokens += (msg.usage.output_tokens || 0);
            session.actualCacheCreationTokens += (msg.usage.cache_creation_input_tokens || 0);
            session.actualCacheReadTokens += (msg.usage.cache_read_input_tokens || 0);
          }

          // Track model
          if (msg.model) {
            session.models.add(msg.model);
          }

          session.assistantMessages.push({
            text: textParts.join('\n'),
            tools,
            timestamp: entry.timestamp,
            uuid: entry.uuid,
          });
        }
        break;
      }

      case 'system': {
        if (entry.subtype === 'turn_duration' && entry.durationMs) {
          session.turnDurations.push(entry.durationMs);
          session.totalDurationMs += entry.durationMs;
          if (entry.slug && !session.slug) session.slug = entry.slug;
        }
        break;
      }

      case 'progress': {
        const data = entry.data;
        if (data && data.type === 'agent_progress') {
          session.agentSpawns++;
        }
        break;
      }
    }
  }

  // Convert Sets to Arrays for serialization
  session.toolsUsed = [...session.toolsUsed];
  session.models = [...session.models];

  return session;
}

/**
 * Extract text content from a message object.
 */
function extractTextContent(message) {
  if (!message) return null;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text);
    return texts.join('\n') || null;
  }
  return null;
}

/**
 * Load all sessions for a given project directory.
 */
export async function loadProjectSessions(projectDir) {
  const entries = await readdir(projectDir);
  const jsonlFiles = entries.filter(f => f.endsWith('.jsonl'));
  const sessions = [];

  for (const file of jsonlFiles) {
    const filePath = join(projectDir, file);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    if (lines.length === 0) continue;

    const session = parseSessionLines(lines);
    session.sourceFile = file;
    sessions.push(session);
  }

  return sessions;
}

/**
 * Load ALL sessions across all projects.
 */
export async function loadAllSessions() {
  const projects = await discoverProjects();
  const allData = [];

  for (const project of projects) {
    const sessions = await loadProjectSessions(project.fullDir);
    allData.push({
      ...project,
      sessions,
    });
  }

  return allData;
}

/**
 * Check what CLAUDE.md files exist.
 */
export async function checkClaudeMdFiles() {
  const results = {
    globalClaudeMd: null,
    projectClaudeMds: [],
    memoryDir: null,
  };

  // Check global CLAUDE.md
  try {
    const globalPath = join(CLAUDE_DIR, 'CLAUDE.md');
    const content = await readFile(globalPath, 'utf-8');
    results.globalClaudeMd = {
      path: globalPath,
      size: content.length,
      lines: content.split('\n').length,
      content,
    };
  } catch { /* doesn't exist */ }

  // Check per-project CLAUDE.md files
  const projects = await discoverProjects();
  for (const project of projects) {
    // Check in project memory dir
    const memoryDir = join(project.fullDir, 'memory');
    try {
      const memStat = await stat(memoryDir);
      if (memStat.isDirectory()) {
        const memFiles = await readdir(memoryDir);
        results.projectClaudeMds.push({
          project: project.projectPath,
          memoryFiles: memFiles.filter(f => f.endsWith('.md')),
          hasMemoryDir: true,
        });
      }
    } catch { /* no memory dir */ }

    // Also check the actual project directory for CLAUDE.md
    try {
      const projectClaudeMd = join(project.projectPath, 'CLAUDE.md');
      const content = await readFile(projectClaudeMd, 'utf-8');
      results.projectClaudeMds.push({
        project: project.projectPath,
        claudeMdPath: projectClaudeMd,
        size: content.length,
        lines: content.split('\n').length,
      });
    } catch { /* doesn't exist */ }
  }

  // Check memory directory
  try {
    const memDir = join(PROJECTS_DIR, '-Users-smartcitystays', 'memory');
    const memStat = await stat(memDir);
    if (memStat.isDirectory()) {
      const files = await readdir(memDir);
      results.memoryDir = {
        path: memDir,
        files: files.filter(f => f.endsWith('.md')),
      };
    }
  } catch { /* no memory dir */ }

  return results;
}

/**
 * Check what hooks, skills, and commands exist.
 */
export async function checkFeatureUsage() {
  const features = {
    hooks: false,
    skills: [],
    commands: [],
    mcpServers: [],
  };

  // Check settings for hooks
  try {
    const settings = JSON.parse(await readFile(join(CLAUDE_DIR, 'settings.json'), 'utf-8'));
    if (settings.hooks && Object.keys(settings.hooks).length > 0) {
      features.hooks = true;
    }
  } catch { /* no settings */ }

  // Check skills directory
  try {
    const skillsDir = join(CLAUDE_DIR, 'skills');
    const entries = await readdir(skillsDir);
    features.skills = entries;
  } catch { /* no skills */ }

  // Check commands directory
  try {
    const cmdDir = join(CLAUDE_DIR, 'commands');
    const entries = await readdir(cmdDir);
    features.commands = entries;
  } catch { /* no commands */ }

  // Check MCP config
  try {
    const mcpConfig = JSON.parse(await readFile(join(CLAUDE_DIR, 'mcp_config.json'), 'utf-8'));
    if (mcpConfig.mcpServers) {
      features.mcpServers = Object.keys(mcpConfig.mcpServers);
    }
  } catch { /* no mcp config */ }

  return features;
}

/**
 * Aggregate stats across all sessions.
 */
export function aggregateStats(projectsData) {
  const stats = {
    totalSessions: 0,
    totalUserMessages: 0,
    totalAssistantMessages: 0,
    totalDurationMs: 0,
    totalTurns: 0,
    totalAgentSpawns: 0,
    toolUsage: {},
    uniqueTools: new Set(),
    sessionsPerProject: {},
    avgTurnDurationMs: 0,
    avgTurnsPerSession: 0,
    recentSessions: [],  // last 7 days
  };

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  for (const project of projectsData) {
    stats.sessionsPerProject[project.projectPath] = project.sessions.length;

    for (const session of project.sessions) {
      stats.totalSessions++;
      stats.totalUserMessages += session.userMessages.length;
      stats.totalAssistantMessages += session.assistantMessages.length;
      stats.totalDurationMs += session.totalDurationMs;
      stats.totalTurns += session.turnCount;
      stats.totalAgentSpawns += session.agentSpawns;

      for (const tool of session.toolsUsed) {
        stats.uniqueTools.add(tool);
      }
      for (const [tool, count] of Object.entries(session.toolUseCounts)) {
        stats.toolUsage[tool] = (stats.toolUsage[tool] || 0) + count;
      }

      // Check if recent
      if (session.timestamp) {
        const sessionTime = new Date(session.timestamp).getTime();
        if (sessionTime > weekAgo) {
          stats.recentSessions.push({
            id: session.id,
            project: project.projectPath,
            timestamp: session.timestamp,
            turns: session.turnCount,
            durationMs: session.totalDurationMs,
            tools: session.toolsUsed,
          });
        }
      }
    }
  }

  stats.uniqueTools = [...stats.uniqueTools];

  if (stats.totalSessions > 0) {
    stats.avgTurnsPerSession = Math.round(stats.totalTurns / stats.totalSessions);
  }

  const allDurations = projectsData.flatMap(p =>
    p.sessions.flatMap(s => s.turnDurations)
  );
  if (allDurations.length > 0) {
    stats.avgTurnDurationMs = Math.round(
      allDurations.reduce((a, b) => a + b, 0) / allDurations.length
    );
  }

  // Sort recent sessions by date
  stats.recentSessions.sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  );

  // === TOKEN SPEND — REAL DATA OR ESTIMATION ===
  // Check if we have actual token data from session JSONL usage fields
  const allSessions = projectsData.flatMap(p => p.sessions);
  const sessionsWithRealData = allSessions.filter(s => s.hasActualTokenData);
  const hasRealData = sessionsWithRealData.length > allSessions.length * 0.3; // >30% real = use real

  // Model-specific pricing (per 1M tokens)
  const MODEL_PRICING = {
    'claude-sonnet-4-6':  { input: 3, output: 15 },
    'claude-sonnet-4-5':  { input: 3, output: 15 },
    'claude-opus-4-6':    { input: 15, output: 75 },
    'claude-opus-4-5':    { input: 15, output: 75 },
    'claude-haiku-4-5':   { input: 0.80, output: 4 },
    // Cache pricing (discounted)
    _cacheWrite: 3.75,  // per 1M tokens
    _cacheRead: 0.30,   // per 1M tokens
  };
  const DEFAULT_PRICING = { input: 3, output: 15 }; // Sonnet fallback

  let totalInputTokens, totalOutputTokens, totalTokens, totalSpendUSD;

  if (hasRealData) {
    // Use ACTUAL token data from Claude Code sessions
    let realInput = 0, realOutput = 0, realCacheWrite = 0, realCacheRead = 0;

    for (const s of allSessions) {
      if (s.hasActualTokenData) {
        realInput += s.actualInputTokens;
        realOutput += s.actualOutputTokens;
        realCacheWrite += s.actualCacheCreationTokens;
        realCacheRead += s.actualCacheReadTokens;
      }
    }

    totalInputTokens = realInput + realCacheWrite + realCacheRead;
    totalOutputTokens = realOutput;
    totalTokens = totalInputTokens + totalOutputTokens;

    // Calculate cost using actual model data
    const allModels = allSessions.flatMap(s => s.models || []);
    const modelCounts = {};
    for (const m of allModels) modelCounts[m] = (modelCounts[m] || 0) + 1;

    // Weighted average pricing based on actual model mix
    let totalModelCalls = Object.values(modelCounts).reduce((a, b) => a + b, 0) || 1;
    let weightedInputRate = 0, weightedOutputRate = 0;
    for (const [model, count] of Object.entries(modelCounts)) {
      const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
      const weight = count / totalModelCalls;
      weightedInputRate += pricing.input * weight;
      weightedOutputRate += pricing.output * weight;
    }
    if (weightedInputRate === 0) { weightedInputRate = DEFAULT_PRICING.input; weightedOutputRate = DEFAULT_PRICING.output; }

    totalSpendUSD = (realInput / 1_000_000) * weightedInputRate
      + (realOutput / 1_000_000) * weightedOutputRate
      + (realCacheWrite / 1_000_000) * MODEL_PRICING._cacheWrite
      + (realCacheRead / 1_000_000) * MODEL_PRICING._cacheRead;

  } else {
    // Fallback: estimation from turn counts
    const INPUT_PER_TURN = 4000;
    const OUTPUT_PER_TURN = 1500;
    const TOKENS_PER_TOOL_CALL = 500;

    const totalToolCalls = Object.values(stats.toolUsage).reduce((a, b) => a + b, 0);
    totalInputTokens = stats.totalTurns * INPUT_PER_TURN + totalToolCalls * TOKENS_PER_TOOL_CALL;
    totalOutputTokens = stats.totalAssistantMessages * OUTPUT_PER_TURN + totalToolCalls * TOKENS_PER_TOOL_CALL;
    totalTokens = totalInputTokens + totalOutputTokens;

    const blendedInputCost = 0.7 * (3 / 1_000_000) + 0.3 * (15 / 1_000_000);
    const blendedOutputCost = 0.7 * (15 / 1_000_000) + 0.3 * (75 / 1_000_000);
    totalSpendUSD = totalInputTokens * blendedInputCost + totalOutputTokens * blendedOutputCost;
  }

  // Weekly and monthly projections
  const recentSessionData = sessionsWithRealData.filter(s => {
    const t = s.timestamp ? new Date(s.timestamp).getTime() : 0;
    return t > weekAgo;
  });
  let weeklyTokens;
  if (recentSessionData.length > 0 && hasRealData) {
    weeklyTokens = recentSessionData.reduce((sum, s) =>
      sum + s.actualInputTokens + s.actualOutputTokens + s.actualCacheCreationTokens + s.actualCacheReadTokens, 0);
  } else {
    weeklyTokens = stats.recentSessions.reduce((sum, s) =>
      sum + (s.turns || 0) * 5500, 0);
  }
  const monthlyTokensProjected = weeklyTokens * 4;
  const avgCostPerToken = totalTokens > 0 ? totalSpendUSD / totalTokens : 0.000012;
  const monthlySpendProjected = monthlyTokensProjected * avgCostPerToken;

  // Days active (from first to last session)
  const allTimestamps = projectsData
    .flatMap(p => p.sessions.map(s => s.timestamp).filter(Boolean))
    .map(t => new Date(t).getTime())
    .filter(t => !isNaN(t));

  const firstSession = allTimestamps.length > 0 ? Math.min(...allTimestamps) : now;
  const daysActive = Math.max(1, Math.round((now - firstSession) / (24 * 60 * 60 * 1000)));

  const totalToolCalls = Object.values(stats.toolUsage).reduce((a, b) => a + b, 0);

  stats.spend = {
    dataSource: hasRealData ? 'actual' : 'estimated',
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalSpendUSD: Math.round(totalSpendUSD * 100) / 100,
    monthlyTokensProjected,
    monthlySpendProjected: Math.round(monthlySpendProjected * 100) / 100,
    weeklyTokens,
    weeklySpendUSD: Math.round((weeklyTokens * avgCostPerToken) * 100) / 100,
    totalToolCalls,
    daysActive,
    avgDailySpendUSD: Math.round((totalSpendUSD / daysActive) * 100) / 100,
  };

  return stats;
}
