const { db } = require('../db');

function handleSettingsRoutes(req, res, url, user) {
  // GET /api/settings
  if (req.method === 'GET' && url.pathname === '/api/settings') {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    return res.json({ success: true, settings });
  }

  // PUT /api/settings (Admin only)
  if (req.method === 'PUT' && url.pathname === '/api/settings') {
    if (!user || user.role !== 'admin') {
      return res.json({ error: 'Akses ditolak. Khusus Admin.' }, 403);
    }

    const {
      office_name,
      office_lat,
      office_lng,
      office_radius_meters,
      enable_radius_restriction,
      work_start_time,
      work_end_time,
      late_tolerance_minutes
    } = req.body || {};

    db.prepare(`
      UPDATE settings
      SET office_name = ?,
          office_lat = ?,
          office_lng = ?,
          office_radius_meters = ?,
          enable_radius_restriction = ?,
          work_start_time = ?,
          work_end_time = ?,
          late_tolerance_minutes = ?
      WHERE id = 1
    `).run(
      office_name || 'Kantor Pusat PresensiKu',
      office_lat != null ? Number(office_lat) : -6.3673896,
      office_lng != null ? Number(office_lng) : 107.1066741,
      office_radius_meters != null ? Number(office_radius_meters) : 150,
      enable_radius_restriction != null ? Number(enable_radius_restriction) : 1,
      work_start_time || '08:00',
      work_end_time || '17:00',
      late_tolerance_minutes != null ? Number(late_tolerance_minutes) : 15
    );

    const updated = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    return res.json({
      success: true,
      message: 'Pengaturan kantor dan jam kerja berhasil disimpan.',
      settings: updated
    });
  }

  return false;
}

module.exports = handleSettingsRoutes;
