'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, 'public');

const API_ROUTES = {
  '/api/health': require('./api/health'),
  '/api/auth/configure': require('./api/auth/configure'),
  '/api/auth/google': require('./api/auth/google'),
  '/api/auth/callback': require('./api/auth/callback'),
  '/api/auth/session': require('./api/auth/session'),
  '/api/auth/logout': require('./api/auth/logout'),
  '/api/drive/videos': require('./api/drive/videos'),
  '/api/drive/stream': require('./api/drive/stream'),
  '/api/upload/init': require('./api/upload/init'),
  '/api/upload/chunk': require('./api/upload/chunk'),
  '/api/upload/complete': require('./api/upload/complete')
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function createAppServer() {
  return http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = parsedUrl.pathname;

    // API routes
    if (pathname in API_ROUTES) {
      try {
        await API_ROUTES[pathname](req, res);
      } catch (err) {
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
        }
      }
      return;
    }

    if (pathname.startsWith('/api/')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'API route not found' }));
      return;
    }

    // Static files from public/
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const normalized = path.normalize(safePath).replace(/^(\.\.(\/|\\|$))+/, '');
    let filePath = path.join(PUBLIC_DIR, normalized);

    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`Drive2Tube Studio listening on http://${host}:${port}`);
  });
}

module.exports = { createAppServer };
