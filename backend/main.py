# Purplehat Backend - satu entrypoint untuk semua sumber
#   /search            -> YouTube    (youtube/main.py)
#   /soundcloud/search -> SoundCloud (soundcloud/main.py)
#   /spotify/search    -> Spotify    (spotify/main.py, sub-app)
#   /karaoke/search    -> Karaoke    (karaoke/main.py, bank lagu SQL Server + mpv)
#   /room/resolve      -> Room       (rooms/main.py, pairing per MAC di MstRoom)
# Jalankan: uvicorn main:app --port 8000 (dari folder backend)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from youtube.main import router as youtube_router
from soundcloud.main import router as soundcloud_router
from spotify.main import app as spotify_app
from karaoke.main import router as karaoke_router
from rooms.main import router as rooms_router

app = FastAPI(
    title="Purplehat API",
    description="Search YouTube, SoundCloud, Spotify & Karaoke dalam satu backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(youtube_router)
app.include_router(soundcloud_router, prefix="/soundcloud")
# Spotify: di-mount sebagai sub-app (punya state/klien HTTP sendiri).
app.mount("/spotify", spotify_app)
# Karaoke: bank lagu (SQL Server) + pemutar mpv.
app.include_router(karaoke_router, prefix="/karaoke")
# Room/pairing: identitas room di MstRoom (pairing stabil per MAC).
app.include_router(rooms_router, prefix="/room")


@app.get("/")
async def root():
    return {
        "message": "Purplehat API",
        "usage": {
            "youtube": "/search?q=QUERY&limit=50&offset=0",
            "soundcloud": "/soundcloud/search?q=QUERY&page=1&limit=20",
            "soundcloudTrack": "/soundcloud/track?trackId=123456",
            "spotify": "/spotify/search?q=QUERY&limit=20",
            "spotifyTrack": "/spotify/track?trackId=ID&sp_dc=...",
            "spotifyLyrics": "/spotify/lyrics?trackId=ID&sp_dc=...",
            "spotifyEmbed": "/spotify/embed-proxy?trackId=ID&sp_dc=...",
            "karaoke": "/karaoke/search?q=QUERY&limit=30&offset=0",
            "karaokePlayer": "/karaoke/player/state | /karaoke/player/load | /karaoke/player/fx",
            "roomResolve": "/room/resolve?mac=AA-BB-CC-DD-EE-FF",
        },
        "health": "ok",
    }
