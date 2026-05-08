import path from 'path';
import type { ValidationRule } from './types.js';

export const defaultValidationRule: ValidationRule = {
  allowExtensions: [
    '.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.css', '.html', '.env', '.yaml', '.yml', '.toml', '.lock'
  ],
  skipPaths: ['node_modules/', '.git/', 'dist/', '.next/', 'build/', '.turbo/'],
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  workspaceRoot: '/workspace/'
};

export function validateFile(inputPath: string,  sizeBytes?: number, rule: ValidationRule = defaultValidationRule): { valid: boolean; reason?: string } {
  try {
    const decodedPath = decodeURIComponent(inputPath);
    
    // Reject path traversal
    if (decodedPath.includes('..')) {
      return { valid: false, reason: 'Path traversal (..) is not allowed.' };
    }

    // Normalize path to use forward slashes
    const normalizedInput = decodedPath.replace(/\\/g, '/');

    // Reject absolute paths that don't start with workspaceRoot
    if (normalizedInput.startsWith('/') && !normalizedInput.startsWith(rule.workspaceRoot)) {
        return { valid: false, reason: 'Absolute paths outside workspace are not allowed.' };
    }

    // Resolve path relative to workspaceRoot if it's not already starting with it
    let finalPath = normalizedInput;
    if (!finalPath.startsWith(rule.workspaceRoot)) {
      const relPath = finalPath.startsWith('/') ? finalPath.slice(1) : finalPath;
      finalPath = `${rule.workspaceRoot}${rule.workspaceRoot.endsWith('/') ? '' : '/'}${relPath}`;
    }
    
    // Normalize to handle redundant slashes just in case
    finalPath = path.posix.normalize(finalPath);
    if (!finalPath.startsWith(rule.workspaceRoot)) {
       return { valid: false, reason: 'Path is outside of workspace root.' };
    }

    // Skip List
    for (const skip of rule.skipPaths) {
      if (finalPath.includes(`/${skip}`) || finalPath.includes(skip)) {
         return { valid: false, reason: `Path contains ignored directory: ${skip}` };
      }
    }
    
    // Extension Allowlist
    const isValidExtension = rule.allowExtensions.some(ext => finalPath.endsWith(ext));
    if (!isValidExtension) {
      return { valid: false, reason: `File extension is not allowed for path: ${inputPath}` };
    }

    // Size Cap
    if (sizeBytes !== undefined && sizeBytes > rule.maxFileSizeBytes) {
      return { valid: false, reason: `File size exceeds the maximum limit of ${rule.maxFileSizeBytes} bytes.` };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: 'Invalid path format.' };
  }
}
