import { client } from '@repo/db';
import { config } from '../config.js';
import { getPodPhase, deletePod, deleteService, deleteIngress } from './resources.js';

// ---------------------------------------------------------------------------
// Background Workers
// ---------------------------------------------------------------------------
// Two interval-based workers that run alongside the HTTP server:
//
// 1. Pod Phase Watcher: Polls k8s for pods in STARTING state,
//    transitions them to RUNNING when the pod phase is "Running".
//
// 2. Idle Cleanup Ticker: Finds RUNNING/IDLE pods that haven't had
//    activity in IDLE_TIMEOUT_MS, and tears down their k8s resources.
// ---------------------------------------------------------------------------

/** Interval handle for the pod phase watcher (for cleanup on shutdown) */
let watcherInterval: NodeJS.Timeout | null = null;

/** Interval handle for the idle cleanup ticker (for cleanup on shutdown) */
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Starts both background workers.
 * Call this once after the HTTP server starts.
 */
export function startBackgroundWorkers(): void {
  // --- Pod Phase Watcher ---
  watcherInterval = setInterval(async () => {
    try {
      await pollPodPhases();
    } catch (err) {
      // Log but don't crash — next tick will retry
      console.error('[watcher] Pod phase poll error:', err);
    }
  }, config.watcherIntervalMs);

  console.log(
    `[watcher] Pod phase watcher started (interval: ${config.watcherIntervalMs}ms)`
  );

  // --- Idle Cleanup Ticker ---
  cleanupInterval = setInterval(async () => {
    try {
      await cleanupIdlePods();
    } catch (err) {
      console.error('[watcher] Idle cleanup error:', err);
    }
  }, config.cleanupIntervalMs);

  console.log(
    `[watcher] Idle cleanup ticker started (interval: ${config.cleanupIntervalMs}ms, timeout: ${config.idleTimeoutMs}ms)`
  );
}

/**
 * Stops both background workers.
 * Called during graceful shutdown.
 */
export function stopBackgroundWorkers(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    console.log('[watcher] Pod phase watcher stopped');
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[watcher] Idle cleanup ticker stopped');
  }
}

// ---------------------------------------------------------------------------
// Pod Phase Watcher Implementation
// ---------------------------------------------------------------------------

/**
 * Queries the DB for all repls in STARTING state, then checks their
 * actual pod phase in Kubernetes. Updates the DB status accordingly.
 *
 * State transitions:
 * - Pod phase "Running"  → DB status RUNNING
 * - Pod phase "Failed"   → DB status TERMINATED (cleanup resources)
 * - Pod phase "NotFound" → DB status TERMINATED (pod was deleted externally)
 * - Pod phase "Pending"  → No change (still starting)
 */
async function pollPodPhases(): Promise<void> {
  const startingRepls = await client.repl.findMany({
    where: { status: 'STARTING' },
    select: {
      id: true,
      podName: true,
      serviceName: true,
      ingressName: true,
    },
  });

  if (startingRepls.length === 0) return;

  console.log(`[watcher] Checking ${startingRepls.length} STARTING pod(s)...`);

  for (const repl of startingRepls) {
    if (!repl.podName) {
      // No pod name means /start hasn't finished yet — skip
      continue;
    }

    const phase = await getPodPhase(config.namespace, repl.podName);

    switch (phase) {
      case 'Running':
        await client.repl.update({
          where: { id: repl.id },
          data: {
            status: 'RUNNING',
            lastActiveAt: new Date(),
          },
        });
        console.log(`[watcher] ${repl.id} → RUNNING`);
        break;

      case 'Failed':
      case 'NotFound':
        // Pod failed or vanished — clean up everything
        await teardownResources(repl);
        await client.repl.update({
          where: { id: repl.id },
          data: {
            status: 'TERMINATED',
            podName: null,
            serviceName: null,
            ingressName: null,
            runnerAddr: null,
            previewUrl: null,
          },
        });
        console.log(`[watcher] ${repl.id} → TERMINATED (phase: ${phase})`);
        break;

      case 'Pending':
      case 'Unknown':
        // Still booting — no action needed
        break;

      default:
        console.warn(`[watcher] Unexpected phase for ${repl.id}: ${phase}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Idle Cleanup Ticker Implementation
// ---------------------------------------------------------------------------

/**
 * Finds RUNNING or IDLE repls whose lastActiveAt exceeds the idle timeout,
 * then tears down their k8s resources and marks them TERMINATED.
 *
 * This implements the "0 WS conns for ~5 minutes → pod destroyed" rule
 * from the pod lifecycle state machine.
 */
async function cleanupIdlePods(): Promise<void> {
  const cutoff = new Date(Date.now() - config.idleTimeoutMs);

  const idleRepls = await client.repl.findMany({
    where: {
      status: { in: ['RUNNING', 'IDLE'] },
      lastActiveAt: { lt: cutoff },
    },
    select: {
      id: true,
      podName: true,
      serviceName: true,
      ingressName: true,
      lastActiveAt: true,
    },
  });

  if (idleRepls.length === 0) return;

  console.log(`[watcher] Found ${idleRepls.length} idle pod(s) to clean up`);

  for (const repl of idleRepls) {
    try {
      await teardownResources(repl);

      await client.repl.update({
        where: { id: repl.id },
        data: {
          status: 'TERMINATED',
          podName: null,
          serviceName: null,
          ingressName: null,
          runnerAddr: null,
          previewUrl: null,
        },
      });

      console.log(
        `[watcher] Cleaned up idle pod for ${repl.id} ` +
        `(last active: ${repl.lastActiveAt.toISOString()})`
      );
    } catch (err) {
      // Log per-repl errors but continue cleaning up others
      console.error(`[watcher] Failed to clean up ${repl.id}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared Teardown Helper
// ---------------------------------------------------------------------------

/**
 * Deletes k8s resources (pod, service, ingress) for a repl.
 * Each delete is 404-tolerant — safe to call even if resources are already gone.
 */
async function teardownResources(repl: {
  podName: string | null;
  serviceName: string | null;
  ingressName: string | null;
}): Promise<void> {
  const ns = config.namespace;

  // Delete in parallel — each is independent and 404-tolerant
  await Promise.allSettled([
    repl.podName ? deletePod(ns, repl.podName) : Promise.resolve(),
    repl.serviceName ? deleteService(ns, repl.serviceName) : Promise.resolve(),
    repl.ingressName ? deleteIngress(ns, repl.ingressName) : Promise.resolve(),
  ]);
}
