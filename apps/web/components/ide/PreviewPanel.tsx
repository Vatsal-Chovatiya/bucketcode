/**
 * PreviewPanel Component
 *
 * Iframe preview of the running application with:
 * - Dynamic URL from metadata (dev: localtest.me, prod: custom domain)
 * - Connection state UI: BOOTING / REFUSED / RUNNING / CRASHED
 * - Refresh & open-in-new-tab controls
 * - Listens to podReady event to auto-refresh
 * - Sandbox security attributes
 */

"use client";

import { useCallback } from "react";
import { useWorkspaceStore } from "../../lib/store";

const PREVIEW_DOMAIN =
  process.env.NEXT_PUBLIC_PREVIEW_DOMAIN || "localtest.me";

// ─── Component ───────────────────────────────────────────────────

export function PreviewPanel() {
  const previewState = useWorkspaceStore((s) => s.previewState);
  const previewUrl = useWorkspaceStore((s) => s.previewUrl);
  const replId = useWorkspaceStore((s) => s.replId);

  // Compute the preview URL
  const url =
    previewUrl || `http://${replId}.${PREVIEW_DOMAIN}`;

  // Refresh iframe
  const handleRefresh = useCallback(() => {
    const iframe = document.getElementById(
      "preview-iframe"
    ) as HTMLIFrameElement | null;
    if (iframe) {
      // Force reload by resetting src
      const currentSrc = iframe.src;
      iframe.src = "";
      requestAnimationFrame(() => {
        iframe.src = currentSrc;
      });
    }
  }, []);

  // Open in new tab
  const handleOpenExternal = useCallback(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, [url]);

  return (
    <div className="ide-preview">
      {/* Header bar with URL + controls */}
      <div className="ide-preview-header">
        <span style={{ fontSize: 14, marginRight: 4 }} aria-hidden="true">
          🌐
        </span>

        <div className="ide-preview-url" title={url}>
          {url}
        </div>

        <button
          className="btn btn-ghost btn-sm"
          onClick={handleRefresh}
          title="Refresh preview"
          aria-label="Refresh preview"
        >
          ↻
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleOpenExternal}
          title="Open in new tab"
          aria-label="Open in new tab"
        >
          ↗
        </button>
      </div>

      {/* Content */}
      <div className="ide-preview-content">
        {previewState === "running" ? (
          <iframe
            id="preview-iframe"
            src={url}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="accelerometer; camera; microphone"
            title="Application preview"
          />
        ) : (
          <div className="ide-preview-state">
            <PreviewStateUI state={previewState} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── State-specific UI ───────────────────────────────────────────

function PreviewStateUI({
  state,
}: {
  state: "booting" | "refused" | "running" | "crashed";
}) {
  switch (state) {
    case "booting":
      return (
        <>
          <div className="loader-dots">
            <span />
            <span />
            <span />
          </div>
          <span style={{ fontSize: 13 }}>Starting preview...</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Waiting for your app to start
          </span>
        </>
      );

    case "refused":
      return (
        <>
          <span style={{ fontSize: 32 }} aria-hidden="true">
            🚫
          </span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            App not running
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            Run <code style={{ color: "var(--accent)" }}>npm run dev</code> in
            the terminal to start your app
          </span>
        </>
      );

    case "crashed":
      return (
        <>
          <span style={{ fontSize: 32 }} aria-hidden="true">
            💥
          </span>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--error)" }}>
            App crashed
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Check the terminal for error details
          </span>
        </>
      );

    default:
      return null;
  }
}
