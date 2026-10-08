// Purplehat Screen Menu - tampilan awal (QR pairing + slider promo)
var ws;
var roomCode = sessionStorage.getItem('ph_code');

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(PH.createMsg(type, payload)));
  }
}

async function init() {
  try {
    if (!roomCode) {
      const res = await fetch('/api/room/create', { method: 'POST' });
      const data = await res.json();
      roomCode = data.code;
      sessionStorage.setItem('ph_code', roomCode);
    }
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
  ws.onopen = () => {
    document.getElementById('status').textContent = 'Status: Menunggu controller...';
  };
  ws.onerror = () => {
    document.getElementById('status').textContent = 'Status: Realtime gagal';
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === PH.MSG.CONTROLLER_JOINED) {
      location.href = 'player.html';
    }
  };
  ws.onclose = () => {
    document.getElementById('status').textContent = 'Status: Terputus - refresh halaman';
  };
}

init();

// Slider promo otomatis
(function () {
  const slidesEl = document.getElementById('slides');
  const dotsEl = document.getElementById('dots');
  const count = slidesEl.children.length;
  let i = 0;
  for (let d = 0; d < count; d++) {
    const dot = document.createElement('span');
    if (d === 0) dot.classList.add('active');
    dotsEl.appendChild(dot);
  }
  setInterval(() => {
    i = (i + 1) % count;
    slidesEl.style.transform = 'translateX(-' + (i * 100) + '%)';
    Array.from(dotsEl.children).forEach((d, idx) => d.classList.toggle('active', idx === i));
  }, 3500);
})();
