# Purplehat - Karaoke Web App

Aplikasi karaoke: desktop = player, mobile = controller (search + kontrol). Realtime via WebSocket murni (tanpa AirConsole), pairing via kode + QR, data disimpan di JSON.

## Cara Kerja

- Buka `http://localhost:3000/` di desktop → otomatis jadi **Player**, tampilkan kode pairing + QR.
- Buka URL yang sama di HP → masuk **`qr.html`** → **`gate-install.html`** (gerbang: wajib pasang PWA dulu; progress bar hanya maju saat kejadian nyata dari Chrome — tanpa timer tebakan, tanpa opsi "lanjut di browser") → setelah terpasang app langsung dibuka → **`index.html`** = tampilan **Controller**.
- **Aturan keras:** di HP, `index.html` tidak akan pernah tampil di tab browser. Skrip di `<head>` memantulkannya kembali ke gerbang (`back=1`) sebelum `<body>` dirender, sampai Purplehat berjalan sebagai aplikasi (standalone). Desktop tetap bisa membuka controller langsung (mode preview/dev).
- Controller: cari lagu via backend FastAPI (YouTube search), tambah ke antrian, kontrol play/pause/seek/skip/volume.
- Player: yang memutar YouTube iframe, state authority, queue auto-play.

## Struktur

```
Karaoke Web App/
├── backend/              # FastAPI YouTube search API
│   ├── main.py
│   ├── requirements.txt
│   └── data/purplehat.json   # penyimpanan JSON (queue, rooms)
├── public/
│   ├── index.html        # landing (auto-detect device)
│   ├── screen/           # desktop player
│   ├── controller/       # mobile controller (qr.html, gate-install.html, index.html)
│   └── shared/protocol.js
├── server/
│   ├── server.js         # Express + WebSocket relay + QR + pairing
│   └── package.json
└── docs/
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

## Tunneling / Port Forwarding
- Express `trust proxy` aktif → QR & baseUrl ikut `X-Forwarded-Host`/`X-Forwarded-Proto`.
- Search di-proxy Express (`/api/search` → backend :8000), jadi cukup buka satu port (3000).
- Bisa set env `PUBLIC_URL=https://domain.com` untuk override otomatis.
```
