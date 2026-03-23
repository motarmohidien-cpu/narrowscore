/**
 * Terminal display utilities — beautiful output with zero dependencies.
 * Box drawing, colors, progress bars, all using ANSI escape codes.
 */

// ANSI color codes
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

export { c as colors };

/**
 * Draw a box around text lines.
 */
export function box(lines, { title = null, color = c.cyan, width = 60 } = {}) {
  const inner = width - 4;
  const out = [];

  // Top border
  if (title) {
    const titleStr = ` ${title} `;
    const remaining = width - 2 - titleStr.length;
    const left = 1;
    const right = remaining - left;
    out.push(`${color}\u2554${'═'.repeat(left)}${c.bold}${titleStr}${c.reset}${color}${'═'.repeat(Math.max(0, right))}\u2557${c.reset}`);
  } else {
    out.push(`${color}\u2554${'═'.repeat(width - 2)}\u2557${c.reset}`);
  }

  // Content — truncate lines that exceed box width
  for (const line of lines) {
    const stripped = stripAnsi(line);
    if (stripped.length > inner) {
      let visLen = 0;
      let cutIdx = 0;
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '\x1b') {
          const end = line.indexOf('m', j);
          if (end !== -1) { j = end; continue; }
        }
        visLen++;
        if (visLen >= inner - 1) { cutIdx = j + 1; break; }
      }
      const truncated = line.slice(0, cutIdx) + c.reset;
      out.push(`${color}\u2551${c.reset}  ${truncated} ${color}\u2551${c.reset}`);
    } else {
      const pad = inner - stripped.length;
      out.push(`${color}\u2551${c.reset}  ${line}${' '.repeat(pad)}${color}\u2551${c.reset}`);
    }
  }

  // Bottom border
  out.push(`${color}\u255a${'═'.repeat(width - 2)}\u255d${c.reset}`);

  return out.join('\n');
}

/**
 * Strip ANSI escape codes for length calculation.
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Generate a colored progress bar.
 */
export function progressBar(value, max = 100, width = 20) {
  const ratio = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  let color;
  if (ratio >= 0.75) color = c.green;
  else if (ratio >= 0.5) color = c.yellow;
  else if (ratio >= 0.25) color = c.yellow;
  else color = c.red;

  return `${color}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}

/**
 * Format the main score display.
 */
export function formatScore(scoreData, spend = null) {
  const { score, tier, label, categories, topConstraint, allConstraints } = scoreData;

  const lines = [];

  // Score line
  const bar = progressBar(score, 100, 24);
  lines.push('');
  lines.push(`  ${c.bold}NARROW SCORE${c.reset}  ${bar}  ${c.bold}${scoreColor(score)}${score}/100${c.reset}  ${c.dim}[${tier}]${c.reset}`);
  lines.push(`                ${c.dim}${label}${c.reset}`);
  lines.push('');

  // Spend flex — the big number
  if (spend) {
    lines.push(`  ${c.bold}${c.white}SPEND${c.reset}`);
    lines.push(`  ${c.bold}${c.magenta}$${spend.totalSpendUSD.toFixed(2)}${c.reset} total  ${c.dim}|${c.reset}  ${c.bold}${formatTokens(spend.totalTokens)}${c.reset} tokens`);
    lines.push(`  ${c.dim}$${spend.monthlySpendProjected.toFixed(2)}/mo projected  |  ${spend.daysActive} days active  |  $${spend.avgDailySpendUSD.toFixed(2)}/day${c.reset}`);
    lines.push('');
  }

  // Category breakdown
  lines.push(`  ${c.bold}${c.white}BREAKDOWN${c.reset}  ${c.dim}${scoreData.constraintsCleared}/${scoreData.totalConstraints} constraints cleared${c.reset}`);
  for (const [cat, data] of Object.entries(categories)) {
    const catBar = progressBar(data.score, 100, 12);
    const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
    const earned = data.maxPoints - data.penalty;
    lines.push(`  ${catBar} ${catLabel.padEnd(14)} ${c.dim}${earned}/${data.maxPoints}${c.reset}`);
  }
  lines.push('');

  // Top constraint — THE narrow point
  if (topConstraint) {
    lines.push(`  ${c.bold}${c.red}#1 NARROW${c.reset}  ${c.bold}${topConstraint.name}${c.reset}`);
    lines.push(`  ${c.dim}${topConstraint.details}${c.reset}`);
    lines.push('');
    lines.push(`  ${c.yellow}${topConstraint.narrow}${c.reset}`);

    // Money line — the killer feature
    if (topConstraint.monthlyCostUSD > 0) {
      const costStr = `$${topConstraint.monthlyCostUSD.toFixed(2)}`;
      const savingLabel = topConstraint.isTimeSaving ? 'dev time' : 'tokens';
      lines.push(`  ${c.bold}${c.green}💰 Fix this → save ${costStr}/month${c.reset} ${c.dim}(${savingLabel})${c.reset}`);
    }
    lines.push(`  ${c.bold}${c.cyan}📈 Fix this → Score: ${score} → ${Math.min(100, score + topConstraint.penalty)}${c.reset} ${c.dim}(+${topConstraint.penalty} points)${c.reset}`);
    lines.push('');
    lines.push(`  ${c.green}→ ${topConstraint.fix}${c.reset}`);
    lines.push('');
  }

  // Total savings across ALL constraints
  if (allConstraints.length > 0) {
    const totalCost = allConstraints.reduce((s, c) => s + (c.monthlyCostUSD || 0), 0);
    if (totalCost > 0) {
      lines.push(`  ${c.bold}${c.white}FIX ALL ${allConstraints.length} CONSTRAINTS${c.reset}`);
      lines.push(`  ${c.green}$${totalCost.toFixed(2)}/month${c.reset} saved  ${c.dim}|${c.reset}  Score: ${c.bold}${score} → 100${c.reset}`);
      lines.push('');
    }
  }

  // Other constraints
  if (allConstraints.length > 1) {
    lines.push(`  ${c.bold}${c.white}OTHER NARROWS${c.reset} ${c.dim}(fix #1 first — Goldratt)${c.reset}`);
    for (const cn of allConstraints.slice(1, 4)) {
      const sev = cn.penalty >= 10 ? c.red : cn.penalty >= 4 ? c.yellow : c.dim;
      const costTag = cn.monthlyCostUSD > 0 ? ` ${c.green}$${cn.monthlyCostUSD.toFixed(2)}/mo${c.reset}` : '';
      lines.push(`  ${sev}●${c.reset} ${cn.name}  ${c.dim}-${cn.penalty}pts${c.reset}${costTag}`);
    }
    if (allConstraints.length > 4) {
      lines.push(`  ${c.dim}  +${allConstraints.length - 4} more${c.reset}`);
    }
    lines.push('');
  }

  return box(lines, { title: 'NARROW SCORE', color: c.cyan, width: 68 });
}

/**
 * Format large token numbers: 1,234,567 → "1.2M", 456,789 → "457K"
 */
function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return n.toString();
}

/**
 * Color for score value.
 */
function scoreColor(score) {
  if (score >= 75) return c.green;
  if (score >= 50) return c.yellow;
  return c.red;
}

/**
 * Get spend tier label — the flex badge.
 */
function spendTier(totalUSD) {
  if (totalUSD >= 500) return { badge: 'WHALE', color: c.magenta };
  if (totalUSD >= 200) return { badge: 'POWER SPENDER', color: c.cyan };
  if (totalUSD >= 50) return { badge: 'COMMITTED', color: c.blue };
  if (totalUSD >= 10) return { badge: 'GETTING STARTED', color: c.dim };
  return { badge: 'NEWCOMER', color: c.dim };
}

/**
 * Format session stats summary.
 */
export function formatStats(stats) {
  const lines = [];
  lines.push('');
  lines.push(`  ${c.bold}Sessions:${c.reset}     ${stats.totalSessions} total, ${stats.recentSessions.length} this week`);
  lines.push(`  ${c.bold}Turns:${c.reset}        ${stats.totalTurns} total (avg ${stats.avgTurnsPerSession}/session)`);
  lines.push(`  ${c.bold}Tools used:${c.reset}   ${stats.uniqueTools.length} unique`);

  const topTools = Object.entries(stats.toolUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}(${count})`)
    .join(', ');

  if (topTools) {
    lines.push(`  ${c.bold}Top tools:${c.reset}    ${c.dim}${topTools}${c.reset}`);
  }

  lines.push(`  ${c.bold}Projects:${c.reset}     ${Object.keys(stats.sessionsPerProject).length}`);

  if (stats.totalDurationMs > 0) {
    const mins = Math.round(stats.totalDurationMs / 60000);
    lines.push(`  ${c.bold}Total time:${c.reset}   ~${mins} min of Claude thinking time`);
  }

  lines.push('');
  return box(lines, { title: 'SESSION STATS', color: c.blue, width: 68 });
}

/**
 * Format the share card.
 */
export function formatShareCard(scoreData, username = 'user', spend = null) {
  const { score, tier, label, constraintsFound, totalConstraints } = scoreData;
  const bar = progressBar(score, 100, 20);
  const cleared = totalConstraints - constraintsFound;

  const lines = [];
  lines.push('');
  lines.push(`  ${c.bold}@${username}'s Narrow Score${c.reset}`);
  lines.push('');
  lines.push(`  ${bar}  ${c.bold}${score}/100${c.reset}  [${tier}] ${label}`);
  lines.push('');

  // The double flex: efficiency + spend
  if (spend) {
    const st = spendTier(spend.totalSpendUSD);
    lines.push(`  ${c.bold}${c.magenta}$${spend.totalSpendUSD.toFixed(2)}${c.reset} spent  ${c.dim}|${c.reset}  ${c.bold}${formatTokens(spend.totalTokens)}${c.reset} tokens`);
    lines.push(`  ${st.color}${st.badge}${c.reset}  ${c.dim}|  ${spend.daysActive} days  |  $${spend.monthlySpendProjected.toFixed(2)}/mo${c.reset}`);
    lines.push('');
  }

  lines.push(`  Narrows cleared: ${c.bold}${cleared}/${totalConstraints}${c.reset}`);
  lines.push('');
  lines.push(`  ${c.dim}Find your narrow: ${c.cyan}npx narrowscore${c.reset}`);
  lines.push('');

  return box(lines, { title: 'NARROW SCORE', color: c.magenta, width: 58 });
}

/**
 * Print the NarrowScore banner.
 */
export function banner() {
  return [
    '',
    `  ${c.cyan}${c.bold}  _   _                                  ${c.reset}`,
    `  ${c.cyan}${c.bold} | \\ | | __ _ _ __ _ __ _____      __    ${c.reset}`,
    `  ${c.cyan}${c.bold} |  \\| |/ _\` | '__| '__/ _ \\ \\ /\\ / /    ${c.reset}`,
    `  ${c.cyan}${c.bold} | |\\  | (_| | |  | | | (_) \\ V  V /     ${c.reset}`,
    `  ${c.cyan}${c.bold} |_| \\_|\\__,_|_|  |_|  \\___/ \\_/\\_/      ${c.reset}`,
    `  ${c.dim} Find your narrow. Fix it. Repeat.${c.reset}`,
    '',
  ].join('\n');
}

/**
 * Spinner animation for loading states.
 */
export function startSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  const interval = setInterval(() => {
    process.stdout.write(`\r  ${c.cyan}${frames[i % frames.length]}${c.reset} ${message}`);
    i++;
  }, 80);

  return {
    stop(finalMessage) {
      clearInterval(interval);
      process.stdout.write(`\r  ${c.green}✓${c.reset} ${finalMessage || message}\n`);
    },
    fail(finalMessage) {
      clearInterval(interval);
      process.stdout.write(`\r  ${c.red}✗${c.reset} ${finalMessage || message}\n`);
    },
  };
}
