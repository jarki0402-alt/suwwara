from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import yt_dlp
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

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

            return {
                "url": stream_url,
                "mimeType": EXT_TO_MIME.get(ext, 'audio/mp4'),
                "httpHeaders": http_headers
            }
    except Exception as e:
        logger.error(f"yt-dlp failed to resolve audio for {req.video_id}: {str(e)}")
        raise HTTPException(status_code=502, detail=str(e))
