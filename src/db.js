const initSqlJs = require('sql.js');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// ============================================================
// DATABASE TERPUSAT DI GITHUB
// Database disimpan sebagai file di repo GitHub (DATABASE-ABSENSI).
// - Saat server start  : DB diunduh dari raw URL (fallback: file lokal)
// - Setiap kali ditulis: DB otomatis di-push balik ke GitHub (debounce 3 detik)
// Token via env GITHUB_TOKEN agar tidak tersimpan di kode.
// ============================================================

const isVercel = process.env.VERCEL === '1';
const dbPath = path.join(__dirname, '../database.sqlite');

// Raw URL database terpusat
const REMOTE_RAW_URL = process.env.DB_REMOTE_URL || 'https://raw.githubusercontent.com/agilnrssf10928/DATABASE-ABSENSI/refs/heads/main/DATABASE';
const REMOTE_API_URL = process.env.DB_REMOTE_API_URL || 'https://api.github.com/repos/agilnrssf10928/DATABASE-ABSENSI/contents/DATABASE';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// ---
// Remote write state (debounce + lock + retry)
// ---
let sqlDb = null;
let initPromise = null;
let pushTimer = null;
let isPushing = false;
let pushQueued = false;
let lastKnownSha = null; // sha file terakhir yang diketahui dari GitHub
let lastPersistError = null;

function persistNow() {
  if (!sqlDb) return Promise.resolve();
  let data;
  try {
    data = Buffer.from(sqlDb.export());
  } catch (e) {
    console.error('DB export failed:', e.message);
    return Promise.resolve();
  }

  // Selalu simpan salinan lokal sebagai cadangan & cache
  if (!isVercel) {
    try { fs.writeFileSync(dbPath, data); } catch (_) {}
  }

  // Tanpa token: hanya simpan lokal (mode lama)
  if (!GITHUB_TOKEN) return Promise.resolve();

  return pushToGithub(data);
}

async function pushToGithub(data) {
  if (isPushing) { pushQueued = true; return; }
  isPushing = true;
  try {
    // Ambil sha terkini agar tidak menimpa versi lain
    let sha = lastKnownSha;
    try {
      const head = await fetch(REMOTE_API_URL, {
        headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'web-absensi' }
      });
      if (head.ok) {
        const meta = await head.json();
        if (meta && meta.sha) sha = meta.sha;
      }
    } catch (_) { /* pakai sha cache kalau ada */ }

    const res = await fetch(REMOTE_API_URL, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'web-absensi'
      },
      body: JSON.stringify({
        message: `Auto-save database absensi (${new Date().toISOString()})`,
        content: data.toString('base64'),
        ...(sha ? { sha } : {})
      })
    });

    if (res.ok) {
      const meta = await res.json().catch(() => null);
      if (meta && meta.content && meta.content.sha) lastKnownSha = meta.content.sha;
      lastPersistError = null;
    } else if (res.status === 409) {
      // Konflik: muat ulang versi remote agar perubahan berikutnya tidak korup
      console.error('DB push conflict (409) — akan muat ulang versi remote di siklus berikutnya.');
      lastKnownSha = null;
      lastPersistError = 'conflict';
    } else {
      const txt = await res.text().catch(() => '');
      lastPersistError = `HTTP ${res.status}: ${txt.slice(0, 200)}`;
      console.error('DB push gagal:', lastPersistError);
    }
  } catch (e) {
    lastPersistError = e.message;
    console.error('DB push error:', e.message);
  } finally {
    isPushing = false;
    if (pushQueued) {
      pushQueued = false;
      schedulePush(1000);
    }
  }
}

function schedulePush(delayMs = 3000) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    persistNow().catch(() => {});
  }, delayMs);
}

// Kompatibilitas: persist() dipanggil dari makeStatement/transaction
function persist() {
  schedulePush();
}

// Inisialisasi Database Sekolah
function initDb() {
  sqlDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nip TEXT UNIQUE NOT NULL, -- Berisi NISN untuk Siswa atau NIP untuk Guru/Admin
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student', -- 'student', 'teacher', 'admin'
      department TEXT DEFAULT 'Umum',
      position TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      office_name TEXT DEFAULT 'SMK Pariwisata Cikarang Selatan',
      office_lat REAL DEFAULT -6.3614144,
      office_lng REAL DEFAULT 107.0540305,
      office_radius_meters INTEGER DEFAULT 150,
      enable_radius_restriction INTEGER DEFAULT 1,
      work_start_time TEXT DEFAULT '07:00',
      work_end_time TEXT DEFAULT '15:00',
      late_tolerance_minutes INTEGER DEFAULT 15
    );

    CREATE TABLE IF NOT EXISTS attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      clock_in TEXT,
      clock_out TEXT,
      status TEXT NOT NULL DEFAULT 'present', -- 'present', 'late', 'excused', 'sick', 'dispensation'
      photo_in TEXT,
      photo_out TEXT,
      lat_in REAL,
      lng_in REAL,
      lat_out REAL,
      lng_out REAL,
      distance_in REAL,
      distance_out REAL,
      address_in TEXT,
      address_out TEXT,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date)
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL, -- 'sick', 'permission', 'dispensation'
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      attachment TEXT DEFAULT '',
      status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
      admin_notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed settings sekolah
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get();
  if (settingsCount.count === 0) {
    db.prepare(`
      INSERT INTO settings (id, office_name, office_lat, office_lng, office_radius_meters, enable_radius_restriction, work_start_time, work_end_time, late_tolerance_minutes)
      VALUES (1, 'SMK Pariwisata Cikarang Selatan', -6.3614144, 107.0540305, 150, 1, '07:00', '15:00', 15)
    `).run();
  }

  // Akun admin utama — satu-satunya akun bawaan, juga dipastikan ada di database lama
  const agilExists = db.prepare('SELECT id FROM users WHERE nip = ?').get('agil');
  if (!agilExists) {
    db.prepare(`
      INSERT INTO users (nip, name, email, password_hash, role, department, position, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'agil',
      'Agil',
      'agil@sekolah.sch.id',
      hashPassword('12345678'),
      'admin',
      'Pimpinan Sekolah',
      'Kepala Sekolah',
      '081234567890'
    );
  }
}

async function fetchRemoteDb() {
  const res = await fetch(REMOTE_RAW_URL, { headers: { 'User-Agent': 'web-absensi', 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 16) throw new Error('File remote kosong/tidak valid');
  return buf;
}

// Helper Password
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  try {
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch (e) {
    return false;
  }
}

// sql.js (WASM) butuh inisialisasi asinkron sebelum dipakai
function loadDb() {
  if (!initPromise) {
    initPromise = initSqlJs({
      // Pastikan wasm ditemukan walau cwd berbeda (penting di Vercel)
      locateFile: (file) => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')), file)
    }).then(async (SQL) => {
      let loaded = false;

      // 1) Coba unduh database terpusat dari GitHub
      try {
        const buf = await fetchRemoteDb();
        sqlDb = new SQL.Database(buf);
        // Simpan salinan lokal sebagai cache
        if (!isVercel) { try { fs.writeFileSync(dbPath, buf); } catch (_) {} }
        loaded = true;
        console.log('DB: dimuat dari database terpusat GitHub (DATABASE-ABSENSI).');
      } catch (e) {
        console.error('DB: gagal ambil database remote (' + e.message + '), coba file lokal...');
      }

      // 2) Fallback: file lokal
      if (!loaded && fs.existsSync(dbPath)) {
        sqlDb = new SQL.Database(fs.readFileSync(dbPath));
        loaded = true;
        console.log('DB: dimuat dari file lokal database.sqlite.');
      }

      // 3) Fallback terakhir: database baru kosong
      if (!loaded || !sqlDb) {
        sqlDb = new SQL.Database();
        console.log('DB: membuat database baru.');
      }

      initDb();

      // Dapatkan sha file remote untuk pembaruan berikutnya
      if (GITHUB_TOKEN) {
        try {
          const head = await fetch(REMOTE_API_URL, {
            headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'web-absensi' }
          });
          if (head.ok) {
            const meta = await head.json();
            if (meta && meta.sha) lastKnownSha = meta.sha;
          }
        } catch (_) {}
      }

      return sqlDb;
    });
  }
  return initPromise;
}

function getInsertRowid() {
  const res = sqlDb.exec('SELECT last_insert_rowid() AS id');
  return res.length ? Number(res[0].values[0][0]) : 0;
}

// Wrapper menyerupai API better-sqlite3 (prepare/run/get/all/transaction)
// agar routes tidak perlu diubah. Setiap operasi meng-compile statement baru
// sehingga statement boleh di-reuse berkali-kali seperti better-sqlite3.
function makeStatement(sql) {
  return {
    run(...params) {
      const stmt = sqlDb.prepare(sql);
      let changes, lastInsertRowid;
      try {
        stmt.bind(params);
        stmt.step();
        // Catat dulu SEBELUM persist(), karena export() me-reopen koneksi
        // sehingga last_insert_rowid()/changes akan ter-reset
        changes = sqlDb.getRowsModified();
        lastInsertRowid = getInsertRowid();
      } finally {
        stmt.free();
      }
      persist(); // jadwalk simpan ke GitHub + file lokal
      return { changes, lastInsertRowid };
    },
    get(...params) {
      const stmt = sqlDb.prepare(sql);
      try {
        stmt.bind(params);
        if (stmt.step()) return stmt.getAsObject();
        return null;
      } finally {
        stmt.free();
      }
    },
    all(...params) {
      const stmt = sqlDb.prepare(sql);
      const rows = [];
      try {
        stmt.bind(params);
        while (stmt.step()) rows.push(stmt.getAsObject());
      } finally {
        stmt.free();
      }
      return rows;
    }
  };
}

const db = {
  prepare(sql) {
    if (!sqlDb) throw new Error('Database belum siap. Pastikan menunggu `dbReady` terlebih dahulu.');
    return makeStatement(sql);
  },
  exec(sql) {
    if (!sqlDb) throw new Error('Database belum siap. Pastikan menunggu `dbReady` terlebih dahulu.');
    return sqlDb.exec(sql);
  },
  transaction(fn) {
    return (...args) => {
      sqlDb.exec('BEGIN');
      try {
        const result = fn(...args);
        sqlDb.exec('COMMIT');
        persist();
        return result;
      } catch (e) {
        try { sqlDb.exec('ROLLBACK'); } catch (_) { /* ignore */ }
        throw e;
      }
    };
  },
  pragma() {},
  get open() {
    return !!sqlDb;
  },
  // Endpoint kesehatan sinkronisasi (untuk /api/db-status bila perlu)
  get syncStatus() {
    return {
      remote: REMOTE_RAW_URL,
      tokenConfigured: !!GITHUB_TOKEN,
      lastError: lastPersistError,
      sha: lastKnownSha ? lastKnownSha.slice(0, 8) : null
    };
  }
};

module.exports = {
  db,
  dbReady: loadDb(),
  hashPassword,
  verifyPassword
};
