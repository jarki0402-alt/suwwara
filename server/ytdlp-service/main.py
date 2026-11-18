from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import yt_dlp
import json
import logging
import urllib.request
import os
import shutil
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
    # The server's own warming, nobody waiting on it: never uses the backup account (resolve_info).
    background: bool = False

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
        # A video YouTube has auto-dubbed carries several audio tracks, and "worst" sorts the original LAST: plain
        # worstaudio picked the English AI dub of an Indonesian story (139-0 "English (US)" over 139-1 "Indonesian
        # original"). The original is the one labelled so; a video with a single track has no label and falls through.
        # bestaudio below already prefers the original (yt-dlp ranks it by language_preference).
        return 'worstaudio[ext=m4a][format_note*=original]/worstaudio[ext=m4a]/worstaudio/worst[ext=mp4]/worst'
    return 'bestaudio[ext=m4a]/bestaudio/best[ext=mp4]/best'

# visionos first: it gets the real adaptive formats (m4a audio, 720p H.264 video) without a JavaScript challenge, ~1.8s
# per resolve. yt-dlp's own default (visionos + web) took 4-6s, the web client's player JS is solved in Node on every
# resolve. The android/ios pair used to be the only setting, but YouTube's SABR-only experiment strips their adaptive
# URLs, leaving just the 360p video+audio file, which this service then handed out as "audio"; it stays as the last
# resort so something always plays.
# web_music replaced web as the second attempt (2026-11-18): YouTube now forces SABR on the web client, so it returned
# no downloadable formats at all and every visionos refusal fell through to the 360p file. web_music (YouTube Music's
# own client) still gets plain m4a URLs, ~3 s with its JavaScript challenge solved in Node (yt-dlp-ejs, Dockerfile).
CLIENT_ATTEMPTS = (['visionos'], ['web_music'], ['android', 'ios'])
# The backup account's client. visionos and android/ios take no cookies; of the clients that do, web/web_safari get
# SABR only (no formats), tv is refused ("The page needs to be reloaded"), mweb's URLs answer 403. Tested 2026-11-18.
ACCOUNT_CLIENTS = ['web_music']
# web_music's JavaScript challenge is solved in Node, ~300MB for a few seconds, once per YouTube player version (then
# cached, docker-compose.yml). On this 1GB VM that is only taken when RAM + swap can absorb it; otherwise the client is
# skipped (the anonymous order goes on to android/ios, the account waits), never risking the OOM killer.
JS_CLIENTS = {'web_music'}
MIN_FREE_FOR_JS_MB = 600

def enough_memory_for(clients) -> bool:
    if not JS_CLIENTS.intersection(clients or []):
        return True
    try:
        # A container's /proc/meminfo shows the VM's own figures (no per-container view is set up here).
        with open('/proc/meminfo') as f:
            info = {line.split(':')[0]: int(line.split()[1]) for line in f}
        free_mb = (info.get('MemAvailable', 0) + info.get('SwapFree', 0)) // 1024
    except (OSError, ValueError, IndexError):
        return True
    if free_mb < MIN_FREE_FOR_JS_MB:
        logger.warning('Skipping %s: only %sMB of RAM + swap free, its JavaScript challenge may need ~300MB.', clients, free_mb)
        return False
    return True

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

def extract(video_id: str, fmt: str, clients, cookiefile=None):
    youtube_args = {'player_client': clients} if clients else {}
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
    if cookiefile:
        ydl_opts['cookiefile'] = cookiefile
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    if not info or not info.get('url'):
        raise Exception("No stream URL found in extracted info")
    return info


# ---- Why YouTube said no, and the backup account ----------------------------------------------------------------
#
# Three kinds of "no" need different answers (2026-11, a night of "try again" in the logs):
#  - limited: "Sign in to confirm you're not a bot" / "try again later". YouTube distrusts this VM's IP for a while;
#    every client is refused at once, so trying the other two only adds requests to an IP already under suspicion.
#  - account: age-restricted or "Please sign in". The same video fails forever without an account.
#  - gone: private, removed, members-only, blocked in the VM's country. No account fixes these.
# The backend remembers the answer (server/src/youtube/refusals.ts): gone/account for everyone, "limited" only for
# prefetches, so a listener's own tap always gets a fresh try (and the account, see resolve_info).
#
# The backup account (a throwaway Google account's cookies, never the owner's own) carries only what anonymous
# resolving cannot, inside the same request, so the listener sees a slightly slower start instead of an error.
# Which way goes first is decided per request, see the notes above VIDEO_ACCOUNT_FIRST_S.

class Refused(Exception):
    def __init__(self, reason: str, error: Exception):
        super().__init__(str(error))
        self.reason = reason

GONE_MARKERS = ('private video', 'has been removed', 'members-only', 'join this channel', 'account associated with this video has been terminated')
# Also "gone", but one client can say this about a video another client plays (visionos refuses some videos web plays,
# see CLIENT_ATTEMPTS), so these only count once every client has said it.
# Never a bare "is not available": yt-dlp's own "Requested format is not available" (a client with no usable format)
# matched it and marked playable songs gone for 24 hours (2026-11-18).
MAYBE_GONE_MARKERS = ('video unavailable', 'video is unavailable', 'video is not available', 'available in your country', 'no longer available')
LIMITED_MARKERS = ('not a bot', 'try again later')
ACCOUNT_MARKERS = ('confirm your age', 'age-restricted', 'inappropriate for some users', 'please sign in', 'sign in to view')

def refusal_kind(message: str):
    text = message.lower()
    # yt-dlp's own words, not YouTube's: this client found no format we can use. Says nothing about the video.
    if 'requested format is not available' in text:
        return None
    # Before "gone": YouTube's rate limit reads "Video unavailable. This content isn't available, try again later".
    if any(m in text for m in LIMITED_MARKERS):
        return 'limited'
    if any(m in text for m in GONE_MARKERS):
        return 'gone'
    if any(m in text for m in ACCOUNT_MARKERS):
        return 'account'
    if any(m in text for m in MAYBE_GONE_MARKERS):
        return 'maybe-gone'
    return None

# Mounted read-only from ./youtube-account on the host (docker-compose.yml). yt-dlp writes rotated cookies back to the
# file it was given, so it works on a private copy, refreshed whenever the mounted file is replaced.
ACCOUNT_COOKIES = '/account/cookies.txt'
WORKING_COOKIES = '/tmp/youtube-cookies.txt'

# Which way to ask first is decided per request, from what YouTube said lately (2026-11-17: for 40 minutes YouTube
# refused four trending songs with "not a bot" on every client while every other song resolved anonymously, so the
# refusal was about those videos, not the whole IP):
#  - a video refused anonymously goes to the account first for a while: waiting for its anonymous "no" again only
#    makes the listener wait ~3 s longer for the same answer;
#  - refusals on several different videos in a short time mean the IP itself is distrusted: everyone goes to the
#    account first, until an anonymous resolve works again (a probe every few minutes, or the warmer), not a fixed time;
#  - otherwise anonymous first, as always: one account carrying every listener from a datacenter IP is exactly what
#    gets an account flagged, so it carries only what anonymous resolving cannot.
VIDEO_ACCOUNT_FIRST_S = {'limited': 6 * 60 * 60, 'account': 7 * 24 * 60 * 60}
MAX_ACCOUNT_FIRST_VIDEOS = 500
LIMITED_WINDOW_S = 10 * 60
LIMITED_VIDEOS_FOR_ACCOUNT_FIRST = 3
# A ceiling, not the expected length: the first anonymous success ends it.
ACCOUNT_FIRST_FOR_S = 30 * 60
PROBE_EVERY_S = 5 * 60
# The account refused too (dead cookies, or the account itself flagged): leave it alone for a while, never hammer it.
ACCOUNT_REST_S = 10 * 60
# Far below yt-dlp's documented ~2000 videos/hour for an account, so even a long night of account-first stays
# unremarkable. Past it, resolving falls back to anonymous until the hour rolls over.
ACCOUNT_PER_HOUR = 200

_account_lock = threading.Lock()
_account = {
    'source_mtime': None,
    'rest_until': 0.0,
    'first_until': 0.0,
    'last_probe_at': 0.0,
    'last_ok_at': None,
    'last_fail_at': None,
    'last_error': None,
    'ok': 0,
    'failed': 0,
    # Account resolves in a row that ended without audio for a reason that is not a refusal (no usable format, the
    # client changed): two of them rest the account like a refusal does, so a broken account way never slows songs down.
    'no_audio_streak': 0,
}
# Video id -> when it was last refused as "limited", for counting distinct videos in LIMITED_WINDOW_S. Bounded by the
# window: older entries are dropped on every write.
_limited_at: dict[str, float] = {}
# Video id -> until when it goes to the account first. Bounded: oldest dropped past the cap.
_account_first_videos: dict[str, float] = {}
# When the account was used, within the last hour (at most ACCOUNT_PER_HOUR entries).
_account_uses: list[float] = []

def account_cookiefile():
    """The private working copy, or None when no account is set up, it is resting, its hourly allowance is spent, or
    the VM has no room for its client right now (enough_memory_for)."""
    if not enough_memory_for(ACCOUNT_CLIENTS):
        return None
    try:
        mtime = os.stat(ACCOUNT_COOKIES).st_mtime
    except OSError:
        return None
    now = time.time()
    with _account_lock:
        if mtime != _account['source_mtime']:
            shutil.copyfile(ACCOUNT_COOKIES, WORKING_COOKIES)
            _account['source_mtime'] = mtime
            # New cookies: whatever made the old ones rest no longer applies.
            _account['rest_until'] = 0.0
        if now < _account['rest_until']:
            return None
        _account_uses[:] = [t for t in _account_uses if now - t < 3600]
        if len(_account_uses) >= ACCOUNT_PER_HOUR:
            return None
    return WORKING_COOKIES

def note_limited(video_id: str) -> None:
    now = time.time()
    with _account_lock:
        for vid in [v for v, t in _limited_at.items() if now - t >= LIMITED_WINDOW_S]:
            _limited_at.pop(vid, None)
        _limited_at[video_id] = now
        if len(_limited_at) >= LIMITED_VIDEOS_FOR_ACCOUNT_FIRST and now >= _account['first_until']:
            _account['first_until'] = now + ACCOUNT_FIRST_FOR_S
            logger.warning('%s different videos refused as "not a bot" within %ss: the backup account goes first until anonymous resolving works again.', len(_limited_at), LIMITED_WINDOW_S)

def note_anonymous_ok() -> None:
    with _account_lock:
        if _account['first_until'] > time.time():
            logger.info('Anonymous resolving works again: back to anonymous first.')
        _account['first_until'] = 0.0
        _limited_at.clear()

def remember_account_first(video_id: str, why: str) -> None:
    with _account_lock:
        _account_first_videos.pop(video_id, None)
        _account_first_videos[video_id] = time.time() + VIDEO_ACCOUNT_FIRST_S[why]
        while len(_account_first_videos) > MAX_ACCOUNT_FIRST_VIDEOS:
            _account_first_videos.pop(next(iter(_account_first_videos)))

def video_goes_to_account_first(video_id: str) -> bool:
    with _account_lock:
        until = _account_first_videos.get(video_id)
        if until is None:
            return False
        if until <= time.time():
            _account_first_videos.pop(video_id, None)
            return False
        return True

def extract_with_account(video_id: str, fmt: str, cookiefile: str):
    with _account_lock:
        _account_uses.append(time.time())
    try:
        info = extract(video_id, fmt, ACCOUNT_CLIENTS, cookiefile)
    except Exception as e:
        kind = refusal_kind(str(e))
        with _account_lock:
            _account['failed'] += 1
            _account['last_fail_at'] = time.time()
            _account['last_error'] = str(e)[:300]
            _account['no_audio_streak'] = _account['no_audio_streak'] + 1 if kind is None else 0
            # Refused as a bot, or asked to sign in while signed in: the cookies are dead or the account is flagged.
            # An age check the account cannot pass says nothing about the cookies.
            if kind == 'limited' or (kind == 'account' and 'confirm your age' not in str(e).lower()):
                _account['rest_until'] = time.time() + ACCOUNT_REST_S
                logger.error('Backup YouTube account refused (%s); resting it for %ss. Replace youtube-account/cookies.txt if this repeats.', str(e)[:160], ACCOUNT_REST_S)
            elif _account['no_audio_streak'] >= 2:
                _account['rest_until'] = time.time() + ACCOUNT_REST_S
                _account['no_audio_streak'] = 0
                logger.error('Backup YouTube account gave no audio twice in a row (%s); resting it for %ss.', str(e)[:160], ACCOUNT_REST_S)
        raise
    with _account_lock:
        _account['ok'] += 1
        _account['last_ok_at'] = time.time()
        _account['no_audio_streak'] = 0
    return info

def resolve_info(video_id: str, fmt: str, kind: str, background: bool = False):
    """(info, via_account). Raises Refused when YouTube said no in a way the backend should remember.

    background: the server's own warming (resolveWarmer.ts), which nobody is waiting on: never spends the account."""
    cookiefile = None if background else account_cookiefile()
    if cookiefile:
        now = time.time()
        video_first = video_goes_to_account_first(video_id)
        everyone_first = now < _account['first_until']
        if everyone_first and not video_first and now - _account['last_probe_at'] >= PROBE_EVERY_S:
            # One listener in a few minutes goes the anonymous way so the mode can end. If it is still refused, that
            # costs one client's "no" (~1-3 s): the loop below stops at the first refusal when the account is there.
            with _account_lock:
                _account['last_probe_at'] = now
        elif video_first or everyone_first:
            try:
                return extract_with_account(video_id, fmt, cookiefile), True
            except Exception as e:
                if refusal_kind(str(e)) in ('gone', 'maybe-gone'):
                    raise Refused('gone', e)
                # Anything else: the anonymous order below still gets its chance, without asking the account twice.
                cookiefile = None

    refused = None
    order = attempts_for(video_id)
    order = [attempt for attempt in order if enough_memory_for(CLIENT_ATTEMPTS[attempt])]
    for position, attempt in enumerate(order):
        clients = CLIENT_ATTEMPTS[attempt]
        try:
            info = extract(video_id, fmt, clients)
            remember_client(video_id, attempt)
            note_anonymous_ok()
            return info, False
        except Exception as e:
            why = refusal_kind(str(e))
            if why == 'gone':
                raise Refused('gone', e)
            # With an account to fall back on, the other anonymous clients are skipped: they get the same answer.
            # Without one, every client is still tried, exactly as before.
            if why in ('limited', 'account') and cookiefile:
                refused = (why, e)
                break
            if position == len(order) - 1:
                if why:
                    refused = ('gone' if why == 'maybe-gone' else why, e)
                    break
                raise
            logger.warning(f"{video_id} ({kind}): client {clients} failed ({str(e)[:160]}), trying {CLIENT_ATTEMPTS[order[position + 1]]}")

    why, error = refused
    if why == 'limited':
        note_limited(video_id)
    if why in ('limited', 'account'):
        remember_account_first(video_id, why)
    if cookiefile and why != 'gone':
        logger.warning(f"{video_id} ({kind}): refused without an account ({why}), trying the backup account")
        try:
            return extract_with_account(video_id, fmt, cookiefile), True
        except Exception as e:
            if refusal_kind(str(e)) in ('gone', 'maybe-gone'):
                raise Refused('gone', e)
    raise Refused(why, error)

@app.post("/resolve")
def resolve_audio(req: ResolveRequest):
    fmt = format_selector(req.quality, req.kind)
    global _infra_failures
    token = threading.get_ident()
    with _state_lock:
        _inflight[token] = time.time()
    try:
        info, via_account = resolve_info(req.video_id, fmt, req.kind, req.background)

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
            "viaAccount": via_account,
        }
    except Refused as e:
        # YouTube answered, so nothing is wrong with this service: never counted as a network failure.
        logger.error(f"yt-dlp refused {req.kind} for {req.video_id} ({e.reason}): {str(e)[:300]}")
        raise HTTPException(status_code=502, detail={'reason': e.reason, 'message': str(e)[:500]})
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


@app.get("/account")
def account_status():
    """The backup account at a glance, for the admin console (server/src/routes/admin.ts)."""
    configured = os.path.exists(ACCOUNT_COOKIES)
    now = time.time()
    with _account_lock:
        state = dict(_account)
        now_first = sum(1 for until in _account_first_videos.values() if until > now)
        used_last_hour = sum(1 for t in _account_uses if now - t < 3600)
    return {
        'configured': configured,
        'resting': configured and now < state['rest_until'],
        'restUntil': state['rest_until'] or None,
        'firstUntil': state['first_until'] if now < state['first_until'] else None,
        'lastOkAt': state['last_ok_at'],
        'lastFailAt': state['last_fail_at'],
        'lastError': state['last_error'],
        'ok': state['ok'],
        'failed': state['failed'],
        # Videos that currently go to the account first (refused anonymously lately, or age-restricted).
        'needsAccount': now_first,
        'usedLastHour': used_last_hour,
        'perHour': ACCOUNT_PER_HOUR,
    }


# ---- Podcast episodes: chapters + transcript -------------------------------------------------------------------

class ExtrasRequest(BaseModel):
    video_id: str

MAX_CUES = 6000
CAPTION_FETCH_TIMEOUT_S = 15

def caption_track(info):
    """The captions in the video's own language: the creator's own first, else YouTube's speech recognition of the
    original audio ("<lang>-orig"; plain "<lang>" in automatic_captions can be a machine translation)."""
    lang = info.get('language')
    subs = info.get('subtitles') or {}
    auto = info.get('automatic_captions') or {}
    candidates = []
    if lang:
        candidates += [(subs.get(lang), False), (auto.get(f'{lang}-orig'), True), (auto.get(lang), True)]
    candidates += [(subs[k], False) for k in subs if k != 'live_chat']
    candidates += [(auto[k], True) for k in auto if k.endswith('-orig')]
    for tracks, is_auto in candidates:
        for track in tracks or []:
            if track.get('ext') == 'json3' and track.get('url'):
                return track['url'], is_auto
    return None, False

def compact_cues(data):
    """json3 (one event per caption window, ~500KB for half an hour) -> short sentences with a start time, ~10x smaller.
    Lines are joined until a sentence ends, ~8s pass, or the line gets long, so the transcript reads like text."""
    cues = []
    current = None
    for event in data.get('events') or []:
        segs = event.get('segs')
        if not segs:
            continue
        text = ''.join(seg.get('utf8', '') for seg in segs).replace('\n', ' ').strip()
        if not text:
            continue
        start = (event.get('tStartMs') or 0) / 1000
        if current and start - current['s'] < 8 and len(current['t']) < 160 and not current['t'].endswith(('.', '?', '!')):
            current['t'] += ' ' + text
        else:
            current = {'s': round(start, 1), 't': text}
            cues.append(current)
            if len(cues) >= MAX_CUES:
                break
    return cues

@app.post("/extras")
def episode_extras(req: ExtrasRequest):
    # One extraction for both, through the same clients as /resolve; the caption file itself is a plain GET.
    token = threading.get_ident()
    with _state_lock:
        _inflight[token] = time.time()
    try:
        info = None
        order = [attempt for attempt in attempts_for(req.video_id) if enough_memory_for(CLIENT_ATTEMPTS[attempt])]
        for position, attempt in enumerate(order):
            try:
                info = extract(req.video_id, format_selector('low', 'audio'), CLIENT_ATTEMPTS[attempt])
                break
            except Exception:
                if position == len(order) - 1:
                    raise
        chapters = [
            {'title': c.get('title') or '', 'start': round(c.get('start_time') or 0, 1)}
            for c in (info.get('chapters') or [])
        ]
        transcript = None
        url, is_auto = caption_track(info)
        if url:
            try:
                request = urllib.request.Request(url, headers=info.get('http_headers') or {})
                body = urllib.request.urlopen(request, timeout=CAPTION_FETCH_TIMEOUT_S).read()
                cues = compact_cues(json.loads(body)) if body else []
                if cues:
                    transcript = {'lang': info.get('language'), 'auto': is_auto, 'cues': cues}
            except Exception as e:
                logger.warning(f"{req.video_id}: captions failed ({str(e)[:160]})")
        return {'duration': info.get('duration'), 'chapters': chapters, 'transcript': transcript}
    except Exception as e:
        logger.error(f"yt-dlp failed to read extras for {req.video_id}: {str(e)}")
        raise HTTPException(status_code=502, detail=str(e))
    finally:
        with _state_lock:
            _inflight.pop(token, None)
