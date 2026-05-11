#!/usr/bin/env bash
# -------------------------------------------------------------------
# setup-k8s-secrets.sh
# Creates the Kubernetes secret required by runner pod initContainers
# to authenticate with MinIO / S3 for code synchronization.
#
# Usage:
#   chmod +x infra/k8s/setup-k8s-secrets.sh
#   ./infra/k8s/setup-k8s-secrets.sh
#
# Prerequisites:
#   - kubectl configured and pointing to the correct cluster
#   - Docker Desktop Kubernetes enabled (local dev)
# -------------------------------------------------------------------

set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-default}"
SECRET_NAME="s3-creds"

# Default MinIO credentials (local dev only — never use in production)
ACCESS_KEY="${AWS_ACCESS_KEY_ID:-minioadmin}"
SECRET_KEY="${AWS_SECRET_ACCESS_KEY:-minioadmin}"

echo "🔐 Creating Kubernetes secret '${SECRET_NAME}' in namespace '${NAMESPACE}'..."

# Delete existing secret if it exists (idempotent)
kubectl delete secret "${SECRET_NAME}" \
  --namespace="${NAMESPACE}" \
  --ignore-not-found=true

kubectl create secret generic "${SECRET_NAME}" \
  --namespace="${NAMESPACE}" \
  --from-literal=access-key="${ACCESS_KEY}" \
  --from-literal=secret-key="${SECRET_KEY}"

echo "✅ Secret '${SECRET_NAME}' created successfully in namespace '${NAMESPACE}'."
echo ""
echo "Verify with:"
echo "  kubectl get secret ${SECRET_NAME} -n ${NAMESPACE} -o yaml"
