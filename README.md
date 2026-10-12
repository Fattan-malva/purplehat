# Purplehat - Karaoke Web App

Aplikasi karaoke: desktop = player, mobile = controller (search + kontrol). Realtime via WebSocket murni (tanpa AirConsole), pairing via kode + QR, identitas room & song bank disimpan di **SQL Server**. Sumber: YouTube, SoundCloud, Spotify, dan **Karaoke (mpv)**.

## Cara Kerja

- Buka `http://localhost:3000/` di desktop → otomatis jadi **Player**, tampilkan kode pairing + QR.
- Buka URL yang sama di HP → masuk **`qr.html`** → **`gate-install.html`** (gerbang: wajib pasang PWA dulu; progress bar hanya maju saat kejadian nyata dari Chrome — tanpa timer tebakan, tanpa opsi "lanjut di browser") → setelah terpasang app langsung dibuka → **`index.html`** = tampilan **Controller**.
- **Aturan keras:** di HP, `index.html` tidak akan pernah tampil di tab browser. Skrip di `<head>` memantulkannya kembali ke gerbang (`back=1`) sebelum `<body>` dirender, sampai Purplehat berjalan sebagai aplikasi (standalone). Desktop tetap bisa membuka controller langsung (mode preview/dev).
- Controller: cari lagu via backend FastAPI (YouTube/SoundCloud/Spotify/Karaoke search), tambah ke antrian, kontrol play/pause/seek/skip/volume, dan FX karaoke (key, tempo, echo, EQ, channel).
- Player: yang memutar media (iframe untuk YouTube/SoundCloud/Spotify, **mpv** di server untuk Karaoke), state authority, queue auto-play.
- **Karaoke** memutar file dari share LAN lewat `mpv` di mesin kiosk. Identitas room dicari di `MstRoom` berdasarkan **MAC device yang dikirim player (Flutter)**, bukan dibaca server. Detail: lihat [`docs/KARAOKE.md`](docs/KARAOKE.md).

## Struktur

```
Karaoke Web App/
├── backend/              # FastAPI: search + karaoke (mpv) + rooms (SQL Server)
│   ├── main.py
│   ├── db.py             # akses SQL Server (pyodbc)
│   ├── .env.example      # konfigurasi SQL Server + mpv
│   ├── rooms/main.py     # /room/* (resolve by MAC, sp_dc, running)
│   ├── karaoke/          # /karaoke/* (search + player) + mpv.py (JSON IPC)
│   └── requirements.txt
├── public/
│   ├── index.html        # landing (auto-detect device)
│   ├── screen/           # desktop player (+ karaoke/player-kr.html)
│   ├── controller/       # mobile controller (qr.html, gate-install.html, index.html)
│   └── shared/protocol.js
├── server/
│   ├── server.js         # Express + WebSocket relay + QR + pairing + proxy DB/karaoke
│   └── package.json
└── docs/                 # KARAOKE.md (setup SQL Server, mpv, integrasi Flutter)
```

## Menjalankan

### Satu command (jalankan semua)
```bash
npm start
```
Script `start.js` menjalankan backend (FastAPI :8000) + frontend (Express :3000).

### Manual terpisah
```bash
cd backend && pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8000 --reload
cd server && npm install && npm start
```

> **Karaoke & SQL Server:** salin `backend/.env.example` → `backend/.env`, isi koneksi
> SQL Server (butuh `pyodbc` + *ODBC Driver 17 for SQL Server*) dan path `mpv`.
> Tanpa itu backend tetap boot, tapi endpoint DB/karaoke mengembalikan error.
> Langkah lengkap + skema tabel + integrasi Flutter (MAC) ada di
> [`docs/KARAOKE.md`](docs/KARAOKE.md).

## Tunneling / Port Forwarding
- Express `trust proxy` aktif → QR & baseUrl ikut `X-Forwarded-Host`/`X-Forwarded-Proto`.
- Search di-proxy Express (`/api/search` → backend :8000), jadi cukup buka satu port (3000).
- Bisa set env `PUBLIC_URL=https://domain.com` untuk override otomatis.
```
