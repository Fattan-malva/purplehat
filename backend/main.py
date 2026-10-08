import re
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import httpx

app = FastAPI(title="Purplehat YouTube Search API", description="Scrape YouTube search results via InnerTube API with pagination")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

_headers = {"User-Agent": UA}
_innertube_api_key = None
_client_version = None


async def get_innertube_config() -> tuple:
    global _innertube_api_key, _client_version
    if _innertube_api_key and _client_version:
        return _innertube_api_key, _client_version

    async with httpx.AsyncClient(headers=_headers, timeout=15) as client:
        r = await client.get("https://www.youtube.com")
        r.raise_for_status()
        html = r.text

        key = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html)
        ver = re.search(r'"INNERTUBE_CONTEXT_CLIENT_VERSION":"([0-9.]+)"', html)

        if not key:
            raise HTTPException(status_code=500, detail="Could not extract INNERTUBE_API_KEY")

        _innertube_api_key = key.group(1)
        _client_version = ver.group(1) if ver else "2.20240726.01.00"
        return _innertube_api_key, _client_version


def context() -> dict:
    return {
        "client": {
            "hl": "en",
            "gl": "US",
            "clientName": "WEB",
            "clientVersion": _client_version,
        }
    }


async def innertube_search(client: httpx.AsyncClient, query: str, continuation: str = None) -> dict:
    global _innertube_api_key, _client_version

    key, _ = await get_innertube_config()

    body = {"context": context()}
    if continuation:
        body["continuation"] = continuation
    else:
        body["query"] = query

    url = f"https://www.youtube.com/youtubei/v1/search?key={key}"
    r = await client.post(url, json=body)

    if r.status_code in (401, 403):
        _innertube_api_key = None
        _client_version = None
        key, _ = await get_innertube_config()
        url = f"https://www.youtube.com/youtubei/v1/search?key={key}"
        r = await client.post(url, json=body)

    if r.status_code != 200:
        return None

    return r.json()


def parse_video(video: dict) -> dict:
    video_id = video.get("videoId")
    owner = (video.get("ownerText") or {}).get("runs") or [{}]

    return {
        "title": video["title"]["runs"][0]["text"],
        "videoId": video_id,
        "link": f"https://www.youtube.com/watch?v={video_id}",
        "thumbnail": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
        "channelName": owner[0].get("text") or "Unknown",
        "duration": (video.get("lengthText") or {}).get("simpleText") or "Unknown",
        "views": (video.get("viewCountText") or {}).get("simpleText") or "Unknown",
        "releaseDate": (video.get("publishedTimeText") or {}).get("simpleText") or "Unknown",
    }


def extract_initial_items(data: dict) -> tuple:
    items = []
    token = None
    try:
        contents = (
            data["contents"]["twoColumnSearchResultsRenderer"]["primaryContents"]
            ["sectionListRenderer"]["contents"]
        )
    except (KeyError, TypeError):
        return items, token

    for section in contents:
        sec = section.get("itemSectionRenderer")
        if sec:
            items = sec.get("contents", [])
        cont = section.get("continuationItemRenderer")
        if cont:
            token = cont.get("continuationEndpoint", {}).get("continuationCommand", {}).get("token")

    return items, token


def extract_continuation_items(data: dict) -> tuple:
    items = []
    token = None
    for cmd in data.get("onResponseReceivedCommands") or []:
        action = cmd.get("appendContinuationItemsAction")
        if not action:
            continue
        for ci in action.get("continuationItems", []):
            section = ci.get("itemSectionRenderer")
            if section:
                items.extend(section.get("contents", []))
            else:
                items.append(ci)
            cont = ci.get("continuationItemRenderer")
            if cont:
                token = cont.get("continuationEndpoint", {}).get("continuationCommand", {}).get("token")

    return items, token


async def fetch_search(query: str, limit: int, offset: int) -> list:
    target = offset + limit
    videos = []
    seen = set()
    continuation = None
    last_token = None
    pages = 0

    async with httpx.AsyncClient(headers=_headers, timeout=15) as client:
        while len(videos) < target and pages < 25:
            pages += 1
            data = await innertube_search(client, query, continuation)
            if not data:
                break

            if continuation is None:
                items, continuation = extract_initial_items(data)
            else:
                items, continuation = extract_continuation_items(data)

            for item in items:
                v = item.get("videoRenderer")
                if not v:
                    continue
                video_id = v.get("videoId")
                if not video_id or video_id in seen:
                    continue
                seen.add(video_id)
                videos.append(parse_video(v))
                if len(videos) >= target:
                    break

            if not continuation or continuation == last_token:
                break
            last_token = continuation

    return videos[offset:offset + limit]


@app.get("/search")
async def search(
    q: str = Query(..., description="Search query"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    return await fetch_search(q, limit, offset)


@app.get("/player", response_class=FileResponse)
async def player(videoId: str = Query(..., description="YouTube video ID")):
    return FileResponse("player.html", media_type="text/html")


@app.get("/")
async def root():
    return {
        "message": "Purplehat YouTube Search API",
        "usage": "/search?q=QUERY&limit=50&offset=0",
        "health": "ok",
    }
