/**
 * useWebSocket Hook
 *
 * React hook wrapping the WsClient class.
 * - Connects on mount, disconnects on unmount
 * - Routes all server messages to Zustand store actions
 * - Survives React StrictMode double-mount
 * - Returns send() function and connection status
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import { WsClient, getAuthToken } from "../ws-client";
import { useWorkspaceStore } from "../store";
import type { ServerMessage, ClientMessage } from "@repo/shared";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3003";

export function useWebSocket(replId: string) {
  const clientRef = useRef<WsClient | null>(null);
  const actions = useWorkspaceStore((s) => s.actions);

  // ── Message Router ─────────────────────────────

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.event) {
        case "loaded":
          actions.setFileTree(msg.payload.tree);
          actions.setStatus("READY");
          break;

        case "fileContent":
          actions.openFile(msg.payload.path, msg.payload.content);
          break;

        case "ack":
          if (msg.payload.saved) {
            actions.markSaved(msg.payload.path);
            actions.setSyncStatus("saved");
          } else {
            actions.setSyncStatus("degraded");
          }
          break;

        case "validationError":
          toast.error(`Validation: ${msg.payload.reason}`, {
            duration: 5000,
            id: `validation-${msg.payload.path}`,
          });
          actions.setSyncStatus("error");
          break;

        case "persistDegraded":
          actions.setPersistBanner(msg.payload.message);
          actions.setSyncStatus("degraded");
          toast.error(msg.payload.message, {
            duration: 8000,
            id: "persist-degraded",
          });
          break;

        case "terminalData":
          // Terminal component handles this via its own listener
          // We dispatch a custom DOM event to avoid tight coupling
          window.dispatchEvent(
            new CustomEvent("ws:terminalData", {
              detail: msg.payload,
            })
          );
          break;

        case "terminalExit":
          actions.setTerminalSession({
            active: false,
            exitCode: msg.payload.code,
            signal: msg.payload.signal,
          });
          break;

        case "podReady":
          actions.setPreviewUrl(msg.payload.previewUrl);
          actions.setPreviewState("running");
          actions.setStatus("READY");
          break;

        case "error":
          toast.error(`[${msg.payload.code}] ${msg.payload.message}`, {
            duration: 6000,
          });
          break;

        case "pong":
          // Pong handled internally by WsClient (resets keepalive timer)
          break;

        default: {
          // Exhaustive check — TypeScript will flag unhandled events
          const _exhaustive: never = msg;
          console.warn("[useWebSocket] Unhandled event:", _exhaustive);
        }
      }
    },
    [actions]
  );

  // ── Status Change Handler ──────────────────────

  const handleStatusChange = useCallback(
    (status: "disconnected" | "connecting" | "connected" | "degraded") => {
      actions.setWsStatus(status);

      if (status === "connected") {
        actions.setPersistBanner(null);
      }
    },
    [actions]
  );

  // ── Lifecycle ──────────────────────────────────

  useEffect(() => {
    if (!replId) return;

    // StrictMode guard: only create client if we don't have one
    if (clientRef.current) {
      clientRef.current.dispose();
    }

    const token = getAuthToken();
    const client = new WsClient({
      replId,
      wsUrl: WS_URL,
      token,
      onMessage: handleMessage,
      onStatusChange: handleStatusChange,
    });

    clientRef.current = client;
    actions.setStatus("CONNECTING");
    client.connect();

    return () => {
      client.dispose();
      if (clientRef.current === client) {
        clientRef.current = null;
      }
    };
  }, [replId, handleMessage, handleStatusChange, actions]);

  // ── Send Function ──────────────────────────────

  const send = useCallback((message: ClientMessage) => {
    clientRef.current?.send(message);
  }, []);

  return { send };
}
