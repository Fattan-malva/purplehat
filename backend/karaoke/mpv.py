# Purplehat - kontrol mpv player via JSON IPC (named pipe / unix socket)
# ---------------------------------------------------------------------------
# "Paling ringan": tidak ada dependency tambahan. Pada Windows, named pipe mpv
# dibuka memakai open() bawaan Python; pada Linux/macOS memakai unix socket
# melalui socket module yang juga bawaan.
#
# mpv dijalankan dengan --input-ipc-server lalu dikendalikan lewat perintah JSON.
# mpv biasanya DIJALANKAN oleh player Flutter (mpv.exe yang ikut ter-bundle);
# modul ini cukup MENYAMBUNG ke pipe yang sudah ada (lihat MPV_LAUNCH), dan
# hanya spawn sendiri sebagai fallback.
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional

IS_WIN = sys.platform.startswith("win")

MPV_PATH = os.getenv("MPV_PATH", "mpv").strip() or "mpv"
MPV_PIPE = os.getenv("MPV_IPC_PIPE", r"\\.\pipe\purplehat-mpv").strip()
MPV_EXTRA_ARGS = os.getenv("MPV_EXTRA_ARGS", "").strip()

# Kanal audio default untuk lagu karaoke (yang berisi musik tanpa vokal).
KARAOKE_MUSIC_CHANNEL = os.getenv("KARAOKE_MUSIC_CHANNEL", "left").strip().lower()

# Cara menjalankan mpv:
#   auto     -> sambung dulu ke mpv yang SUDAH berjalan (mis. dijalankan oleh
#               player Flutter memakai mpv.exe yang ikut ter-bundle); kalau tidak
#               ada, baru spawn sendiri. (default, paling kompatibel)
#   external -> JANGAN spawn; hanya sambung ke pipe (mpv sepenuhnya dijalankan
#               Flutter). Paling ringan di sisi server.
#   spawn    -> selalu jalankan mpv sendiri (perilaku lama).
MPV_LAUNCH = os.getenv("MPV_LAUNCH", "auto").strip().lower()


class MpvError(RuntimeError):
    pass


class MpvPlayer:
    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen] = None
        self._fd = None                       # koneksi IPC persisten (int fd / socket)
        self._lock = threading.RLock()
        self._rid = 0
        self._rxbuf = b""
        self._last_error: Optional[str] = None
        # Parameter FX aktif (agar bisa dikirim ulang saat proses mpv restart).
        self._fx = {
            "pitch": 0.0,
            "echo": 0,
            "tempo": 1.0,
            "bass": 0,
            "treble": 0,
            "channel": "stereo",
        }

    # -- lifecycle ---------------------------------------------------------
    def _mpv_binary(self) -> str:
        found = shutil.which(MPV_PATH)
        return found or MPV_PATH

    def _connect(self, timeout: float = 0.8) -> None:
        """Buka koneksi IPC persisten (non-blocking) ke mpv.

        Satu koneksi dipakai untuk banyak perintah. Menutup & membuka ulang
        named pipe mpv (single-instance) tiap perintah terbukti kehilangan
        balasan (~30% timeout, terasa sebagai "delay"), jadi koneksi dijaga
        dan hanya disambung ulang saat benar-benar putus (mis. mpv di-restart).
        """
        deadline = time.time() + timeout
        while True:
            try:
                if IS_WIN:
                    fd = os.open(MPV_PIPE, os.O_RDWR | os.O_BINARY)
                    try:
                        os.set_blocking(fd, False)
                    except OSError:
                        pass
                    self._fd = fd
                else:
                    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    s.settimeout(max(0.5, timeout))
                    s.connect(MPV_PIPE)
                    s.setblocking(False)
                    self._fd = s
                self._rxbuf = b""
                return
            except OSError as exc:
                if time.time() >= deadline:
                    raise MpvError(
                        f"Tidak bisa membuka IPC mpv ({MPV_PIPE}): {exc}"
                    ) from exc
                time.sleep(0.05)

    def _disconnect(self) -> None:
        if self._fd is not None:
            try:
                if IS_WIN:
                    os.close(self._fd)
                else:
                    self._fd.close()
            except Exception:
                pass
        self._fd = None
        self._rxbuf = b""

    def _conn_write(self, data: bytes) -> None:
        if IS_WIN:
            os.write(self._fd, data)
        else:
            self._fd.sendall(data)

    def _conn_read(self, n: int) -> bytes:
        if IS_WIN:
            return os.read(self._fd, n)
        return self._fd.recv(n)

    def _ensure(self) -> None:
        """Pastikan ada koneksi ke mpv.

        Jalur utama: sambung ke mpv yang DIJALANKAN Flutter (mpv.exe
        ter-bundle) — server cukup berbicara lewat JSON IPC. Jalur fallback
        (MPV_LAUNCH=auto/spawn): spawn mpv sendiri bila belum ada.
        """
        if self._fd is not None:
            return
        try:
            self._connect(timeout=0.6)
            return
        except MpvError:
            pass
        if MPV_LAUNCH == "external":
            raise MpvError(
                "mpv (external) belum berjalan. Jalankan player PurpleHat yang "
                "menjalankan mpv, atau set MPV_LAUNCH=auto/spawn di backend/.env."
            )
        self._spawn()

    def _spawn(self) -> None:
        args = [
            self._mpv_binary(),
            f"--input-ipc-server={MPV_PIPE}",
            "--idle=yes",
            "--keep-open=yes",
            "--no-terminal",
            "--osc=no",
            "--input-default-bindings=no",
            "--force-window=yes",
        ]
        if MPV_EXTRA_ARGS:
            args += MPV_EXTRA_ARGS.split()
        try:
            self._proc = subprocess.Popen(
                args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
            )
        except FileNotFoundError as exc:
            raise MpvError(
                f"mpv tidak ditemukan (MPV_PATH={MPV_PATH!r}). Pastikan mpv terpasang "
                "atau set MPV_PATH ke lokasi mpv.exe."
            ) from exc

        # Tunggu pipe IPC muncul (~6 detik).
        last = None
        ok = False
        for _ in range(120):
            try:
                self._connect(timeout=0.05)
                ok = True
                break
            except MpvError as exc:
                last = exc
                time.sleep(0.05)
        if not ok:
            raise MpvError(f"Tidak bisa membuka IPC mpv ({MPV_PIPE}): {last}")
        # Terapkan FX yang tersimpan (kalau mpv baru di-spawn sendiri).
        try:
            self._apply_fx_locked()
        except Exception:
            pass

    def _read_reply(self, rid: int, timeout: float) -> Optional[dict]:
        """Baca sampai balasan ber-request_id cocok (bounded, non-blocking)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                chunk = self._conn_read(16384)
            except BlockingIOError:
                time.sleep(0.001)
                continue
            except OSError:
                return None
            if not chunk:
                return None
            self._rxbuf += chunk
            while b"\n" in self._rxbuf:
                line, self._rxbuf = self._rxbuf.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line.decode("utf-8", "replace"))
                except Exception:
                    continue
                if obj.get("request_id") == rid:
                    return obj
        return None

    def send(self, command: List[Any], timeout: float = 2.0) -> Optional[dict]:
        with self._lock:
            self._ensure()
            self._rid += 1
            rid = self._rid
            payload = json.dumps(
                {"command": command, "request_id": rid}
            ).encode("utf-8") + b"\n"

            # Koneksi persisten. Bila putus di tengah jalan (mis. mpv di-restart
            # oleh Flutter), sambung ulang lalu ulangi sekali.
            for _ in range(2):
                try:
                    self._conn_write(payload)
                except OSError:
                    self._disconnect()
                    self._ensure()
                    continue
                res = self._read_reply(rid, timeout)
                if res is not None:
                    return res
                self._disconnect()
                self._ensure()
            return None

    def _reset(self) -> None:
        self._disconnect()
        # Hanya matikan proses mpv yang KITA spawn sendiri. mpv yang
        # dijalankan Flutter (external) dibiarkan hidup.
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.terminate()
            except Exception:
                pass
        self._proc = None

    def stop_process(self) -> None:
        with self._lock:
            self._reset()

    # -- helpers -----------------------------------------------------------
    def command(self, *args) -> Optional[dict]:
        return self.send(list(args))

    def set_property(self, name: str, value: Any) -> Optional[dict]:
        return self.send(["set_property", name, value], timeout=1.5)

    def get_property(self, name: str) -> Any:
        res = self.send(["get_property", name], timeout=1.5)
        if res and res.get("error") == "success":
            return res.get("data")
        return None

    def _ok(self, res: Optional[dict]) -> Dict[str, Any]:
        if res is None:
            return {"ok": False, "error": "timeout (mpv tidak merespons)"}
        err = res.get("error")
        if err and err != "success":
            self._last_error = str(err)
            return {"ok": False, "error": str(err)}
        return {"ok": True, "error": None}

    # -- playback ----------------------------------------------------------
    def load(self, path: str) -> Dict[str, Any]:
        if not path:
            raise MpvError("path lagu kosong")
        # Ganti file (mode 'replace') lalu pastikan tidak pause.
        res = self.send(["loadfile", path, "replace"])
        out = self._ok(res)
        self.set_property("pause", False)
        self._apply_fx_locked()
        return out

    def play(self) -> Dict[str, Any]:
        self.set_property("pause", False)
        return {"ok": True}

    def pause(self) -> Dict[str, Any]:
        self.set_property("pause", True)
        return {"ok": True}

    def toggle(self) -> Dict[str, Any]:
        self.command("cycle", "pause")
        return {"ok": True}

    def stop(self) -> Dict[str, Any]:
        self.command("stop")
        return {"ok": True}

    def seek(self, to: float) -> Dict[str, Any]:
        res = self.send(["seek", max(0.0, float(to or 0)), "absolute"])
        return self._ok(res)

    def set_volume(self, vol: float) -> Dict[str, Any]:
        v = max(0.0, min(100.0, float(vol or 0)))
        self.set_property("volume", v)
        return {"ok": True, "volume": v}

    def state(self) -> Dict[str, Any]:
        try:
            self._ensure()
        except MpvError as exc:
            return {"available": False, "error": str(exc), "playing": False}
        pause = self.get_property("pause")
        pos = self.get_property("time-pos")
        dur = self.get_property("duration")
        path = self.get_property("path")
        eof = self.get_property("eof-reached")
        return {
            "available": True,
            "playing": bool(pause is False),
            "paused": bool(pause is True),
            "position": float(pos or 0),
            "duration": float(dur or 0),
            "path": path,
            "ended": bool(eof is True),
        }

    # -- FX ---------------------------------------------------------------
    def _build_af(self, fx: Dict[str, Any]) -> str:
        parts: List[str] = []
        lavfi: List[str] = []   # filter libavfilter digabung jadi 1 graph

        # Channel / vocal guide (lagu karaoke "support L-R").
        # Catatan: filter `pan` native mpv TIDAK jalan di build ini (error
        # INVALID_PARAMETER), jadi kita pakai `pan` libavfilter lewat lavfi.
        channel = str(fx.get("channel") or "stereo").lower()
        music = KARAOKE_MUSIC_CHANNEL  # 'left' atau 'right'
        if channel == "left":
            lavfi.append("pan=stereo|c0=c0|c1=c0")
        elif channel == "right":
            lavfi.append("pan=stereo|c0=c1|c1=c1")
        elif channel == "mono":
            lavfi.append("pan=mono|c0=0.5*c0+0.5*c1")
        elif channel in ("music", "instrumental"):
            # Ambil kanal musik (tanpa vokal) ke kedua sisi.
            if music == "right":
                lavfi.append("pan=stereo|c0=c1|c1=c1")
            else:
                lavfi.append("pan=stereo|c0=c0|c1=c0")
        elif channel in ("vocal", "guide"):
            if music == "right":
                lavfi.append("pan=stereo|c0=c0|c1=c0")
            else:
                lavfi.append("pan=stereo|c0=c1|c1=c1")
        elif channel in ("vocal-off", "vocaloff", "cancel"):
            # Phase cancel (buang vokal di tengah).
            lavfi.append("pan=stereo|c0=0.5*c0-0.5*c1|c1=0.5*c1-0.5*c0")

        # Echo / reverb (libavfilter aecho).
        try:
            echo = int(float(fx.get("echo") or 0))
        except Exception:
            echo = 0
        if echo > 0:
            decay = min(0.9, 0.1 + (echo / 100.0) * 0.8)
            delay = int(180 + echo * 6)  # ms
            lavfi.append(f"aecho=0.8:{decay:.2f}:{delay}:0.35")

        if lavfi:
            parts.append("lavfi=[" + ",".join(lavfi) + "]")

        # EQ bass / treble.
        try:
            bass = float(fx.get("bass") or 0)
        except Exception:
            bass = 0.0
        try:
            treble = float(fx.get("treble") or 0)
        except Exception:
            treble = 0.0
        if abs(bass) >= 0.1:
            parts.append(f"equalizer=f=100:width_type=o:width=2:g={bass:.1f}")
        if abs(treble) >= 0.1:
            parts.append(f"equalizer=f=8000:width_type=o:width=2:g={treble:.1f}")

        # Key shift / pitch (rubberband; butuh build mpv dengan librubberband).
        # Opsi jumlah pitch adalah `pitch-scale` (BUKAN `pitch` yang berupa
        # pilihan kualitas/speed).
        try:
            pitch = float(fx.get("pitch") or 0)
        except Exception:
            pitch = 0.0
        if abs(pitch) >= 0.01:
            ratio = 2.0 ** (pitch / 12.0)
            parts.append(f"rubberband=pitch-scale={ratio:.5f}")

        return ",".join(parts)

    def _apply_fx_locked(self) -> Dict[str, Any]:
        af = self._build_af(self._fx)
        res = self.set_property("af", af if af else "")
        out = self._ok(res)
        # Tempo (kecepatan) tanpa mengubah pitch -> pakai properti speed mpv.
        try:
            tempo = float(self._fx.get("tempo") or 1.0)
        except Exception:
            tempo = 1.0
        tempo = max(0.5, min(2.0, tempo))
        self.set_property("audio-pitch-correction", "yes")
        self.set_property("speed", tempo)
        out["af"] = af
        return out

    def apply_fx(self, fx: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            for k in ("pitch", "echo", "tempo", "bass", "treble", "channel"):
                if k in fx and fx[k] is not None:
                    self._fx[k] = fx[k]
            return self._apply_fx_locked()

    def get_fx(self) -> Dict[str, Any]:
        return dict(self._fx)


# Singleton
player = MpvPlayer()
