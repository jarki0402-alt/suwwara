import cors from 'cors';
import express from 'express';
import { migrate } from './db/client';
import { pruneAuthTables } from './auth/audit';
import { requireSession } from './auth/sessions';
import { bootstrapAdmin } from './auth/users';
import { sessionRouter } from './routes/session';
import { pruneLyricsCache } from './youtube/lyrics';
import { artistRouter } from './routes/artist';
import { connectRouter } from './routes/connect';
import { audioRouter } from './routes/audio';
import { authRouter } from './routes/auth';
import { browseRouter } from './routes/browse';
import { detailsRouter } from './routes/details';
import { jamRouter } from './routes/jam';
import { libraryRouter } from './routes/library';
import { linkRouter } from './routes/link';
import { lyricsRouter } from './routes/lyrics';
import { searchRouter } from './routes/search';
import { similarRouter } from './routes/similar';
import { trendingRouter } from './routes/trending';
import { trendingIdRouter } from './routes/trendingId';

const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.use(cors());
app.use(express.json());
// Sign-in lives outside the gate; everything registered after requireSession needs a valid session cookie.
app.use('/api', sessionRouter);
app.use('/api', requireSession);
app.use('/api', searchRouter);
app.use('/api', detailsRouter);
app.use('/api', lyricsRouter);
app.use('/api', audioRouter);
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
app.use('/api', connectRouter);
app.use('/api', authRouter);
app.use('/api', libraryRouter);

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'suwwara-music-backend' });
});

async function start(): Promise<void> {
  await migrate();
  await bootstrapAdmin();
  void pruneAuthTables();
  void pruneLyricsCache();
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
