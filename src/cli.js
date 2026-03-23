/**
 * CLI — the command interface for NarrowScore.
 *
 * Commands:
 *   narrowscore         — Scan, score, show #1 narrow point
 *   narrowscore stats   — Detailed session statistics
 *   narrowscore fix     — Auto-fix top narrow point (generate/evolve CLAUDE.md)
 *   narrowscore share   — Generate shareable score card
 *   narrowscore help    — Show help
 */

import {
  loadAllSessions,
  checkClaudeMdFiles,
  checkFeatureUsage,
  aggregateStats,
} from './parser.js';
import { calculateScore } from './score.js';
import { generateClaudeMd } from './generator.js';
import {
  banner,
  formatScore,
  formatStats,
  formatShareCard,
  startSpinner,
  colors as c,
} from './display.js';
import { generateCardPNG } from './card.js';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export async function run(args) {
  const command = args[0] || 'scan';

  switch (command) {
    case 'scan':
    case 'score':
      return runScan();
    case 'stats':
      return runStats();
    case 'card':
      return runCard();
    case 'fix':
      return runFix();
    case 'publish':
      return runPublish(args.slice(1));
    case 'share':
      return runShare();
    case 'help':
    case '--help':
    case '-h':
      return showHelp();
    case 'version':
    case '--version':
    case '-v':
      return showVersion();
    default:
      console.log(`${c.red}Unknown command: ${command}${c.reset}`);
      showHelp();
      process.exit(1);
  }
}

async function collectData() {
  const spinner = startSpinner('Scanning Claude Code sessions...');

  try {
    const projectsData = await loadAllSessions();
    spinner.stop('Sessions loaded');

    const spinner2 = startSpinner('Finding your narrow...');
    const claudeMd = await checkClaudeMdFiles();
    const features = await checkFeatureUsage();
    const stats = aggregateStats(projectsData);
    spinner2.stop('Analysis complete');

    return { projectsData, claudeMd, features, stats };
  } catch (err) {
    spinner.fail('Failed to load sessions');
    console.error(`\n  ${c.red}Error: ${err.message}${c.reset}`);
    console.error(`  ${c.dim}Make sure you have Claude Code installed and have used it at least once.${c.reset}\n`);
    process.exit(1);
  }
}

async function runScan() {
  console.log(banner());

  const data = await collectData();
  const scoreData = calculateScore(data);

  console.log('');
  console.log(formatScore(scoreData, data.stats.spend));
  console.log('');

  console.log(`  ${c.dim}${data.stats.totalSessions} sessions analyzed across ${Object.keys(data.stats.sessionsPerProject).length} projects${c.reset}`);
  console.log(`  ${c.dim}Run ${c.cyan}narrowscore stats${c.dim} for detailed breakdown${c.reset}`);
  console.log(`  ${c.dim}Run ${c.cyan}narrowscore fix${c.dim} to auto-fix your #1 narrow point${c.reset}`);
  console.log(`  ${c.dim}Run ${c.cyan}narrowscore share${c.dim} to generate a shareable score card${c.reset}`);
  console.log('');
}

async function runStats() {
  console.log(banner());

  const data = await collectData();

  console.log('');
  console.log(formatStats(data.stats));
  console.log('');

  // Per-project breakdown
  const sortedProjects = Object.entries(data.stats.sessionsPerProject)
    .sort((a, b) => b[1] - a[1]);

  if (sortedProjects.length > 0) {
    console.log(`  ${c.bold}Sessions per project:${c.reset}`);
    for (const [project, count] of sortedProjects.slice(0, 10)) {
      const bar = '█'.repeat(Math.min(20, Math.round(count / 2)));
      console.log(`  ${c.dim}${bar}${c.reset} ${count.toString().padStart(3)} ${c.dim}${project}${c.reset}`);
    }
    console.log('');
  }

  // Recent sessions
  if (data.stats.recentSessions.length > 0) {
    console.log(`  ${c.bold}Recent sessions (last 7 days):${c.reset}`);
    for (const session of data.stats.recentSessions.slice(0, 8)) {
      const date = new Date(session.timestamp).toLocaleDateString();
      const time = new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const mins = session.durationMs ? Math.round(session.durationMs / 60000) : '?';
      console.log(`  ${c.dim}${date} ${time}${c.reset}  ${session.turns} turns  ${c.dim}~${mins}min${c.reset}  ${c.cyan}${session.project}${c.reset}`);
    }
    console.log('');
  }
}

async function runCard() {
  console.log(banner());

  const data = await collectData();
  const scoreData = calculateScore(data);

  // Get username from git
  let username = 'user';
  try {
    const { execSync } = await import('child_process');
    username = execSync('git config user.name', { encoding: 'utf-8' }).trim() || 'user';
  } catch { /* fallback */ }

  const spinner = startSpinner('Generating player card...');

  try {
    const pngBuffer = await generateCardPNG(scoreData, username, data.stats.spend, data.stats);
    const outputPath = join(homedir(), '.claude', 'narrowscore-card.png');
    await writeFile(outputPath, pngBuffer);
    spinner.stop('Player card generated');

    console.log(`\n  ${c.green}${c.bold}Player card saved:${c.reset} ${outputPath}`);
    console.log(`  ${c.dim}Share it on X, Instagram, LinkedIn!${c.reset}\n`);

    // Open in Preview on macOS
    try {
      const { execSync } = await import('child_process');
      execSync(`open "${outputPath}"`, { stdio: 'ignore' });
    } catch { /* not macOS or can't open */ }
  } catch (err) {
    spinner.fail('Failed to generate card');
    console.error(`  ${c.red}${err.message}${c.reset}\n`);
  }
}

async function runFix() {
  console.log(banner());

  const data = await collectData();
  const scoreData = calculateScore(data);

  if (!scoreData.topConstraint) {
    console.log(`\n  ${c.green}${c.bold}No narrow points found!${c.reset} Score: ${scoreData.score}/100`);
    console.log(`  ${c.dim}You're operating at full throughput. Nice.${c.reset}\n`);
    return;
  }

  const constraint = scoreData.topConstraint;
  console.log(`\n  ${c.bold}${c.red}#1 Narrow:${c.reset} ${c.bold}${constraint.name}${c.reset}`);
  console.log(`  ${c.dim}${constraint.details}${c.reset}`);

  // Show the money
  if (constraint.monthlyCostUSD > 0 || constraint.scoreGain) {
    console.log('');
    console.log(`  ${c.bold}${c.white}WHAT FIXING THIS GETS YOU:${c.reset}`);
    if (constraint.monthlyCostUSD > 0) {
      const annual = (constraint.monthlyCostUSD * 12).toFixed(2);
      const label = constraint.isTimeSaving ? 'in dev time' : 'in token costs';
      console.log(`  ${c.green}💰 $${constraint.monthlyCostUSD.toFixed(2)}/month${c.reset} saved ${c.dim}(${label})${c.reset}`);
      console.log(`  ${c.green}💰 $${annual}/year${c.reset} ${c.dim}if sustained${c.reset}`);
    }
    if (constraint.tokensWasted > 0) {
      console.log(`  ${c.cyan}🔄 ${constraint.tokensWasted.toLocaleString()} tokens/month${c.reset} ${c.dim}recovered${c.reset}`);
    }
    if (constraint.scoreGain) {
      const projected = Math.min(100, scoreData.score + constraint.scoreGain);
      console.log(`  ${c.cyan}📈 Score: ${scoreData.score} → ${projected}${c.reset} ${c.dim}(+${constraint.scoreGain} points)${c.reset}`);
    }
  }
  console.log('');

  if (constraint.fixCommand === 'generate-claude-md' || constraint.fixCommand === 'evolve-claude-md') {
    const spinner = startSpinner('Generating CLAUDE.md from session history...');

    try {
      const content = generateClaudeMd(data);
      const outputPath = join(homedir(), '.claude', 'CLAUDE.md.narrow-suggestion');

      await writeFile(outputPath, content, 'utf-8');
      spinner.stop('CLAUDE.md generated');

      console.log(`\n  ${c.green}Generated:${c.reset} ${outputPath}`);
      console.log(`  ${c.dim}Review it, then:${c.reset}`);
      console.log(`  ${c.cyan}  cp ~/.claude/CLAUDE.md.narrow-suggestion ~/.claude/CLAUDE.md${c.reset}`);
      console.log('');

      // Show preview
      const lines = content.split('\n').slice(0, 25);
      console.log(`  ${c.bold}Preview:${c.reset}`);
      for (const line of lines) {
        console.log(`  ${c.dim}${line}${c.reset}`);
      }
      if (content.split('\n').length > 25) {
        console.log(`  ${c.dim}... (${content.split('\n').length - 25} more lines)${c.reset}`);
      }
      console.log('');
    } catch (err) {
      spinner.fail('Failed to generate CLAUDE.md');
      console.error(`  ${c.red}${err.message}${c.reset}\n`);
    }
  } else if (constraint.fixCommand === 'suggest-memories') {
    console.log(`  ${c.yellow}Memory system improvement:${c.reset}`);
    console.log(`  Tell Claude: "Remember that [key fact about your project/workflow]"`);
    console.log(`  Do this for your top 5-10 most important project facts.`);
    console.log('');
    console.log(`  ${c.dim}Examples:${c.reset}`);
    console.log(`  ${c.cyan}  "Remember that our API uses REST with JWT auth"${c.reset}`);
    console.log(`  ${c.cyan}  "Remember that tests run with vitest and need .env.test"${c.reset}`);
    console.log(`  ${c.cyan}  "Remember I prefer small, focused PRs"${c.reset}`);
    console.log('');
  } else {
    console.log(`  ${c.yellow}Fix:${c.reset} ${constraint.fix}`);
    console.log('');
  }
}

async function runPublish(args = []) {
  console.log(banner());

  const data = await collectData();
  const scoreData = calculateScore(data);

  // Get or create username config
  const configPath = join(homedir(), '.claude', 'narrowscore.json');
  let config = {};
  try {
    config = JSON.parse(await readFile(configPath, 'utf-8'));
  } catch { /* no config yet */ }

  // Check args for --username first
  for (const arg of args) {
    if (arg.startsWith('--username=')) {
      config.username = arg.split('=')[1].toLowerCase().replace(/\s+/g, '-');
      break;
    }
  }

  // If still no username, try git
  if (!config.username) {
    try {
      const { execSync } = await import('child_process');
      config.username = execSync('git config user.name', { encoding: 'utf-8' }).trim().toLowerCase().replace(/\s+/g, '-');
    } catch { /* fallback */ }
  }

  if (!config.username) {
    console.log(`  ${c.yellow}Set a username first:${c.reset}`);
    console.log(`  ${c.cyan}  narrowscore publish --username your-name${c.reset}\n`);
    return;
  }

  // Save config
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

  const spinner = startSpinner('Publishing to leaderboard...');

  const payload = {
    username: config.username,
    score: scoreData.score,
    tier: scoreData.tier,
    label: scoreData.label,
    spendTier: data.stats.spend ? getSpendTierName(data.stats.spend.totalSpendUSD) : 'NEWCOMER',
    spendUSD: data.stats.spend?.totalSpendUSD || 0,
    tokensTotal: data.stats.spend?.totalTokens || 0,
    daysActive: data.stats.spend?.daysActive || 1,
    projects: Object.keys(data.stats.sessionsPerProject).length,
    sessions: data.stats.totalSessions,
    narrowsCleared: scoreData.totalConstraints - scoreData.constraintsFound,
    narrowsTotal: scoreData.totalConstraints,
    topTools: Object.entries(data.stats.toolUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name),
  };

  const API_URL = config.apiUrl || 'http://localhost:3457';

  try {
    const res = await fetch(`${API_URL}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    spinner.stop('Published!');

    console.log(`\n  ${c.bold}${c.green}${result.message}${c.reset}`);
    console.log(`  ${c.dim}View leaderboard: ${API_URL}${c.reset}\n`);
  } catch (err) {
    spinner.fail('Failed to publish');
    console.error(`  ${c.red}${err.message}${c.reset}`);
    console.error(`  ${c.dim}Is the server running? Start with: node server/index.js${c.reset}\n`);
  }
}

function getSpendTierName(usd) {
  if (usd >= 500) return 'WHALE';
  if (usd >= 200) return 'POWER SPENDER';
  if (usd >= 50) return 'COMMITTED';
  if (usd >= 10) return 'GETTING STARTED';
  return 'NEWCOMER';
}

async function runShare() {
  console.log(banner());

  const data = await collectData();
  const scoreData = calculateScore(data);

  // Try to get username from git
  let username = 'user';
  try {
    const { execSync } = await import('child_process');
    username = execSync('git config user.name', { encoding: 'utf-8' }).trim() || 'user';
  } catch { /* fallback */ }

  console.log('');
  console.log(formatShareCard(scoreData, username, data.stats.spend));
  console.log('');

  // Also generate a plain-text version for copying
  const plainCard = generatePlainShareCard(scoreData, username, data.stats.spend);
  const cardPath = join(homedir(), '.claude', 'narrowscore-card.txt');
  await writeFile(cardPath, plainCard, 'utf-8');

  console.log(`  ${c.green}Score card saved to:${c.reset} ${cardPath}`);
  console.log(`  ${c.dim}Share it on Twitter/X, LinkedIn, or your team Slack!${c.reset}`);
  console.log('');
}

function generatePlainShareCard(scoreData, username, spend = null) {
  const { score, tier, label, constraintsFound, totalConstraints } = scoreData;
  const cleared = totalConstraints - constraintsFound;
  const bar = '█'.repeat(Math.round(score / 5)) + '░'.repeat(20 - Math.round(score / 5));

  const spendLine = spend ? `$${spend.totalSpendUSD.toFixed(2)} spent | $${spend.monthlySpendProjected.toFixed(2)}/mo` : '';
  const tokenLine = spend ? `${(spend.totalTokens / 1_000_000).toFixed(1)}M tokens | ${spend.daysActive} days active` : '';

  return [
    '┌──────────────────────────────────────────────┐',
    `│  @${username}'s Narrow Score`.padEnd(47) + '│',
    '│                                              │',
    `│  ${bar}  ${score}/100  [${tier}]`.padEnd(47) + '│',
    `│  ${label}`.padEnd(47) + '│',
    '│                                              │',
    ...(spendLine ? [
      `│  ${spendLine}`.padEnd(47) + '│',
      `│  ${tokenLine}`.padEnd(47) + '│',
      '│                                              │',
    ] : []),
    `│  Narrows cleared: ${cleared}/${totalConstraints}`.padEnd(47) + '│',
    '│                                              │',
    '│  Find your narrow: npx narrowscore           │',
    '│  narrowscore.com                             │',
    '└──────────────────────────────────────────────┘',
  ].join('\n');
}

function showHelp() {
  console.log(banner());
  console.log(`  ${c.bold}USAGE${c.reset}`);
  console.log(`    narrowscore              Scan & score your Claude Code setup`);
  console.log(`    narrowscore stats        Detailed session statistics`);
  console.log(`    narrowscore card         Generate your player card (PNG)`);
  console.log(`    narrowscore fix          Auto-fix your #1 narrow point`);
  console.log(`    narrowscore publish       Publish score to leaderboard`);
  console.log(`    narrowscore share        Generate shareable score card`);
  console.log(`    narrowscore help         Show this help`);
  console.log('');
  console.log(`  ${c.bold}PHILOSOPHY${c.reset}`);
  console.log(`    Based on Goldratt's Theory of Constraints.`);
  console.log(`    Every system has ONE narrow point. Fix that first.`);
  console.log(`    Then find the next one. Repeat.`);
  console.log('');
  console.log(`  ${c.dim}narrowscore.com${c.reset}`);
  console.log('');
}

function showVersion() {
  console.log('narrowscore v0.1.0');
}
