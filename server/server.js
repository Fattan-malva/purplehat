// Purplehat Realtime Server
// - Serves static files (screen + controller)
// - WebSocket relay between screen (player) & controller (mobile)
// - Pairing via 6-char code + QR
// - Data persisted to JSON (backend/data/purplehat.json)

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public');
const dataDir = path.join(__dirname, '..', 'backend', 'data');
const dataFile = path.join(dataDir, 'purplehat.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (e) {
    return { rooms: {} };
  }
}
function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

const rooms = loadData().rooms;
const sockets = new Map(); // socket -> {role, code, id}

const app = express();
app.set('trust proxy', true); // penting untuk tunneling (ngrok/cloudflare)
app.use(cors());
app.use(express.json());

// Root: auto-detect device (harus sebelum express.static agar tidak ke-serve index.html)
app.get('/', (req, res) => {
  const ua = req.get('user-agent') || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  // Redirect (bukan sendFile) supaya URL browser ikut berubah ke path
  // sebenarnya. Kalau sendFile, browser tetap di "/" sehingga link relatif
  // (controller.css, controller.js) di-resolve ke "/controller.css" -> 404,
  // akibatnya CSS tidak tampil dan JS tidak jalan di HP.
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  if (isMobile) {
    res.redirect('/controller/index.html' + qs);
  } else {
    res.redirect('/screen/index.html');
  }
});

app.use(express.static(publicDir));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));

// Proxy search ke backend FastAPI agar satu origin (tunneling friendly)
app.get('/api/search', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await fetch(`http://localhost:${process.env.API_PORT || 8000}/search?${qs}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia. Jalankan backend di port 8000.' });
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getRoom(code) {
  if (!rooms[code]) {
    rooms[code] = { code, createdAt: Date.now(), queue: [], currentIndex: -1, playing: false, volume: 80, position: 0, duration: 0 };
    saveData({ rooms });
  }
  return rooms[code];
}

function persistRoom(code) {
  saveData({ rooms });
}

function broadcastToRoom(code, msg, exceptRole) {
  sockets.forEach((meta, ws) => {
    if (meta.code === code && ws.readyState === WebSocket.OPEN) {
      if (exceptRole && meta.role === exceptRole) return;
      ws.send(JSON.stringify(msg));
    }
  });
}

// API: create room
app.post('/api/room/create', (req, res) => {
  let code = makeCode();
  while (rooms[code]) code = makeCode();
  const room = getRoom(code);
  const forwardedHost = req.headers['x-forwarded-host'];
  const finalBase = process.env.PUBLIC_URL
    ? process.env.PUBLIC_URL.replace(/\/$/, '')
    : (req.protocol + '://' + (forwardedHost || req.get('host'))).replace(/\/$/, '');
  res.json({ code, qr: finalBase + '/?pair=' + code, baseUrl: finalBase });
});

// API: check room (full state for polling fallback)
app.get('/api/room/:code', (req, res) => {
  const room = rooms[req.params.code];
  if (!room) return res.status(404).json({ error: 'Room tidak ditemukan' });
  const current = room.queue[room.currentIndex] || null;
  res.json({
    code: room.code,
    queue: room.queue,
    currentIndex: room.currentIndex,
    current: current ? { ...current, index: room.currentIndex } : null,
    playing: room.playing,
    volume: room.volume,
    position: room.position,
    duration: room.duration
  });
});

// API: command fallback (when WebSocket unavailable, e.g. some tunnels)
app.post('/api/room/:code/command', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: 'Room tidak ditemukan' });
  const msg = { type: req.body && req.body.type, payload: (req.body && req.body.payload) || {}, ts: Date.now(), via: 'http' };
  sockets.forEach((meta, ws) => {
    if (meta.code === code && meta.role === 'screen' && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });
  res.json({ ok: true });
});

// API: generate QR png data url
app.get('/api/qr', async (req, res) => {
  try {
    const dataUrl = await QRCode.toDataURL(req.query.text || '', { width: 256 });
    res.json({ dataUrl });
  } catch (e) {
    res.status(500).json({ error: 'qr error' });
  }
});

// WS relay
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const role = url.searchParams.get('role'); // 'screen' | 'controller'
  const code = (url.searchParams.get('code') || '').toUpperCase();

  if (!code || !role) {
    ws.close();
    return;
  }

  const room = getRoom(code);
  sockets.set(ws, { role, code, id: Date.now() + Math.random() });

  if (role === 'controller') {
    broadcastToRoom(code, { type: 'controller_joined', payload: {}, ts: Date.now() }, 'controller');
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    msg.ts = Date.now();

    // persist queue/state updates from screen (authoritative)
    if (role === 'screen') {
      switch (msg.type) {
        case 'STATE_SYNC':
          if (msg.payload && msg.payload.state) {
            room.queue = msg.payload.state.queue || room.queue;
            room.currentIndex = msg.payload.state.current ? msg.payload.state.current.index : room.currentIndex;
            room.playing = !!msg.payload.state.playing;
            room.volume = msg.payload.state.volume ?? room.volume;
            room.position = msg.payload.state.position ?? 0;
            room.duration = msg.payload.state.duration ?? 0;
            persistRoom(code);
          }
          break;
        case 'QUEUE_UPDATE':
          if (msg.payload && msg.payload.queue) {
            room.queue = msg.payload.queue;
            persistRoom(code);
          }
          break;
      }
    }

    // relay to opposite room members
    broadcastToRoom(code, msg, role === 'screen' ? 'screen' : 'controller');
  });

  ws.on('close', () => {
    sockets.delete(ws);
    // Kalau controller terakhir putus, layar player kembali ke tampilan awal (QR)
    if (role === 'controller') {
      let remaining = 0;
      sockets.forEach((meta) => {
        if (meta.code === code && meta.role === 'controller') remaining++;
      });
      if (remaining === 0) {
        broadcastToRoom(code, { type: 'controller_left', payload: {}, ts: Date.now() }, 'controller');
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Purplehat running on http://localhost:${PORT}`);
});
