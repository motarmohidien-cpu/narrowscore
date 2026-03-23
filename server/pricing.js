/**
 * Escalating price engine.
 * Day 0: Free. Day 1: $1/month. Day 2: $2/month. Keeps going.
 * Users lock in the price on the day they subscribe — forever.
 */

const LAUNCH_DATE = process.env.LAUNCH_DATE || '2026-03-24';

/**
 * Get current price in cents based on days since launch.
 */
export function getCurrentPriceCents() {
  const days = Math.floor((Date.now() - new Date(LAUNCH_DATE).getTime()) / 86400000);
  if (days <= 0) return 0; // Free on launch day
  return days * 100; // $1/day escalation
}

/**
 * Format cents to display price.
 */
export function formatPrice(cents) {
  if (cents === 0) return 'FREE';
  return `$${(cents / 100).toFixed(0)}/month`;
}

/**
 * Get days since launch.
 */
export function getDaysSinceLaunch() {
  return Math.max(0, Math.floor((Date.now() - new Date(LAUNCH_DATE).getTime()) / 86400000));
}

/**
 * Get urgency message for marketing.
 */
export function getUrgencyMessage() {
  const days = getDaysSinceLaunch();
  const price = getCurrentPriceCents();
  const tomorrowPrice = (days + 1) * 100;

  if (days <= 0) return 'FREE TODAY ONLY — price goes to $1/month tomorrow!';
  return `Lock in ${formatPrice(price)} forever — tomorrow it goes to ${formatPrice(tomorrowPrice)}`;
}
