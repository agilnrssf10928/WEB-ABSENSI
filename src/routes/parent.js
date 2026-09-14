const { db } = require('../db');

// Portal Orang Tua: pantau kehadiran anak secara realtime
function handleParentRoutes(req, res, url, user) {
  // Hanya tangani route milik portal orang tua; route lain diabaikan (return false)
  const isParentRoute = url.pathname === '/api/parent/children' || /^\/api\/parent\/children\/\d+\/history$/.test(url.pathname);
  if (!isParentRoute) return false;

  if (!user) return res.json({ error: 'Unauthorized' }, 401);

  // GET /api/parent/children — daftar anak + status kehadiran hari ini
  if (req.method === 'GET' && url.pathname === '/api/parent/children') {
    const today = new Date().toISOString().split('T')[0];

    const children = db.prepare(`
      SELECT u.id, u.nip, u.name, u.department, u.position,
             a.clock_in, a.clock_out, a.status
      FROM parent_children pc
      JOIN users u ON u.id = pc.student_user_id
      LEFT JOIN attendances a ON a.user_id = u.id AND a.date = ?
      WHERE pc.parent_user_id = ?
      ORDER BY u.name ASC
    `).all(today, user.id);

    return res.json({ success: true, children, today });
  }

  // GET /api/parent/children/:id/history?month=YYYY-MM — riwayat bulanan per anak
  const historyMatch = url.pathname.match(/^\/api\/parent\/children\/(\d+)\/history$/);
  if (req.method === 'GET' && historyMatch) {
    const studentId = Number(historyMatch[1]);

    // Pastikan anak ini memang milik orang tua yang login
    const link = db.prepare('SELECT id FROM parent_children WHERE parent_user_id = ? AND student_user_id = ?')
      .get(user.id, studentId);
    if (!link) return res.json({ error: 'Akses ditolak. Bukan anak Anda.' }, 403);

    const month = url.searchParams.get('month');
    let rows;
    if (month) {
      rows = db.prepare(`
        SELECT date, clock_in, clock_out, status, notes
        FROM attendances WHERE user_id = ? AND date LIKE ?
        ORDER BY date DESC
      `).all(studentId, `${month}%`);
    } else {
      rows = db.prepare(`
        SELECT date, clock_in, clock_out, status, notes
        FROM attendances WHERE user_id = ?
        ORDER BY date DESC LIMIT 31
      `).all(studentId);
    }

    return res.json({ success: true, attendances: rows });
  }

  return false;
}

module.exports = { handleParentRoutes };
