// ========================================================
// Web Absensi Sekolah - Server (Express.js + SQLite)
// ========================================================

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ========================================================
// DATABASE INITIALIZATION
// ========================================================

const db = new Database('./database.sqlite');
db.pragma('journal_mode = WAL');

// ========================================================
// SESSION MIDDLEWARE (Session Persistence Fix)
// ========================================================

// Pastikan folder sessions ada
if (!fs.existsSync('./sessions')) {
  fs.mkdirSync('./sessions', { recursive: true });
}

const sessionMiddleware = session({
  store: new FileStore({
    path: './sessions',
    ttl: 86400 * 7, // 7 hari
    reapInterval: 3600 // cleanup tiap 1 jam
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-key-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'sessionId',
  cookie: {
    httpOnly: true, // 🔒 Proteksi dari XSS
    secure: process.env.NODE_ENV === 'production', // HTTPS only di prod
    sameSite: 'lax', // CSRF protection
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 hari
  }
});

app.use(sessionMiddleware);

// ========================================================
// MIDDLEWARE
// ========================================================

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// ========================================================
// HELPER FUNCTIONS
// ========================================================

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

function getSettings() {
  try {
    return db.prepare('SELECT * FROM office_settings LIMIT 1').get();
  } catch (e) {
    console.error('Error getting settings:', e);
    return null;
  }
}

// ========================================================
// AUTH ENDPOINTS
// ========================================================

// ===== POST /api/auth/login =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email dan password wajib diisi' });
    }

    // Ambil user dari database
    const user = db.prepare(
      'SELECT id, email, password, name, role, nip, department FROM users WHERE email = ? LIMIT 1'
    ).get(email);

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ success: false, error: 'Email atau password salah' });
    }

    // ✅ Load settings (Session Persistence Fix)
    const settings = getSettings();

    // ✅ Save ke session
    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      nip: user.nip,
      department: user.department
    };
    req.session.officeSettings = settings;

    console.log(`✅ User logged in: ${user.email}`);

    // 💾 Return user & settings
    res.json({
      success: true,
      user: req.session.user,
      settings: settings
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ===== GET /api/auth/me (Session Persistence Fix) =====
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.userId && req.session.user) {
    // ✅ Return settings juga!
    res.json({
      success: true,
      user: req.session.user,
      settings: req.session.officeSettings
    });
  } else {
    res.status(401).json({ success: false, error: 'Not authenticated' });
  }
});

// ===== POST /api/auth/logout =====
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.clearCookie('sessionId');
    res.json({ success: true });
  });
});

// ========================================================
// SETTINGS ENDPOINTS
// ========================================================

// ===== GET /api/settings (Session Persistence Fix) =====
app.get('/api/settings', (req, res) => {
  try {
    // ✅ Cek session cache dulu (lebih cepat)
    if (req.session && req.session.officeSettings) {
      console.log('📦 Settings from session cache');
      return res.json({ success: true, settings: req.session.officeSettings });
    }

    // Ambil dari database
    const settings = getSettings();

    // Cache ke session
    if (req.session) {
      req.session.officeSettings = settings;
    }

    console.log('📦 Settings from database');
    res.json({ success: true, settings });
  } catch (err) {
    console.error('❌ Settings error:', err);
    res.status(500).json({ success: false, error: 'Failed to load settings' });
  }
});

// ===== PUT /api/settings (Update Settings) =====
app.put('/api/settings', (req, res) => {
  try {
    // Check auth
    if (req.session?.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const {
      office_name,
      office_lat,
      office_lng,
      office_radius_meters,
      time_in,
      time_out,
      tolerance_minutes
    } = req.body;

    // Update database
    db.prepare(`
      UPDATE office_settings SET
        office_name = ?,
        office_lat = ?,
        office_lng = ?,
        office_radius_meters = ?,
        time_in = ?,
        time_out = ?,
        tolerance_minutes = ?,
        updated_at = datetime('now')
      WHERE id = 1
    `).run(
      office_name,
      office_lat,
      office_lng,
      office_radius_meters,
      time_in,
      time_out,
      tolerance_minutes
    );

    // ✅ Update session cache (Session Persistence Fix)
    const updated = getSettings();
    if (req.session) {
      req.session.officeSettings = updated;
    }

    console.log('✅ Settings updated');
    res.json({ success: true, settings: updated });
  } catch (err) {
    console.error('❌ Settings update error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================================
// ATTENDANCE ENDPOINTS
// ========================================================

// ===== POST /api/attendance/clock-in =====
app.post('/api/attendance/clock-in', (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { lat, lng, distance, qr_code } = req.body;
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Check if already clocked in today
    const existing = db.prepare(
      'SELECT id FROM attendance WHERE user_id = ? AND date = ? AND clock_in IS NOT NULL LIMIT 1'
    ).get(userId, today);

    if (existing) {
      return res.status(400).json({ success: false, error: 'Sudah absen masuk hari ini' });
    }

    // Insert attendance
    const stmt = db.prepare(`
      INSERT INTO attendance (user_id, date, clock_in, lat_in, lng_in, distance_in, status)
      VALUES (?, ?, datetime('now', 'localtime'), ?, ?, ?, ?)
    `);

    const now = new Date();
    const settings = req.session.officeSettings || getSettings();
    const timeIn = settings?.time_in || '07:00';
    const tolerance = (settings?.tolerance_minutes || 15) * 60000;
    const timeInMs = new Date(`2000-01-01T${timeIn}`).getTime();
    const nowMs = new Date(`2000-01-01T${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`).getTime();
    
    const status = nowMs <= timeInMs + tolerance ? 'present' : 'late';

    stmt.run(userId, today, lat, lng, distance, status);

    res.json({ success: true, message: 'Absen masuk berhasil', status });
  } catch (err) {
    console.error('❌ Clock-in error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST /api/attendance/clock-out =====
app.post('/api/attendance/clock-out', (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { lat, lng, distance } = req.body;
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Update attendance
    const stmt = db.prepare(`
      UPDATE attendance 
      SET clock_out = datetime('now', 'localtime'), lat_out = ?, lng_out = ?, distance_out = ?
      WHERE user_id = ? AND date = ? AND clock_in IS NOT NULL
    `);

    const result = stmt.run(lat, lng, distance, userId, today);

    if (result.changes === 0) {
      return res.status(400).json({ success: false, error: 'Belum absen masuk hari ini' });
    }

    res.json({ success: true, message: 'Absen pulang berhasil' });
  } catch (err) {
    console.error('❌ Clock-out error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========================================================
// NOTIFICATION ENDPOINTS
// ========================================================

app.get('/api/notifications', (req, res) => {
  try {
    if (!req.session?.user) {
      return res.json({ success: true, notifications: [], unread: 0 });
    }

    const notifications = db.prepare(`
      SELECT * FROM notifications 
      WHERE (user_id = ? OR user_id IS NULL)
      ORDER BY created_at DESC 
      LIMIT 20
    `).all(req.session.user.id);

    const unread = db.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(req.session.user.id).count;

    res.json({ success: true, notifications, unread });
  } catch (err) {
    res.json({ success: true, notifications: [], unread: 0 });
  }
});

app.post('/api/notifications/read', (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ success: false });
    }

    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.user.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// ========================================================
// PARENT PORTAL ENDPOINTS
// ========================================================

app.get('/api/parent/children', (req, res) => {
  try {
    if (!req.session?.user) {
      return res.status(401).json({ success: false });
    }

    const children = db.prepare(`
      SELECT u.id, u.name, u.nip as nisn, u.department, 
             a1.clock_in, a1.clock_out, a1.status
      FROM users u
      LEFT JOIN attendance a1 ON u.id = a1.user_id AND a1.date = date('now')
      WHERE u.parent_id = ?
    `).all(req.session.user.id);

    res.json({ success: true, children });
  } catch (err) {
    res.json({ success: false });
  }
});

app.get('/api/parent/children/:childId/history', (req, res) => {
  try {
    const { childId } = req.params;
    const { month } = req.query; // YYYY-MM format

    const attendances = db.prepare(`
      SELECT date, clock_in, clock_out, status
      FROM attendance
      WHERE user_id = ? AND strftime('%Y-%m', date) = ?
      ORDER BY date DESC
    `).all(childId, month);

    res.json({ success: true, attendances });
  } catch (err) {
    res.json({ success: false });
  }
});

// ========================================================
// FALLBACK ROUTE
// ========================================================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================================
// SERVER START
// ========================================================

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║  🎓 Web Absensi Sekolah - Server Running ║
  ║                                          ║
  ║  📍 http://localhost:${PORT}                  ║
  ║  🔒 Session: FileStore (7 hari)          ║
  ║  💾 Database: SQLite                     ║
  ╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
