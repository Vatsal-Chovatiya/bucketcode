/**
 * WebSocket Message Types
 *
 * All types are inferred directly from Zod schemas — never defined manually.
 * This guarantees runtime validation and compile-time types always agree.
 */

import type { z } from 'zod';
import type {
  // Client → Server
  FetchDirSchema,
  FetchContentSchema,
  UpdateContentSchema,
  RequestTerminalSchema,
  ClientTerminalDataSchema,
  PingSchema,
  ClientMessageSchema,
  // Server → Client
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
  ServerMessageSchema,
} from './ws-schemas.js';

// ─── Client → Server ────────────────────────────────────────────

export type FetchDirMessage = z.infer<typeof FetchDirSchema>;
export type FetchContentMessage = z.infer<typeof FetchContentSchema>;
export type UpdateContentMessage = z.infer<typeof UpdateContentSchema>;
export type RequestTerminalMessage = z.infer<typeof RequestTerminalSchema>;
export type ClientTerminalDataMessage = z.infer<typeof ClientTerminalDataSchema>;
export type PingMessage = z.infer<typeof PingSchema>;

/** Discriminated union of every valid client → server message. */
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Server → Client ────────────────────────────────────────────

export type LoadedMessage = z.infer<typeof LoadedSchema>;
export type FileContentMessage = z.infer<typeof FileContentSchema>;
export type AckMessage = z.infer<typeof AckSchema>;
export type ValidationErrorMessage = z.infer<typeof ValidationErrorSchema>;
export type PersistDegradedMessage = z.infer<typeof PersistDegradedSchema>;
export type ServerTerminalDataMessage = z.infer<typeof ServerTerminalDataSchema>;
export type TerminalExitMessage = z.infer<typeof TerminalExitSchema>;
export type PodReadyMessage = z.infer<typeof PodReadySchema>;
export type ErrorMessage = z.infer<typeof ErrorSchema>;
export type PongMessage = z.infer<typeof PongSchema>;

/** Discriminated union of every valid server → client message. */
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ─── Utility types ──────────────────────────────────────────────

/**
 * Extract the payload type for a specific client → server event.
 *
 * @example
 * type P = ClientPayload<'fetchDir'>; // { path: string }
 */
export type ClientPayload<E extends ClientMessage['event']> =
  Extract<ClientMessage, { event: E }>['payload'];

/**
 * Extract the payload type for a specific server → client event.
 *
 * @example
 * type P = ServerPayload<'podReady'>; // { replId: string; previewUrl: string }
 */
export type ServerPayload<E extends ServerMessage['event']> =
  Extract<ServerMessage, { event: E }>['payload'];

/**
 * Map of client event names to their handler signatures.
 * Useful for building type-safe message routers on the Runner.
 *
 * @example
 * const handlers: ClientMessageHandlers = {
 *   fetchDir: (payload) => { ... },
 *   fetchContent: (payload) => { ... },
 *   ...
 * };
 */
export type ClientMessageHandlers = {
  [E in ClientMessage['event']]: (payload: ClientPayload<E>) => void | Promise<void>;
};

/**
 * Map of server event names to their handler signatures.
 * Useful for building type-safe message routers on the client.
 */
export type ServerMessageHandlers = {
  [E in ServerMessage['event']]: (payload: ServerPayload<E>) => void | Promise<void>;
};
