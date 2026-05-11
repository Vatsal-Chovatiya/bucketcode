import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Resolve project root to locate infra/k8s/ templates regardless of CWD
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Centralized configuration for the Orchestrator service.
 * All values are overridable via environment variables for deployment flexibility.
 */
export const config = {
  /** Port the orchestrator HTTP server listens on */
  port: parseInt(process.env.ORCHESTRATOR_PORT || '3003', 10),

  /** Kubernetes namespace to deploy runner pods into */
  namespace: process.env.K8S_NAMESPACE || 'default',

  /**
   * Absolute path to infra/k8s/ directory containing YAML templates.
   * Resolved relative to the project root (2 levels up from src/).
   */
  templatesDir: process.env.TEMPLATES_DIR || path.resolve(__dirname, '..', '..', '..', '..', 'infra', 'k8s'),

  /**
   * How often the pod-phase watcher polls Kubernetes for status changes.
   * Repls in STARTING state are checked on this interval.
   */
  watcherIntervalMs: parseInt(process.env.WATCHER_INTERVAL_MS || '5000', 10),

  /**
   * How often the idle-cleanup ticker scans for stale pods.
   */
  cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || '60000', 10),

  /**
   * Duration of inactivity (no WebSocket connections) before a pod is terminated.
   * Default: 5 minutes.
   */
  idleTimeoutMs: parseInt(process.env.IDLE_TIMEOUT_MS || String(5 * 60 * 1000), 10),

  /**
   * Base domain for preview URLs. {replId} is prepended as a subdomain.
   * localtest.me resolves to 127.0.0.1 — no /etc/hosts editing needed.
   */
  previewDomain: process.env.PREVIEW_DOMAIN || 'localtest.me',
} as const;
