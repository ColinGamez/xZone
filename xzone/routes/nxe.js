'use strict';

const express = require('express');
const path = require('path');
const config = require('../config');
const { appendRequestLog } = require('../lib/request-log');
const { sendNegotiated } = require('../lib/responses');

const LOG_FILE = path.join(config.logging.dir, 'nxe-requests.log');

const STUBS = [
  { mount: '/account', root: 'AccountResponse', collection: 'Accounts' },
  { mount: '/accounts', root: 'AccountResponse', collection: 'Accounts' },
  { mount: '/achievement', root: 'AchievementResponse', collection: 'Achievements' },
  { mount: '/achievements', root: 'AchievementResponse', collection: 'Achievements' },
  { mount: '/auth', root: 'AuthResponse', collection: 'Tokens' },
  { mount: '/catalog', root: 'CatalogResponse', collection: 'Items' },
  { mount: '/config', root: 'ConfigResponse', collection: 'Settings' },
  { mount: '/friend', root: 'FriendsResponse', collection: 'Friends' },
  { mount: '/friends', root: 'FriendsResponse', collection: 'Friends' },
  { mount: '/live', root: 'LiveResponse', collection: 'Services' },
  { mount: '/message', root: 'MessagesResponse', collection: 'Messages' },
  { mount: '/messages', root: 'MessagesResponse', collection: 'Messages' },
  { mount: '/notifications', root: 'NotificationsResponse', collection: 'Notifications' },
  { mount: '/notify', root: 'NotificationsResponse', collection: 'Notifications' },
  { mount: '/presence', root: 'PresenceResponse', collection: 'Users' },
  { mount: '/privacy', root: 'PrivacyResponse', collection: 'Settings' },
  { mount: '/profile', root: 'ProfileResponse', collection: 'Profiles' },
  { mount: '/profiles', root: 'ProfileResponse', collection: 'Profiles' },
  { mount: '/service', root: 'ServiceResponse', collection: 'Services' },
  { mount: '/services', root: 'ServiceResponse', collection: 'Services' },
  { mount: '/signin', root: 'SigninResponse', collection: 'Users' },
  { mount: '/storage', root: 'StorageResponse', collection: 'Items' },
  { mount: '/system', root: 'SystemResponse', collection: 'Settings' },
  { mount: '/user', root: 'UsersResponse', collection: 'Users' },
  { mount: '/users', root: 'UsersResponse', collection: 'Users' },
  { mount: '/xboxlive', root: 'LiveResponse', collection: 'Services' },
];

function collectionPayload(name) {
  return {
    [name.charAt(0).toLowerCase() + name.slice(1)]: [],
  };
}

function createStubRouter(stub) {
  const router = express.Router();
  const handler = (req, res) => {
    const payload = {
      status: 'Success',
      service: stub.mount.slice(1),
      path: req.originalUrl,
      ...collectionPayload(stub.collection),
    };

    res.set('X-Xzone-Stub', `nxe-${stub.mount.slice(1)}`);
    sendNegotiated(req, res, stub.root, payload);
  };

  router.use((req, res, next) => {
    appendRequestLog(LOG_FILE, req, { includeHeaders: true, includeBody: true });
    console.log(`[nxe] ${req.method} ${req.originalUrl}`);
    next();
  });
  router.all('/', handler);
  router.all('*', handler);
  return router;
}

function mountNxeStubs(app) {
  for (const stub of STUBS) {
    app.use(stub.mount, createStubRouter(stub));
  }
}

function routeInventory() {
  return STUBS.map(stub => `ALL ${stub.mount}/*`);
}

module.exports = {
  mountNxeStubs,
  routeInventory,
};
