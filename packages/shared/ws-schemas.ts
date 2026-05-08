/**
 * WebSocket Message Schemas
 *
 * Single source of truth for the entire WS contract.
 * Every message is an `{ event, payload }` envelope validated by Zod.
 *
 * Direction conventions:
 *   Client → Server  (Browser → Runner via Relay)
 *   Server → Client  (Runner → Browser via Relay)
 */

import { z } from 'zod';
import { WS_ERROR_CODES } from './ws-errors.js';

// ─── Shared field schemas ────────────────────────────────────────

const pathField = z.string().min(1, 'path must not be empty');
const contentField = z.string();

/**
 * Recursive FileNode schema matching the FileNode interface in types.ts.
 * Uses z.lazy for the recursive children field.
 */
const fileNodeSchema: z.ZodType = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'dir']),
    size: z.number().optional(),
    children: z.array(fileNodeSchema).optional(),
  })
);

// ─────────────────────────────────────────────────────────────────
// Client → Server Messages
// ─────────────────────────────────────────────────────────────────

export const FetchDirSchema = z.object({
  event: z.literal('fetchDir'),
  payload: z.object({
    path: pathField,
  }),
});

export const FetchContentSchema = z.object({
  event: z.literal('fetchContent'),
  payload: z.object({
    path: pathField,
  }),
});

export const UpdateContentSchema = z.object({
  event: z.literal('updateContent'),
  payload: z.object({
    path: pathField,
    content: contentField,
  }),
});

export const RequestTerminalSchema = z.object({
  event: z.literal('requestTerminal'),
  payload: z.object({
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
});

export const ClientTerminalDataSchema = z.object({
  event: z.literal('terminalData'),
  payload: z.string(),
});

export const PingSchema = z.object({
  event: z.literal('ping'),
  payload: z.object({}).strict(),
});

/**
 * Discriminated union of ALL valid client → server messages.
 * Use this to validate any inbound message on the Runner/Relay.
 */
export const ClientMessageSchema = z.discriminatedUnion('event', [
  FetchDirSchema,
  FetchContentSchema,
  UpdateContentSchema,
  RequestTerminalSchema,
  ClientTerminalDataSchema,
  PingSchema,
]);

// ─────────────────────────────────────────────────────────────────
// Server → Client Messages
// ─────────────────────────────────────────────────────────────────

export const LoadedSchema = z.object({
  event: z.literal('loaded'),
  payload: z.object({
    tree: z.array(fileNodeSchema),
  }),
});

export const FileContentSchema = z.object({
  event: z.literal('fileContent'),
  payload: z.object({
    path: pathField,
    content: contentField,
  }),
});

export const AckSchema = z.object({
  event: z.literal('ack'),
  payload: z.object({
    path: pathField,
    saved: z.boolean(),
  }),
});

export const ValidationErrorSchema = z.object({
  event: z.literal('validationError'),
  payload: z.object({
    path: pathField,
    reason: z.string(),
  }),
});

export const PersistDegradedSchema = z.object({
  event: z.literal('persistDegraded'),
  payload: z.object({
    message: z.string(),
  }),
});

export const ServerTerminalDataSchema = z.object({
  event: z.literal('terminalData'),
  payload: z.string(),
});

export const TerminalExitSchema = z.object({
  event: z.literal('terminalExit'),
  payload: z.object({
    code: z.number().int(),
    signal: z.string().optional(),
  }),
});

export const PodReadySchema = z.object({
  event: z.literal('podReady'),
  payload: z.object({
    replId: z.string(),
    previewUrl: z.string().url(),
  }),
});

export const ErrorSchema = z.object({
  event: z.literal('error'),
  payload: z.object({
    code: z.enum(WS_ERROR_CODES),
    message: z.string(),
  }),
});

export const PongSchema = z.object({
  event: z.literal('pong'),
  payload: z.object({}).strict(),
});

/**
 * Discriminated union of ALL valid server → client messages.
 * Use this to validate any outbound message before sending, or
 * on the client to validate inbound messages from the server.
 */
export const ServerMessageSchema = z.discriminatedUnion('event', [
  LoadedSchema,
  FileContentSchema,
  AckSchema,
  ValidationErrorSchema,
  PersistDegradedSchema,
  ServerTerminalDataSchema,
  TerminalExitSchema,
  PodReadySchema,
  ErrorSchema,
  PongSchema,
]);
