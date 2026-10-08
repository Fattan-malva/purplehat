// Purplehat Controller - Mobile UI (v2)
// Logic identik dengan versi sebelumnya; hanya nama class pada markup hasil render yang disesuaikan dengan stylesheet baru.

// ==== PWA: dibuka sebagai aplikasi (standalone) atau biasa di browser ====
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

// ==== Gerbang instalasi ====
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

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.innerHTML = text;
}

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
    setStatus('Terhubung ke <b class="status-code">' + roomCode + '</b>');
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
      setStatus('Terhubung (polling) ke <b class="status-code">' + roomCode + '</b>');
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
  // Search
  document.getElementById('search-input').addEventListener('keypress', e => { if (e.key === 'Enter') search(); });

  // Tab sumber
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

  // Toggle playback modes (loop gabungan di modal Up Next + shuffle)
  document.getElementById('btn-loop').addEventListener('click', cycleLoop);
  document.getElementById('btn-shuffle').addEventListener('click', () => toggleMode('btn-shuffle', PH.MSG.SHUFFLE));

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

  // Logout controller
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

  // ==== Modal: FX & Up Next ====
  document.getElementById('btn-fx').addEventListener('click', () => {
    document.getElementById('fx-modal').classList.remove('hidden');
    refreshIcons();
  });
  document.getElementById('btn-upnext').addEventListener('click', () => {
    document.getElementById('upnext-modal').classList.remove('hidden');
    renderQueue();
    syncModeButtons();
    refreshIcons();
  });
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).classList.add('hidden');
    });
  });
  // Klik backdrop untuk menutup modal
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
  });
}

// ===== Pencarian + pagination tak berujung (terpicu saat scroll ke bawah) =====
var resultsState = { query: '', src: null, page: 1, offset: 0, hasMore: false, loading: false, limit: 20 };

async function search() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const el = document.getElementById('results');
  el.classList.remove('hidden');
  resultsState = { query: q, src: searchSource, page: 1, offset: 0, hasMore: true, loading: true, limit: 20 };
  el.innerHTML = '<div class="state-msg"><i data-lucide="loader-circle" class="spin"></i> Mencari di ' + (searchSource === 'soundcloud' ? 'SoundCloud' : 'YouTube') + '...</div>';
  refreshIcons();
  try {
    const r = await fetchPage(false);
    advanceState(r.items.length, r.hasMore);
    renderResults(r.items);
  } catch (e) {
    el.innerHTML = '<div class="state-msg error">Gagal mencari</div>';
  } finally {
    resultsState.loading = false;
  }
}

// Ambil satu halaman hasil. Kembali: { items, hasMore }.
async function fetchPage(append) {
  const q = resultsState.query;
  let url;
  if (resultsState.src === 'soundcloud') {
    url = `${API_BASE}/api/search-soundcloud?q=${encodeURIComponent(q)}&limit=${resultsState.limit}&page=${append ? resultsState.page : 1}`;
  } else {
    url = `${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=${resultsState.limit}&offset=${append ? resultsState.offset : 0}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (resultsState.src === 'soundcloud') {
    const items = data.data || [];
    return { items, hasMore: !!(data.hasNext && items.length === resultsState.limit) };
  }
  const items = data || [];
  return { items, hasMore: items.length === resultsState.limit };
}

function advanceState(loaded, hasMore) {
  if (resultsState.src === 'soundcloud') resultsState.page += 1;
  else resultsState.offset += loaded;
  resultsState.hasMore = hasMore;
  resultsState.loading = false;
}

async function loadMore() {
  if (resultsState.loading || !resultsState.hasMore || !resultsState.query) return;
  const el = document.getElementById('results');
  resultsState.loading = true;
  const loader = document.createElement('div');
  loader.className = 'state-msg';
  loader.innerHTML = '<i data-lucide="loader-circle" class="spin"></i> Memuat hasil lagi...';
  el.appendChild(loader);
  refreshIcons();
  try {
    const r = await fetchPage(true);
    advanceState(r.items.length, r.hasMore);
    loader.remove();
    renderResults(r.items, true);
    if (!resultsState.hasMore) {
      const end = document.createElement('div');
      end.className = 'results-end';
      end.textContent = '— Akhir dari hasil —';
      el.appendChild(end);
    }
  } catch (e) {
    if (loader.parentNode) loader.remove();
    resultsState.hasMore = false;
  } finally {
    resultsState.loading = false;
  }
}

function sourceIcon(src) {
  return src === 'soundcloud'
    ? '<i class="fab fa-soundcloud src-sc" title="Available on SoundCloud"></i>'
    : '<i class="fab fa-youtube src-yt" title="Available on YouTube"></i>';
}

function buildResultRow(item) {
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
  return div;
}

function renderResults(items, append) {
  const el = document.getElementById('results');
  el.classList.remove('hidden');
  if (append) {
    (items || []).forEach(item => el.appendChild(buildResultRow(item)));
  } else {
    el.innerHTML = '';
    if (!items || items.length === 0) {
      el.innerHTML = '<div class="state-msg">Tidak ada hasil</div>';
      return;
    }
    items.forEach(item => el.appendChild(buildResultRow(item)));
  }
  refreshIcons();
}

function render() {
  const np = state.current ? state.current.title : (state.queue[0] ? state.queue[0].title : 'Menunggu lagu...');
  document.getElementById('np-title').textContent = np;
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
  setStatus(state.playing ? 'Sedang Memutar • <b class="status-code">' + roomCode + '</b>' : 'Terhubung ke <b class="status-code">' + roomCode + '</b>');
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
  v = Math.round(v / 2) * 2;
  state.volume = v;
  updateVolUI();
  send(PH.MSG.VOLUME, { vol: v });
}

// Satu tombol loop: mati -> loop semua antrian -> loop lagu ini -> mati.
// Ikon: repeat (mode aktif); badge "1" hanya muncul saat "loop lagu ini".
function loopState() {
  const m = state.modes || {};
  if (m.loop) return 'one';
  if (m.loopQueue) return 'queue';
  return 'off';
}

function cycleLoop() {
  const m = state.modes;
  const cur = loopState();
  if (cur === 'off') { m.loopQueue = true; m.loop = false; }
  else if (cur === 'queue') { m.loopQueue = false; m.loop = true; }
  else { m.loop = false; m.loopQueue = false; }
  // kirim dua-duanya agar player selalu konsisten (dua mode tidak pernah nyala bareng)
  send(PH.MSG.LOOP_QUEUE, { on: m.loopQueue });
  send(PH.MSG.LOOP, { on: m.loop });
  syncModeButtons();
}

function syncModeButtons() {
  const m = state.modes || {};
  const loopBtn = document.getElementById('btn-loop');
  if (loopBtn) {
    const cur = loopState();
    loopBtn.classList.toggle('mode-active', cur !== 'off');
    loopBtn.dataset.mode = cur; // 'off' | 'queue' | 'one'
    loopBtn.title = cur === 'one' ? 'Loop: lagu ini' :
      cur === 'queue' ? 'Loop: semua antrian' : 'Loop: mati';
    const badge = document.getElementById('loop-one-badge');
    if (badge) badge.classList.toggle('hidden', cur !== 'one');
    const icon = loopBtn.querySelector('.lucide');
    if (icon) icon.classList.toggle('lucide-loop-one', cur === 'one');
  }
  const shuf = document.getElementById('btn-shuffle');
  if (shuf) shuf.classList.toggle('mode-active', !!m.shuffle);
}

function toggleMode(btnId, msgType) {
  const m = state.modes;
  let on;
  if (msgType === PH.MSG.SHUFFLE) m.shuffle = !m.shuffle, on = m.shuffle;
  else return; // satu-satunya mode via toggleMode sekarang: shuffle
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

// auto-connect
const params = new URLSearchParams(location.search);
const pair = params.get('pair');
if (gateRedirected) {
  // dialihkan ke gate-install.html
} else if (pair) {
  connect(pair);
} else if (isStandalone) {
  const lastCode = localStorage.getItem('ph_last_code');
  if (lastCode) connect(lastCode);
}

setInterval(() => { if (!fallbackMode) send(PH.MSG.REQUEST_STATE, {}); }, 3000);

// Pagination tak berujung: saat pengguna scroll hasil sampai dekat bawah, muat halaman berikutnya.
(function initInfiniteScroll() {
  const resultsEl = document.getElementById('results');
  if (!resultsEl) return;
  resultsEl.addEventListener('scroll', () => {
    if (resultsEl.scrollTop + resultsEl.clientHeight >= resultsEl.scrollHeight - 220) loadMore();
  }, { passive: true });
})();

// Default pencarian: query "breakbeat" sudah terisi, hasil langsung tampil sejak awal.
document.getElementById('search-input').value = 'breakbeat';
search();