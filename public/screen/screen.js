// Purplehat Screen - Authoritative player (host)
// Playback dipecah ke dokumen terpisah di dalam iframe:
//   youtube/player-yt.html    -> YouTube IFrame API
//   soundcloud/player-sc.html -> SoundCloud Widget API
// Host hanya mengirim perintah via postMessage. Saat pindah sumber,
// dokumen frame diganti total sehingga pemutar lama dijamin berhenti
// (tidak ada lagi YT masih bunyi saat lagu SoundCloud mulai).

var ws;
var roomCode = null;
var queue = [];
var currentIndex = -1;
var isPlaying = false;
var volume = 30;
var modeLoop = false;       // ulangi lagu yang sedang diputar
var modeShuffle = false;    // acak urutan
var modeLoopQueue = false;  // loop semua antrian (lagu tidak dihapus setelah diputar)

// ==== Frame playback ====
var currentSource = 'youtube'; // sumber lagu aktif
var frameSrc = null;            // dokumen yang sedang dimuat di iframe ('youtube'|'soundcloud')
var frameReady = false;         // frame sudah kirim pesan 'ready'
var pendingSong = null;         // lagu yang menunggu frame siap
var mediaPosition = 0;          // detik, dari frame
var mediaDuration = 0;          // detik, dari frame

function isSC() { return currentSource === 'soundcloud'; }

// ==== Mode desktop: dijalankan di dalam wrapper WinForms WebView2 ====
// window.chrome.webview ada hanya saat halaman dimuat di WebView2.
// Dalam mode ini "master volume" controller mengatur volume OS Windows,
// dan volume YouTube/SoundCloud di-frame dipaksa 100 (OP dinamis sudah
// dikendalikan oleh sistem).
var isDesktop = !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage);

function frameVolume() { return isDesktop ? 100 : volume; }

function postToHost(m) {
  if (!isDesktop) return;
  try { window.chrome.webview.postMessage(JSON.stringify(m)); } catch (e) {}
}

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(PH.createMsg(type, payload)));
  }
}

function broadcastState() {
  send(PH.MSG.STATE_SYNC, { state: getState() });
}

function getState() {
  return {
    current: queue[currentIndex] ? Object.assign({}, queue[currentIndex], { index: currentIndex }) : null,
    queue: queue,
    playing: isPlaying,
    position: Math.floor(mediaPosition),
    duration: Math.floor(mediaDuration),
    volume: volume,
    modes: { loop: modeLoop, shuffle: modeShuffle, loopQueue: modeLoopQueue }
  };
}

// ==== Komunikasi dengan frame pemutar ====
function frameURL(src) {
  return src === 'soundcloud'
    ? '/screen/soundcloud/player-sc.html'
    : '/screen/youtube/player-yt.html';
}

function sendFrame(m) {
  const f = document.getElementById('player-frame');
  if (f && f.contentWindow) f.contentWindow.postMessage(Object.assign({ ph: 1 }, m), '*');
}

function sendLoad(song) {
  sendFrame(song.source === 'soundcloud'
    ? { cmd: 'load', trackId: song.trackId, volume: frameVolume() }
    : { cmd: 'load', videoId: song.videoId, volume: frameVolume() });
}

// Muat lagu ke frame; ganti dokumen frame jika sumber berbeda
function startSong(song) {
  const src = song.source === 'soundcloud' ? 'soundcloud' : 'youtube';
  const f = document.getElementById('player-frame');
  currentSource = src;
  if (f) f.classList.remove('hidden');
  if (frameSrc !== src) {
    // Ganti dokumen frame -> pemutar lama dimatikan total
    frameSrc = src;
    frameReady = false;
    pendingSong = song;
    if (f) f.src = frameURL(src);
  } else if (frameReady) {
    sendLoad(song);
  } else {
    pendingSong = song;
  }
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || !d.ph) return;
  if (d.type === 'ready') {
    frameReady = true;
    if (pendingSong) {
      sendLoad(pendingSong);
      pendingSong = null;
    } else {
      sendFrame({ cmd: 'volume', vol: frameVolume() });
    }
  } else if (d.type === 'state') {
    isPlaying = !!d.playing;
    mediaPosition = d.position || 0;
    mediaDuration = d.duration || 0;
    broadcastState();
  } else if (d.type === 'ended') {
    isPlaying = false;
    if (modeLoop) sendFrame({ cmd: 'replay' });
    else playNext();
  } else if (d.type === 'error') {
    const st = document.getElementById('status');
    if (st) st.textContent = 'Status: Video tidak bisa diputar, lanjut ke berikutnya...';
    isPlaying = false;
    setTimeout(playNext, 1500);
  }
});

async function init() {
  roomCode = sessionStorage.getItem('ph_code');
  if (!roomCode) {
    // Belum ada pairing, kembali ke menu awal
    location.href = 'index.html';
    return;
  }

  // Tampilkan kode room di pojok kiri atas layar player
  const codeEl = document.getElementById('room-code-badge');
  if (codeEl) codeEl.textContent = roomCode;

  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/?role=screen&code=' + roomCode);
  ws.onopen = () => {
    broadcastState();
  };
  ws.onerror = () => {
    document.getElementById('status').textContent = 'Status: Realtime gagal - cek port 3000 public';
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };
  ws.onclose = () => {
    document.getElementById('status').textContent = 'Status: Terputus - refresh halaman';
  };
}

function handleMessage(msg) {
  const p = msg.payload || {};
  switch (msg.type) {
    case PH.MSG.JOIN:
      send(PH.MSG.STATE_SYNC, { state: getState() });
      break;
    case PH.MSG.ADD_SONG: addSong(p); break;
    case PH.MSG.REMOVE_SONG: removeSong(p.index); break;
    case PH.MSG.PLAY_PAUSE: togglePlay(); break;
    case PH.MSG.NEXT:
    case PH.MSG.SKIP: playNext(); break;
    case PH.MSG.REPLAY: replay(); break;
    case PH.MSG.SEEK: seekTo(p.to); break;
    case PH.MSG.VOLUME: setVolume(p.vol); break;
    case PH.MSG.REQUEST_STATE: broadcastState(); break;
    case PH.MSG.LOOP: modeLoop = !!p.on; broadcastState(); break;
    case PH.MSG.SHUFFLE: modeShuffle = !!p.on; broadcastState(); break;
    case PH.MSG.LOOP_QUEUE: modeLoopQueue = !!p.on; broadcastState(); break;
    case PH.MSG.MOVE_SONG: moveSong(p.index, p.dir); break;
    case PH.MSG.CONTROLLER_JOINED:
      document.getElementById('status').textContent = 'Status: Controller terhubung';
      break;
    case PH.MSG.CONTROLLER_LEFT:
      // Controller putus mendadak (HP mati / sinyal hilang) BUKAN logout
      // sengaja. Jangan hentikan apa pun: biarkan playlist yang sedang
      // berjalan diselesaikan dulu sampai habis, baru idle. Layar tetap
      // hidup dan menunggu controller tersambung lagi.
      document.getElementById('status').textContent = 'Status: Controller terputus - menunggu sambungan ulang...';
      break;
    case PH.MSG.CONTROLLER_LOGOUT:
      // Logout sengaja dari controller: reset total + regenerate kode.
      fullLogout();
      break;
  }
}

// Logout penuh (dipakai saat controller logout sengaja atau tombol logout
// layar): matikan pemutar, hapus room, buang kode, lalu kembali ke menu QR
// yang akan otomatis membuat kode room BARU.
function fullLogout() {
  closeFrame();
  try { if (ws) ws.close(); } catch (e) {}
  const code = roomCode;
  sessionStorage.removeItem('ph_code');
  let done = false;
  const go = () => { if (!done) { done = true; location.href = 'index.html'; } };
  if (code) {
    // Best-effort hapus room; tetap lanjut walau gagal (kode tetap regenerate
    // karena ph_code sudah dibuang).
    fetch('/api/room/' + code, { method: 'DELETE' }).catch(() => {}).finally(go);
    setTimeout(go, 700);
  } else {
    go();
  }
}

function addSong(p) {
  const payload = p || {};
  const videoId = payload.videoId;
  const isSoundCloud = payload.source === 'soundcloud';
  if (!videoId && !isSoundCloud) return;
  queue.push({
    videoId: videoId || null,
    trackId: payload.trackId || null,
    source: isSoundCloud ? 'soundcloud' : 'youtube',
    title: payload.title || videoId || String(payload.trackId || ''),
    artist: payload.artist || '',
    thumbnail: payload.thumbnail || (videoId ? 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg' : '')
  });
  updateQueueUI();
  send(PH.MSG.QUEUE_UPDATE, { queue });
  if (currentIndex < 0) playNext();
  broadcastState();
}

function removeSong(index) {
  if (index < 0 || index >= queue.length) return;
  queue.splice(index, 1);
  if (index < currentIndex) currentIndex--;
  else if (index === currentIndex) { currentIndex--; playNext(true); }
  updateQueueUI();
  send(PH.MSG.QUEUE_UPDATE, { queue });
  broadcastState();
}

// Geser lagu naik/turun dalam antrian
function moveSong(index, dir) {
  const to = index + dir;
  if (index == null || index < 0 || index >= queue.length || to < 0 || to >= queue.length) return;
  const [song] = queue.splice(index, 1);
  queue.splice(to, 0, song);
  if (currentIndex === index) currentIndex = to;
  else if (currentIndex === to) currentIndex = index;
  updateQueueUI();
  send(PH.MSG.QUEUE_UPDATE, { queue });
  broadcastState();
}

// Index lagu berikutnya berdasarkan mode
function nextIndexFrom(oldIndex, len) {
  if (modeShuffle && len > 1) {
    let r;
    do { r = Math.floor(Math.random() * len); } while (r === oldIndex);
    return r;
  }
  let n = oldIndex + 1;
  if (n >= len) n = modeLoopQueue ? 0 : -1;
  return n;
}

function stopPlayback() {
  currentIndex = -1;
  isPlaying = false;
  mediaPosition = 0;
  mediaDuration = 0;
  // Tutup TOTAL pemutar (YouTube & SoundCloud), bukan sekadar pause.
  // 1) kirim perintah stop (agar pemutar berhenti rapi), lalu
  // 2) lepaskan dokumen iframe (about:blank) sehingga suara benar-benar mati
  //    dan tinggal idle screen.
  sendFrame({ cmd: 'stop' });
  closeFrame();
  updateUI();
  send(PH.MSG.QUEUE_UPDATE, { queue });
  broadcastState();
}

// Lepaskan dokumen pemutar supaya tidak ada audio yang tertinggal.
function closeFrame() {
  const f = document.getElementById('player-frame');
  frameReady = false;
  frameSrc = null;
  pendingSong = null;
  if (f) {
    try { f.src = 'about:blank'; } catch (e) {}
    f.classList.add('hidden');
  }
}

function playNext(skipRemoveCurrent) {
  if (queue.length === 0) {
    stopPlayback();
    return;
  }
  const oldIndex = currentIndex;
  let nextIndex = nextIndexFrom(oldIndex, queue.length);

  if (nextIndex < 0) {
    // Antrian habis -> buang lagu yang sudah diputar lalu berhenti
    if (oldIndex >= 0 && oldIndex < queue.length) queue.splice(oldIndex, 1);
    stopPlayback();
    return;
  }

  // Lagu yang sudah diputar langsung dihapus dari playlist,
  // kecuali mode loop antrian (loop_queue) aktif
  if (!skipRemoveCurrent && oldIndex >= 0 && oldIndex < queue.length && !modeLoopQueue) {
    queue.splice(oldIndex, 1);
    if (nextIndex > oldIndex) nextIndex--;
    if (nextIndex >= queue.length) nextIndex = queue.length - 1;
  }

  currentIndex = nextIndex;
  const song = queue[currentIndex];
  if (!(song.source === 'soundcloud' ? song.trackId : song.videoId)) {
    // ID tidak valid -> lewati
    setTimeout(playNext, 300);
    return;
  }
  startSong(song);
  updateUI();
  send(PH.MSG.NOW_PLAYING, { song: Object.assign({}, song, { index: currentIndex }), index: currentIndex });
  broadcastState();
}

function replay() {
  sendFrame({ cmd: 'replay' });
  broadcastState();
}

function togglePlay() {
  sendFrame({ cmd: isPlaying ? 'pause' : 'play' });
  isPlaying = !isPlaying;
  broadcastState();
}

function seekTo(to) {
  sendFrame({ cmd: 'seek', to: Math.max(0, to || 0) });
  broadcastState();
}

function setVolume(vol) {
  let v = Math.max(0, Math.min(100, vol));
  // Mode desktop (WebView2 WinForms): step volume 2-2 (0,2,4,...,100).
  // Nilai dikirim LANGSUNG ke host -> SetSystemVolume mem-pin volume OS
  // tepat di angka itu (sinkron, tanpa OSD, tanpa worker/timer).
  if (isDesktop) v = Math.round(v / 2) * 2;
  volume = v;
  // Mode desktop: master volume controller mengatur volume OS Windows.
  // Volume frame dibiarkan 100 agar tidak dobel.
  if (isDesktop) {
    postToHost({ type: 'volume', value: volume });
    sendFrame({ cmd: 'volume', vol: 100 });
  } else {
    sendFrame({ cmd: 'volume', vol: volume });
  }
  broadcastState();
}

function updateUI() {
  const np = document.getElementById('now-playing');
  const qc = document.getElementById('queue-count');
  np.textContent = currentIndex >= 0 && queue[currentIndex] ? 'Sedang Diputar: ' + queue[currentIndex].title : 'Menunggu lagu pertama...';
  qc.textContent = 'Antrian: ' + queue.length;
  updateIdle();
  updateQueueUI();
}

// Tampilan idle: muncul saat tidak ada lagu yang diputar
function updateIdle() {
  const idle = document.getElementById('idle-screen');
  if (idle) idle.classList.toggle('hidden', currentIndex >= 0);
}

function updateQueueUI() {
  const ul = document.getElementById('queue-list');
  ul.innerHTML = '';
  queue.forEach((s, idx) => {
    const li = document.createElement('li');
    if (idx === currentIndex) li.classList.add('playing');
    li.textContent = (idx === currentIndex ? '▶ ' : '') + s.title;
    ul.appendChild(li);
  });
}

// Browser memblokir autoplay bersuara sebelum ada gesture dari user.
// Klik pertama di layar memberi gesture ke frame pemutar.
document.addEventListener('click', () => {
  if (currentIndex >= 0) sendFrame({ cmd: 'gesture' });
}, { once: true });

// Terapkan volume default ke host (OS Windows) sejak halaman dimuat, supaya
// volume OS langsung sinkron dengan angka yang ditampilkan di controller
// (tanpa harus menunggu user menggeser volume dulu).
setVolume(volume);

init();
setInterval(broadcastState, 5000);

// Logout player: pakai fullLogout (matikan frame, hapus room, regenerate kode)
document.getElementById('screen-logout').addEventListener('click', () => {
  fullLogout();
});
