// Purplehat - Settings (controller)
// Bahasa aplikasi, Tentang Kami, Kebijakan Privasi, versi, dan Logout.
//
// Bahasa hanya diubah dari sini (controller). Pilihan disimpan di localStorage
// ('ph_lang') dan dikirim ke layar TV lewat pesan WebSocket LANG.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function t(key, params) { return PH.i18n.t(key, params); }
  function refreshIcons() { if (window.lucide) lucide.createIcons(); }

  // ==== Kirim satu pesan sesaat ke layar (tanpa menahan koneksi) ====
  function sendOnce(type, payload, cb) {
    var code = null;
    try { code = localStorage.getItem('ph_last_code'); } catch (e) { }
    if (!code) { if (cb) cb(); return; }
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var w = null;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      try { if (w) w.close(); } catch (e) { }
      if (cb) cb();
    }
    try {
      w = new WebSocket(proto + location.host + '/?role=controller&code=' + encodeURIComponent(code));
    } catch (e) { if (cb) cb(); return; }
    w.onopen = function () {
      try { w.send(JSON.stringify(PH.createMsg(type, payload || {}))); } catch (e) { }
      setTimeout(finish, 140);
    };
    w.onerror = finish;
    w.onclose = finish;
    setTimeout(finish, 1600);
  }

  // ==== Bahasa ====
  function paintLang() {
    var cur = PH.i18n.getLang();
    var opts = document.querySelectorAll('#lang-choice .lang-opt');
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.toggle('active', opts[i].getAttribute('data-lang') === cur);
    }
  }

  var langOpts = document.querySelectorAll('#lang-choice .lang-opt');
  for (var i = 0; i < langOpts.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var lang = btn.getAttribute('data-lang');
        if (lang === PH.i18n.getLang()) return;
        PH.i18n.setLang(lang);
        paintLang();
        refreshIcons();
        // Layar TV ikut berubah "live" (best-effort); saat kembali ke
        // controller, bahasa juga dikirim ulang lewat pesan JOIN.
        sendOnce(PH.MSG.LANG, { lang: lang });
      });
    })(langOpts[i]);
  }

  // ==== Tentang Kami / Kebijakan Privasi ====
  var infoKeys = null;
  function paintInfo() {
    if (!infoKeys) return;
    $('info-title').textContent = t(infoKeys.title);
    $('info-body').innerHTML = t(infoKeys.body);
  }
  function openInfo(titleKey, bodyKey) {
    infoKeys = { title: titleKey, body: bodyKey };
    $('info-modal').classList.remove('hidden');
    paintInfo();
    refreshIcons();
  }
  $('row-about').addEventListener('click', function () { openInfo('settings.about', 'about.body'); });
  $('row-privacy').addEventListener('click', function () { openInfo('settings.privacy', 'privacy.body'); });

  // ==== Penutup modal ====
  var closers = document.querySelectorAll('[data-close]');
  for (var c = 0; c < closers.length; c++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var el = $(btn.getAttribute('data-close'));
        if (el) el.classList.add('hidden');
      });
    })(closers[c]);
  }
  var modals = document.querySelectorAll('.modal');
  for (var m = 0; m < modals.length; m++) {
    (function (mo) {
      mo.addEventListener('click', function (e) { if (e.target === mo) mo.classList.add('hidden'); });
    })(modals[m]);
  }

  // ==== Kembali ke controller ====
  function goBack() { location.href = 'index.html'; }
  $('settings-back').addEventListener('click', goBack);

  // ==== Logout: beri tahu layar, buang kode, kembali ke pairing ====
  function doLogout() {
    $('row-logout').disabled = true;
    sendOnce(PH.MSG.CONTROLLER_LOGOUT, {}, function () {
      try { localStorage.removeItem('ph_last_code'); } catch (e) { }
      location.replace('index.html');
    });
  }
  $('row-logout').addEventListener('click', doLogout);

  // ==== Versi aplikasi ====
  $('app-version').textContent = PH.APP_VERSION || '1.0.0';

  // Bahasa berubah dari tab lain -> segarkan pilihan & isi modal.
  document.addEventListener('ph-lang-change', function () {
    paintLang();
    paintInfo();
  });

  paintLang();
  refreshIcons();
})();
