'use strict';

const express = require('express');
const config = require('../config');
const { escapeXml, sendXml } = require('../lib/responses');

const router = express.Router();

function probePayload(req) {
  return {
    service: config.serviceName,
    version: config.serviceVersion,
    status: 'ok',
    time: new Date().toISOString(),
    requestId: req.id,
    remoteAddress: req.ip || req.socket.remoteAddress || '',
    simpleAuth: config.auth.allowSimpleAuth,
  };
}

router.get(['/probe', '/probe.json'], (req, res) => {
  res.json(probePayload(req));
});

router.get('/probe.txt', (req, res) => {
  const payload = probePayload(req);
  res.type('text/plain').send([
    'xZone OK',
    `service=${payload.service}`,
    `version=${payload.version}`,
    `time=${payload.time}`,
    `requestId=${payload.requestId}`,
    `simpleAuth=${payload.simpleAuth}`,
  ].join('\n'));
});

router.get('/probe.xml', (req, res) => {
  const payload = probePayload(req);
  sendXml(
    res,
    `<ProbeResponse version="1.0">` +
      `<Status>${escapeXml(payload.status)}</Status>` +
      `<Service>${escapeXml(payload.service)}</Service>` +
      `<Version>${escapeXml(payload.version)}</Version>` +
      `<Time>${escapeXml(payload.time)}</Time>` +
      `<RequestId>${escapeXml(payload.requestId)}</RequestId>` +
      `<SimpleAuth>${payload.simpleAuth ? 'true' : 'false'}</SimpleAuth>` +
    '</ProbeResponse>'
  );
});

router.all('/probe/echo', (req, res) => {
  res.json({
    ...probePayload(req),
    method: req.method,
    originalUrl: req.originalUrl,
    query: req.query,
    bodyType: typeof req.body,
    body: typeof req.body === 'string' ? req.body.slice(0, 2000) : req.body,
  });
});

module.exports = router;
