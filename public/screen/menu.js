// Purplehat Screen Menu - tampilan awal (QR pairing + slider promo)
//
// Menunggu controller memakai LONG-POLL presence, bukan WebSocket idle:
// layar memanggil GET /api/room/:code/presence; server menahan request itu
// sampai ada controller yang connect (langsung dibalas) atau timeout, lalu
// layar langsung minta lagi. Tidak ada koneksi diam yang bisa mati diam-diam,
// jadi event pairing tidak pernah kelewat walau layar didiamkan lama.
var roomCode = sessionStorage.getItem('ph_code');
var navigating = false;

function t(key, params) { return (window.PH && PH.i18n) ? PH.i18n.t(key, params) : key; }

// MAC/ID device dikirim OLEH PLAYER (Flutter), bukan dibaca server.
// Flutter bisa menyuntikkannya sebagai:
//   - window.purplehatDeviceMac = "A4-42-3B-19-96-8C"  (evaluateJavascript), atau
//   - window.purplehat.deviceMac, atau
//   - query string  ?mac=A4-42-3B-19-96-8C  pada URL /screen/index.html
function deviceMac() {
  try {
    if (window.purplehatDeviceMac) return String(window.purplehatDeviceMac);
    if (window.purplehat && window.purplehat.deviceMac) return String(window.purplehat.deviceMac);
    var p = new URLSearchParams(location.search).get('mac');
    if (p) return p;
  } catch (e) {}
  return '';
}

// Setelah isi digandakan untuk animasi, terapkan ulang terjemahan ke salinan.
function applyI18n() {
  if (window.PH && PH.i18n) PH.i18n.apply(document);
}

async function init() {
  try {
    if (!roomCode) {
      const res = await fetch('/api/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: deviceMac() })
      });
      const data = await res.json();
      roomCode = data.code;
      sessionStorage.setItem('ph_code', roomCode);
    }
    document.getElementById('join-code').textContent = roomCode;
    // QR mengarah ke qr.html -> gate-install.html -> controller
    const qr = await fetch('/api/qr?text=' + encodeURIComponent(location.origin + '/controller/qr.html?pair=' + roomCode));
    const qrd = await qr.json();
    const img = document.getElementById('qr-img');
    img.src = qrd.dataUrl;
    img.style.display = 'block';
    document.getElementById('status').textContent = t('screen.status.waiting');
  } catch (e) {
    document.getElementById('status').textContent = t('screen.status.fail');
    return;
  }
  waitForController();
}

function goToPlayer() {
  if (navigating) return;
  navigating = true;
  document.getElementById('status').textContent = t('screen.status.connected');

  // Pada wrapper Windows, jangan pindah ke player.html sampai mpv benar-benar
  // bisa menerima perintah IPC. mpv tetap tersembunyi di belakang layar pairing.
  if (window.startMpv && window.postToHost) {
    var startedAt = Date.now();
    var attempts = 0;
    function prepareMpv() {
      window.onMpvReady = function(ready) {
        if (ready) {
          location.href = 'player.html';
          return;
        }
        if (attempts === 0 && window.startMpv) {
          attempts++;
          window.startMpv();
          return;
        }
        attempts++;
        if (Date.now() - startedAt < 15000) {
          // Coba startup kembali bila kegagalan sebelumnya karena HWND/mpv
          // belum siap. ensureStarted mencegah proses start yang tumpang tindih.
          if (attempts % 4 === 0 && window.startMpv) window.startMpv();
          setTimeout(prepareMpv, 250);
          return;
        }
        navigating = false;
        document.getElementById('status').textContent = t('screen.status.fail');
        waitForController();
      };
      window.postToHost({ type: 'checkMpvReady' });
    }
    prepareMpv();
    return;
  }

  // Browser biasa (tanpa bridge native) tetap menjalankan mode web.
  location.href = 'player.html';
}

// Satu putaran long-poll. Timeout client (32s) sengaja lebih panjang dari
// hold server (25s) supaya request yang menggantung karena koneksi mati pasti
// gagal lalu di-retry.
function waitForController() {
  if (navigating || !roomCode) return;
  const ctrl = new AbortController();
  const to = setTimeout(function () { ctrl.abort(); }, 32000);
  fetch('/api/room/' + roomCode + '/presence', { signal: ctrl.signal, cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (d) {
      clearTimeout(to);
      if (d && d.hasController) { goToPlayer(); return; }
      setTimeout(waitForController, 300);
    })
    .catch(function () {
      clearTimeout(to);
      setTimeout(waitForController, 1500);
    });
}

init();

// Promo: scroll vertikal ke atas terus-menerus (looping, tanpa dot).
// Isi digandakan agar animasi translateY(-50%) mulus tanpa jeda.
(function () {
  const slidesEl = document.getElementById('slides');
  if (!slidesEl) return;
  slidesEl.innerHTML += slidesEl.innerHTML;
  applyI18n(); // salinan ikut diterjemahkan
})();

document.addEventListener('ph-lang-change', applyI18n);
