'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xzone-'));
process.env.DB_PATH = path.join(tmpDir, 'xzone.db');
process.env.XZONE_LOG_DIR = path.join(tmpDir, 'logs');
process.env.XZONE_REQUEST_LOG = '1';
process.env.XZONE_LOG_MAX_BODY_CHARS = '2000';

const { initDb } = require('../db/schema');
const { createApp } = require('../server');

let server;
let baseUrl;

test.before(async () => {
  await initDb();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => setTimeout(resolve, 100));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function json(pathname, options) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const body = await res.json();
  return { res, body };
}

test('health, dashboard, and XML fallback respond', async () => {
  const health = await json('/');
  assert.equal(health.res.status, 200);
  assert.equal(health.body.service, 'Xzone');
  assert.equal(health.body.dashboard, '/dashboard');
  assert.match(health.res.headers.get('x-request-id'), /^[0-9a-f-]{36}$/i);

  const dashboard = await fetch(`${baseUrl}/dashboard`);
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.headers.get('content-type'), /text\/html/);
  assert.equal(dashboard.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await dashboard.text(), /Xzone Setup/);

  const favicon = await fetch(`${baseUrl}/favicon.ico`);
  assert.equal(favicon.status, 204);

  const probeText = await fetch(`${baseUrl}/probe.txt`);
  assert.equal(probeText.status, 200);
  assert.match(await probeText.text(), /xZone OK/);

  const probeXml = await fetch(`${baseUrl}/probe.xml`);
  assert.equal(probeXml.status, 200);
  assert.match(probeXml.headers.get('content-type'), /application\/xml/);
  assert.match(await probeXml.text(), /<ProbeResponse/);

  const missing = await fetch(`${baseUrl}/missing/<bad>`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/xml/);
  assert.match(await missing.text(), /%3Cbad%3E/);

  const malformed = await fetch(`${baseUrl}/social/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"bad"',
  });
  assert.equal(malformed.status, 400);
  assert.match(await malformed.text(), /BadRequest/);
});

test('ops endpoints and XML-aware marketplace stubs work', async () => {
  const cleared = await json('/ops/requests', { method: 'DELETE' });
  assert.equal(cleared.res.status, 200);
  assert.equal(cleared.body.status, 'cleared');

  const ops = await json('/ops/health');
  assert.equal(ops.res.status, 200);
  assert.equal(ops.body.status, 'ok');
  assert.equal(typeof ops.body.uptimeSeconds, 'number');

  const routes = await json('/ops/routes');
  assert.equal(routes.res.status, 200);
  assert.ok(routes.body.core.includes('GET /probe.txt'));
  assert.ok(routes.body.core.includes('GET /social/heartbeat'));
  assert.ok(routes.body.stubs.includes('ALL /marketplace/*'));
  assert.ok(routes.body.ops.includes('GET /ops/export'));

  const marketplaceJson = await json('/marketplace/featured');
  assert.equal(marketplaceJson.res.status, 200);
  assert.deepEqual(marketplaceJson.body.items, []);

  const marketplaceXml = await fetch(`${baseUrl}/marketplace/featured`, {
    headers: {
      Accept: 'application/xml',
      'User-Agent': 'Xbox/2.0 xZone-smoke',
      Host: 'catalog.xboxlive.test',
    },
  });
  assert.equal(marketplaceXml.status, 200);
  assert.match(marketplaceXml.headers.get('content-type'), /application\/xml/);
  assert.match(await marketplaceXml.text(), /<MarketplaceResponse/);

  const exported = await json('/ops/export');
  assert.equal(exported.res.status, 200);
  assert.ok(Array.isArray(exported.body.data.users));

  await new Promise(resolve => setTimeout(resolve, 50));
  const testHost = new URL(baseUrl).host;
  const requests = await json(`/ops/requests?host=${encodeURIComponent(testHost)}&ua=xbox`);
  assert.equal(requests.res.status, 200);
  assert.ok(requests.body.summary.byPath.some(row => row.route === 'GET /marketplace/featured'));
  assert.equal(requests.body.summary.byHost[testHost], 1);
  assert.ok(Object.keys(requests.body.summary.byUserAgent).some(ua => ua.includes('Xbox/2.0')));
});

test('title admin lifecycle supports add, update, presence, and soft delete', async () => {
  const added = await json('/titles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titleId: '4D530919', name: 'Halo Reach', notes: 'Test title' }),
  });
  assert.equal(added.res.status, 200);
  assert.equal(added.body.status, 'added');

  const updated = await json('/titles/4D530919', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Halo: Reach', notes: 'Updated title' }),
  });
  assert.equal(updated.res.status, 200);
  assert.equal(updated.body.title.name, 'Halo: Reach');

  const listed = await json('/titles');
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.titles[0].title_id, '4D530919');

  const removed = await json('/titles/4D530919', { method: 'DELETE' });
  assert.equal(removed.res.status, 200);
  assert.equal(removed.body.status, 'removed');

  const after = await json('/titles');
  assert.equal(after.body.count, 0);
});

test('feed posting auto-registers a user and awards Famestar points', async () => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Gamertag': 'SmokeTest',
    'X-XUID': 'web-smoketest',
  };

  const posted = await json('/social/feed', {
    method: 'POST',
    headers,
    body: JSON.stringify({ body: 'hello <xzone>' }),
  });
  assert.equal(posted.res.status, 200);
  assert.equal(posted.body.status, 'posted');
  assert.equal(posted.body.famestar.pointsAdded, 10);

  const feed = await json('/social/feed');
  assert.equal(feed.res.status, 200);
  assert.equal(feed.body.posts[0].body, 'hello <xzone>');

  const profile = await json('/famestar/SmokeTest');
  assert.equal(profile.res.status, 200);
  assert.equal(profile.body.points, 10);
});

test('simple Proto and Metro auth works from query strings and JSON bodies', async () => {
  const queryHeartbeat = await json(
    '/social/heartbeat?gamertag=MetroProbe&xuid=proto-metro-probe&status=Metro&titleId=FFFE07D1'
  );
  assert.equal(queryHeartbeat.res.status, 200);
  assert.equal(queryHeartbeat.body.status, 'ok');
  assert.equal(queryHeartbeat.body.gamertag, 'MetroProbe');
  assert.equal(queryHeartbeat.body.titleId, 'FFFE07D1');

  const bodyHeartbeat = await json('/social/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gamertag: 'ProtoProbe',
      xuid: 'proto-body-probe',
      status: 'Proto',
      titleId: '58410954',
    }),
  });
  assert.equal(bodyHeartbeat.res.status, 200);
  assert.equal(bodyHeartbeat.body.status, 'ok');
  assert.equal(bodyHeartbeat.body.gamertag, 'ProtoProbe');

  const xmlHeartbeat = await fetch(
    `${baseUrl}/social/heartbeat?gamertag=XmlProbe&xuid=proto-xml-probe&status=XML`,
    { headers: { Accept: 'application/xml' } }
  );
  assert.equal(xmlHeartbeat.status, 200);
  assert.match(xmlHeartbeat.headers.get('content-type'), /application\/xml/);
  assert.match(await xmlHeartbeat.text(), /<HeartbeatResponse/);

  const online = await json('/social/online');
  assert.equal(online.res.status, 200);
  assert.ok(online.body.online.some(player => player.gamertag === 'MetroProbe'));
  assert.ok(online.body.online.some(player => player.gamertag === 'ProtoProbe'));
});

test('heartbeat updates presence but throttles repeat point awards', async () => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Gamertag': 'Heartbeat',
    'X-XUID': 'web-heartbeat',
  };

  const first = await json('/social/heartbeat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ status: 'Playing', titleId: '4D530919' }),
  });
  assert.equal(first.res.status, 200);
  assert.equal(first.body.famestar.pointsAdded, 1);

  const second = await json('/social/heartbeat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ status: 'Playing', titleId: '4D530919' }),
  });
  assert.equal(second.res.status, 200);
  assert.equal(second.body.famestar.pointsAdded, 0);
  assert.equal(second.body.famestar.reason, 'cooldown');

  const presence = await json('/titles/4D530919/presence');
  assert.equal(presence.res.status, 200);
  assert.equal(presence.body.count, 1);
  assert.equal(presence.body.players[0].gamertag, 'Heartbeat');
});
