# ── Stage 1: Build TypeScript Application ─────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy package manifests for deterministic dependency installation
COPY package*.json ./

# Install all dependencies (including devDependencies required for tsc compilation)
RUN npm ci

# Copy TypeScript configuration and source files
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to JavaScript in dist/
RUN npm run build

# Remove development dependencies to keep the production layer minimal
RUN npm prune --omit=dev

# ── Stage 2: Production Runtime ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

# Avoid interactive prompts during apt package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install runtime system packages:
# - python3: required runtime for yt-dlp
# - ffmpeg: required for merging separate video and audio streams
# - ca-certificates: required for secure HTTPS communication
# - curl: required for downloading yt-dlp and container health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    ca-certificates \
    curl \
 && rm -rf /var/lib/apt/lists/*

# Download and install the latest official yt-dlp standalone binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && yt-dlp --version

WORKDIR /app

# Production environment defaults (Render injects PORT at runtime)
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV TMP_DIR=/tmp/flowfetch

# Create temporary working directory for media merging and assign ownership to node user
RUN mkdir -p /tmp/flowfetch && chown -R node:node /tmp/flowfetch /app

# Copy production node_modules from builder stage
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# Copy compiled application code and package manifest
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Switch to standard unprivileged node user for security
USER node

# Expose default port (overridden by Render via PORT env var)
EXPOSE 3001

# Container healthcheck targeting the dedicated /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

# Start the compiled Express server
CMD ["node", "dist/index.js"]
