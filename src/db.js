const initSqlJs = require('sql.js');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// On Vercel (serverless), use in-memory DB since filesystem is read-only
// Locally, persist to a file so data survives restarts
const isVercel = process.env.VERCEL === '1';
const dbPath = path.join(__dirname, '../database.sqlite');

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

// Inisialisasi Database Sekolah
function initDb() {
  sqlDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nip TEXT UNIQUE NOT NULL, -- Berisi NISN untuk Siswa atau NIP untuk Guru/Admin
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student', -- 'admin' | 'teacher' | 'student'
      department TEXT DEFAULT 'Umum', -- Kelas (misal: XII RPL 1) atau Unit (Dewan Guru, Tata Usaha)
      position TEXT DEFAULT 'Siswa', -- Siswa, Ketua Kelas, Wali Kelas, Guru Pengajar, Kepala Sekolah, Staf TU
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

  // Seed data awal warga sekolah (Kepala Sekolah, Guru, Siswa berbagai kelas)
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (nip, name, email, password_hash, role, department, position, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. Admin / Kepala Sekolah (Bisa absen sendiri & memantau seluruh sekolah)
    insertUser.run(
      '197501012000031001',
      'Drs. H. Mulyadi, M.Pd',
      'admin@sekolah.sch.id',
      hashPassword('admin123'),
      'admin',
      'Pimpinan Sekolah',
      'Kepala Sekolah',
      '081234567890'
    );

    // 2. Guru / Wali Kelas
    insertUser.run(
      '198505122010012005',
      'Ibu Ratna Dewi, S.Pd',
      'guru@sekolah.sch.id',
      hashPassword('guru123'),
      'teacher',
      'Dewan Guru',
      'Wali Kelas & Guru Matematika',
      '081298765432'
    );

    // 3. Siswa Kelas XII RPL 1
    insertUser.run(
      '0061234567',
      'Budi Santoso',
      'budi@sekolah.sch.id',
      hashPassword('budi123'),
      'student',
      'XII RPL 1',
      'Ketua Kelas',
      '081311223344'
    );

    // 4. Siswa Kelas XI MIPA 2
    insertUser.run(
      '0072345678',
      'Siti Rahmawati',
      'siti@sekolah.sch.id',
      hashPassword('siti123'),
      'student',
      'XI MIPA 2',
      'Siswa',
      '081399887766'
    );

    // 5. Siswa Kelas X IPS 1
    insertUser.run(
      '0083456789',
      'Ahmad Fauzi',
      'ahmad@sekolah.sch.id',
      hashPassword('ahmad123'),
      'student',
      'X IPS 1',
      'Siswa',
      '081377665544'
    );

    // Seed data absensi kemarin untuk demo statistik
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];

    const insertAttendance = db.prepare(`
      INSERT INTO attendances (user_id, date, clock_in, clock_out, status, distance_in, distance_out, address_in, address_out, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Kepala Sekolah absen kemarin tepat waktu
    insertAttendance.run(1, yStr, '06:45:10', '15:15:20', 'present', 25, 30, 'Gerbang Utama Sekolah', 'Gerbang Utama Sekolah', 'Hadir tepat waktu');
    // Guru absen kemarin tepat waktu
    insertAttendance.run(2, yStr, '06:50:22', '15:05:10', 'present', 35, 40, 'Gerbang Sekolah', 'Gerbang Sekolah', 'Piket pagi');
    // Budi hadir tepat waktu
    insertAttendance.run(3, yStr, '06:55:12', '15:02:40', 'present', 45, 50, 'Lobi Depan Gedung A', 'Lobi Depan Gedung A', 'Hadir tepat waktu');
    // Siti terlambat 10 menit
    insertAttendance.run(4, yStr, '07:25:05', '15:00:15', 'late', 55, 60, 'Gerbang Depan', 'Gerbang Depan', 'Terlambat karena angkot macet');

    // Ahmad mengajukan dispensasi lomba OSN
    const insertLeave = db.prepare(`
      INSERT INTO leave_requests (user_id, type, start_date, end_date, reason, status, admin_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertLeave.run(5, 'dispensation', yStr, yStr, 'Mewakili sekolah di Olimpiade Sains Tingkat Provinsi', 'approved', 'Disetujui pihak sekolah, sukses lombanya');
    insertAttendance.run(5, yStr, null, null, 'dispensation', null, null, null, null, 'Dispensasi Lomba OSN Provinsi');
  }

  // Akun admin utama — selalu dipastikan ada, juga di database lama
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

  if (!isVercel) persist();
}

module.exports = {
  db,
  dbReady: loadDb(),
  hashPassword,
  verifyPassword
};
