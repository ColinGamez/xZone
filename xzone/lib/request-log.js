'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

const REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

function redactHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    REDACTED_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value,
  ]));
}

function stringifyBody(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (Object.keys(body).length === 0) return '';
  return JSON.stringify(body);
}

function truncate(value) {
  const text = String(value ?? '');
  if (text.length <= config.logging.maxBodyChars) return text;
  return `${text.slice(0, config.logging.maxBodyChars)}...[truncated]`;
}

function formatEntry(req, options = {}) {
  const record = buildRecord(req, options);
  const lines = [
    '============================================================',
    `[${record.timestamp}] ${record.method} ${record.originalUrl}`,
  ];

  if (record.statusCode) lines.push(`Status: ${record.statusCode}`);
  if (record.durationMs != null) lines.push(`Duration: ${record.durationMs}ms`);
  if (record.ip) lines.push(`IP: ${record.ip}`);

  if (record.headers) {
    lines.push(`Headers: ${JSON.stringify(record.headers, null, 2)}`);
  }

  if (record.body) lines.push(`Body: ${record.body}`);

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildRecord(req, options = {}) {
  const fullPath = String(req.originalUrl || req.url || req.path || '/').split('?')[0] || '/';
  const record = {
    requestId: req.id,
    timestamp: new Date().toISOString(),
    method: req.method,
    originalUrl: req.originalUrl,
    path: fullPath,
    query: req.query || {},
    statusCode: options.statusCode,
    durationMs: options.durationMs,
    ip: req.ip,
  };

  if (options.includeHeaders) record.headers = redactHeaders(req.headers);
  if (options.includeBody) {
    const body = truncate(stringifyBody(req.body));
    if (body) record.body = body;
  }

  return record;
}

function jsonlPathFor(file) {
  const parsed = path.parse(file);
  return path.join(parsed.dir, `${parsed.name}.jsonl`);
}

function appendRequestLog(file, req, options = {}) {
  if (!config.logging.enabled) return;

  const record = buildRecord(req, options);

  fs.promises.mkdir(path.dirname(file), { recursive: true })
    .then(() => Promise.all([
      fs.promises.appendFile(file, formatEntry(req, options)),
      fs.promises.appendFile(jsonlPathFor(file), `${JSON.stringify(record)}\n`),
    ]))
    .catch(err => {
      console.error(`[log] Failed to write ${file}:`, err.message);
    });
}

module.exports = { appendRequestLog, buildRecord, jsonlPathFor };
