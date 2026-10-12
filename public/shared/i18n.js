// Purplehat Shared i18n (English + Indonesian)
// Satu sumber terjemahan untuk controller (HP) dan layar TV (menu & player).
// Bahasa default: English. Disimpan di localStorage 'ph_lang'.
//
// Cara pakai:
//   PH.i18n.t('key')                 -> string terjemahan (mendukung {param})
//   PH.i18n.setLang('id' | 'en')     -> ganti bahasa + apply ke DOM + event
//   PH.i18n.getLang()                -> bahasa aktif
//   PH.i18n.apply(root)              -> terapkan ke seluruh DOM
//
// Atribut markup:
//   data-i18n="key"              -> textContent
//   data-i18n-html="key"         -> innerHTML
//   data-i18n-title="key"        -> title
//   data-i18n-aria="key"         -> aria-label
//   data-i18n-placeholder="key"  -> placeholder
//   data-i18n-alt="key"          -> alt
(function () {
  'use strict';
  var PH = (window.PH = window.PH || {});

  PH.APP_VERSION = '1.0.0';

  var DICT = {
    id: {
      // ---- Umum ----
      'common.close': 'Tutup',
      'common.cancel': 'Batal',
      'common.add': 'Tambah',
      'common.back': 'Kembali',

      // ---- Layar pairing ----
      'pair.title': 'Hubungkan ke Player',
      'pair.hint': 'Masukkan kode pairing dari layar TV/Desktop, atau scan QR.',
      'pair.codePlaceholder': 'KODEXX',
      'pair.codeAria': 'Kode pairing',
      'pair.connect': 'Hubungkan',
      'pair.scan': 'Scan QR',
      'pair.scanHowTitle': 'Cara scan QR:',
      'pair.scanHowText': 'klik tombol di atas, izinkan akses kamera saat diminta browser, lalu arahkan kamera ke kode QR yang tampil di layar player.',
      'pair.closeCam': 'Tutup Kamera',
      'pair.status.checking': 'Memeriksa kode...',
      'pair.status.contacting': 'Menghubungi realtime...',
      'pair.status.notFound': 'Kode tidak ditemukan',
      'pair.status.invalid': 'Kode tidak valid',
      'pair.status.realtimeFail': 'Realtime gagal. Coba lagi...',
      'pair.status.retry': 'Hubungan realtime gagal (percobaan {n}). Mencoba lagi...',
      'pair.status.polling': 'Mode polling (realtime tidak aktif di koneksi ini). Tetap berfungsi.',
      'pair.status.camUnavailable': 'Kamera tidak tersedia',

      // ---- Header / status ----
      'header.notConnected': 'Belum terhubung',
      'header.settings': 'Pengaturan',
      'header.reconnecting': 'Menyambung ulang',
      'header.playing': 'Sedang memutar',
      'header.connected': 'Terhubung',
      'header.offline': 'Belum terhubung',

      // ---- Pencarian ----
      'search.placeholder': 'Cari lagu, artis...',
      'search.aria': 'Cari lagu',
      'src.youtubeTitle': 'Tersedia di YouTube',
      'src.soundcloudTitle': 'Tersedia di SoundCloud',
      'src.spotifyTitle': 'Tersedia di Spotify',
      'src.karaokeTitle': 'Tersedia di bank lagu Karaoke',
      'search.searching': 'Mencari di {src}...',
      'search.failed': 'Gagal mencari',
      'search.loadingMore': 'Memuat hasil lagi...',
      'search.end': '— Akhir dari hasil —',
      'search.empty': 'Tidak ada hasil',
      'search.addUpNext': 'Tambah ke Up Next',

      // ---- Dock / transport ----
      'dock.waiting': 'Menunggu lagu...',
      'dock.brandSub': 'Purplehat Karaoke',
      'transport.stop': 'Stop lagu',
      'transport.replay': 'Putar ulang',
      'transport.playPause': 'Play / Pause',
      'transport.nextTitle': 'Lewati / Berikutnya',
      'transport.nextAria': 'Berikutnya',
      'transport.loop': 'Loop',
      'transport.volume': 'Volume',
      'transport.fx': 'FX & Tuning',
      'transport.upNext': 'Up Next',
      'transport.loopOff': 'Loop: mati',
      'transport.loopQueue': 'Loop: semua antrian',
      'transport.loopOne': 'Loop: lagu ini',

      // ---- Modal FX ----
      'fx.title': 'FX & Tuning',
      'fx.echo': 'Echo Delay',
      'fx.echoAria': 'Echo delay',
      'fx.keyShift': 'Key Shift',
      'fx.pitchDown': 'Turunkan nada',
      'fx.pitchUp': 'Naikkan nada',
      'fx.vocalCancel': 'Vocal Cancel',
      'fx.vocalCancelHint': 'Hapus vokal lagu asli',
      'fx.lyricsOn': 'Lirik tersedia',
      'fx.lyricsOff': 'Lirik tidak tersedia',
      'fx.lyricsUnknown': 'Belum tahu lirik tersedia',
      'fx.tempo': 'Tempo',
      'fx.bass': 'Bass',
      'fx.treble': 'Treble',
      'fx.channel': 'Channel / Vokal',
      'fx.chStereo': 'Stereo',
      'fx.chMusic': 'Musik',
      'fx.chVocal': 'Vokal',
      'fx.chLeft': 'Kiri (L)',
      'fx.chRight': 'Kanan (R)',
      'fx.chVocalOff': 'Hilangkan Vokal',

      // ---- Modal volume ----
      'volume.title': 'Master Volume',
      'volume.down': 'Volume turun',
      'volume.up': 'Volume naik',
      'volume.hint': 'Tekan tahan tombol −/+ untuk naik/turun cepat.',

      // ---- Modal sp_dc Spotify ----
      'spdc.title': 'Login Spotify',
      'spdc.hint': 'Tempelkan cookie <strong>sp_dc</strong> dari akun Spotify. Buka <em>open.spotify.com</em> &rarr; DevTools &rarr; Application &rarr; Cookies &rarr; salin nilai <strong>sp_dc</strong>.',
      'spdc.placeholder': 'Tempel nilai sp_dc di sini...',
      'spdc.aria': 'Nilai sp_dc Spotify',
      'spdc.save': 'Simpan & Lanjut',
      'spdc.checking': 'Memeriksa...',
      'spdc.errShort': 'sp_dc terlalu pendek / tidak valid.',
      'spdc.errInvalid': 'sp_dc tidak valid atau kedaluwarsa. Coba salin ulang.',
      'spdc.errSave': 'Gagal menyimpan sp_dc. Coba lagi.',
      'spdc.errServer': 'Gagal menghubungi server. Coba lagi.',
      'spdc.need': 'Masukkan sp_dc Spotify untuk room ini.',
      'spdc.expired': 'sp_dc tersimpan sudah tidak valid / kedaluwarsa. Masukkan yang baru.',
      'spdc.invalid': 'sp_dc Spotify tidak valid / kedaluwarsa. Tempel nilai baru.',

      // ---- Modal Up Next ----
      'upnext.title': 'Up Next',
      'upnext.empty': 'Antrian kosong',
      'upnext.shuffle': 'Acak urutan',
      'upnext.gripTitle': 'Tahan & geser untuk urutkan',
      'upnext.gripAria': 'Tahan dan geser untuk urutkan',
      'upnext.remove': 'Hapus',

      // ---- Modal konfirmasi tambah ----
      'confirm.title': 'Tambah ke Up Next?',
      'confirm.hint': 'Lagu ini akan ditambahkan ke antrian <strong>Up Next</strong>.',

      // ---- Halaman Setting ----
      'settings.title': 'Pengaturan',
      'settings.language': 'Bahasa',
      'settings.languageDesc': 'Pilih bahasa aplikasi',
      'settings.about': 'Tentang Kami',
      'settings.privacy': 'Kebijakan Privasi',
      'settings.logout': 'Keluar',
      'settings.logoutDesc': 'Putuskan dari layar & kembali ke pairing',
      'settings.version': 'Versi Aplikasi',
      'settings.lang.id': 'Bahasa Indonesia',
      'settings.lang.en': 'English',
      'settings.back': 'Kembali',
      'about.body': 'Purplehat adalah aplikasi karaoke yang mengubah HP kamu menjadi controller untuk layar TV/desktop. Pilih lagu dari YouTube, SoundCloud, atau Spotify, atur antrian, lalu nyanyi bareng tanpa rebutan mic.<br><br>Dibuat untuk malam karaoke yang seru bersama teman dan keluarga.',
      'privacy.body': 'Purplehat tidak mengumpulkan data pribadi.<br><br>Kode pairing dan antrian lagu hanya dipakai selama sesi berlangsung. Cookie login Spotify (sp_dc) yang kamu masukkan disimpan di server room hanya untuk memutar lagu, dan dihapus saat sesi berakhir.',

      // ---- Layar TV: menu ----
      'screen.pairCode': 'Kode Pairing:',
      'screen.status.preparing': 'Status: Menyiapkan...',
      'screen.status.waiting': 'Status: Menunggu controller...',
      'screen.status.fail': 'Status: Gagal membuat room',
      'screen.status.connected': 'Status: Controller terhubung!',
      'screen.promo1Title': 'Karaoke Bareng',
      'screen.promo1Text': 'Hubungkan HP kamu & mulai nyanyi sekarang.',
      'screen.promo2Title': 'Antrian Pintar',
      'screen.promo2Text': 'Pilih lagu, atur urutan, tanpa rebutan mic.',
      'screen.promo3Title': 'Malam Karaoke',
      'screen.promo3Text': 'Ajak teman & keluarga, party jadi makin seru!',

      // ---- Layar TV: player ----
      'screen.roomCode': 'Kode Room:',
      'screen.logout': 'Logout',
      'screen.idleWaiting': 'Menunggu lagu berikutnya...',
      'screen.availableNow': 'Tersedia sekarang',
      'screen.status.spdcInvalid': 'Status: sp_dc Spotify tidak valid - masukkan ulang dari controller',
      'screen.status.spotifyError': 'Status: Spotify tidak bisa diputar - cek sp_dc',
      'screen.status.videoError': 'Status: Video tidak bisa diputar, lanjut ke berikutnya...',
      'screen.status.realtimeFail': 'Status: Realtime gagal - cek port 3000 public',
      'screen.status.disconnected': 'Status: Terputus - refresh halaman',
      'screen.status.controllerJoined': 'Status: Controller terhubung',
      'screen.status.controllerLeft': 'Status: Controller terputus - menunggu sambungan ulang...',
      'screen.status.controllerLogout': 'Status: Controller logout - menunggu sambungan ulang...',
      'screen.nowPlaying': 'Sedang Diputar: {title}',
      'screen.waitingFirst': 'Menunggu lagu pertama...',
      'screen.queueCount': 'Antrian: {n}',

      // ---- Gerbang instalasi ----
      'gate.installTitle': 'Pasang Purplehat',
      'gate.installText': 'Agar lebih cepat dan seperti aplikasi asli, pasang Purplehat ke layar utama HP kamu. Setelah terpasang, Purplehat terbuka sebagai aplikasi (bukan di browser).',
      'gate.installBtnWaiting': 'Menunggu Chrome…',
      'gate.installBtn': 'Pasang Sekarang',
      'gate.manualToggle': 'Chrome tidak menampilkan pemasangan? Lihat cara pasang manual',
      'gate.step1': 'Ketuk <b>⋮</b> (menu Chrome) di pojok kanan atas.',
      'gate.step2': 'Pilih <b>Instal aplikasi</b> / <b>Tambahkan ke layar utama</b>, lalu konfirmasi.',
      'gate.step3': 'Selesaikan pemasangan. Setelah aplikasi benar-benar ada di layar utama, halaman ini menampilkan tombol "Buka Purplehat".',
      'gate.manualOpen': 'Sudah Dipasang — Buka Purplehat',
      'gate.openTitle': 'Terpasang!',
      'gate.openText': 'Purplehat sudah terpasang di layar utama HP kamu. Ketuk tombol di bawah untuk membuka aplikasinya.',
      'gate.openLink': 'Buka Purplehat',
      'gate.openHint': 'Kalau yang terbuka tetap tab ini, buka Purplehat dari ikon di layar utama HP kamu.',
      'gate.iosTitle': 'Pasang Purplehat',
      'gate.iosText': 'Di iPhone / iPad pasang manual lewat Safari. Tab biasa tidak bisa membuka controller — Purplehat harus dibuka dari ikon di layar utama.',
      'gate.iosStep1': 'Ketuk tombol <b>Bagikan</b> (ikon kotak dengan panah).',
      'gate.iosStep2': 'Pilih <b>Tambahkan ke Layar Utama</b>, lalu <b>Tambah</b>.',
      'gate.iosStep3': 'Buka Purplehat dari ikon di layar utama — di situlah controller terbuka.',
      'gate.iosOpen': 'Buka Purplehat',
      'gate.progressWaiting': 'Tahap 1/3 · Menunggu Chrome menyiapkan pemasangan…',
      'gate.progressReady': 'Tahap 1/3 · Chrome siap memasang. Ketuk "Pasang Sekarang" untuk melanjutkan.',
      'gate.progressInstalling': 'Tahap 2/3 · Selesaikan pemasangan di jendela Chrome…',
      'gate.progressFinishing': 'Tahap 2/3 · Menyelesaikan pemasangan…',
      'gate.progressVerifying': 'Tahap 3/3 · Memeriksa apakah aplikasi sudah ada di layar utama…',
      'gate.progressDone': 'Tahap 3/3 · Aplikasi terpasang di layar utama. Ketuk "Buka Purplehat" untuk masuk.',
      'gate.progressOpening': 'Tahap 3/3 · Membuka aplikasi Purplehat…',
      'gate.progressInstalled': 'Tahap 3/3 · Aplikasi sudah terpasang. Ketuk "Buka Purplehat" untuk membuka…',
      'gate.progressAppOpened': 'Purplehat sedang terbuka di aplikasi. Tab ini bisa ditutup.',
      'gate.installing': 'Memasang…',
      'gate.bouncedTitle': 'Buka Purplehat',
      'gate.bouncedText': 'Browser tidak bisa menampilkan controller — Purplehat hanya berjalan sebagai aplikasi. Ketuk tombol di bawah untuk mencoba membuka aplikasinya.',
      'gate.bouncedHint': 'Cara paling pasti: ketuk ikon Purplehat di layar utama HP kamu.',
      'gate.notInstalled': 'Purplehat belum terpasang. Selesaikan pemasangan dulu lewat langkah di atas.',
      'gate.alreadyTitle': 'Purplehat Terpasang',
      'gate.alreadyText': 'Purplehat sudah terpasang di HP ini. Ketuk tombol di bawah untuk membukanya.',
      'gate.alreadyHint': 'Kalau halaman ini terbuka kembali di browser, ketuk tombol di bawah atau buka Purplehat dari ikon di layar utama.',
      'gate.cantInstallWebview': 'Halaman ini terbuka di dalam aplikasi lain sehingga tidak bisa memasang Purplehat. Buka link ini di aplikasi Chrome agar bisa memasang.',
      'gate.cantInstallBrowser': 'Browser ini tidak menampilkan tombol pasang otomatis. Pasang Purplehat lewat langkah manual di bawah.',
      'gate.promptFail': 'Chrome tidak bisa menampilkan pemasangan. Pasang lewat menu ⋮ (langkah manual di bawah).',
      'gate.cancelled': 'Pemasangan dibatalkan. Ketuk "Pasang Sekarang" lagi, atau pasang lewat menu ⋮.',
      'gate.iosStillBrowser': 'Masih terbuka di browser. Purplehat harus dibuka dari <b>ikon di layar utama</b> (bukan dari tab Safari). Kalau ikonnya belum ada, ikuti langkah di atas dulu.',
      'gate.openHint2': 'Belum membuka aplikasi? Kalau Purplehat sudah terpasang tapi tombol ini tidak bisa membukanya, coba hapus dan pasang ulang dari halaman ini, atau buka Purplehat langsung dari ikon di layar utama HP kamu.',

      // ---- Splash QR ----
      'qr.opening': 'Membuka Purplehat…'
    },

    en: {
      // ---- Common ----
      'common.close': 'Close',
      'common.cancel': 'Cancel',
      'common.add': 'Add',
      'common.back': 'Back',

      // ---- Pairing ----
      'pair.title': 'Connect to Player',
      'pair.hint': 'Enter the pairing code from the TV/Desktop screen, or scan the QR.',
      'pair.codePlaceholder': 'CODEXX',
      'pair.codeAria': 'Pairing code',
      'pair.connect': 'Connect',
      'pair.scan': 'Scan QR',
      'pair.scanHowTitle': 'How to scan the QR:',
      'pair.scanHowText': 'tap the button above, allow camera access when the browser asks, then point the camera at the QR code shown on the player screen.',
      'pair.closeCam': 'Close Camera',
      'pair.status.checking': 'Checking code...',
      'pair.status.contacting': 'Connecting to realtime...',
      'pair.status.notFound': 'Code not found',
      'pair.status.invalid': 'Invalid code',
      'pair.status.realtimeFail': 'Realtime failed. Try again...',
      'pair.status.retry': 'Realtime connection failed (attempt {n}). Retrying...',
      'pair.status.polling': 'Polling mode (realtime inactive on this connection). Still works.',
      'pair.status.camUnavailable': 'Camera unavailable',

      // ---- Header / status ----
      'header.notConnected': 'Not connected',
      'header.settings': 'Settings',
      'header.reconnecting': 'Reconnecting',
      'header.playing': 'Now playing',
      'header.connected': 'Connected',
      'header.offline': 'Not connected',

      // ---- Search ----
      'search.placeholder': 'Search songs, artists...',
      'search.aria': 'Search songs',
      'src.youtubeTitle': 'Available on YouTube',
      'src.soundcloudTitle': 'Available on SoundCloud',
      'src.spotifyTitle': 'Available on Spotify',
      'src.karaokeTitle': 'Available in the Karaoke song bank',
      'search.searching': 'Searching {src}...',
      'search.failed': 'Search failed',
      'search.loadingMore': 'Loading more results...',
      'search.end': '— End of results —',
      'search.empty': 'No results',
      'search.addUpNext': 'Add to Up Next',

      // ---- Dock / transport ----
      'dock.waiting': 'Waiting for a song...',
      'dock.brandSub': 'Purplehat Karaoke',
      'transport.stop': 'Stop song',
      'transport.replay': 'Replay',
      'transport.playPause': 'Play / Pause',
      'transport.nextTitle': 'Skip / Next',
      'transport.nextAria': 'Next',
      'transport.loop': 'Loop',
      'transport.volume': 'Volume',
      'transport.fx': 'FX & Tuning',
      'transport.upNext': 'Up Next',
      'transport.loopOff': 'Loop: off',
      'transport.loopQueue': 'Loop: all queue',
      'transport.loopOne': 'Loop: this song',

      // ---- FX modal ----
      'fx.title': 'FX & Tuning',
      'fx.echo': 'Echo Delay',
      'fx.echoAria': 'Echo delay',
      'fx.keyShift': 'Key Shift',
      'fx.pitchDown': 'Lower pitch',
      'fx.pitchUp': 'Raise pitch',
      'fx.vocalCancel': 'Vocal Cancel',
      'fx.vocalCancelHint': 'Remove original track vocals',
      'fx.lyricsOn': 'Lyrics available',
      'fx.lyricsOff': 'Lyrics unavailable',
      'fx.lyricsUnknown': 'Lyrics availability unknown',
      'fx.tempo': 'Tempo',
      'fx.bass': 'Bass',
      'fx.treble': 'Treble',
      'fx.channel': 'Channel / Vocal',
      'fx.chStereo': 'Stereo',
      'fx.chMusic': 'Music',
      'fx.chVocal': 'Vocal',
      'fx.chLeft': 'Left (L)',
      'fx.chRight': 'Right (R)',
      'fx.chVocalOff': 'Remove Vocal',

      // ---- Volume modal ----
      'volume.title': 'Master Volume',
      'volume.down': 'Volume down',
      'volume.up': 'Volume up',
      'volume.hint': 'Press and hold −/+ to adjust quickly.',

      // ---- sp_dc modal ----
      'spdc.title': 'Spotify Login',
      'spdc.hint': 'Paste the <strong>sp_dc</strong> cookie from your Spotify account. Open <em>open.spotify.com</em> &rarr; DevTools &rarr; Application &rarr; Cookies &rarr; copy the <strong>sp_dc</strong> value.',
      'spdc.placeholder': 'Paste the sp_dc value here...',
      'spdc.aria': 'Spotify sp_dc value',
      'spdc.save': 'Save & Continue',
      'spdc.checking': 'Checking...',
      'spdc.errShort': 'sp_dc is too short / invalid.',
      'spdc.errInvalid': 'sp_dc is invalid or expired. Try copying it again.',
      'spdc.errSave': 'Failed to save sp_dc. Try again.',
      'spdc.errServer': 'Failed to reach the server. Try again.',
      'spdc.need': 'Enter the Spotify sp_dc for this room.',
      'spdc.expired': 'The saved sp_dc is no longer valid / expired. Enter a new one.',
      'spdc.invalid': 'Spotify sp_dc is invalid / expired. Paste a new value.',

      // ---- Up Next modal ----
      'upnext.title': 'Up Next',
      'upnext.empty': 'Queue is empty',
      'upnext.shuffle': 'Shuffle',
      'upnext.gripTitle': 'Hold & drag to reorder',
      'upnext.gripAria': 'Hold and drag to reorder',
      'upnext.remove': 'Remove',

      // ---- Confirm add modal ----
      'confirm.title': 'Add to Up Next?',
      'confirm.hint': 'This song will be added to the <strong>Up Next</strong> queue.',

      // ---- Settings page ----
      'settings.title': 'Settings',
      'settings.language': 'Language',
      'settings.languageDesc': 'Choose the app language',
      'settings.about': 'About Us',
      'settings.privacy': 'Privacy Policy',
      'settings.logout': 'Log out',
      'settings.logoutDesc': 'Disconnect from the screen & return to pairing',
      'settings.version': 'App Version',
      'settings.lang.id': 'Bahasa Indonesia',
      'settings.lang.en': 'English',
      'settings.back': 'Back',
      'about.body': 'Purplehat is a karaoke app that turns your phone into a controller for your TV/desktop screen. Pick songs from YouTube, SoundCloud, or Spotify, manage the queue, then sing together without fighting over the mic.<br><br>Made for a fun karaoke night with friends and family.',
      'privacy.body': 'Purplehat does not collect personal data.<br><br>Pairing codes and song queues are only used for the duration of the session. The Spotify login cookie (sp_dc) you enter is stored on the room server only to play songs, and is removed when the session ends.',

      // ---- TV screen: menu ----
      'screen.pairCode': 'Pairing Code:',
      'screen.status.preparing': 'Status: Preparing...',
      'screen.status.waiting': 'Status: Waiting for controller...',
      'screen.status.fail': 'Status: Failed to create room',
      'screen.status.connected': 'Status: Controller connected!',
      'screen.promo1Title': 'Karaoke Together',
      'screen.promo1Text': 'Connect your phone & start singing now.',
      'screen.promo2Title': 'Smart Queue',
      'screen.promo2Text': 'Pick songs, set the order, no mic fighting.',
      'screen.promo3Title': 'Karaoke Night',
      'screen.promo3Text': 'Bring friends & family, the party gets livelier!',

      // ---- TV screen: player ----
      'screen.roomCode': 'Room Code:',
      'screen.logout': 'Logout',
      'screen.idleWaiting': 'Waiting for the next song...',
      'screen.availableNow': 'Available now',
      'screen.status.spdcInvalid': 'Status: Spotify sp_dc invalid - re-enter it from the controller',
      'screen.status.spotifyError': "Status: Spotify can't play - check sp_dc",
      'screen.status.videoError': "Status: Video can't play, skipping to the next one...",
      'screen.status.realtimeFail': 'Status: Realtime failed - check public port 3000',
      'screen.status.disconnected': 'Status: Disconnected - refresh the page',
      'screen.status.controllerJoined': 'Status: Controller connected',
      'screen.status.controllerLeft': 'Status: Controller disconnected - waiting to reconnect...',
      'screen.status.controllerLogout': 'Status: Controller logged out - waiting to reconnect...',
      'screen.nowPlaying': 'Now Playing: {title}',
      'screen.waitingFirst': 'Waiting for the first song...',
      'screen.queueCount': 'Queue: {n}',

      // ---- Install gate ----
      'gate.installTitle': 'Install Purplehat',
      'gate.installText': "For a faster, native-app feel, install Purplehat to your phone's home screen. Once installed, Purplehat opens as an app (not in the browser).",
      'gate.installBtnWaiting': 'Waiting for Chrome…',
      'gate.installBtn': 'Install Now',
      'gate.manualToggle': "Chrome not showing the install prompt? See manual steps",
      'gate.step1': 'Tap <b>⋮</b> (Chrome menu) in the top-right corner.',
      'gate.step2': 'Choose <b>Install app</b> / <b>Add to Home screen</b>, then confirm.',
      'gate.step3': 'Finish the installation. When the app is really on your home screen, this page shows the "Open Purplehat" button.',
      'gate.manualOpen': 'Already Installed — Open Purplehat',
      'gate.openTitle': 'Installed!',
      'gate.openText': 'Purplehat is installed on your home screen. Tap the button below to open the app.',
      'gate.openLink': 'Open Purplehat',
      'gate.openHint': "If this tab still opens, open Purplehat from the icon on your phone's home screen.",
      'gate.iosTitle': 'Install Purplehat',
      'gate.iosText': "On iPhone / iPad, install manually via Safari. A regular tab can't open the controller — Purplehat must be opened from the home screen icon.",
      'gate.iosStep1': 'Tap the <b>Share</b> button (box with an arrow).',
      'gate.iosStep2': 'Choose <b>Add to Home Screen</b>, then <b>Add</b>.',
      'gate.iosStep3': "Open Purplehat from the home screen icon — that's where the controller opens.",
      'gate.iosOpen': 'Open Purplehat',
      'gate.progressWaiting': 'Stage 1/3 · Waiting for Chrome to prepare the installation…',
      'gate.progressReady': 'Stage 1/3 · Chrome is ready to install. Tap "Install Now" to continue.',
      'gate.progressInstalling': 'Stage 2/3 · Complete the installation in the Chrome window…',
      'gate.progressFinishing': 'Stage 2/3 · Finishing the installation…',
      'gate.progressVerifying': 'Stage 3/3 · Checking whether the app is already on your home screen…',
      'gate.progressDone': 'Stage 3/3 · App installed on your home screen. Tap "Open Purplehat" to enter.',
      'gate.progressOpening': 'Stage 3/3 · Opening the Purplehat app…',
      'gate.progressInstalled': 'Stage 3/3 · App already installed. Tap "Open Purplehat" to open…',
      'gate.progressAppOpened': 'Purplehat is opening in the app. You can close this tab.',
      'gate.installing': 'Installing…',
      'gate.bouncedTitle': 'Open Purplehat',
      'gate.bouncedText': "The browser can't show the controller — Purplehat only runs as an app. Tap the button below to try opening the app.",
      'gate.bouncedHint': "Surest way: tap the Purplehat icon on your phone's home screen.",
      'gate.notInstalled': "Purplehat isn't installed yet. Complete the installation using the steps above first.",
      'gate.alreadyTitle': 'Purplehat Installed',
      'gate.alreadyText': 'Purplehat is already installed on this phone. Tap the button below to open it.',
      'gate.alreadyHint': 'If this page opens again in the browser, tap the button below or open Purplehat from the home screen icon.',
      'gate.cantInstallWebview': "This page is open inside another app, so it can't install Purplehat. Open this link in the Chrome app to install.",
      'gate.cantInstallBrowser': "This browser doesn't show an automatic install button. Install Purplehat using the manual steps below.",
      'gate.promptFail': "Chrome couldn't show the install prompt. Install via the ⋮ menu (manual steps below).",
      'gate.cancelled': 'Installation cancelled. Tap "Install Now" again, or install via the ⋮ menu.',
      'gate.iosStillBrowser': 'Still open in the browser. Purplehat must be opened from the <b>home screen icon</b> (not from a Safari tab). If the icon is missing, follow the steps above first.',
      'gate.openHint2': 'Still not opening? If Purplehat is installed but this button cannot open it, uninstall and reinstall from this page, or open Purplehat directly from the icon on your phone\'s home screen.',

      // ---- QR splash ----
      'qr.opening': 'Opening Purplehat…'
    }
  };

  var SUPPORTED = ['en', 'id'];
  var STORAGE_KEY = 'ph_lang';

  function detect() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) >= 0) return saved;
    } catch (e) { }
    return 'en'; // default English
  }

  var lang = detect();

  function t(key, params) {
    var table = DICT[lang] || DICT.en;
    var s = table ? table[key] : undefined;
    if (s == null) s = DICT.en[key];
    if (s == null) s = DICT.id[key];
    if (s == null) return key;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return (params[k] != null) ? String(params[k]) : m;
      });
    }
    return s;
  }

  var ATTRS = [
    ['data-i18n-title', 'title'],
    ['data-i18n-aria', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-alt', 'alt']
  ];

  function apply(root) {
    root = root || document;
    var i, list;
    list = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < list.length; i++) list[i].textContent = t(list[i].getAttribute('data-i18n'));
    list = root.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < list.length; i++) list[i].innerHTML = t(list[i].getAttribute('data-i18n-html'));
    for (var a = 0; a < ATTRS.length; a++) {
      list = root.querySelectorAll('[' + ATTRS[a][0] + ']');
      for (i = 0; i < list.length; i++) list[i].setAttribute(ATTRS[a][1], t(list[i].getAttribute(ATTRS[a][0])));
    }
  }

  function setLang(next) {
    if (SUPPORTED.indexOf(next) < 0) return;
    if (next === lang) { apply(document); return; }
    lang = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { }
    document.documentElement.lang = next;
    apply(document);
    document.dispatchEvent(new CustomEvent('ph-lang-change', { detail: { lang: next } }));
  }

  function getLang() { return lang; }

  PH.i18n = {
    t: t,
    apply: apply,
    setLang: setLang,
    getLang: getLang,
    supported: SUPPORTED.slice(),
    dict: DICT
  };

  document.documentElement.lang = lang;

  function boot() { apply(document); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Sinkron antar-tab dalam satu perangkat (mis. controller <-> setting.html).
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY && e.newValue && SUPPORTED.indexOf(e.newValue) >= 0 && e.newValue !== lang) {
      lang = e.newValue;
      document.documentElement.lang = lang;
      apply(document);
      document.dispatchEvent(new CustomEvent('ph-lang-change', { detail: { lang: lang } }));
    }
  });
})();
