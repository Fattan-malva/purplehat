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
var reconnectAttempts = 0;
var suppressReconnect = false;
var reconnectTimer = null;
var state = { current: null, queue: [], playing: false, position: 0, duration: 0, volume: 30, lyricsAvailable: null, modes: { loop: false, shuffle: false, loopQueue: false } };
// Sedang menyeret progress bar (scrub). Selama true, render() tidak menimpa
// posisi bar supaya tidak goyang saat STATE_SYNC masuk.
var isScrubbing = false;
const API_BASE = localStorage.getItem('ph_api_base') || '';
var searchSource = 'youtube'; // 'youtube' | 'soundcloud' | 'spotify'

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

// Status di header: kode room + indikator IKON di sebelah kanannya.
// Semua keterangan memakai ikon (tanpa teks).
var connState = 'off'; // 'off' | 'on' | 'reconnect' | 'poll'
var _lastStatusHtml = null;

function renderStatus() {
  const el = document.getElementById('status');
  if (!el) return;
  let indicator;
  if (connState === 'reconnect') {
    indicator = '<i data-lucide="loader-circle" class="status-ico spin" aria-label="Menyambung ulang" title="Menyambung ulang"></i>';
  } else if (state.playing && (connState === 'on' || connState === 'poll')) {
    indicator = '<i data-lucide="audio-lines" class="status-ico playing" aria-label="Sedang memutar" title="Sedang memutar"></i>';
  } else if (connState === 'on' || connState === 'poll') {
    indicator = '<i data-lucide="wifi" class="status-ico on" aria-label="Terhubung" title="Terhubung"></i>';
  } else {
    indicator = '<i data-lucide="wifi-off" class="status-ico off" aria-label="Belum terhubung" title="Belum terhubung"></i>';
  }
  const html = roomCode
    ? '<b class="status-code">' + escapeHtml(roomCode) + '</b>' + indicator
    : indicator;
  if (html === _lastStatusHtml) return; // hindari rebuild/refresh ikon tiap sync
  _lastStatusHtml = html;
  el.innerHTML = html;
  refreshIcons();
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
      // Kode basi (room sudah dihapus/regenerate) -> buang supaya tidak
      // dipakai auto-connect lagi.
      if (/tidak ditemukan/i.test(e.message || '')) {
        localStorage.removeItem('ph_last_code');
      }
    });
}

function showMainUI() {
  const main = document.getElementById('main-ui');
  main.classList.remove('hidden');
  main.classList.add('flex');
  document.getElementById('pair-screen').classList.add('hidden');
}

// Kembali ke layar pairing + reset state lokal.
function showPairScreen() {
  fallbackMode = false;
  roomCode = null;
  const main = document.getElementById('main-ui');
  main.classList.add('hidden');
  main.classList.remove('flex');
  document.getElementById('pair-screen').classList.remove('hidden');
  document.getElementById('pair-status').classList.add('hidden');
  document.getElementById('pair-code-input').value = '';
  document.getElementById('results').classList.add('hidden');
  connState = 'off';
  renderStatus();
  document.getElementById('queue-badge').textContent = '0';
  state = { current: null, queue: [], playing: false, position: 0, duration: 0, volume: 30, lyricsAvailable: null, modes: { loop: false, shuffle: false, loopQueue: false } };
  updateVolUI();
  syncModeButtons();
}

function openSocket(attempt) {
  const statusEl = document.getElementById('pair-status');
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host + '/?role=controller&code=' + roomCode);

  ws.onopen = () => {
    reconnectAttempts = 0;
    suppressReconnect = false;
    connState = 'on';
    renderStatus();
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
    if (suppressReconnect) return;
    if (ws._opened) {
      // Sudah pernah tersambung lalu putus (HP tidur / sinyal) -> sambung
      // ulang otomatis supaya layar tidak ikut kehilangan controller.
      connState = 'reconnect';
      renderStatus();
      scheduleReconnect();
    } else if (attempt < 3) {
      statusEl.textContent = 'Hubungan realtime gagal (percobaan ' + (attempt + 1) + '). Mencoba lagi...';
      setTimeout(() => openSocket(attempt + 1), 1000);
    } else {
      fallbackMode = true;
      statusEl.style.color = '#fbbf24';
      statusEl.textContent = 'Mode polling (realtime tidak aktif di koneksi ini). Tetap berfungsi.';
      connState = 'poll';
      renderStatus();
      showMainUI();
      pollState();
    }
  };
  ws.addEventListener('open', () => { ws._opened = true; });
}

// Coba sambung ulang beberapa kali setelah koneksi yang sudah terbuka putus.
function scheduleReconnect() {
  if (suppressReconnect || !roomCode) return;
  if (reconnectAttempts >= 5) {
    showPairScreen();
    return;
  }
  reconnectAttempts++;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!suppressReconnect && roomCode) openSocket(0);
  }, 1500);
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
        volume: data.volume ?? 30,
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
    case PH.MSG.SPDC_INVALID:
      // Layar melaporkan sp_dc Spotify hilang/kedaluwarsa -> buka modal input.
      openSpdcModal('sp_dc Spotify tidak valid / kedaluwarsa. Tempel nilai baru.');
      break;
    case PH.MSG.LYRICS_AVAIL:
      // Layar melaporkan ketersediaan lirik tersinkron lagu Spotify aktif.
      state.lyricsAvailable = (p.available === undefined) ? null : !!p.available;
      render();
      break;
    case PH.MSG.ROOM_CLOSED:
      // Room dihapus (mis. layar logout) -> kembali ke layar pairing.
      suppressReconnect = true;
      localStorage.removeItem('ph_last_code');
      showPairScreen();
      break;
  }
}

function bindUI() {
  // Search
  document.getElementById('search-input').addEventListener('keypress', e => { if (e.key === 'Enter') search(); });

  // Tab sumber
  document.querySelectorAll('#search-tabs .src-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.src;
      if (src === 'spotify') { onSpotifyTabClick(btn); return; }
      setSearchSource(src);
      if (document.getElementById('search-input').value.trim()) search();
    });
  });

  document.getElementById('btn-play').addEventListener('click', () => send(PH.MSG.PLAY_PAUSE, {}));
  document.getElementById('btn-replay').addEventListener('click', () => send(PH.MSG.REPLAY, {}));
  document.getElementById('btn-next').addEventListener('click', () => send(PH.MSG.NEXT, {}));
  // Stop: hentikan lagu sekarang juga, layar langsung kembali ke menu idle.
  document.getElementById('btn-stop').addEventListener('click', () => send(PH.MSG.STOP, {}));

  // Progress: bisa diklik DAN diseret (mouse + layar sentuh).
  bindScrub();

  // Volume: TAP = 1 langkah, TAHAN = naik/turun terus (tanpa tap-tap).
  bindHoldVolume('vol-down', -1);
  bindHoldVolume('vol-up', 1);

  // Toggle playback modes (loop gabungan di modal Up Next + salinannya di panel)
  document.getElementById('btn-loop').addEventListener('click', cycleLoop);
  document.getElementById('btn-loop-panel').addEventListener('click', cycleLoop);
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

  // Logout controller: beri tahu layar supaya room dihapus + kode di-regenerate
  document.getElementById('btn-logout').addEventListener('click', () => {
    suppressReconnect = true;
    clearTimeout(reconnectTimer);
    // Kirim sinyal logout sengaja SEBELUM menutup socket (layar akan reset).
    try { send(PH.MSG.CONTROLLER_LOGOUT, {}); } catch (e) {}
    localStorage.removeItem('ph_last_code');
    try { stopScan(); } catch {}
    setTimeout(() => { try { if (ws) ws.close(); } catch {} }, 60);
    showPairScreen();
  });

  // ==== Modal: FX & Up Next ====
  // Saat lagu Spotify sedang diputar, tombol ini BERUBAH FUNGSI menjadi
  // pengirim perintah lirik (bukan membuka modal FX).
  //
  // Kalau lagu Spotify TIDAK punya lirik, tombol dinonaktifkan penuh:
  // diklik/ditekan sebanyak apa pun TIDAK mengirim perintah LYRICS supaya
  // layar lirik tidak pernah terbuka untuk lagu tanpa lirik.
  document.getElementById('btn-fx').addEventListener('click', () => {
    if (currentIsSpotify()) {
      if (state.lyricsAvailable !== true) { shakeLyricsBlocked(); return; }
      send(PH.MSG.LYRICS, {});
      return;
    }
    document.getElementById('fx-modal').classList.remove('hidden');
    refreshIcons();
  });
  // Tombol disabled tidak memicu 'click', jadi pakai pointerdown supaya tetap
  // ada umpan balik (getar) ketika user nekat menekannya.
  document.getElementById('btn-fx').addEventListener('pointerdown', () => {
    if (currentIsSpotify() && state.lyricsAvailable !== true) shakeLyricsBlocked();
  });
  // Ikon volume di sebelah FX: buka modal master volume.
  document.getElementById('btn-volume').addEventListener('click', () => {
    document.getElementById('volume-modal').classList.remove('hidden');
    updateVolUI();
    refreshIcons();
  });

  // sp_dc Spotify: simpan lalu lanjut cari di Spotify.
  document.getElementById('spdc-save').addEventListener('click', saveSpdc);
  document.getElementById('spdc-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveSpdc(); }
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

// ===== Progress bar: bisa diklik & diseret (scrub) =====
// Menggunakan Pointer Events supaya mouse, sentuh, dan stylus sama-sama jalan.
// Saat menyeret, bar & label waktu di- preview lokal; perintah SEEK baru
// dikirim sekali saat jari/mouse dilepas.
function bindScrub() {
  const track = document.getElementById('progress-container');
  const bar = document.getElementById('progress-bar');
  if (!track || !bar) return;

  function pctFromX(clientX) {
    const rect = track.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }

  function preview(pct) {
    bar.style.width = pct + '%';
    const posEl = document.getElementById('pos');
    if (posEl && (state.duration || 0) > 0) {
      posEl.textContent = formatTime(state.duration * (pct / 100));
    }
  }

  function endScrub(e, commit) {
    if (!isScrubbing) return;
    isScrubbing = false;
    track.classList.remove('scrubbing');
    try { track.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!commit) return;
    const to = Math.floor((state.duration || 0) * (pctFromX(e.clientX) / 100));
    send(PH.MSG.SEEK, { to });
  }

  track.addEventListener('pointerdown', (e) => {
    if ((state.duration || 0) <= 0) return; // durasi belum diketahui
    isScrubbing = true;
    track.classList.add('scrubbing');
    try { track.setPointerCapture(e.pointerId); } catch (err) {}
    preview(pctFromX(e.clientX));
    e.preventDefault();
  });

  track.addEventListener('pointermove', (e) => {
    if (!isScrubbing) return;
    preview(pctFromX(e.clientX));
    e.preventDefault();
  });

  track.addEventListener('pointerup', (e) => endScrub(e, true));
  track.addEventListener('pointercancel', (e) => endScrub(e, false));
}

// ===== Sumber pencarian: YouTube / SoundCloud / Spotify =====
function setSearchSource(src) {
  searchSource = src;
  document.querySelectorAll('#search-tabs .src-tab').forEach(b => {
    b.classList.toggle('mode-active', b.dataset.src === src);
  });
  document.getElementById('results').classList.add('hidden');
}

// Klik chip Spotify: cek & validasi sp_dc dulu. Kalau belum ada / kedaluwarsa
// -> buka modal input; kalau valid -> langsung cari.
async function onSpotifyTabClick(btn) {
  if (!roomCode) return;
  let has = false;
  try {
    const r = await fetch('/api/room/' + roomCode + '/spdc', { cache: 'no-store' });
    if (r.ok) has = !!(await r.json()).has;
  } catch (e) {}
  if (!has) { openSpdcModal('Masukkan sp_dc Spotify untuk room ini.'); return; }
  // Validasi nilai tersimpan (server yang memeriksa, controller tak perlu tahu isinya).
  try {
    const v = await fetch('/api/room/' + roomCode + '/spdc/validate', { cache: 'no-store' });
    if (!v.ok) {
      openSpdcModal('sp_dc tersimpan sudah tidak valid / kedaluwarsa. Masukkan yang baru.');
      return;
    }
  } catch (e) {
    // Backend sedang tak bisa dihubungi: biarkan user mencoba.
  }
  setSearchSource('spotify');
  if (document.getElementById('search-input').value.trim()) search();
}

function openSpdcModal(msg) {
  const hint = document.getElementById('spdc-hint');
  if (hint && msg) hint.textContent = msg;
  const err = document.getElementById('spdc-error');
  if (err) { err.classList.add('hidden'); err.textContent = ''; }
  const input = document.getElementById('spdc-input');
  if (input) input.value = '';
  document.getElementById('spdc-modal').classList.remove('hidden');
  refreshIcons();
  if (input) setTimeout(() => { try { input.focus(); } catch (e) {} }, 50);
}

function showSpdcError(msg) {
  const err = document.getElementById('spdc-error');
  if (err) { err.textContent = msg; err.classList.remove('hidden'); }
}

// sp_dc boleh ditempel sebagai nilai mentah atau "sp_dc=xxxx; ...".
function parseSpdc(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/sp_dc=([^;,\s]+)/);
  return m ? m[1].trim() : s;
}

async function saveSpdc() {
  if (!roomCode) return;
  const input = document.getElementById('spdc-input');
  const btn = document.getElementById('spdc-save');
  const value = parseSpdc(input ? input.value : '');
  if (!value || value.length < 20) { showSpdcError('sp_dc terlalu pendek / tidak valid.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Memeriksa...'; }
  try {
    const v = await fetch('/api/spotify/validate?sp_dc=' + encodeURIComponent(value), { cache: 'no-store' });
    if (!v.ok) { showSpdcError('sp_dc tidak valid atau kedaluwarsa. Coba salin ulang.'); return; }
    const r = await fetch('/api/room/' + roomCode + '/spdc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sp_dc: value })
    });
    if (!r.ok) { showSpdcError('Gagal menyimpan sp_dc. Coba lagi.'); return; }
    document.getElementById('spdc-modal').classList.add('hidden');
    setSearchSource('spotify');
    search();
  } catch (e) {
    showSpdcError('Gagal menghubungi server. Coba lagi.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Simpan & Lanjut'; }
  }
}

// Tombol FX berubah fungsi jadi pengirim perintah lirik saat lagu Spotify aktif.
function currentIsSpotify() {
  return !!(state.current && state.current.source === 'spotify');
}

// Umpan balik saat tombol lirik ditekan padahal lagu tidak punya lirik.
function shakeLyricsBlocked() {
  const btn = document.getElementById('btn-fx');
  if (!btn) return;
  btn.classList.remove('lyrics-blocked-shake');
  // Paksa reflow supaya animasi bisa dijalankan ulang saat ditekan lagi.
  void btn.offsetWidth;
  btn.classList.add('lyrics-blocked-shake');
  setTimeout(() => btn.classList.remove('lyrics-blocked-shake'), 500);
}

function syncFxButton() {
  const btn = document.getElementById('btn-fx');
  if (!btn) return;
  const isSp = currentIsSpotify();
  // Ketersediaan lirik: true=hijau, false=merah+coret, null=netral (belum tahu).
  const avail = (state.lyricsAvailable === true) ? 'on'
    : (state.lyricsAvailable === false ? 'off' : 'unknown');
  const key = isSp ? ('lyrics-' + avail) : 'fx';
  if (btn.dataset.fxmode === key) return;
  btn.dataset.fxmode = key;
  btn.classList.toggle('fx-open', !isSp);
  btn.classList.toggle('fx-lyrics', isSp);
  btn.classList.toggle('fx-lyrics-on', isSp && avail === 'on');
  btn.classList.toggle('fx-lyrics-off', isSp && avail === 'off');
  // Spotify tanpa lirik: tombol benar-benar non-aktif (tidak bisa diklik).
  const disabled = isSp && avail !== 'on';
  btn.disabled = disabled;
  btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  const title = !isSp ? 'FX & Tuning'
    : (avail === 'on' ? 'Lirik tersedia' : avail === 'off' ? 'Lirik tidak tersedia' : 'Belum tahu lirik tersedia');
  btn.title = title;
  btn.setAttribute('aria-label', title);
  const iconName = !isSp ? 'wand-sparkles' : (avail === 'off' ? 'captions-off' : 'captions');
  btn.innerHTML = '<i data-lucide="' + iconName + '"></i>';
  refreshIcons();
}

// ===== Pencarian + pagination tak berujung (terpicu saat scroll ke bawah) =====
var resultsState = { query: '', src: null, page: 1, offset: 0, hasMore: false, loading: false, limit: 20 };

async function search() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const el = document.getElementById('results');
  el.classList.remove('hidden');
  resultsState = { query: q, src: searchSource, page: 1, offset: 0, hasMore: true, loading: true, limit: 20 };
  const srcName = searchSource === 'soundcloud' ? 'SoundCloud' : (searchSource === 'spotify' ? 'Spotify' : 'YouTube');
  el.innerHTML = '<div class="state-msg"><i data-lucide="loader-circle" class="spin"></i> Mencari di ' + srcName + '...</div>';
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
  } else if (resultsState.src === 'spotify') {
    url = `${API_BASE}/api/search-spotify?q=${encodeURIComponent(q)}&limit=${resultsState.limit}&page=${append ? resultsState.page : 1}`;
  } else {
    url = `${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=${resultsState.limit}&offset=${append ? resultsState.offset : 0}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (resultsState.src === 'soundcloud' || resultsState.src === 'spotify') {
    const items = data.data || [];
    return { items, hasMore: !!(data.hasNext && items.length === resultsState.limit) };
  }
  const items = data || [];
  return { items, hasMore: items.length === resultsState.limit };
}

function advanceState(loaded, hasMore) {
  if (resultsState.src === 'soundcloud' || resultsState.src === 'spotify') resultsState.page += 1;
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
  if (src === 'soundcloud') return '<i class="fab fa-soundcloud src-sc" title="Available on SoundCloud"></i>';
  if (src === 'spotify') return '<i class="fab fa-spotify src-sp" title="Available on Spotify"></i>';
  return '<i class="fab fa-youtube src-yt" title="Available on YouTube"></i>';
}

function buildResultRow(item) {
  const src = item.source || resultsState.src || 'youtube';
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
        <div class="row-sub">${sourceIcon(src)} <span class="truncate">${escapeHtml(sub)}</span></div>
      </div>
      <i data-lucide="plus" class="row-add"></i>`;
  div.addEventListener('click', () => {
    if (src === 'spotify') {
      send(PH.MSG.ADD_SONG, { source: 'spotify', trackId: item.trackId, title: item.title, artist: item.artist, thumbnail: item.thumbnail });
    } else if (src === 'soundcloud') {
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

// Marquee teks panjang: bergerak mulus & looping. Hanya aktif bila teks
// benar-benar meluap, dan tidak restart saat STATE_SYNC rutin masuk karena
// konten yang sama dilewati (dataset.mq). delaySec membuat judul dan artist
// tidak bergerak bersamaan.
function setMarquee(el, html, delaySec) {
  if (!el) return;
  if (el.dataset.mq === html) return; // belum berubah -> jangan restart animasi
  el.dataset.mq = html;
  el.classList.remove('mq-on');
  el.innerHTML = '<span class="mq-inner"><span class="mq-part">' + html + '</span></span>';
  const inner = el.querySelector('.mq-inner');
  const part = el.querySelector('.mq-part');
  if (!inner || !part) return;
  const pad = parseFloat(getComputedStyle(part).paddingRight) || 0;
  const textW = part.scrollWidth - pad;
  if (textW - el.clientWidth > 6) {
    // Duplikasi teks supaya loop mulus (track digeser -50%).
    inner.innerHTML =
      '<span class="mq-part">' + html + '</span>' +
      '<span class="mq-part" aria-hidden="true">' + html + '</span>';
    const dur = Math.max(8, Math.round(textW / 40)); // ~40px/detik
    el.style.setProperty('--mq-dur', dur + 's');
    el.style.setProperty('--mq-delay', (delaySec || 0) + 's');
    el.classList.add('mq-on');
  }
}

function render() {
  const np = state.current ? state.current.title : (state.queue[0] ? state.queue[0].title : 'Menunggu lagu...');
  setMarquee(document.getElementById('np-title'), escapeHtml(np), 0);
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
    const src = state.current.source === 'soundcloud' ? 'soundcloud'
      : (state.current.source === 'spotify' ? 'spotify' : 'youtube');
    const artist = state.current.artist || '';
    const label = src === 'soundcloud' ? 'SoundCloud' : (src === 'spotify' ? 'Spotify' : 'YouTube');
    const subHtml = `${artist ? escapeHtml(artist) + ' &bull; ' : ''}${sourceIcon(src)} ${label}`;
    setMarquee(subEl, subHtml, 1.2);
  } else {
    setMarquee(subEl, 'Purplehat Karaoke', 1.2);
  }
  renderStatus();
  syncFxButton();
  document.getElementById('queue-badge').textContent = state.queue.length;
  const pos = state.position || 0, dur = state.duration || 0;
  // Saat scrub, jangan timpa preview bar/label posisi milik pengguna.
  if (!isScrubbing) {
    document.getElementById('pos').textContent = formatTime(pos);
    if (dur > 0) document.getElementById('progress-bar').style.width = Math.min(100, Math.max(0, (pos / dur) * 100)) + '%';
  }
  document.getElementById('dur').textContent = formatTime(dur);
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
  const v = state.volume ?? 30;
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

// Tombol volume: TAP = 1 langkah (2), TAHAN = naik/turun terus.
// Jeda awal ~350ms mencegah tap biasa terhitung dobel; setelah itu
// auto-repeat tiap ~110ms sampai jari/mouse dilepas atau sudah mentok (0/100).
function bindHoldVolume(btnId, dir) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  let startTimer = null;
  let repeatTimer = null;

  function stop() {
    clearTimeout(startTimer);
    clearInterval(repeatTimer);
    startTimer = repeatTimer = null;
    btn.classList.remove('holding');
  }

  function step() {
    const before = state.volume ?? 30;
    setVolume(before + dir * 2);
    // Sudah mentok (tidak berubah): hentikan agar tidak mengirim perintah
    // sia-sia ke jaringan.
    if ((state.volume ?? 30) === before) stop();
  }

  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    stop();
    btn.classList.add('holding');
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    step(); // langkah pertama langsung terasa
    startTimer = setTimeout(() => { repeatTimer = setInterval(step, 110); }, 350);
  });

  // Lepas jari/mouse atau dibatalkan sistem. Didengarkan juga di window
  // sebagai jaring pengaman supaya auto-repeat pasti berhenti; sengaja tidak
  // memakai 'lostpointercapture' karena bisa terpicu palsu dan mematikan
  // repeat terlalu dini.
  ['pointerup', 'pointercancel'].forEach((ev) => {
    btn.addEventListener(ev, stop);
    window.addEventListener(ev, stop);
  });
  window.addEventListener('blur', stop);
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
  const cur = loopState();
  // Dua tombol loop (modal Up Next + salinan di panel) selalu sinkron.
  syncOneLoopButton(document.getElementById('btn-loop'), document.getElementById('loop-one-badge'), cur);
  syncOneLoopButton(document.getElementById('btn-loop-panel'), document.getElementById('loop-one-badge-panel'), cur);
  const shuf = document.getElementById('btn-shuffle');
  if (shuf) shuf.classList.toggle('mode-active', !!m.shuffle);
}

function syncOneLoopButton(loopBtn, badge, cur) {
  if (!loopBtn) return;
  loopBtn.classList.toggle('mode-active', cur !== 'off');
  loopBtn.dataset.mode = cur; // 'off' | 'queue' | 'one'
  loopBtn.title = cur === 'one' ? 'Loop: lagu ini' :
    cur === 'queue' ? 'Loop: semua antrian' : 'Loop: mati';
  if (badge) badge.classList.toggle('hidden', cur !== 'one');
  const icon = loopBtn.querySelector('.lucide');
  if (icon) icon.classList.toggle('lucide-loop-one', cur === 'one');
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
          const extracted = extractPairFromQr(code.data);
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

function extractPairFromQr(data) {
  // Format 1: URL http(s)://host/...?pair=KODE
  try {
    const u = new URL(data);
    const p = u.searchParams.get('pair');
    if (p) return p.toUpperCase().trim();
  } catch {}

  // Format 2: web+purplehat:pair/KODE atau purplehat:pair/KODE
  const m = data.match(/^(?:web\+)?purplehat:pair\/([A-Za-z0-9-]+)$/i);
  if (m) return m[1].toUpperCase().trim();

  // Format 3: KODE mentah (4-10 karakter)
  const raw = data.trim();
  if (/^[A-Za-z0-9-]{4,10}$/.test(raw)) return raw.toUpperCase();

  return '';
}

bindUI();
refreshIcons();

// ==== Susunan Up Next: modal (portrait) atau kolom kiri (landscape) ====
// #queue-modes & #queue-list adalah elemen yang sama, dipindahkan (reparent)
// sesuai orientasi supaya tidak ada duplikasi logika/render.
var mqWide = window.matchMedia('(min-width: 900px), (orientation: landscape) and (min-width: 640px)');

function layoutUpNext() {
  var col = document.getElementById('upnext-col');
  var modes = document.getElementById('queue-modes');
  var list = document.getElementById('queue-list');
  var modalBox = document.querySelector('#upnext-modal .modal-box');
  if (!col || !modes || !list || !modalBox) return;
  var modalHead = modalBox.querySelector('.modal-head');
  var colHead = col.querySelector('.col-head');
  if (!modalHead || !colHead) return;
  if (mqWide.matches) {
    colHead.appendChild(modes);
    col.appendChild(list);
  } else {
    var closeBtn = modalHead.querySelector('[data-close]');
    modalHead.insertBefore(modes, closeBtn);
    modalBox.appendChild(list);
  }
}

layoutUpNext();
window.addEventListener('resize', layoutUpNext);
if (mqWide.addEventListener) mqWide.addEventListener('change', layoutUpNext);
else if (mqWide.addListener) mqWide.addListener(layoutUpNext);

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