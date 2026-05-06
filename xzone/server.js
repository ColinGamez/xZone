'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { initDb, getDb } = require('./db/schema');
const { appendRequestLog } = require('./lib/request-log');
const { sendXmlError, sendXmlStatus } = require('./lib/responses');

// Master request log captures every route, including 404s. It is useful while
// mapping the NXE/Metro service calls made by each dashboard blade.
const MASTER_LOG = path.join(__dirname, 'logs', 'all-requests.log');
const DASHBOARD_FILE = path.resolve(__dirname, '..', 'xzone-index.html');

// Routes
const famestarRoutes = require('./routes/famestar');
const spotlightRoutes = require('./routes/spotlight');
const avatarRoutes = require('./routes/avatar');
const marketplaceRoutes = require('./routes/marketplace');
const socialRoutes = require('./routes/social');
const titlesRoutes = require('./routes/titles');
const opsRoutes = require('./routes/ops');

function requestLogger(req, res, next) {
  const started = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - started;
    appendRequestLog(MASTER_LOG, req, {
      statusCode: res.statusCode,
      durationMs,
      includeBody: false,
    });
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
  });

  next();
}

function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);

  // Middleware
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Xzone-Version', config.serviceVersion);
    next();
  });
  app.use(cors());
  app.use(express.json({ limit: config.requestBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.requestBodyLimit }));
  app.use(express.text({
    type: ['application/xml', 'text/xml', '*/xml'],
    limit: config.requestBodyLimit,
  }));
  app.use(requestLogger);

  app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
  });

  // Dashboard frontend, served by the backend so a second static server is not required.
  app.get(['/dashboard', '/dashboard/', '/xzone', '/xzone/'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(DASHBOARD_FILE, err => {
      if (err) next(err);
    });
  });

  // Health check
  app.get('/', (req, res) => {
    res.json({
      service: config.serviceName,
      version: config.serviceVersion,
      status: 'alive',
      dashboard: '/dashboard',
    });
  });

  // Core Xzone services
  app.use('/famestar', famestarRoutes);
  app.use('/spotlight', spotlightRoutes);
  app.use('/social', socialRoutes);
  app.use('/titles', titlesRoutes);
  app.use('/ops', opsRoutes);

  // Dead Microsoft service stubs. These intercept calls the dashboard makes to
  // endpoints that no longer exist.
  app.use('/avatar', avatarRoutes);
  app.use('/marketplace', marketplaceRoutes);

  // Zune / Video / Music blade stubs. NXE expects XML from Live-era services.
  app.all('/zune/*', (req, res) => sendXmlStatus(res, 'ZuneResponse', 'Success', '<Items/>'));
  app.all('/video/*', (req, res) => sendXmlStatus(res, 'VideoResponse', 'Success', '<Items/>'));
  app.all('/music/*', (req, res) => sendXmlStatus(res, 'MusicResponse', 'Success', '<Items/>'));

  // Stats endpoint: quick overview for the web dashboard.
  app.get('/stats', (req, res) => {
    const db = getDb();
    const users = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').get().c;
    const cutoff = Math.floor(Date.now() / 1000) - config.social.onlineWindowSeconds;
    const online = db.prepare('SELECT COUNT(*) as c FROM sessions WHERE updated_at > ?').get(cutoff).c;
    const titles = db.prepare('SELECT COUNT(*) as c FROM titles WHERE is_active = 1').get().c;
    const posts = db.prepare('SELECT COUNT(*) as c FROM feed_posts').get().c;

    res.json({
      service: config.serviceName,
      totalUsers: users,
      onlineNow: online,
      titlesSupported: titles,
      feedPosts: posts,
    });
  });

  // 404 fallback: XML keeps NXE-era clients from hanging on an unparsable body.
  app.use((req, res) => {
    console.log(`[404] ${req.method} ${req.originalUrl} - unhandled`);
    sendXmlError(res, 404, 'NotFound', req.path);
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error('[ERROR]', err.stack || err);
    sendXmlError(res, 500, 'InternalServerError', req.path);
  });

  return app;
}

async function start() {
  await initDb();
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log('');
    console.log(`Xzone server running on ${config.host}:${config.port}`);
    console.log(`Health:    http://localhost:${config.port}/`);
    console.log(`Dashboard: http://localhost:${config.port}/dashboard`);
    console.log(`Stats:     http://localhost:${config.port}/stats`);
    console.log('');
  });
  return server;
}

if (require.main === module) {
  let server;
  const shutdown = signal => {
    console.log(`\n${signal} received, shutting Xzone down...`);
    if (!server) process.exit(0);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', err => {
    console.error('[UNHANDLED]', err);
  });

  start().then(s => {
    server = s;
  }).catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
}

module.exports = { createApp, start };
