import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Config } from './types.js';
import { validateFile } from './validation.js';

export const s3Config: S3Config = {
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'us-east-1',
  bucket: process.env.S3_BUCKET || '',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  forcePathStyle: true, // required for MinIO
};

export const s3Client = new S3Client({
  endpoint: s3Config.endpoint,
  region: s3Config.region,
  credentials: {
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey,
  },
  forcePathStyle: s3Config.forcePathStyle,
});

export const s3Paths = {
  getTemplatePath: (language: string) => `templates/${language}/`,
  getUserCodePath: (replId: string) => `code/${replId}/`,
};

export type { 
  GetObjectCommandInput, 
  PutObjectCommandInput, 
  CopyObjectCommandInput, 
  ListObjectsV2CommandInput 
} from '@aws-sdk/client-s3';

export interface SyncEventEmitter {
  (event: 'validationError', payload: { path: string; reason: string }): void;
  (event: 'persistDegraded', payload: { message: string }): void;
  (event: 'ack', payload: { path: string; saved: boolean }): void;
}

/**
 * Manages debounced and retried S3 writes to ensure high availability
 * and prevent data loss during runner-S3 sync operations.
 */
export class S3SyncManager {
  private queue = new Map<string, string>(); // path -> content
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  
  // Rules configuration
  private maxRetries = 3;
  private debounceMs = 1500; // 1.5s Runner debounce

  constructor(private replId: string, private emit: SyncEventEmitter) {}

  /**
   * Queues an update for S3 synchronization.
   * Debounces writes, validates file path/size/extensions, and schedules flushing.
   */
  public queueUpdate(path: string, content: string) {
    // 1. Validation (Size, Extension, Path Jail, Skip List)
    // Buffer.byteLength requires Node.js env, fallback to string length if not available
    const sizeBytes = typeof Buffer !== 'undefined' ? Buffer.byteLength(content, 'utf8') : content.length;
    const validation = validateFile(path, sizeBytes);
    
    if (!validation.valid) {
      // Fail-fast -> emits validationError -> no write
      this.emit('validationError', { path, reason: validation.reason || 'Invalid file validation' });
      return;
    }

    // 2. Queue locally and debounce
    this.queue.set(path, content);
    
    if (this.debounceTimers.has(path)) {
      clearTimeout(this.debounceTimers.get(path)!);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(path);
      this.flushPath(path);
    }, this.debounceMs);
    
    this.debounceTimers.set(path, timer);
  }

  /**
   * Flushes a specific path to S3 with retries and exponential backoff.
   */
  private async flushPath(path: string) {
    const content = this.queue.get(path);
    if (content === undefined) return;

    // Use normalized paths per the architecture conventions
    const s3Key = `${s3Paths.getUserCodePath(this.replId)}${path.replace(/^[\/\\]+/, '')}`;
    
    let attempt = 0;
    let delay = 500;

    while (attempt <= this.maxRetries) {
      try {
        await s3Client.send(new PutObjectCommand({
          Bucket: s3Config.bucket,
          Key: s3Key,
          Body: content,
          ContentType: this.getContentType(path),
        }));

        // Success - remove from queue and acknowledge
        this.queue.delete(path);
        this.emit('ack', { path, saved: true });
        return;
      } catch (err) {
        attempt++;
        if (attempt > this.maxRetries) {
          // After N fails -> emits persistDegraded -> queues locally (stays in queue map)
          this.emit('persistDegraded', { 
            message: `Failed to save ${path} to S3 after ${this.maxRetries} attempts. Kept in local queue.` 
          });
          return;
        }
        // Exponential backoff
        await new Promise(res => setTimeout(res, delay));
        delay *= 2; 
      }
    }
  }

  /**
   * Basic content type deduction
   */
  private getContentType(path: string): string {
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.jsx') || path.endsWith('.tsx')) return 'application/javascript';
    if (path.endsWith('.html')) return 'text/html';
    if (path.endsWith('.css')) return 'text/css';
    return 'text/plain';
  }
}
