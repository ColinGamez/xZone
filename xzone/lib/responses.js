'use strict';

const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&'"]/g, char => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[char]));
}

function sendXml(res, body, statusCode = 200) {
  res.status(statusCode);
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send(`${XML_HEADER}\n${body}`);
}

function sendXmlStatus(res, root, status = 'Success', extra = '') {
  sendXml(
    res,
    `<${root} version="1.0"><Status>${escapeXml(status)}</Status>${extra}</${root}>`
  );
}

function sendXmlError(res, statusCode, status, pathValue) {
  sendXml(
    res,
    `<Error><Status>${escapeXml(status)}</Status><Path>${escapeXml(pathValue)}</Path></Error>`,
    statusCode
  );
}

function wantsXml(req) {
  const accept = String(req.headers.accept || '').toLowerCase();
  const userAgent = String(req.headers['user-agent'] || '').toLowerCase();

  return (
    req.path.toLowerCase().endsWith('.xml') ||
    accept.includes('application/xml') ||
    accept.includes('text/xml') ||
    userAgent.includes('xbox') ||
    userAgent.includes('xenon') ||
    req.headers['x-xbl-contract-version'] != null
  );
}

function xmlName(name) {
  const cleaned = String(name || 'Value').replace(/[^A-Za-z0-9_.-]/g, '');
  if (!cleaned) return 'Value';
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function valueToXml(name, value) {
  const tag = xmlName(name);

  if (value == null) return `<${tag}/>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `<${tag}/>`;
    return `<${tag}>${value.map(item => valueToXml('Item', item)).join('')}</${tag}>`;
  }
  if (typeof value === 'object') {
    return `<${tag}>${Object.entries(value).map(([key, child]) => valueToXml(key, child)).join('')}</${tag}>`;
  }

  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

function sendXmlObject(res, root, value, statusCode = 200) {
  sendXml(res, valueToXml(root, value), statusCode);
}

module.exports = {
  escapeXml,
  sendXml,
  sendXmlStatus,
  sendXmlError,
  sendXmlObject,
  wantsXml,
};
