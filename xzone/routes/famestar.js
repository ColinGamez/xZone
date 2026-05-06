const express  = require('express');
const router   = express.Router();
const { getDb }       = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { awardPoints, ensureFamestar } = require('../services/famestar');

function parsePositivePoints(value) {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

// GET /famestar/leaderboard/top — top 20 by points
router.get('/leaderboard/top', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT u.gamertag, f.points, f.level, f.title
    FROM famestar f
    JOIN users u ON u.id = f.user_id
    WHERE u.is_active = 1
    ORDER BY f.points DESC
    LIMIT 20
  `).all();
  res.json({ leaderboard: rows });
});

// POST /famestar/award-points — award points to the authed user
router.post('/award-points', requireAuth, (req, res) => {
  const { action, points, meta } = req.body;
  const amount = parsePositivePoints(points);
  if (!action || amount <= 0) {
    return res.status(400).json({ error: 'action and positive points required' });
  }

  try {
    res.json(awardPoints(getDb(), req.user.id, action, amount, meta));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /famestar/:gamertag — public profile
router.get('/:gamertag', (req, res) => {
  const db   = getDb();
  const user = db.prepare(`
    SELECT * FROM users WHERE gamertag = ? COLLATE NOCASE AND is_active = 1
  `).get(String(req.params.gamertag || '').trim());

  if (!user) return res.status(404).json({ error: 'Gamertag not found on Xzone' });

  const fame   = ensureFamestar(db, user.id);
  const awards = db.prepare('SELECT award_id, earned_at FROM famestar_awards WHERE user_id = ?').all(user.id);
  const recentActivity = db.prepare(`
    SELECT action, points, created_at FROM famestar_activity
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(user.id);

  res.json({
    gamertag:       user.gamertag,
    xuid:           user.xuid,
    level:          fame.level,
    points:         fame.points,
    title:          fame.title,
    awards:         awards,
    recentActivity: recentActivity,
    joinedAt:       user.joined_at,
    lastSeen:       user.last_seen,
  });
});

module.exports = router;
