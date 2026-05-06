const express = require('express');
const router  = express.Router();
const path    = require('path');
const { appendRequestLog } = require('../lib/request-log');
const { escapeXml, sendXml, wantsXml } = require('../lib/responses');
const config = require('../config');

const LOG_FILE = path.join(config.logging.dir, 'marketplace-requests.log');

// Log every incoming marketplace request before routing
router.use((req, res, next) => {
  appendRequestLog(LOG_FILE, req, { includeHeaders: true, includeBody: true });
  console.log(`[marketplace] ${req.method} ${req.originalUrl}`);
  next();
});

function sendMarketplace(req, res, payload) {
  if (!wantsXml(req)) return res.json(payload);

  const total = Number(payload.total || payload.items?.length || payload.deals?.length || 0);
  const page = Number(payload.page || 1);
  const collection = payload.deals ? 'Deals' : 'Items';

  sendXml(res, `
<MarketplaceResponse version="1.0">
  <Status>${escapeXml(payload.status || 'ok')}</Status>
  <Total>${escapeXml(total)}</Total>
  <Page>${escapeXml(page)}</Page>
  <${collection}/>
</MarketplaceResponse>`.trim());
}

router.get('/featured', (req, res) => {
  sendMarketplace(req, res, { items: [], total: 0, page: 1 });
});

router.get('/browse', (req, res) => {
  sendMarketplace(req, res, { items: [], total: 0, page: 1 });
});

router.get('/deals', (req, res) => {
  sendMarketplace(req, res, { deals: [] });
});

router.get('/new', (req, res) => {
  sendMarketplace(req, res, { items: [], total: 0 });
});

// Catch-all — log and return valid empty response
router.all('*', (req, res) => {
  sendMarketplace(req, res, { status: 'ok', items: [], total: 0 });
});

module.exports = router;
