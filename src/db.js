const Database = require('better-sqlite3');
const initSqlJs = require('sql.js');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// On Vercel (serverless), use in-memory DB since filesystem is read-only
// Locally, use file-based DB
// Locally, persist to a file so data survives restarts
const isVercel = process.env.VERCEL === '1';
const dbPath = path.join(__dirname, '../database.sqlite');
const db = isVercel ? new Database(':memory:') : new Database(dbPath);

let sqlDb = null;
let initPromise = null;

function persist() {
  if (isVercel) return; // read-only filesystem on Vercel
  try {
    const data = sqlDb.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) {
    console.error('DB persist failed:', e.message);
  }
}

// sql.js (WASM) butuh inisialisasi asinkron sebelum dipakai
function loadDb() {
  if (!initPromise) {
    initPromise = initSqlJs({
      // Pastikan wasm ditemukan walau cwd berbeda (penting di Vercel)
      locateFile: (file) => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')), file)
    }).then((SQL) => {
      if (isVercel) {
        sqlDb = new SQL.Database();
      } else if (fs.existsSync(dbPath)) {
        sqlDb = new SQL.Database(fs.readFileSync(dbPath));
      } else {
        sqlDb = new SQL.Database();
      }
      initDb();
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
      persist(); // simpan ke file (diabaikan di Vercel)
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
  }
};

// Helper Password
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');

// Inisialisasi Database Sekolah
function initDb() {
  db.exec(`
  sqlDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nip TEXT UNIQUE NOT NULL, -- Berisi NISN untuk Siswa atau NIP untuk Guru/Admin
    insertAttendance.run(3, yStr, '06:55:12', '15:02:40', 'present', 45, 50, 'Lobi Depan Gedung A', 'Lobi Depan Gedung A', 'Hadir tepat waktu');
    // Siti terlambat 10 menit
    insertAttendance.run(4, yStr, '07:25:05', '15:00:15', 'late', 55, 60, 'Gerbang Depan', 'Gerbang Depan', 'Terlambat karena angkot macet');
    

    // Ahmad mengajukan dispensasi lomba OSN
    const insertLeave = db.prepare(`
      INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status, admin_notes)
    insertLeave.run(5, 'dispensation', yStr, yStr, 'Mewakili sekolah di Olimpiade Sains Tingkat Provinsi', 'approved', 'Disetujui pihak sekolah, sukses lombanya');
    insertAttendance.run(5, yStr, null, null, 'dispensation', null, null, null, null, 'Dispensasi Lomba OSN Provinsi');
  }

  if (!isVercel) persist();
}

initDb();

module.exports = {
  db,
  dbReady: loadDb(),
  hashPassword,
  verifyPassword
};
