const express = require('express');
const router  = express.Router();
const path    = require('path');
const { appendRequestLog } = require('../lib/request-log');
const { escapeXml, sendXml } = require('../lib/responses');
const config = require('../config');

const LOG_FILE = path.join(config.logging.dir, 'avatar-requests.log');

router.use((req, res, next) => {
  appendRequestLog(LOG_FILE, req, { includeHeaders: true, includeBody: true });
  console.log(`[avatar] ${req.method} ${req.originalUrl}`);
  next();
});

// ── XML helper ────────────────────────────────────────────────
// NXE is an Xbox 360 era dashboard — it expects XML from Xbox Live
// services, not JSON. Sending JSON causes the blade to silently do
// nothing. All responses here are XML.
function xmlRes(res, body) {
  sendXml(res, body);
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ── Avatar Editor manifest ────────────────────────────────────
// NXE requests this first when opening the Avatar Editor blade.
// Returns a valid-looking manifest so the editor knows the service
// is reachable and can proceed to load the item catalog.
router.get('/manifest', (req, res) => {
  const base = baseUrl(req);
  xmlRes(res, `
<AvatarManifest version="1.0" xmlns="http://schemas.microsoft.com/xbox/2009/avatar">
  <Status>Success</Status>
  <ServiceVersion>1.0.0</ServiceVersion>
  <CatalogVersion>1</CatalogVersion>
  <AssetCatalogUrl>${escapeXml(base)}/avatar/assets</AssetCatalogUrl>
  <ItemCatalogUrl>${escapeXml(base)}/avatar/items</ItemCatalogUrl>
</AvatarManifest>`.trim());
});

// ── Avatar item catalog ───────────────────────────────────────
// The full list of available avatar items.
// Roadmap: populate this from extracted STFS item metadata under
// HDD:\Content\0000000000000000\FFFE07D1\00020000\.
router.get('/items', (req, res) => {
  xmlRes(res, `
<AvatarItems version="1.0" xmlns="http://schemas.microsoft.com/xbox/2009/avatar">
  <Status>Success</Status>
  <TotalItems>0</TotalItems>
  <Items/>
</AvatarItems>`.trim());
});

// ── Avatar asset catalog ──────────────────────────────────────
router.get('/assets', (req, res) => {
  xmlRes(res, `
<AvatarAssets version="1.0" xmlns="http://schemas.microsoft.com/xbox/2009/avatar">
  <Status>Success</Status>
  <Assets/>
</AvatarAssets>`.trim());
});

// ── Awards / unlocks ──────────────────────────────────────────
router.get('/awards', (req, res) => {
  xmlRes(res, `
<AvatarAwards version="1.0" xmlns="http://schemas.microsoft.com/xbox/2009/avatar">
  <Status>Success</Status>
  <Awards/>
</AvatarAwards>`.trim());
});

// ── Body type / default avatar data ──────────────────────────
// Some versions of NXE request this to render a default avatar
// before the editor fully loads
router.get('/body', (req, res) => {
  xmlRes(res, `
<AvatarBody version="1.0" xmlns="http://schemas.microsoft.com/xbox/2009/avatar">
  <Status>Success</Status>
  <BodyType>Male</BodyType>
</AvatarBody>`.trim());
});

// ── Catch-all — XML 200 so nothing hangs ─────────────────────
// Any path we haven't explicitly handled still gets a valid XML
// response so NXE doesn't sit on a spinner forever waiting for
// a reply. The log above tells us what the unhandled path was.
router.all('*', (req, res) => {
  xmlRes(res, `
<Response version="1.0" xmlns="http://schemas.microsoft.com/xbox/2009/avatar">
  <Status>Success</Status>
</Response>`.trim());
});

module.exports = router;
