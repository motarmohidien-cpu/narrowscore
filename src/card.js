/**
 * Player Card Generator — creates a trading-card-style PNG image.
 * Uses satori (JSX → SVG) + @resvg/resvg-js (SVG → PNG).
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(__dirname, '..', 'assets', 'fonts');

const WIDTH = 600;
const HEIGHT = 900;

// Tier colors and glow
const TIER_STYLES = {
  S: { color: '#FFD700', glow: '#FFD70066', bg: '#1a1500' },
  A: { color: '#00FFAA', glow: '#00FFAA44', bg: '#001a0f' },
  B: { color: '#00CCFF', glow: '#00CCFF33', bg: '#001a22' },
  C: { color: '#AAAACC', glow: '#AAAACC22', bg: '#12121a' },
  D: { color: '#FF8844', glow: '#FF884422', bg: '#1a1008' },
  F: { color: '#FF4444', glow: '#FF444422', bg: '#1a0808' },
};

const SPEND_BADGES = {
  WHALE: { color: '#FF44FF', label: 'WHALE' },
  'POWER SPENDER': { color: '#00CCFF', label: 'POWER SPENDER' },
  COMMITTED: { color: '#4488FF', label: 'COMMITTED' },
  'GETTING STARTED': { color: '#888899', label: 'GETTING STARTED' },
  NEWCOMER: { color: '#666677', label: 'NEWCOMER' },
};

function getSpendTier(totalUSD) {
  if (totalUSD >= 500) return 'WHALE';
  if (totalUSD >= 200) return 'POWER SPENDER';
  if (totalUSD >= 50) return 'COMMITTED';
  if (totalUSD >= 10) return 'GETTING STARTED';
  return 'NEWCOMER';
}

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return n.toString();
}

/**
 * Build the card layout as satori-compatible JSX object.
 */
function buildCard(scoreData, username, spend, stats) {
  const { score, tier, label, constraintsFound, totalConstraints } = scoreData;
  const ts = TIER_STYLES[tier] || TIER_STYLES.C;
  const cleared = totalConstraints - constraintsFound;
  const spendTierName = spend ? getSpendTier(spend.totalSpendUSD) : 'NEWCOMER';
  const sb = SPEND_BADGES[spendTierName];

  // Score ring: SVG arc
  const pct = score / 100;
  const initials = username.slice(0, 2).toUpperCase();

  // Top tools
  const topTools = stats ? Object.entries(stats.toolUsage || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name) : [];

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: WIDTH,
        height: HEIGHT,
        background: 'linear-gradient(180deg, #0a0a12 0%, #0f0f1a 40%, #0a0a12 100%)',
        fontFamily: 'SF',
        color: '#ffffff',
        padding: '0',
        position: 'relative',
        overflow: 'hidden',
      },
      children: [
        // Border glow effect
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              border: `2px solid ${ts.color}44`,
              borderRadius: '16px',
            },
          },
        },
        // Top accent line
        {
          type: 'div',
          props: {
            style: {
              width: '100%',
              height: '4px',
              background: `linear-gradient(90deg, transparent, ${ts.color}, transparent)`,
            },
          },
        },
        // Header: NARROWSCORE
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'center',
              padding: '20px 0 8px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '14px',
                    letterSpacing: '6px',
                    color: '#666688',
                    fontFamily: 'Mono',
                  },
                  children: 'NARROWSCORE',
                },
              },
            ],
          },
        },
        // Username + Initials circle
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '10px 0',
            },
            children: [
              // Initials circle
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    width: '72px',
                    height: '72px',
                    borderRadius: '50%',
                    background: `${ts.color}22`,
                    border: `2px solid ${ts.color}88`,
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    color: ts.color,
                    fontFamily: 'Mono',
                  },
                  children: initials,
                },
              },
              // Username
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '22px',
                    fontWeight: 'bold',
                    marginTop: '10px',
                    color: '#ffffff',
                  },
                  children: `@${username}`,
                },
              },
            ],
          },
        },
        // Score section
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '16px 0',
            },
            children: [
              // Score number
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '4px',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '64px',
                          fontWeight: 'bold',
                          color: ts.color,
                          fontFamily: 'Mono',
                          lineHeight: '1',
                        },
                        children: score.toString(),
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '20px',
                          color: '#666688',
                          fontFamily: 'Mono',
                        },
                        children: '/100',
                      },
                    },
                  ],
                },
              },
              // Progress bar
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    width: '340px',
                    height: '12px',
                    background: '#1a1a2e',
                    borderRadius: '6px',
                    marginTop: '12px',
                    overflow: 'hidden',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          width: `${Math.max(2, pct * 100)}%`,
                          height: '100%',
                          background: `linear-gradient(90deg, ${ts.color}88, ${ts.color})`,
                          borderRadius: '6px',
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        // Tier badge
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'center',
              gap: '12px',
              padding: '4px 0 16px',
            },
            children: [
              // Tier
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    padding: '6px 20px',
                    background: `${ts.color}18`,
                    border: `1px solid ${ts.color}55`,
                    borderRadius: '20px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: ts.color,
                    fontFamily: 'Mono',
                  },
                  children: `${tier}-TIER  ${label}`,
                },
              },
            ],
          },
        },
        // Divider
        {
          type: 'div',
          props: {
            style: {
              width: '80%',
              height: '1px',
              background: '#ffffff11',
              margin: '0 auto',
            },
          },
        },
        // Spend section
        ...(spend ? [{
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'center',
              gap: '24px',
              padding: '16px 30px',
            },
            children: [
              // Spend
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: '11px', color: '#666688', fontFamily: 'Mono', letterSpacing: '2px' },
                        children: 'SPEND',
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: '24px', fontWeight: 'bold', color: '#FF44FF', fontFamily: 'Mono' },
                        children: `$${spend.totalSpendUSD.toFixed(0)}`,
                      },
                    },
                  ],
                },
              },
              // Tokens
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: '11px', color: '#666688', fontFamily: 'Mono', letterSpacing: '2px' },
                        children: 'TOKENS',
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: '24px', fontWeight: 'bold', color: '#00CCFF', fontFamily: 'Mono' },
                        children: formatTokens(spend.totalTokens),
                      },
                    },
                  ],
                },
              },
              // Days
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: '11px', color: '#666688', fontFamily: 'Mono', letterSpacing: '2px' },
                        children: 'DAYS',
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: '24px', fontWeight: 'bold', color: '#AAAACC', fontFamily: 'Mono' },
                        children: spend.daysActive.toString(),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        // Spend tier badge
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'center',
              paddingBottom: '12px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    padding: '4px 16px',
                    background: `${sb.color}18`,
                    border: `1px solid ${sb.color}44`,
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: sb.color,
                    fontFamily: 'Mono',
                    letterSpacing: '2px',
                  },
                  children: sb.label,
                },
              },
            ],
          },
        }] : []),
        // Divider
        {
          type: 'div',
          props: {
            style: {
              width: '80%',
              height: '1px',
              background: '#ffffff11',
              margin: '0 auto',
            },
          },
        },
        // Stats grid: Narrows + Tools
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              padding: '16px 40px',
              gap: '20px',
            },
            children: [
              // Narrows cleared
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    flex: '1',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: '11px', color: '#666688', fontFamily: 'Mono', letterSpacing: '2px' },
                        children: 'NARROWS CLEARED',
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: '28px', fontWeight: 'bold', color: '#00FFAA', fontFamily: 'Mono', marginTop: '4px' },
                        children: `${cleared}/${totalConstraints}`,
                      },
                    },
                  ],
                },
              },
              // Top tools
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    flex: '1',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: '11px', color: '#666688', fontFamily: 'Mono', letterSpacing: '2px' },
                        children: 'TOP TOOLS',
                      },
                    },
                    ...topTools.map(tool => ({
                      type: 'div',
                      props: {
                        style: { fontSize: '14px', color: '#AAAACC', fontFamily: 'Mono', marginTop: '3px' },
                        children: tool,
                      },
                    })),
                  ],
                },
              },
            ],
          },
        },
        // Spacer
        { type: 'div', props: { style: { flex: '1' } } },
        // Footer
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '16px 0 20px',
              gap: '6px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: { fontSize: '13px', color: '#666688', fontFamily: 'Mono' },
                  children: 'Find your narrow',
                },
              },
              {
                type: 'div',
                props: {
                  style: { fontSize: '15px', color: '#00CCFF', fontWeight: 'bold', fontFamily: 'Mono' },
                  children: 'npx narrowscore',
                },
              },
              {
                type: 'div',
                props: {
                  style: { fontSize: '12px', color: '#444455', fontFamily: 'Mono' },
                  children: 'narrowscore.com',
                },
              },
            ],
          },
        },
        // Bottom accent line
        {
          type: 'div',
          props: {
            style: {
              width: '100%',
              height: '4px',
              background: `linear-gradient(90deg, transparent, ${ts.color}, transparent)`,
            },
          },
        },
      ],
    },
  };
}

/**
 * Generate the player card PNG buffer.
 */
export async function generateCardPNG(scoreData, username, spend, stats) {
  // Load bundled fonts
  const [interRegular, interBold, monoRegular, monoBold] = await Promise.all([
    readFile(join(FONTS_DIR, 'Inter-Regular.ttf')),
    readFile(join(FONTS_DIR, 'Inter-Bold.ttf')),
    readFile(join(FONTS_DIR, 'JetBrainsMono-Regular.ttf')),
    readFile(join(FONTS_DIR, 'JetBrainsMono-Bold.ttf')),
  ]);

  const element = buildCard(scoreData, username, spend, stats);

  const svg = await satori(element, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: 'SF', data: interRegular, weight: 400, style: 'normal' },
      { name: 'SF', data: interBold, weight: 700, style: 'normal' },
      { name: 'Mono', data: monoRegular, weight: 400, style: 'normal' },
      { name: 'Mono', data: monoBold, weight: 700, style: 'normal' },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH * 2 }, // 2x for retina
  });

  const pngData = resvg.render();
  return pngData.asPng();
}
