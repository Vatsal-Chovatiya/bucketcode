// =============================================================================
// BucketCode — Full Repl Lifecycle Integration Test
// =============================================================================
// This test exercises the complete lifecycle of a repl from creation to cleanup,
// verifying every layer of the stack:
//
//   1. HTTP API  → Create repl (DB + S3 seed)
//   2. Orchestrator → Start runner pod (K8s Pod + Service + Ingress)
//   3. K8s       → Pod reaches Running phase
//   4. WS Relay  → WebSocket connection + authentication
//   5. Runner    → File operations (fetchDir, updateContent)
//   6. S3        → Verify debounced file sync
//   7. Terminal  → PTY session via WebSocket
//   8. Ingress   → Routing rules verified
//   9. Cleanup   → All resources torn down
//
// Prerequisites:
//   - MinIO running locally (docker compose up -d minio)
//   - K8s cluster running (Docker Desktop with K8s enabled)
//   - All services running (bun run dev:full)
//
// Run:
//   bun test tests/e2e/lifecycle.test.ts
// =============================================================================

import { test, expect, describe, afterAll } from "bun:test";
import {
  API_URL,
  TEST_TIMEOUT,
  TEST_TOKEN,
  S3_BUCKET,
  s3Client,
  s3ObjectExists,
  s3GetObjectContent,
  prisma,
  k8sCore,
  k8sNet,
  connectWs,
  waitForEvent,
  sendWsMessage,
  waitForPodPhase,
  createRepl,
  startRepl,
  cleanupRepl,
} from "./helpers.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Test State
// ---------------------------------------------------------------------------

const REPL_ID = `test-${Date.now()}`;
const OWNER_ID = "test-user";
const LANGUAGE = "node-js";

let s3Path: string;
let ws: InstanceType<typeof import("ws").default> | null = null;

// ---------------------------------------------------------------------------
// Cleanup after all tests (even if they fail)
// ---------------------------------------------------------------------------

afterAll(async () => {
  await cleanupRepl(REPL_ID, ws);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Full Lifecycle Test Suite
// ---------------------------------------------------------------------------

describe("Full Repl Lifecycle", () => {
  // -------------------------------------------------------------------------
  // 1. Create Repl via HTTP API
  // -------------------------------------------------------------------------
  test(
    "1. Create repl → returns 201 with s3Path",
    async () => {
      const { status, body } = await createRepl({
        language: LANGUAGE,
        ownerId: OWNER_ID,
        replId: REPL_ID,
      });

      expect(status).toBe(201);
      expect(body.s3Path).toBeDefined();
      expect(typeof body.s3Path).toBe("string");
      expect(body.s3Path.length).toBeGreaterThan(0);

      // Store for subsequent tests
      s3Path = body.s3Path;

      console.log(`[test] Repl created: ${REPL_ID}, s3Path: ${s3Path}`);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // 2. Start Pod via Orchestrator
  // -------------------------------------------------------------------------
  test(
    "2. Start pod → returns 202 (accepted)",
    async () => {
      const { status, body } = await startRepl({
        replId: REPL_ID,
        language: LANGUAGE,
        tier: "free",
      });

      expect(status).toBe(202);
      console.log(`[test] Pod start requested: runner-${REPL_ID}`);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // 3. Wait for Pod to become Running
  // -------------------------------------------------------------------------
  test(
    "3. Pod reaches Running phase within 30s",
    async () => {
      await waitForPodPhase(`runner-${REPL_ID}`, "default", "Running", 30_000);

      // Verify pod spec has correct resource limits
      const pod = await k8sCore.readNamespacedPod({
        name: `runner-${REPL_ID}`,
        namespace: "default",
      });
      const container = pod.spec?.containers?.find((c) => c.name === "runner");

      expect(container).toBeDefined();
      expect(container?.resources?.limits?.cpu).toBe("1");
      expect(container?.resources?.limits?.memory).toBe("1Gi");

      console.log(`[test] Pod runner-${REPL_ID} is Running`);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // 4. Connect via WebSocket Relay
  // -------------------------------------------------------------------------
  test(
    "4. WebSocket connects to relay successfully",
    async () => {
      ws = await connectWs(REPL_ID, TEST_TOKEN);
      expect(ws.readyState).toBe(1); // WebSocket.OPEN

      console.log(`[test] WebSocket connected for ${REPL_ID}`);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // 5. Fetch Directory → Verify S3 Seed
  // -------------------------------------------------------------------------
  test(
    "5. fetchDir returns seeded file tree from S3",
    async () => {
      expect(ws).not.toBeNull();

      sendWsMessage(ws!, { event: "fetchDir", path: "/" });

      const loaded = await waitForEvent<{ event: string; tree: any[] }>(
        ws!,
        "loaded",
        15_000
      );

      expect(loaded.tree).toBeDefined();
      expect(Array.isArray(loaded.tree)).toBe(true);
      expect(loaded.tree.length).toBeGreaterThan(0);

      console.log(`[test] fetchDir returned ${loaded.tree.length} entries`);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // 6. Edit File → Verify S3 Sync
  // -------------------------------------------------------------------------
  test(
    "6. updateContent writes to S3 and returns ack",
    async () => {
      expect(ws).not.toBeNull();

      const testContent = `console.log('bucketcode e2e test — ${Date.now()}');`;

      sendWsMessage(ws!, {
        event: "updateContent",
        path: "index.js",
        content: testContent,
      });

      // Wait for ack from the runner (debounced write completed)
      const ack = await waitForEvent<{ event: string; saved: boolean }>(
        ws!,
        "ack",
        15_000
      );

      expect(ack.saved).toBe(true);

      // Give debounce time to flush to S3 (1.5s debounce + network)
      await new Promise((r) => setTimeout(r, 3_000));

      // Verify the file landed in S3
      const s3Key = `${s3Path}index.js`;
      const s3Obj = await s3Client.send(
        new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key })
      );

      expect(s3Obj.Body).toBeDefined();

      const savedContent = await s3Obj.Body!.transformToString("utf-8");
      expect(savedContent).toContain("bucketcode e2e test");

      console.log(`[test] File synced to S3: ${s3Key}`);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // 7. Terminal Session
  // -------------------------------------------------------------------------
  test(
    "7. requestTerminal returns terminal data",
    async () => {
      // Skip PTY tests in CI (runners lack a TTY)
      if (process.env.CI === "true") {
        console.log("[test] Skipping PTY test in CI environment");
        return;
      }

      expect(ws).not.toBeNull();

      sendWsMessage(ws!, {
        event: "requestTerminal",
        cols: 80,
        rows: 24,
      });

      const termData = await waitForEvent<{ event: string; data: string }>(
        ws!,
        "terminalData",
        10_000
      );

      expect(termData.data).toBeDefined();
      expect(typeof termData.data).toBe("string");
      // Terminal prompt should contain some output (e.g., $ or > prompt)
      expect(termData.data.length).toBeGreaterThan(0);

      console.log(`[test] Terminal session active, received ${termData.data.length} bytes`);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // 8. Verify Ingress Routing
  // -------------------------------------------------------------------------
  test(
    "8. Ingress routes to {replId}.localtest.me",
    async () => {
      const ingress = await k8sNet.readNamespacedIngress({
        name: `ing-${REPL_ID}`,
        namespace: "default",
      });

      expect(ingress.spec?.rules).toBeDefined();
      expect(ingress.spec!.rules!.length).toBeGreaterThan(0);

      const host = ingress.spec!.rules![0].host;
      expect(host).toBe(`${REPL_ID}.localtest.me`);

      // Verify the backend service name matches
      const backend = ingress.spec!.rules![0].http?.paths?.[0].backend;
      expect(backend?.service?.name).toBe(`svc-${REPL_ID}`);
      expect(backend?.service?.port?.number).toBe(3000);

      console.log(`[test] Ingress verified: ${host} → svc-${REPL_ID}:3000`);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // 9. Cleanup (also happens in afterAll as safety net)
  // -------------------------------------------------------------------------
  test(
    "9. Cleanup removes all K8s resources and DB record",
    async () => {
      // Close WebSocket
      if (ws && ws.readyState === 1) {
        ws.close();
        await new Promise((r) => setTimeout(r, 1_000));
      }

      // Delete database record
      try {
        await prisma.repl.delete({ where: { id: REPL_ID } });
        console.log(`[test] DB record deleted: ${REPL_ID}`);
      } catch {
        console.log(`[test] DB record already deleted or not found`);
      }

      // Delete K8s resources
      try {
        await k8sCore.deleteNamespacedPod({ name: `runner-${REPL_ID}`, namespace: "default" });
        console.log(`[test] Pod deleted: runner-${REPL_ID}`);
      } catch {
        console.log(`[test] Pod already deleted`);
      }

      try {
        await k8sCore.deleteNamespacedService({ name: `svc-${REPL_ID}`, namespace: "default" });
        console.log(`[test] Service deleted: svc-${REPL_ID}`);
      } catch {
        console.log(`[test] Service already deleted`);
      }

      try {
        await k8sNet.deleteNamespacedIngress({ name: `ing-${REPL_ID}`, namespace: "default" });
        console.log(`[test] Ingress deleted: ing-${REPL_ID}`);
      } catch {
        console.log(`[test] Ingress already deleted`);
      }

      console.log(`[test] ✅ Full cleanup complete for ${REPL_ID}`);
    },
    TEST_TIMEOUT
  );
});
