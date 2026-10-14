import { describe, it, expect } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { createLimiter } from '../../middleware/rateLimiter';
import app from '../../app';

describe('Express Trust Proxy & Rate Limiter Configuration', () => {
  it('app has trust proxy set to 1 for Render proxy topology', () => {
    expect(app.get('trust proxy')).toBe(1);
  });

  it('handles X-Forwarded-For through trusted proxy without ERR_ERL_UNEXPECTED_X_FORWARDED_FOR', async () => {
    const testApp = express();
    testApp.set('trust proxy', 1);

    const limiter = createLimiter({
      max: 2,
      windowMs: 60_000,
      message: 'Too many test requests.',
    });

    testApp.use('/test-rate-limit', limiter, (req: Request, res: Response) => {
      res.json({ ip: req.ip, success: true });
    });

    // Client IP 203.0.113.195 behind 1 proxy hop
    const res1 = await request(testApp)
      .get('/test-rate-limit')
      .set('X-Forwarded-For', '203.0.113.195')
      .set('x-test-rate-limit', 'true');

    expect(res1.status).toBe(200);
    expect(res1.body.ip).toBe('203.0.113.195');

    const res2 = await request(testApp)
      .get('/test-rate-limit')
      .set('X-Forwarded-For', '203.0.113.195')
      .set('x-test-rate-limit', 'true');

    expect(res2.status).toBe(200);

    // 3rd request from same client exceeds limit (max: 2)
    const res3 = await request(testApp)
      .get('/test-rate-limit')
      .set('X-Forwarded-For', '203.0.113.195')
      .set('x-test-rate-limit', 'true');

    expect(res3.status).toBe(429);
    expect(res3.body.error).toBe('rate_limit_exceeded');
    expect(res3.body.message).toBe('Too many test requests.');

    // A different client IP is NOT blocked
    const resOtherClient = await request(testApp)
      .get('/test-rate-limit')
      .set('X-Forwarded-For', '198.51.100.42')
      .set('x-test-rate-limit', 'true');

    expect(resOtherClient.status).toBe(200);
    expect(resOtherClient.body.ip).toBe('198.51.100.42');
  });
});
