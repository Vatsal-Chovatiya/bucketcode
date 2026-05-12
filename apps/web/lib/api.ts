/**
 * HTTP API Client
 *
 * Typed wrappers for all HTTP endpoints consumed by the frontend.
 * - http-backend (API): POST /repl, GET /repl/:id, POST /repl/:id/keepalive
 * - orchestrator: POST /start, POST /stop, GET /status/:replId
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://localhost:3002";

// ─── Error class ─────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Internal fetch helper ───────────────────────────────────────

async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: string }).error)
        : `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}

// ─── Repl API (http-backend) ─────────────────────────────────────

export interface CreateReplResponse {
  replId: string;
  s3Path: string;
  status: string;
}

export interface ReplMetadata {
  id: string;
  name: string;
  language: string;
  s3Path: string;
  podName: string | null;
  serviceName: string | null;
  ingressName: string | null;
  status: string;
  ownerId: string;
  previewUrl: string | null;
  runnerAddr: string | null;
  lastActiveAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST /repl — Create a new Repl workspace.
 * Seeds S3 from template and inserts DB record.
 */
export async function createRepl(
  language: "node-js" | "python",
  name: string,
  ownerId: string,
  signal?: AbortSignal
): Promise<CreateReplResponse> {
  return apiFetch<CreateReplResponse>(`${API_URL}/repl`, {
    method: "POST",
    body: JSON.stringify({ language, name, ownerId }),
    signal,
  });
}

/**
 * GET /repl/:replId — Fetch Repl metadata for server component.
 */
export async function fetchReplMetadata(
  replId: string,
  signal?: AbortSignal
): Promise<ReplMetadata> {
  return apiFetch<ReplMetadata>(`${API_URL}/repl/${replId}`, {
    method: "GET",
    signal,
  });
}

/**
 * POST /repl/:replId/keepalive — Update lastActiveAt timestamp.
 */
export async function sendKeepalive(
  replId: string,
  signal?: AbortSignal
): Promise<void> {
  await apiFetch(`${API_URL}/repl/${replId}/keepalive`, {
    method: "POST",
    body: JSON.stringify({}),
    signal,
  });
}

// ─── Orchestrator API ────────────────────────────────────────────

export interface StartWorkspaceResponse {
  runnerAddr: string;
  previewUrl: string;
  status: string;
}

export interface WorkspaceStatusResponse {
  replId: string;
  status: string;
  runnerAddr: string | null;
  previewUrl: string | null;
}

/**
 * POST /start — Provision Pod + Service + Ingress for a Repl.
 * Returns 202 (pod not ready yet). Poll /status for readiness.
 */
export async function startWorkspace(
  replId: string,
  language: "node-js" | "python",
  tier: "free" | "pro" = "free",
  signal?: AbortSignal
): Promise<StartWorkspaceResponse> {
  return apiFetch<StartWorkspaceResponse>(`${ORCHESTRATOR_URL}/start`, {
    method: "POST",
    body: JSON.stringify({ replId, language, tier }),
    signal,
  });
}

/**
 * POST /stop — Tear down all k8s resources for a Repl.
 */
export async function stopWorkspace(
  replId: string,
  signal?: AbortSignal
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`${ORCHESTRATOR_URL}/stop`, {
    method: "POST",
    body: JSON.stringify({ replId }),
    signal,
  });
}

/**
 * GET /status/:replId — Poll for pod readiness after /start.
 */
export async function getWorkspaceStatus(
  replId: string,
  signal?: AbortSignal
): Promise<WorkspaceStatusResponse> {
  return apiFetch<WorkspaceStatusResponse>(
    `${ORCHESTRATOR_URL}/status/${replId}`,
    { method: "GET", signal }
  );
}
