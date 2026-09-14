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
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          bodyStr,
          bodyJson
        });
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

async function runTests() {
  console.log('--- Starting PresensiKu API Tests (QR-only) ---');

  // 1. Root HTML
  const rootRes = await request({ hostname: 'localhost', port: TEST_PORT, path: '/', method: 'GET' });
  assert.strictEqual(rootRes.statusCode, 200);
  assert(rootRes.bodyStr.includes('PresensiKu Sekolah'));
  console.log('✓ Test 1 Passed: GET / serves PresensiKu HTML');

  // 2. Auth Login Failure
  const failLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: 'agil', password: 'wrong-password' }
  );
  assert.strictEqual(failLogin.statusCode, 401);
  console.log('✓ Test 2 Passed: Invalid login rejected (401)');

  // 3. Login admin agil
  const adminLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: 'agil', password: '12345678' }
  );
  assert.strictEqual(adminLogin.statusCode, 200);
  assert(adminLogin.bodyJson.success);
  assert.strictEqual(adminLogin.bodyJson.user.role, 'admin');
  const adminToken = adminLogin.bodyJson.token;
  console.log('✓ Test 3 Passed: Admin agil login success');

  // 4. GET /api/auth/me
  const meRes = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.strictEqual(meRes.statusCode, 200);
  assert.strictEqual(meRes.bodyJson.user.nip, 'agil');
  console.log('✓ Test 4 Passed: Profile returns admin identity');

  // 5. Settings API
  const settingsRes = await request({ hostname: 'localhost', port: TEST_PORT, path: '/api/settings', method: 'GET' });
  assert.strictEqual(settingsRes.statusCode, 200);
  assert(settingsRes.bodyJson.settings.office_name.includes('SMK'));
  console.log('✓ Test 5 Passed: GET /api/settings returns school name');

  // 6. Admin registers a student (akun baru otomatis punya QR karena QR = f(nip))
  const newStudentRes = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/employees',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    {
      nip: '0090000001',
      name: 'Siswa Uji QR',
      email: 'siswa.uji@sekolah.sch.id',
      password: 'siswa123',
      department: 'X TKJ 1',
      position: 'Siswa',
      phone: '081200000001',
      role: 'student'
    }
  );
  assert.strictEqual(newStudentRes.statusCode, 200, JSON.stringify(newStudentRes.bodyJson));
  const studentId = newStudentRes.bodyJson.employee.id;
  console.log('✓ Test 6 Passed: Admin registered new student (QR-ready via nip)');

  // 7. Login siswa baru
  const studentLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: 'siswa.uji@sekolah.sch.id', password: 'siswa123' }
  );
  assert.strictEqual(studentLogin.statusCode, 200);
  const studentToken = studentLogin.bodyJson.token;
  console.log('✓ Test 7 Passed: New student can login');

  // 8. QR gerbang tersedia
  const gateQr = await request({ hostname: 'localhost', port: TEST_PORT, path: '/api/attendance/school-qr', method: 'GET' });
  assert.strictEqual(gateQr.statusCode, 200);
  assert(gateQr.bodyJson.qr_token.startsWith('SEKOLAH_QR:'));
  console.log('✓ Test 8 Passed: School gate QR available');

  // 9. Absen masuk via scan QR gerbang
  const scanIn = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/scan-qr',
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    },
    { qr_data: gateQr.bodyJson.qr_token, lat: -6.3614144, lng: 107.0540305, notes: 'Scan gerbang' }
  );
  assert.strictEqual(scanIn.statusCode, 200, JSON.stringify(scanIn.bodyJson));
  assert.strictEqual(scanIn.bodyJson.action, 'clock-in');
  assert(['present', 'late'].includes(scanIn.bodyJson.status));
  console.log('✓ Test 9 Passed: Student clock-in via gate QR');

  // 10. Stats admin
  const statsRes = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/attendance/stats',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.strictEqual(statsRes.statusCode, 200);
  assert(statsRes.bodyJson.stats.totalAll > 0);
  console.log('✓ Test 10 Passed: Attendance stats after QR scan');

  // 11. Export CSV
  const exportRes = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/attendance/export',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.strictEqual(exportRes.statusCode, 200);
  assert(exportRes.headers['content-type'].includes('text/csv'));
  console.log('✓ Test 11 Passed: Export CSV generates report');

  console.log('------------------------------------------------');
  console.log('🎉 ALL 11 API TESTS PASSED SUCCESSFULLY!');
  console.log('------------------------------------------------');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
