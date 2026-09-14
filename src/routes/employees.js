const { db } = require('../db');
const { hashPassword } = require('../utils');

function handleEmployeeRoutes(req, res, url, user) {
  // GET /api/employees (Daftar Siswa & Guru — khusus Guru & Admin saja)
  if (req.method === 'GET' && url.pathname === '/api/employees') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);
    if (user.role === 'student') {
      return res.json({ error: 'Akses ditolak. Data warga sekolah hanya bisa dilihat Guru & Admin.' }, 403);
    }

    const role = url.searchParams.get('role');
    const department = url.searchParams.get('department');

    let query = `
      SELECT id, nip, name, email, role, department, position, phone, avatar, is_active, created_at
      FROM users
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }
    if (department) {
      query += ' AND department = ?';
      params.push(department);
    }

    query += ' ORDER BY role ASC, department ASC, name ASC';

    const list = db.prepare(query).all(...params);
    return res.json({ success: true, employees: list });
  }

  // POST /api/employees (Tambah Siswa / Guru baru oleh Admin)
  if (req.method === 'POST' && url.pathname === '/api/employees') {
    if (!user || user.role !== 'admin') {
      return res.json({ error: 'Akses ditolak. Khusus Admin Sekolah.' }, 403);
    }

    const { nip, name, email, password, department, position, phone, role = 'student', child_nip, entry_year } = req.body || {};

    if (!nip || !name || !email || !password) {
      return res.json({ error: 'NISN / NIP, Nama, Email, dan Password wajib diisi.' }, 400);
    }

    const existingNip = db.prepare('SELECT id FROM users WHERE nip = ?').get(nip);
    if (existingNip) return res.json({ error: 'NISN / NIP sudah terdaftar.' }, 400);

    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingEmail) return res.json({ error: 'Email sudah terdaftar.' }, 400);

    const insert = db.prepare(`
      INSERT INTO users (nip, name, email, password_hash, role, department, position, phone, entry_year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      nip,
      name,
      email,
      hashPassword(password),
      role,
      department || 'Umum',
      position || (role === 'student' ? 'Siswa' : role === 'parent' ? 'Orang Tua / Wali' : 'Guru'),
      phone || '',
      entry_year != null && entry_year !== '' ? Number(entry_year) : null
    );

    // Kalau akun orang tua, hubungkan dengan anak (siswa) via NISN
    const parentId = result.lastInsertRowid;
    if (role === 'parent' && child_nip) {
      const child = db.prepare("SELECT id FROM users WHERE nip = ? AND role = 'student'").get(child_nip);
      if (child) {
        db.prepare('INSERT OR IGNORE INTO parent_children (parent_user_id, student_user_id) VALUES (?, ?)').run(parentId, child.id);
      }
    }

    const created = db.prepare('SELECT id, nip, name, email, role, department, position, phone, is_active FROM users WHERE id = ?').get(parentId);
    return res.json({ success: true, message: 'Data warga sekolah berhasil ditambahkan.', employee: created });
  }

  // PUT /api/employees/:id
  const putMatch = url.pathname.match(/^\/api\/employees\/(\d+)$/);
  if (req.method === 'PUT' && putMatch) {
    if (!user || user.role !== 'admin') {
      return res.json({ error: 'Akses ditolak.' }, 403);
    }

    const targetId = Number(putMatch[1]);
    const { name, email, department, position, phone, role, password, is_active, child_nip, entry_year } = req.body || {};

    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return res.json({ error: 'Data tidak ditemukan.' }, 404);

    if (email && email !== target.email) {
      const emailExists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, targetId);
      if (emailExists) return res.json({ error: 'Email sudah digunakan akun lain.' }, 400);
    }

    let passwordHash = target.password_hash;
    if (password && password.trim().length > 0) {
      passwordHash = hashPassword(password);
    }

    db.prepare(`
      UPDATE users
      SET name = ?, email = ?, department = ?, position = ?, phone = ?, role = ?, password_hash = ?, is_active = ?, entry_year = ?
      WHERE id = ?
    `).run(
      name || target.name,
      email || target.email,
      department != null ? department : target.department,
      position != null ? position : target.position,
      phone != null ? phone : target.phone,
      role || target.role,
      passwordHash,
      is_active != null ? Number(is_active) : target.is_active,
      entry_year != null && entry_year !== '' ? Number(entry_year) : (entry_year === '' ? null : target.entry_year),
      targetId
    );

    // Update tautan orang tua-anak bila dikirim
    if ((role || target.role) === 'parent' && child_nip) {
      const child = db.prepare("SELECT id FROM users WHERE nip = ? AND role = 'student'").get(child_nip);
      if (child) {
        db.prepare('INSERT OR IGNORE INTO parent_children (parent_user_id, student_user_id) VALUES (?, ?)').run(targetId, child.id);
      }
    }

    const updated = db.prepare('SELECT id, nip, name, email, role, department, position, phone, is_active, entry_year, avatar FROM users WHERE id = ?').get(targetId);
    return res.json({ success: true, message: 'Data berhasil diperbarui.', employee: updated });
  }

  // DELETE /api/employees/:id
  const delMatch = url.pathname.match(/^\/api\/employees\/(\d+)$/);
  if (req.method === 'DELETE' && delMatch) {
    if (!user || user.role !== 'admin') {
      return res.json({ error: 'Akses ditolak.' }, 403);
    }

    const targetId = Number(delMatch[1]);
    if (targetId === user.id) {
      return res.json({ error: 'Anda tidak dapat menghapus akun Anda sendiri.' }, 400);
    }

    db.prepare('DELETE FROM attendances WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM leave_requests WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM parent_children WHERE parent_user_id = ? OR student_user_id = ?').run(targetId, targetId);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

    return res.json({ success: true, message: 'Data berhasil dihapus.' });
  }

  return false;
}

module.exports = handleEmployeeRoutes;
