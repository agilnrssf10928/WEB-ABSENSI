const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SECRET_KEY = 'presensiku-super-secure-key-2026';

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

function createToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
}

// Rumus Jarak Haversine (meter)
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
  const R = 6371e3; // meter
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Simpan Foto Base64
function saveBase64Image(dataString, subfolder = 'selfies') {
  if (!dataString) return null;
  if (!dataString.startsWith('data:image/')) return dataString; // Jika sudah berupa URL
  const match = dataString.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buf = Buffer.from(match[2], 'base64');
  const filename = `${subfolder}-${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`;
  const dir = path.join(__dirname, '../uploads', subfolder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dest = path.join(dir, filename);
  fs.writeFileSync(dest, buf);
  return `/uploads/${subfolder}/${filename}`;
}

// Format Waktu Sekarang (YYYY-MM-DD dan HH:MM:SS)
function getNowFormatted() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return {
    date: `${year}-${month}-${date}`,
    time: `${hours}:${minutes}:${seconds}`,
    timeMinutes: `${hours}:${minutes}`
  };
}

// Evaluasi status masuk (present vs late)
function evaluateStatus(clockInTime, workStartTime, toleranceMinutes) {
  const [inH, inM] = clockInTime.split(':').map(Number);
  const [startH, startM] = workStartTime.split(':').map(Number);

  const inTotalMin = inH * 60 + inM;
  const startTotalMin = startH * 60 + startM;

  if (inTotalMin <= startTotalMin + Number(toleranceMinutes || 0)) {
    return 'present';
  }
  return 'late';
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  calculateDistance,
  saveBase64Image,
  getNowFormatted,
  evaluateStatus
};
