# =============================================================================
# BucketCode — WebSocket Backend (Relay) Image
# =============================================================================
# The WS relay server sits between browser clients and runner pods.
# It handles JWT authentication, rate limiting, connection tracking,
# and proxies WebSocket messages to/from the correct runner pod.
#
# Build:
#   docker build -t bucketcode/ws-backend:v1 -f infra/docker/ws-backend.Dockerfile .
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Install & Build
# ---------------------------------------------------------------------------
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Native build tools for node-pty (transitive workspace dep via apps/runner)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace root manifests
COPY package.json bun.lock ./

# Copy ALL workspace package.json files so the lockfile stays consistent
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/typescript-config/ ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/ui/package.json ./packages/ui/
COPY apps/http-backend/package.json ./apps/http-backend/
COPY apps/orchestrator/package.json ./apps/orchestrator/
COPY apps/runner/package.json ./apps/runner/
COPY apps/web/package.json ./apps/web/
COPY apps/ws-backend/package.json ./apps/ws-backend/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY packages/shared/ ./packages/shared/
COPY packages/db/ ./packages/db/
COPY apps/ws-backend/ ./apps/ws-backend/

# Build
WORKDIR /app/apps/ws-backend
RUN bun run build

# ---------------------------------------------------------------------------
# Stage 2: Production Runtime
# ---------------------------------------------------------------------------
FROM oven/bun:1.3-slim AS runtime

WORKDIR /app

# Copy the full workspace (Bun resolves workspace deps at runtime)
COPY --from=builder /app /app

# Non-root user
RUN useradd -m -s /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

# WS relay port
EXPOSE 3003

# Health check via the HTTP health endpoint
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD bun -e "const r = await fetch('http://localhost:3003/health'); process.exit(r.ok ? 0 : 1)" || exit 1

# Environment
ENV NODE_ENV=production

CMD ["bun", "run", "apps/ws-backend/src/index.ts"]
