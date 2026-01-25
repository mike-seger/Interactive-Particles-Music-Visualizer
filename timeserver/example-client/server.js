import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4100);

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
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

function serveStatic(req, res) {
  const safePath = req.url.split('?')[0];
  const normalized = path
    .normalize(safePath === '/' ? '/index.html' : safePath)
    .replace(/^([/\\])+/, '')
    .replace(/^((?:\.\.)(?:[/\\]|$))+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const range = req.headers.range;
    const ct = contentType(filePath);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');

    if (!range) {
      res.writeHead(200, {
        'Content-Type': ct,
        'Content-Length': stat.size,
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : stat.size - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      res.writeHead(416, {
        'Content-Range': `bytes */${stat.size}`,
      });
      res.end();
      return;
    }

    res.writeHead(206, {
      'Content-Type': ct,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // Simple CORS for local dev (serving static only).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[example-client] Listening on http://localhost:${PORT}`);
});
