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
# Flags & Arguments
# ---------------------------------------------------------------------------
LIGHT_MODE=0
CLEANUP=0

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --light) LIGHT_MODE=1 ;;
        --cleanup) CLEANUP=1 ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [ "$CLEANUP" = "1" ]; then
  echo "🧹 Cleaning up Docker system and builder cache..."
  docker system prune -f --volumes
  docker builder prune -f
fi

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

# Portable timeout wrapper (macOS doesn't ship GNU `timeout`)
# Usage: run_with_timeout <seconds> <command> [args...]
# Returns 124 on timeout, or the command's exit code otherwise.
run_with_timeout() {
  local secs="$1"; shift
  "$@" &
  local cmd_pid=$!
  ( sleep "$secs"; kill "$cmd_pid" 2>/dev/null ) &
  local watcher_pid=$!
  if wait "$cmd_pid" 2>/dev/null; then
    kill "$watcher_pid" 2>/dev/null; wait "$watcher_pid" 2>/dev/null
    return 0
  else
    local exit_code=$?
    kill "$watcher_pid" 2>/dev/null; wait "$watcher_pid" 2>/dev/null
    # 143 = SIGTERM (128 + 15) — indicates the watcher killed the process
    if [ "$exit_code" = "143" ]; then
      return 124  # conventional timeout exit code
    fi
    return "$exit_code"
  fi
}

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
)

if [ "$LIGHT_MODE" = "0" ]; then
  IMAGES+=(
    "bucketcode/ws-backend:v1|infra/docker/ws-backend.Dockerfile"
    "bucketcode/http-api:v1|infra/docker/http-api.Dockerfile"
    "bucketcode/orchestrator:v1|infra/docker/orchestrator.Dockerfile"
  )
else
  warn "Light mode: skipping build for backend services (running on host)"
fi

# ---------------------------------------------------------------------------
# Detect cluster runtime (Docker Desktop / kind / Colima/k3s)
# ---------------------------------------------------------------------------
# Each runtime needs a different strategy for making locally-built images
# available to pods that use imagePullPolicy: Never or IfNotPresent:
#
#   docker-desktop → images are shared with the host Docker daemon automatically
#   kind-*         → use `kind load docker-image`
#   colima         → Colima k3s uses a SEPARATE containerd image store;
#                    images must be piped via SSH into the k8s.io namespace.
#                    Without this step pods fail with ErrImageNeverPull.
#                    Pod hostAliases map host.docker.internal → 192.168.5.2
#                    (Colima's fixed gateway IP for the QEMU/vz VLAN).
#   other          → warn and skip
# ---------------------------------------------------------------------------
CURRENT_CTX=$(kubectl config current-context 2>/dev/null || true)
KIND_CLUSTER=""
IS_COLIMA=0
COLIMA_SSH_CONFIG="${HOME}/.colima/ssh_config"

if [[ "$CURRENT_CTX" == "colima" ]]; then
  IS_COLIMA=1
  info "Colima k3s detected (context: ${CURRENT_CTX})"
elif [[ "$CURRENT_CTX" == kind-* ]]; then
  KIND_CLUSTER="${CURRENT_CTX#kind-}"
elif command -v kind > /dev/null 2>&1; then
  KIND_CLUSTER=$(docker ps --filter "label=io.x-k8s.kind.role=control-plane" \
    --format '{{.Label "io.x-k8s.kind.cluster"}}' | head -n1 || true)
fi

# ---------------------------------------------------------------------------
# Colima prerequisite: Ensure amazon/aws-cli:latest is in the k8s.io namespace.
# This image is used by the s3-sync initContainer (imagePullPolicy: IfNotPresent).
# k3s will NOT find it if it only exists in the 'moby' namespace.
# ---------------------------------------------------------------------------
if [ "$IS_COLIMA" = "1" ] && [ -f "$COLIMA_SSH_CONFIG" ]; then
  AWS_CLI_IMAGE="amazon/aws-cli:latest"
  AWS_CLI_IN_K8S_IO=0

  if ssh -o StrictHostKeyChecking=no -F "$COLIMA_SSH_CONFIG" colima \
      "sudo /usr/local/bin/k3s ctr --address /run/containerd/containerd.sock --namespace k8s.io images ls 2>/dev/null" \
      | grep -q "amazon/aws-cli"; then
    AWS_CLI_IN_K8S_IO=1
  fi

  if [ "$AWS_CLI_IN_K8S_IO" = "0" ]; then
    info "Colima: amazon/aws-cli not in k8s.io — pulling and importing..."
    # Pull into host Docker (Colima's Docker daemon) if not already present
    if ! docker image inspect "$AWS_CLI_IMAGE" > /dev/null 2>&1; then
      docker pull "$AWS_CLI_IMAGE" || warn "Failed to pull ${AWS_CLI_IMAGE} — initContainer may fail"
    fi
    # Import into the k8s.io namespace so k3s can use it without pulling
    if docker image inspect "$AWS_CLI_IMAGE" > /dev/null 2>&1; then
      docker save "$AWS_CLI_IMAGE" | \
        ssh -o StrictHostKeyChecking=no -F "$COLIMA_SSH_CONFIG" colima \
        "sudo /usr/local/bin/k3s ctr --address /run/containerd/containerd.sock --namespace k8s.io images import -" \
        && success "amazon/aws-cli imported into Colima k8s.io namespace" \
        || warn "Failed to import amazon/aws-cli — initContainer may fail with ErrImageNeverPull"
    fi
  else
    success "amazon/aws-cli already in Colima k8s.io namespace — skipping import"
  fi
fi

# Allow opt-out for fast dev iteration when images are unchanged.
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  warn "SKIP_BUILD=1 set — skipping image build and load into cluster"
else

# Pick the host platform so buildx emits a single-arch image.
HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
  arm64|aarch64) BUILD_PLATFORM="linux/arm64" ;;
  x86_64|amd64)  BUILD_PLATFORM="linux/amd64" ;;
  *)             BUILD_PLATFORM="" ;;
esac

# ---------------------------------------------------------------------------
# Fast-path: Check if all images are already loaded in the cluster's store.
# For Colima k3s: cri-dockerd is the kubelet CRI, which reads from the
#   containerd 'moby' namespace (the same namespace Docker uses). We check
#   this via SSH since the socket requires root inside the VM.
# For Docker Desktop: check the host Docker daemon.
# For kind: check crictl inside the control-plane node.
# ---------------------------------------------------------------------------
ALL_LOADED=0

# Detect Colima SSH config for direct VM commands.

if [ "$IS_COLIMA" = "1" ]; then
  if [ ! -f "$COLIMA_SSH_CONFIG" ]; then
    warn "Colima SSH config not found at ${COLIMA_SSH_CONFIG}."
    warn "Make sure Colima is running: colima start --kubernetes"
  else
    ALL_LOADED=1
    for entry in "${IMAGES[@]}"; do
      IFS='|' read -r tag _ <<< "$entry"
      # Check the 'moby' namespace — this is what cri-dockerd sees
      if ! ssh -o StrictHostKeyChecking=no -F "$COLIMA_SSH_CONFIG" colima \
          "sudo /usr/local/bin/k3s ctr --address /run/containerd/containerd.sock --namespace moby images ls 2>/dev/null" \
          | grep -q "docker.io/${tag}"; then
        ALL_LOADED=0
        break
      fi
    done
  fi
elif [ "$CURRENT_CTX" = "docker-desktop" ]; then
  ALL_LOADED=1
  for entry in "${IMAGES[@]}"; do
    IFS='|' read -r tag _ <<< "$entry"
    if ! docker image inspect "$tag" > /dev/null 2>&1; then
      ALL_LOADED=0
      break
    fi
  done
elif [ -n "$KIND_CLUSTER" ] && command -v kind > /dev/null 2>&1; then
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
  success "All images already in cluster — skipping build (SKIP_BUILD=1 to always skip, or remove images to rebuild)"
else
  # -------------------------------------------------------------------------
  # Step 7a: Build images
  # -------------------------------------------------------------------------
  info "Building local Docker images..."
  BUILD_FLAGS=(--provenance=false --sbom=false)
  [ -n "$BUILD_PLATFORM" ] && BUILD_FLAGS+=(--platform="$BUILD_PLATFORM")

  for entry in "${IMAGES[@]}"; do
    IFS='|' read -r tag dockerfile <<< "$entry"
    if [ -f "$dockerfile" ]; then
      info "  Building ${tag}..."
      docker build "${BUILD_FLAGS[@]}" -t "$tag" -f "$dockerfile" . \
        || warn "Failed to build ${tag}"
    else
      warn "Dockerfile not found: ${dockerfile} — skipping ${tag}"
    fi
  done

  success "Docker images built"

  # -------------------------------------------------------------------------
  # Step 7b: Load images into the cluster's container runtime
  # -------------------------------------------------------------------------
  if [ "$IS_COLIMA" = "1" ]; then
    # Colima k3s architecture (verified by inspection):
    #   kubelet → cri-dockerd (socket: /run/k3s/cri-dockerd/cri-dockerd.sock)
    #          → containerd at /run/containerd/containerd.sock, NAMESPACE: moby
    #
    # Docker images built on the host ARE in this containerd (moby namespace)
    # BUT: cri-dockerd does NOT share the Docker image store directly with
    # images built via docker build on the host Colima socket. To make the
    # image available we must import via ctr into the moby namespace using
    # direct SSH as root (the socket requires root in the VM).
    if [ ! -f "$COLIMA_SSH_CONFIG" ]; then
      warn "Cannot load images: Colima SSH config not found at ${COLIMA_SSH_CONFIG}"
    else
      info "Colima: importing images into containerd moby namespace (via SSH)..."
      info "Note: Each runner image is ~800MB and takes 2-3 minutes. Please wait."
      LOAD_FAIL=0
      for entry in "${IMAGES[@]}"; do
        IFS='|' read -r tag _ <<< "$entry"
        if docker image inspect "$tag" > /dev/null 2>&1; then
          info "  Importing ${tag}..."
          if docker save "$tag" | ssh -o StrictHostKeyChecking=no -F "$COLIMA_SSH_CONFIG" colima \
              "sudo /usr/local/bin/k3s ctr --address /run/containerd/containerd.sock --namespace moby images import -"; then
            echo "  ✓ ${tag}"
          else
            warn "  Failed to import ${tag} into Colima moby namespace"
            LOAD_FAIL=1
          fi
        else
          warn "  Image not found in Docker: ${tag} — skipping"
          LOAD_FAIL=1
        fi
      done
      [ "$LOAD_FAIL" = "0" ] \
        && success "All runner images imported into Colima k3s (moby namespace)" \
        || warn "Some images failed — runner pods may fail with ErrImageNeverPull"
    fi

  elif [ "$CURRENT_CTX" = "docker-desktop" ]; then
    success "Docker Desktop K8s — images are shared with host daemon automatically"

  elif [ -n "$KIND_CLUSTER" ]; then
    if command -v kind > /dev/null 2>&1; then
      info "Loading images into kind cluster '${KIND_CLUSTER}' (sequentially)..."
      LOAD_TIMEOUT=120
      LOAD_FAIL=0
      for entry in "${IMAGES[@]}"; do
        IFS='|' read -r tag _ <<< "$entry"
        if docker image inspect "$tag" > /dev/null 2>&1; then
          info "  Loading ${tag}..."
          if run_with_timeout "$LOAD_TIMEOUT" kind load docker-image "$tag" --name "$KIND_CLUSTER" 2>&1; then
            echo "  ✓ ${tag}"
          else
            EXIT_CODE=$?
            if [ "$EXIT_CODE" = "124" ]; then
              warn "Timed out loading ${tag} after ${LOAD_TIMEOUT}s — skipping"
            else
              warn "Failed to load ${tag} into kind (exit code ${EXIT_CODE})"
            fi
            LOAD_FAIL=1
          fi
        fi
      done
      [ "$LOAD_FAIL" = "0" ] \
        && success "Images loaded into kind cluster '${KIND_CLUSTER}'" \
        || warn "Some images failed to load — pods may not start correctly"
    else
      warn "kind cluster detected but 'kind' CLI not found — install kind to load images"
    fi
  else
    warn "Unknown cluster runtime (context: ${CURRENT_CTX}) — skipping image load. Pods using imagePullPolicy: Never may fail."
  fi
fi

fi  # SKIP_BUILD

# ---------------------------------------------------------------------------
# Step 8: Apply K8s manifests
# ---------------------------------------------------------------------------
info "Applying Kubernetes manifests..."
if [ "$LIGHT_MODE" = "1" ]; then
  warn "Light mode: skipping core service deployments (running on host instead)"
  # Ensure the namespace exists without needing a separate file
  kubectl create namespace default --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1 || true
else
  if [ -f "infra/k8s/deployment.yml" ]; then
    kubectl apply -f infra/k8s/deployment.yml
    success "Consolidated K8s manifests applied"
  elif [ -d "infra/k8s/base" ]; then
    kubectl apply -f infra/k8s/base/
    success "Base K8s manifests applied"
  fi
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
echo "  Next steps:
    bun run dev:light   # Recommended: Start infra in Docker, services on Host
    bun run dev:full    # Start everything in Docker (High Memory Usage)
    bun run test        # Run test suite
"
echo ""
