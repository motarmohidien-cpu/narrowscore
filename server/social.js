/**
 * Social features — follows, feed, reactions, comments, notifications.
 * All queries use the shared SQLite database.
 */

/**
 * Follow a user.
 */
export function follow(db, followerId, followingId) {
  if (followerId === followingId) return false;

  try {
    db.prepare('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)').run(
      followerId, followingId, new Date().toISOString()
    );

    // Notify the followed user
    const follower = db.prepare('SELECT username FROM users WHERE id = ?').get(followerId);
    db.prepare('INSERT INTO notifications (user_id, type, data, created_at) VALUES (?, ?, ?, ?)').run(
      followingId, 'follow',
      JSON.stringify({ follower_id: followerId, username: follower?.username }),
      new Date().toISOString()
    );

    return true;
  } catch {
    return false; // Already following
  }
}

/**
 * Unfollow a user.
 */
export function unfollow(db, followerId, followingId) {
  const result = db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(followerId, followingId);
  return result.changes > 0;
}

/**
 * Get followers of a user.
 */
export function getFollowers(db, userId, page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const followers = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_url, f.created_at as followed_at
    FROM follows f
    JOIN users u ON u.id = f.follower_id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(userId).c;
  return { followers, total, page };
}

/**
 * Get who a user is following.
 */
export function getFollowing(db, userId, page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const following = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_url, f.created_at as followed_at
    FROM follows f
    JOIN users u ON u.id = f.following_id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(userId).c;
  return { following, total, page };
}

/**
 * Get personalized feed (events from people you follow).
 */
export function getFeed(db, userId, page = 1, limit = 30) {
  const offset = (page - 1) * limit;
  const events = db.prepare(`
    SELECT e.*, u.username, u.display_name, u.avatar_url,
      (SELECT COUNT(*) FROM reactions r WHERE r.event_id = e.id) as reaction_count,
      (SELECT r.emoji FROM reactions r WHERE r.event_id = e.id AND r.user_id = ?) as my_reaction
    FROM events e
    JOIN users u ON u.id = e.user_id
    WHERE e.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
       OR e.user_id = ?
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, userId, userId, limit, offset);

  return {
    events: events.map(e => ({ ...e, data: JSON.parse(e.data) })),
    page,
  };
}

/**
 * Get global feed (all events).
 */
export function getGlobalFeed(db, userId, page = 1, limit = 30) {
  const offset = (page - 1) * limit;
  const events = db.prepare(`
    SELECT e.*, u.username, u.display_name, u.avatar_url,
      (SELECT COUNT(*) FROM reactions r WHERE r.event_id = e.id) as reaction_count,
      (SELECT r.emoji FROM reactions r WHERE r.event_id = e.id AND r.user_id = ?) as my_reaction
    FROM events e
    JOIN users u ON u.id = e.user_id
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId || 0, limit, offset);

  return {
    events: events.map(e => ({ ...e, data: JSON.parse(e.data) })),
    page,
  };
}

/**
 * Create a feed event (called when score changes, tier ups, etc.)
 */
export function createEvent(db, userId, eventType, data) {
  const result = db.prepare(
    'INSERT INTO events (user_id, event_type, data, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, eventType, JSON.stringify(data), new Date().toISOString());
  return result.lastInsertRowid;
}

/**
 * Add reaction to an event.
 */
export function addReaction(db, userId, eventId, emoji = 'fire') {
  const validEmojis = ['fire', 'rocket', '100', 'clap', 'mind_blown'];
  if (!validEmojis.includes(emoji)) emoji = 'fire';

  try {
    db.prepare('INSERT INTO reactions (user_id, event_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(
      userId, eventId, emoji, new Date().toISOString()
    );

    // Notify event owner
    const event = db.prepare('SELECT user_id FROM events WHERE id = ?').get(eventId);
    if (event && event.user_id !== userId) {
      const reactor = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
      db.prepare('INSERT INTO notifications (user_id, type, data, created_at) VALUES (?, ?, ?, ?)').run(
        event.user_id, 'reaction',
        JSON.stringify({ reactor_id: userId, username: reactor?.username, emoji, event_id: eventId }),
        new Date().toISOString()
      );
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Remove reaction from an event.
 */
export function removeReaction(db, userId, eventId) {
  db.prepare('DELETE FROM reactions WHERE user_id = ? AND event_id = ?').run(userId, eventId);
}

/**
 * Get comments on a user's profile.
 */
export function getComments(db, profileUserId, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const comments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar_url
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.profile_user_id = ?
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).all(profileUserId, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as c FROM comments WHERE profile_user_id = ?').get(profileUserId).c;
  return { comments, total, page };
}

/**
 * Add comment to a profile.
 */
export function addComment(db, userId, profileUserId, text) {
  if (!text || text.length > 500) return null;

  const result = db.prepare(
    'INSERT INTO comments (user_id, profile_user_id, text, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, profileUserId, text.trim(), new Date().toISOString());

  // Notify profile owner
  if (userId !== profileUserId) {
    const commenter = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    db.prepare('INSERT INTO notifications (user_id, type, data, created_at) VALUES (?, ?, ?, ?)').run(
      profileUserId, 'comment',
      JSON.stringify({ commenter_id: userId, username: commenter?.username, text: text.slice(0, 100) }),
      new Date().toISOString()
    );
  }

  return result.lastInsertRowid;
}

/**
 * Get notifications for a user.
 */
export function getNotifications(db, userId, page = 1, limit = 30) {
  const offset = (page - 1) * limit;
  const notifications = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(userId, limit, offset);

  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0').get(userId).c;

  return {
    notifications: notifications.map(n => ({ ...n, data: JSON.parse(n.data) })),
    unread,
    page,
  };
}

/**
 * Mark all notifications as read.
 */
export function markNotificationsRead(db, userId) {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
}
