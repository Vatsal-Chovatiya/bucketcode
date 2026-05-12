// =============================================================================
// BucketCode — E2E Test Helpers
// =============================================================================
// Shared utilities for integration tests. Provides typed wrappers around
// WebSocket, K8s, S3, and HTTP clients used by the lifecycle test suite.
// =============================================================================

import WebSocket from "ws";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { KubeConfig, CoreV1Api, NetworkingV1Api } from "@kubernetes/client-node";
import { PrismaClient } from "../../packages/db/generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base URL for the HTTP API (repl CRUD) */
export const API_URL = process.env.API_URL || "http://localhost:8080";

/** Base URL for the WS relay server */
export const RELAY_URL = process.env.RELAY_URL || "ws://localhost:8081";

/** S3 endpoint (MinIO for local dev) */
export const S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";

/** S3 bucket name */
export const S3_BUCKET = process.env.S3_BUCKET || "bucketcode-repls";

/** Default test timeout in ms */
export const TEST_TIMEOUT = 60_000;

/** JWT token for test authentication — in test mode, auth is mocked */
export const TEST_TOKEN = process.env.TEST_JWT_TOKEN || "test-jwt-token";

// ---------------------------------------------------------------------------
// S3 Client
// ---------------------------------------------------------------------------

export const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: true, // Required for MinIO
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
  },
});

/**
 * Checks whether an S3 object exists at the given key.
 * Returns true if the object exists, false otherwise.
 */
export async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches an S3 object's body as a UTF-8 string.
 * Throws if the object does not exist.
 */
export async function s3GetObjectContent(key: string): Promise<string> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key })
  );
  return await response.Body!.transformToString("utf-8");
}

// ---------------------------------------------------------------------------
// Prisma Client (Database)
// ---------------------------------------------------------------------------

export const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Kubernetes Clients
// ---------------------------------------------------------------------------

const kc = new KubeConfig();
kc.loadFromDefault();

export const k8sCore = kc.makeApiClient(CoreV1Api);
export const k8sNet = kc.makeApiClient(NetworkingV1Api);

// ---------------------------------------------------------------------------
// WebSocket Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a WebSocket connection to the relay server for a specific repl.
 * Resolves once the connection is open.
 */
export function connectWs(replId: string, token: string = TEST_TOKEN): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${RELAY_URL}?replId=${replId}&token=${token}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timeout for repl ${replId}`));
    }, 10_000);

    ws.on("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Waits for a specific WebSocket event (by `event` field in JSON message).
 * Rejects if the event is not received within the timeout.
 */
export function waitForEvent<T = any>(
  ws: WebSocket,
  eventName: string,
  timeoutMs: number = 10_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for WS event '${eventName}' after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === eventName) {
          cleanup();
          resolve(msg as T);
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", handler);
    };

    ws.on("message", handler);
  });
}

/**
 * Sends a JSON message over a WebSocket connection.
 */
export function sendWsMessage(ws: WebSocket, payload: Record<string, unknown>): void {
  ws.send(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Kubernetes Helpers
// ---------------------------------------------------------------------------

/**
 * Polls a pod until it reaches the specified phase or timeout.
 * Useful for waiting until a runner pod transitions to "Running".
 */
export async function waitForPodPhase(
  podName: string,
  namespace: string,
  targetPhase: string,
  timeoutMs: number = 30_000
): Promise<void> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`Pod '${podName}' did not reach phase '${targetPhase}' within ${timeoutMs}ms`));
          return;
        }

        const pod = await k8sCore.readNamespacedPod({ name: podName, namespace });
        if (pod.status?.phase === targetPhase) {
          clearInterval(interval);
          resolve();
        }
      } catch (err: any) {
        // Pod might not exist yet, keep polling
        if (err?.response?.statusCode !== 404) {
          clearInterval(interval);
          reject(err);
        }
      }
    }, 2_000);
  });
}

/**
 * Safely deletes a K8s resource, ignoring 404 errors (already deleted).
 */
export async function safeDeletePod(name: string, namespace: string = "default"): Promise<void> {
  try {
    await k8sCore.deleteNamespacedPod({ name, namespace });
  } catch (err: any) {
    if (err?.response?.statusCode !== 404) throw err;
  }
}

export async function safeDeleteService(name: string, namespace: string = "default"): Promise<void> {
  try {
    await k8sCore.deleteNamespacedService({ name, namespace });
  } catch (err: any) {
    if (err?.response?.statusCode !== 404) throw err;
  }
}

export async function safeDeleteIngress(name: string, namespace: string = "default"): Promise<void> {
  try {
    await k8sNet.deleteNamespacedIngress({ name, namespace });
  } catch (err: any) {
    if (err?.response?.statusCode !== 404) throw err;
  }
}

// ---------------------------------------------------------------------------
// HTTP API Helpers
// ---------------------------------------------------------------------------

interface CreateReplPayload {
  language: string;
  ownerId: string;
  replId: string;
}

interface CreateReplResponse {
  s3Path: string;
  replId: string;
  [key: string]: unknown;
}

interface StartReplPayload {
  replId: string;
  language: string;
  tier?: string;
}

/**
 * Creates a new repl via the HTTP API.
 */
export async function createRepl(payload: CreateReplPayload): Promise<{ status: number; body: CreateReplResponse }> {
  const res = await fetch(`${API_URL}/repl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { status: res.status, body: body as CreateReplResponse };
}

/**
 * Starts a repl pod via the HTTP API → Orchestrator.
 */
export async function startRepl(payload: StartReplPayload): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API_URL}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Cleanup Helper
// ---------------------------------------------------------------------------

/**
 * Performs full cleanup for a test repl:
 *   1. Close WebSocket (if open)
 *   2. Delete Prisma record
 *   3. Delete K8s Pod + Service + Ingress
 */
export async function cleanupRepl(replId: string, ws?: WebSocket | null): Promise<void> {
  // Close WS connection
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    // Wait briefly for close to propagate
    await new Promise((r) => setTimeout(r, 500));
  }

  // Delete database record (ignore if not found)
  try {
    await prisma.repl.delete({ where: { id: replId } });
  } catch {
    // Record might not exist
  }

  // Delete K8s resources
  await safeDeletePod(`runner-${replId}`);
  await safeDeleteService(`svc-${replId}`);
  await safeDeleteIngress(`ing-${replId}`);
}
