const { db } = require('../db');
const { calculateDistance, getNowFormatted, evaluateStatus } = require('../utils');
const { notifyAttendance } = require('./notifications');

function handleAttendanceRoutes(req, res, url, user) {
  // GET /api/attendance/today (Untuk semua pengguna: Siswa, Guru, dan Admin)
  if (req.method === 'GET' && url.pathname === '/api/attendance/today') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);

    const now = getNowFormatted();
    const attendance = db.prepare(`
      SELECT * FROM attendances WHERE user_id = ? AND date = ?
    `).get(user.id, now.date);

    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();

    return res.json({
      success: true,
      currentDate: now.date,
      currentTime: now.time,
      attendance: attendance || null,
      settings
    });
  }

  // POST /api/attendance/scan-qr (Hanya Guru & Admin yang bisa memindai QR)
  if (req.method === 'POST' && url.pathname === '/api/attendance/scan-qr') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);

    // Akun siswa tidak dapat memindai QR — siswa hanya bisa menampilkan kartu QR-nya
    if (user.role === 'student') {
      return res.json({ error: 'Akun siswa tidak bisa memindai QR. Tunjukkan kartu QR Anda ke guru piket/petugas untuk discan.' }, 403);
    }

    const { qr_data, lat, lng, mode } = req.body || {};
    if (!qr_data || typeof qr_data !== 'string') {
      return res.json({ error: 'Data QR Code tidak valid.' }, 400);
    }

    // Mode scan: 'in' = absen masuk, 'out' = absen pulang, selain itu otomatis
    const scanMode = mode === 'out' ? 'out' : mode === 'in' ? 'in' : 'auto';

    const now = getNowFormatted();
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();

    // Validasi GPS: hitung jarak pemindai ke titik gerbang sekolah.
    // Toleransi realistis = radius gerbang + akurasi GPS perangkat + buffer 30m.
    const scannerLat = lat != null ? Number(lat) : null;
    const scannerLng = lng != null ? Number(lng) : null;
    const gpsAccuracy = req.body && req.body.accuracy != null ? Number(req.body.accuracy) : 0;
    const radiusLimit = settings.office_radius_meters + (Number.isFinite(gpsAccuracy) ? Math.min(gpsAccuracy, 200) : 0) + 30;
    const scannerDistance = scannerLat != null && scannerLng != null
      ? calculateDistance(scannerLat, scannerLng, settings.office_lat, settings.office_lng)
      : null;
    if (settings.enable_radius_restriction && scannerDistance != null && scannerDistance > radiusLimit) {
      return res.json({
        error: `Lokasi pemindai terlalu jauh dari gerbang sekolah (${scannerDistance}m > ${radiusLimit}m). Dekati gerbang sekolah lalu scan ulang.`
      }, 403);
    }

    // Skenario 1: Kartu Pelajar / ID Card Siswa atau Guru di-scan (oleh Guru Piket/Admin/Petugas)
    if (qr_data.startsWith('STUDENT_ID:') || qr_data.startsWith('USER_ID:')) {
      const nip = qr_data.replace(/^(STUDENT_ID|USER_ID):/, '').trim();
      const targetUser = db.prepare('SELECT * FROM users WHERE nip = ? AND is_active = 1').get(nip);

      if (!targetUser) {
        return res.json({ error: `Kartu Pelajar / NIP "${nip}" tidak terdaftar di sistem sekolah.` }, 404);
      }

      const existing = db.prepare('SELECT * FROM attendances WHERE user_id = ? AND date = ?').get(targetUser.id, now.date);

      if (scanMode === 'out' && !existing) {
        return res.json({ error: `${targetUser.name} (${targetUser.department}) belum absen masuk hari ini — tidak bisa absen pulang.` }, 400);
      }

      if (!existing) {
        // Absen Masuk via scan kartu
        const status = evaluateStatus(now.timeMinutes, settings.work_start_time, settings.late_tolerance_minutes);
        const stmt = db.prepare(`
          INSERT INTO attendances (user_id, date, clock_in, status, notes, lat_in, lng_in, distance_in)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(targetUser.id, now.date, now.time, status, 'Presensi via Scan Kartu Pelajar/Guru', scannerLat, scannerLng, scannerDistance);
        const saved = db.prepare('SELECT * FROM attendances WHERE id = ?').get(result.lastInsertRowid);
        notifyAttendance(targetUser, 'clock-in', now.time);

        return res.json({
          success: true,
          action: 'clock-in',
          status,
          user: {
            id: targetUser.id,
            name: targetUser.name,
            nip: targetUser.nip,
            department: targetUser.department,
            position: targetUser.position,
            role: targetUser.role
          },
          message: `${targetUser.name} (${targetUser.department}) - Masuk: ${now.time} (${status === 'late' ? 'Terlambat' : 'Tepat Waktu'})`,
          attendance: saved
        });
      } else if (!existing.clock_out) {
        if (scanMode === 'in') {
          return res.json({ error: `${targetUser.name} (${targetUser.department}) sudah absen masuk pukul ${existing.clock_in}. Gunakan mode Scan Pulang untuk absen pulang.` }, 400);
        }
        // Absen Pulang via scan kartu
        db.prepare(`
          UPDATE attendances
          SET clock_out = ?, lat_out = ?, lng_out = ?, distance_out = ?, notes = notes || ' | Pulang via Scan Kartu'
          WHERE id = ?
        `).run(now.time, scannerLat, scannerLng, scannerDistance, existing.id);

        const updated = db.prepare('SELECT * FROM attendances WHERE id = ?').get(existing.id);
        notifyAttendance(targetUser, 'clock-out', now.time);

        return res.json({
          success: true,
          action: 'clock-out',
          user: {
            id: targetUser.id,
            name: targetUser.name,
            nip: targetUser.nip,
            department: targetUser.department,
            position: targetUser.position,
            role: targetUser.role
          },
          message: `${targetUser.name} (${targetUser.department}) - Pulang: ${now.time}`,
          attendance: updated
        });
      } else {
        return res.json({
          error: `${targetUser.name} (${targetUser.department}) sudah menyelesaikan presensi masuk dan pulang hari ini.`
        }, 400);
      }
    }

    return res.json({ error: 'Format QR Code tidak dikenali. Gunakan kartu QR resmi sekolah (USER_ID).' }, 400);
  }

  // GET /api/attendance/history (Riwayat pribadi)
  if (req.method === 'GET' && url.pathname === '/api/attendance/history') {
    if (!user) return res.json({ error: 'Unauthorized' }, 401);

    const month = url.searchParams.get('month'); // YYYY-MM
    let rows;
    if (month) {
      rows = db.prepare(`
        SELECT * FROM attendances 
        WHERE user_id = ? AND date LIKE ? 
        ORDER BY date DESC
      `).all(user.id, `${month}%`);
    } else {
      rows = db.prepare(`
        SELECT * FROM attendances 
        WHERE user_id = ? 
        ORDER BY date DESC LIMIT 31
      `).all(user.id);
    }

    return res.json({ success: true, attendances: rows });
  }

  // GET /api/attendance/all (Admin & Guru: Monitoring Presensi Sekolah)
  if (req.method === 'GET' && url.pathname === '/api/attendance/all') {
    if (!user || (user.role !== 'admin' && user.role !== 'teacher')) {
      return res.json({ error: 'Akses ditolak.' }, 403);
    }

    const date = url.searchParams.get('date');
    const department = url.searchParams.get('department'); // Kelas atau Unit
    const status = url.searchParams.get('status');
    const month = url.searchParams.get('month');
    const role = url.searchParams.get('role'); // student, teacher, admin

    let query = `
      SELECT a.*, u.nip, u.name as employee_name, u.department, u.position, u.role, u.email
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      query += ' AND a.date = ?';
      params.push(date);
    } else if (month) {
      query += ' AND a.date LIKE ?';
      params.push(`${month}%`);
    }

    if (department) {
      query += ' AND u.department = ?';
      params.push(department);
    }

    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }

    if (role) {
      query += ' AND u.role = ?';
      params.push(role);
    }

    query += ' ORDER BY a.date DESC, a.clock_in DESC';

    const list = db.prepare(query).all(...params);
    return res.json({ success: true, attendances: list });
  }

  // GET /api/attendance/stats (Statistik Presensi Sekolah)
  if (req.method === 'GET' && url.pathname === '/api/attendance/stats') {
    if (!user || (user.role !== 'admin' && user.role !== 'teacher')) {
      return res.json({ error: 'Akses ditolak.' }, 403);
    }

    const now = getNowFormatted();
    const targetDate = url.searchParams.get('date') || now.date;

    const totalStudents = db.prepare(`SELECT COUNT(*) as total FROM users WHERE role = 'student' AND is_active = 1`).get().total;
    const totalTeachers = db.prepare(`SELECT COUNT(*) as total FROM users WHERE role IN ('teacher', 'admin') AND is_active = 1`).get().total;
    const totalAll = totalStudents + totalTeachers;

    const todayRows = db.prepare(`
      SELECT a.*, u.name, u.department, u.position, u.role
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      WHERE a.date = ?
    `).all(targetDate);

    const presentCount = todayRows.filter(r => r.status === 'present').length;
    const lateCount = todayRows.filter(r => r.status === 'late').length;
    const excusedCount = todayRows.filter(r => ['excused', 'sick', 'dispensation'].includes(r.status)).length;

    const approvedLeaves = db.prepare(`
      SELECT COUNT(*) as count FROM leave_requests
      WHERE status = 'approved' AND start_date <= ? AND end_date >= ?
    `).get(targetDate, targetDate).count;

    const totalExcused = Math.max(excusedCount, approvedLeaves);
    const absentCount = Math.max(0, totalAll - (presentCount + lateCount + totalExcused));

    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];

      const dayAttendances = db.prepare(`
        SELECT status, COUNT(*) as count FROM attendances WHERE date = ? GROUP BY status
      `).all(ds);

      let p = 0, l = 0, s = 0;
      dayAttendances.forEach(row => {
        if (row.status === 'present') p = row.count;
        if (row.status === 'late') l = row.count;
        if (['excused', 'sick', 'dispensation'].includes(row.status)) s = row.count;
      });

      trend.push({
        date: ds,
        label: d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }),
        present: p,
        late: l,
        excused: s
      });
    }

    return res.json({
      success: true,
      stats: {
        date: targetDate,
        totalAll,
        totalStudents,
        totalTeachers,
        present: presentCount,
        late: lateCount,
        excused: totalExcused,
        absent: absentCount
      },
      trend
    });
  }

  // GET /api/attendance/export (Download CSV Rekap Sekolah)
  if (req.method === 'GET' && url.pathname === '/api/attendance/export') {
    if (!user || user.role !== 'admin') {
      return res.json({ error: 'Akses ditolak.' }, 403);
    }

    const month = url.searchParams.get('month') || getNowFormatted().date.substring(0, 7);
    const rows = db.prepare(`
      SELECT a.date, u.nip, u.name, u.department, u.position, u.role,
             a.clock_in, a.clock_out, a.status, a.distance_in, a.notes
      FROM attendances a
      JOIN users u ON a.user_id = u.id
      WHERE a.date LIKE ?
      ORDER BY a.date ASC, u.department ASC, u.name ASC
    `).all(`${month}%`);

    let csv = 'Tanggal,NISN / NIP,Nama Siswa / Guru,Kelas / Unit,Kategori,Jam Masuk,Jam Pulang,Status,Jarak (m),Catatan\n';
    rows.forEach(r => {
      const statusLabel = r.status === 'present' ? 'Hadir Tepat Waktu' :
                          r.status === 'late' ? 'Terlambat' :
                          r.status === 'sick' ? 'Sakit' :
                          r.status === 'dispensation' ? 'Dispensasi' :
                          r.status === 'excused' ? 'Izin' : r.status;
      const roleLabel = r.role === 'admin' ? 'Kepala Sekolah / Admin' :
                        r.role === 'teacher' ? 'Guru' : 'Siswa';
      const cleanNotes = (r.notes || '').replace(/"/g, '""');
      csv += `"${r.date}","${r.nip}","${r.name}","${r.department}","${roleLabel}","${r.clock_in || '-'}","${r.clock_out || '-'}","${statusLabel}","${r.distance_in != null ? r.distance_in : '-'}","${cleanNotes}"\n`;
    });

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rekap-presensi-sekolah-${month}.csv"`
    });
    return res.end(csv);
  }

  return false;
}

module.exports = handleAttendanceRoutes;
