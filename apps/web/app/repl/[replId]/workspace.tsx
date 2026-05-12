/**
 * Workspace — Client Component
 *
 * The full IDE layout rendered on the client side.
 * Manages:
 * - WS connection to Relay
 * - All IDE panels: FileExplorer, EditorPanel, TerminalPanel, PreviewPanel
 * - StatusBar
 * - Lifecycle overlays (booting, connecting, reconnecting, idle)
 * - Persist degraded banner
 * - Keyboard shortcuts (Ctrl+S)
 * - HTTP keepalive
 */

"use client";

import { useEffect, useCallback } from "react";
import { useWebSocket } from "../../../lib/hooks/use-websocket";
import { useKeepalive } from "../../../lib/hooks/use-keepalive";
import { useWorkspaceStore } from "../../../lib/store";
import { startWorkspace } from "../../../lib/api";
import { FileExplorer } from "../../../components/ide/FileExplorer";
import { EditorPanel } from "../../../components/ide/EditorPanel";
import { TerminalPanel } from "../../../components/ide/TerminalPanel";
import { PreviewPanel } from "../../../components/ide/PreviewPanel";
import { StatusBar } from "../../../components/ui/StatusBar";
import {
  BootingOverlay,
  ConnectingOverlay,
  ReconnectingOverlay,
  IdleOverlay,
  PersistBanner,
} from "../../../components/ui/OverlayStates";
import toast from "react-hot-toast";
import "./../../ide.css";

// ─── Props (from server component) ───────────────────────────────

interface WorkspaceProps {
  replId: string;
  language: string;
  previewUrl: string | null;
  status: string;
  ownerId: string;
  replName: string;
}

// ─── Component ───────────────────────────────────────────────────

export function Workspace({
  replId,
  language,
  previewUrl,
  status: initialStatus,
  ownerId,
  replName,
}: WorkspaceProps) {
  const actions = useWorkspaceStore((s) => s.actions);
  const wsStatus = useWorkspaceStore((s) => s.wsStatus);
  const workspaceStatus = useWorkspaceStore((s) => s.status);
  const persistBanner = useWorkspaceStore((s) => s.persistBanner);

  // ── Initialize store ───────────────────────────

  useEffect(() => {
    actions.setReplId(replId);
    if (previewUrl) {
      actions.setPreviewUrl(previewUrl);
    }

    // If workspace is terminated, show idle overlay
    if (initialStatus === "TERMINATED" || initialStatus === "IDLE") {
      actions.setStatus("TERMINATED");
    } else if (initialStatus === "STARTING") {
      actions.setStatus("BOOTING");
    } else {
      actions.setStatus("CONNECTING");
    }

    return () => {
      actions.reset();
    };
  }, [replId, previewUrl, initialStatus, actions]);

  // ── Auto-start workspace if STARTING ───────────

  useEffect(() => {
    if (initialStatus === "STARTING" || initialStatus === "RUNNING") {
      // Already starting or running — the WS connection will handle it
      if (initialStatus === "STARTING") {
        const lang = language === "NODE_JS" ? "node-js" : "python";
        startWorkspace(replId, lang as "node-js" | "python").catch((err) => {
          console.warn("[Workspace] Auto-start failed:", err);
        });
      }
    }
  }, [replId, language, initialStatus]);

  // ── WebSocket connection ───────────────────────

  const isTerminated = workspaceStatus === "TERMINATED" || workspaceStatus === "IDLE";
  const { send } = useWebSocket(isTerminated ? "" : replId);

  // ── HTTP keepalive ─────────────────────────────

  useKeepalive(replId, wsStatus === "connected");

  // ── Keyboard shortcuts ─────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S / Cmd+S — prevent browser save dialog
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        // The debounced save handles this automatically
        // This just prevents the browser dialog
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Determine overlay state ────────────────────

  const showBootingOverlay = workspaceStatus === "BOOTING" || workspaceStatus === "COPYING";
  const showConnectingOverlay = workspaceStatus === "CONNECTING" && wsStatus === "connecting";
  const showReconnectingOverlay = workspaceStatus === "READY" && wsStatus === "disconnected";
  const showIdleOverlay = isTerminated;
  const showIDE = workspaceStatus === "READY" || workspaceStatus === "CONNECTING";

  return (
    <div className="ide-container" style={{ position: "relative" }}>
      {/* Persist degraded banner */}
      {persistBanner && <PersistBanner message={persistBanner} />}

      {/* Sidebar: File Explorer */}
      <aside className="ide-sidebar">
        <FileExplorer send={send} />
      </aside>

      {/* Main content area */}
      <main className="ide-main">
        {showIDE ? (
          <>
            <EditorPanel send={send} />
            <TerminalPanel send={send} />
            <PreviewPanel />
          </>
        ) : (
          <div style={{ flex: 1 }} />
        )}
      </main>

      {/* Status Bar */}
      <StatusBar />

      {/* Lifecycle Overlays */}
      {showBootingOverlay && <BootingOverlay />}
      {showConnectingOverlay && <ConnectingOverlay />}
      {showReconnectingOverlay && <ReconnectingOverlay />}
      {showIdleOverlay && <IdleOverlay replId={replId} language={language} />}
    </div>
  );
}
