# =============================================================================
# BucketCode — Node.js Runner Image
# =============================================================================
# This image runs inside a Kubernetes pod and provides:
#   - WebSocket server for file operations and terminal access
#   - Node.js runtime for user code execution
#   - node-pty for pseudo-terminal support
#
# Build:
#   docker build -t bucketcode/runner-node:v1 -f infra/docker/runner-node.Dockerfile .
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder

WORKDIR /app

# Install native build tools required by node-pty + bun (workspace lockfile uses workspace:*)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Copy workspace root manifests first for better layer caching
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

# Install all dependencies via bun (resolves workspace:* protocol)
RUN bun install --frozen-lockfile

# Copy source code
COPY packages/shared/ ./packages/shared/
COPY apps/runner/ ./apps/runner/

# Build the runner
WORKDIR /app/apps/runner
RUN bun run build

# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime

WORKDIR /app

# Install runtime dependency for node-pty and install bun
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    build-essential \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g bun

# Copy built application from builder (with chown to avoid slow recursive chown layer)
COPY --chown=node:node --from=builder /app /app

# Create workspace directory for user code (mounted as emptyDir in K8s)
RUN mkdir -p /workspace && chown -R node:node /workspace

# Non-root user for security
USER node

# Ports:
#   3001 — WebSocket server (file ops + terminal)
#   3000 — Preview server (user's running app)
EXPOSE 3001 3000

# Health check
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:3001/health || exit 1

ENV NODE_ENV=production

# Change to the runner directory so dist/index.js resolves correctly
WORKDIR /app/apps/runner

# Run the guard script which manages the runner process
ENTRYPOINT ["node", "guard.js"]
