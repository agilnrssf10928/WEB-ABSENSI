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

  // Login siswa & admin
  const budi = await request({ hostname: 'localhost', port: PORT, path: '/api/auth/login', method: 'POST' }, { email: 'budi@sekolah.sch.id', password: 'budi123' });
  assert.strictEqual(budi.statusCode, 200);
  const admin = await request({ hostname: 'localhost', port: PORT, path: '/api/auth/login', method: 'POST' }, { email: 'admin@sekolah.sch.id', password: 'admin123' });
  assert.strictEqual(admin.statusCode, 200);
  const agil = await request({ hostname: 'localhost', port: PORT, path: '/api/auth/login', method: 'POST' }, { email: 'agil', password: '12345678' });
  assert.strictEqual(agil.statusCode, 200, 'Login username agil harus berhasil');
  console.log('OK  Login siswa, admin & agil');

  // 1. Ambil QR gerbang hari ini
  const gateQr = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/school-qr', method: 'GET' });
  assert.strictEqual(gateQr.statusCode, 200);
  assert(gateQr.bodyJson.qr_token.startsWith('SEKOLAH_QR:'));
  console.log('OK  GET /api/attendance/school-qr ->', gateQr.bodyJson.qr_token);

  // 2. Siswa scan QR gerbang -> absen masuk
  const scanIn = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${budi.bodyJson.token}` } }, { qr_data: gateQr.bodyJson.qr_token, lat: -6.3614144, lng: 107.0540305 });
  const okIn = scanIn.statusCode === 200 || (scanIn.statusCode === 400 && scanIn.bodyJson.error.includes('sudah'));
  assert(okIn, 'Scan QR gerbang gagal: ' + scanIn.bodyStr);
  console.log('OK  Siswa scan QR gerbang ->', scanIn.statusCode === 200 ? scanIn.bodyJson.action : 'sudah absen (rerun)');

  // 3. Scan ulang QR yang sama -> harus ditolak/tercatat pulang, bukan error server
  const scanAgain = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${budi.bodyJson.token}` } }, { qr_data: gateQr.bodyJson.qr_token });
  assert([200, 400].includes(scanAgain.statusCode));
  console.log('OK  Scan ulang QR gerbang ->', scanAgain.statusCode, scanAgain.bodyJson.action || scanAgain.bodyJson.error);

  // 4. Admin scan QR kartu siswa (USER_ID) -> absen pulang untuk siswa yang sudah masuk
  const scanCard = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${admin.bodyJson.token}` } }, { qr_data: 'USER_ID:0061234567' });
  assert([200, 400].includes(scanCard.statusCode), 'Scan kartu gagal: ' + scanCard.bodyStr);
  console.log('OK  Admin scan QR kartu Budi ->', scanCard.statusCode, scanCard.bodyJson.action || scanCard.bodyJson.error);

  // 5. Kartu tidak terdaftar -> 404
  const badCard = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST', headers: { Authorization: `Bearer ${admin.bodyJson.token}` } }, { qr_data: 'USER_ID:TIDAK_ADA' });
  assert.strictEqual(badCard.statusCode, 404);
  console.log('OK  Kartu tak dikenal -> 404');

  // 6. Tanpa login -> 401
  const noAuth = await request({ hostname: 'localhost', port: PORT, path: '/api/attendance/scan-qr', method: 'POST' }, { qr_data: 'SEKOLAH_QR:x' });
  assert.strictEqual(noAuth.statusCode, 401);
  console.log('OK  Scan tanpa login -> 401');

  console.log('\nSEMUA TEST QR LULUS');
}

run().catch(err => {
  console.error('TEST QR GAGAL:', err.message);
  process.exit(1);
});
