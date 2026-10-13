# Purplehat - akses SQL Server (pyodbc)
# ---------------------------------------------------------------------------
# Menggantikan backend/data/purplehat.json. Semua akses database (room & bank
# lagu karaoke) lewat modul ini.
#
# Tabel yang dipakai (lihat README):
#   MstRoom     (RoomID, MacAddress, PairingCode, IsRunning, SP_DC)
#   MstSongBank (SongID, Title, Singer, Path)
#
# Konfigurasi koneksi dibaca dari backend/.env (lihat .env.example).
import os
import random
import threading
import uuid
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()

try:  # pyodbc opsional saat import supaya backend tetap bisa start.
    import pyodbc  # type: ignore
except Exception:  # pragma: no cover - hanya saat dependency belum dipasang
    pyodbc = None

DB_DRIVER = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")
DB_SERVER = os.getenv("DB_SERVER", "localhost")
DB_PORT = os.getenv("DB_PORT", "1433")
DB_NAME = os.getenv("DB_NAME", "PurpleHat")
DB_USER = os.getenv("DB_USER", "")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_TRUSTED = os.getenv("DB_TRUSTED_CONNECTION", "no").lower() in ("1", "yes", "true")
DB_ENCRYPT = os.getenv("DB_ENCRYPT", "no").lower() in ("1", "yes", "true")
DB_TRUST_CERT = os.getenv("DB_TRUST_SERVER_CERTIFICATE", "yes").lower() in ("1", "yes", "true")

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

_conn_lock = threading.Lock()
_hex = set("0123456789abcdefABCDEF")


# ---------------------------------------------------------------------------
# Koneksi
# ---------------------------------------------------------------------------
def _conn_str() -> str:
    parts = [
        f"DRIVER={{{DB_DRIVER}}}",
        f"SERVER={DB_SERVER},{DB_PORT}",
        f"DATABASE={DB_NAME}",
    ]
    if DB_TRUSTED:
        parts.append("Trusted_Connection=yes")
    else:
        parts.append(f"UID={DB_USER}")
        parts.append(f"PWD={DB_PASSWORD}")
    parts.append(f"Encrypt={'yes' if DB_ENCRYPT else 'no'}")
    parts.append(f"TrustServerCertificate={'yes' if DB_TRUST_CERT else 'no'}")
    return ";".join(parts)


def _require():
    if pyodbc is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "pyodbc belum terpasang. Jalankan `pip install pyodbc` dan pastikan "
                "'ODBC Driver for SQL Server' terpasang di komputer ini."
            ),
        )


@contextmanager
def get_conn():
    """Buka koneksi SQL Server (short-lived, aman untuk skala kiosk)."""
    _require()
    conn = pyodbc.connect(_conn_str(), timeout=5, autocommit=False)
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Util identitas device & kode
# ---------------------------------------------------------------------------
def norm_mac(mac: Any) -> str:
    """Normalisasi identitas device.

    - Bila 12 digit hex (dengan/tanpa pemisah) -> format MAC 'A4-42-3B-19-96-8C'.
    - Selain itu (mis. Android ID / UUID) -> dipakai apa adanya (uppercase).
    Player (Flutter) yang menentukan nilai ini; server hanya menormalkan agar
    pencocokan di MstRoom konsisten.
    """
    raw = str(mac or "").strip()
    if not raw:
        return ""
    hexs = "".join(c for c in raw if c in _hex)
    if len(hexs) == 12 and len(raw) <= 17:
        return "-".join(hexs[i:i + 2].upper() for i in range(0, 12, 2))
    return raw.upper()


def mac_key(mac: Any) -> str:
    """Kunci pencocokan: 12 digit hex tanpa pemisah untuk MAC, atau nilai
    ternormalisasi untuk device id lain."""
    norm = norm_mac(mac)
    hexs = "".join(c for c in norm if c in _hex)
    if len(hexs) == 12:
        return hexs
    return norm


def device_mac_or_fallback(mac: Any) -> str:
    """Identitas device dari player (Flutter). Bila kosong (mis. dibuka di
    browser biasa untuk dev), pakai MAC mesin ini sebagai fallback."""
    norm = norm_mac(mac)
    if norm:
        return norm
    node = uuid.getnode()
    return "-".join(f"{(node >> ele) & 0xFF:02X}" for ele in range(40, -1, -8))


def gen_code(n: int = 6) -> str:
    return "".join(random.choice(CODE_ALPHABET) for _ in range(n))


# ---------------------------------------------------------------------------
# Room (MstRoom)
# ---------------------------------------------------------------------------
def _row_to_room(row) -> Dict[str, Any]:
    return {
        "roomId": row[0],
        "mac": (row[1] or "").strip(),
        "code": (row[2] or "").strip().upper(),
        "isRunning": bool(row[3]),
        "sp_dc": row[4],
    }


_ROOM_COLS = "RoomID, MacAddress, PairingCode, IsRunning, SP_DC"


def _find_by_mac(cur, mac_norm: str):
    key = mac_key(mac_norm)
    if len(key) == 12:
        # MAC: cocokkan toleran terhadap pemisah (- : .) dan besar/kecil huruf.
        cur.execute(
            f"SELECT {_ROOM_COLS} FROM MstRoom "
            "WHERE UPPER(REPLACE(REPLACE(REPLACE(MacAddress, '-', ''), ':', ''), '.', '')) = ?",
            key,
        )
    else:
        # Device id lain (Android ID / UUID): cocok persis (case-insensitive).
        cur.execute(f"SELECT {_ROOM_COLS} FROM MstRoom WHERE UPPER(MacAddress) = ?", key)
    return cur.fetchone()


def _unique_code(cur) -> str:
    for _ in range(30):
        code = gen_code()
        cur.execute("SELECT 1 FROM MstRoom WHERE UPPER(PairingCode) = ?", code)
        if not cur.fetchone():
            return code
    return gen_code(8)


def _next_room_id(cur) -> str:
    cur.execute("SELECT COUNT(*) FROM MstRoom")
    n = int(cur.fetchone()[0] or 0) + 1
    while True:
        rid = f"ROOM-{n:02d}"
        cur.execute("SELECT 1 FROM MstRoom WHERE RoomID = ?", rid)
        if not cur.fetchone():
            return rid
        n += 1


def resolve_room(mac: Any) -> Dict[str, Any]:
    """Cari room berdasarkan MAC device. Buat baru bila belum ada.

    Inilah pengganti `getRoom()` lama yang selalu membuat kode acak baru:
    PairingCode sekarang STABIL per device (MAC).
    """
    mac_norm = device_mac_or_fallback(mac)
    key = mac_key(mac_norm)
    with _conn_lock, get_conn() as conn:
        cur = conn.cursor()
        row = _find_by_mac(cur, key)
        if row:
            return _row_to_room(row)
        # Belum ada -> buat baru.
        rid = _next_room_id(cur)
        code = _unique_code(cur)
        cur.execute(
            "INSERT INTO MstRoom (RoomID, MacAddress, PairingCode, IsRunning, SP_DC) "
            "VALUES (?, ?, ?, ?, ?)",
            rid, mac_norm, code, False, None,
        )
        conn.commit()
        return {"roomId": rid, "mac": mac_norm, "code": code, "isRunning": False, "sp_dc": None}


def claim_room(mac: Any) -> Dict[str, Any]:
    """Ambil room milik device (MAC) dan SEGARKAN PairingCode-nya.

    Dipakai setiap kali aplikasi layar DIBUKA dan setiap kali player LOGOUT:
    kode pairing dibuat baru, tetapi RoomID/MacAddress tetap — baris lama di
    MstRoom di-UPDATE, bukan disisipi room baru. Room baru hanya dibuat bila
    device benar-benar belum pernah terdaftar.
    """
    mac_norm = device_mac_or_fallback(mac)
    key = mac_key(mac_norm)
    with _conn_lock, get_conn() as conn:
        cur = conn.cursor()
        row = _find_by_mac(cur, key)
        if row:
            rid = row[0]
            code = _unique_code(cur)
            # Ganti kode pairing + tandai belum berjalan. SP_DC dibiarkan
            # (login Spotify milik device tetap tersimpan antar sesi).
            cur.execute(
                "UPDATE MstRoom SET PairingCode = ?, IsRunning = 0 WHERE RoomID = ?",
                code, rid,
            )
            conn.commit()
            return {
                "roomId": rid,
                "mac": (row[1] or "").strip(),
                "code": code,
                "isRunning": False,
                "sp_dc": row[4],
            }
        # Belum ada -> buat baru (sekali saja untuk device ini).
        rid = _next_room_id(cur)
        code = _unique_code(cur)
        cur.execute(
            "INSERT INTO MstRoom (RoomID, MacAddress, PairingCode, IsRunning, SP_DC) "
            "VALUES (?, ?, ?, ?, ?)",
            rid, mac_norm, code, False, None,
        )
        conn.commit()
        return {"roomId": rid, "mac": mac_norm, "code": code, "isRunning": False, "sp_dc": None}


def get_room_by_code(code: Any) -> Optional[Dict[str, Any]]:
    c = str(code or "").strip().upper()
    if not c:
        return None
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT {_ROOM_COLS} FROM MstRoom WHERE UPPER(PairingCode) = ?", c)
        row = cur.fetchone()
        return _row_to_room(row) if row else None


def set_room_sp_dc(code: Any, sp_dc: Optional[str]) -> bool:
    c = str(code or "").strip().upper()
    if not c:
        return False
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE MstRoom SET SP_DC = ? WHERE UPPER(PairingCode) = ?", sp_dc, c)
        ok = cur.rowcount > 0
        conn.commit()
        return ok


def set_room_running(code: Any, running: bool) -> bool:
    c = str(code or "").strip().upper()
    if not c:
        return False
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE MstRoom SET IsRunning = ? WHERE UPPER(PairingCode) = ?", 1 if running else 0, c)
        ok = cur.rowcount > 0
        conn.commit()
        return ok


# ---------------------------------------------------------------------------
# Bank lagu karaoke (MstSongBank)
# ---------------------------------------------------------------------------
def search_songs(q: str, limit: int = 30, offset: int = 0) -> Dict[str, Any]:
    limit = max(1, min(int(limit or 30), 100))
    offset = max(0, int(offset or 0))
    term = str(q or "").strip()
    like = f"%{term}%"
    where = "(? = '' OR Title LIKE ? OR Singer LIKE ?)"
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) FROM MstSongBank WHERE {where}", term, like, like)
        total = int(cur.fetchone()[0] or 0)
        cur.execute(
            "SELECT SongID, Title, Singer, Path FROM MstSongBank "
            f"WHERE {where} "
            "ORDER BY Title ASC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY",
            term, like, like, offset, limit,
        )
        rows = cur.fetchall()
    items = [
        {
            "songId": r[0],
            "title": r[1] or "",
            "singer": r[2] or "",
            "path": r[3] or "",
            "source": "karaoke",
        }
        for r in rows
    ]
    return {
        "items": items,
        "total": total,
        "offset": offset,
        "limit": limit,
        "hasMore": (offset + len(items)) < total,
    }


def get_song(song_id: Any) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT SongID, Title, Singer, Path FROM MstSongBank WHERE SongID = ?", song_id)
        r = cur.fetchone()
    if not r:
        return None
    return {"songId": r[0], "title": r[1] or "", "singer": r[2] or "", "path": r[3] or "", "source": "karaoke"}
