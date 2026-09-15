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

    // Nilai bawaan HANYA dipakai jika tabel benar-benar kosong, bukan sebagai
    // pengganti field yang tidak dikirim — kalau tidak, settings yang sudah
    // diatur admin bisa ter-reset sendiri.
    const current = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (!current) {
      return res.json({ error: 'Data pengaturan tidak ditemukan.' }, 500);
    }

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
      office_name != null && String(office_name).trim() ? String(office_name).trim() : current.office_name,
      office_lat != null && office_lat !== '' ? Number(office_lat) : current.office_lat,
      office_lng != null && office_lng !== '' ? Number(office_lng) : current.office_lng,
      office_radius_meters != null && office_radius_meters !== '' ? Number(office_radius_meters) : current.office_radius_meters,
      enable_radius_restriction != null ? Number(enable_radius_restriction) : current.enable_radius_restriction,
      work_start_time != null && String(work_start_time).trim() ? String(work_start_time).trim() : current.work_start_time,
      work_end_time != null && String(work_end_time).trim() ? String(work_end_time).trim() : current.work_end_time,
      late_tolerance_minutes != null && late_tolerance_minutes !== '' ? Number(late_tolerance_minutes) : current.late_tolerance_minutes
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
