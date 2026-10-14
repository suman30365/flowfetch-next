import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health';
import { analyzeRouter } from './routes/analyze';
import { downloadRouter } from './routes/download';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g. curl, server-to-server, or same-origin)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes('*')) return cb(null, true);
      const normalizedOrigin = origin.replace(/\/+$/, '');
      const isAllowed = allowedOrigins.some(
        (o) => o.replace(/\/+$/, '') === normalizedOrigin,
      );
      if (isAllowed) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST'],
  }),
);

// ── Body parsing (limit to 10 KB — no file uploads here) ─────────────────────
app.use(express.json({ limit: '10kb' }));

import { analyzeLimiter } from './middleware/rateLimiter';

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/api/health', healthRouter);
app.use('/api/analyze', analyzeLimiter, analyzeRouter);
app.use('/api/download', downloadRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Route not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
