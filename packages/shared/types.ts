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
