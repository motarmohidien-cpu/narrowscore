/**
 * Stripe integration — escalating pricing with grandfathered rates.
 *
 * Flow:
 * 1. User clicks "Subscribe" → POST /api/subscribe → creates Stripe Checkout session
 * 2. Stripe redirects to success URL with session_id
 * 3. Webhook updates user's subscription status
 * 4. Price locked forever at the day they subscribe
 */

import Stripe from 'stripe';
import { getCurrentPriceCents } from './pricing.js';

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3457';

let stripe;

function getStripe() {
  if (!stripe && STRIPE_SECRET) {
    stripe = new Stripe(STRIPE_SECRET);
  }
  return stripe;
}

/**
 * Create a Stripe Checkout session for the current escalating price.
 * If price is 0 (launch day), skip Stripe and mark as free subscriber.
 */
export async function createCheckoutSession(db, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');

  // Already subscribed
  if (user.subscription_status === 'active') {
    return { alreadySubscribed: true, priceCents: user.price_locked_cents };
  }

  const priceCents = getCurrentPriceCents();

  // Launch day — free forever
  if (priceCents === 0) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE users SET subscription_status = 'active', price_locked_cents = 0, price_locked_at = ? WHERE id = ?
    `).run(now, userId);
    return { free: true, priceCents: 0 };
  }

  const s = getStripe();
  if (!s) throw new Error('Stripe not configured. Set STRIPE_SECRET_KEY env var.');

  // Find or create Stripe customer
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await s.customers.create({
      metadata: { narrowscore_user_id: String(userId), username: user.username },
      email: user.email || undefined,
    });
    customerId = customer.id;
    db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, userId);
  }

  // Create a price on the fly for this user's grandfathered rate
  const price = await s.prices.create({
    unit_amount: priceCents,
    currency: 'usd',
    recurring: { interval: 'month' },
    product_data: {
      name: `NarrowScore Pro — $${(priceCents / 100).toFixed(0)}/mo (locked forever)`,
      metadata: { locked_price_cents: String(priceCents) },
    },
  });

  const session = await s.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: `${BASE_URL}/subscribe/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE_URL}/?subscribe=cancelled`,
    metadata: {
      narrowscore_user_id: String(userId),
      locked_price_cents: String(priceCents),
    },
  });

  return { url: session.url, priceCents };
}

/**
 * Handle Stripe webhook events.
 */
export async function handleWebhook(rawBody, signature) {
  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');

  let event;
  if (STRIPE_WEBHOOK_SECRET) {
    event = s.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } else {
    event = JSON.parse(rawBody);
  }

  return event;
}

/**
 * Process a webhook event and update the database.
 */
export function processWebhookEvent(db, event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = parseInt(session.metadata?.narrowscore_user_id);
      const lockedPrice = parseInt(session.metadata?.locked_price_cents) || 0;
      if (!userId) break;

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE users SET
          stripe_subscription_id = ?,
          subscription_status = 'active',
          price_locked_cents = ?,
          price_locked_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(session.subscription, lockedPrice, now, now, userId);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const customerId = sub.customer;
      const status = sub.status; // active, past_due, canceled, etc.

      db.prepare(`
        UPDATE users SET subscription_status = ?, updated_at = ?
        WHERE stripe_customer_id = ?
      `).run(status, new Date().toISOString(), customerId);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      db.prepare(`
        UPDATE users SET subscription_status = 'canceled', updated_at = ?
        WHERE stripe_customer_id = ?
      `).run(new Date().toISOString(), sub.customer);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      db.prepare(`
        UPDATE users SET subscription_status = 'past_due', updated_at = ?
        WHERE stripe_customer_id = ?
      `).run(new Date().toISOString(), invoice.customer);
      break;
    }
  }

  return { received: true };
}

/**
 * Get subscription info for a user.
 */
export function getSubscriptionInfo(db, userId) {
  const user = db.prepare(`
    SELECT subscription_status, price_locked_cents, price_locked_at, stripe_subscription_id
    FROM users WHERE id = ?
  `).get(userId);

  if (!user) return null;

  return {
    status: user.subscription_status || 'free',
    priceLocked: user.price_locked_cents,
    priceLockedAt: user.price_locked_at,
    hasSubscription: !!user.stripe_subscription_id,
    currentPrice: getCurrentPriceCents(),
    savings: user.price_locked_cents > 0
      ? getCurrentPriceCents() - user.price_locked_cents
      : 0,
  };
}

/**
 * Cancel a subscription.
 */
export async function cancelSubscription(db, userId) {
  const user = db.prepare('SELECT stripe_subscription_id FROM users WHERE id = ?').get(userId);
  if (!user?.stripe_subscription_id) return { error: 'No active subscription' };

  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');

  await s.subscriptions.update(user.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  return { success: true, message: 'Subscription will cancel at end of billing period' };
}
