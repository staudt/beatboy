// Static server for e2e tests: serves $DIST_DIR (default ./dist) under /beatboy/ to mimic GitHub Pages.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.DIST_DIR || 'dist');
const BASE = '/beatboy/';
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(302, { Location: BASE });
    res.end();
    return;
  }

  if (!url.pathname.startsWith(BASE)) {
    notFound(res);
    return;
  }

  let rel = decodeURIComponent(url.pathname.slice(BASE.length));
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';

  const filePath = path.join(ROOT, rel);
  // Guard against path traversal.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    notFound(res);
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return notFound(res);
    const type = TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch {
    notFound(res);
  }
});

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}${BASE}`);
});
