const path = require('path');

require('dotenv').config();

const rootDir = path.resolve(__dirname, '..');

function intEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolEnv(name, fallback) {
  if (process.env[name] == null) return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(process.env[name]).toLowerCase());
}

module.exports = {
  rootDir,
  port: intEnv('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH || path.join(rootDir, 'db', 'xzone.db'),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '128kb',
  adminToken: process.env.XZONE_ADMIN_TOKEN || '',
  trustProxy: boolEnv('XZONE_TRUST_PROXY', false),
  corsOrigin: process.env.XZONE_CORS_ORIGIN || '*',

  // Xzone identity
  serviceName: 'Xzone',
  serviceVersion: '1.0.0',

  logging: {
    enabled: boolEnv('XZONE_REQUEST_LOG', true),
    dir: process.env.XZONE_LOG_DIR || path.join(rootDir, 'logs'),
    maxBodyChars: intEnv('XZONE_LOG_MAX_BODY_CHARS', 4000),
  },

  ops: {
    allowLocalhost: boolEnv('XZONE_OPS_ALLOW_LOCALHOST', true),
    maxRecentRequests: intEnv('XZONE_OPS_MAX_RECENT_REQUESTS', 200),
  },

  auth: {
    gamertagMaxLength: intEnv('XZONE_GAMERTAG_MAX_LENGTH', 15),
    xuidMaxLength: intEnv('XZONE_XUID_MAX_LENGTH', 64),
  },

  social: {
    onlineWindowSeconds: intEnv('XZONE_ONLINE_WINDOW_SECONDS', 300),
    feedPostMaxLength: intEnv('XZONE_FEED_POST_MAX_LENGTH', 280),
  },

  // Famestar config
  famestar: {
    maxLevel: 100,
    pointsPerLevel: 500,
    heartbeatPoints: 1,
    heartbeatAwardCooldownSeconds: intEnv('XZONE_HEARTBEAT_POINT_COOLDOWN_SECONDS', 300),
    postPoints: 10,
    awards: [
      { id: 'og',          name: 'OG',            desc: 'Early Xzone member',         points: 0    },
      { id: 'socialite',   name: 'Socialite',      desc: '50+ friends on Xzone',       points: 1000 },
      { id: 'gamemaster',  name: 'Game Master',    desc: 'Played 10 supported titles', points: 2500 },
      { id: 'trendsetter', name: 'Trendsetter',    desc: 'Custom theme equipped',      points: 500  },
      { id: 'legend',      name: 'Legend',         desc: 'Reached max Famestar level', points: 50000},
    ]
  },

  // Spotlight feed — edit these to control What's New on the dashboard
  spotlight: {
    items: [
      {
        id: '1',
        title: 'Welcome to Xzone',
        body: 'The community is live. Get your Famestar up.',
        image: null,
        url: null,
      },
      {
        id: '2',
        title: 'New Supported Title',
        body: 'Check the game hub for the latest Proto-compatible titles.',
        image: null,
        url: null,
      }
    ]
  }
};
