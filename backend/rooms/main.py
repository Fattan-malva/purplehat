# Purplehat - room & pairing berbasis SQL Server (tabel MstRoom)
# ---------------------------------------------------------------------------
# Di-mount pada prefix /room oleh backend/main.py:
#   GET  /room/resolve?mac=...   -> cari/buat room untuk device (PairingCode stabil per MAC)
#   GET  /room/{code}            -> room berdasarkan PairingCode
#   PUT  /room/{code}/sp_dc      -> { sp_dc }
#   PUT  /room/{code}/running    -> { running }
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import db

router = APIRouter()


class SpDcBody(BaseModel):
    sp_dc: Optional[str] = None


class RunningBody(BaseModel):
    running: bool = False


@router.get("/resolve")
def resolve(mac: str = Query("", description="MAC address device (dikirim oleh player/Flutter)")):
    """Cari room berdasarkan MAC device; buat baru bila belum ada.

    PairingCode stabil per device, sehingga layar tidak selalu membuat room baru.
    """
    return db.resolve_room(mac)


@router.get("/claim")
def claim(mac: str = Query("", description="MAC address device (dikirim oleh player/Flutter)")):
    """Cari room berdasarkan MAC device dan segarkan PairingCode-nya.

    Dipakai layar saat aplikasi dibuka / player logout: kode pairing baru,
    tetapi room (RoomID + MacAddress) yang SAMA — tidak membuat room baru.
    """
    return db.claim_room(mac)


@router.get("/{code}")
def by_code(code: str):
    room = db.get_room_by_code(code)
    if not room:
        raise HTTPException(status_code=404, detail="Room tidak ditemukan")
    return room


@router.put("/{code}/sp_dc")
def put_sp_dc(code: str, body: SpDcBody):
    value = (body.sp_dc or "").strip() or None
    db.set_room_sp_dc(code, value)
    return {"ok": True, "has": bool(value)}


@router.put("/{code}/running")
def put_running(code: str, body: RunningBody):
    db.set_room_running(code, bool(body.running))
    return {"ok": True}
