# =============================================================================
# BucketCode — Orchestrator Image
# =============================================================================
# The orchestrator manages the Kubernetes lifecycle of runner pods:
#   - Creates Pod + Service + Ingress on /start
#   - Tears down resources on /stop
#   - Watches pod phases and cleans up idle pods
#
# Build:
#   docker build -t bucketcode/orchestrator:v1 -f infra/docker/orchestrator.Dockerfile .
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
COPY packages/typescript-config/package.json ./packages/typescript-config/
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
COPY apps/orchestrator/ ./apps/orchestrator/

# Copy K8s templates (orchestrator reads these at runtime)
COPY infra/k8s/*.yaml ./infra/k8s/

# ---------------------------------------------------------------------------
# Stage 2: Production Runtime
# ---------------------------------------------------------------------------
FROM oven/bun:1.3-slim AS runtime

WORKDIR /app

# Install kubectl for K8s operations (used by the orchestrator at runtime)
RUN apt-get update && apt-get install -y curl && \
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
    rm kubectl && \
    apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy the full workspace
COPY --from=builder /app /app

# Non-root user
RUN useradd -m -s /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

# Orchestrator HTTP port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD bun -e "const r = await fetch('http://localhost:3002/health'); process.exit(r.ok ? 0 : 1)" || exit 1

# Environment
ENV NODE_ENV=production
ENV TEMPLATES_DIR=/app/infra/k8s

CMD ["bun", "run", "apps/orchestrator/src/index.ts"]
