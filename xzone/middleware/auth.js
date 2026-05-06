const { getDb } = require('../db/schema');
const config = require('../config');

function headerString(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function cleanHeader(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\r\n]/g, '').slice(0, maxLength);
}

function getAuthHeaders(req) {
  return {
    gamertag: cleanHeader(headerString(req, 'x-gamertag'), config.auth.gamertagMaxLength),
    xuid: cleanHeader(headerString(req, 'x-xuid'), config.auth.xuidMaxLength),
  };
}

// Lightweight auth middleware
// Expects X-Gamertag and X-XUID headers from the Metro plugin
function requireAuth(req, res, next) {
  const { gamertag, xuid } = getAuthHeaders(req);

  if (!gamertag || !xuid) {
    return res.status(401).json({ error: 'Missing auth headers' });
  }

  const db   = getDb();
  let   user = db.prepare('SELECT * FROM users WHERE xuid = ?').get(xuid);

  const gamertagOwner = db.prepare(`
    SELECT id FROM users WHERE gamertag = ? COLLATE NOCASE
  `).get(gamertag);

  if (gamertagOwner && (!user || gamertagOwner.id !== user.id)) {
    return res.status(409).json({ error: 'Gamertag already belongs to another XUID' });
  }

  // Auto-register new users on first contact
  if (!user) {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, gamertag, xuid) VALUES (?, ?, ?)
      `).run(id, gamertag, xuid);
      db.prepare(`
        INSERT INTO famestar (user_id) VALUES (?)
      `).run(id);
    });
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  // Update last seen + gamertag (in case it changed)
  db.prepare(`
    UPDATE users SET last_seen = strftime('%s','now'), gamertag = ? WHERE id = ?
  `).run(gamertag, user.id);

  req.user = { ...user, gamertag };
  next();
}

// Soft auth — attaches user if present, doesn't block if missing
function softAuth(req, res, next) {
  const { xuid } = getAuthHeaders(req);
  if (xuid) {
    const db = getDb();
    req.user = db.prepare('SELECT * FROM users WHERE xuid = ?').get(xuid) || null;
  }
  next();
}

module.exports = { requireAuth, softAuth };
