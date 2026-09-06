# ---- build: compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app

# yt-dlp is pure Python (no compiled C-extension wheels), so Alpine's musl libc
# causes no compatibility issues here. ffmpeg is deliberately NOT installed:
# this backend only resolves a direct CDN URL and proxies the bytes as-is
# (see src/youtube/stream.ts and src/routes/audio.ts) — it never invokes
# yt-dlp's own download/remux pipeline, so ffmpeg would be dead weight.
# py3-pip is removed after install to keep the final image lean; the already-
# installed yt-dlp package only needs the python3 interpreter to run, not pip.
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp && \
    apk del py3-pip

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8787/', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
