// Purplehat Controller - Mobile UI
var ws;
var roomCode = null;
var fallbackMode = false;
var state = { current: null, queue: [], playing: false, position: 0, duration: 0, volume: 80 };
// Default: same origin (via Express proxy /api/search). Override via localStorage jika perlu.
const API_BASE = localStorage.getItem('ph_api_base') || '';

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(PH.createMsg(type, payload)));
  } else if (fallbackMode && roomCode) {
    fetch('/api/room/' + roomCode + '/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload })
    }).catch(() => {});
  }
}

function connect(code) {
  roomCode = code.toUpperCase().trim();
  const statusEl = document.getElementById('pair-status');
  statusEl.classList.remove('hidden');
  statusEl.style.color = '#93c5fd';
  statusEl.textContent = 'Memeriksa kode...';

  fetch('/api/room/' + roomCode)
    .then(async r => {
      if (!r.ok) throw new Error('Kode tidak ditemukan');
      return r.json();
    })
    .then(() => {
      statusEl.textContent = 'Menghubungi realtime...';
      openSocket(0);
    })
    .catch((e) => {
      statusEl.style.color = '#f87171';
      statusEl.textContent = e.message || 'Kode tidak valid';
    });
}

function openSocket(attempt) {
  const statusEl = document.getElementById('pair-status');
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host + '/?role=controller&code=' + roomCode);

  ws.onopen = () => {
    document.getElementById('status').textContent = 'Terhubung ke ' + roomCode;
    document.getElementById('pair-screen').classList.add('hidden');
    const main = document.getElementById('main-ui');
    main.classList.remove('hidden');
    main.classList.add('flex');
    send(PH.MSG.JOIN, {});
  };
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };
  ws.onerror = () => {
    statusEl.style.color = '#f87171';
    statusEl.textContent = 'Realtime gagal. Coba lagi...';
  };
  ws.onclose = () => {
    if (ws._opened) {
      document.getElementById('status').textContent = 'Terputus';
    } else if (attempt < 3) {
      statusEl.textContent = 'Hubungan realtime gagal (percobaan ' + (attempt + 1) + '). Mencoba lagi...';
      setTimeout(() => openSocket(attempt + 1), 1000);
    } else {
      fallbackMode = true;
      statusEl.style.color = '#fbbf24';
      statusEl.textContent = 'Mode polling (realtime tidak aktif di koneksi ini). Tetap berfungsi.';
      document.getElementById('status').textContent = 'Terhubung (polling) ke ' + roomCode;
      document.getElementById('pair-screen').classList.add('hidden');
      const main = document.getElementById('main-ui');
      main.classList.remove('hidden');
      main.classList.add('flex');
      pollState();
    }
  };
  ws.addEventListener('open', () => { ws._opened = true; });
}

function pollState() {
  if (!fallbackMode || !roomCode) return;
  fetch('/api/room/' + roomCode)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      state = {
        current: data.current,
        queue: data.queue || [],
        playing: !!data.playing,
        position: data.position || 0,
        duration: data.duration || 0,
        volume: data.volume ?? 80
      };
      render();
    })
    .catch(() => {});
  setTimeout(pollState, 2000);
}

function handleMessage(msg) {
  const p = msg.payload || {};
  switch (msg.type) {
    case PH.MSG.STATE_SYNC:
      if (p.state) { state = Object.assign({}, state, p.state); render(); }
      break;
    case PH.MSG.QUEUE_UPDATE:
      if (p.queue) { state.queue = p.queue; renderQueue(); }
      break;
    case PH.MSG.NOW_PLAYING:
      if (p.song) { state.current = p.song; render(); }
      break;
    case PH.MSG.ERROR:
      console.error(p);
      break;
  }
}

function bindUI() {
  // Search: Enter di input (ikon search tidak ada tombol eksplisit)
  document.getElementById('search-input').addEventListener('keypress', e => { if (e.key === 'Enter') search(); });

  document.getElementById('btn-play').addEventListener('click', () => send(PH.MSG.PLAY_PAUSE, {}));
  document.getElementById('btn-replay').addEventListener('click', () => send(PH.MSG.REPLAY, {}));
  document.getElementById('btn-next').addEventListener('click', () => send(PH.MSG.NEXT, {}));

  document.getElementById('progress-container').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const to = Math.floor((state.duration || 0) * (percentage / 100));
    send(PH.MSG.SEEK, { to });
  });

  document.getElementById('vol-bar').addEventListener('input', (e) => {
    const v = parseInt(e.target.value);
    document.getElementById('vol-label').textContent = v + '%';
    send(PH.MSG.VOLUME, { vol: v });
  });

  document.getElementById('pair-connect-btn').addEventListener('click', () => {
    const code = document.getElementById('pair-code-input').value.trim();
    if (code) connect(code);
  });
  document.getElementById('pair-code-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      const code = e.target.value.trim();
      if (code) connect(code);
    }
  });

  document.getElementById('scan-btn').addEventListener('click', startScan);
  document.getElementById('scan-stop-btn').addEventListener('click', stopScan);

  // Logout controller: kembali ke tampilan awal (form kode / scan QR)
  document.getElementById('btn-logout').addEventListener('click', () => {
    try { if (ws) ws.close(); } catch {}
    try { stopScan(); } catch {}
    fallbackMode = false;
    roomCode = null;
    const main = document.getElementById('main-ui');
    main.classList.add('hidden');
    main.classList.remove('flex');
    document.getElementById('pair-screen').classList.remove('hidden');
    document.getElementById('pair-status').classList.add('hidden');
    document.getElementById('pair-code-input').value = '';
    document.getElementById('status').textContent = 'Belum terhubung';
    document.getElementById('queue-badge').textContent = '0';
    state = { current: null, queue: [], playing: false, position: 0, duration: 0, volume: 80 };
  });
}

async function search() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const el = document.getElementById('results');
  el.classList.remove('hidden');
  el.innerHTML = '<div class="text-gray-400 py-4 text-center">Mencari...</div>';
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=30`);
    renderResults(await res.json());
  } catch (e) {
    el.innerHTML = '<div class="text-red-400 py-4 text-center">Gagal mencari</div>';
  }
}

function renderResults(items) {
  const el = document.getElementById('results');
  el.innerHTML = '';
  el.classList.remove('hidden');
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="text-gray-400 py-4 text-center">Tidak ada hasil</div>';
    return;
  }
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'group flex items-center gap-3 p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer border border-transparent hover:border-white/10 bg-black/20 mb-2';
    div.innerHTML = `
      <img class="w-12 h-12 rounded-lg object-cover" src="${item.thumbnail}" alt="${escapeHtml(item.title)}">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-white truncate">${escapeHtml(item.title)}</div>
        <div class="text-xs text-gray-400 truncate">${escapeHtml(item.channelName)} • ${escapeHtml(item.duration)}</div>
      </div>
      <i class="fas fa-plus text-purple-400"></i>`;
    div.addEventListener('click', () => {
      send(PH.MSG.ADD_SONG, { videoId: item.videoId, title: item.title });
    });
    el.appendChild(div);
  });
}

function render() {
  const np = state.current ? state.current.title : (state.queue[0] ? state.queue[0].title : 'Menunggu lagu...');
  document.getElementById('np-title').textContent = np;
  document.getElementById('status').textContent = state.playing ? 'Sedang Memutar • ' + roomCode : 'Terhubung ke ' + roomCode;
  document.getElementById('queue-badge').textContent = state.queue.length;
  const pos = state.position || 0, dur = state.duration || 0;
  document.getElementById('pos').textContent = formatTime(pos);
  document.getElementById('dur').textContent = formatTime(dur);
  if (dur > 0) document.getElementById('progress-bar').style.width = Math.min(100, Math.max(0, (pos / dur) * 100)) + '%';
  document.getElementById('vol-bar').value = state.volume ?? 80;
  document.getElementById('vol-label').textContent = (state.volume ?? 80) + '%';
  const icon = document.getElementById('play-icon');
  icon.className = state.playing ? 'fas fa-pause' : 'fas fa-play ml-1';
  renderQueue();
}

function renderQueue() {
  const el = document.getElementById('queue-list');
  el.innerHTML = '';
  if (!state.queue || state.queue.length === 0) {
    el.innerHTML = '<div class="text-gray-500 text-center py-6">Antrian kosong</div>';
    return;
  }
  state.queue.forEach((s, idx) => {
    const div = document.createElement('div');
    div.className = 'group flex items-center gap-3 p-2 rounded-xl border border-transparent bg-black/20' + (state.current && idx === state.current.index ? ' border-purple-500/50 bg-purple-500/10' : '');
    div.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-white truncate">${state.current && idx === state.current.index ? '▶ ' : ''}${escapeHtml(s.title)}</div>
      </div>`;
    el.appendChild(div);
  });
}

// QR scan
var scanStream = null;
var scanTimer = null;

function startScan() {
  document.getElementById('scan-area').classList.remove('hidden');
  const video = document.getElementById('scan-video');
  const canvas = document.getElementById('scan-canvas');
  const ctx = canvas.getContext('2d');
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      scanStream = stream;
      video.srcObject = stream;
      scanTimer = setInterval(() => {
        if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
          stopScan();
          // QR contains URL like http://host/?pair=CODE or just CODE
          let extracted = '';
          try {
            const u = new URL(code.data);
            extracted = u.searchParams.get('pair') || '';
          } catch { extracted = code.data; }
          if (extracted) connect(extracted);
        }
      }, 300);
    })
    .catch(() => alert('Kamera tidak tersedia'));
}

function stopScan() {
  if (scanTimer) clearInterval(scanTimer);
  if (scanStream) scanStream.getTracks().forEach(t => t.stop());
  scanTimer = null; scanStream = null;
  document.getElementById('scan-area').classList.add('hidden');
}

function formatTime(s) {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

bindUI();

// auto-connect if pair param present
const params = new URLSearchParams(location.search);
const pair = params.get('pair');
if (pair) connect(pair);

setInterval(() => { if (!fallbackMode) send(PH.MSG.REQUEST_STATE, {}); }, 3000);
