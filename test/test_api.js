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
      if (typeof data === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(data));
      } else {
        req.write(data);
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting PresensiKu Sekolah API Tests ---');

  // 1. Root HTML
  const rootRes = await request({ hostname: 'localhost', port: TEST_PORT, path: '/', method: 'GET' });
  assert.strictEqual(rootRes.statusCode, 200);
  assert(rootRes.bodyStr.includes('PresensiKu Sekolah'));
  console.log('✓ Test 1 Passed: GET / serves PresensiKu Sekolah HTML');

  // 2. Auth Login Failure
  const failLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: 'wrong@sekolah.sch.id', password: 'wrong' }
  );
  assert.strictEqual(failLogin.statusCode, 401);
  console.log('✓ Test 2 Passed: Invalid login rejected (401)');

  // 3. Auth Login Success (Siswa: Budi Santoso)
  const studentLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: 'budi@sekolah.sch.id', password: 'budi123' }
  );
  assert.strictEqual(studentLogin.statusCode, 200);
  assert(studentLogin.bodyJson.success);
  assert.strictEqual(studentLogin.bodyJson.user.email, 'budi@sekolah.sch.id');
  assert.strictEqual(studentLogin.bodyJson.user.role, 'student');
  const studentToken = studentLogin.bodyJson.token;
  console.log('✓ Test 3 Passed: Student login success, token received');

  // 4. GET /api/auth/me for student
  const meRes = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  assert.strictEqual(meRes.statusCode, 200);
  assert.strictEqual(meRes.bodyJson.user.nip, '0061234567'); // NISN
  assert.strictEqual(meRes.bodyJson.user.department, 'XII RPL 1'); // Kelas
  console.log('✓ Test 4 Passed: Student profile returns NISN & Kelas');

  // 5. Settings API
  const settingsRes = await request({ hostname: 'localhost', port: TEST_PORT, path: '/api/settings', method: 'GET' });
  assert.strictEqual(settingsRes.statusCode, 200);
  assert(settingsRes.bodyJson.settings.office_name.includes('SMK'));
  console.log('✓ Test 5 Passed: GET /api/settings returns school name');

  // 6. Student Clock-In API
  const samplePhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const clockInRes = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/clock-in',
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    },
    {
      photo: samplePhoto,
      lat: -6.3614144,
      lng: 107.0540305,
      notes: 'Hadir apel pagi'
    }
  );
  assert(clockInRes.statusCode === 200 || (clockInRes.statusCode === 400 && clockInRes.bodyJson.error.includes('sudah melakukan absen')));
  console.log('✓ Test 6 Passed: Student Clock-In processed');

  // 7. Student Clock-Out API
  const clockOutRes = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/clock-out',
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` }
    },
    {
      photo: samplePhoto,
      lat: -6.3614144,
      lng: 107.0540305,
      notes: 'Pulang sekolah'
    }
  );
  assert(clockOutRes.statusCode === 200 || clockOutRes.statusCode === 400);
  console.log('✓ Test 7 Passed: Student Clock-Out processed');

  // 8. Admin Login (Drs. H. Mulyadi, M.Pd - Kepala Sekolah)
  const adminLogin = await request(
    { hostname: 'localhost', port: TEST_PORT, path: '/api/auth/login', method: 'POST' },
    { email: 'admin@sekolah.sch.id', password: 'admin123' }
  );
  assert.strictEqual(adminLogin.statusCode, 200);
  const adminToken = adminLogin.bodyJson.token;
  console.log('✓ Test 8 Passed: Admin / Kepala Sekolah login success');

  // 9. CRUCIAL TEST: ADMIN / KEPALA SEKOLAH BISA ABSEN JUGA!
  const adminClockIn = await request(
    {
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/attendance/clock-in',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    },
    {
      photo: samplePhoto,
      lat: -6.3614144,
      lng: 107.0540305,
      notes: 'Hadir memimpin upacara sekolah'
    }
  );
  assert(adminClockIn.statusCode === 200 || (adminClockIn.statusCode === 400 && adminClockIn.bodyJson.error.includes('sudah melakukan absen')));
  console.log('✓ Test 9 Passed: Admin / Kepala Sekolah can clock-in (Semua bisa absen!)');

  // 10. Admin Stats & Trend
  const statsRes = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/attendance/stats',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.strictEqual(statsRes.statusCode, 200);
  assert(statsRes.bodyJson.stats.totalAll > 0);
  assert(statsRes.bodyJson.stats.totalStudents > 0);
  assert(statsRes.bodyJson.stats.totalTeachers > 0);
  console.log('✓ Test 10 Passed: School attendance stats breakdown (Siswa & Guru)');

  // 11. Admin Export CSV
  const exportRes = await request({
    hostname: 'localhost',
    port: TEST_PORT,
    path: '/api/attendance/export',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.strictEqual(exportRes.statusCode, 200);
  assert(exportRes.headers['content-type'].includes('text/csv'));
  assert(exportRes.bodyStr.includes('Tanggal,NISN / NIP,Nama Siswa / Guru'));
  console.log('✓ Test 11 Passed: Export CSV generates school attendance report');

  console.log('------------------------------------------------');
  console.log('🎉 ALL 11 SCHOOL TESTS PASSED SUCCESSFULLY!');
  console.log('------------------------------------------------');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
