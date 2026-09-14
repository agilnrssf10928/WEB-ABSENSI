const http = require('node:http');
const assert = require('node:assert');

const TEST_PORT = Number(process.env.PORT) || 3000;

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        let bodyJson = null;
        try { bodyJson = JSON.parse(bodyStr); } catch (e) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, bodyStr, bodyJson });
      });
    });
    req.on('error', reject);
    if (data) {
      req.setHeader('Content-Type', 'application/json');
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runAdvancedTests() {
  console.log('--- Starting Advanced Workflow Tests (QR-only) ---');

  // Data unik per run supaya tes bisa diulang tanpa konflik data lama
  const uniq = Date.now().toString().slice(-8);
  const RIAN_NIP = '0098' + uniq;
  const PARENT_NIP = 'ortu' + uniq;

  // Login admin agil
  const adminLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: 'agil', password: '12345678' }
  );
  assert.strictEqual(adminLogin.statusCode, 200);
  const adminToken = adminLogin.bodyJson.token;

  // Admin scan QR kartu sendiri (USER_ID:agil) -> absen masuk admin via kartu
  const selfCardScan = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/scan-qr',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    { qr_data: 'USER_ID:agil' }
  );
  assert([200, 400].includes(selfCardScan.statusCode), JSON.stringify(selfCardScan.bodyJson));
  console.log('✓ Advanced 1: Admin self card scan processed (', selfCardScan.bodyJson.action || selfCardScan.bodyJson.error, ')');

  // 2. Admin mendaftarkan Siswa Baru
  const newStudentRes = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/employees',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    {
      nip: RIAN_NIP, // NISN
      name: 'Rian Pratama',
      email: `rian.${uniq}@sekolah.sch.id`,
      password: 'password123',
      department: 'X MIPA 1', // Kelas
      position: 'Siswa',
      phone: '081299988877',
      role: 'student'
    }
  );
  assert.strictEqual(newStudentRes.statusCode, 200);
  assert.strictEqual(newStudentRes.bodyJson.employee.nip, RIAN_NIP);
  const newStudentId = newStudentRes.bodyJson.employee.id;
  console.log('✓ Advanced 2: Admin registered new student Rian Pratama (ID:', newStudentId, ')');

  // 3. Test login dengan akun siswa baru
  const rianLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: `rian.${uniq}@sekolah.sch.id`, password: 'password123' }
  );
  assert.strictEqual(rianLogin.statusCode, 200);
  assert.strictEqual(rianLogin.bodyJson.user.name, 'Rian Pratama');
  const rianToken = rianLogin.bodyJson.token;
  console.log('✓ Advanced 3: Newly registered student can login successfully');

  // 4. Rian (siswa) TIDAK BISA scan — hanya guru & admin yang boleh memindai
  const rianCardScan = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/scan-qr',
      method: 'POST',
      headers: { Authorization: `Bearer ${rianToken}` }
    },
    { qr_data: `USER_ID:${RIAN_NIP}` }
  );
  assert.strictEqual(rianCardScan.statusCode, 403, JSON.stringify(rianCardScan.bodyJson));
  console.log('✓ Advanced 4: Student cannot scan QR (403, only teachers/admins)');

  // 4b. Rian (siswa) tidak bisa melihat daftar warga sekolah (QR kartu murid khusus guru/admin)
  const rianEmpList = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/employees?role=student',
    method: 'GET',
    headers: { Authorization: `Bearer ${rianToken}` }
  });
  assert.strictEqual(rianEmpList.statusCode, 403, JSON.stringify(rianEmpList.bodyJson));
  console.log('✓ Advanced 4b: Student cannot view student QR list (403)');

  // 5. Admin membuat akun ORANG TUA tertaut ke Rian — SEBELUM scan agar notifikasi terkirim
  const parentRes = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/employees',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    {
      nip: PARENT_NIP,
      name: 'Bapak Rian',
      email: `ortu.rian.${uniq}@sekolah.sch.id`,
      password: 'ortu12345',
      department: 'Wali Murid',
      position: 'Orang Tua / Wali',
      phone: '081200011122',
      role: 'parent',
      child_nip: RIAN_NIP
    }
  );
  assert.strictEqual(parentRes.statusCode, 200, JSON.stringify(parentRes.bodyJson));
  assert.strictEqual(parentRes.bodyJson.employee.role, 'parent');
  console.log('✓ Advanced 5: Parent account created and linked to child');

  // 5a. Admin scan kartu Rian mode 'in' -> absen masuk Rian (memicu notifikasi ke orang tua)
  const adminScanIn = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/scan-qr',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    { qr_data: `USER_ID:${RIAN_NIP}`, mode: 'in' }
  );
  assert.strictEqual(adminScanIn.statusCode, 200, JSON.stringify(adminScanIn.bodyJson));
  assert.strictEqual(adminScanIn.bodyJson.action, 'clock-in');
  assert.strictEqual(adminScanIn.bodyJson.user.name, 'Rian Pratama');
  console.log('✓ Advanced 5a: Admin scanned student card for clock-in');

  // 5b. Admin scan kartu Rian mode 'out' -> absen pulang Rian (memicu notifikasi ke orang tua)
  const adminScanRian = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/scan-qr',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    { qr_data: `USER_ID:${RIAN_NIP}`, mode: 'out' }
  );
  assert.strictEqual(adminScanRian.statusCode, 200, JSON.stringify(adminScanRian.bodyJson));
  assert.strictEqual(adminScanRian.bodyJson.action, 'clock-out');
  console.log('✓ Advanced 5b: Admin scanned student card for clock-out (mode out)');

  // 6. Admin memperbarui pengaturan gerbang sekolah
  const updateSettings = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/settings',
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    {
      office_name: 'SMK Pariwisata Digital Unggulan',
      work_start_time: '07:00',
      work_end_time: '15:00',
      late_tolerance_minutes: 15,
      office_radius_meters: 200,
      office_lat: -6.36263,
      office_lng: 107.06503,
      enable_radius_restriction: 1
    }
  );
  assert.strictEqual(updateSettings.statusCode, 200);
  assert.strictEqual(updateSettings.bodyJson.settings.office_name, 'SMK Pariwisata Digital Unggulan');
  console.log('✓ Advanced 6: School settings update verified');

  // 6b. Validasi GPS: scan dari lokasi jauh dari gerbang DITOLAK (403)
  const farScan = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/scan-qr',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    { qr_data: `USER_ID:${RIAN_NIP}`, lat: -6.36263, lng: 107.07503, mode: 'in' } // ±1.1 km dari gerbang
  );
  assert.strictEqual(farScan.statusCode, 403, JSON.stringify(farScan.bodyJson));
  assert.ok(farScan.bodyJson.error.includes('terlalu jauh'), 'error should mention distance');
  console.log('✓ Advanced 6b: Scan from outside gate radius rejected:', farScan.bodyJson.error.slice(0, 60) + '...');

  // 6c. Scan dari dalam radius gerbang lolos validasi GPS (lanjut ke logika absensi)
  const nearScan = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/scan-qr',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    { qr_data: `USER_ID:${RIAN_NIP}`, lat: -6.36263, lng: 107.06523, mode: 'in' } // ±22 m dari gerbang
  );
  assert.strictEqual(nearScan.statusCode, 400, JSON.stringify(nearScan.bodyJson)); // Rian sudah lengkap -> 400, bukan 403 GPS
  assert.ok(!nearScan.bodyJson.error.includes('terlalu jauh'), 'near scan must pass GPS check');
  console.log('✓ Advanced 6c: Scan within gate radius passes GPS check (', nearScan.bodyJson.error.slice(0, 50) + '...)');

  // 8. Orang tua login
  const parentLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: `ortu.rian.${uniq}@sekolah.sch.id`, password: 'ortu12345' }
  );
  assert.strictEqual(parentLogin.statusCode, 200);
  const parentToken = parentLogin.bodyJson.token;
  console.log('✓ Advanced 9: Parent can login');

  // 9. Orang tua melihat data anak + jam datang/pulang hari ini
  const childrenRes = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/parent/children',
    method: 'GET',
    headers: { Authorization: `Bearer ${parentToken}` }
  });
  assert.strictEqual(childrenRes.statusCode, 200, JSON.stringify(childrenRes.bodyJson));
  assert.strictEqual(childrenRes.bodyJson.children.length, 1);
  assert.strictEqual(childrenRes.bodyJson.children[0].name, 'Rian Pratama');
  assert.ok(childrenRes.bodyJson.children[0].clock_in, 'clock_in should exist after scans');
  assert.ok(childrenRes.bodyJson.children[0].clock_out, 'clock_out should exist after scans');
  console.log('✓ Advanced 10: Parent sees child with clock-in', childrenRes.bodyJson.children[0].clock_in, 'and clock-out', childrenRes.bodyJson.children[0].clock_out);

  // 10. Notifikasi masuk untuk orang tua (datang & pulang anaknya)
  const notifRes = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/notifications',
    method: 'GET',
    headers: { Authorization: `Bearer ${parentToken}` }
  });
  assert.strictEqual(notifRes.statusCode, 200);
  const notifTitles = notifRes.bodyJson.notifications.map(n => n.title).join(' | ');
  assert.ok(notifTitles.includes('Rian Pratama Datang Sekolah'), 'should have clock-in notification');
  assert.ok(notifTitles.includes('Rian Pratama Pulang Sekolah'), 'should have clock-out notification');
  console.log('✓ Advanced 11: Parent received clock-in & clock-out notifications');

  // 11. Orang tua tidak bisa lihat riwayat anak orang lain
  const forbidden = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: `/api/parent/children/999/history`,
    method: 'GET',
    headers: { Authorization: `Bearer ${parentToken}` }
  });
  assert.strictEqual(forbidden.statusCode, 403);
  console.log('✓ Advanced 12: Parent cannot access other children history (403)');

  // 12. Bersihkan akun orang tua uji coba
  const parentDelete = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/employees/' + parentRes.bodyJson.employee.id,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    }
  );
  assert.strictEqual(parentDelete.statusCode, 200);
  console.log('✓ Advanced 13: Test parent account deleted');

  // 7. Admin menghapus data siswa uji coba
  const deleteRes = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/employees/${newStudentId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    }
  );
  assert.strictEqual(deleteRes.statusCode, 200);
  console.log('✓ Advanced 7: Admin successfully deleted test student record');

  console.log('------------------------------------------------');
  console.log('🎉 ALL ADVANCED TESTS PASSED!');
  console.log('------------------------------------------------');
}

runAdvancedTests().catch(e => {
  console.error(e);
  process.exit(1);
});
