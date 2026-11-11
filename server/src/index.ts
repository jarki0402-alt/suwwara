import cors from 'cors';
import express from 'express';
import { migrate } from './db/client';
import { loadJamRooms } from './jam/roomStore';
import { pruneAuthTables } from './auth/audit';
import { requireSession } from './auth/sessions';
import { bootstrapAdmin } from './auth/users';
import { sessionRouter } from './routes/session';
import { pruneLyricsCache } from './youtube/lyrics';
import { startResolveWarmer } from './youtube/resolveWarmer';
import { artistRouter } from './routes/artist';
import { connectRouter } from './routes/connect';
import { diagnosticsRouter } from './routes/diagnostics';
import { audioRouter } from './routes/audio';
import { videoRouter } from './routes/video';
import { authRouter } from './routes/auth';
import { browseRouter } from './routes/browse';
import { detailsRouter } from './routes/details';
import { jamRouter } from './routes/jam';
import { libraryRouter } from './routes/library';
import { spotifyImportRouter } from './routes/spotifyImport';
import { podcastRouter } from './routes/podcast';
import { pruneEpisodeExtras } from './podcast/extras';
import { kickImportWorker, pruneImports } from './importer/importWorker';
import { adminRouter } from './routes/admin';
import { linkRouter } from './routes/link';
import { profileRouter } from './routes/profile';
import { lyricsRouter } from './routes/lyrics';
import { searchRouter } from './routes/search';
import { similarRouter } from './routes/similar';
import { trendingRouter } from './routes/trending';
import { trendingIdRouter } from './routes/trendingId';
import { usageRouter } from './routes/usage';
import { adminStatsRouter } from './routes/adminStats';
import './metrics/systemSamples';

const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.use(cors());
// 1mb: a profile snapshot or a Spotify import's track list is well past the 100kb default and would be refused.
// The library snapshot gets more: a Spotify import puts a whole library in it at once (~0.9KB a song, so 1000 songs
// imported into likes and playlists is already over 1mb). 8mb parses to tens of MB for a moment, once per save, so it is
// parsed only after requireSession: nobody signed out gets to make this VM read 8mb.
const jsonDefault = express.json({ limit: '1mb' });
const jsonLibrary = express.json({ limit: '8mb' });
app.use((req, res, next) => (req.path === '/api/library' ? next() : jsonDefault(req, res, next)));
// Sign-in lives outside the gate; everything registered after requireSession needs a valid session cookie.
app.use('/api', sessionRouter);
app.use('/api', requireSession);
app.use('/api/library', jsonLibrary);
app.use('/api', searchRouter);
app.use('/api', detailsRouter);
app.use('/api', lyricsRouter);
app.use('/api', audioRouter);
app.use('/api', videoRouter);
app.use('/api', trendingRouter);
app.use('/api', trendingIdRouter);
app.use('/api', similarRouter);
app.use('/api', browseRouter);
app.use('/api', jamRouter);
// artistRouter deliberately registered before authRouter/libraryRouter: those
// two mount deviceAuth via `router.use(deviceAuth)` with no path restriction,
// which — since Express tries mounted routers in registration order, and a
// middleware that responds (401, no Authorization header) never calls next()
// to let a *later* router see the request — would otherwise swallow every
// request to any router registered after them, not just their own /library
// routes. artistRouter has no auth requirement of its own, so it needs to be
// registered before that middleware ever gets a chance to intercept it.
app.use('/api', artistRouter);
// linkRouter applies deviceAuth per route (not router-wide), so it is safe ahead of authRouter/libraryRouter.
app.use('/api', linkRouter);
// Per-route deviceAuth like linkRouter, so it is safe ahead of authRouter/libraryRouter.
app.use('/api', spotifyImportRouter);
// Same: deviceAuth (or requireAdmin for /admin/podcast/*) per route, so its place among the routers doesn't matter.
app.use('/api', podcastRouter);
app.use('/api', connectRouter);
app.use('/api', diagnosticsRouter);
// Session cookie only (no deviceAuth), so like diagnostics it is safe anywhere ahead of authRouter/libraryRouter.
app.use('/api', usageRouter);
// Like the routers above, profile (and admin) must sit BEFORE authRouter/libraryRouter, whose router-wide deviceAuth would
// otherwise answer 401 for them.
app.use('/api', profileRouter);
// Ahead of adminRouter: its /admin/usage is the one answered (requireAdmin path-scoped, like adminRouter's).
app.use('/api', adminStatsRouter);
app.use('/api', adminRouter);
app.use('/api', authRouter);
app.use('/api', libraryRouter);

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'suwwara-music-backend' });
});

async function start(): Promise<void> {
  await migrate();
  // Before listening: a device reconnecting the moment the server is back must find its room, not a 404 that ends it.
  await loadJamRooms();
  await bootstrapAdmin();
  void pruneAuthTables();
  void pruneLyricsCache();
  startResolveWarmer();
  // Resumes an import that was still matching when the process stopped.
  void pruneImports().then(kickImportWorker);
  void pruneEpisodeExtras();
  app.listen(PORT, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Suwwara music backend listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start: could not reach/migrate Postgres.', error);
  process.exit(1);
});
