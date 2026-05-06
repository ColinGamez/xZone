const express = require('express');
const router  = express.Router();
const { getDb }       = require('../db/schema');
const config = require('../config');
const { requireAdminIfConfigured } = require('../middleware/admin');

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

// GET /titles — list all supported game titles on Xzone
router.get('/', (req, res) => {
  const db     = getDb();
  const titles = db.prepare(`
    SELECT title_id, name, added_at, notes
    FROM titles WHERE is_active = 1
    ORDER BY name ASC
  `).all();
  res.json({ titles, count: titles.length });
});

// GET /titles/:titleId — info on a specific title
router.get('/:titleId', (req, res) => {
  const db    = getDb();
  const title = db.prepare(`
    SELECT * FROM titles WHERE title_id = ? AND is_active = 1
  `).get(req.params.titleId);

  if (!title) return res.status(404).json({ error: 'Title not supported on Xzone' });
  res.json(title);
});

// POST /titles — add a supported title.
// Set XZONE_ADMIN_TOKEN to require X-Admin-Token for this endpoint.
router.post('/', requireAdminIfConfigured, (req, res) => {
  const titleId = cleanText(req.body.titleId, 64);
  const name = cleanText(req.body.name, 120);
  const notes = cleanText(req.body.notes, 500);
  if (!titleId || !name) {
    return res.status(400).json({ error: 'titleId and name required' });
  }

  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO titles (title_id, name, notes) VALUES (?, ?, ?)
    `).run(titleId, name, notes || null);
    res.json({ status: 'added', titleId, name });
  } catch (e) {
    res.status(409).json({ error: 'Title already exists' });
  }
});

// PATCH /titles/:titleId — update title metadata or active state.
router.patch('/:titleId', requireAdminIfConfigured, (req, res) => {
  const titleId = cleanText(req.params.titleId, 64);
  const title = getDb().prepare('SELECT * FROM titles WHERE title_id = ?').get(titleId);
  if (!title) return res.status(404).json({ error: 'Title not found' });

  const name = req.body.name == null ? title.name : cleanText(req.body.name, 120);
  const notes = req.body.notes == null ? title.notes : cleanText(req.body.notes, 500);
  const isActive = req.body.isActive == null
    ? title.is_active
    : (req.body.isActive ? 1 : 0);

  if (!name) return res.status(400).json({ error: 'name cannot be empty' });

  getDb().prepare(`
    UPDATE titles SET name = ?, notes = ?, is_active = ? WHERE title_id = ?
  `).run(name, notes || null, isActive, titleId);

  res.json({
    status: 'updated',
    title: getDb().prepare('SELECT * FROM titles WHERE title_id = ?').get(titleId),
  });
});

// DELETE /titles/:titleId — soft-delete a title from public listings.
router.delete('/:titleId', requireAdminIfConfigured, (req, res) => {
  const titleId = cleanText(req.params.titleId, 64);
  const db = getDb();
  const title = db.prepare('SELECT title_id FROM titles WHERE title_id = ?').get(titleId);
  if (!title) return res.status(404).json({ error: 'Title not found' });

  db.prepare(`
    UPDATE titles SET is_active = 0 WHERE title_id = ?
  `).run(titleId);

  res.json({ status: 'removed', titleId });
});

// GET /titles/:titleId/presence — who's playing this title right now
router.get('/:titleId/presence', (req, res) => {
  const db = getDb();
  const cutoff  = Math.floor(Date.now() / 1000) - config.social.onlineWindowSeconds;
  const players = db.prepare(`
    SELECT u.gamertag, s.updated_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.title_id = ? AND s.updated_at > ?
    ORDER BY s.updated_at DESC
  `).all(req.params.titleId, cutoff);

  res.json({ titleId: req.params.titleId, players, count: players.length });
});

module.exports = router;
