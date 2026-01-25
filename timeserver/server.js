/*
 * Lightweight time sync server with Server-Sent Events (SSE).
 * No runtime dependencies beyond Node built-ins. Serves a tiny admin UI.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, 'state.json');
const TICK_MS = 500;

const state = loadState();
const clients = new Map();
let clientSeq = 0;

function nowMs() {
  return Date.now();
}

function loadState() {
  const base = { offsetMs: 0, running: false, startAt: null, detached: false };
  if (!fs.existsSync(STATE_FILE)) return { ...base };
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Persisted startAt is not reliable after a restart; always restart paused.
    return { ...base, ...parsed, running: false, startAt: null, detached: false };
  } catch (err) {
    console.warn('[timeserver] Could not read state.json; starting fresh', err.message);
    return { ...base };
  }
}

function currentTimeMs() {
  if (!state.running || !state.startAt) return state.offsetMs;
  return state.offsetMs + (nowMs() - state.startAt);
}

function setRunning(on) {
  if (state.detached) return;
  if (on) {
    if (!state.running) {
      state.startAt = nowMs();
      state.running = true;
    }
    return;
  }
  state.offsetMs = currentTimeMs();
  state.running = false;
  state.startAt = null;
}

function setOffset(ms) {
  if (state.detached) return;
  const next = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  state.offsetMs = next;
  if (state.running) state.startAt = nowMs();
}

function resetClock() {
  setOffset(0);
}

function serializeState() {
  return {
    timeMs: currentTimeMs(),
    running: state.running,
    offsetMs: state.offsetMs,
    detached: state.detached,
    serverNowMs: nowMs(),
  };
}

function saveState() {
  const payload = { offsetMs: currentTimeMs(), running: false, detached: false };
  fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function loadPersisted() {
  const loaded = loadState();
  state.offsetMs = loaded.offsetMs;
  setRunning(false);
  state.detached = false;
  return serializeState();
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function handleOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      // Hard limit to avoid abuse.
      if (data.length > 1e6) {
        req.connection.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        resolve({});
      }
    });
  });
}

function handleControl(body, query) {
  const action = body.action || query?.action;
  if (!action) return { ok: false, error: 'Missing action' };

  switch (action) {
    case 'start':
      setRunning(true);
      break;
    case 'pause':
      setRunning(false);
      break;
    case 'reset':
      resetClock();
      break;
    case 'jump':
      setOffset(Number(body.offsetMs));
      break;
    case 'detach':
      state.detached = true;
      // Close all client connections.
      for (const res of clients.keys()) {
        try {
          res.end();
        } catch (err) {
          // ignore
        }
      }
      clients.clear();
      break;
    case 'attach':
      state.detached = false;
      break;
    default:
      return { ok: false, error: `Unknown action: ${action}` };
  }

  return { ok: true, state: serializeState() };
}

function handleSse(req, res, parsedUrl) {
  if (state.detached) {
    return sendJson(res, 409, { error: 'Server detached' });
  }

  const name = (parsedUrl.searchParams.get('name') || '').toString().slice(0, 64).trim();
  if (!name) {
    return sendJson(res, 400, { error: 'Missing client name' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const initial = JSON.stringify(serializeState());
  res.write(`data: ${initial}\n\n`);

  let siteHost = (parsedUrl.searchParams.get('pageHost') || parsedUrl.searchParams.get('host') || '').toString().slice(0, 256).trim();
  let sitePort = (parsedUrl.searchParams.get('pagePort') || parsedUrl.searchParams.get('port') || '').toString().slice(0, 16).trim();

  if (!siteHost || !sitePort) {
    const ref = req.headers.referer || req.headers.referrer;
    if (ref) {
      try {
        const refUrl = new URL(ref);
        if (!siteHost) siteHost = refUrl.hostname.slice(0, 256);
        if (!sitePort) sitePort = (refUrl.port || (refUrl.protocol === 'https:' ? '443' : '80')).slice(0, 16);
      } catch (err) {
        // ignore bad referer
      }
    }
  }

  const ip = siteHost || req.socket?.remoteAddress || 'unknown';
  const port = sitePort || req.socket?.remotePort || null;

  const id = ++clientSeq;
  const info = {
    id,
    name,
    ip,
    port,
    siteHost,
    sitePort,
    ua: req.headers['user-agent'] || '',
    connectedAt: Date.now(),
  };
  clients.set(res, info);

  req.on('close', () => {
    clients.delete(res);
  });
}

function broadcast() {
  if (!clients.size || state.detached) return;
  const payload = `data: ${JSON.stringify(serializeState())}\n\n`;
  for (const res of clients.keys()) {
    res.write(payload);
  }
}

function serveStatic(pathname, res) {
  const safeSuffix = pathname === '/' ? '/index.html' : pathname;
  const normalized = path
    .normalize(safeSuffix)
    .replace(/^([/\\])+/, '')
    .replace(/^(\.\.(?:[/\\]|$))+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname || '/';

  if (req.method === 'OPTIONS') return handleOptions(res);
  if (pathname === '/api/events') return handleSse(req, res, parsed);
  if (pathname === '/api/state') return sendJson(res, 200, serializeState());
  if (pathname === '/api/clients') {
    const list = Array.from(clients.values()).map((c) => ({
      id: c.id,
      name: c.name,
      ip: c.ip,
      port: c.port,
      host: c.siteHost || c.ip,
      hostPort: c.sitePort || c.port,
      ua: c.ua,
      connectedAt: c.connectedAt,
    }));
    return sendJson(res, 200, { clients: list, detached: state.detached });
  }

  if (pathname === '/api/control' && req.method === 'POST') {
    const body = await readBody(req);
    const result = handleControl(body, parsed.searchParams ? Object.fromEntries(parsed.searchParams) : {});
    if (result.ok) broadcast();
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (pathname === '/api/save' && req.method === 'POST') {
    const payload = saveState();
    broadcast();
    return sendJson(res, 200, { ok: true, saved: payload });
  }

  if (pathname === '/api/load' && req.method === 'POST') {
    const fresh = loadPersisted();
    broadcast();
    return sendJson(res, 200, { ok: true, state: fresh });
  }

  return serveStatic(pathname, res);
});

setInterval(broadcast, TICK_MS);

server.listen(PORT, () => {
  console.log(`[timeserver] Listening on http://localhost:${PORT}`);
});
