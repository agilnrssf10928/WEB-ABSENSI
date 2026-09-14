// Smoke test: simulasi pemanggilan serverless function di Vercel (VERCEL=1)
// Tanpa HTTP server — panggil handler langsung dengan req/res mock ala Vercel Node runtime.
process.env.VERCEL = '1';

const { dbReady } = require('../src/db');
const handler = require('../api/index');

function mockReq(method, url, { headers = {}, body = null } = {}) {
  return {
    method,
    url,
    headers,
    on() {},
    [Symbol.asyncIterator]: async function* () {
      if (body != null) yield Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    }
  };
}

const { Writable } = require('node:stream');

function mockRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, enc, cb) { chunks.push(chunk); cb(); }
  });
  res.statusCode = 200;
  res.headers = {};
  res.writableEnded = false;
  const origEnd = res.end.bind(res);
  res.end = function (payload) {
    this.writableEnded = true;
    if (payload) chunks.push(Buffer.from(payload));
    origEnd();
  };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  Object.defineProperty(res, 'body', { get: () => Buffer.concat(chunks).toString('utf8') });
  res.json = function (data, code = 200) {
    this.statusCode = code;
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(data));
  };
  return res;
}

async function call(method, path, opts) {
  const req = mockReq(method, path, opts);
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch (e) {}
  return { statusCode: res.statusCode, body: res.body, json };
}

(async () => {
  await dbReady;
  console.log('DB ready (VERCEL=1, in-memory)');

  // 1. Root HTML
  const root = await call('GET', '/');
  if (root.statusCode !== 200 || !root.body.includes('PresensiKu')) throw new Error('Root gagal: ' + root.statusCode);
  console.log('OK  GET / ->', root.statusCode);

  // 2. Settings API
  const settings = await call('GET', '/api/settings');
  if (settings.statusCode !== 200 || !settings.json.settings.office_name.includes('SMK')) throw new Error('Settings gagal');
  console.log('OK  GET /api/settings ->', settings.json.settings.office_name);

  // 3. Login admin agil
  const login = await call('POST', '/api/auth/login', { headers: { 'content-type': 'application/json' }, body: { email: 'agil', password: '12345678' } });
  if (login.statusCode !== 200 || !login.json.success) throw new Error('Login gagal: ' + login.body);
  console.log('OK  POST /api/auth/login -> token diterima');

  // 4. Absen masuk via scan QR gerbang (satu-satunya jalur absen)
  const qr = await call('GET', '/api/attendance/school-qr');
  if (!qr.json.qr_token) throw new Error('QR gerbang gagal: ' + qr.body);
  const scan = await call('POST', '/api/attendance/scan-qr', { headers: { 'content-type': 'application/json', authorization: 'Bearer ' + login.json.token }, body: { qr_data: qr.json.qr_token, lat: -6.3614144, lng: 107.0540305, notes: 'Scan gerbang' } });
  if (scan.statusCode !== 200 && !(scan.statusCode === 400 && scan.json.error.includes('sudah'))) throw new Error('Scan QR gagal: ' + scan.body);
  console.log('OK  POST /api/attendance/scan-qr ->', scan.statusCode, scan.json.action || '');

  // 5. Stats admin
  const stats = await call('GET', '/api/attendance/stats', { headers: { authorization: 'Bearer ' + login.json.token } });
  if (stats.statusCode !== 200) throw new Error('Stats gagal: ' + stats.body);
  console.log('OK  GET /api/attendance/stats -> totalAll =', stats.json.stats.totalAll);

  // 6. Pastikan jalur absen muka sudah DITUTUP (404/route tidak ada)
  const oldClockIn = await call('POST', '/api/attendance/clock-in', { headers: { 'content-type': 'application/json', authorization: 'Bearer ' + login.json.token }, body: { photo: 'x' } });
  if (oldClockIn.statusCode !== 404) throw new Error('Endpoint selfie seharusnya sudah dihapus, dapat: ' + oldClockIn.statusCode);
  console.log('OK  POST /api/attendance/clock-in -> 404 (absen muka sudah dihapus)');

  console.log('\nSEMUA SMOKE TEST VERCEL LULUS');
})().catch((e) => {
  console.error('SMOKE TEST GAGAL:', e.message);
  process.exit(1);
});
