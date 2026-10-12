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
// Lagu yang dihentikan lewat tombol Stop. Dipakai oleh tombol Play agar bisa
// melanjutkan lagu lagi setelah idle (bukan sekadar pause).
var stoppedSong = null;

// ==== Frame playback ====
var currentSource = 'karaoke'; // sumber lagu aktif
var frameSrc = null;            // dokumen yang sedang dimuat di iframe ('youtube'|'soundcloud'|'spotify')
var frameReady = false;         // frame sudah kirim pesan 'ready'
var pendingSong = null;         // lagu yang menunggu frame siap
var mediaPosition = 0;          // detik, dari frame
var mediaDuration = 0;          // detik, dari frame
var sp_dc = null;               // cookie login Spotify (per room, dari server)
var lyricsAvailable = null;     // true/false/null: lirik tersinkron untuk lagu Spotify aktif
var endedHandled = false;
var karaokeFxState = { pitch: 0, echo: 0, tempo: 1.0, bass: 0, treble: 0, channel: 'stereo' };
var mpvCommandCounter = 0;
var pendingMpvCommands = new Map();
var sourceTransitionId = 0;
var mpvStateRequestPending = false;

function t(key, params) { return (window.PH && PH.i18n) ? PH.i18n.t(key, params) : key; }

function isSC() { return currentSource === 'soundcloud'; }

// Sumber normal ('youtube'|'soundcloud'|'spotify'|'karaoke')
function songSource(song) {
  const s = song && song.source;
  return (s === 'soundcloud' || s === 'spotify' || s === 'karaoke') ? s : 'youtube';
}

// ID lagu: SoundCloud & Spotify pakai trackId, YouTube pakai videoId,
// Karaoke pakai songId bank lagu (fallback: path file).
function songId(song) {
  const s = songSource(song);
  if (s === 'karaoke') return song.songId || song.path;
  return s === 'youtube' ? song.videoId : song.trackId;
}

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
    lyricsAvailable: lyricsAvailable,
    modes: { loop: modeLoop, shuffle: modeShuffle, loopQueue: modeLoopQueue }
  };
}

// ==== Pemutar mpv lokal (wrapper Windows) ==================================
function sendMpvCommand(command) {
  if (isDesktop) {
    const requestId = ++mpvCommandCounter;
    return new Promise(function(resolve) {
      const timeout = setTimeout(function() {
        pendingMpvCommands.delete(requestId);
        resolve({ ok: false, error: 'timeout', command: command });
      }, 12000);
      pendingMpvCommands.set(requestId, {
        resolve: resolve,
        timeout: timeout,
        command: command
      });
      postToHost({
        type: 'mpvCommand',
        command: command,
        requestId: requestId
      });
    });
  }

  // Fallback web untuk deployment yang memang menyediakan mpv di backend.
  const name = command[0];
  let action = null;
  let body = {};
  if (name === 'loadfile') {
    action = 'load';
    body = { path: command[1], title: command[1] };
  } else if (name === 'stop') {
    action = 'stop';
  } else if (name === 'seek') {
    action = 'seek';
    body = { to: command[1] };
  } else if (name === 'set_property' && command[1] === 'pause') {
    action = command[2] ? 'pause' : 'play';
  }
  if (!action) return Promise.resolve({ ok: true });
  return fetch('/api/karaoke/player/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(response) {
    return { ok: response.ok, error: response.ok ? null : 'http_error', command: command };
  }).catch(function(error) {
    return { ok: false, error: String(error), command: command };
  });
}

function applyKaraokeState(st) {
  mpvStateRequestPending = false;
  if (currentSource !== 'karaoke') return;
  if (!st || !st.available) {
    isPlaying = false;
    mediaPosition = 0;
    mediaDuration = 0;
    broadcastState();
    return;
  }
  mediaPosition = Number(st.position) || 0;
  mediaDuration = Number(st.duration) || 0;
  isPlaying = !!st.playing && !st.paused;
  broadcastState();

  if (st.ended && !endedHandled) {
    endedHandled = true;
    isPlaying = false;
    if (modeLoop) replay();
    else playNext();
  } else if (!st.ended) {
    endedHandled = false;
  }
}

window.onMpvState = applyKaraokeState;
window.onMpvCommandResult = function(requestId, result) {
  const pending = pendingMpvCommands.get(requestId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingMpvCommands.delete(requestId);
    pending.resolve(result || { ok: false, error: 'empty_result' });
  }
  const command = result && result.command;
  if (result && result.ok) {
    if (currentSource === 'karaoke' && Array.isArray(command)) {
      if (command[0] === 'loadfile') {
        isPlaying = true;
        mediaPosition = 0;
        mediaDuration = 0;
        endedHandled = false;
        // Baca durasi segera setelah load. Polling berkala berikutnya hanya
        // berjalan saat benar-benar ada lagu yang sedang dimainkan.
        postToHost({ type: 'mpvState' });
      } else if (command[0] === 'set_property' && command[1] === 'pause') {
        isPlaying = command[2] === false;
      } else if (command[0] === 'stop') {
        isPlaying = false;
        mediaPosition = 0;
        mediaDuration = 0;
      }
      broadcastState();
    } else if (command && command[0] === 'stop' && currentIndex < 0) {
      isPlaying = false;
      mediaPosition = 0;
      mediaDuration = 0;
      broadcastState();
    }
    return;
  }

  console.error('PurpleHat mpv command failed:', requestId, result);
  const status = document.getElementById('status');
  if (status && currentSource === 'karaoke') {
    status.textContent = 'Karaoke player error: ' +
      ((result && (result.message || result.error)) || 'mpv IPC error');
    postToHost({ type: 'mpvState' });
  }
};

// ==== Komunikasi dengan frame pemutar ====
function frameURL(src) {
  if (src === 'soundcloud') return '/screen/soundcloud/player-sc.html';
  if (src === 'spotify') return '/screen/spotify/player-spty.html?v=20261010n';
  if (src === 'karaoke') return '';
  return '/screen/youtube/player-yt.html';
}

function sendFrame(m) {
  const f = document.getElementById('player-frame');
  if (f && f.contentWindow) f.contentWindow.postMessage(Object.assign({ ph: 1 }, m), '*');
}

function sendLoad(song) {
  const src = songSource(song);
  if (src === 'soundcloud') {
    sendFrame({ cmd: 'load', trackId: song.trackId, volume: frameVolume() });
  } else if (src === 'spotify') {
    sendFrame({ cmd: 'load', trackId: song.trackId, sp_dc: sp_dc, volume: frameVolume() });
  } else if (src === 'karaoke') {
    endedHandled = false;
    sendMpvCommand(['loadfile', song.path, 'replace']);
  } else {
    sendFrame({ cmd: 'load', videoId: song.videoId, volume: frameVolume() });
  }
}

// Muat lagu ke frame; ganti dokumen frame jika sumber berbeda
function startSong(song, stopRetry) {
  const src = songSource(song);
  stopRetry = stopRetry || 0;
  const f = document.getElementById('player-frame');
  const idle = document.getElementById('idle-screen');
  const transitionId = ++sourceTransitionId;
  stoppedSong = null;
  currentSource = src;
  lyricsAvailable = null;

  // Karaoke bukan iframe. Sebelum mpv memuat video, hentikan dan lepaskan
  // frame YouTube/SoundCloud/Spotify sebelumnya agar audionya tidak tertinggal.
  if (src === 'karaoke') {
    if (frameSrc !== 'karaoke') {
      if (frameSrc && frameSrc !== 'karaoke') sendFrame({ cmd: 'stop' });
      if (f) {
        try { f.src = 'about:blank'; } catch (e) {}
        f.classList.add('hidden');
      }
      frameReady = false;
      pendingSong = null;
      frameSrc = 'karaoke';
    }
    if (f) f.classList.add('hidden');
    if (idle) idle.classList.add('hidden');
    waitForMpvReadyAndLoad(song);
    return;
  }

  // Jangan mulai iframe baru sebelum mpv benar-benar menerima STOP. Ini
  // mencegah audio karaoke overlap jika perintah native/IPC sedikit lambat.
  if (frameSrc === 'karaoke') {
    if (f) f.classList.add('hidden');
    sendMpvCommand(['stop']).then(function(result) {
      if (transitionId !== sourceTransitionId) return;
      if (!result || !result.ok) {
        if (stopRetry < 2) {
          setTimeout(function() {
            if (transitionId === sourceTransitionId) startSong(song, stopRetry + 1);
          }, 250);
          return;
        }
        const status = document.getElementById('status');
        if (status) status.textContent = 'Could not stop karaoke player; check mpv IPC.';
        return;
      }
      frameSrc = null;
      frameReady = false;
      pendingSong = null;
      startSong(song);
    });
    return;
  }

  if (f) f.classList.remove('hidden');
  if (idle) idle.classList.add('hidden');

  if (frameSrc !== src) {
    if (frameSrc) sendFrame({ cmd: 'stop' });
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

// Poll mpv lokal di Windows; backend polling tetap dipakai sebagai web fallback.
function pollKaraoke() {
  if (currentSource !== 'karaoke') return;
  if (isDesktop) {
    // Saat pause/idle, status sudah diketahui dari respons perintah. Tidak
    // perlu membanjiri native IPC dengan pembacaan properti yang tak berubah.
    if (!isPlaying || mpvStateRequestPending) return;
    mpvStateRequestPending = true;
    postToHost({ type: 'mpvState' });
    return;
  }
  fetch('/api/karaoke/player/state', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(applyKaraokeState)
    .catch(function () { mpvStateRequestPending = false; });
}
setInterval(pollKaraoke, 1500);

// Pada wrapper Windows, tunggu konfirmasi kesiapan IPC sebelum memuat file.
function waitForMpvReadyAndLoad(song) {
  if (!isDesktop || songSource(song) !== 'karaoke') {
    sendLoad(song);
    return;
  }

  const transitionId = sourceTransitionId;
  let startRequested = false;
  let attempts = 0;
  function checkReady() {
    // Hasil kesiapan yang datang terlambat tidak boleh memuat lagu yang sudah
    // diganti oleh controller.
    if (transitionId !== sourceTransitionId || currentSource !== 'karaoke') return;
    window.onMpvReady = function(ready) {
      if (transitionId !== sourceTransitionId || currentSource !== 'karaoke') return;
      if (ready) {
        endedHandled = false;
        sendLoad(song);
        return;
      }
      if (!startRequested && window.startMpv) {
        startRequested = true;
        window.startMpv();
        return;
      }
      if (attempts++ < 50) {
        setTimeout(checkReady, 250);
        return;
      }
      const status = document.getElementById('status');
      if (status) status.textContent = 'Karaoke player is not ready. Check mpv.exe and IPC.';
      isPlaying = false;
      broadcastState();
    };
    if (window.postToHost) window.postToHost({ type: 'checkMpvReady' });
    else sendLoad(song);
  }
  checkReady();
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
  } else if (d.type === 'sp_dc_invalid') {
    // Spotify: sp_dc hilang/kedaluwarsa -> minta controller buka modal input.
    const st = document.getElementById('status');
    if (st) st.textContent = t('screen.status.spdcInvalid');
    isPlaying = false;
    send(PH.MSG.SPDC_INVALID, { sp_dc: sp_dc });
    broadcastState();
  } else if (d.type === 'lyrics_available') {
    // Frame Spotify melaporkan apakah lagu punya lirik tersinkron.
    lyricsAvailable = (d.available === undefined) ? null : !!d.available;
    send(PH.MSG.LYRICS_AVAIL, { available: lyricsAvailable, trackId: d.trackId || null });
    broadcastState();
  } else if (d.type === 'error') {
    if (currentSource === 'spotify') {
      // Sumber Spotify gagal (biasanya sp_dc) -> jangan lewati lagu,
      // beri tahu controller agar sp_dc diperbarui.
      const st2 = document.getElementById('status');
      if (st2) st2.textContent = t('screen.status.spotifyError');
      isPlaying = false;
      send(PH.MSG.SPDC_INVALID, { sp_dc: sp_dc });
      broadcastState();
      return;
    }
    const st = document.getElementById('status');
    if (st) st.textContent = t('screen.status.videoError');
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

  // Tampilkan kode room di pojok kanan atas layar player
  const codeEl = document.getElementById('room-code-badge');
  if (codeEl) codeEl.textContent = roomCode;

  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/?role=screen&code=' + roomCode);
  ws.onopen = () => {
    broadcastState();
    // Minta bahasa aktif ke controller (kalau controller sudah connect lebih dulu).
    send(PH.MSG.LANG_REQUEST, {});
  };
  ws.onerror = () => {
    document.getElementById('status').textContent = t('screen.status.realtimeFail');
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };
  ws.onclose = () => {
    document.getElementById('status').textContent = t('screen.status.disconnected');
  };
}

function handleMessage(msg) {
  const p = msg.payload || {};
  switch (msg.type) {
    case PH.MSG.JOIN:
      send(PH.MSG.STATE_SYNC, { state: getState() });
      send(PH.MSG.KARAOKE_FX_STATE, { fx: karaokeFxState });
      break;
    case PH.MSG.KARAOKE_FX_REQUEST:
      send(PH.MSG.KARAOKE_FX_STATE, { fx: karaokeFxState });
      break;
    case PH.MSG.KARAOKE_FX:
      if (p.fx && typeof p.fx === 'object') {
        karaokeFxState = Object.assign({}, karaokeFxState, p.fx);
        if (isDesktop) {
          postToHost({ type: 'mpvFx', fx: karaokeFxState });
        } else {
          fetch('/api/karaoke/player/fx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(karaokeFxState)
          }).catch(function () {});
        }
        send(PH.MSG.KARAOKE_FX_STATE, { fx: karaokeFxState });
      }
      break;
    case PH.MSG.ADD_SONG: addSong(p); break;
    case PH.MSG.REMOVE_SONG: removeSong(p.index); break;
    case PH.MSG.PLAY_PAUSE: togglePlay(); break;
    case PH.MSG.NEXT:
    case PH.MSG.SKIP: playNext(); break;
    case PH.MSG.REPLAY: replay(); break;
    case PH.MSG.STOP:
      // Ingat lagu yang berhenti supaya tombol Play bisa melanjutkannya lagi.
      stoppedSong = (currentIndex >= 0 && queue[currentIndex]) ? queue[currentIndex] : null;
      stopPlayback();
      break;
    case PH.MSG.SEEK: seekTo(p.to); break;
    case PH.MSG.VOLUME: setVolume(p.vol); break;
    case PH.MSG.REQUEST_STATE: broadcastState(); break;
    case PH.MSG.LOOP: modeLoop = !!p.on; broadcastState(); break;
    case PH.MSG.SHUFFLE: modeShuffle = !!p.on; broadcastState(); break;
    case PH.MSG.LOOP_QUEUE: modeLoopQueue = !!p.on; broadcastState(); break;
    case PH.MSG.MOVE_SONG: moveSong(p.index, p.dir, p.to); break;
    case PH.MSG.LYRICS:
      // Command lirik dari controller (tombol FX saat lagu Spotify aktif).
      sendFrame({ cmd: 'lyrics' });
      break;
    case PH.MSG.SPDC:
      // sp_dc tersimpan dari server (saat connect atau setelah diubah).
      sp_dc = p.sp_dc || null;
      // Kalau lagu Spotify sedang diputar, teruskan nilai baru ke frame.
      if (sp_dc && currentIndex >= 0 && queue[currentIndex] && songSource(queue[currentIndex]) === 'spotify') {
        sendLoad(queue[currentIndex]);
      }
      break;
    case PH.MSG.LANG:
      // Controller memilih bahasa -> terapkan ke seluruh layar TV.
      if (p.lang && PH.i18n) PH.i18n.setLang(p.lang);
      break;
    case PH.MSG.CONTROLLER_JOINED:
      document.getElementById('status').textContent = t('screen.status.controllerJoined');
      break;
    case PH.MSG.CONTROLLER_LEFT:
      // Controller putus mendadak (HP mati / sinyal hilang) BUKAN logout
      // sengaja. Jangan hentikan apa pun: biarkan playlist yang sedang
      // berjalan diselesaikan dulu sampai habis, baru idle. Layar tetap
      // hidup dan menunggu controller tersambung lagi.
      document.getElementById('status').textContent = t('screen.status.controllerLeft');
      break;
    case PH.MSG.CONTROLLER_LOGOUT:
      // Logout sengaja dari controller TIDAK lagi me-reset layar. Sesi/room
      // tetap hidup supaya controller bisa menyambung lagi dengan kode yang
      // sama; layar hanya menandai bahwa controller pergi (seperti putus
      // mendadak). Room baru dihapus saat player logout / form ditutup.
      document.getElementById('status').textContent = t('screen.status.controllerLogout');
      break;
  }
}

// Logout penuh (dipakai saat controller logout sengaja atau tombol logout
// layar): matikan pemutar, hapus room, buang kode, lalu kembali ke menu QR
// yang akan otomatis membuat kode room BARU.
function fullLogout() {
  // Hentikan sumber Karaoke tetapi biarkan proses mpv tetap standby untuk
  // pairing berikutnya. Native runner menyembunyikan child video setelah ACK.
  if (currentSource === 'karaoke') sendMpvCommand(['stop']);
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
  const src = (payload.source === 'soundcloud' || payload.source === 'spotify' || payload.source === 'karaoke') ? payload.source : 'youtube';
  const trackId = payload.trackId;
  if (src === 'youtube' && !videoId) return;
  if (src === 'karaoke') {
    if (!payload.path) return;
    const ksong = {
      videoId: null,
      trackId: null,
      songId: payload.songId || null,
      path: payload.path,
      source: 'karaoke',
      title: payload.title || String(payload.songId || ''),
      artist: payload.artist || '',
      thumbnail: payload.thumbnail || ''
    };
    if (payload.playNow) {
      queue.unshift(ksong);
      currentIndex = -1;
      updateQueueUI();
      send(PH.MSG.QUEUE_UPDATE, { queue });
      playNext();
      broadcastState();
      return;
    }
    queue.push(ksong);
    updateQueueUI();
    send(PH.MSG.QUEUE_UPDATE, { queue });
    if (currentIndex < 0) playNext();
    broadcastState();
    return;
  }
  if (src !== 'youtube' && !trackId) return;
  const song = {
    videoId: videoId || null,
    trackId: trackId || null,
    source: src,
    title: payload.title || videoId || String(trackId || ''),
    artist: payload.artist || '',
    thumbnail: payload.thumbnail || (videoId ? 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg' : '')
  };
  // playNow: lagu ditaruh di PALING ATAS antrian lalu langsung diputar.
  if (payload.playNow) {
    queue.unshift(song);
    currentIndex = -1;
    updateQueueUI();
    send(PH.MSG.QUEUE_UPDATE, { queue });
    playNext();
    broadcastState();
    return;
  }
  queue.push(song);
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

// Geser lagu naik/turun dalam antrian, atau pindah ke indeks tertentu
// (dipakai drag & drop: payload.to). Dir tetap didukung untuk kompatibilitas.
function moveSong(index, dir, toExplicit) {
  if (index == null || index < 0 || index >= queue.length) return;
  const to = (typeof toExplicit === 'number') ? toExplicit : index + dir;
  if (to < 0 || to >= queue.length || to === index) return;
  const [song] = queue.splice(index, 1);
  queue.splice(to, 0, song);
  if (currentIndex === index) currentIndex = to;
  else if (index < currentIndex && to >= currentIndex) currentIndex--;
  else if (index > currentIndex && to <= currentIndex) currentIndex++;
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
  // Hentikan player yang benar: mpv lokal untuk Karaoke, iframe untuk sumber lain.
  if (currentSource === 'karaoke') sendMpvCommand(['stop']);
  else sendFrame({ cmd: 'stop' });
  closeFrame();
  updateUI();
  send(PH.MSG.QUEUE_UPDATE, { queue });
  broadcastState();
  // Pastikan tampil idle
  const idle = document.getElementById('idle-screen');
  if (idle) idle.classList.remove('hidden');
}

// Lepaskan dokumen pemutar supaya tidak ada audio yang tertinggal.
function closeFrame() {
  const f = document.getElementById('player-frame');
  frameReady = false;
  // Tetap tandai Karaoke sampai mpv menerima STOP. Bila controller menekan
  // Play/Next lagi, transisi ke iframe harus menunggu ACK stop yang nyata.
  frameSrc = currentSource === 'karaoke' ? 'karaoke' : null;
  pendingSong = null;
  if (f) {
    try { f.src = 'about:blank'; } catch (e) {}
    f.classList.add('hidden');
  }
  // Kembalikan ke idle
  const idle = document.getElementById('idle-screen');
  if (idle) idle.classList.remove('hidden');
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
  if (!songId(song)) {
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
  if (currentSource === 'karaoke') {
    // Muat ulang file sebagai satu IPC command, menghindari race antara seek
    // dan unpause yang sebelumnya dikirim hampir bersamaan.
    const song = queue[currentIndex];
    if (song && song.path) sendMpvCommand(['loadfile', song.path, 'replace']);
  } else {
    sendFrame({ cmd: 'replay' });
  }
  broadcastState();
}

// Putar lagu pada indeks tertentu (dipakai Play untuk melanjutkan lagu yang di-Stop)
function playAt(index) {
  if (index < 0 || index >= queue.length) return;
  const song = queue[index];
  if (!songId(song)) return;
  currentIndex = index;
  startSong(song);
  updateUI();
  send(PH.MSG.NOW_PLAYING, { song: Object.assign({}, song, { index }), index });
  broadcastState();
}

function togglePlay() {
  // Idle (mis. baru di-Stop atau antrian habis): tombol play memulai lagi.
  if (currentIndex < 0 || !queue[currentIndex]) {
    const idx = stoppedSong ? queue.indexOf(stoppedSong) : -1;
    if (idx >= 0) playAt(idx);
    else if (queue.length) playNext();
    return;
  }
  if (currentSource === 'karaoke') {
    // Perbarui UI langsung untuk respons tombol; native callback akan
    // mengonfirmasi atau mengoreksi sesuai hasil aktual dari mpv.
    const nextPlaying = !isPlaying;
    isPlaying = nextPlaying;
    broadcastState();
    sendMpvCommand(['set_property', 'pause', !nextPlaying]).then(function(result) {
      if (!result || !result.ok) postToHost({ type: 'mpvState' });
    });
    return;
  }

  sendFrame({ cmd: isPlaying ? 'pause' : 'play' });
  isPlaying = !isPlaying;
  broadcastState();
}

function seekTo(to) {
  const target = Math.max(0, to || 0);
  if (currentSource === 'karaoke') {
    sendMpvCommand(['seek', target, 'absolute']);
  } else {
    sendFrame({ cmd: 'seek', to: target });
  }
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
  // Volume frame dibiarkan 100 agar tidak dobel (termasuk Karaoke/mpv).
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
  np.textContent = currentIndex >= 0 && queue[currentIndex] ? t('screen.nowPlaying', { title: queue[currentIndex].title }) : t('screen.waitingFirst');
  qc.textContent = t('screen.queueCount', { n: queue.length });
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

// Bahasa berubah (dari controller) -> segarkan teks dinamis.
document.addEventListener('ph-lang-change', function () { updateUI(); });

init();
setInterval(broadcastState, 5000);

// Logout player: pakai fullLogout (matikan frame, hapus room, regenerate kode)
document.getElementById('screen-logout').addEventListener('click', () => {
  fullLogout();
});
