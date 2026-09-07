import cors from 'cors';
import express from 'express';
import { migrate } from './db/client';
import { audioRouter } from './routes/audio';
import { authRouter } from './routes/auth';
import { browseRouter } from './routes/browse';
import { detailsRouter } from './routes/details';
import { jamRouter } from './routes/jam';
import { libraryRouter } from './routes/library';
import { searchRouter } from './routes/search';
import { similarRouter } from './routes/similar';
import { trendingRouter } from './routes/trending';

const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.use(cors());
app.use(express.json());
app.use('/api', searchRouter);
app.use('/api', detailsRouter);
app.use('/api', audioRouter);
app.use('/api', trendingRouter);
app.use('/api', similarRouter);
app.use('/api', browseRouter);
app.use('/api', jamRouter);
app.use('/api', authRouter);
app.use('/api', libraryRouter);

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'suwwara-music-backend' });
});

async function start(): Promise<void> {
  await migrate();
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
