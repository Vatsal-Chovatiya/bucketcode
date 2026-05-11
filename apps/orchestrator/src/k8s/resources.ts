import * as k8s from '@kubernetes/client-node';
import { coreApi, networkingApi } from './client.js';

// ---------------------------------------------------------------------------
// Kubernetes Resource CRUD Operations
// ---------------------------------------------------------------------------
// Thin wrappers around the k8s client that handle common patterns:
// - Type-safe bodies from rendered templates
// - 404 tolerance on deletes (resource might already be gone)
// - Structured error logging
// ---------------------------------------------------------------------------

/**
 * Creates a Pod in the given namespace.
 * @returns The pod name on success
 */
export async function createPod(
  namespace: string,
  body: k8s.V1Pod,
): Promise<string> {
  try {
    const res = await coreApi.createNamespacedPod({
      namespace,
      body,
    });
    const podName = res.metadata?.name || '';
    console.log(`[k8s] Pod created: ${podName}`);
    return podName;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // If pod already exists (409 Conflict), treat as idempotent success
    if (message.includes('409') || message.includes('AlreadyExists')) {
      const podName = body.metadata?.name || '';
      console.log(`[k8s] Pod already exists: ${podName} (idempotent)`);
      return podName;
    }
    console.error('[k8s] Failed to create pod:', message);
    throw new Error(`Failed to create pod: ${message}`);
  }
}

/**
 * Creates a Service in the given namespace.
 * @returns The service name on success
 */
export async function createService(
  namespace: string,
  body: k8s.V1Service,
): Promise<string> {
  try {
    const res = await coreApi.createNamespacedService({
      namespace,
      body,
    });
    const svcName = res.metadata?.name || '';
    console.log(`[k8s] Service created: ${svcName}`);
    return svcName;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('409') || message.includes('AlreadyExists')) {
      const svcName = body.metadata?.name || '';
      console.log(`[k8s] Service already exists: ${svcName} (idempotent)`);
      return svcName;
    }
    console.error('[k8s] Failed to create service:', message);
    throw new Error(`Failed to create service: ${message}`);
  }
}

/**
 * Creates an Ingress in the given namespace.
 * @returns The ingress name on success
 */
export async function createIngress(
  namespace: string,
  body: k8s.V1Ingress,
): Promise<string> {
  try {
    const res = await networkingApi.createNamespacedIngress({
      namespace,
      body,
    });
    const ingName = res.metadata?.name || '';
    console.log(`[k8s] Ingress created: ${ingName}`);
    return ingName;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('409') || message.includes('AlreadyExists')) {
      const ingName = body.metadata?.name || '';
      console.log(`[k8s] Ingress already exists: ${ingName} (idempotent)`);
      return ingName;
    }
    console.error('[k8s] Failed to create ingress:', message);
    throw new Error(`Failed to create ingress: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Delete Operations (404-tolerant)
// ---------------------------------------------------------------------------
// When cleaning up resources, the pod/service/ingress might already be gone
// (e.g., pod crashed, manual kubectl delete). We catch 404s and treat them
// as success — the desired end state (resource gone) is achieved either way.
// ---------------------------------------------------------------------------

/**
 * Deletes a Pod. Ignores 404 (already deleted).
 */
export async function deletePod(
  namespace: string,
  name: string,
): Promise<void> {
  try {
    await coreApi.deleteNamespacedPod({
      namespace,
      name,
    });
    console.log(`[k8s] Pod deleted: ${name}`);
  } catch (err) {
    if (isNotFound(err)) {
      console.log(`[k8s] Pod already gone: ${name}`);
      return;
    }
    console.error(`[k8s] Failed to delete pod ${name}:`, err);
    throw err;
  }
}

/**
 * Deletes a Service. Ignores 404 (already deleted).
 */
export async function deleteService(
  namespace: string,
  name: string,
): Promise<void> {
  try {
    await coreApi.deleteNamespacedService({
      namespace,
      name,
    });
    console.log(`[k8s] Service deleted: ${name}`);
  } catch (err) {
    if (isNotFound(err)) {
      console.log(`[k8s] Service already gone: ${name}`);
      return;
    }
    console.error(`[k8s] Failed to delete service ${name}:`, err);
    throw err;
  }
}

/**
 * Deletes an Ingress. Ignores 404 (already deleted).
 */
export async function deleteIngress(
  namespace: string,
  name: string,
): Promise<void> {
  try {
    await networkingApi.deleteNamespacedIngress({
      namespace,
      name,
    });
    console.log(`[k8s] Ingress deleted: ${name}`);
  } catch (err) {
    if (isNotFound(err)) {
      console.log(`[k8s] Ingress already gone: ${name}`);
      return;
    }
    console.error(`[k8s] Failed to delete ingress ${name}:`, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Read Operations
// ---------------------------------------------------------------------------

/**
 * Gets the current phase of a pod.
 *
 * Pod phases in Kubernetes:
 * - Pending     → Scheduled but containers not yet running
 * - Running     → At least one container is running
 * - Succeeded   → All containers terminated successfully
 * - Failed      → All containers terminated, at least one failed
 * - Unknown     → State cannot be determined
 *
 * @returns The phase string, or 'NotFound' if the pod doesn't exist
 */
export async function getPodPhase(
  namespace: string,
  name: string,
): Promise<string> {
  try {
    const pod = await coreApi.readNamespacedPod({
      namespace,
      name,
    });
    return pod.status?.phase || 'Unknown';
  } catch (err) {
    if (isNotFound(err)) {
      return 'NotFound';
    }
    console.error(`[k8s] Failed to read pod phase for ${name}:`, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks if a k8s API error is a 404 Not Found.
 * The @kubernetes/client-node library throws HttpError with statusCode,
 * or might include "404" or "not found" in the message.
 */
function isNotFound(err: unknown): boolean {
  if (err && typeof err === 'object') {
    // HttpError from @kubernetes/client-node
    if ('statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
      return true;
    }
    // Some versions wrap it differently
    if ('response' in err) {
      const response = (err as { response: { statusCode?: number } }).response;
      if (response?.statusCode === 404) {
        return true;
      }
    }
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('404') || msg.includes('not found');
  }
  return false;
}
