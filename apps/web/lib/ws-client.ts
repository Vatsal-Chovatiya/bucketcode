/**
 * WebSocket Client Manager
 *
 * React-safe WS manager that handles:
 * - Auth token injection
 * - Reconnect with exponential backoff (max 30s)
 * - Ping/pong keepalive (30s interval)
 * - Message queuing during disconnect
 * - StrictMode double-mount protection
 * - Message routing to store actions
 *
 * This is a class (not a hook) so it can be instantiated in useRef
 * and survive React re-renders without duplicate connections.
 */

import type { ServerMessage, ClientMessage } from "@repo/shared";

// ─── Types ───────────────────────────────────────────────────────

export type WsClientStatus = "disconnected" | "connecting" | "connected" | "degraded";

export type ServerMessageHandler = (message: ServerMessage) => void;

export interface WsClientOptions {
  replId: string;
  wsUrl: string;
  token: string;
  onMessage: ServerMessageHandler;
  onStatusChange: (status: WsClientStatus) => void;
  /** Called when reconnect attempts are exhausted. */
  onPermanentDisconnect?: () => void;
}

interface QueuedMessage {
  message: ClientMessage;
  timestamp: number;
}

// ─── Constants ───────────────────────────────────────────────────

const PING_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const QUEUE_MAX_AGE_MS = 60_000; // drop queued messages older than 1 min
const MAX_RECONNECT_ATTEMPTS = 10; // give up after ~5.5min total

// ─── Auth Helper (Stubbed) ───────────────────────────────────────

/**
 * Retrieves the auth token for WS connections.
 * TODO: Replace with real auth when implemented.
 */
export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("bucketcode_token") || "dev-token-stub";
}

// ─── WS Client Class ────────────────────────────────────────────

export class WsClient {
  private ws: WebSocket | null = null;
  private options: WsClientOptions;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: QueuedMessage[] = [];
  private disposed = false;

  constructor(options: WsClientOptions) {
    this.options = options;
  }

  // ── Public API ─────────────────────────────────

  /** Initiate WS connection. Safe to call multiple times. */
  connect(): void {
    if (this.disposed) return;

    // StrictMode guard: don't double-connect
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this.options.onStatusChange("connecting");

    const { wsUrl, replId, token } = this.options;
    const url = `${wsUrl}?replId=${encodeURIComponent(replId)}&token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error("[WsClient] Failed to create WebSocket:", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = this.handleOpen;
    this.ws.onmessage = this.handleMessage;
    this.ws.onclose = this.handleClose;
    this.ws.onerror = this.handleError;
  }

  /** Send a client→server message. Queues if disconnected. */
  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue for replay on reconnect
      this.messageQueue.push({ message, timestamp: Date.now() });
    }
  }

  /** Clean shutdown. Prevents reconnect. */
  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close(1000, "Client disposed");
      }
      this.ws = null;
    }
    this.messageQueue = [];
    this.options.onStatusChange("disconnected");
  }

  /** Current connection readyState */
  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  // ── Event Handlers ─────────────────────────────

  private handleOpen = (): void => {
    this.reconnectAttempts = 0;
    this.options.onStatusChange("connected");
    this.startPing();
    this.flushQueue();

    // Request initial file tree
    this.send({ event: "fetchDir", payload: { path: "/" } });
  };

  private handleMessage = (event: MessageEvent): void => {
    let data: unknown;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      console.warn("[WsClient] Received non-JSON message:", event.data);
      return;
    }

    // Reset pong timer on any message (server is alive)
    this.resetPongTimer();

    // Route to handler
    this.options.onMessage(data as ServerMessage);
  };

  private handleClose = (event: CloseEvent): void => {
    this.clearTimers();

    if (this.disposed) return;

    // Handle specific close codes
    if (
      event.code === 4001 || // Auth failure
      event.code === 1008 || // Policy violation
      event.code === 4010    // Repl terminated (410 Gone from server)
    ) {
      // Fatal — don't reconnect
      console.warn(`[WsClient] Permanent disconnect (code: ${event.code})`); 
      this.options.onStatusChange("disconnected");
      this.options.onPermanentDisconnect?.();
      return;
    }

    this.options.onStatusChange("disconnected");

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[WsClient] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`
      );
      this.options.onPermanentDisconnect?.();
      return;
    }

    this.scheduleReconnect();
  };

  private handleError = (): void => {
    // onerror is always followed by onclose, so we just log
    console.warn("[WsClient] Connection error");
  };

  // ── Reconnect ──────────────────────────────────

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    );

    console.log(
      `[WsClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  // ── Ping/Pong ──────────────────────────────────

  private startPing(): void {
    this.clearPingTimers();

    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ event: "ping", payload: {} });
        this.startPongTimeout();
      }
    }, PING_INTERVAL_MS);
  }

  private startPongTimeout(): void {
    this.pongTimer = setTimeout(() => {
      // No pong received — connection may be dead
      console.warn("[WsClient] Pong timeout — connection degraded");
      this.options.onStatusChange("degraded");
    }, PING_INTERVAL_MS);
  }

  private resetPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  // ── Queue Management ───────────────────────────

  private flushQueue(): void {
    const now = Date.now();
    // Filter out stale messages
    const validMessages = this.messageQueue.filter(
      (q) => now - q.timestamp < QUEUE_MAX_AGE_MS
    );
    this.messageQueue = [];

    for (const queued of validMessages) {
      this.send(queued.message);
    }

    if (validMessages.length > 0) {
      console.log(`[WsClient] Flushed ${validMessages.length} queued messages`);
    }
  }

  // ── Timer Cleanup ──────────────────────────────

  private clearPingTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.resetPongTimer();
  }

  private clearTimers(): void {
    this.clearPingTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
