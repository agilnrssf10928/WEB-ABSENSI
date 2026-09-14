const { db } = require('../db');
const { saveBase64Image } = require('../utils');

function handleLeaveRoutes(req, res, url, user) {
  // GET /api/leaves
  if (req.method === 'GET' && url.pathname === '/api/leaves') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);

    let rows;
    if (user.role === 'admin' || user.role === 'teacher') {
      rows = db.prepare(`
        SELECT l.*, u.nip, u.name as employee_name, u.department, u.position, u.role
        FROM leave_requests l
        JOIN users u ON l.user_id = u.id
        ORDER BY l.created_at DESC
      `).all();
    } else {
      rows = db.prepare(`
        SELECT l.*, u.nip, u.name as employee_name, u.department, u.position, u.role
        FROM leave_requests l
        JOIN users u ON l.user_id = u.id
        WHERE l.user_id = ?
        ORDER BY l.created_at DESC
      `).all(user.id);
    }

    return res.json({ success: true, leaves: rows });
  }

  // POST /api/leaves (Pengajuan izin / sakit / dispensasi siswa & guru)
  if (req.method === 'POST' && url.pathname === '/api/leaves') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);

    const { type, start_date, end_date, reason, attachment } = req.body || {};

    if (!type || !start_date || !end_date || !reason) {
      return res.json({ error: 'Jenis pengajuan, tanggal mulai, tanggal selesai, dan alasan wajib diisi.' }, 400);
    }

    let attachmentUrl = null;
    if (attachment) {
      attachmentUrl = saveBase64Image(attachment, 'leaves');
    }

    const stmt = db.prepare(`
      INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, attachment, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);

    const result = stmt.run(user.id, type, start_date, end_date, reason, attachmentUrl || '');
    const saved = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(result.lastInsertRowid);

    return res.json({
      success: true,
      message: 'Permohonan izin / dispensasi berhasil dikirim dan menunggu persetujuan pihak sekolah.',
      leave: saved
    });
  }

  // PUT /api/leaves/:id (Approval / Reject oleh Admin / Guru Piket)
  const putMatch = url.pathname.match(/^\/api\/leaves\/(\d+)$/);
  if (req.method === 'PUT' && putMatch) {
    if (!user || (user.role !== 'admin' && user.role !== 'teacher')) {
      return res.json({ error: 'Akses ditolak.' }, 403);
    }

    const leaveId = Number(putMatch[1]);
    const { status, admin_notes = '' } = req.body || {};

    if (!['approved', 'rejected'].includes(status)) {
      return res.json({ error: 'Status harus approved atau rejected.' }, 400);
    }

    const leave = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(leaveId);
    if (!leave) return res.json({ error: 'Pengajuan tidak ditemukan.' }, 404);

    db.prepare(`
      UPDATE leave_requests
      SET status = ?, admin_notes = ?
      WHERE id = ?
    `).run(status, admin_notes, leaveId);

    // Jika disetujui (approved), sinkronisasi ke tabel attendances
    if (status === 'approved') {
      const attendanceStatus = leave.type === 'sick' ? 'sick' :
                               leave.type === 'dispensation' ? 'dispensation' : 'excused';
      const cur = new Date(leave.start_date);
      const end = new Date(leave.end_date);

      while (cur <= end) {
        const dateStr = cur.toISOString().split('T')[0];
        const existingAtt = db.prepare('SELECT id FROM attendances WHERE user_id = ? AND date = ?').get(leave.user_id, dateStr);
        if (!existingAtt) {
          db.prepare(`
            INSERT INTO attendances (user_id, date, status, notes)
            VALUES (?, ?, ?, ?)
          `).run(leave.user_id, dateStr, attendanceStatus, `Pengajuan ${leave.type}: ${leave.reason}`);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    const updated = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(leaveId);
    return res.json({
      success: true,
      message: status === 'approved' ? 'Pengajuan disetujui pihak sekolah.' : 'Pengajuan ditolak.',
      leave: updated
    });
  }

  return false;
}

module.exports = handleLeaveRoutes;
