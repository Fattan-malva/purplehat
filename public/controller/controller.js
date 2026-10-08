// Purplehat Controller - Mobile UI (v2)
// Logic identik dengan versi sebelumnya; hanya nama class pada markup hasil render yang disesuaikan dengan stylesheet baru.

// ==== PWA: dibuka sebagai aplikasi (standalone) atau biasa di browser ====
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

// ==== Gerbang instalasi ====
// Bendera cadangan: kalau skrip hard-bounce di <head> index.html gagal jalan,
// guard ini tetap memantulkan tab browser HP ke gate-install.html.
// (Catatan lama: flag 'ph_gate_pending' dulunya juga dipakai untuk opsi
// "Lanjut di browser" — opsi itu sudah dihapus; di HP controller hanya
// berjalan sebagai aplikasi.)
var gateRedirected = false;
if (!isStandalone && (/(Android|iPhone|iPad|iPod|Mobile)/i.test(navigator.userAgent) ||
        localStorage.getItem('ph_gate_pending') === '1')) {
    gateRedirected = true;
    location.replace('gate-install.html' +
        (location.search ? location.search + '&' : '?') + 'back=1');
}

var ws;
var roomCode = null;
var fallbackMode = false;
var state = { current: null, queue: [], playing: false, position: 0, duration: 0, volume: 80, modes: { loop: false, shuffle: false, loopQueue: false } };
// Default: same origin (via Express proxy /api/search). Override via localStorage jika perlu.
const API_BASE = localStorage.getItem('ph_api_base') || '';
var searchSource = 'youtube'; // 'youtube' | 'soundcloud'

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

// Elemen #status sudah dihapus dari header; dipertahankan agar aman jika ada reference
function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

// Render ikon Lucide yang baru ditambahkan ke DOM
function refreshIcons() {
  if (window.lucide) lucide.createIcons();
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
      // Simpan kode terakhir: dipakai lagi saat aplikasi dibuka dari
      // layar utama (standalone), di mana URL tidak lagi membawa ?pair=
      localStorage.setItem('ph_last_code', roomCode);
      openSocket(0);
    })
    .catch((e) => {
      statusEl.style.color = '#f87171';
      statusEl.textContent = e.message || 'Kode tidak valid';
    });
}

function showMainUI() {
  const main = document.getElementById('main-ui');
  main.classList.remove('hidden');
  main.classList.add('flex');
  document.getElementById('pair-screen').classList.add('hidden');
}

function openSocket(attempt) {
  const statusEl = document.getElementById('pair-status');
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host + '/?role=controller&code=' + roomCode);

  ws.onopen = () => {
    setStatus('Terhubung ke ' + roomCode);
    showMainUI();
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
      setStatus('Terputus');
    } else if (attempt < 3) {
      statusEl.textContent = 'Hubungan realtime gagal (percobaan ' + (attempt + 1) + '). Mencoba lagi...';
      setTimeout(() => openSocket(attempt + 1), 1000);
    } else {
      fallbackMode = true;
      statusEl.style.color = '#fbbf24';
      statusEl.textContent = 'Mode polling (realtime tidak aktif di koneksi ini). Tetap berfungsi.';
      setStatus('Terhubung (polling) ke ' + roomCode);
      showMainUI();
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
        volume: data.volume ?? 80,
        modes: state.modes
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

  // Tab sumber: YouTube / SoundCloud
  document.querySelectorAll('#search-tabs .src-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      searchSource = btn.dataset.src;
      document.querySelectorAll('#search-tabs .src-tab').forEach(b => b.classList.toggle('mode-active', b === btn));
      document.getElementById('results').classList.add('hidden');
      if (document.getElementById('search-input').value.trim()) search();
    });
  });

  document.getElementById('btn-play').addEventListener('click', () => send(PH.MSG.PLAY_PAUSE, {}));
  document.getElementById('btn-replay').addEventListener('click', () => send(PH.MSG.REPLAY, {}));
  document.getElementById('btn-next').addEventListener('click', () => send(PH.MSG.NEXT, {}));

  document.getElementById('progress-container').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const to = Math.floor((state.duration || 0) * (percentage / 100));
    send(PH.MSG.SEEK, { to });
  });

  document.getElementById('vol-down').addEventListener('click', () => setVolume((state.volume ?? 80) - 2));
  document.getElementById('vol-up').addEventListener('click', () => setVolume((state.volume ?? 80) + 2));

  // Toggle playback modes
  document.getElementById('btn-loop').addEventListener('click', () => toggleMode('btn-loop', PH.MSG.LOOP));
  document.getElementById('btn-shuffle').addEventListener('click', () => toggleMode('btn-shuffle', PH.MSG.SHUFFLE));
  document.getElementById('btn-loopq').addEventListener('click', () => toggleMode('btn-loopq', PH.MSG.LOOP_QUEUE));

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
    document.getElementById('results').classList.add('hidden');
    setStatus('Belum terhubung');
    document.getElementById('queue-badge').textContent = '0';
    state = { current: null, queue: [], playing: false, position: 0, duration: 0, volume: 80, modes: { loop: false, shuffle: false, loopQueue: false } };
    updateVolUI();
    syncModeButtons();
  });
}

async function search() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const el = document.getElementById('results');
  el.classList.remove('hidden');
  el.innerHTML = '<div class="state-msg"><i data-lucide="loader-circle" class="spin"></i> Mencari di ' + (searchSource === 'soundcloud' ? 'SoundCloud' : 'YouTube') + '...</div>';
  refreshIcons();
  try {
    const endpoint = searchSource === 'soundcloud'
      ? `${API_BASE}/api/search-soundcloud?q=${encodeURIComponent(q)}&limit=30`
      : `${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=30`;
    const res = await fetch(endpoint);
    const data = await res.json();
    const items = searchSource === 'soundcloud' ? (data.data || []) : data;
    renderResults(items);
  } catch (e) {
    el.innerHTML = '<div class="state-msg error">Gagal mencari</div>';
  }
}

function sourceIcon(src) {
  return src === 'soundcloud'
    ? '<i class="fab fa-soundcloud src-sc" title="Available on SoundCloud"></i>'
    : '<i class="fab fa-youtube src-yt" title="Available on YouTube"></i>';
}

function renderResults(items) {
  const el = document.getElementById('results');
  el.innerHTML = '';
  el.classList.remove('hidden');
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="state-msg">Tidak ada hasil</div>';
    return;
  }
  items.forEach(item => {
    const isSC = item.source === 'soundcloud' || !!item.trackId;
    const sub = [item.artist || item.channelName || '', item.duration || ''].filter(Boolean).join(' • ');
    const thumb = item.thumbnail
      ? `<img class="thumb" src="${item.thumbnail}" alt="${escapeHtml(item.title || '')}">`
      : `<div class="thumb"><i data-lucide="music"></i></div>`;
    const div = document.createElement('div');
    div.className = 'result-row';
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.innerHTML = `
      ${thumb}
      <div class="row-main">
        <div class="row-title">${escapeHtml(item.title || '')}</div>
        <div class="row-sub">${sourceIcon(isSC ? 'soundcloud' : 'youtube')} <span class="truncate">${escapeHtml(sub)}</span></div>
      </div>
      <i data-lucide="plus" class="row-add"></i>`;
    div.addEventListener('click', () => {
      if (isSC) {
        send(PH.MSG.ADD_SONG, { source: 'soundcloud', trackId: item.trackId, title: item.title, artist: item.artist, thumbnail: item.thumbnail });
      } else {
        send(PH.MSG.ADD_SONG, { source: 'youtube', videoId: item.videoId, title: item.title, artist: item.channelName, thumbnail: item.thumbnail });
      }
    });
    el.appendChild(div);
  });
  refreshIcons();
}

function render() {
  const np = state.current ? state.current.title : (state.queue[0] ? state.queue[0].title : 'Menunggu lagu...');
  document.getElementById('np-title').textContent = np;
  // Thumbnail lagu yang sedang diputar (atau lagu berikutnya)
  const npThumb = document.getElementById('np-thumb');
  const artSrc = (state.current && state.current.thumbnail) || (state.queue[0] && state.queue[0].thumbnail);
  if (npThumb) {
    if (artSrc) {
      npThumb.src = artSrc;
      npThumb.classList.remove('hidden');
    } else {
      npThumb.removeAttribute('src');
      npThumb.classList.add('hidden');
    }
  }
  const subEl = document.getElementById('np-sub');
  if (state.current) {
    const src = state.current.source === 'soundcloud' ? 'soundcloud' : 'youtube';
    const artist = state.current.artist || '';
    subEl.innerHTML = `${artist ? escapeHtml(artist) + ' &bull; ' : ''}${sourceIcon(src)} ${src === 'soundcloud' ? 'SoundCloud' : 'YouTube'}`;
  } else {
    subEl.textContent = 'Purplehat Karaoke';
  }
  setStatus(state.playing ? 'Sedang Memutar • ' + roomCode : 'Terhubung ke ' + roomCode);
  document.getElementById('queue-badge').textContent = state.queue.length;
  const pos = state.position || 0, dur = state.duration || 0;
  document.getElementById('pos').textContent = formatTime(pos);
  document.getElementById('dur').textContent = formatTime(dur);
  if (dur > 0) document.getElementById('progress-bar').style.width = Math.min(100, Math.max(0, (pos / dur) * 100)) + '%';
  updateVolUI();
  syncModeButtons();
  const icon = document.getElementById('play-icon');
  const wantIcon = state.playing ? 'pause' : 'play';
  if (icon && icon.dataset.icon !== wantIcon) {
    icon.dataset.icon = wantIcon;
    icon.innerHTML = `<i data-lucide="${wantIcon}"></i>`;
    refreshIcons();
  }
  renderQueue();
}

function renderQueue() {
  const el = document.getElementById('queue-list');
  el.innerHTML = '';
  if (!state.queue || state.queue.length === 0) {
    el.innerHTML = '<div class="state-msg">Antrian kosong</div>';
    return;
  }
  state.queue.forEach((s, idx) => {
    const isCurrent = state.current && idx === state.current.index;
    const qthumb = s.thumbnail
      ? `<img class="thumb sm" src="${escapeAttr(s.thumbnail)}" alt="">`
      : `<div class="thumb sm"><i data-lucide="music"></i></div>`;
    const div = document.createElement('div');
    div.className = 'queue-item' + (isCurrent ? ' is-playing' : '');
    div.innerHTML = `
      ${qthumb}
      <div class="row-main">
        <div class="row-title">${isCurrent ? '<i data-lucide="play" class="now-icon"></i>' : ''}${escapeHtml(s.title)}</div>
        ${s.artist ? `<div class="row-sub">${escapeHtml(s.artist)}</div>` : ''}
      </div>
      <div class="queue-actions">
        <button class="q-btn" title="Naikkan" aria-label="Naikkan" data-act="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>
          <i data-lucide="chevron-up"></i>
        </button>
        <button class="q-btn" title="Turunkan" aria-label="Turunkan" data-act="down" data-idx="${idx}" ${idx === state.queue.length - 1 ? 'disabled' : ''}>
          <i data-lucide="chevron-down"></i>
        </button>
        <button class="q-btn danger" title="Hapus" aria-label="Hapus" data-act="del" data-idx="${idx}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>`;
    div.querySelectorAll('.q-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.idx);
        if (btn.dataset.act === 'up') send(PH.MSG.MOVE_SONG, { index: i, dir: -1 });
        else if (btn.dataset.act === 'down') send(PH.MSG.MOVE_SONG, { index: i, dir: 1 });
        else send(PH.MSG.REMOVE_SONG, { index: i });
      });
    });
    el.appendChild(div);
  });
  refreshIcons();
}

function updateVolUI() {
  const v = state.volume ?? 80;
  const label = document.getElementById('vol-label');
  const bar = document.getElementById('vol-progress');
  if (label) label.textContent = v + '%';
  if (bar) bar.style.width = v + '%';
}

function setVolume(v) {
  v = Math.max(0, Math.min(100, v));
  state.volume = v;
  updateVolUI();
  send(PH.MSG.VOLUME, { vol: v });
}

function syncModeButtons() {
  const m = state.modes || {};
  const map = [['btn-loop', m.loop], ['btn-shuffle', m.shuffle], ['btn-loopq', m.loopQueue]];
  map.forEach(([id, on]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('mode-active', !!on);
  });
}

function toggleMode(btnId, msgType) {
  const m = state.modes;
  let on;
  if (msgType === PH.MSG.LOOP) m.loop = !m.loop, on = m.loop;
  else if (msgType === PH.MSG.SHUFFLE) m.shuffle = !m.shuffle, on = m.shuffle;
  else m.loopQueue = !m.loopQueue, on = m.loopQueue;
  document.getElementById(btnId).classList.toggle('mode-active', on);
  send(msgType, { on });
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
          // QR berisi URL seperti http://host/controller/qr.html?pair=CODE
          // (controller sudah terbuka -> langsung sambung; gate sudah dilewati)
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

function escapeAttr(t) {
  return String(t == null ? '' : t).replace(/["'&<>]/g, c => ({ '"': '&quot;', "'": '&#39;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

bindUI();
refreshIcons();

// auto-connect if pair param present
const params = new URLSearchParams(location.search);
const pair = params.get('pair');
if (gateRedirected) {
  // Sedang dialihkan ke gerbang instalasi (gate-install.html) ->
  // jangan sambung ke room sebelum lolos gerbang.
} else if (pair) {
  connect(pair);
} else if (isStandalone) {
  // Dibuka dari ikon layar utama: hubungkan otomatis ke kode terakhir
  const lastCode = localStorage.getItem('ph_last_code');
  if (lastCode) connect(lastCode);
}

setInterval(() => { if (!fallbackMode) send(PH.MSG.REQUEST_STATE, {}); }, 3000);