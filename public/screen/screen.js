// Purplehat Screen - Authoritative player
var ws;
var roomCode = null;
var player;
var queue = [];
var currentIndex = -1;
var isPlaying = false;
var volume = 80;

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
    volume: volume
  };
}

async function init() {
  // create / get room
  try {
    const res = await fetch('/api/room/create', { method: 'POST' });
    const data = await res.json();
    roomCode = data.code;
    document.getElementById('join-code').textContent = roomCode;
    const qr = await fetch('/api/qr?text=' + encodeURIComponent(location.origin + '/?pair=' + roomCode));
    const qrd = await qr.json();
    const img = document.getElementById('qr-img');
    img.src = qrd.dataUrl;
    img.style.display = 'block';
  } catch (e) {
    document.getElementById('status').textContent = 'Status: Gagal membuat room';
    return;
  }

  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/?role=screen&code=' + roomCode);
  // ws uses same server; express static + ws both on http server; ws path is just host root
  ws.onopen = () => {
    document.getElementById('status').textContent = 'Status: Terhubung - scan QR / masukkan kode di HP';
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
  else if (index === currentIndex) { currentIndex--; playNext(); }
  updateQueueUI();
  send(PH.MSG.QUEUE_UPDATE, { queue });
  broadcastState();
}

function playNext() {
  if (queue.length === 0) {
    currentIndex = -1;
    if (player && player.stopVideo) player.stopVideo();
    updateUI();
    broadcastState();
    return;
  }
  currentIndex = (currentIndex + 1) % queue.length;
  const song = queue[currentIndex];
  if (player && player.loadVideoById) player.loadVideoById({ videoId: song.videoId, suggestedQuality: 'hd720' });
  updateUI();
  send(PH.MSG.NOW_PLAYING, { song, index: currentIndex });
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
  updateQueueUI();
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
    height: '100%', width: '100%', videoId: null,
    playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0, showinfo: 0, disablekb: 1, fs: 1 },
    events: { onReady: () => { document.getElementById('status').textContent += ' | Player siap'; }, onStateChange: (e) => { isPlaying = e.data === YT.PlayerState.PLAYING; if (e.data === YT.PlayerState.ENDED) playNext(); broadcastState(); }, onError: () => setTimeout(playNext, 1500) }
  });
}
var tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

init();
setInterval(broadcastState, 5000);
