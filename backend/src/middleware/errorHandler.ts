import { Request, Response, NextFunction } from 'express';

/**
 * Global Express error handler.
 * Catches anything passed via next(err).
 * Logs diagnostic details server-side; sends only a safe message to client.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Never log cookies, auth headers, or secrets
  console.error('[errorHandler]', err.message);

  if (res.headersSent) return;

  res.status(500).json({
    error: 'internal_error',
    message: 'An unexpected error occurred.',
  });
}
