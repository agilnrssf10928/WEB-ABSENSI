const { db } = require('../db');

// Helper: buat notifikasi untuk satu user
function notifyUser(userId, title, body, type = 'info') {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)')
    .run(userId, title, body, type);
}

// Helper: kirim notifikasi absen ke siswa + orang tuanya
function notifyAttendance(targetUser, action, time) {
  const verb = action === 'clock-in' ? 'Datang' : 'Pulang';
  const title = `${targetUser.name} ${verb} Sekolah`;
  const body = action === 'clock-in'
    ? `Anak Anda datang di sekolah pukul ${time} WIB.`
    : `Anak Anda pulang dari sekolah pukul ${time} WIB.`;
  const type = action; // 'clock-in' | 'clock-out'

  // Notifikasi untuk siswa itu sendiri
  notifyUser(targetUser.id, title, body, type);

  // Notifikasi untuk semua orang tua yang terhubung
  const parents = db.prepare('SELECT parent_user_id FROM parent_children WHERE student_user_id = ?').all(targetUser.id);
  parents.forEach(p => notifyUser(p.parent_user_id, title, body, type));
}

function handleNotificationRoutes(req, res, url, user) {
  // Hanya tangani route notifikasi; route lain diabaikan (return false)
  const isNotifRoute = url.pathname === '/api/notifications' || url.pathname === '/api/notifications/read';
  if (!isNotifRoute) return false;

  // GET /api/notifications (notifikasi milik user yang login)
  if (req.method === 'GET' && url.pathname === '/api/notifications') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);

    const rows = db.prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30'
    ).all(user.id);
    const unread = db.prepare(
      'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(user.id).c;

    return res.json({ success: true, notifications: rows, unread });
  }

  // POST /api/notifications/read (tandai semua sudah dibaca)
  if (req.method === 'POST' && url.pathname === '/api/notifications/read') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
    return res.json({ success: true });
  }

  return false;
}

module.exports = { handleNotificationRoutes, notifyUser, notifyAttendance };
