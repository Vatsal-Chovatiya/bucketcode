import { S3SyncManager, SyncEventEmitter, validateFile } from '@repo/shared';
import fs from 'fs/promises';
import path from 'path';

export class FileManager {
  private s3Sync: S3SyncManager;
  private workspaceRoot = '/workspace';

  constructor(replId: string, emitSyncEvent: SyncEventEmitter) {
    this.s3Sync = new S3SyncManager(replId, emitSyncEvent);
  }

  async fetchDir(dirPath: string) {
    // path jail validation is done within validateFile if needed, 
    // but here we just safely resolve it.
    const resolvedPath = path.resolve(this.workspaceRoot, dirPath.replace(/^[\/\\]+/, ''));
    if (!resolvedPath.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal detected');
    }

    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const tree = entries.map(entry => ({
        name: entry.name,
        path: path.join(dirPath, entry.name).replace(/\\/g, '/'),
        type: entry.isDirectory() ? 'dir' : 'file' as const,
      }));
      return tree;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async fetchContent(filePath: string) {
    const resolvedPath = path.resolve(this.workspaceRoot, filePath.replace(/^[\/\\]+/, ''));
    if (!resolvedPath.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal detected');
    }

    const content = await fs.readFile(resolvedPath, 'utf8');
    return content;
  }

  async updateContent(filePath: string, content: string) {
    // 1. Sync Validation & Write to Local Disk
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const validation = validateFile(filePath, sizeBytes);

    if (!validation.valid) {
      // Return validation failure so the caller can emit validationError
      return { success: false, reason: validation.reason };
    }

    const resolvedPath = path.resolve(this.workspaceRoot, filePath.replace(/^[\/\\]+/, ''));
    
    // Ensure parent directories exist
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    
    // Local write first (Succeeds immediately)
    await fs.writeFile(resolvedPath, content, 'utf8');

    // Queue for S3 (Debounced S3 flush, skipping local-only paths if handled by S3SyncManager)
    this.s3Sync.queueUpdate(filePath, content);

    return { success: true };
  }
}
