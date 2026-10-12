# Purplehat — Karaoke (mpv) + SQL Server

Dokumen ini menjelaskan fitur **sumber Karaoke** (pemutar **mpv** di server) dan
pemindahan penyimpanan dari `backend/data/purplehat.json` ke **SQL Server**, serta
**cara integrasi dengan wrapper Flutter** (WebView2) yang menjadi *player*.

---

## 1. Ringkasan

- **Sumber lagu karaoke** diambil dari tabel `MstSongBank` (kolom `Path` = file
  share LAN/UNC, mis. `\\192.168.234.182\songbank\503.mp4`).
- **Pemutarnya mpv** dijalankan **oleh player Flutter** (kiosk) memakai `mpv.exe`
  yang ikut ter-bundle di folder Release, lalu dikendalikan **backend** lewat
  **JSON IPC** (`--input-ipc-server`, named pipe di Windows).
  Cara ini **paling ringan di sisi server**: backend hanya menyambung ke pipe
  yang sudah ada (tanpa mengelola proses mpv), dan semua perintah tetap
  **realtime**. Bila mpv belum jalan, backend bisa spawn sendiri (`MPV_LAUNCH`).
  Lihat `purplehat-flutter/docs/KARAOKE.md`.
- **Controller (HP)** mengirim perintah ke **layar** (screen) lewat WebSocket seperti
  biasa. Layar meneruskan perintah pemutaran karaoke ke backend (`/api/karaoke/player/*`).
- **FX / tuning** (key, tempo, echo, EQ, channel L/R + panduan vokal) dikirim
  **controller → Node → Python → mpv** langsung (HTTP), sehingga responsnya cepat.
- **Identitas room** (`PairingCode`) **stabil per device**: dicari di `MstRoom`
  berdasarkan identitas device (MAC) yang **dikirim oleh player (Flutter)**.
  Queue/posisi playback tetap **in-memory** saja.

Alur data:

```
Controller (HP)  --WebSocket-->  Layar/Screen (kiosk)
                                      |  HTTP (satu origin, lewat tunnel)
                                      v
                             Node/Express :3000  --HTTP-->  FastAPI :8000
                                                                  |  pyodbc
                                                                  v
                                                             SQL Server
                                                                  |
                                          JSON IPC (named pipe)   v
                                                            mpv.exe (kiosk)
```

> Catatan: `mpv` dijalankan di **mesin kiosk yang sama** dengan Node + FastAPI.
> `https://purplehat.mallvaa.xyz` adalah tunnel ke mesin tersebut.

---

## 2. Skema Database

### `MstRoom`

| Kolom       | Tipe          | Keterangan                                             |
| ----------- | ------------- | ------------------------------------------------------ |
| RoomID      | varchar(50)   | PK. Contoh: `ROOM-01`                                  |
| MacAddress  | varchar(64)   | Identitas device (MAC `A4-42-3B-19-96-8C`). Unik.      |
| PairingCode | varchar(10)   | Kode pairing yang tampil di layar. Unik.              |
| IsRunning   | bit           | true saat ada lagu berjalan.                          |
| SP_DC       | varchar(500)  | Cookie login Spotify per room (opsional).              |

### `MstSongBank`

| Kolom  | Tipe         | Keterangan                                              |
| ------ | ------------ | ------------------------------------------------------- |
| SongID | int          | PK                                                      |
| Title  | nvarchar(200)| Judul lagu                                              |
| Singer | nvarchar(200)| Penyanyi / artis                                        |
| Path   | nvarchar(500)| Path file share (UNC/LAN) ke file video karaoke         |

### Contoh data

```sql
CREATE TABLE MstRoom (
    RoomID      varchar(50)  NOT NULL PRIMARY KEY,
    MacAddress  varchar(64)  NOT NULL,
    PairingCode varchar(10)  NOT NULL,
    IsRunning   bit          NOT NULL DEFAULT 0,
    SP_DC       varchar(500) NULL
);

CREATE TABLE MstSongBank (
    SongID int NOT NULL PRIMARY KEY,
    Title  nvarchar(200) NOT NULL,
    Singer nvarchar(200) NULL,
    Path   nvarchar(500) NOT NULL
);

INSERT INTO MstRoom (RoomID, MacAddress, PairingCode, IsRunning, SP_DC)
VALUES ('ROOM-01', 'A4-42-3B-19-96-8C', NULL, NULL, NULL);

INSERT INTO MstSongBank (SongID, Title, Singer, Path)
VALUES (503, 'LAGU MP4', 'Abdul', '\\192.168.234.182\songbank\503.mp4');
```

> `PairingCode` boleh `NULL` di data awal — akan diisi otomatis saat device
> pertama kali resolve. `RoomID` juga boleh dikosongkan pada contoh; backend
> membuat `ROOM-01`, `ROOM-02`, … otomatis bila belum ada.

---

## 3. Konfigurasi `backend/.env`

Salin `backend/.env.example` → `backend/.env` lalu sesuaikan:

```ini
# SQL Server
DB_DRIVER=ODBC Driver 17 for SQL Server
DB_SERVER=192.168.234.182
DB_PORT=1433
DB_NAME=PurpleHat
DB_USER=sa
DB_PASSWORD=ubah-password-ini
DB_TRUSTED_CONNECTION=no      ; "yes" untuk Windows Authentication
DB_ENCRYPT=no
DB_TRUST_SERVER_CERTIFICATE=yes

# mpv
# auto: sambung ke mpv yang sudah jalan (mis. dijalankan Flutter), else spawn sendiri
# external: hanya sambung (mpv dijalankan Flutter) ; spawn: selalu spawn sendiri
MPV_LAUNCH=auto
MPV_PATH=mpv                  ; atau path lengkap mpv.exe (dipakai saat spawn)
MPV_IPC_PIPE=\\.\pipe\purplehat-mpv
MPV_EXTRA_ARGS=--fs
KARAOKE_MUSIC_CHANNEL=left    ; kanal musik pada file karaoke L/R
```

### Prasyarat

- **SQL Server**: `pip install pyodbc` + **ODBC Driver 17 for SQL Server**
  (Windows: "Microsoft ODBC Driver for SQL Server").
  Cek: `python -c "import pyodbc;print(pyodbc.drivers())"`.
- **mpv**: pada kiosk, mpv dijalankan oleh player Flutter memakai `mpv.exe`
  yang ikut ter-bundle (lihat `purplehat-flutter/docs/KARAOKE.md`). Bila backend
  perlu spawn sendiri, pasang mpv dari <https://mpv.io/installation/> atau isi
  `MPV_PATH` dengan lokasi `mpv.exe`.

> **Koneksi IPC bersifat "one-shot".** Setiap perintah membuka koneksi baru ke
> named pipe mpv lalu menutupnya kembali. Ini menghindari koneksi basi yang
> membuat pipe macet setelah mpv dibunuh / dijalankan ulang (mis. player Flutter
> di-restart). Named pipe mpv di Windows bersifat **single-instance**: hanya satu
> klien pada satu waktu, karena itu semua perintah di-serialisasi.

> **Catatan topologi.** Named pipe bersifat lokal pada mesin tempat mpv berjalan.
> Jadi `MPV_IPC_PIPE` pada backend harus menunjuk ke pipe di mesin yang sama
> dengan mpv (kiosk = server = satu mesin). Bila backend dipisah ke server lain,
> arahkan ke pipe jarak jauh (`\\HOST\pipe\purplehat-mpv`) dan pastikan mpv
> mengizinkan akses remote, atau jalankan mpv di sisi backend (hentikan mpv di
> player Flutter agar tidak bentrok).

> **MAC tidak ada di `.env`.** Identitas device dikirim oleh player (Flutter),
> lihat bagian 5.

---

## 4. Menjalankan

```bash
# Backend FastAPI (:8000)
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

# Node/Express (:3000)
cd server
npm install
npm start
```

Atau dari root: `npm start` (menjalankan keduanya).

---

## 5. Integrasi Flutter (player = Flutter)

> **Sudah diimplementasikan** di project `purplehat-flutter` (lihat
> `purplehat-flutter/docs/KARAOKE.md`). Bagian ini menjelaskan kontraknya /
> acuan bila ingin membuat player lain.

Karena browser/WebView **tidak bisa membaca MAC**, nilai identitas device harus
**dideteksi oleh Flutter** lalu dikirim ke server. Satu device = satu room
(multi-room didukung: banyak kiosk → banyak MAC → banyak room).

### 5.1 Deteksi identitas device (contoh)

- **Windows** (kiosk):
  - Jalankan perintah `getmac /fo csv /nh` atau
    `wmic nic where "NetEnabled=true" get MACAddress`, ambil MAC adapter aktif; **atau**
  - pakai FFI `GetAdaptersAddresses` (lebih stabil).
- **Android** (bila kelak dipakai): Android ID (`Settings.Secure.ANDROID_ID`) sebagai
  identitas stabil. Nilai apa pun boleh — server menormalkan 12-digit hex menjadi MAC
  bertanda hubung, selain itu dipakai apa adanya.

### 5.2 Mengirim identitas ke layar web (salah satu cara)

Pilih salah satu (keduanya didukung `public/screen/menu.js`):

1. **Query string** saat memuat halaman:
   `https://purplehat.mallvaa.xyz/screen/index.html?mac=A4-42-3B-19-96-8C`
2. **Injeksi JS** sebelum/saat halaman dimuat:
   ```dart
   await controller.evaluateJavascript(
     source: 'window.purplehatDeviceMac = "A4-42-3B-19-96-8C";');
   ```
   (atau `window.purplehat = { deviceMac: "..." };`)

Layar lalu otomatis memanggil `POST /api/room/create` dengan `{ "mac": "..." }`
dan menampilkan `PairingCode` hasil resolve (stabil per MAC).

### 5.3 Kontrak endpoint yang dipakai Flutter

| Metode | Endpoint                     | Body / Query          | Fungsi                                        |
| ------ | ---------------------------- | --------------------- | --------------------------------------------- |
| POST   | `/api/room/create`           | `{ mac }`             | Resolve/buat room → `{ code, qr, roomId }`    |
| GET    | `/api/room/resolve?mac=...`  | —                     | Resolve langsung (tanpa buat QR)              |
| GET    | `/api/room/{code}`           | —                     | Cek room ada (dipakai sebelum connect)        |
| DELETE | `/api/room/{code}`           | —                     | Reset runtime room (room **tidak** dihapus)   |
| GET    | `/api/room/{code}/presence`  | long-poll             | Tunggu controller (layar QR)                  |

Endpoint Node ini mem-proxy ke FastAPI (`/room/*`).

> **Penting:** `DELETE /api/room/{code}` sekarang hanya me-reset state runtime
> (queue/posisi) dan menandai `IsRunning=0`; baris `MstRoom` **tidak dihapus**
> agar `PairingCode` tetap stabil per MAC.

### 5.4 Endpoint karaoke (dipakai layar & controller)

| Metode | Endpoint                                          | Body                          |
| ------ | ------------------------------------------------- | ----------------------------- |
| GET    | `/api/karaoke/search?q=&limit=&offset=`           | —                             |
| GET    | `/api/karaoke/player/state`                       | —                             |
| POST   | `/api/karaoke/player/load`                        | `{ path, title }`             |
| POST   | `/api/karaoke/player/play` \| `pause` \| `toggle` \| `stop` | —                    |
| POST   | `/api/karaoke/player/seek`                        | `{ to }`                      |
| POST   | `/api/karaoke/player/volume`                      | `{ vol }`                     |
| GET    | `/api/karaoke/player/fx`                          | —                             |
| POST   | `/api/karaoke/player/fx`                          | `{ pitch, echo, tempo, bass, treble, channel }` |

---

## 6. FX / Tuning → mpv

Controller mengirim FX ke `/api/karaoke/player/fx`. Pemetaan ke mpv
(lihat `backend/karaoke/mpv.py`):

| FX          | Nilai            | Implementasi mpv                                    |
| ----------- | ---------------- | --------------------------------------------------- |
| Key shift   | `-6..+6` (semitone) | filter `rubberband=pitch=Rasio`                  |
| Tempo       | `0.5..2.0`       | properti `speed` (+ `audio-pitch-correction=yes`)   |
| Echo/reverb | `0..100`         | `lavfi=[aecho=...]`                                 |
| Bass        | `-10..+10` dB    | `equalizer=f=100:...`                               |
| Treble      | `-10..+10` dB    | `equalizer=f=8000:...`                              |
| Channel     | `stereo`/`left`/`right`/`music`/`vocal`/`vocal-off` | filter `pan`     |

**Master volume** tetap mengatur **volume OS** (mode desktop/WebView2). Saat
karaoke, mpv dipin **100%** (properti `volume = 100`) agar volume OS jadi satu-satunya
pengendali utama — sama seperti sumber YouTube/SoundCloud/Spotify.

> **Catatan build mpv:** filter `rubberband` (key shift) butuh build mpv dengan
> dukungan librubberband. Bila tidak tersedia, pitch tidak berubah (perintah
> dilaporkan gagal). Filter `aecho`, `equalizer`, dan `pan` tersedia di build standar.

---

## 7. Struktur file yang relevan

```
backend/
├─ .env.example              # contoh konfigurasi SQL Server + mpv
├─ db.py                     # akses SQL Server (pyodbc): room & song bank
├─ rooms/main.py             # router /room/* (resolve by MAC, sp_dc, running)
├─ karaoke/
│  ├─ main.py                # router /karaoke/* (search + player)
│  └─ mpv.py                 # spawn mpv + JSON IPC
public/
├─ screen/
│  ├─ karaoke/player-kr.html # "pemutar" karaoke (jembatan ke mpv + panggung visual)
│  └─ screen.js              # host: routing sumber karaoke via iframe (sama seperti lain)
└─ controller/
   ├─ index.html             # chip Karaoke (paling kiri) + modal FX
   └─ controller.js          # search karaoke + kirim FX ke backend
server/server.js             # proxy room & karaoke ke FastAPI
```

---

## 8. Risiko & catatan

- Bila SQL Server / mpv belum siap, backend tetap **boot**: endpoint mengembalikan
  error yang jelas (`pyodbc belum terpasang`, `mpv tidak ditemukan`, dst.).
- File `Path` harus bisa diakses dari mesin kiosk (share LAN + izin baca).
- Bila `MPV_EXTRA_ARGS=--fs`, jendela mpv tampil fullscreen di atas layar web.
  Untuk mode jendela berisi video di dalam UI web, kosongkan/atur argumen lain.
  **Catatan:** args ini hanya dipakai saat backend spawn mpv sendiri; bila player
  Flutter yang menjalankan mpv, atur argumennya di `purplehat-flutter/lib/config.dart`.
- Channel "musik"/"vokal" mengasumsikan file karaoke berkanal L/R. Sesuaikan
  `KARAOKE_MUSIC_CHANNEL` bila berkas Anda berkebalikan.
- `DELETE /api/room/{code}` tidak menghapus room dari DB (pairing stabil per MAC).
