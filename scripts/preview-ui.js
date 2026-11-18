#!/usr/bin/env node
// DEV ONLY. Serves public/ on http://localhost:3902 so the voice console's layout and its
// empty / error states can be checked in a real browser before the Sahay server exists.
// It never invents data:
//   node scripts/preview-ui.js            -> every /api/* call fails with 503 (error states)
//   node scripts/preview-ui.js --empty    -> /api/session and /api/state answer with empty
//                                            lists, /api/events is an open stream that sends
//                                            no events (empty states). Voice calls still fail.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PREVIEW_PORT || 3902);
const ROOT = path.resolve(__dirname, '..', 'public');
const EMPTY = process.argv.includes('--empty');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function api(req, res, pathname) {
  if (!EMPTY) {
    return json(res, 503, { code: 'preview_no_server', message: 'Preview mode: the Sahay server is not running.' });
  }
  if (req.method === 'POST' && pathname === '/api/session') return json(res, 200, {});
  if (req.method === 'GET' && pathname === '/api/state') {
    return json(res, 200, { requirement: null, jobs: [], vendors: [], deals: [], approvals: [], orders: [], audit: [] });
  }
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': preview stream, no events\n\n');
    const t = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    req.on('close', () => clearInterval(t));
    return undefined;
  }
  return json(res, 503, { code: 'preview_no_server', message: 'Preview mode: voice and actions need the Sahay server.' });
}

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400).end(); return; }
  if (pathname.startsWith('/api/')) return api(req, res, pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  return serveStatic(res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sahay UI preview (${EMPTY ? 'empty' : 'no server'} mode): http://localhost:${PORT}`);
});
