# Cara Menjalankan Purplehat

## Menjalankan (satu command)
```bash
npm start
```
Ini menjalankan dua proses: backend (FastAPI :8000) + frontend (Express :3000).

- Desktop: `http://localhost:3000/` → otomatis Player
- HP: `http://IP_LOKAL:3000/` → otomatis Controller

## Tunneling / Port Forwarding
Cukup expose port **3000** saja (mis. ngrok / cloudflared / localtunnel):
```bash
ngrok http 3000
# atau
cloudflared tunnel --url http://localhost:3000
```
- QR & link pairing otomatis mengikuti host publik (`X-Forwarded-Host`/`Proto`).
- Controller search otomatis lewat origin yang sama (`/api/search` di-proxy ke backend :8000), jadi tidak perlu expose port 8000.
- Opsional set `PUBLIC_URL=https://domain-kamu` jika auto-detect kurang tepat.