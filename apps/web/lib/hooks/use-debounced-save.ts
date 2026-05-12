/**
 * useDebouncedSave Hook
 *
 * Debounces file content saves over WebSocket.
 * - 500ms debounce after last keystroke
 * - Updates sync indicator: idle → saving → saved
 * - Cancels pending save on file switch or unmount
 */

"use client";

import { useRef, useCallback, useEffect } from "react";
import debounce from "lodash.debounce";
import { useWorkspaceStore } from "../store";
import type { ClientMessage } from "@repo/shared";

const DEBOUNCE_MS = 500;
const ACK_TIMEOUT_MS = 5000;

export function useDebouncedSave(
  send: (msg: ClientMessage) => void
) {
  const actions = useWorkspaceStore((s) => s.actions);
  const ackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create a stable debounced function
  const debouncedSendRef = useRef(
    debounce((path: string, content: string) => {
      actions.setSyncStatus("saving");
      send({
        event: "updateContent",
        payload: { path, content },
      });

      // If no ack within 5s, mark as degraded
      if (ackTimeoutRef.current) {
        clearTimeout(ackTimeoutRef.current);
      }
      ackTimeoutRef.current = setTimeout(() => {
        const currentSync = useWorkspaceStore.getState().syncStatus;
        if (currentSync === "saving") {
          actions.setSyncStatus("degraded");
        }
      }, ACK_TIMEOUT_MS);
    }, DEBOUNCE_MS)
  );

  // Save function exposed to components
  const save = useCallback(
    (path: string, content: string) => {
      actions.markDirty(path);
      actions.setSyncStatus("saving");
      debouncedSendRef.current(path, content);
    },
    [actions]
  );

  // Cancel on unmount
  useEffect(() => {
    return () => {
      debouncedSendRef.current.cancel();
      if (ackTimeoutRef.current) {
        clearTimeout(ackTimeoutRef.current);
      }
    };
  }, []);

  // Cancel pending save (call when switching files)
  const cancelPending = useCallback(() => {
    debouncedSendRef.current.cancel();
    if (ackTimeoutRef.current) {
      clearTimeout(ackTimeoutRef.current);
      ackTimeoutRef.current = null;
    }
  }, []);

  return { save, cancelPending };
}
