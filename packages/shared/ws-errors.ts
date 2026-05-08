/**
 * WebSocket Error Codes
 *
 * Strict enum of all error codes that can appear in the `error` server→client event.
 * Consumers can `switch` on these values for exhaustive handling.
 */

export const WsErrorCode = {
  /** Incoming message failed JSON parse or Zod schema validation */
  MALFORMED_MESSAGE: 'MALFORMED_MESSAGE',
  /** Path contains `..` or escapes the workspace root */
  PATH_TRAVERSAL: 'PATH_TRAVERSAL',
  /** File exceeds the configured max size */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  /** File extension is not in the allowlist */
  EXTENSION_NOT_ALLOWED: 'EXTENSION_NOT_ALLOWED',
  /** Resolved path falls outside the workspace root */
  PATH_OUTSIDE_WORKSPACE: 'PATH_OUTSIDE_WORKSPACE',
  /** node-pty failed to spawn a shell */
  PTY_SPAWN_FAILED: 'PTY_SPAWN_FAILED',
  /** S3 is unreachable or returned an error during persist */
  S3_UNREACHABLE: 'S3_UNREACHABLE',
  /** Catch-all for unclassified server errors */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type WsErrorCode = (typeof WsErrorCode)[keyof typeof WsErrorCode];

/**
 * All valid error codes as an array — useful for Zod enum schema.
 */


// zod requires to pass in as tuple therefore we need to cast it as [WsErrorCode, ...WsErrorCode[]]

export const WS_ERROR_CODES = Object.values(WsErrorCode) as [WsErrorCode, ...WsErrorCode[]];

/**
 * Factory to build a well-typed error payload for the `error` server→client event.
 */
export function createWsError(code: WsErrorCode, message: string) {
  return { code, message } as const;
}
