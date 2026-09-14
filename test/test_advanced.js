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
      nip: '0098765432', // NISN
      name: 'Rian Pratama',
      email: 'rian@sekolah.sch.id',
      password: 'password123',
      department: 'X MIPA 1', // Kelas
      position: 'Siswa',
      phone: '081299988877',
      role: 'student'
    }
  );
  assert.strictEqual(newStudentRes.statusCode, 200);
  assert.strictEqual(newStudentRes.bodyJson.employee.nip, '0098765432');
  const newStudentId = newStudentRes.bodyJson.employee.id;
  console.log('✓ Advanced 2: Admin registered new student Rian Pratama (ID:', newStudentId, ')');

  // 3. Test login dengan akun siswa baru
  const rianLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: 'rian@sekolah.sch.id', password: 'password123' }
  );
  assert.strictEqual(rianLogin.statusCode, 200);
  assert.strictEqual(rianLogin.bodyJson.user.name, 'Rian Pratama');
  const rianToken = rianLogin.bodyJson.token;
  console.log('✓ Advanced 3: Newly registered student can login successfully');

  // 4. Rian scan kartu miliknya sendiri via kamera -> absen masuk
  const rianCardScan = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/scan-qr',
      method: 'POST',
      headers: { Authorization: `Bearer ${rianToken}` }
    },
    { qr_data: 'USER_ID:0098765432' }
  );
  assert.strictEqual(rianCardScan.statusCode, 200, JSON.stringify(rianCardScan.bodyJson));
  assert.strictEqual(rianCardScan.bodyJson.action, 'clock-in');
  console.log('✓ Advanced 4: Student clock-in via own card QR');

  // 5. Admin scan kartu Rian -> mencatat absen pulang untuk Rian
  const adminScanRian = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/scan-qr',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    { qr_data: 'USER_ID:0098765432' }
  );
  assert.strictEqual(adminScanRian.statusCode, 200, JSON.stringify(adminScanRian.bodyJson));
  assert.strictEqual(adminScanRian.bodyJson.action, 'clock-out');
  assert.strictEqual(adminScanRian.bodyJson.user.name, 'Rian Pratama');
  console.log('✓ Advanced 5: Officer (admin) scanned student card for clock-out');

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
      office_lat: -6.3614144,
      office_lng: 107.0540305,
      enable_radius_restriction: 1
    }
  );
  assert.strictEqual(updateSettings.statusCode, 200);
  assert.strictEqual(updateSettings.bodyJson.settings.office_name, 'SMK Pariwisata Digital Unggulan');
  console.log('✓ Advanced 6: School settings update verified');

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
