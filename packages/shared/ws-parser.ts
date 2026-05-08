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


export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };


export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  return parseWithSchema(raw, ClientMessageSchema);
}


export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  return parseWithSchema(raw, ServerMessageSchema);
}


export function serialize(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}


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
