/**
 * WebSocket Message Parser & Serializer
 *
 * Provides safe parse/serialize functions used by both Runner and Relay.
 * - Handles JSON.parse failures gracefully
 * - Runs Zod validation and returns structured errors
 * - Serializes with JSON.stringify (single canonical format)
 */

import { ClientMessageSchema, ServerMessageSchema } from './ws-schemas.js';
import type { ClientMessage, ServerMessage } from './ws-types.js';

// ─── Result type ────────────────────────────────────────────────

/**
 * Discriminated result type to avoid throwing exceptions on bad input.
 * Callers check `result.ok` before accessing `data` or `error`.
 */
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Parsers ────────────────────────────────────────────────────

/**
 * Parse a raw WebSocket string as a client → server message.
 *
 * 1. Attempts JSON.parse
 * 2. Validates against `ClientMessageSchema` (Zod)
 * 3. Returns a discriminated `ParseResult`
 *
 * @example
 * const result = parseClientMessage(ws.data);
 * if (!result.ok) {
 *   ws.send(serialize({ event: 'error', payload: createWsError('MALFORMED_MESSAGE', result.error) }));
 *   return;
 * }
 * // result.data is now a fully typed ClientMessage
 * switch (result.data.event) {
 *   case 'fetchDir': handleFetchDir(result.data.payload); break;
 *   ...
 * }
 */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  return parseWithSchema(raw, ClientMessageSchema);
}

/**
 * Parse a raw WebSocket string as a server → client message.
 *
 * Primarily used on the client side (or Relay) to validate
 * messages received from the Runner before processing.
 */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  return parseWithSchema(raw, ServerMessageSchema);
}

// ─── Serializer ─────────────────────────────────────────────────

/**
 * Serialize a client or server message to a JSON string for transmission.
 *
 * No validation is performed here — callers are expected to construct
 * messages using the typed interfaces, which guarantees correctness
 * at compile time.
 */
export function serialize(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

// ─── Internal ───────────────────────────────────────────────────

/**
 * Generic parse helper that handles JSON + Zod in one pass.
 */
function parseWithSchema<T>(
  raw: string,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } } },
): ParseResult<T> {
  // Step 1: JSON parse
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid JSON: message is not valid JSON' };
  }

  // Step 2: Envelope check (fast-fail before Zod for better errors)
  if (typeof json !== 'object' || json === null || !('event' in json)) {
    return { ok: false, error: 'Invalid envelope: message must be an object with an "event" field' };
  }

  // Step 3: Zod validation
  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `Schema validation failed: ${issues}` };
  }

  return { ok: true, data: result.data };
}
