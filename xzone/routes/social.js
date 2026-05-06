const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb }       = require('../db/schema');
const { requireAuth, softAuth } = require('../middleware/auth');
const config = require('../config');
const { awardPoints } = require('../services/famestar');
const { sendNegotiated } = require('../lib/responses');

function requestField(req, names) {
  for (const source of [req.body, req.query]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const name of names) {
      const value = source[name];
      if (Array.isArray(value)) {
        const first = value.find(item => item != null && String(item).trim());
        if (first != null) return String(first);
      } else if (value != null && String(value).trim()) {
        return String(value);
      }
    }
  }

  return '';
}

// GET /social/online — who's currently online on Xzone
router.get('/online', softAuth, (req, res) => {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - config.social.onlineWindowSeconds;

  const online = db.prepare(`
    SELECT u.gamertag, s.status, s.title_id, s.updated_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.updated_at > ? AND u.is_active = 1
    ORDER BY s.updated_at DESC
  `).all(cutoff);

  sendNegotiated(req, res, 'OnlineResponse', { online, count: online.length });
});

function heartbeat(req, res) {
  const status = requestField(req, ['status', 'presence']);
  const titleId = requestField(req, ['titleId', 'titleID', 'title_id', 'tid', 'title']);
  const db = getDb();
  const cleanStatus = String(status || 'Online').trim().slice(0, 40) || 'Online';
  const cleanTitleId = titleId ? String(titleId).trim().slice(0, 64) : null;

  const fame = db.transaction(() => {
    db.prepare(`
      INSERT INTO sessions (user_id, status, title_id, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'))
      ON CONFLICT(user_id) DO UPDATE SET
        status     = excluded.status,
        title_id   = excluded.title_id,
        updated_at = excluded.updated_at
    `).run(req.user.id, cleanStatus, cleanTitleId);

    return awardPoints(
      db,
      req.user.id,
      'heartbeat',
      config.famestar.heartbeatPoints,
      cleanTitleId ? { titleId: cleanTitleId } : null,
      { cooldownSeconds: config.famestar.heartbeatAwardCooldownSeconds }
    );
  });

  const payload = { status: 'ok', gamertag: req.user.gamertag, titleId: cleanTitleId, famestar: fame };
  return sendNegotiated(req, res, 'HeartbeatResponse', payload);
}

// POST /social/heartbeat — console checks in to show as online.
// GET is also supported so Neighborhood/browser probes can hit a plain URL.
router.post('/heartbeat', requireAuth, heartbeat);
router.get('/heartbeat', requireAuth, heartbeat);

// GET /social/feed — community feed
router.get('/feed', softAuth, (req, res) => {
  const db = getDb();
  const posts = db.prepare(`
    SELECT p.id, u.gamertag, p.body, p.created_at
    FROM feed_posts p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
    LIMIT 20
  `).all();
  sendNegotiated(req, res, 'FeedResponse', { posts });
});

// POST /social/feed — post to community feed
router.post('/feed', requireAuth, (req, res) => {
  const { body } = req.body;
  const postBody = typeof body === 'string' ? body.trim() : '';
  if (!postBody) {
    return res.status(400).json({ error: 'Post body required' });
  }
  if (postBody.length > config.social.feedPostMaxLength) {
    return res.status(400).json({ error: `Post too long (max ${config.social.feedPostMaxLength} chars)` });
  }

  const db = getDb();
  const id = uuidv4();
  const fame = db.transaction(() => {
    db.prepare(`
      INSERT INTO feed_posts (id, user_id, body) VALUES (?, ?, ?)
    `).run(id, req.user.id, postBody);

    return awardPoints(db, req.user.id, 'community_post', config.famestar.postPoints);
  });

  res.json({ id, status: 'posted', famestar: fame });
});

module.exports = router;
