# Purplehat Backend - satu entrypoint untuk semua sumber
#   /search            -> YouTube   (youtube/main.py)
#   /soundcloud/search -> SoundCloud (soundcloud/main.py)
# Jalankan: uvicorn main:app --port 8000 (dari folder backend)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from youtube.main import router as youtube_router
from soundcloud.main import router as soundcloud_router

app = FastAPI(
    title="Purplehat API",
    description="Search YouTube & SoundCloud dalam satu backend",
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


@app.get("/")
async def root():
    return {
        "message": "Purplehat API",
        "usage": {
            "youtube": "/search?q=QUERY&limit=50&offset=0",
            "soundcloud": "/soundcloud/search?q=QUERY&page=1&limit=20",
            "soundcloudTrack": "/soundcloud/track?trackId=123456",
        },
        "health": "ok",
    }
