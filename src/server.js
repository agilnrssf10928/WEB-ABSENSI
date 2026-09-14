const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const { verifyToken } = require('./utils');
const handleAuthRoutes = require('./routes/auth');
const handleAttendanceRoutes = require('./routes/attendance');
const handleEmployeeRoutes = require('./routes/employees');
const handleLeaveRoutes = require('./routes/leaves');
const handleSettingsRoutes = require('./routes/settings');
const { handleNotificationRoutes } = require('./routes/notifications');
const { handleParentRoutes } = require('./routes/parent');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '../public');
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// Pastikan folder uploads ada (skip on Vercel — filesystem is read-only)
if (process.env.VERCEL !== '1') {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(path.join(UPLOADS_DIR, 'selfies'))) fs.mkdirSync(path.join(UPLOADS_DIR, 'selfies'), { recursive: true });
  if (!fs.existsSync(path.join(UPLOADS_DIR, 'leaves'))) fs.mkdirSync(path.join(UPLOADS_DIR, 'leaves'), { recursive: true });
}

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8'
};

// Helper parsing cookies
function parseCookies(header = '') {
  const list = {};
  header.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      list[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  return list;
}

// Server Utama
async function handleRequest(req, res) {
  try {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // Safety net: kalau ada error tak tertangani, balas 500 JSON (bukan crash function)
  req.on('error', () => {});
  res.on('error', () => {});

  // Response json helper
  res.json = (data, statusCode = 200) => {
    if (res.writableEnded) return true;
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
    return true;
  };

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Autentikasi Pengguna via Bearer Token atau Cookie
  const cookies = parseCookies(req.headers.cookie);
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (cookies.presensi_token) {
    token = cookies.presensi_token;
  }

  const currentUser = token ? verifyToken(token) : null;

  // Baca body untuk POST/PUT
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const buffers = [];
    let size = 0;
    const MAX_SIZE = 30 * 1024 * 1024; // 30MB batas aman untuk foto kamera

    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_SIZE) {
          return res.json({ error: 'Payload terlalu besar (Maksimal 30MB)' }, 413);
        }
        buffers.push(chunk);
      }
      const rawBody = Buffer.concat(buffers).toString('utf8');
      if (rawBody && (req.headers['content-type'] || '').includes('application/json')) {
        req.body = JSON.parse(rawBody);
      } else {
        req.body = {};
      }
    } catch (err) {
      return res.json({ error: 'Format data JSON tidak valid' }, 400);
    }
  } else {
    req.body = {};
  }

  // Handle API Routes
  if (url.pathname.startsWith('/api/')) {
    if (handleAuthRoutes(req, res, url, currentUser) || res.writableEnded) return;
    if (handleAttendanceRoutes(req, res, url, currentUser) || res.writableEnded) return;
    if (handleEmployeeRoutes(req, res, url, currentUser) || res.writableEnded) return;
    if (handleLeaveRoutes(req, res, url, currentUser) || res.writableEnded) return;
    if (handleSettingsRoutes(req, res, url, currentUser) || res.writableEnded) return;
    if (handleNotificationRoutes(req, res, url, currentUser) || res.writableEnded) return;
    if (handleParentRoutes(req, res, url, currentUser) || res.writableEnded) return;

    if (!res.writableEnded) {
      return res.json({ error: `API route ${req.method} ${url.pathname} tidak ditemukan` }, 404);
    }
    return;
  }

  // Static File Serving
  let filePath = '';
  if (url.pathname.startsWith('/uploads/')) {
    filePath = path.join(UPLOADS_DIR, url.pathname.replace('/uploads/', ''));
  } else {
    const sanitizedPath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.join(PUBLIC_DIR, sanitizedPath);
  }

  // Cegah directory traversal
  const isPublicFile = filePath.startsWith(PUBLIC_DIR);
  const isUploadsFile = filePath.startsWith(UPLOADS_DIR);

  if (!isPublicFile && !isUploadsFile) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Access Forbidden');
  }

  // Kirim file sebagai promise agar serverless menunggu stream selesai
  const sendFile = (absPath) =>
    new Promise((resolve, reject) => {
      res.on('close', resolve);
      const stream = fs.createReadStream(absPath);
      stream.on('error', reject);
      stream.pipe(res);
    });

  let stats = null;
  try {
    stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) stats = null;
  } catch (_) {
    stats = null;
  }

  if (!stats) {
    // Fallback ke index.html untuk SPA routing jika bukan file aset
    const ext = path.extname(filePath);
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if ((!ext || ext === '.html') && fs.existsSync(indexPath)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      await sendFile(indexPath);
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('File Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=3600');

  await sendFile(filePath);
  } catch (err) {
    console.error('Unhandled request error:', err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`  Web Absensi Sekolah - Sistem Absensi Online`);
    console.log(`  Server aktif pada: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = handleRequest;
