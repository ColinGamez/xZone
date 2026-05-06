'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDb } = require('../db/schema');

const router = express.Router();
const REQUEST_LOG = path.join(config.logging.dir, 'all-requests.jsonl');

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

function parseLimit(value) {
  return Math.min(
    Math.max(Number.parseInt(value, 10) || config.ops.maxRecentRequests, 1),
    1000
  );
}

function requestPath(record) {
  if (record.proxy?.path) return String(record.proxy.path).split('?')[0] || '/';
  const value = String(record.originalUrl || record.path || '/');
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).pathname || '/';
    } catch {
      return value.split('?')[0] || '/';
    }
  }
  return value.split('?')[0] || '/';
}

function normalizeRecord(record) {
  return {
    ...record,
    path: requestPath(record),
  };
}

function filterRecords(records, query) {
  const status = query.status ? String(query.status) : '';
  const method = query.method ? String(query.method).toUpperCase() : '';
  const contains = query.contains ? String(query.contains).toLowerCase() : '';
  const host = query.host ? String(query.host).toLowerCase() : '';
  const userAgent = query.ua ? String(query.ua).toLowerCase() : '';

  return records.filter(record => {
    if (status && String(record.statusCode) !== status) return false;
    if (method && String(record.method || '').toUpperCase() !== method) return false;
    if (contains && !String(`${record.originalUrl || record.path || ''} ${record.proxy?.originalUrl || ''}`).toLowerCase().includes(contains)) return false;
    if (host && !String(`${record.meta?.host || ''} ${record.proxy?.host || ''}`).toLowerCase().includes(host)) return false;
    if (userAgent && !String(record.meta?.['user-agent'] || '').toLowerCase().includes(userAgent)) return false;
    return true;
  });
}

function summarize(records) {
  const byPath = new Map();
  const byStatus = new Map();
  const byHost = new Map();
  const byUserAgent = new Map();

  for (const record of records) {
    const key = `${record.method || 'GET'} ${requestPath(record)}`;
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

    const host = String(record.proxy?.host || record.meta?.host || 'unknown');
    byHost.set(host, (byHost.get(host) || 0) + 1);

    const ua = String(record.meta?.['user-agent'] || 'unknown').slice(0, 160);
    byUserAgent.set(ua, (byUserAgent.get(ua) || 0) + 1);
  }

  return {
    byStatus: Object.fromEntries([...byStatus.entries()].sort()),
    byHost: Object.fromEntries([...byHost.entries()].sort((a, b) => b[1] - a[1])),
    byUserAgent: Object.fromEntries([...byUserAgent.entries()].sort((a, b) => b[1] - a[1])),
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
  const limit = parseLimit(req.query.limit);
  const records = filterRecords(readJsonl(REQUEST_LOG, limit), req.query).map(normalizeRecord);
  const summary = summarize(records);

  res.json({
    log: REQUEST_LOG,
    count: records.length,
    summary,
    recent: records.slice(-50).reverse(),
  });
});

router.delete('/requests', (req, res) => {
  const files = fs.existsSync(config.logging.dir)
    ? fs.readdirSync(config.logging.dir)
      .filter(name => name.endsWith('-requests.log') || name.endsWith('-requests.jsonl'))
      .map(name => path.join(config.logging.dir, name))
    : [];

  for (const file of files) {
    if (fs.existsSync(file)) fs.truncateSync(file, 0);
  }

  res.json({
    status: 'cleared',
    files,
  });
});

router.get('/unhandled', (req, res) => {
  const limit = parseLimit(req.query.limit);
  const records = filterRecords(readJsonl(REQUEST_LOG, limit), req.query)
    .filter(record => Number(record.statusCode) >= 400)
    .map(normalizeRecord)
    .reverse();

  res.json({
    count: records.length,
    requests: records,
  });
});

router.get('/export', (req, res) => {
  const db = getDb();
  const tables = [
    'users',
    'famestar',
    'famestar_awards',
    'famestar_activity',
    'feed_posts',
    'titles',
    'sessions',
  ];

  const data = Object.fromEntries(tables.map(table => [
    table,
    db.prepare(`SELECT * FROM ${table}`).all(),
  ]));

  res.json({
    service: config.serviceName,
    version: config.serviceVersion,
    exportedAt: new Date().toISOString(),
    data,
  });
});

router.get('/routes', (req, res) => {
  res.json({
    core: [
      'GET /',
      'GET /dashboard',
      'GET /probe',
      'GET /probe.txt',
      'GET /probe.xml',
      'ALL /probe/echo',
      'GET /stats',
      'GET /spotlight',
      'GET /spotlight/community',
      'GET /social/online',
      'GET /social/heartbeat',
      'POST /social/heartbeat',
      'GET /social/feed',
      'POST /social/feed',
      'GET /famestar/leaderboard/top',
      'GET /famestar/:gamertag',
      'POST /famestar/award-points',
      'GET /titles',
      'POST /titles',
      'GET /titles/:titleId',
      'PATCH /titles/:titleId',
      'DELETE /titles/:titleId',
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
      'DELETE /ops/requests',
      'GET /ops/unhandled',
      'GET /ops/export',
    ],
  });
});

module.exports = router;
