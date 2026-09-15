const { db } = require('../db');

// Kolom avatar dibatasi ukurannya agar database tetap ringan (~300KB base64)
const MAX_AVATAR_LENGTH = 400000;

function handleProfileRoutes(req, res, url, user) {
  // GET /api/profile — profil sendiri
  if (req.method === 'GET' && url.pathname === '/api/profile') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);

    const profile = db.prepare(`
      SELECT id, nip, name, email, role, department, position, phone, avatar, entry_year, created_at
      FROM users WHERE id = ?
    `).get(user.id);

    if (!profile) return res.json({ error: 'User tidak ditemukan' }, 404);
    return res.json({ success: true, profile });
  }

  // PUT /api/profile — perbarui profil sendiri (nama, telp, tahun masuk, foto)
  if (req.method === 'PUT' && url.pathname === '/api/profile') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);

    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!target) return res.json({ error: 'User tidak ditemukan' }, 404);

    const { name, phone, entry_year, avatar, nip } = req.body || {};

    // Validasi NISN/NIP baru: unik (kecuali milik sendiri)
    let newNip = target.nip;
    if (nip !== undefined) {
      const candidate = String(nip).trim();
      if (!candidate) {
        return res.json({ error: 'NISN/NIP tidak boleh kosong.' }, 400);
      }
      if (candidate !== target.nip) {
        const clash = db.prepare('SELECT id FROM users WHERE nip = ? AND id != ?').get(candidate, user.id);
        if (clash) {
          return res.json({ error: 'NISN/NIP sudah dipakai akun lain.' }, 400);
        }
        newNip = candidate;
      }
    }

    // Validasi avatar: harus data URL gambar bila dikirim
    let newAvatar = target.avatar;
    if (avatar !== undefined) {
      if (avatar === '' || avatar === null) {
        newAvatar = ''; // hapus foto
      } else if (typeof avatar === 'string' && avatar.startsWith('data:image/')) {
        if (avatar.length > MAX_AVATAR_LENGTH) {
          return res.json({ error: 'Ukuran foto terlalu besar. Gunakan foto di bawah 300KB.' }, 400);
        }
        newAvatar = avatar;
      } else {
        return res.json({ error: 'Format foto tidak valid.' }, 400);
      }
    }

    db.prepare(`
      UPDATE users
      SET nip = ?, name = ?, phone = ?, entry_year = ?, avatar = ?
      WHERE id = ?
    `).run(
      newNip,
      name && String(name).trim() ? String(name).trim() : target.name,
      phone != null ? String(phone).trim() : target.phone,
      entry_year != null && entry_year !== '' ? Number(entry_year) : (entry_year === '' ? null : target.entry_year),
      newAvatar,
      user.id
    );

    const updated = db.prepare(`
      SELECT id, nip, name, email, role, department, position, phone, avatar, entry_year, created_at
      FROM users WHERE id = ?
    `).get(user.id);

    return res.json({ success: true, message: 'Profil berhasil diperbarui.', profile: updated });
  }

  return false;
}

module.exports = { handleProfileRoutes };
