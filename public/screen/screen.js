// Purplehat Screen - Authoritative player
var ws;
var roomCode = null;
var player;
var queue = [];
var currentIndex = -1;
var isPlaying = false;
var volume = 80;
var modeLoop = false;       // ulangi lagu yang sedang diputar
var modeShuffle = false;    // acak urutan
var modeLoopQueue = false;  // loop semua antrian (lagu tidak dihapus setelah diputar)

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
    position: player && typeof player.getCurrentTime === 'function' ? Math.floor(player.getCurrentTime()) : 0,
    duration: player && typeof player.getDuration === 'function' ? Math.floor(player.getDuration()) : 0,
    volume: volume,
    modes: { loop: modeLoop, shuffle: modeShuffle, loopQueue: modeLoopQueue }
  };
}

async function init() {
  roomCode = sessionStorage.getItem('ph_code');
  if (!roomCode) {
    // Belum ada pairing, kembali ke menu awal
    location.href = 'index.html';
    return;
  }

  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/?role=screen&code=' + roomCode);
  // ws uses same server; express static + ws both on http server; ws path is just host root
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
    case PH.MSG.ADD_SONG: addSong(p.videoId, p.title); break;
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
      break;
    case PH.MSG.CONTROLLER_LEFT:
      // Controller putus -> kembali ke menu awal
      location.href = 'index.html';
      break;
  }
}

function addSong(videoId, title) {
  if (!videoId) return;
  queue.push({ videoId, title: title || videoId });
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

var pendingVideoId = null;

// Putar video; kalau autoplay diblokir browser, coba mute dulu lalu unmute setelah jalan
function forcePlay() {
  if (!player || !player.playVideo) return;
  try { player.playVideo(); } catch {}
  setTimeout(() => {
    try {
      const s = player.getPlayerState ? player.getPlayerState() : -1;
      if (s !== YT.PlayerState.PLAYING) {
        player.mute();
        player.playVideo();
        const unmute = setInterval(() => {
          try {
            if (player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) {
              clearInterval(unmute);
              player.unMute();
            }
          } catch { clearInterval(unmute); }
        }, 300);
      }
    } catch {}
  }, 800);
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
  if (player && player.stopVideo) player.stopVideo();
  updateUI();
  send(PH.MSG.QUEUE_UPDATE, { queue });
  broadcastState();
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
  if (player && player.loadVideoById) {
    player.loadVideoById({ videoId: song.videoId, suggestedQuality: 'hd720' });
    setTimeout(forcePlay, 500);
  } else {
    // Player belum siap (YouTube IFrame API belum selesai load)
    pendingVideoId = song.videoId;
  }
  updateUI();
  send(PH.MSG.NOW_PLAYING, { song: Object.assign({}, song, { index: currentIndex }), index: currentIndex });
  broadcastState();
}

function replay() {
  if (player && player.seekTo) { player.seekTo(0); player.playVideo(); }
  broadcastState();
}

function togglePlay() {
  if (!player) return;
  const s = player.getPlayerState ? player.getPlayerState() : -1;
  if (s === YT.PlayerState.PLAYING) player.pauseVideo(); else player.playVideo();
  broadcastState();
}

function seekTo(to) {
  if (player && player.seekTo) player.seekTo(Math.max(0, to || 0));
  broadcastState();
}

function setVolume(vol) {
  volume = Math.max(0, Math.min(100, vol));
  if (player && player.setVolume) player.setVolume(volume);
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

// YouTube IFrame API
function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    height: '100%', width: '100%',
    playerVars: {
      autoplay: 1,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      origin: location.origin,
      fs: 1
    },
    events: {
      onReady: () => {
        // Izinkan autoplay pada iframe YouTube (penting untuk WebView)
        try {
          const iframe = document.querySelector('#player iframe');
          if (iframe) iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
        } catch {}
        // Load lagu yang ditambahkan sebelum player siap
        if (pendingVideoId) {
          player.loadVideoById({ videoId: pendingVideoId, suggestedQuality: 'hd720' });
          pendingVideoId = null;
          setTimeout(forcePlay, 500);
        }
      },
      onStateChange: (e) => {
        isPlaying = e.data === YT.PlayerState.PLAYING;
        if (e.data === YT.PlayerState.ENDED) { if (modeLoop) replay(); else playNext(); }
        if (e.data === YT.PlayerState.CUED || e.data === YT.PlayerState.UNSTARTED) forcePlay();
        broadcastState();
      },
      onError: (e) => {
        // Kode error YouTube: 2 (id tidak valid), 5 (HTML5 error), 100 (tidak ditemukan),
        // 101/150 (embedding dilarang pemilik video) -> lewati ke lagu berikutnya.
        document.getElementById('status').textContent = 'Status: Video tidak bisa diputar (error ' + e.data + '), lanjut ke berikutnya...';
        setTimeout(playNext, 1500);
      }
    }
  });
}
var tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

// Browser memblokir autoplay bersuara sebelum ada gesture dari user.
// Klik pertama di layar akan memulai pemutaran yang tertunda.
document.addEventListener('click', () => {
  if (player && player.playVideo && currentIndex >= 0) player.playVideo();
}, { once: true });

init();
setInterval(broadcastState, 5000);

// Logout player: hapus room di server + kembali ke tampilan awal (QR + kode baru)
document.getElementById('screen-logout').addEventListener('click', () => {
  try { if (ws) ws.close(); } catch {}
  try { if (player && player.stopVideo) player.stopVideo(); } catch {}
  const code = roomCode;
  if (code) {
    fetch('/api/room/' + code, { method: 'DELETE' }).catch(() => {});
  }
  sessionStorage.removeItem('ph_code'); // reset pairing code
  location.href = 'index.html';
});
