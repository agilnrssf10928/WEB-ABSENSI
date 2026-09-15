const { dbReady } = require('../src/db');
const handleRequest = require('../src/server');

// Vercel Serverless Function handler.
// sql.js butuh inisialisasi WASM sebelum dipakai, jadi tunggu dbReady dulu.
module.exports = async (req, res) => {
  try {
    await dbReady;
    return await handleRequest(req, res);
  } catch (err) {
    console.error('Function crashed:', err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Internal Server Error', detail: err.message }));
    }
  }
};
