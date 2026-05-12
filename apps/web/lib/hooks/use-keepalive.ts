/**
 * useKeepalive Hook
 *
 * Sends POST /repl/:id/keepalive every 60s to prevent idle timeout.
 * Pauses when the tab is hidden (Page Visibility API).
 * Cleans up on unmount.
 */

"use client";

import { useEffect, useRef } from "react";
import { sendKeepalive } from "../api";

const KEEPALIVE_INTERVAL_MS = 60_000; // 60 seconds

export function useKeepalive(replId: string, enabled: boolean = true) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!replId || !enabled) return;

    const start = () => {
      // Don't start if already running
      if (intervalRef.current) return;

      intervalRef.current = setInterval(async () => {
        try {
          abortRef.current = new AbortController();
          await sendKeepalive(replId, abortRef.current.signal);
        } catch (err) {
          // Silently ignore — keepalive is best-effort
          if (err instanceof Error && err.name !== "AbortError") {
            console.warn("[Keepalive] Failed:", err.message);
          }
        }
      }, KEEPALIVE_INTERVAL_MS);
    };

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      abortRef.current?.abort();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    // Start immediately
    start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [replId, enabled]);
}
