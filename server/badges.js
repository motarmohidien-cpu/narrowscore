/**
 * Badge/Achievement system.
 * Checked after each score publish. Awards new badges + creates notifications.
 */

export const BADGES = {
  first_score:    { name: 'First Score',     icon: 'star',    desc: 'Published your first score' },
  s_tier:         { name: 'S-Tier',          icon: 'crown',   desc: 'Reached S-tier (90+)' },
  a_tier:         { name: 'A-Tier',          icon: 'zap',     desc: 'Reached A-tier (75+)' },
  whale_club:     { name: 'Whale Club',      icon: 'whale',   desc: '$500+ total spend' },
  power_spender:  { name: 'Power Spender',   icon: 'bolt',    desc: '$200+ total spend' },
  streak_7:       { name: '7-Day Streak',    icon: 'fire',    desc: 'Scored 7 days in a row' },
  top_1pct:       { name: 'Top 1%',          icon: 'diamond', desc: 'Ranked in top 1%' },
  top_10pct:      { name: 'Top 10%',         icon: 'medal',   desc: 'Ranked in top 10%' },
  narrow_clear:   { name: 'Clean Slate',     icon: 'check',   desc: 'Cleared all 8 narrows' },
  early_adopter:  { name: 'Early Adopter',   icon: 'rocket',  desc: 'Joined in the first week' },
  social_10:      { name: 'Social',          icon: 'people',  desc: '10+ followers' },
  social_100:     { name: 'Popular',         icon: 'star2',   desc: '100+ followers' },
  million_tokens: { name: 'Million Club',    icon: 'chip',    desc: '1M+ tokens used' },
  billion_tokens: { name: 'Billion Club',    icon: 'cpu',     desc: '1B+ tokens used' },
};

/**
 * Check all badge conditions for a user and award new ones.
 * Returns array of newly awarded badge IDs.
 */
export function checkAndAwardBadges(db, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return [];

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  if (!profile) return [];

  const existingBadges = new Set(
    db.prepare('SELECT badge_id FROM user_badges WHERE user_id = ?').all(userId).map(b => b.badge_id)
  );

  const newBadges = [];

  function award(badgeId) {
    if (existingBadges.has(badgeId)) return;
    db.prepare('INSERT INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)').run(
      userId, badgeId, new Date().toISOString()
    );
    newBadges.push(badgeId);
  }

  // First score
  award('first_score');

  // Tier badges
  if (profile.score >= 90) award('s_tier');
  if (profile.score >= 75) award('a_tier');

  // Spend badges
  if (profile.spend_usd >= 500) award('whale_club');
  if (profile.spend_usd >= 200) award('power_spender');

  // Narrows
  if (profile.narrows_cleared >= profile.narrows_total) award('narrow_clear');

  // Token badges
  if (profile.tokens_total >= 1_000_000_000) award('billion_tokens');
  else if (profile.tokens_total >= 1_000_000) award('million_tokens');

  // Early adopter (within 7 days of launch)
  const launchDate = new Date(process.env.LAUNCH_DATE || '2026-03-24');
  const joinDate = new Date(user.created_at);
  if ((joinDate - launchDate) < 7 * 86400000) award('early_adopter');

  // Rank badges
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  const rank = db.prepare('SELECT COUNT(*) + 1 as r FROM profiles WHERE score > ?').get(profile.score).r;
  if (rank <= Math.max(1, totalUsers * 0.01)) award('top_1pct');
  if (rank <= Math.max(1, totalUsers * 0.10)) award('top_10pct');

  // Follower badges
  const followers = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(userId).c;
  if (followers >= 100) award('social_100');
  else if (followers >= 10) award('social_10');

  // 7-day streak (check score_history)
  const recentScores = db.prepare(`
    SELECT DISTINCT date(recorded_at) as d FROM score_history
    WHERE user_id = ? ORDER BY d DESC LIMIT 7
  `).all(userId);
  if (recentScores.length >= 7) {
    // Check if consecutive
    let streak = true;
    for (let i = 1; i < recentScores.length; i++) {
      const prev = new Date(recentScores[i - 1].d);
      const curr = new Date(recentScores[i].d);
      if ((prev - curr) > 2 * 86400000) { streak = false; break; }
    }
    if (streak) award('streak_7');
  }

  // Create notifications for new badges
  for (const badgeId of newBadges) {
    db.prepare(`
      INSERT INTO notifications (user_id, type, data, created_at)
      VALUES (?, 'badge', ?, ?)
    `).run(userId, JSON.stringify({ badge_id: badgeId, badge: BADGES[badgeId] }), new Date().toISOString());
  }

  return newBadges;
}
