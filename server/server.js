// Purplehat Realtime Server
// - Serves static files (screen + controller)
// - WebSocket relay between screen (player) & controller (mobile)
// - Pairing via 6-char code + QR
// - Identitas room (MAC -> PairingCode) disimpan di SQL Server (tabel MstRoom)
//   lewat backend FastAPI. Queue/posisi playback cukup di memori.

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public');
const API_BASE = () => `http://localhost:${process.env.API_PORT || 8000}`;

// Runtime rooms (queue/posisi/volume) - TIDAK dipersist (hanya di memori).
const rooms = {};
const sockets = new Map(); // socket -> {role, code, id}

// ---- Helper ke backend FastAPI (Python) --------------------------------
async function apiGet(pathname) {
  const r = await fetch(`${API_BASE()}${pathname}`, { cache: 'no-store' });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { status: r.status, data };
}
async function apiSend(method, pathname, body) {
  const r = await fetch(`${API_BASE()}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  return { status: r.status, data };
}

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

// ==== Karaoke (bank lagu SQL Server + pemutar mpv) ==========================
const KARAOKE_BASE = () => `http://localhost:${process.env.API_PORT || 8000}/karaoke`;

// Pencarian lagu karaoke (semua lagu di MstSongBank tampil di search).
app.get('/api/karaoke/search', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await fetch(`${KARAOKE_BASE()}/search?${qs}`);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia. Jalankan backend di port 8000.' });
  }
});

// Status pemutar mpv.
app.get('/api/karaoke/player/state', async (req, res) => {
  try {
    const r = await fetch(`${KARAOKE_BASE()}/player/state`);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia.' });
  }
});

// Parameter FX aktif (key/echo/tempo/EQ/channel).
app.get('/api/karaoke/player/fx', async (req, res) => {
  try {
    const r = await fetch(`${KARAOKE_BASE()}/player/fx`);
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia.' });
  }
});

// Teruskan perintah player (load/play/pause/toggle/stop/seek/volume/fx) ke backend.
// Body JSON diteruskan apa adanya. Pakai satu handler agar ringkas & konsisten.
app.post('/api/karaoke/player/:action', async (req, res) => {
  const action = String(req.params.action || '');
  const allowed = ['load', 'play', 'pause', 'toggle', 'stop', 'seek', 'volume', 'fx'];
  if (!allowed.includes(action)) return res.status(400).json({ error: 'Aksi tidak dikenal' });
  try {
    const r = await fetch(`${KARAOKE_BASE()}/player/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia.' });
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
  const c = String(code || '').toUpperCase();
  if (!rooms[c]) {
    rooms[c] = { code: c, createdAt: Date.now(), roomId: null, mac: null, queue: [], currentIndex: -1, playing: false, volume: 30, position: 0, duration: 0, sp_dc: null };
  }
  return rooms[c];
}

// Ambil room dari memori; bila belum ada, muat identitasnya dari DB (MstRoom).
// Dipakai agar room hasil sesi/restart sebelumnya tetap bisa diakses controller.
async function loadRoom(code) {
  const c = String(code || '').toUpperCase();
  if (rooms[c]) return rooms[c];
  try {
    const r = await apiGet('/room/' + encodeURIComponent(c));
    if (r.status === 200 && r.data) {
      const room = getRoom(c);
      room.roomId = r.data.roomId || null;
      room.mac = r.data.mac || null;
      room.sp_dc = r.data.sp_dc || null;
      return room;
    }
  } catch (e) {}
  return null;
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
  // Identitas room ada di DB; yang perlu disinkronkan hanyalah flag IsRunning.
  // Debounce karena STATE_SYNC bisa datang beruntun (mis. volume ditekan cepat).
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const room = rooms[code];
    if (!room) return;
    apiSend('PUT', `/room/${encodeURIComponent(code)}/running`, { running: !!room.playing }).catch(() => {});
  }, 500);
}

function broadcastToRoom(code, msg, exceptRole) {
  sockets.forEach((meta, ws) => {
    if (meta.code === code && ws.readyState === WebSocket.OPEN) {
      if (exceptRole && meta.role === exceptRole) return;
      ws.send(JSON.stringify(msg));
    }
  });
}

// API: create/resolve room. PairingCode stabil per device (MAC dikirim player/Flutter).
app.post('/api/room/create', async (req, res) => {
  const mac = (req.query && req.query.mac) || (req.body && req.body.mac) || '';
  let code = null;
  let roomId = null;
  let spDc = null;
  try {
    const r = await apiGet('/room/resolve?mac=' + encodeURIComponent(mac));
    if (r.status === 200 && r.data && r.data.code) {
      code = String(r.data.code).toUpperCase();
      roomId = r.data.roomId || null;
      spDc = r.data.sp_dc || null;
    }
  } catch (e) { /* backend/DB belum siap -> fallback kode acak di memori */ }

  if (!code) {
    code = makeCode();
    while (rooms[code]) code = makeCode();
  }

  const room = getRoom(code);
  if (roomId) room.roomId = roomId;
  if (mac) room.mac = String(mac);
  if (spDc) room.sp_dc = spDc;

  const forwardedHost = req.headers['x-forwarded-host'];
  const finalBase = process.env.PUBLIC_URL
    ? process.env.PUBLIC_URL.replace(/\/$/, '')
    : (req.protocol + '://' + (forwardedHost || req.get('host'))).replace(/\/$/, '');
  res.json({ code, qr: finalBase + '/controller/qr.html?pair=' + code, baseUrl: finalBase, roomId });
});

// API: resolve room langsung berdasarkan MAC (dipakai player/Flutter bila perlu).
app.get('/api/room/resolve', async (req, res) => {
  const mac = req.query.mac || '';
  try {
    const r = await apiGet('/room/resolve?mac=' + encodeURIComponent(mac));
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(502).json({ error: 'Backend API tidak tersedia. Jalankan backend di port 8000.' });
  }
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
app.get('/api/room/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = await loadRoom(code);
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
// Nilai disimpan di DB (MstRoom.SP_DC) lewat backend Python.
app.get('/api/room/:code/spdc', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = await loadRoom(code);
  if (!room) return res.status(404).json({ error: 'Room tidak ditemukan' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ has: !!room.sp_dc });
});

// Validasi sp_dc tersimpan (controller tidak perlu tahu nilainya).
app.get('/api/room/:code/spdc/validate', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = await loadRoom(code);
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

app.post('/api/room/:code/spdc', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = await loadRoom(code);
  if (!room) return res.status(404).json({ error: 'Room tidak ditemukan' });
  const spDc = (req.body && req.body.sp_dc ? String(req.body.sp_dc) : '').trim();
  if (!spDc || spDc.length < 20) return res.status(400).json({ error: 'sp_dc tidak valid' });
  room.sp_dc = spDc;
  // Simpan permanen di DB (MstRoom.SP_DC).
  apiSend('PUT', `/room/${encodeURIComponent(code)}/sp_dc`, { sp_dc: spDc }).catch(() => {});
  // Teruskan ke layar player supaya frame Spotify bisa menggunakannya.
  broadcastToRoom(code, { type: 'sp_dc', payload: { sp_dc: spDc }, ts: Date.now() }, 'controller');
  res.json({ ok: true });
});

app.delete('/api/room/:code/spdc', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = await loadRoom(code);
  if (room) {
    room.sp_dc = null;
    apiSend('PUT', `/room/${encodeURIComponent(code)}/sp_dc`, { sp_dc: null }).catch(() => {});
  }
  broadcastToRoom(code, { type: 'sp_dc', payload: { sp_dc: null }, ts: Date.now() }, 'controller');
  res.json({ ok: true });
});

// API: reset room runtime (dipanggil saat player logout/closing).
// Room TIDAK dihapus dari DB, agar PairingCode tetap stabil per device (MAC).
app.delete('/api/room/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  if (rooms[code]) {
    rooms[code].queue = [];
    rooms[code].currentIndex = -1;
    rooms[code].playing = false;
    rooms[code].position = 0;
    rooms[code].duration = 0;
    // Tandai IsRunning=false di DB (tanpa menghapus identitas room).
    apiSend('PUT', `/room/${encodeURIComponent(code)}/running`, { running: false }).catch(() => {});
  }
  // Beri tahu controller di room ini lalu tutup socket-nya, supaya tidak
  // menggantung di room yang sudah direset. Controller akan kembali ke pairing.
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
        apiSend('PUT', `/room/${encodeURIComponent(code)}/sp_dc`, { sp_dc: spDc }).catch(() => {});
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
