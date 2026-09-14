// Test alur QR: scan QR gerbang (absen sendiri) & scan kartu USER_ID (absen oleh petugas)
const http = require('node:http');
const assert = require('node:assert');

const PORT = Number(process.env.PORT) || 3000;

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        let bodyJson = null;
        try { bodyJson = JSON.parse(bodyStr); } catch (e) {}
        resolve({ statusCode: res.statusCode, bodyJson, bodyStr });
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

async function run() {
  console.log('--- QR Attendance Flow Tests ---');

  // Login admin agil
  const agil = await request({ hostname: 'localhost', port: PORT, path: '/api/auth/login', method: 'POST' }, { email: 'agil', password: '12345678' });
  assert.strictEqual(agil.statusCode, 200, 'Login username agil harus berhasil');
  const adminToken = agil.bodyJson.token;

  // Buat siswa uji (karena akun demo sudah dihapus)
  const newStudent = await request(
    { hostname: 'localhost', port: PORT, path: '/api/employees', method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } },
    { nip: '0088888881', name: 'Siswa QR Test', email: 'qr.test@sekolah.sch.id', password: 'qrtest123', department: 'X AP 1', position: 'Siswa', phone: '081888888881', role: 'student' }
  );
  assert.strictEqual(newStudent.statusCode, 200, JSON.stringify(newStudent.bodyJson));
  const siswaLogin = await request({ hostname: 'localhost', port: PORT, path: '/api/auth/login', method: 'POST' }, { email: 'qr.test@sekolah.sch.id', password: 'qrtest123' });
  assert.strictEqual(siswaLogin.statusCode, 200);
  const siswaToken = siswaLogin.bodyJson.token;
  console.log('OK  Login admin agil & siswa uji baru');

  // 1. Endpoint QR gerbang sudah DIHAPUS
  const gateQrGone = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/school-qr', method: 'GET' });
  assert.strictEqual(gateQrGone.statusCode, 404);
  console.log('OK  GET /api/attendance/school-qr -> 404 (QR gerbang dihapus)');

  // 2. Siswa scan kartu sendiri via kamera -> absen masuk
  const scanIn = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${siswaToken}` } }, { qr_data: 'USER_ID:0088888881', lat: -6.3614144, lng: 107.0540305 });
  assert.strictEqual(scanIn.statusCode, 200, 'Scan kartu sendiri gagal: ' + scanIn.bodyStr);
  assert.strictEqual(scanIn.bodyJson.action, 'clock-in');
  console.log('OK  Siswa scan kartu sendiri -> clock-in', scanIn.bodyJson.status);

  // 3. Scan ulang kartu sendiri -> clock-out (pulang)
  const scanOut = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${siswaToken}` } }, { qr_data: 'USER_ID:0088888881' });
  assert.strictEqual(scanOut.statusCode, 200, JSON.stringify(scanOut.bodyJson));
  assert.strictEqual(scanOut.bodyJson.action, 'clock-out');
  console.log('OK  Scan ulang kartu sendiri -> clock-out');

  // 4. Scan ketiga -> sudah lengkap, ditolak rapi
  const scanThird = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${siswaToken}` } }, { qr_data: 'USER_ID:0088888881' });
  assert.strictEqual(scanThird.statusCode, 400);
  console.log('OK  Scan ketiga -> 400', scanThird.bodyJson.error);

  // 5. Admin scan kartu siswa -> juga ditolak karena sudah lengkap
  const scanCard = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }, { qr_data: 'USER_ID:0088888881' });
  assert.strictEqual(scanCard.statusCode, 400);
  console.log('OK  Admin scan kartu siswa (sudah lengkap) -> 400');

  // 6. Kartu tidak terdaftar -> 404
  const badCard = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }, { qr_data: 'USER_ID:TIDAK_ADA' });
  assert.strictEqual(badCard.statusCode, 404);
  console.log('OK  Kartu tak dikenal -> 404');

  // 7. Tanpa login -> 401
  const noAuth = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST' }, { qr_data: 'USER_ID:x' });
  assert.strictEqual(noAuth.statusCode, 401);
  console.log('OK  Scan tanpa login -> 401');

  // 8. QR format asing -> 400
  const weird = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } }, { qr_data: 'RANDOM:123' });
  assert.strictEqual(weird.statusCode, 400);
  console.log('OK  QR format asing -> 400');

  console.log('\nSEMUA TEST QR LULUS');
}

run().catch(err => {
  console.error('TEST QR GAGAL:', err.message);
  process.exit(1);
});
