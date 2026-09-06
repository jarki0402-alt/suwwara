import cors from 'cors';
import express from 'express';
import { audioRouter } from './routes/audio';
import { browseRouter } from './routes/browse';
import { detailsRouter } from './routes/details';
import { jamRouter } from './routes/jam';
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

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'suwwara-music-backend' });
});

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Suwwara music backend listening on http://0.0.0.0:${PORT}`);
});
