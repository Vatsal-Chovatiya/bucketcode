/**
 * OverlayStates Component
 *
 * Lifecycle overlays for the IDE workspace:
 * - BootingOverlay: "Initializing workspace..."
 * - ConnectingOverlay: "Establishing connection..."
 * - ReconnectingOverlay: "Reconnecting..." with attempt info
 * - IdleOverlay: "Workspace paused. Click to resume."
 * - PersistBanner: "Changes aren't being saved right now."
 * - AuthExpiredModal: "Session expired."
 */

"use client";

import { useCallback } from "react";
import toast from "react-hot-toast";
import { useWorkspaceStore } from "../../lib/store";
import { startWorkspace } from "../../lib/api";

// ─── Booting Overlay ─────────────────────────────────────────────

export function BootingOverlay() {
  return (
    <div className="ide-overlay">
      <div className="loader-dots">
        <span />
        <span />
        <span />
      </div>
      <h2 className="ide-overlay-title">Initializing workspace...</h2>
      <p className="ide-overlay-text">
        Setting up your development environment. This usually takes 10–20
        seconds.
      </p>
    </div>
  );
}

// ─── Connecting Overlay ──────────────────────────────────────────

export function ConnectingOverlay() {
  return (
    <div className="ide-overlay">
      <div className="loader-spinner" style={{ width: 32, height: 32 }} />
      <h2 className="ide-overlay-title">Establishing connection...</h2>
      <p className="ide-overlay-text">
        Connecting to your workspace. Please wait.
      </p>
    </div>
  );
}

// ─── Reconnecting Overlay ────────────────────────────────────────

export function ReconnectingOverlay() {
  return (
    <div className="ide-overlay">
      <div className="loader-spinner" style={{ width: 32, height: 32 }} />
      <h2 className="ide-overlay-title">Reconnecting...</h2>
      <p className="ide-overlay-text">
        Lost connection to the workspace. Attempting to reconnect automatically.
        <br />
        Your unsaved changes are preserved locally.
      </p>
    </div>
  );
}

// ─── Idle / Terminated Overlay ───────────────────────────────────

interface IdleOverlayProps {
  replId: string;
  language: string;
}

export function IdleOverlay({ replId, language }: IdleOverlayProps) {
  const actions = useWorkspaceStore((s) => s.actions);

  const handleResume = useCallback(async () => {
    try {
      actions.setStatus("BOOTING");
      const lang = language === "NODE_JS" ? "node-js" : "python";
      await startWorkspace(replId, lang as "node-js" | "python");
      toast.success("Workspace resuming...");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to resume workspace";
      toast.error(msg);
      actions.setStatus("TERMINATED");
    }
  }, [replId, language, actions]);

  return (
    <div className="ide-overlay">
      <span style={{ fontSize: 48 }} aria-hidden="true">
        💤
      </span>
      <h2 className="ide-overlay-title">Workspace paused</h2>
      <p className="ide-overlay-text">
        This workspace was paused to save resources.
        <br />
        Your files are safe. Click below to resume.
      </p>
      <button className="btn btn-primary btn-lg" onClick={handleResume}>
        Resume Workspace →
      </button>
      <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
        Cold boot takes ~15 seconds
      </span>
    </div>
  );
}

// ─── Persist Degraded Banner ─────────────────────────────────────

interface PersistBannerProps {
  message: string;
}

export function PersistBanner({ message }: PersistBannerProps) {
  return (
    <div className="ide-banner">
      <span aria-hidden="true">⚠️</span>
      <span>{message}</span>
    </div>
  );
}

// ─── Auth Expired Modal ──────────────────────────────────────────

export function AuthExpiredModal() {
  const handleReAuth = useCallback(() => {
    // TODO: Implement proper re-auth flow
    // For now, reload the page
    window.location.reload();
  }, []);

  return (
    <div
      className="ide-overlay"
      style={{ zIndex: "var(--z-modal)" } as React.CSSProperties}
    >
      <span style={{ fontSize: 48 }} aria-hidden="true">
        🔒
      </span>
      <h2 className="ide-overlay-title">Session expired</h2>
      <p className="ide-overlay-text">
        Your session has expired. Please re-authenticate to continue.
      </p>
      <button className="btn btn-primary" onClick={handleReAuth}>
        Re-authenticate
      </button>
    </div>
  );
}
