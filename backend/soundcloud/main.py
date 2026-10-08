# Purplehat - SoundCloud Search (scrape SoundCloud API with pagination & caching)
# Berdasarkan api-soundcloud, dijadikan router agar bisa di-mount di backend utama.
import re
import time
import asyncio
from typing import Optional
from fastapi import FastAPI, APIRouter, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import httpx

router = APIRouter()

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
_headers = {"User-Agent": UA}

_client_id = None
_http_client: Optional[httpx.AsyncClient] = None

SEARCH_CACHE = {}
CACHE_TTL = 300
CACHE_LOCK = asyncio.Lock()


def get_client() -> httpx.AsyncClient:
    """HTTP client lazy-init (aman dipakai via router maupun standalone)."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            headers=_headers,
            timeout=httpx.Timeout(connect=10.0, read=15.0, write=15.0, pool=15.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client


async def get_client_id() -> str:
    global _client_id
    if _client_id:
        return _client_id

    client = get_client()
    try:
        r = await client.get("https://soundcloud.com")
        r.raise_for_status()
        bundles = set(re.findall(r'https://a-v2\.sndcdn\.com/assets/([^"\']+\.js)', r.text))

        for bundle in bundles:
            try:
                js = (await client.get(f"https://a-v2.sndcdn.com/assets/{bundle}")).text
            except Exception:
                continue

            m = re.search(r'client_id:"([a-zA-Z0-9]+)"', js)
            if not m:
                m = re.search(r'client_id=([a-zA-Z0-9]+)', js)
            if m:
                _client_id = m.group(1)
                return _client_id

    except httpx.HTTPError:
        pass

    raise HTTPException(status_code=500, detail="Could not extract SoundCloud client_id")


def format_duration(ms: int) -> str:
    if not ms:
        return "0:00"
    total_sec = ms // 1000
    h, rem = divmod(total_sec, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def format_count(n):
    if n is None:
        return None
    return f"{n:,}"


def parse_track(track: dict) -> dict:
    user = track.get("user") or {}
    artwork = track.get("artwork_url")
    if not artwork and track.get("visuals") and track["visuals"].get("visuals"):
        artwork = track["visuals"]["visuals"][0].get("visual_url")
    if artwork:
        artwork = artwork.replace("-large.jpg", "-t500x500.jpg").replace("-cropped.jpg", "-t500x500.jpg")

    return {
        "title": track.get("title"),
        "trackId": track.get("id"),
        "source": "soundcloud",
        "link": track.get("permalink_url"),
        "thumbnail": artwork,
        "artist": user.get("username"),
        "artistUrl": user.get("permalink_url"),
        "duration": format_duration(track.get("duration")),
        "durationMs": track.get("duration"),
        "plays": format_count(track.get("playback_count")),
        "likes": format_count(track.get("likes_count")),
        "reposts": format_count(track.get("reposts_count")),
        "comments": format_count(track.get("comment_count")),
        "genre": track.get("genre"),
        "releaseDate": track.get("display_date") or track.get("created_at"),
        "monetization": track.get("monetization_model"),
    }


async def soundcloud_search(client: httpx.AsyncClient, query: str, limit: int, offset: int) -> Optional[dict]:
    global _client_id
    client_id = await get_client_id()
    url = "https://api-v2.soundcloud.com/search/tracks"
    params = {"q": query, "client_id": client_id, "limit": limit, "offset": offset}

    try:
        r = await client.get(url, params=params)

        if r.status_code == 401:
            _client_id = None
            client_id = await get_client_id()
            params["client_id"] = client_id
            r = await client.get(url, params=params)

        if r.status_code != 200:
            return None

        return r.json()
    except httpx.HTTPError:
        return None


def get_cache(query: str):
    cache = SEARCH_CACHE.get(query)
    if not cache:
        return None

    now = time.time()
    if now - cache["updated_at"] > CACHE_TTL:
        SEARCH_CACHE.pop(query, None)
        return None

    return cache


def create_cache(query: str):
    cache = {
        "tracks": [],
        "seen": set(),
        "continuation_offset": 0,
        "total_results": 0,
        "has_more": True,
        "updated_at": time.time(),
    }
    SEARCH_CACHE[query] = cache
    return cache


async def fetch_next_soundcloud_page(query: str, cache: dict, fetch_limit: int = 50) -> bool:
    if not cache["has_more"]:
        return False

    client = get_client()
    offset = cache["continuation_offset"]

    data = await soundcloud_search(client, query, fetch_limit, offset)

    if not data:
        cache["has_more"] = False
        return False

    collection = data.get("collection", [])
    total_results = data.get("total_results", 0)
    cache["total_results"] = total_results

    added = 0
    for track in collection:
        if track.get("kind") != "track":
            continue
        track_id = track.get("id")
        if not track_id or track_id in cache["seen"]:
            continue
        cache["seen"].add(track_id)
        cache["tracks"].append(parse_track(track))
        added += 1

    cache["continuation_offset"] = offset + len(collection)
    cache["updated_at"] = time.time()

    if len(collection) < fetch_limit or cache["continuation_offset"] >= total_results:
        cache["has_more"] = False

    return added > 0


async def fetch_search_page(query: str, page: int, limit: int) -> dict:
    query = query.strip()

    if not query:
        return {"data": [], "page": page, "limit": limit, "total": 0, "hasNext": False}

    async with CACHE_LOCK:
        cache = get_cache(query)
        if not cache:
            cache = create_cache(query)

        start_index = (page - 1) * limit
        end_index = start_index + limit

        max_fetch_pages = 25
        fetched_pages = 0

        while len(cache["tracks"]) < end_index and cache["has_more"] and fetched_pages < max_fetch_pages:
            fetched_pages += 1
            success = await fetch_next_soundcloud_page(query, cache)
            if not success:
                break

        data = cache["tracks"][start_index:end_index]
        has_next = len(cache["tracks"]) > end_index or cache["has_more"]

        return {
            "data": data,
            "page": page,
            "limit": limit,
            "total": len(cache["tracks"]),
            "totalResults": cache.get("total_results", 0),
            "hasNext": has_next,
        }


@router.get("/search")
async def search(
    q: str = Query(..., description="Search query"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=50, description="Items per page"),
    offset: Optional[int] = Query(None, ge=0, description="Legacy offset pagination"),
):
    if offset is not None:
        page = (offset // limit) + 1
    return await fetch_search_page(query=q, page=page, limit=limit)


@router.get("/track")
async def track(trackId: int = Query(..., description="SoundCloud track ID")):
    client = get_client()
    global _client_id
    client_id = await get_client_id()
    url = f"https://api-v2.soundcloud.com/tracks/{trackId}"
    params = {"client_id": client_id}

    try:
        r = await client.get(url, params=params)

        if r.status_code == 401:
            _client_id = None
            client_id = await get_client_id()
            params["client_id"] = client_id
            r = await client.get(url, params=params)

        if r.status_code != 200:
            raise HTTPException(status_code=404, detail="Track not found")

        return parse_track(r.json())
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Failed to fetch track")


@router.delete("/cache")
async def clear_cache():
    async with CACHE_LOCK:
        SEARCH_CACHE.clear()
    return {"success": True, "message": "Search cache cleared"}


@router.delete("/cache/{query}")
async def clear_query_cache(query: str):
    async with CACHE_LOCK:
        existed = query in SEARCH_CACHE
        SEARCH_CACHE.pop(query, None)
    return {"success": True, "query": query, "removed": existed}


@router.get("/player", response_class=FileResponse)
async def player(trackId: int = Query(..., description="SoundCloud track ID")):
    return FileResponse("player.html", media_type="text/html")


# Standalone mode: uvicorn soundcloud.main:app
app = FastAPI(title="SoundCloud Search API", description="Scrape SoundCloud search results with pagination and caching")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/")
async def root():
    return {
        "message": "SoundCloud Search API with Pagination",
        "usage": {
            "search": "/search?q=QUERY&page=1&limit=20",
            "track": "/track?trackId=123456",
            "player": "/player?trackId=123456",
        },
        "cache": {"enabled": True, "ttl_seconds": CACHE_TTL},
    }
