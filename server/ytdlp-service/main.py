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
    quality: str  # 'high' or 'low'

EXT_TO_MIME = {
    'm4a': 'audio/mp4',
    'webm': 'audio/webm',
    'opus': 'audio/opus',
    'mp3': 'audio/mpeg',
}

def format_selector(quality: str) -> str:
    if quality == 'low':
        return 'worstaudio[ext=m4a]/worstaudio/worst[ext=mp4]/worst'
    return 'bestaudio[ext=m4a]/bestaudio/best[ext=mp4]/best'

@app.post("/resolve")
def resolve_audio(req: ResolveRequest):
    url = f"https://www.youtube.com/watch?v={req.video_id}"
    ydl_opts = {
        'format': format_selector(req.quality),
        'extractor_args': {'youtubepot': {'bgutilhttp': ['base_url=http://bgutil-provider:4416']}},
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 20,
    }

    global _infra_failures
    token = threading.get_ident()
    with _state_lock:
        _inflight[token] = time.time()
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise Exception("No info extracted")
                
            stream_url = info.get('url')
            ext = info.get('ext')
            http_headers = info.get('http_headers', {})
            
            if not stream_url:
                raise Exception("No stream URL found in extracted info")

            with _state_lock:
                _infra_failures = 0
            return {
                "url": stream_url,
                "mimeType": EXT_TO_MIME.get(ext, 'audio/mp4'),
                "httpHeaders": http_headers
            }
    except Exception as e:
        logger.error(f"yt-dlp failed to resolve audio for {req.video_id}: {str(e)}")
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
