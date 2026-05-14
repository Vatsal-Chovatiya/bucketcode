import * as k8s from '@kubernetes/client-node';
import { spawn, type ChildProcess } from 'child_process';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Kubernetes Client Initialization
// ---------------------------------------------------------------------------
// In production: loadFromCluster() uses in-cluster service-account tokens
// (passed as a Bearer header — works fine with Bun's fetch).
//
// In local dev: Docker Desktop / kind kubeconfigs use client-certificate
// authentication. The @kubernetes/client-node library attaches certs to an
// https.Agent and passes it to node-fetch. However, Bun's node-fetch polyfill
// silently ignores the `agent` option, so the K8s API server never receives
// credentials and rejects every request as `system:anonymous` → 403.
//
// Fix: spawn `kubectl proxy` which handles TLS + cert auth at the proxy level,
// then point the k8s client at the plain HTTP proxy endpoint.
// ---------------------------------------------------------------------------

// Track the kubectl proxy subprocess so we can kill it on shutdown
let proxyProcess: ChildProcess | null = null;

/**
 * Spawns `kubectl proxy` on the configured port.
 * The proxy authenticates using the user's kubeconfig and exposes an
 * unauthenticated HTTP endpoint on localhost.
 *
 * @returns A promise that resolves when the proxy is ready to accept connections.
 */
export async function startKubectlProxy(): Promise<void> {
  if (!config.useKubectlProxy) {
    console.log('[k8s] kubectl proxy disabled (production or USE_KUBECTL_PROXY=false)');
    return;
  }

  const port = config.kubectlProxyPort;

  // Check if something is already listening on the port (e.g. leftover proxy)
  const alreadyRunning = await isPortListening(port);
  if (alreadyRunning) {
    console.log(`[k8s] kubectl proxy already running on port ${port}`);
    return;
  }

  console.log(`[k8s] Starting kubectl proxy on port ${port}...`);

  proxyProcess = spawn('kubectl', ['proxy', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Forward stderr to console for debugging
  proxyProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[k8s proxy stderr] ${msg}`);
  });

  proxyProcess.on('error', (err) => {
    console.error('[k8s] Failed to spawn kubectl proxy:', err.message);
    console.error('[k8s] Is kubectl installed and in your PATH?');
  });

  proxyProcess.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
      console.warn(`[k8s] kubectl proxy exited unexpectedly (code: ${code}, signal: ${signal})`);
    }
    proxyProcess = null;
  });

  // Wait for the proxy to start accepting connections (up to 10 seconds)
  const maxWaitMs = 10_000;
  const pollIntervalMs = 200;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    if (await isPortListening(port)) {
      console.log(`[k8s] kubectl proxy ready on http://localhost:${port}`);
      return;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `kubectl proxy failed to start within ${maxWaitMs / 1000}s on port ${port}. ` +
    'Is kubectl installed? Is the cluster reachable?'
  );
}

/**
 * Stops the kubectl proxy subprocess if it's running.
 * Called during graceful shutdown.
 */
export function stopKubectlProxy(): void {
  if (proxyProcess) {
    console.log('[k8s] Stopping kubectl proxy...');
    proxyProcess.kill('SIGTERM');
    proxyProcess = null;
  }
}

// ---------------------------------------------------------------------------
// K8s Client Setup
// ---------------------------------------------------------------------------

const kc = new k8s.KubeConfig();

if (config.useKubectlProxy) {
  // Point at kubectl proxy — no TLS, no client certs needed.
  // The proxy handles all authentication using the user's kubeconfig.
  kc.loadFromOptions({
    clusters: [
      {
        name: 'kubectl-proxy',
        server: `http://localhost:${config.kubectlProxyPort}`,
        skipTLSVerify: true,
      },
    ],
    users: [{ name: 'kubectl-proxy-user' }],
    contexts: [
      {
        name: 'kubectl-proxy-context',
        cluster: 'kubectl-proxy',
        user: 'kubectl-proxy-user',
      },
    ],
    currentContext: 'kubectl-proxy-context',
  });
  console.log(`[k8s] Configured client to use kubectl proxy at http://localhost:${config.kubectlProxyPort}`);
} else {
  // Production path: load in-cluster or default kubeconfig
  // (in-cluster uses service-account tokens via Bearer header — works with Bun)
  try {
    kc.loadFromDefault();
    console.log('[k8s] Loaded kubeconfig from default location');
  } catch (err) {
    console.error('[k8s] Failed to load kubeconfig. Is Kubernetes enabled in Docker Desktop?');
    console.error('[k8s] Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // For non-proxy production with self-signed certs, set skipTLSVerify
  if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const current = kc.getCurrentCluster();
    if (current) {
      const patched = { ...current, skipTLSVerify: true };
      kc.clusters = kc.clusters.map((c) => (c.name === current.name ? patched : c));
    }
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a TCP port is accepting connections on localhost. */
async function isPortListening(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/api`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
