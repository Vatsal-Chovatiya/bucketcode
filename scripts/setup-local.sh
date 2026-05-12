#!/usr/bin/env bash
# =============================================================================
# BucketCode — Local Infrastructure Setup
# =============================================================================
# One-command setup for the full local development stack:
#   1. MinIO (S3-compatible object storage)
#   2. Kubernetes cluster verification (Docker Desktop)
#   3. Ingress-nginx controller
#   4. Docker images for all services
#   5. Base K8s manifests
#
# Usage:
#   chmod +x scripts/setup-local.sh
#   ./scripts/setup-local.sh
#
# Prerequisites:
#   - Docker Desktop running with Kubernetes enabled
#   - kubectl configured
#   - curl available
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Step 0: Bootstrap .env from .env.example if missing
# ---------------------------------------------------------------------------
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  echo "🟦 Created .env from .env.example (edit DATABASE_URL/JWT_SECRET as needed)"
fi

# Symlink root .env into each app dir so bun picks it up from cwd at dev time
if [ -f ".env" ]; then
  for app_dir in apps/*/; do
    [ -d "$app_dir" ] || continue
    if [ ! -e "${app_dir}.env" ]; then
      ln -sf "../../.env" "${app_dir}.env"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Colors for pretty output
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}🟦 $1${NC}"; }
success() { echo -e "${GREEN}✅ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail()    { echo -e "${RED}❌ $1${NC}"; exit 1; }

# ---------------------------------------------------------------------------
# Step 1: Start MinIO
# ---------------------------------------------------------------------------
info "Starting MinIO via Docker Compose..."
docker compose up -d minio || fail "Failed to start MinIO. Is Docker running?"

# ---------------------------------------------------------------------------
# Step 2: Wait for MinIO health
# ---------------------------------------------------------------------------
info "Waiting for MinIO health check..."
MAX_RETRIES=30
RETRY_COUNT=0
until curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    fail "MinIO failed to become healthy after ${MAX_RETRIES} attempts"
  fi
  echo -n "."
  sleep 1
done
echo ""
success "MinIO is healthy"

# ---------------------------------------------------------------------------
# Step 3: Create S3 bucket
# ---------------------------------------------------------------------------
info "Creating S3 bucket 'bucketcode-repls'..."

# The official MinIO image ships with 'mc' at /usr/bin/mc
docker exec bucketcode-minio mc alias set local http://localhost:9000 minioadmin minioadmin 2>/dev/null || true
docker exec bucketcode-minio mc mb --ignore-existing local/bucketcode-repls 2>/dev/null || true
success "S3 bucket 'bucketcode-repls' ready"

# ---------------------------------------------------------------------------
# Step 4: Verify Kubernetes cluster
# ---------------------------------------------------------------------------
info "Verifying Kubernetes cluster..."
if ! kubectl cluster-info > /dev/null 2>&1; then
  fail "Kubernetes cluster not reachable. Enable K8s in Docker Desktop."
fi
kubectl get nodes
success "Kubernetes cluster is running"

# ---------------------------------------------------------------------------
# Step 5: Install ingress-nginx (if missing)
# ---------------------------------------------------------------------------
info "Checking for ingress-nginx..."
if kubectl get ns ingress-nginx > /dev/null 2>&1; then
  success "ingress-nginx namespace already exists"
else
  info "Installing ingress-nginx controller..."
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
  
  info "Waiting for ingress-nginx to be ready (up to 120s)..."
  kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=120s 2>/dev/null || warn "ingress-nginx controller not fully ready yet — it may take a few more seconds"
  
  success "ingress-nginx installed"
fi

# ---------------------------------------------------------------------------
# Step 6: Setup K8s secrets (S3 credentials)
# ---------------------------------------------------------------------------
info "Setting up K8s secrets for S3 access..."
if [ -f "infra/k8s/setup-k8s-secrets.sh" ]; then
  bash infra/k8s/setup-k8s-secrets.sh
  success "K8s secrets configured"
else
  warn "infra/k8s/setup-k8s-secrets.sh not found — skipping secret setup"
fi

# ---------------------------------------------------------------------------
# Step 7: Build local Docker images
# ---------------------------------------------------------------------------
IMAGES=(
  "bucketcode/runner-node:v1|infra/docker/runner-node.Dockerfile"
  "bucketcode/runner-react:v1|infra/docker/runner-react.Dockerfile"
  "bucketcode/ws-backend:v1|infra/docker/ws-backend.Dockerfile"
  "bucketcode/http-api:v1|infra/docker/http-api.Dockerfile"
  "bucketcode/orchestrator:v1|infra/docker/orchestrator.Dockerfile"
)

# Detect kind cluster early (used by skip-check below and by Step 7b).
# kind nodes don't share the host Docker daemon, so images built above are
# invisible to the cluster. Since pod.yaml uses `imagePullPolicy: Never`, we
# must explicitly load each image into every kind node before pods can start.
#
# Detect kind via the cluster's node container image (kindest/node). This
# covers both standalone kind ("kind-<name>" context) and Docker Desktop's
# bundled K8s (context "docker-desktop", cluster name "desktop"), which also
# uses kind under the hood as of recent versions. Older Docker Desktop K8s
# (kubeadm-based, sharing the host Docker daemon) won't match and will skip.
KIND_CLUSTER=""
CURRENT_CTX=$(kubectl config current-context 2>/dev/null || true)
if [[ "$CURRENT_CTX" == kind-* ]]; then
  KIND_CLUSTER="${CURRENT_CTX#kind-}"
elif command -v kind > /dev/null 2>&1; then
  KIND_CLUSTER=$(docker ps --filter "label=io.x-k8s.kind.role=control-plane" \
    --format '{{.Label "io.x-k8s.kind.cluster"}}' | head -n1 || true)
fi

# Allow opt-out for fast dev iteration when images are unchanged.
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  warn "SKIP_BUILD=1 set — skipping image build and kind load"
else

# Pick the host platform so buildx emits a single-arch image (smaller, faster
# to load into kind than a multi-arch manifest list).
HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
  arm64|aarch64) BUILD_PLATFORM="linux/arm64" ;;
  x86_64|amd64)  BUILD_PLATFORM="linux/amd64" ;;
  *)             BUILD_PLATFORM="" ;;
esac

# Fast-path: if every image is already loaded on the kind control-plane node,
# skip both build and load. crictl in the node lists images by `repo:tag`.
ALL_LOADED=0
if [ -n "$KIND_CLUSTER" ] && command -v kind > /dev/null 2>&1; then
  CP_NODE=$(docker ps --filter "label=io.x-k8s.kind.cluster=${KIND_CLUSTER}" \
    --filter "label=io.x-k8s.kind.role=control-plane" --format '{{.Names}}' | head -n1)
  if [ -n "$CP_NODE" ]; then
    NODE_IMAGES=$(docker exec "$CP_NODE" crictl images -o json 2>/dev/null || echo "")
    ALL_LOADED=1
    for entry in "${IMAGES[@]}"; do
      IFS='|' read -r tag _ <<< "$entry"
      if ! echo "$NODE_IMAGES" | grep -q "\"docker.io/${tag}\""; then
        ALL_LOADED=0
        break
      fi
    done
  fi
fi

if [ "$ALL_LOADED" = "1" ]; then
  success "All images already loaded into kind cluster '${KIND_CLUSTER}' — skipping build (set SKIP_BUILD=0 to force, or 'docker rmi' to rebuild)"
else
  info "Building local Docker images..."
  BUILD_FLAGS=(--provenance=false --sbom=false)
  [ -n "$BUILD_PLATFORM" ] && BUILD_FLAGS+=(--platform="$BUILD_PLATFORM")

  for entry in "${IMAGES[@]}"; do
    IFS='|' read -r tag dockerfile <<< "$entry"
    if [ -f "$dockerfile" ]; then
      info "Building ${tag}..."
      docker build "${BUILD_FLAGS[@]}" -t "$tag" -f "$dockerfile" . \
        || warn "Failed to build ${tag}"
    else
      warn "Dockerfile not found: ${dockerfile} — skipping ${tag}"
    fi
  done

  success "Docker images built"

  # -------------------------------------------------------------------------
  # Step 7b: Load images into kind cluster (parallel across images)
  # -------------------------------------------------------------------------
  if [ -n "$KIND_CLUSTER" ]; then
    if command -v kind > /dev/null 2>&1; then
      info "Loading images into kind cluster '${KIND_CLUSTER}' (parallel)..."
      LOAD_PIDS=()
      LOAD_LOGS=()
      for entry in "${IMAGES[@]}"; do
        IFS='|' read -r tag _ <<< "$entry"
        if docker image inspect "$tag" > /dev/null 2>&1; then
          LOG_FILE=$(mktemp -t kindload.XXXXXX)
          LOAD_LOGS+=("${tag}|${LOG_FILE}")
          ( kind load docker-image "$tag" --name "$KIND_CLUSTER" > "$LOG_FILE" 2>&1 ) &
          LOAD_PIDS+=($!)
        fi
      done
      LOAD_FAIL=0
      for i in "${!LOAD_PIDS[@]}"; do
        IFS='|' read -r tag LOG_FILE <<< "${LOAD_LOGS[$i]}"
        if wait "${LOAD_PIDS[$i]}"; then
          echo "  ✓ ${tag}"
        else
          warn "Failed to load ${tag} into kind cluster (see ${LOG_FILE})"
          LOAD_FAIL=1
        fi
        rm -f "$LOG_FILE" 2>/dev/null || true
      done
      [ "$LOAD_FAIL" = "0" ] \
        && success "Images loaded into kind cluster '${KIND_CLUSTER}'" \
        || warn "Some images failed to load into kind cluster '${KIND_CLUSTER}'"
    else
      warn "kind cluster detected but 'kind' CLI not found — install kind to load images"
    fi
  fi
fi

fi  # SKIP_BUILD

# ---------------------------------------------------------------------------
# Step 8: Apply base K8s manifests
# ---------------------------------------------------------------------------
info "Applying base Kubernetes manifests..."
if [ -d "infra/k8s/base" ]; then
  kubectl apply -f infra/k8s/base/
  success "Base K8s manifests applied"
else
  warn "infra/k8s/base/ directory not found — skipping"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=============================================="
success "Local infrastructure is ready!"
echo "=============================================="
echo ""
echo "  MinIO Console:  http://localhost:9001  (minioadmin/minioadmin)"
echo "  MinIO S3 API:   http://localhost:9000"
echo "  K8s Dashboard:  kubectl get all"
echo ""
echo "  Next steps:"
echo "    bun run dev:full    # Start all services via Turborepo"
echo "    bun run test        # Run test suite"
echo ""
