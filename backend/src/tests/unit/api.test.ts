import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../../app';
import * as ytdlpService from '../../services/ytdlp';

// Mock downloadFormat so tests don't spawn background yt-dlp child processes
vi.spyOn(ytdlpService, 'downloadFormat').mockImplementation(() => new Promise(() => {}));

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('POST /api/analyze — validation', () => {
  it('returns 400 for missing URL', async () => {
    const res = await request(app).post('/api/analyze').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_url');
  });

  it('returns 400 for empty URL string', async () => {
    const res = await request(app).post('/api/analyze').send({ url: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_url');
  });

  it('returns 400 for http:// URL', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ url: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_url');
  });

  it('returns 400 for localhost URL (SSRF)', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ url: 'https://localhost/watch?v=dQw4w9WgXcQ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_url');
  });

  it('returns 400 for unsupported host', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ url: 'https://vimeo.com/123456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_url');
  });

  it('returns 400 for YouTube channel URL (no video ID)', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ url: 'https://www.youtube.com/channel/UCxxxxx' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_url');
  });
});

describe('POST /api/download — validation', () => {
  it('returns 400 for missing URL', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ formatId: '137', streamType: 'video+audio' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_url');
  });

  it('returns 400 for missing formatId', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', streamType: 'video+audio' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_format');
  });

  it('returns 400 for missing streamType', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', formatId: '137' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_format');
  });

  it('returns 400 for invalid streamType value', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        formatId: '137',
        streamType: 'bogus',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_format');
  });

  it('returns 400 for invalid formatId (injection attempt)', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        formatId: '; rm -rf /',
        streamType: 'video+audio',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_format');
  });

  it('returns 400 for formatId with path traversal', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        formatId: '../../etc/passwd',
        streamType: 'video+audio',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_format');
  });
});

describe('GET /api/download/file/:jobId — file streaming & security', () => {
  it('returns 404 for nonexistent job ID', async () => {
    const res = await request(app).get('/api/download/file/00000000-0000-0000-0000-000000000000?token=abc');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('returns 403 when token is missing', async () => {
    const { readyJobs } = await import('../../routes/download');
    const testId = 'test-job-missing-token';
    readyJobs.set(testId, {
      jobId: testId,
      token: 'secret-token-123',
      filePath: 'nonexistent.mp4',
      filename: 'video.mp4',
      ext: 'mp4',
      size: 1000,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });

    const res = await request(app).get(`/api/download/file/${testId}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('unauthorized');
    readyJobs.delete(testId);
  });

  it('returns 403 when token does not match', async () => {
    const { readyJobs } = await import('../../routes/download');
    const testId = 'test-job-wrong-token';
    readyJobs.set(testId, {
      jobId: testId,
      token: 'secret-token-123',
      filePath: 'nonexistent.mp4',
      filename: 'video.mp4',
      ext: 'mp4',
      size: 1000,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });

    const res = await request(app).get(`/api/download/file/${testId}?token=wrong-token`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('unauthorized');
    readyJobs.delete(testId);
  });

  it('returns 410 when download link has expired', async () => {
    const { readyJobs } = await import('../../routes/download');
    const testId = 'test-job-expired';
    readyJobs.set(testId, {
      jobId: testId,
      token: 'valid-token',
      filePath: 'nonexistent.mp4',
      filename: 'video.mp4',
      ext: 'mp4',
      size: 1000,
      createdAt: Date.now() - 100000,
      expiresAt: Date.now() - 1000, // already expired
    });

    const res = await request(app).get(`/api/download/file/${testId}?token=valid-token`);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('link_expired');
    readyJobs.delete(testId);
  });

  it('streams file with attachment header when job and token are valid', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const { readyJobs } = await import('../../routes/download');

    // Create a temporary dummy file
    const tmpFile = path.join(os.tmpdir(), `test-stream-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, 'dummy video payload content');
    const stat = fs.statSync(tmpFile);

    const testId = `test-valid-${Date.now()}`;
    const token = 'correct-secure-token';

    readyJobs.set(testId, {
      jobId: testId,
      token,
      filePath: tmpFile,
      filename: 'My Cool Video.mp4',
      ext: 'mp4',
      size: stat.size,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });

    const res = await request(app).get(`/api/download/file/${testId}?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment;\s*filename="My Cool Video\.mp4"/);
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['content-length']).toBe(stat.size.toString());
    const textContent = Buffer.isBuffer(res.body) ? res.body.toString('utf-8') : (res.text ?? '');
    expect(textContent).toBe('dummy video payload content');

    // Clean up if not already cleaned
    try { fs.rmSync(tmpFile, { force: true }); } catch {}
    readyJobs.delete(testId);
  });
});

describe('POST /api/download — immediate reservation and deduplication', () => {
  it('immediately reserves a download job and returns processing status with stable downloadUrl', async () => {
    const res = await request(app)
      .post('/api/download')
      .send({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        formatId: '137',
        streamType: 'video',
        title: 'Rick Astley - Never Gonna Give You Up',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processing');
    expect(typeof res.body.jobId).toBe('string');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.downloadUrl).toBe(`/api/download/file/${res.body.jobId}?token=${res.body.token}`);
    expect(res.body.filename).toContain('Rick_Astley');

    const firstJobId = res.body.jobId;

    // Deduplication check: repeated immediate request returns the existing job
    const repeatRes = await request(app)
      .post('/api/download')
      .send({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        formatId: '137',
        streamType: 'video',
        title: 'Rick Astley - Never Gonna Give You Up',
      });

    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.jobId).toBe(firstJobId);
  });
});

describe('GET /api/download/status/:jobId — status polling', () => {
  it('returns 404 for unknown job ID', async () => {
    const res = await request(app).get('/api/download/status/nonexistent-id?token=test');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('returns 403 for invalid token', async () => {
    const { jobs } = await import('../../routes/download');
    const { EventEmitter } = await import('events');
    const testId = `test-status-${Date.now()}`;
    const token = 'correct-token';

    jobs.set(testId, {
      jobId: testId,
      token,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      formatId: '137',
      streamType: 'video',
      title: 'Test',
      expectedFilename: 'Test.mp4',
      status: 'processing',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
      emitter: new EventEmitter(),
      abortController: new AbortController(),
      activeGetRequests: 0,
    });

    const res = await request(app).get(`/api/download/status/${testId}?token=wrong-token`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('unauthorized');

    jobs.delete(testId);
  });

  it('returns current processing status and details when authorized', async () => {
    const { jobs } = await import('../../routes/download');
    const { EventEmitter } = await import('events');
    const testId = `test-status-ok-${Date.now()}`;
    const token = 'correct-token';

    jobs.set(testId, {
      jobId: testId,
      token,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      formatId: '137',
      streamType: 'video',
      title: 'Status Test',
      expectedFilename: 'Status Test.mp4',
      status: 'processing',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
      emitter: new EventEmitter(),
      abortController: new AbortController(),
      activeGetRequests: 0,
    });

    const res = await request(app).get(`/api/download/status/${testId}?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processing');
    expect(res.body.jobId).toBe(testId);
    expect(res.body.filename).toBe('Status Test.mp4');

    jobs.delete(testId);
  });
});

describe('Pending GET download request handling', () => {
  it('keeps GET request pending until job finishes and streams the completed file', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const { EventEmitter } = await import('events');
    const { jobs } = await import('../../routes/download');

    const testId = `pending-test-${Date.now()}`;
    const token = 'pending-token';
    const emitter = new EventEmitter();

    const job = {
      jobId: testId,
      token,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      formatId: '137',
      streamType: 'video' as const,
      title: 'Pending Stream Test',
      expectedFilename: 'Pending Stream Test.mp4',
      status: 'processing' as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
      emitter,
      abortController: new AbortController(),
      activeGetRequests: 0,
      filePath: '',
      filename: '',
      size: 0,
    };
    jobs.set(testId, job);

    // Fire GET request asynchronously (supertest starts request upon .then)
    const requestPromise = request(app).get(`/api/download/file/${testId}?token=${token}`).then((r) => r);

    // Wait until the GET request connection is active and registered on emitter
    while (emitter.listenerCount('ready') === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // Create completed file and signal ready
    const tmpFile = path.join(os.tmpdir(), `pending-completed-${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, 'completed pending payload');
    const stat = fs.statSync(tmpFile);

    job.status = 'ready' as any;
    job.filePath = tmpFile;
    job.filename = 'Pending Stream Test.mp4';
    job.size = stat.size;

    emitter.emit('ready', job);

    const res = await requestPromise;
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment;\s*filename="Pending Stream Test\.mp4"/);
    const content = Buffer.isBuffer(res.body) ? res.body.toString('utf-8') : (res.text ?? '');
    expect(content).toBe('completed pending payload');

    try { fs.rmSync(tmpFile, { force: true }); } catch {}
    jobs.delete(testId);
  });

  it('delivers JSON error if preparation fails while GET request is pending', async () => {
    const { EventEmitter } = await import('events');
    const { jobs } = await import('../../routes/download');

    const testId = `pending-err-${Date.now()}`;
    const token = 'pending-err-token';
    const emitter = new EventEmitter();
    emitter.on('error', () => {});

    const job = {
      jobId: testId,
      token,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      formatId: '137',
      streamType: 'video' as const,
      title: 'Pending Error Test',
      expectedFilename: 'Pending Error Test.mp4',
      status: 'processing' as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
      emitter,
      abortController: new AbortController(),
      activeGetRequests: 0,
    };
    jobs.set(testId, job);

    const requestPromise = request(app).get(`/api/download/file/${testId}?token=${token}`).then((r) => r);

    // Wait until the GET request connection is active and registered on emitter
    while (emitter.listenerCount('ready') === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // Emit error event
    emitter.emit('error', {
      error: 'upstream_rejected',
      message: 'YouTube rejected video due to geo-restriction',
      statusCode: 422,
    });

    const res = await requestPromise;
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('upstream_rejected');
    expect(res.body.message).toContain('geo-restriction');

    jobs.delete(testId);
  });
});

describe('POST /api/download/cancel/:jobId', () => {
  it('cancels processing job and marks status cancelled', async () => {
    const { EventEmitter } = await import('events');
    const { jobs } = await import('../../routes/download');

    const testId = `cancel-test-${Date.now()}`;
    const token = 'cancel-token';
    const emitter = new EventEmitter();
    emitter.on('error', () => {});

    const job = {
      jobId: testId,
      token,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      formatId: '137',
      streamType: 'video' as const,
      title: 'Cancel Test',
      expectedFilename: 'Cancel Test.mp4',
      status: 'processing' as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
      emitter,
      abortController: new AbortController(),
      activeGetRequests: 0,
    };
    jobs.set(testId, job);

    const res = await request(app)
      .post(`/api/download/cancel/${testId}`)
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(jobs.has(testId)).toBe(false);
  });
});

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('Rate limiting and bucket isolation', () => {
  it('status polling does not exhaust the analyze request allowance (isolated buckets)', async () => {
    const { jobs } = await import('../../routes/download');
    const jobId = `rate-poll-${Date.now()}`;
    const token = 'poll-token-123';

    jobs.set(jobId, {
      jobId,
      token,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      formatId: '137',
      streamType: 'video',
      title: 'Poll Test',
      expectedFilename: 'Poll Test.mp4',
      status: 'processing',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
      emitter: new (await import('events')).EventEmitter(),
      abortController: new AbortController(),
      activeGetRequests: 0,
    });

    // Simulate 25 rapid status polling requests (which previously broke the global 20-request limit)
    for (let i = 0; i < 25; i++) {
      const statusRes = await request(app)
        .get(`/api/download/status/${jobId}?token=${token}`)
        .set('x-test-rate-limit', 'true');
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe('processing');
    }

    // Now send an analyze request with rate limiting active
    // It must NOT be rate limited (429) — it should reach URL validation (400 for bad URL)
    const analyzeRes = await request(app)
      .post('/api/analyze')
      .set('x-test-rate-limit', 'true')
      .send({ url: 'not-a-valid-url' });

    expect(analyzeRes.status).toBe(400);
    expect(analyzeRes.body.error).toBe('invalid_url');
    expect(analyzeRes.status).not.toBe(429);

    // Health endpoint must also remain completely reachable
    const healthRes = await request(app)
      .get('/api/health')
      .set('x-test-rate-limit', 'true');
    expect(healthRes.status).toBe(200);

    jobs.delete(jobId);
  });

  it('enforces rate limits with HTTP 429, Retry-After header, and structured JSON', async () => {
    const express = (await import('express')).default;
    const { createLimiter } = await import('../../middleware/rateLimiter');

    const testApp = express();
    const testLimiter = createLimiter({
      max: 2,
      windowMs: 30000,
      message: 'Too many test requests — please wait.',
    });

    testApp.use('/test-endpoint', testLimiter, (_req, res) => {
      res.json({ ok: true });
    });

    // 1st request -> 200
    const res1 = await request(testApp)
      .get('/test-endpoint')
      .set('x-test-rate-limit', 'true');
    expect(res1.status).toBe(200);

    // 2nd request -> 200
    const res2 = await request(testApp)
      .get('/test-endpoint')
      .set('x-test-rate-limit', 'true');
    expect(res2.status).toBe(200);

    // 3rd request -> 429
    const res3 = await request(testApp)
      .get('/test-endpoint')
      .set('x-test-rate-limit', 'true');
    expect(res3.status).toBe(429);
    expect(res3.body.error).toBe('rate_limit_exceeded');
    expect(res3.body.message).toBe('Too many test requests — please wait.');
    expect(typeof res3.body.retryAfter).toBe('number');
    expect(res3.body.retryAfter).toBeGreaterThan(0);
    expect(res3.headers['retry-after']).toBeDefined();
  });
});


