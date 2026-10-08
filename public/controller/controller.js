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
  statusEl.style.display = 'block';
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
    document.getElementById('pair-screen').style.display = 'none';
    document.getElementById('main-ui').style.display = 'block';
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
      document.getElementById('pair-screen').style.display = 'none';
      document.getElementById('main-ui').style.display = 'block';
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
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab + '-tab').classList.add('active');
    });
  });

  document.getElementById('search-btn').addEventListener('click', search);
  document.getElementById('search-input').addEventListener('keypress', e => { if (e.key === 'Enter') search(); });

  document.getElementById('btn-play').addEventListener('click', () => send(PH.MSG.PLAY_PAUSE, {}));
  document.getElementById('btn-replay').addEventListener('click', () => send(PH.MSG.REPLAY, {}));
  document.getElementById('btn-next').addEventListener('click', () => send(PH.MSG.NEXT, {}));

  document.getElementById('seek-bar').addEventListener('change', (e) => {
    const to = Math.floor((state.duration || 0) * (parseFloat(e.target.value) / 100));
    send(PH.MSG.SEEK, { to });
  });
  document.getElementById('vol-bar').addEventListener('input', (e) => {
    const v = parseInt(e.target.value);
    document.getElementById('vol-label').textContent = v;
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
}

async function search() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const el = document.getElementById('results');
  el.innerHTML = '<div style="color:#94a3b8;padding:1rem;text-align:center">Mencari...</div>';
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=30`);
    renderResults(await res.json());
  } catch (e) {
    el.innerHTML = '<div style="color:#f87171;padding:1rem;text-align:center">Gagal mencari</div>';
  }
}

function renderResults(items) {
  const el = document.getElementById('results');
  el.innerHTML = '';
  if (!items || items.length === 0) {
    el.innerHTML = '<div style="color:#94a3b8;padding:1rem;text-align:center">Tidak ada hasil</div>';
    return;
  }
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.innerHTML = `
      <img class="result-thumb" src="${item.thumbnail}" alt="${escapeHtml(item.title)}">
      <div class="result-info">
        <div class="result-title">${escapeHtml(item.title)}</div>
        <div class="result-meta">${escapeHtml(item.channelName)} • ${escapeHtml(item.duration)}</div>
      </div>`;
    div.addEventListener('click', () => {
      send(PH.MSG.ADD_SONG, { videoId: item.videoId, title: item.title });
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'queue'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'queue-tab'));
    });
    el.appendChild(div);
  });
}

function render() {
  const np = state.current ? state.current.title : (state.queue[0] ? state.queue[0].title : '-');
  document.getElementById('np-title').textContent = np;
  document.getElementById('np-title2').textContent = np;
  document.getElementById('status').textContent = state.playing ? 'Sedang Memutar • ' + roomCode : 'Terhubung ke ' + roomCode;
  document.getElementById('queue-badge').textContent = state.queue.length;
  const pos = state.position || 0, dur = state.duration || 0;
  document.getElementById('pos').textContent = formatTime(pos);
  document.getElementById('dur').textContent = formatTime(dur);
  if (dur > 0) document.getElementById('seek-bar').value = Math.min(100, Math.max(0, (pos / dur) * 100));
  document.getElementById('vol-bar').value = state.volume ?? 80;
  document.getElementById('vol-label').textContent = state.volume ?? 80;
  renderQueue();
}

function renderQueue() {
  const el = document.getElementById('queue-list');
  el.innerHTML = '';
  if (!state.queue || state.queue.length === 0) {
    el.innerHTML = '<div style="color:#94a3b8;padding:1rem;text-align:center">Antrian kosong</div>';
    return;
  }
  state.queue.forEach((s, idx) => {
    const div = document.createElement('div');
    div.className = 'queue-item' + (state.current && idx === state.current.index ? ' playing' : '');
    div.textContent = s.title;
    el.appendChild(div);
  });
}

// QR scan
var scanStream = null;
var scanTimer = null;

function startScan() {
  document.getElementById('scan-area').style.display = 'block';
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
  document.getElementById('scan-area').style.display = 'none';
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
