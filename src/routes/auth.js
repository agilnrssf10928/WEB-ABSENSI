const { db } = require('../db');
const { verifyPassword, createToken } = require('../utils');

function handleAuthRoutes(req, res, url, user) {
  // POST /api/auth/login
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.json({ error: 'Email dan password wajib diisi' }, 400);
    }

    // Login bisa pakai email ATAU username (kolom nip)
    const found = db.prepare('SELECT * FROM users WHERE (email = ? OR nip = ?) AND is_active = 1').get(email, email);
    if (!found) {
      return res.json({ error: 'Email atau password salah' }, 401);
    }

    const isValid = verifyPassword(password, found.password_hash);
    if (!isValid) {
      return res.json({ error: 'Email atau password salah' }, 401);
    }

    const token = createToken({
      id: found.id,
      nip: found.nip,
      name: found.name,
      email: found.email,
      role: found.role
    });

    const userData = {
      id: found.id,
      nip: found.nip,
      name: found.name,
      email: found.email,
      role: found.role,
      department: found.department,
      position: found.position,
      phone: found.phone,
      avatar: found.avatar
    };

    // Sertakan pengaturan sekolah supaya cache lokal di klien langsung terisi
    // data terbaru (dan tampilan tidak sempat memakai nilai default).
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() || null;

    res.setHeader('Set-Cookie', `presensi_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return res.json({
      success: true,
      message: 'Login berhasil',
      token,
      user: userData,
      settings
    });
  }

  // GET /api/auth/me
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    if (!user) {
      return res.json({ error: 'Unauthorized' }, 401);
    }
    const found = db.prepare('SELECT id, nip, name, email, role, department, position, phone, avatar FROM users WHERE id = ?').get(user.id);
    if (!found) {
      return res.json({ error: 'User tidak ditemukan' }, 404);
    }
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() || null;
    return res.json({ success: true, user: found, settings });
  }

  // POST /api/auth/logout
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    res.setHeader('Set-Cookie', 'presensi_token=; Path=/; HttpOnly; Max-Age=0');
    return res.json({ success: true, message: 'Berhasil logout' });
  }

  return false;
}

module.exports = handleAuthRoutes;
