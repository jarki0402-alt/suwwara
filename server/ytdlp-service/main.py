from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import yt_dlp
import logging
import os
import threading
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Self-healing: nothing restarts a wedged container on its own (Docker only restarts one whose process exits), and a
# hung yt-dlp/BotGuard call used to leave every resolve failing until someone ran `docker compose restart` by hand.
# The process exits instead and `restart: unless-stopped` brings it back in a few seconds.
HUNG_AFTER_S = 45
MAX_CONSECUTIVE_INFRA_FAILURES = 5
INFRA_ERROR_MARKERS = ('timed out', 'timeout', 'temporary failure', 'network is unreachable', 'connection refused', 'connection reset', 'name or service not known')
_inflight: dict[int, float] = {}
_state_lock = threading.Lock()
_infra_failures = 0


def _watchdog() -> None:
    while True:
        time.sleep(5)
        with _state_lock:
            oldest = min(_inflight.values(), default=None)
        if oldest is not None and time.time() - oldest > HUNG_AFTER_S:
            logger.error('A resolve has been running for over %ss; exiting so the container restarts.', HUNG_AFTER_S)
            os._exit(1)


threading.Thread(target=_watchdog, daemon=True).start()


class ResolveRequest(BaseModel):
    video_id: str
    quality: str  # audio: 'high' or 'low'; video: ignored (every quality comes back, see VIDEO_LADDER)
    kind: str = 'audio'  # 'audio' or 'video'

EXT_TO_MIME = {
    'm4a': 'audio/mp4',
    'webm': 'audio/webm',
    'opus': 'audio/opus',
    'mp3': 'audio/mpeg',
}

# The H.264 MP4 rungs of YouTube's ladder, by itag, each labelled with its quality name. By itag rather than height:
# a widescreen film-look MV's "1080p" file is 1920x804, its height says nothing. H.264 only: the one codec every phone
# decodes in hardware, iPhones included; VP9/AV1 would be smaller but software-decoded (hot, stuttering) on older
# Androids and absent from iOS's HLS.
VIDEO_LADDER = {'133': '240', '134': '360', '135': '480', '136': '720', '137': '1080'}

def video_variants(info) -> list:
    """Every rung this video has, lowest first. All of them come from one extraction (the formats list carries every
    URL), so adaptive quality costs a single yt-dlp turn, not one per quality."""
    variants = []
    for f in info.get('formats') or []:
        tier = VIDEO_LADDER.get(str(f.get('format_id')))
        if not tier or not f.get('url') or f.get('protocol') not in ('https', 'http'):
            continue
        variants.append({
            'tier': tier,
            'url': f['url'],
            'httpHeaders': f.get('http_headers') or info.get('http_headers', {}),
            'width': f.get('width'),
            'height': f.get('height'),
            'kbps': f.get('tbr'),
            'codecs': f.get('vcodec'),
        })
    variants.sort(key=lambda v: int(v['tier']))
    return variants

def format_selector(quality: str, kind: str) -> str:
    if kind == 'video':
        # Picks the top-level URL, the fallback when a client gives no ladder (only the 360p file with sound, which
        # still plays muted). The ladder itself is read from the formats list, see video_variants.
        return 'bestvideo[height<=720][vcodec^=avc1][ext=mp4]/bestvideo[height<=720][ext=mp4]/best[height<=720][ext=mp4]'
    if quality == 'low':
        return 'worstaudio[ext=m4a]/worstaudio/worst[ext=mp4]/worst'
    return 'bestaudio[ext=m4a]/bestaudio/best[ext=mp4]/best'

# visionos first: it gets the real adaptive formats (m4a audio, 720p H.264 video) without a JavaScript challenge, ~1.8s
# per resolve. yt-dlp's own default (visionos + web) took 4-6s, the web client's player JS is solved in Node on every
# resolve. The android/ios pair used to be the only setting, but YouTube's SABR-only experiment strips their adaptive
# URLs, leaving just the 360p video+audio file, which this service then handed out as "audio"; it stays as the last
# resort so something always plays.
CLIENT_ATTEMPTS = (['visionos'], ['web'], ['android', 'ios'])

# Which attempt worked last time for a video, so its next resolve (a music video's picture right after its sound, a
# re-resolve hours later) starts there instead of paying for the clients that already failed it (~4.5s instead of
# ~2s for videos visionos refuses). Bounded: oldest dropped past the cap.
MAX_REMEMBERED_CLIENTS = 500
_working_client: dict[str, int] = {}

def attempts_for(video_id: str):
    first = _working_client.get(video_id, 0)
    return list(range(first, len(CLIENT_ATTEMPTS)))

def remember_client(video_id: str, attempt: int) -> None:
    with _state_lock:
        _working_client.pop(video_id, None)
        if attempt > 0:
            _working_client[video_id] = attempt
            while len(_working_client) > MAX_REMEMBERED_CLIENTS:
                _working_client.pop(next(iter(_working_client)))

def extract(video_id: str, fmt: str, clients):
    youtube_args = {'player_client': clients}
    ydl_opts = {
        'format': fmt,
        'js_runtimes': {'node': {}},
        'extractor_args': {
            'youtube': youtube_args,
            'youtubepot-bgutilhttp': {'base_url': ['http://bgutil-provider:4416']},
        },
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 20,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    if not info or not info.get('url'):
        raise Exception("No stream URL found in extracted info")
    return info

@app.post("/resolve")
def resolve_audio(req: ResolveRequest):
    fmt = format_selector(req.quality, req.kind)
    global _infra_failures
    token = threading.get_ident()
    with _state_lock:
        _inflight[token] = time.time()
    try:
        info = None
        order = attempts_for(req.video_id)
        for position, attempt in enumerate(order):
            clients = CLIENT_ATTEMPTS[attempt]
            try:
                info = extract(req.video_id, fmt, clients)
                remember_client(req.video_id, attempt)
                break
            except Exception as e:
                if position == len(order) - 1:
                    raise
                logger.warning(f"{req.video_id} ({req.kind}): client {clients} failed ({str(e)[:160]}), trying {CLIENT_ATTEMPTS[order[position + 1]]}")

        with _state_lock:
            _infra_failures = 0
        ext = info.get('ext')
        return {
            "url": info['url'],
            "mimeType": 'video/mp4' if req.kind == 'video' else EXT_TO_MIME.get(ext, 'audio/mp4'),
            "httpHeaders": info.get('http_headers', {}),
            "formatId": info.get('format_id'),
            "duration": info.get('duration'),
            "variants": video_variants(info) if req.kind == 'video' else None,
        }
    except Exception as e:
        logger.error(f"yt-dlp failed to resolve {req.kind} for {req.video_id}: {str(e)}")
        # Only network-shaped failures count: a private or removed video fails on its own without anything being wrong.
        if any(marker in str(e).lower() for marker in INFRA_ERROR_MARKERS):
            with _state_lock:
                _infra_failures += 1
                too_many = _infra_failures >= MAX_CONSECUTIVE_INFRA_FAILURES
            if too_many:
                logger.error('%s network failures in a row; exiting so the container restarts.', MAX_CONSECUTIVE_INFRA_FAILURES)
                os._exit(1)
        raise HTTPException(status_code=502, detail=str(e))
    finally:
        with _state_lock:
            _inflight.pop(token, None)
