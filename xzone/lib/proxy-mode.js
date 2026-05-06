'use strict';

function proxyPathFor(targetUrl) {
  const path = `${targetUrl.pathname || '/'}${targetUrl.search || ''}`;
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeProxyRequest(req, res, next) {
  const originalUrl = String(req.url || '');
  if (!/^https?:\/\//i.test(originalUrl)) return next();

  try {
    const target = new URL(originalUrl);
    const normalizedPath = proxyPathFor(target);

    req.xzoneProxy = {
      originalUrl,
      protocol: target.protocol.replace(':', ''),
      host: target.host,
      hostname: target.hostname,
      port: target.port || '',
      path: normalizedPath,
    };
    req.url = normalizedPath;
    req.originalUrl = normalizedPath;
    res.set('X-Xzone-Proxy-Target', target.host);
    return next();
  } catch (err) {
    err.status = 400;
    return next(err);
  }
}

function attachProxyConnectHandler(server) {
  server.on('connect', (req, socket) => {
    const target = String(req.url || 'unknown');
    console.warn(`[proxy] CONNECT ${target} rejected: TLS tunneling is not implemented`);
    socket.write([
      'HTTP/1.1 501 Not Implemented',
      'Content-Type: text/plain; charset=utf-8',
      'Connection: close',
      '',
      'xZone accepts plain HTTP proxy-form requests, but CONNECT/TLS tunneling is not implemented.',
    ].join('\r\n'));
    socket.destroy();
  });

  return server;
}

module.exports = {
  attachProxyConnectHandler,
  normalizeProxyRequest,
};
