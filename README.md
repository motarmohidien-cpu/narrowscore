# NarrowScore

**Find your narrow. Fix it. Repeat.**

The AI efficiency score for Claude Code users. Based on Goldratt's Theory of Constraints.

```bash
npx narrowscore
```

## What it does

NarrowScore scans your Claude Code session history and identifies your **#1 bottleneck** — the single constraint limiting your throughput. Fix that one thing. Then find the next.

- **Score 0-100** across 5 categories: Context, Efficiency, Workflow, Automation, Integration
- **Dollar savings** for each constraint — see exactly how much you save by fixing it
- **Token spend tracking** — know your total spend, monthly projection, and spend tier
- **Player cards** — shareable PNG trading cards with your score, tier, and spend
- **Leaderboard** — compete with other Claude Code users at [narrowscore.com](https://narrowscore.com)

## Commands

```bash
narrowscore              # Scan & score your Claude Code setup
narrowscore stats        # Detailed session statistics
narrowscore fix          # Auto-fix your #1 narrow point
narrowscore card         # Generate your player card (PNG)
narrowscore publish      # Publish score to leaderboard
narrowscore share        # Generate shareable text score card
narrowscore help         # Show help
```

## Scoring

| Tier | Score | Label |
|------|-------|-------|
| S | 90-100 | Claude Whisperer |
| A | 75-89 | Power User |
| B | 60-74 | Solid Operator |
| C | 40-59 | Getting There |
| D | 20-39 | Room to Grow |
| F | 0-19 | Fresh Start |

## The 8 Constraints

1. **No CLAUDE.md** — Claude starts every session blind
2. **Thin CLAUDE.md** — Context file too light to be useful
3. **No memory system** — Decisions lost between sessions
4. **Repeated context** — You're typing the same things over and over
5. **No subagents** — Tasks running serial that could be parallel
6. **No hooks/skills** — Repetitive workflows done manually
7. **No MCP servers** — Manual copy-paste from external tools
8. **Abandoned sessions** — Too many 1-turn throwaway sessions

## Philosophy

From *The Goal* by Eliyahu Goldratt:

> Every system has ONE constraint. Optimizing anything else is an illusion.

NarrowScore identifies that one constraint in your Claude Code workflow and tells you exactly how to fix it — with dollar estimates so you know the ROI.

## Spend Tiers

| Spend | Badge |
|-------|-------|
| $500+ | WHALE |
| $200+ | POWER SPENDER |
| $50+ | COMMITTED |
| $10+ | GETTING STARTED |
| <$10 | NEWCOMER |

## License

MIT
