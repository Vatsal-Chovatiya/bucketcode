import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config } from './config.js';
import { startKubectlProxy, stopKubectlProxy } from './k8s/client.js';
import { loadTemplates } from './k8s/templates.js';
import { startBackgroundWorkers, stopBackgroundWorkers } from './k8s/watcher.js';
import { orchestratorRouter } from './routes/orchestrator.js';

// ---------------------------------------------------------------------------
// Orchestrator Service Entry Point
// ---------------------------------------------------------------------------
// This service is the bridge between the frontend/http-backend and Kubernetes.
// It manages the complete lifecycle of runner pods:
//
//   1. POST /start  — Create Pod + Service + Ingress
//   2. POST /stop   — Tear down all k8s resources
//   3. GET /status  — Return current pod status for frontend polling
//
// Background workers:
//   - Pod Phase Watcher:  STARTING → RUNNING transition
//   - Idle Cleanup Ticker: RUNNING → TERMINATED after inactivity
// ---------------------------------------------------------------------------

// --- Async Startup ---
// Wrapped in main() because kubectl proxy startup is async.

async function main() {
  // Start kubectl proxy for local dev (handles TLS + cert auth)
  await startKubectlProxy();

  // Load YAML templates from infra/k8s/ into memory (fail-fast if missing)
  try {
    loadTemplates();
    console.log('[startup] K8s templates loaded successfully');
  } catch (err) {
    console.error('[startup] Failed to load templates:', err);
    process.exit(1);
  }

  // --- HTTP Server ---

  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', logger());

  // Mount routes
  app.route('/', orchestratorRouter);

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'orchestrator',
      namespace: config.namespace,
      uptime: process.uptime(),
    });
  });

  // --- Start Server ---

  console.log(`Starting orchestrator server on port ${config.port}...`);

  serve({
    fetch: app.fetch,
    port: config.port,
  });

  // Start background workers after HTTP server is listening
  startBackgroundWorkers();

  console.log(`[startup] Orchestrator ready on http://localhost:${config.port}`);
  console.log(`[startup] Namespace: ${config.namespace}`);
  console.log(`[startup] Templates dir: ${config.templatesDir}`);
}

// --- Graceful Shutdown ---

function shutdown(signal: string) {
  console.log(`\n[shutdown] Received ${signal}, shutting down...`);
  stopBackgroundWorkers();
  stopKubectlProxy();
  // Give in-flight requests a moment to complete
  setTimeout(() => {
    console.log('[shutdown] Goodbye.');
    process.exit(0);
  }, 1000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- Run ---
main().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
