/**
 * StatusBar Component
 *
 * Bottom status bar showing:
 * - Connection dot (connected/degraded/disconnected)
 * - Pod status
 * - Sync indicator
 * - Language badge
 */

"use client";

import { useWorkspaceStore } from "../../lib/store";
import { detectLanguage } from "../../lib/utils/language-detect";

export function StatusBar() {
  const wsStatus = useWorkspaceStore((s) => s.wsStatus);
  const status = useWorkspaceStore((s) => s.status);
  const syncStatus = useWorkspaceStore((s) => s.syncStatus);
  const activeFile = useWorkspaceStore((s) => s.activeFile);

  const language = activeFile ? detectLanguage(activeFile) : null;

  return (
    <div className="ide-statusbar">
      {/* Connection status */}
      <div className="statusbar-section">
        <span
          className={`statusbar-dot ${wsStatus === "connected" ? "connected" : wsStatus === "degraded" ? "degraded" : "disconnected"}`}
          title={`WebSocket: ${wsStatus}`}
        />
        <span>{wsStatus}</span>
      </div>

      {/* Pod status */}
      <div className="statusbar-section">
        <span style={{ fontSize: 10 }}>⬡</span>
        <span>{status}</span>
      </div>

      {/* Sync status */}
      {syncStatus !== "idle" && (
        <div className="statusbar-section">
          <span
            className={`sync-dot ${syncStatus}`}
            style={{ width: 6, height: 6 }}
          />
          <span>
            {syncStatus === "saving"
              ? "Saving..."
              : syncStatus === "saved"
                ? "Saved"
                : syncStatus === "degraded"
                  ? "Degraded"
                  : "Error"}
          </span>
        </div>
      )}

      {/* Spacer */}
      <div className="statusbar-spacer" />

      {/* Language badge */}
      {language && (
        <div className="statusbar-section">
          <span className="badge badge-info">{language}</span>
        </div>
      )}

      {/* Branding */}
      <div className="statusbar-section" style={{ opacity: 0.5 }}>
        BucketCode
      </div>
    </div>
  );
}
