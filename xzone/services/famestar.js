'use strict';

const config = require('../config');

function calcLevel(points) {
  const safePoints = Math.max(0, Number.parseInt(points, 10) || 0);
  return Math.min(
    config.famestar.maxLevel,
    Math.floor(safePoints / config.famestar.pointsPerLevel) + 1
  );
}

function calcTitle(level) {
  if (level >= 100) return 'Legend';
  if (level >= 75) return 'Elite';
  if (level >= 50) return 'Veteran';
  if (level >= 25) return 'Rising Star';
  if (level >= 10) return 'Regular';
  return 'Newcomer';
}

function ensureFamestar(db, userId) {
  let fame = db.prepare('SELECT * FROM famestar WHERE user_id = ?').get(userId);
  if (!fame) {
    db.prepare('INSERT INTO famestar (user_id) VALUES (?)').run(userId);
    fame = db.prepare('SELECT * FROM famestar WHERE user_id = ?').get(userId);
  }
  return fame;
}

function awardPoints(db, userId, action, points, meta = null, options = {}) {
  const actionName = String(action || '').trim().slice(0, 80);
  const amount = Math.floor(Number(points));
  if (!actionName || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('action and positive points required');
  }

  const fame = ensureFamestar(db, userId);

  if (options.cooldownSeconds) {
    const cutoff = Math.floor(Date.now() / 1000) - options.cooldownSeconds;
    const recent = db.prepare(`
      SELECT id FROM famestar_activity
      WHERE user_id = ? AND action = ? AND created_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(userId, actionName, cutoff);

    if (recent) {
      return {
        awarded: false,
        reason: 'cooldown',
        points: fame.points,
        level: fame.level,
        title: fame.title,
        pointsAdded: 0,
        newAwards: [],
        leveledUp: false,
      };
    }
  }

  return db.transaction(() => {
    const newPts = fame.points + amount;
    const newLvl = calcLevel(newPts);
    const newTtl = calcTitle(newLvl);

    db.prepare(`
      UPDATE famestar SET points = ?, level = ?, title = ?, updated_at = strftime('%s','now')
      WHERE user_id = ?
    `).run(newPts, newLvl, newTtl, userId);

    db.prepare(`
      INSERT INTO famestar_activity (user_id, action, points, meta)
      VALUES (?, ?, ?, ?)
    `).run(userId, actionName, amount, meta ? JSON.stringify(meta) : null);

    const earned = [];
    for (const award of config.famestar.awards) {
      if (newPts >= award.points) {
        const result = db.prepare(`
          INSERT OR IGNORE INTO famestar_awards (user_id, award_id) VALUES (?, ?)
        `).run(userId, award.id);

        if (result.changes > 0) earned.push(award);
      }
    }

    return {
      awarded: true,
      points: newPts,
      level: newLvl,
      title: newTtl,
      pointsAdded: amount,
      newAwards: earned,
      leveledUp: newLvl > fame.level,
    };
  });
}

module.exports = {
  awardPoints,
  calcLevel,
  calcTitle,
  ensureFamestar,
};
