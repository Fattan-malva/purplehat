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

// Bersihkan room sisa (tidak ada layar aktif) lebih dari 24 jam saat server start
(function cleanupOldRooms() {
  const day = 24 * 60 * 60 * 1000;
  let changed = false;
  Object.keys(rooms).forEach((code) => {
    if (Date.now() - (rooms[code].createdAt || 0) > day) {
      delete rooms[code];
      changed = true;
    }
  });
  if (changed) saveData({ rooms });
})();

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
  // HP: masuk lewat qr.html -> gate-install.html (wajib pasang PWA)
  //     -> index.html (controller).
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  if (isMobile) {
    res.redirect('/controller/qr.html' + qs);
  } else {
    res.redirect('/screen/index.html');
  }
});

// HTML dan JS selalu revalidate (Cloudflare default menaruh max-age=14400 di
// semua aset statis; tanpa ini, HP bisa menyimpan halaman lama berjam-jam).
app.use(express.static(publicDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
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

// Proxy search SoundCloud ke backend FastAPI (soundcloud/main.py)
app.get('/api/search-soundcloud', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await fetch(`http://localhost:${process.env.API_PORT || 8000}/soundcloud/search?${qs}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia. Jalankan backend di port 8000.' });
  }
});

// Proxy detail track SoundCloud (dipakai halaman player-sc.html)
app.get('/api/soundcloud/track', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await fetch(`http://localhost:${process.env.API_PORT || 8000}/soundcloud/track?${qs}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia. Jalankan backend di port 8000.' });
  }
});

// ==== Spotify ================================================================
const SPOTIFY_BASE = () => `http://localhost:${process.env.API_PORT || 8000}/spotify`;

// Cari track Spotify (endpoint backend pakai token anonim, tidak butuh sp_dc)
app.get('/api/search-spotify', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await fetch(`${SPOTIFY_BASE()}/search?${qs}`);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia. Jalankan backend di port 8000.' });
  }
});

// Metadata track Spotify (butuh sp_dc)
app.get('/api/spotify/track', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await fetch(`${SPOTIFY_BASE()}/track?${qs}`);
    const txt = await r.text();
    res.status(r.status).set('Content-Type', 'application/json').send(txt);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia.' });
  }
});

// Lirik tersinkron (butuh sp_dc)
app.get('/api/spotify/lyrics', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await fetch(`${SPOTIFY_BASE()}/lyrics?${qs}`);
    const txt = await r.text();
    res.status(r.status).set('Content-Type', 'application/json').send(txt);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia.' });
  }
});

// Validasi sp_dc (dipakai controller sebelum search)
app.get('/api/spotify/validate', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await fetch(`${SPOTIFY_BASE()}/validate?${qs}`);
    const txt = await r.text();
    res.status(r.status).set('Content-Type', 'application/json').send(txt);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia.' });
  }
});

// Proxy embed Spotify. WAJIB lewat Express supaya satu origin dengan frame
// player (/screen/spotify/player-spty.html) -> contentDocument iframe bisa
// dibaca untuk kontrol playback.
app.get('/api/spotify/embed-proxy', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await fetch(`${SPOTIFY_BASE()}/embed-proxy?${qs}`);
    const body = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.send(body);
  } catch (e) {
    res.status(502).send('Spotify embed tidak tersedia.');
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
    rooms[code] = { code, createdAt: Date.now(), queue: [], currentIndex: -1, playing: false, volume: 30, position: 0, duration: 0, sp_dc: null };
    saveData({ rooms });
  }
  return rooms[code];
}

// ==== Presence long-poll =====================================================
// Halaman QR layar "menunggu controller" TANPA koneksi idle yang bisa mati:
// ia memanggil GET /api/room/:code/presence. Request ditahan di sini sampai ada
// controller connect (dibalas seketika) atau timeout (~25 detik, lalu dicoba
// lagi). Karena setiap request punya umur terbatas, koneksi mati = request gagal
// = otomatis retry, sehingga event pairing tidak pernah kelewat.
const presenceWaiters = new Map(); // code -> Set<{ res, timer }>

function roomHasController(code) {
  let found = false;
  sockets.forEach((meta) => {
    if (meta.code === code && meta.role === 'controller') found = true;
  });
  return found;
}

function flushPresence(code) {
  const set = presenceWaiters.get(code);
  if (!set) return;
  presenceWaiters.delete(code);
  set.forEach((w) => {
    clearTimeout(w.timer);
    try { w.res.json({ hasController: true }); } catch (e) {}
  });
}

var saveTimer = null;

function persistRoom(code) {
  // Deferred write: STATE_SYNC dari layar bisa datang beruntun saat tombol
  // volume ditekan cepat. writeFileSync sinkron per pesan memblokir event loop
  // Node sehingga relay perintah lain (play/next/seek) ikut tersendat.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { saveData({ rooms }); } catch (e) {}
  }, 400);
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
  res.json({ code, qr: finalBase + '/controller/qr.html?pair=' + code, baseUrl: finalBase });
});

// API: presence long-poll (dipakai halaman QR layar untuk menunggu controller).
// Balas segera bila controller sudah ada; kalau belum, tahan sampai ~25 detik.
app.get('/api/room/:code/presence', (req, res) => {
  const code = req.params.code.toUpperCase();
  res.setHeader('Cache-Control', 'no-store');
  if (roomHasController(code)) return res.json({ hasController: true });

  const waiter = { res, timer: null };
  waiter.timer = setTimeout(() => {
    const s = presenceWaiters.get(code);
    if (s) { s.delete(waiter); if (!s.size) presenceWaiters.delete(code); }
    try { res.json({ hasController: false }); } catch (e) {}
  }, 25000);

  let set = presenceWaiters.get(code);
  if (!set) { set = new Set(); presenceWaiters.set(code, set); }
  set.add(waiter);

  req.on('close', () => {
    clearTimeout(waiter.timer);
    const s = presenceWaiters.get(code);
    if (s) { s.delete(waiter); if (!s.size) presenceWaiters.delete(code); }
  });
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

// API: sp_dc per room (cookie login Spotify). Dipakai sumber Spotify.
// Disimpan di backend/data/purplehat.json -> rooms[code].sp_dc
app.get('/api/room/:code/spdc', (req, res) => {
  const room = rooms[req.params.code.toUpperCase()];
  if (!room) return res.status(404).json({ error: 'Room tidak ditemukan' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ has: !!room.sp_dc });
});

// Validasi sp_dc tersimpan (controller tidak perlu tahu nilainya).
app.get('/api/room/:code/spdc/validate', async (req, res) => {
  const room = rooms[req.params.code.toUpperCase()];
  if (!room) return res.status(404).json({ error: 'Room tidak ditemukan' });
  if (!room.sp_dc) return res.status(409).json({ error: 'sp_dc belum diatur' });
  try {
    const r = await fetch(`${SPOTIFY_BASE()}/validate?sp_dc=${encodeURIComponent(room.sp_dc)}`);
    const txt = await r.text();
    res.status(r.status).set('Content-Type', 'application/json').send(txt);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia.' });
  }
});

app.post('/api/room/:code/spdc', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: 'Room tidak ditemukan' });
  const spDc = (req.body && req.body.sp_dc ? String(req.body.sp_dc) : '').trim();
  if (!spDc || spDc.length < 20) return res.status(400).json({ error: 'sp_dc tidak valid' });
  room.sp_dc = spDc;
  saveData({ rooms });
  // Teruskan ke layar player supaya frame Spotify bisa menggunakannya.
  broadcastToRoom(code, { type: 'sp_dc', payload: { sp_dc: spDc }, ts: Date.now() }, 'controller');
  res.json({ ok: true });
});

app.delete('/api/room/:code/spdc', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms[code];
  if (room) { room.sp_dc = null; saveData({ rooms }); }
  broadcastToRoom(code, { type: 'sp_dc', payload: { sp_dc: null }, ts: Date.now() }, 'controller');
  res.json({ ok: true });
});

// API: delete room (dipanggil saat player logout, supaya tidak numpuk di file data)
app.delete('/api/room/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  if (rooms[code]) {
    delete rooms[code];
    saveData({ rooms });
  }
  // Beri tahu controller di room ini lalu tutup socket-nya, supaya tidak
  // menggantung di room yang sudah dihapus (mis. layar logout saat HP masih
  // terhubung). Controller akan kembali ke layar pairing.
  sockets.forEach((meta, sock) => {
    if (meta.code !== code) return;
    if (meta.role === 'controller') {
      try {
        if (sock.readyState === WebSocket.OPEN) {
          sock.send(JSON.stringify({ type: 'room_closed', payload: {}, ts: Date.now() }));
        }
      } catch (e) {}
    }
    try { sock.close(); } catch (e) {}
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
    // Bangunkan halaman QR yang sedang long-poll presence untuk room ini.
    flushPresence(code);
  } else if (role === 'screen') {
    // Kalau sudah ada controller di room ini (mis. controller connect lebih
    // dulu daripada socket layar), beri tahu layar yang baru terhubung supaya
    // ia langsung pindah ke player.html. Menutup celah race yang membuat layar
    // macet di halaman QR.
    let hasController = false;
    sockets.forEach((meta) => {
      if (meta !== ws && meta.code === code && meta.role === 'controller') hasController = true;
    });
    if (hasController) {
      try { ws.send(JSON.stringify({ type: 'controller_joined', payload: {}, ts: Date.now() })); } catch (e) {}
    }
    // Kirim sp_dc tersimpan supaya frame Spotify bisa langsung dipakai
    // setelah layar reconnect (tanpa menunggu controller mengirim ulang).
    if (room.sp_dc) {
      try { ws.send(JSON.stringify({ type: 'sp_dc', payload: { sp_dc: room.sp_dc }, ts: Date.now() })); } catch (e) {}
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    msg.ts = Date.now();

    // Controller bisa menyimpan sp_dc lewat WebSocket (selain HTTP POST).
    if (role === 'controller' && msg.type === 'set_sp_dc') {
      const spDc = (msg.payload && msg.payload.sp_dc ? String(msg.payload.sp_dc) : '').trim();
      if (spDc && spDc.length >= 20) {
        room.sp_dc = spDc;
        saveData({ rooms });
      }
    }

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
