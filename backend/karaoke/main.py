# Purplehat - sumber "Karaoke" (bank lagu SQL Server + pemutar mpv)
# ---------------------------------------------------------------------------
# Router ini di-mount pada prefix /karaoke oleh backend/main.py:
#   GET  /karaoke/search            -> cari lagu di MstSongBank (semua lagu)
#   GET  /karaoke/player/state      -> status pemutar mpv
#   POST /karaoke/player/load       -> muat & putar file (path share lokal)
#   POST /karaoke/player/play|pause|toggle|stop
#   POST /karaoke/player/seek       -> { to }
#   POST /karaoke/player/volume     -> { vol }
#   POST /karaoke/player/fx         -> { pitch, echo, tempo, bass, treble, channel }
#   GET  /karaoke/player/fx
#
# Endpoint ini dipakai oleh screen (web/Flutter) dan/atau controller (mobile).
from typing import Any, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

import db
from .mpv import MpvError, player

router = APIRouter()


class LoadBody(BaseModel):
    path: str
    title: Optional[str] = None


class SeekBody(BaseModel):
    to: float = 0


class VolumeBody(BaseModel):
    vol: float = 30


class FxBody(BaseModel):
    pitch: Optional[float] = None
    echo: Optional[float] = None
    tempo: Optional[float] = None
    bass: Optional[float] = None
    treble: Optional[float] = None
    channel: Optional[str] = None


@router.get("/search")
def search(
    q: str = Query("", description="Kata kunci judul/penyanyi (kosong = semua lagu)"),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Cari lagu karaoke di MstSongBank. Semua lagu ditampilkan di search."""
    return db.search_songs(q=q, limit=limit, offset=offset)


@router.get("/player/state")
def player_state():
    return player.state()


@router.get("/player/fx")
def player_fx():
    return player.get_fx()


@router.post("/player/load")
def player_load(body: LoadBody):
    try:
        res = player.load(body.path)
    except MpvError as exc:
        return {"ok": False, "error": str(exc)}
    res["path"] = body.path
    res["title"] = body.title
    return res


@router.post("/player/play")
def player_play():
    return player.play()


@router.post("/player/pause")
def player_pause():
    return player.pause()


@router.post("/player/toggle")
def player_toggle():
    return player.toggle()


@router.post("/player/stop")
def player_stop():
    return player.stop()


@router.post("/player/seek")
def player_seek(body: SeekBody):
    return player.seek(body.to)


@router.post("/player/volume")
def player_volume(body: VolumeBody):
    return player.set_volume(body.vol)


@router.post("/player/fx")
def player_set_fx(body: FxBody):
    fx = body.model_dump(exclude_none=True)
    try:
        return player.apply_fx(fx)
    except MpvError as exc:
        return {"ok": False, "error": str(exc)}
