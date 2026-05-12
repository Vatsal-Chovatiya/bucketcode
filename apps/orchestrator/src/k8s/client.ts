import * as k8s from '@kubernetes/client-node';

// ---------------------------------------------------------------------------
// Kubernetes Client Initialization
// ---------------------------------------------------------------------------
// Loads kubeconfig from the default location (~/.kube/config on macOS).
// On Docker Desktop, this automatically points to the local k8s cluster.
// In production, this would load in-cluster config via loadFromCluster().
// ---------------------------------------------------------------------------

// Local dev: kind / Docker Desktop K8s API serves a self-signed cert that
// Bun's fetch cannot verify (UNABLE_TO_VERIFY_LEAF_SIGNATURE). Disable TLS
// verification for non-production environments. Must be set BEFORE the
// k8s client makes any fetch calls.
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const kc = new k8s.KubeConfig();

try {
  kc.loadFromDefault();
  console.log('[k8s] Loaded kubeconfig from default location');
} catch (err) {
  console.error('[k8s] Failed to load kubeconfig. Is Kubernetes enabled in Docker Desktop?');
  console.error('[k8s] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}

// Also flag the current cluster to skip TLS verify (belt-and-suspenders:
// some client paths consult cluster.skipTLSVerify directly).
if (process.env.NODE_ENV !== 'production') {
  const current = kc.getCurrentCluster();
  if (current) {
    const patched = { ...current, skipTLSVerify: true };
    kc.clusters = kc.clusters.map((c) => (c.name === current.name ? patched : c));
  }
}

/**
 * CoreV1Api — used for Pod and Service CRUD operations.
 * Handles createNamespacedPod, deleteNamespacedPod, readNamespacedPod,
 * createNamespacedService, deleteNamespacedService.
 */
export const coreApi = kc.makeApiClient(k8s.CoreV1Api);

/**
 * NetworkingV1Api — used for Ingress CRUD operations.
 * Handles createNamespacedIngress, deleteNamespacedIngress.
 */
export const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
