/**
 * EditorPanel Component
 *
 * Monaco Editor wrapper with:
 * - Dynamic import (SSR disabled)
 * - Tab system with unsaved indicators
 * - Debounced saves via WS
 * - Sync status indicator
 * - Welcome screen when no file is open
 * - Language detection from file extension
 */

"use client";

import { useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useWorkspaceStore } from "../../lib/store";
import { useDebouncedSave } from "../../lib/hooks/use-debounced-save";
import { detectLanguage } from "../../lib/utils/language-detect";
import type { ClientMessage } from "@repo/shared";

// ── Dynamic import Monaco (NO SSR) ──────────────────────────────

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="ide-welcome">
      <div className="loader-spinner" />
      <p style={{ fontSize: "13px" }}>Loading editor...</p>
    </div>
  ),
});

// ─── Props ───────────────────────────────────────────────────────

interface EditorPanelProps {
  send: (msg: ClientMessage) => void;
}

// ─── Component ───────────────────────────────────────────────────

export function EditorPanel({ send }: EditorPanelProps) {
  const openFiles = useWorkspaceStore((s) => s.openFiles);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const syncStatus = useWorkspaceStore((s) => s.syncStatus);
  const actions = useWorkspaceStore((s) => s.actions);
  const { save, cancelPending } = useDebouncedSave(send);

  // Find the active file's content
  const activeFileData = useMemo(
    () => openFiles.find((f) => f.path === activeFile),
    [openFiles, activeFile]
  );

  // Monaco language ID
  const language = useMemo(
    () => (activeFile ? detectLanguage(activeFile) : "plaintext"),
    [activeFile]
  );

  // Extract filename from path
  const getFilename = useCallback((path: string) => {
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
  }, []);

  // Tab click handler
  const handleTabClick = useCallback(
    (path: string) => {
      cancelPending();
      actions.setActiveFile(path);
    },
    [actions, cancelPending]
  );

  // Tab close handler
  const handleTabClose = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      cancelPending();
      actions.closeFile(path);
    },
    [actions, cancelPending]
  );

  // Editor content change
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeFile || value === undefined) return;
      actions.updateFileContent(activeFile, value);
      save(activeFile, value);
    },
    [activeFile, actions, save]
  );

  // Sync indicator
  const syncIndicator = useMemo(() => {
    switch (syncStatus) {
      case "saving":
        return { dot: "saving", label: "Saving..." };
      case "saved":
        return { dot: "saved", label: "Saved" };
      case "degraded":
        return { dot: "degraded", label: "Degraded" };
      case "error":
        return { dot: "error", label: "Error" };
      default:
        return null;
    }
  }, [syncStatus]);

  return (
    <div className="ide-editor">
      {/* Tab Bar */}
      <div className="ide-tabs">
        {openFiles.map((file) => (
          <div
            key={file.path}
            className={`ide-tab ${file.path === activeFile ? "active" : ""}`}
            onClick={() => handleTabClick(file.path)}
            title={file.path}
          >
            <span className="truncate">{getFilename(file.path)}</span>
            {file.dirty && (
              <span className="ide-tab-dirty" title="Unsaved changes">
                •
              </span>
            )}
            <button
              className="ide-tab-close"
              onClick={(e) => handleTabClose(e, file.path)}
              aria-label={`Close ${getFilename(file.path)}`}
            >
              ×
            </button>
          </div>
        ))}

        {/* Sync indicator (right side) */}
        {syncIndicator && (
          <div className="sync-indicator" style={{ marginLeft: "auto" }}>
            <span className={`sync-dot ${syncIndicator.dot}`} />
            <span>{syncIndicator.label}</span>
          </div>
        )}
      </div>

      {/* Editor Content */}
      <div className="ide-editor-content">
        {activeFileData ? (
          <MonacoEditor
            key={activeFile}
            height="100%"
            language={language}
            value={activeFileData.content}
            onChange={handleEditorChange}
            theme="vs-dark"
            options={{
              fontSize: 14,
              fontFamily: "var(--font-mono)",
              fontLigatures: true,
              minimap: { enabled: true, maxColumn: 80 },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: "on",
              padding: { top: 12, bottom: 12 },
              smoothScrolling: true,
              cursorSmoothCaretAnimation: "on",
              renderWhitespace: "selection",
              bracketPairColorization: { enabled: true },
              guides: {
                indentation: true,
                bracketPairs: true,
              },
              suggest: {
                showStatusBar: true,
              },
            }}
          />
        ) : (
          <div className="ide-welcome">
            <span className="ide-welcome-icon" aria-hidden="true">
              {"</>"}
            </span>
            <h3>Welcome to BucketCode</h3>
            <p>Select a file from the explorer to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
