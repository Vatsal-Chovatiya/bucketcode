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

import { useEffect } from "react";
import { useWebSocket } from "../../../lib/hooks/use-websocket";
import { useKeepalive } from "../../../lib/hooks/use-keepalive";
import { useWorkspaceStore } from "../../../lib/store";
import { startWorkspace, getWorkspaceStatus } from "../../../lib/api";
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

// ─── Language Mapping ──────────────────────────────────────────
// DB stores Prisma enum strings (NODE_JS, REACT).
// Orchestrator expects kebab-case slugs (node-js, react).
const DB_LANG_TO_SLUG: Record<string, "node-js" | "react"> = {
  NODE_JS: "node-js",
  REACT: "react",
};

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
  // When the page loads with status STARTING, we kick off two things:
  // 1. Call POST /start to provision the k8s Pod + Service + Ingress.
  // 2. Poll the orchestrator until status becomes RUNNING, then flip the
  //    workspace state to CONNECTING so the WS hook actually connects.
  //    This prevents WS connection spam while the pod is still booting.

  useEffect(() => {
    if (initialStatus !== "STARTING" && initialStatus !== "RUNNING") return;

    if (initialStatus === "RUNNING") {
      // Pod is already running — skip provisioning, jump straight to WS
      actions.setStatus("CONNECTING");
      return;
    }

    // initialStatus === "STARTING": provision the pod, then poll for RUNNING
    const langSlug = DB_LANG_TO_SLUG[language] ?? "node-js";
    let cancelled = false;

    const provisionAndPoll = async () => {
      try {
        await startWorkspace(replId, langSlug);
      } catch (err) {
        // /start is idempotent — 200 means already running, which is fine
        console.warn("[Workspace] startWorkspace call:", err);
      }

      // Poll orchestrator every 2s until RUNNING or TERMINATED
      const POLL_INTERVAL_MS = 2000;
      const MAX_POLLS = 60; // 2 min timeout
      let polls = 0;

      while (!cancelled && polls < MAX_POLLS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        polls++;

        try {
          const statusRes = await getWorkspaceStatus(replId);

          if (statusRes.status === "RUNNING") {
            if (!cancelled) actions.setStatus("CONNECTING");
            return;
          }

          if (statusRes.status === "TERMINATED") {
            if (!cancelled) actions.setStatus("TERMINATED");
            return;
          }
        } catch (err) {
          // Non-fatal — orchestrator may be momentarily unavailable
          console.warn("[Workspace] Status poll error:", err);
        }
      }

      if (!cancelled) {
        toast.error("Workspace took too long to start. Please try again.");
        actions.setStatus("TERMINATED");
      }
    };

    provisionAndPoll();

    return () => {
      cancelled = true;
    };
  }, [replId, language, initialStatus, actions]);

  // ── WebSocket connection ───────────────────────
  // Only connect WS once the pod is RUNNING (CONNECTING state).
  // During BOOTING / COPYING the pod isn't ready — connecting early causes
  // repeated error logs and unnecessary WS upgrade failures.

  const shouldConnectWs =
    workspaceStatus !== "TERMINATED" &&
    workspaceStatus !== "IDLE" &&
    workspaceStatus !== "BOOTING" &&
    workspaceStatus !== "COPYING";
  const { send } = useWebSocket(shouldConnectWs ? replId : "");

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
  const isTerminated = workspaceStatus === "TERMINATED" || workspaceStatus === "IDLE";
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
