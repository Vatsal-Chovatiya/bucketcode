import * as k8s from '@kubernetes/client-node';

// ---------------------------------------------------------------------------
// Kubernetes Client Initialization
// ---------------------------------------------------------------------------
// Loads kubeconfig from the default location (~/.kube/config on macOS).
// On Docker Desktop, this automatically points to the local k8s cluster.
// In production, this would load in-cluster config via loadFromCluster().
// ---------------------------------------------------------------------------

const kc = new k8s.KubeConfig();

try {
  kc.loadFromDefault();
  console.log('[k8s] Loaded kubeconfig from default location');
} catch (err) {
  console.error('[k8s] Failed to load kubeconfig. Is Kubernetes enabled in Docker Desktop?');
  console.error('[k8s] Error:', err instanceof Error ? err.message : err);
  process.exit(1);
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
