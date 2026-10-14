import 'dotenv/config';
import app from './app';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`[FlowFetch] Backend listening on http://${HOST}:${PORT}`);
  console.log(`[FlowFetch] Environment: ${process.env.NODE_ENV ?? 'development'}`);
});

// Configure timeouts for large media streaming and preparation (10 minutes)
server.headersTimeout = 10 * 60 * 1000;
server.requestTimeout = 10 * 60 * 1000;
server.keepAliveTimeout = 65_000;

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`[FlowFetch] ${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log('[FlowFetch] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10 s
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
