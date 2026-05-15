import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as k8s from '@kubernetes/client-node';
import { client } from '@repo/db';
import { s3Paths } from '@repo/shared';
import { config } from '../config.js';
import { renderTemplate } from '../k8s/templates.js';
import {
  createPod,
  createService,
  createIngress,
  deletePod,
  deleteService,
  deleteIngress,
} from '../k8s/resources.js';

export const orchestratorRouter = new Hono();

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

// Languages that have a built runner image available locally.
// Add new entries here as runner images are built and loaded into the cluster.
const SUPPORTED_LANGUAGES = ['node-js', 'react'] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

const startSchema = z.object({
  replId: z.string().min(1, 'replId is required'),
  language: z.enum(SUPPORTED_LANGUAGES),
  tier: z.enum(['free', 'pro']).default('free'),
});

const stopSchema = z.object({
  replId: z.string().min(1, 'replId is required'),
});

// ---------------------------------------------------------------------------
// POST /start
// ---------------------------------------------------------------------------
// Provisions a Pod + Service + Ingress for a Repl workspace.
//
// Flow:
//   1. Fetch Repl from DB by replId
//   2. If podName exists & status != TERMINATED → return existing URLs (idempotent)
//   3. Render k8s YAML templates with placeholder values
//   4. Apply via k8s API: createNamespacedPod, createNamespacedService, createNamespacedIngress
//   5. Update DB with k8s resource names, routing info, status STARTING
//   6. Return 202 Accepted (pod isn't ready yet)
//
// The background watcher (watcher.ts) will transition status to RUNNING
// once the pod's phase becomes "Running".
// ---------------------------------------------------------------------------

orchestratorRouter.post('/start', zValidator('json', startSchema), async (c) => {
  const { replId, language, tier } = c.req.valid('json');

  // Step 1: Fetch repl from DB
  const repl = await client.repl.findUnique({
    where: { id: replId },
  });

  if (!repl) {
    return c.json({ error: `Repl '${replId}' not found` }, 404);
  }

  // Step 2: Idempotency check — if pod already exists and isn't terminated, return existing URLs
  if (repl.podName && repl.status !== 'TERMINATED') {
    console.log(`[start] Repl ${replId} already has a pod (${repl.podName}), status: ${repl.status}`);
    return c.json(
      {
        runnerAddr: repl.runnerAddr || `ws://svc-${replId}:3001`,
        previewUrl: repl.previewUrl || `${config.previewScheme}://${replId}.${config.previewDomain}`,
        status: repl.status,
      },
      200,
    );
  }

  // Step 3: Prepare template variables.
  // Map the validated language to the Docker image tag suffix:
  //   "node-js" → "node"   (image: bucketcode/runner-node:v1)
  //   "react"   → "react"  (image: bucketcode/runner-react:v1)
  const imageLangMap: Record<SupportedLanguage, string> = {
    'node-js': 'node',
    'react': 'react',
  };
  const imageLang = imageLangMap[language];
  const s3Bucket = process.env.S3_BUCKET || 'bucketcode-repls';
  const s3Path = `${s3Bucket}/${s3Paths.getUserCodePath(replId)}`;
  const templateVars = { replId, language: imageLang, s3Path };

  try {
    // Step 4: Render templates and apply to k8s
    const podBody = renderTemplate<k8s.V1Pod>('pod', templateVars);
    const svcBody = renderTemplate<k8s.V1Service>('service', templateVars);
    const ingBody = renderTemplate<k8s.V1Ingress>('ingress', templateVars);

    const ns = config.namespace;

    // Create resources sequentially: pod first (most critical), then networking
    const podName = await createPod(ns, podBody);
    const serviceName = await createService(ns, svcBody);
    const ingressName = await createIngress(ns, ingBody);

    // Step 5: Compute routing addresses
    const runnerAddr = `ws://svc-${replId}:3001`;
    const previewUrl = `${config.previewScheme}://${replId}.${config.previewDomain}`;

    // Step 6: Update DB with k8s resource names and routing info
    await client.repl.update({
      where: { id: replId },
      data: {
        podName,
        serviceName,
        ingressName,
        runnerAddr,
        previewUrl,
        status: 'STARTING',
        lastActiveAt: new Date(),
      },
    });

    console.log(`[start] Provisioned k8s resources for ${replId}`);

    // Step 7: Return 202 — pod isn't ready yet
    return c.json({ runnerAddr, previewUrl, status: 'STARTING' }, 202);
  } catch (err) {
    console.error(`[start] Failed to provision ${replId}:`, err);

    // Best-effort cleanup on partial failure:
    // If pod was created but service/ingress failed, we don't want orphaned resources.
    // The watcher will also catch failed pods and clean up.
    try {
      const ns = config.namespace;
      await Promise.allSettled([
        deletePod(ns, `runner-${replId}`),
        deleteService(ns, `svc-${replId}`),
        deleteIngress(ns, `ing-${replId}`),
      ]);
    } catch (cleanupErr) {
      console.error(`[start] Cleanup after failure also failed:`, cleanupErr);
    }

    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: `Failed to start workspace: ${message}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------
// Gracefully tears down all k8s resources for a Repl.
//
// Flow:
//   1. Fetch Repl from DB
//   2. Delete Pod, Service, Ingress (404-tolerant)
//   3. Update DB: clear resource names, set status TERMINATED
//   4. Return 200
// ---------------------------------------------------------------------------

orchestratorRouter.post('/stop', zValidator('json', stopSchema), async (c) => {
  const { replId } = c.req.valid('json');

  const repl = await client.repl.findUnique({
    where: { id: replId },
    select: {
      id: true,
      podName: true,
      serviceName: true,
      ingressName: true,
      status: true,
    },
  });

  if (!repl) {
    return c.json({ error: `Repl '${replId}' not found` }, 404);
  }

  // Already terminated — idempotent
  if (repl.status === 'TERMINATED' && !repl.podName) {
    console.log(`[stop] Repl ${replId} already terminated`);
    return c.json({ status: 'TERMINATED' }, 200);
  }

  try {
    const ns = config.namespace;

    // Delete all k8s resources in parallel (each is 404-tolerant)
    await Promise.allSettled([
      repl.podName ? deletePod(ns, repl.podName) : Promise.resolve(),
      repl.serviceName ? deleteService(ns, repl.serviceName) : Promise.resolve(),
      repl.ingressName ? deleteIngress(ns, repl.ingressName) : Promise.resolve(),
    ]);

    // Update DB: clear all k8s references
    await client.repl.update({
      where: { id: replId },
      data: {
        status: 'TERMINATED',
        podName: null,
        serviceName: null,
        ingressName: null,
        runnerAddr: null,
        previewUrl: null,
      },
    });

    console.log(`[stop] Terminated ${replId}`);
    return c.json({ status: 'TERMINATED' }, 200);
  } catch (err) {
    console.error(`[stop] Failed to stop ${replId}:`, err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: `Failed to stop workspace: ${message}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /status/:replId
// ---------------------------------------------------------------------------
// Returns the current status of a Repl's workspace.
// The frontend polls this endpoint after calling POST /start to know
// when the WebSocket connection can be established.
//
// Response:
//   { replId, status, runnerAddr, previewUrl }
// ---------------------------------------------------------------------------

orchestratorRouter.get('/status/:replId', async (c) => {
  const replId = c.req.param('replId');

  if (!replId) {
    return c.json({ error: 'replId parameter is required' }, 400);
  }

  try {
    const repl = await client.repl.findUnique({
      where: { id: replId },
      select: {
        id: true,
        status: true,
        runnerAddr: true,
        previewUrl: true,
      },
    });

    if (!repl) {
      return c.json({ error: `Repl '${replId}' not found` }, 404);
    }

    return c.json(
      {
        replId: repl.id,
        status: repl.status,
        runnerAddr: repl.runnerAddr,
        previewUrl: repl.previewUrl,
      },
      200,
    );
  } catch (err) {
    console.error(`[status] Failed to fetch status for ${replId}:`, err);
    return c.json({ error: 'Failed to fetch workspace status' }, 500);
  }
});
