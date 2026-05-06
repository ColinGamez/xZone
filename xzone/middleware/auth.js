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

function firstField(source, names) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return '';

  for (const name of names) {
    const value = source[name];
    if (Array.isArray(value)) {
      const first = value.find(item => item != null && String(item).trim());
      if (first != null) return String(first);
    } else if (value != null && String(value).trim()) {
      return String(value);
    }
  }

  return '';
}

function getSimpleAuth(req) {
  if (!config.auth.allowSimpleAuth) return { gamertag: '', xuid: '' };

  return {
    gamertag: cleanHeader(
      firstField(req.query, ['gamertag', 'gamerTag', 'gt', 'name']) ||
      firstField(req.body, ['gamertag', 'gamerTag', 'gt', 'name']),
      config.auth.gamertagMaxLength
    ),
    xuid: cleanHeader(
      firstField(req.query, ['xuid', 'XUID', 'uid', 'xu']) ||
      firstField(req.body, ['xuid', 'XUID', 'uid', 'xu']),
      config.auth.xuidMaxLength
    ),
  };
}

function getAuthIdentity(req) {
  const headers = {
    gamertag: cleanHeader(headerString(req, 'x-gamertag'), config.auth.gamertagMaxLength),
    xuid: cleanHeader(headerString(req, 'x-xuid'), config.auth.xuidMaxLength),
  };

  if (headers.gamertag && headers.xuid) return headers;

  const simple = getSimpleAuth(req);
  return {
    gamertag: headers.gamertag || simple.gamertag,
    xuid: headers.xuid || simple.xuid,
  };
}

// Lightweight auth middleware
// Prefers X-Gamertag and X-XUID headers, with query/body fallback for quick
// Proto/Metro console probes and simple launcher scripts.
function requireAuth(req, res, next) {
  const { gamertag, xuid } = getAuthIdentity(req);

  if (!gamertag || !xuid) {
    return res.status(401).json({ error: 'Missing auth identity' });
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
  const { xuid } = getAuthIdentity(req);
  if (xuid) {
    const db = getDb();
    req.user = db.prepare('SELECT * FROM users WHERE xuid = ?').get(xuid) || null;
  }
  next();
}

module.exports = { requireAuth, softAuth, getAuthIdentity };
