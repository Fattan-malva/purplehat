# Arsitektur Purplehat

## Prinsip Anti-Delay / Sinkron
- Player (desktop) adalah **authoritative** untuk state: antrian, lagu saat ini, posisi, volume, play/pause.
- Komunikasi ringan via WebSocket JSON (bukan AirConsole). Payload kecil: `{type, payload, ts}`.
- Sync berkala: player broadcast STATE_SYNC tiap 5 detik + saat perubahan state. Controller request sync tiap 3 detik.
- Timestamp di setiap pesan (`ts`) untuk debugging / compensasi latency.
- Controller hanya mengirim intent (add_song, seek, dll); player eksekusi & broadcast hasil. Ini menghindari race condition.

## Pairing
- Player membuat room via `POST /api/room/create` → kode 6 karakter + URL QR (`/?pair=KODE`).
- Controller buka `/` (auto-detect mobile) → tampil layar pairing: input kode ATAU scan QR via kamera (jsQR).
- Setelah valid, controller connect WS dengan `?role=controller&code=KODE`.

## Data
- JSON file `backend/data/purplehat.json` menyimpan rooms: `{code, createdAt, queue, currentIndex, playing, volume, position, duration}`.
- Server persist setiap QUEUE_UPDATE / STATE_SYNC dari player.
- Mudah upgrade ke SQLite/Supabase nanti — cukup ganti loadData/saveData.

## Protokol Pesan (public/shared/protocol.js)
- C→S: JOIN, ADD_SONG, REMOVE_SONG, PLAY_PAUSE, NEXT, REPLAY, SEEK, VOLUME, REQUEST_STATE
- S→C: STATE_SYNC, QUEUE_UPDATE, NOW_PLAYING, ERROR, CONTROLLER_JOINED

## Backend YouTube
FastAPI wrapper InnerTube search (dari repo api-youtube). CORS aktif, bisa diakses dari HP selama IP lokal sama.
```