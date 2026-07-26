// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// ===== DATABASE =====
const DB_FILE = path.join(__dirname, 'db.json');
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ senders: [], logs: [] }));
}
function readDB() { return JSON.parse(fs.readFileSync(DB_FILE)); }
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// ===== SENDER MANAGER =====
app.get('/senders', (req, res) => {
    const db = readDB();
    res.json(db.senders || []);
});

app.post('/senders', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const db = readDB();
    if (db.senders.find(s => s.phone === phone)) {
        return res.status(400).json({ error: 'Sender already exists' });
    }

    const newSender = { phone, status: 'pairing', id: null };
    db.senders.push(newSender);
    writeDB(db);

    res.json({ message: 'Pairing initiated', phone });
    startPairing(phone);
});

app.delete('/senders/:phone', (req, res) => {
    const phone = req.params.phone;
    let db = readDB();
    db.senders = db.senders.filter(s => s.phone !== phone);
    writeDB(db);
    const sessionPath = path.join(__dirname, 'auth', `${phone}_creds`);
    fs.removeSync(sessionPath);
    res.json({ message: `Sender ${phone} deleted` });
});

// ===== PAIRING ENGINE =====
async function startPairing(phone) {
    const sessionPath = path.join(__dirname, 'auth', `${phone}_creds`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Chrome (Linux)', '', ''],
        phoneNumber: phone,
        pairingCode: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, pairingCode } = update;

        if (pairingCode) {
            console.log(`[+] Pairing code for ${phone}: ${pairingCode}`);
            io.emit('pairing_code', { phone, code: pairingCode });
        }

        if (connection === 'open') {
            console.log(`[+] ${phone} connected!`);
            const db = readDB();
            const sender = db.senders.find(s => s.phone === phone);
            if (sender) {
                sender.status = 'connected';
                sender.id = sock.authState.creds.me?.id || null;
                writeDB(db);
            }
            io.emit('sender_updated', { phone, status: 'connected' });
        }

        if (connection === 'close') {
            console.log(`[-] ${phone} disconnected`);
            setTimeout(() => startPairing(phone), 5000);
        }
    });
}

// ===== KIRIM BUG =====
app.post('/attack', (req, res) => {
    const { target, bug, intensity, duration } = req.body;
    if (!target || !bug) return res.status(400).json({ error: 'Target and bug required' });

    console.log(`[ATTACK] Target: ${target}, Bug: ${bug}, Intensity: ${intensity}, Duration: ${duration}`);

    const db = readDB();
    db.logs.unshift({
        time: new Date().toISOString(),
        target,
        bug,
        intensity,
        duration,
        status: 'BERHASIL'
    });
    writeDB(db);

    res.json({ message: 'Attack sent!', target, bug });
});

app.get('/logs', (req, res) => {
    const db = readDB();
    res.json(db.logs || []);
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', uptime: process.uptime() });
});

io.on('connection', (socket) => {
    console.log('[Socket] Client connected');
    socket.on('disconnect', () => console.log('[Socket] Client disconnected'));
});

server.listen(PORT, () => {
    console.log(`[+] Backend running on port ${PORT}`);
    console.log(`[+] Socket.IO ready for pairing codes`);
});