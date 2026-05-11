export interface ReplMetadata {
  replId: string;
  language: string;
  s3Path: string;
  podName: string;
  status: 'starting' | 'running' | 'idle' | 'terminated';
  ownerId: string;
  createdAt: string;
}

export interface PodResources {
  cpuRequest: string;
  cpuLimit: string;
  memRequest: string;
  memLimit: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
}

export interface ValidationRule {
  allowExtensions: string[];
  skipPaths: string[];
  maxFileSizeBytes: number;
  workspaceRoot: string;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

// ---------------------------------------------------------------------------
// Orchestrator Contracts
// ---------------------------------------------------------------------------

/** POST /start — request body */
export interface OrchestratorStartRequest {
  replId: string;
  language: string;
  tier: 'free' | 'pro';
}

/** POST /start — 202 response */
export interface OrchestratorStartResponse {
  runnerAddr: string;
  previewUrl: string;
  status: string;
}

/** POST /stop — request body */
export interface OrchestratorStopRequest {
  replId: string;
}

/** POST /stop — 200 response */
export interface OrchestratorStopResponse {
  status: string;
}

/** GET /status/:replId — 200 response */
export interface OrchestratorStatusResponse {
  replId: string;
  status: string;
  runnerAddr: string | null;
  previewUrl: string | null;
}
