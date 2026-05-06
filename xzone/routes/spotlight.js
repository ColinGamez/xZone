const express = require('express');
const router  = express.Router();
const config  = require('../config');
const { getDb } = require('../db/schema');
const { sendNegotiated } = require('../lib/responses');

// GET /spotlight — What's New feed for the dashboard
// Returns items the Metro plugin/NXE stub will display
router.get('/', (req, res) => {
  sendNegotiated(req, res, 'SpotlightResponse', {
    version: '1.0',
    service: 'Xzone Spotlight',
    items: config.spotlight.items,
  });
});

// GET /spotlight/community — live community activity for the feed
router.get('/community', (req, res) => {
  const db = getDb();

  const recentJoins = db.prepare(`
    SELECT gamertag, joined_at FROM users
    WHERE is_active = 1
    ORDER BY joined_at DESC LIMIT 5
  `).all();

  const topFamestar = db.prepare(`
    SELECT u.gamertag, f.level, f.title, f.points
    FROM famestar f JOIN users u ON u.id = f.user_id
    WHERE u.is_active = 1
    ORDER BY f.points DESC LIMIT 3
  `).all();

  const recentPosts = db.prepare(`
    SELECT u.gamertag, p.body, p.created_at
    FROM feed_posts p JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC LIMIT 5
  `).all();

  sendNegotiated(req, res, 'CommunityResponse', {
    recentJoins,
    topFamestar,
    recentPosts,
  });
});

module.exports = router;
