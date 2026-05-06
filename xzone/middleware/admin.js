'use strict';

const config = require('../config');

function requireAdminIfConfigured(req, res, next) {
  if (!config.adminToken) return next();
  if (req.headers['x-admin-token'] === config.adminToken) return next();
  return res.status(403).json({ error: 'Admin token required' });
}

module.exports = { requireAdminIfConfigured };
