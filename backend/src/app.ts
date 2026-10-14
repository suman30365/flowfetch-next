import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health';
import { analyzeRouter } from './routes/analyze';
import { downloadRouter } from './routes/download';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// ── Trust Proxy Configuration ────────────────────────────────────────────────
// Render runs 1 reverse proxy hop in front of the container.
// Setting trust proxy to 1 safely trusts the immediate reverse proxy hop,
// allowing Express to extract the true client IP for rate limiting and logging
// without blindly trusting arbitrary spoofed X-Forwarded-For headers or triggering
// express-rate-limit's ERR_ERL_UNEXPECTED_X_FORWARDED_FOR validation error.
const trustProxyHops = process.env.TRUST_PROXY
  ? (Number.isInteger(Number(process.env.TRUST_PROXY)) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY)
  : 1;
app.set('trust proxy', trustProxyHops);

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
