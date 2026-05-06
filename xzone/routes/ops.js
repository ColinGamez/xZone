'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb } = require('../db/schema');

const router = express.Router();
const REQUEST_LOG = path.join(config.rootDir, 'logs', 'all-requests.jsonl');

function isLocalRequest(req) {
  const ip = String(req.ip || req.socket.remoteAddress || '');
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.startsWith('::ffff:127.')
  );
}

function requireOpsAccess(req, res, next) {
  if (config.adminToken && req.headers['x-admin-token'] === config.adminToken) return next();
  if (config.ops.allowLocalhost && isLocalRequest(req)) return next();
  return res.status(403).json({ error: 'Ops access requires localhost or X-Admin-Token' });
}

function readJsonl(file, limit) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit);

  return lines.flatMap(line => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function summarize(records) {
  const byPath = new Map();
  const byStatus = new Map();

  for (const record of records) {
    const requestPath = String(record.originalUrl || record.path || '/').split('?')[0] || '/';
    const key = `${record.method || 'GET'} ${requestPath}`;
    const current = byPath.get(key) || {
      route: key,
      count: 0,
      lastSeen: null,
      statuses: {},
    };

    current.count += 1;
    current.lastSeen = record.timestamp;
    current.statuses[record.statusCode] = (current.statuses[record.statusCode] || 0) + 1;
    byPath.set(key, current);

    const status = String(record.statusCode || 'unknown');
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }

  return {
    byStatus: Object.fromEntries([...byStatus.entries()].sort()),
    byPath: [...byPath.values()].sort((a, b) => b.count - a.count),
  };
}

router.use(requireOpsAccess);

router.get('/health', (req, res) => {
  const db = getDb();
  const counts = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    sessions: db.prepare('SELECT COUNT(*) as c FROM sessions').get().c,
    titles: db.prepare('SELECT COUNT(*) as c FROM titles').get().c,
    posts: db.prepare('SELECT COUNT(*) as c FROM feed_posts').get().c,
  };

  res.json({
    service: config.serviceName,
    version: config.serviceVersion,
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    dbPath: config.dbPath,
    counts,
  });
});

router.get('/requests', (req, res) => {
  const limit = Math.min(
    Number.parseInt(req.query.limit, 10) || config.ops.maxRecentRequests,
    1000
  );
  const records = readJsonl(REQUEST_LOG, limit);
  const summary = summarize(records);

  res.json({
    log: REQUEST_LOG,
    count: records.length,
    summary,
    recent: records.slice(-50).reverse(),
  });
});

router.get('/unhandled', (req, res) => {
  const limit = Math.min(
    Number.parseInt(req.query.limit, 10) || config.ops.maxRecentRequests,
    1000
  );
  const records = readJsonl(REQUEST_LOG, limit)
    .filter(record => Number(record.statusCode) >= 400)
    .reverse();

  res.json({
    count: records.length,
    requests: records,
  });
});

router.get('/routes', (req, res) => {
  res.json({
    core: [
      'GET /',
      'GET /dashboard',
      'GET /stats',
      'GET /spotlight',
      'GET /spotlight/community',
      'GET /social/online',
      'POST /social/heartbeat',
      'GET /social/feed',
      'POST /social/feed',
      'GET /famestar/leaderboard/top',
      'GET /famestar/:gamertag',
      'POST /famestar/award-points',
      'GET /titles',
      'POST /titles',
      'GET /titles/:titleId',
      'GET /titles/:titleId/presence',
    ],
    stubs: [
      'GET /avatar/manifest',
      'GET /avatar/items',
      'GET /avatar/assets',
      'GET /avatar/awards',
      'GET /avatar/body',
      'ALL /avatar/*',
      'GET /marketplace/featured',
      'GET /marketplace/browse',
      'GET /marketplace/deals',
      'GET /marketplace/new',
      'ALL /marketplace/*',
      'ALL /zune/*',
      'ALL /video/*',
      'ALL /music/*',
    ],
    ops: [
      'GET /ops/health',
      'GET /ops/routes',
      'GET /ops/requests',
      'GET /ops/unhandled',
    ],
  });
});

module.exports = router;
