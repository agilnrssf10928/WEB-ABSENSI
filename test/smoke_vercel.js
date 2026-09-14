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
  if (settings.statusCode !== 200 || !settings.json.settings.office_name.includes('SMA')) throw new Error('Settings gagal');
  console.log('OK  GET /api/settings ->', settings.json.settings.office_name);

  // 3. Login siswa
  const login = await call('POST', '/api/auth/login', { headers: { 'content-type': 'application/json' }, body: { email: 'budi@sekolah.sch.id', password: 'budi123' } });
  if (login.statusCode !== 200 || !login.json.success) throw new Error('Login gagal: ' + login.body);
  console.log('OK  POST /api/auth/login -> token diterima');

  // 4. Clock-in dengan foto base64
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const clockIn = await call('POST', '/api/attendance/clock-in', { headers: { 'content-type': 'application/json', authorization: 'Bearer ' + login.json.token }, body: { photo, lat: -6.2088, lng: 106.8456, notes: 'Hadir' } });
  if (clockIn.statusCode !== 200 && !(clockIn.statusCode === 400 && clockIn.json.error.includes('sudah'))) throw new Error('Clock-in gagal: ' + clockIn.body);
  console.log('OK  POST /api/attendance/clock-in ->', clockIn.statusCode);

  // 5. Stats admin
  const admin = await call('POST', '/api/auth/login', { headers: { 'content-type': 'application/json' }, body: { email: 'admin@sekolah.sch.id', password: 'admin123' } });
  const stats = await call('GET', '/api/attendance/stats', { headers: { authorization: 'Bearer ' + admin.json.token } });
  if (stats.statusCode !== 200 || stats.json.stats.totalAll <= 0) throw new Error('Stats gagal: ' + stats.body);
  console.log('OK  GET /api/attendance/stats -> totalAll =', stats.json.stats.totalAll);

  console.log('\nSEMUA SMOKE TEST VERCEL LULUS');
})().catch((e) => {
  console.error('SMOKE TEST GAGAL:', e.message);
  process.exit(1);
});
