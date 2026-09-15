const { db } = require('../db');
const { hashPassword } = require('../utils');

function handleEmployeeRoutes(req, res, url, user) {
  // GET /api/employees (Daftar Siswa & Guru — khusus Guru & Admin saja)
  if (req.method === 'GET' && url.pathname === '/api/employees') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);
    if (user.role === 'student' || user.role === 'parent') {
      return res.json({ error: 'Akses ditolak. Daftar & QR kartu murid hanya bisa dilihat Guru & Admin.' }, 403);
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

    if (!name || !email || !password) {
      return res.json({ error: 'Nama, Email, dan Password wajib diisi.' }, 400);
    }

    const isParent = role === 'parent';
    let finalNip = nip && String(nip).trim() ? String(nip).trim() : '';
    let childNip = child_nip && String(child_nip).trim() ? String(child_nip).trim() : '';
    let childUser = null;

    // --- Akun ORANG TUA: dihubungkan ke anak HANYA lewat NISN anak ---
    if (isParent) {
      // Kalau admin menaruh NISN anak di kolom NISN/NIP (kolom yang biasa diisi),
      // pindahkan otomatis jadi data tautan anak — bukan dibenturkan sebagai
      // "NISN / NIP sudah terdaftar".
      if (!childNip && finalNip) {
        const asChild = db.prepare("SELECT id, name FROM users WHERE nip = ? AND role = 'student'").get(finalNip);
        if (asChild) {
          childUser = asChild;
          childNip = finalNip;
          finalNip = '';
        }
      }

      // Cari anak berdasarkan NISN yang diberikan
      if (!childUser && childNip) {
        childUser = db.prepare("SELECT id, name FROM users WHERE nip = ? AND role = 'student'").get(childNip);
        if (!childUser) {
          return res.json({
            error: `NISN anak "${childNip}" tidak ditemukan. Pastikan akun siswa sudah terdaftar dulu.`
          }, 400);
        }
      }

      // NISN/NIP milik orang tua bersifat opsional dan dibuat otomatis.
      // Kalau yang diisi ternyata sudah dipakai (mis. NISN anak sendiri),
      // buat username otomatis saja supaya akun orang tua tetap bisa dibuat.
      const nipTaken = finalNip && db.prepare('SELECT id FROM users WHERE nip = ?').get(finalNip);
      if (!finalNip || nipTaken) {
        do { finalNip = 'ortu' + Math.floor(100000 + Math.random() * 900000); }
        while (db.prepare('SELECT id FROM users WHERE nip = ?').get(finalNip));
      }
    }

    if (!finalNip) {
      return res.json({ error: 'NISN / NIP wajib diisi untuk akun Siswa & Guru.' }, 400);
    }

    const existingNip = db.prepare('SELECT id FROM users WHERE nip = ?').get(finalNip);
    if (existingNip) return res.json({ error: 'NISN / NIP sudah terdaftar.' }, 400);

    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingEmail) return res.json({ error: 'Email sudah terdaftar.' }, 400);

    const insert = db.prepare(`
      INSERT INTO users (nip, name, email, password_hash, role, department, position, phone, entry_year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      finalNip,
      name,
      email,
      hashPassword(password),
      role,
      department || 'Umum',
      position || (isParent ? 'Orang Tua / Wali' : role === 'student' ? 'Siswa' : 'Guru'),
      phone || '',
      entry_year != null && entry_year !== '' ? Number(entry_year) : null
    );

    // Kalau akun orang tua, hubungkan dengan anak (siswa) via NISN anak
    const parentId = result.lastInsertRowid;
    if (isParent && childUser) {
      db.prepare('INSERT OR IGNORE INTO parent_children (parent_user_id, student_user_id) VALUES (?, ?)').run(parentId, childUser.id);
    }

    const created = db.prepare('SELECT id, nip, name, email, role, department, position, phone, is_active, entry_year FROM users WHERE id = ?').get(parentId);
    const message = isParent
      ? (childUser
          ? `Akun orang tua berhasil dibuat & terhubung ke siswa ${childUser.name}.`
          : 'Akun orang tua berhasil dibuat. Isi NISN anak agar bisa memantau kehadiran.')
      : 'Data warga sekolah berhasil ditambahkan.';
    return res.json({ success: true, message, employee: created });
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

    // Tautan anak untuk akun orang tua (dicari dari NISN anak, divalidasi SEBELUM
    // update supaya tidak ada perubahan yang setengah jalan)
    const effectiveRole = role || target.role;
    let linkedChild = null;
    if (effectiveRole === 'parent') {
      const linkNip = child_nip && String(child_nip).trim() ? String(child_nip).trim() : '';
      if (linkNip) {
        linkedChild = db.prepare("SELECT id, name FROM users WHERE nip = ? AND role = 'student'").get(linkNip);
        if (!linkedChild) {
          return res.json({ error: `NISN anak "${linkNip}" tidak ditemukan.` }, 400);
        }
      }
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
    if (linkedChild) {
      db.prepare('INSERT OR IGNORE INTO parent_children (parent_user_id, student_user_id) VALUES (?, ?)').run(targetId, linkedChild.id);
    }

    const updated = db.prepare('SELECT id, nip, name, email, role, department, position, phone, is_active, entry_year, avatar FROM users WHERE id = ?').get(targetId);
    const message = linkedChild
      ? `Data berhasil diperbarui & terhubung ke siswa ${linkedChild.name}.`
      : 'Data berhasil diperbarui.';
    return res.json({ success: true, message, employee: updated });
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
