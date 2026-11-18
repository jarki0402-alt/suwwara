FROM python:3.11-alpine

# Node.js is required by yt-dlp to evaluate YouTube's N-signatures
RUN apk add --no-cache nodejs

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# yt-dlp follows YouTube's changes, so it is always the latest at build time. The PO token plugin is NOT upgraded
# here: it must stay the exact version of the bgutil-provider container (requirements.txt, docker-compose.yml). A
# mismatch silently kills the tokens and YouTube then hands out 360p video files as "audio" (2026-11).
# [default] brings yt-dlp-ejs, the script Node runs to solve YouTube's JavaScript challenges, pinned by yt-dlp to the
# version it expects. Without it (plain `yt-dlp` since late 2025) every web client came back with no formats: the
# web fallback after visionos silently ended at android/ios's 360p video, and the backup account (web clients only,
# visionos takes no cookies) never got audio at all (found 2026-11-18).
RUN pip install --no-cache-dir -U "yt-dlp[default]"

COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
