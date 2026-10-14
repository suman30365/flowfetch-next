# FlowFetch Next

A clean, minimal YouTube video downloader — React + Vite frontend, Node.js + Express backend, yt-dlp extraction.

> **Scope:** YouTube only. No other platforms are claimed or tested.  
> **Legal:** Only download videos you are authorized to download. Respect YouTube's Terms of Service and copyright law.

---

## Prerequisites

| Tool | Version | Windows install |
|------|---------|-----------------|
| Node.js | ≥ 18 LTS | https://nodejs.org |
| npm | ≥ 9 | bundled with Node |
| yt-dlp | latest | `winget install yt-dlp.yt-dlp` or https://github.com/yt-dlp/yt-dlp/releases |
| FFmpeg | ≥ 6 | `winget install Gyan.FFmpeg` or https://ffmpeg.org/download.html |

After installing yt-dlp and ffmpeg, verify they are on your `PATH`:

```powershell
yt-dlp --version
ffmpeg -version
```

---

## Quick Start (Windows PowerShell)

### 1. Clone / unzip the project

```powershell
cd S:\PROJECT\Downloader
```

### 2. Install backend dependencies

```powershell
cd backend
npm install
cd ..
```

### 3. Install frontend dependencies

```powershell
cd frontend
npm install
cd ..
```

### 4. Configure environment

The backend ships with a working `.env` for local development (no secrets needed):

```powershell
# backend/.env is already present with safe defaults.
# Edit only if you need custom ports or binary paths.
notepad backend\.env
```

### 5. Start the backend (Terminal 1)

```powershell
cd backend
npm run dev
# → http://localhost:3001
```

### 6. Start the frontend (Terminal 2)

```powershell
cd frontend
npm run dev
# → http://localhost:5173
```

Open http://localhost:5173 in your browser.

---

## Environment Variables

All variables are in `backend/.env`. See `.env.example` for full documentation.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend HTTP port |
| `NODE_ENV` | `development` | `development` or `production` |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated CORS origins |
| `MAX_CONCURRENT_JOBS` | `3` | Max simultaneous yt-dlp processes |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | `20` | Max requests per window |
| `YTDLP_PATH` | `yt-dlp` | Binary name or absolute path |
| `FFMPEG_PATH` | `ffmpeg` | Binary name or absolute path |
| `TMP_DIR` | OS temp dir | Temp dir for merging |
| `ANALYZE_TIMEOUT_MS` | `30000` | Analyze timeout (ms) |
| `DOWNLOAD_TIMEOUT_MS` | `300000` | Download timeout (ms) |

---

## Commands Reference

### Backend

```powershell
cd backend
npm run dev          # Dev server with auto-reload (tsx watch)
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled output
npm test             # Run unit tests (no internet required)
npm run test:unit    # Verbose unit tests only
npm run test:integration  # Live YouTube tests (requires internet + yt-dlp)
npm run typecheck    # Type-check without emitting
```

### Frontend

```powershell
cd frontend
npm run dev          # Vite dev server on :5173
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
npm run typecheck    # Type-check without emitting
```

---

## Running Tests

### Unit tests (offline, no yt-dlp required)

```powershell
cd backend
npm test
```

Expected output: all tests in `src/tests/unit/` pass.

### Integration tests (requires internet + yt-dlp)

```powershell
cd backend
npm run test:integration
```

Uses the first YouTube video ever uploaded (`jNQXAC9IVRw`) as the test fixture.

---

## Smoke-Test Checklist

Run these manually after starting both servers:

```
[ ] GET  http://localhost:3001/api/health       → { "status": "ok" }
[ ] POST /api/analyze  { "url": "" }            → 400 invalid_url
[ ] POST /api/analyze  { "url": "https://localhost/watch?v=dQw4w9WgXcQ" } → 400 invalid_url
[ ] POST /api/analyze  { "url": "https://vimeo.com/123" }  → 400 unsupported_url
[ ] POST /api/analyze  { "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw" }
    → 200 with title, formats array (requires internet + yt-dlp)
[ ] POST /api/download { "url": "...", "formatId": "; rm -rf /" } → 400 unsupported_format
[ ] Full UI flow: paste URL → Analyze → select format → Download → file appears in browser
```

---

## Project Structure

```
Downloader/
├── .env.example          ← Document all env vars (safe to commit)
├── .gitignore
├── README.md
│
├── backend/
│   ├── .env              ← Local dev values (gitignored)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts          ← Server entry point
│       ├── app.ts            ← Express app factory
│       ├── types.ts          ← Shared API types & error codes
│       ├── routes/
│       │   ├── health.ts
│       │   ├── analyze.ts
│       │   └── download.ts
│       ├── services/
│       │   ├── ytdlp.ts      ← yt-dlp child-process wrapper
│       │   └── jobQueue.ts   ← Concurrency limiter
│       ├── middleware/
│       │   └── errorHandler.ts
│       ├── utils/
│       │   ├── urlValidator.ts   ← URL allow-listing & SSRF prevention
│       │   ├── filename.ts       ← Safe filename sanitization
│       │   └── errorMapper.ts    ← yt-dlp error → AppErrorCode
│       └── tests/
│           ├── unit/
│           │   ├── urlValidator.test.ts
│           │   ├── filename.test.ts
│           │   ├── errorMapper.test.ts
│           │   └── api.test.ts       ← supertest API tests
│           └── integration/
│               └── ytdlp.integration.test.ts
│
└── frontend/
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx        ← Single-page UI
        ├── api.ts         ← Fetch client
        ├── types.ts       ← Frontend type mirrors
        └── index.css      ← Design system
```

---

## Security Notes

- URLs are validated against an allow-list (HTTPS + YouTube hosts only).
- Private/loopback IPs are blocked (SSRF prevention).
- Format IDs are validated against a strict regex before being passed to yt-dlp.
- No shell interpolation — yt-dlp is spawned via `spawn()` with an array of arguments.
- Filenames are sanitised to prevent path traversal.
- No cookies, credentials, or auth headers are logged.
- Temporary files are deleted on completion, failure, timeout, and client disconnect.

---

## Deployment Readiness Checklist

```
[ ] Set NODE_ENV=production in backend .env
[ ] Set ALLOWED_ORIGINS to your production frontend domain
[ ] Confirm yt-dlp and ffmpeg are installed on the server
[ ] Add a process manager (PM2 / systemd) for the backend
[ ] Put a reverse proxy (nginx / Caddy) in front of the backend
[ ] Enable HTTPS on the reverse proxy
[ ] Review and tighten rate limits for production traffic
[ ] Set up log rotation for server logs
[ ] Build the frontend: cd frontend && npm run build
[ ] Serve frontend/dist/ from the reverse proxy or a CDN
```

---

## Known Limitations

- YouTube only — other platforms are not tested or supported.
- No cookies / auth — age-restricted and sign-in-required videos will fail.
- No playlist support — video IDs must be supplied individually.
- No resumable downloads — interrupted downloads must restart.
- Downloads stream directly via native browser attachments without buffering in frontend memory.
