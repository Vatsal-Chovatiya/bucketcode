/**
 * TerminalPanel Component
 *
 * xterm.js terminal with:
 * - Dynamic import (SSR disabled)
 * - FitAddon for responsive sizing
 * - WebGL addon with canvas fallback
 * - PTY session via WS
 * - ResizeObserver for container resize
 * - Exit/restart UI
 * - StrictMode guard via useRef
 */

"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useWorkspaceStore } from "../../lib/store";
import type { ClientMessage } from "@repo/shared";

// ─── Props ───────────────────────────────────────────────────────

interface TerminalPanelProps {
  send: (msg: ClientMessage) => void;
}

// ─── Component ───────────────────────────────────────────────────

export function TerminalPanel({ send }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<any>(null); // xterm.Terminal instance
  const fitAddonRef = useRef<any>(null); // FitAddon instance
  const initializedRef = useRef(false);
  const terminalSession = useWorkspaceStore((s) => s.terminalSession);
  const actions = useWorkspaceStore((s) => s.actions);
  const [isLoading, setIsLoading] = useState(true);

  // ── Initialize terminal ────────────────────────

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    let terminal: any;
    let fitAddon: any;
    let resizeObserver: ResizeObserver | null = null;

    const init = async () => {
      try {
        // Dynamic import xterm (browser only)
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);

        // Import CSS
        await import("@xterm/xterm/css/xterm.css");

        terminal = new Terminal({
          cursorBlink: true,
          cursorStyle: "bar",
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          theme: {
            background: "#0d1117",
            foreground: "#e6edf3",
            cursor: "#e6edf3",
            selectionBackground: "#264f78",
            black: "#484f58",
            red: "#f85149",
            green: "#3fb950",
            yellow: "#d29922",
            blue: "#58a6ff",
            magenta: "#bc8cff",
            cyan: "#39c5cf",
            white: "#b1bac4",
            brightBlack: "#6e7681",
            brightRed: "#ffa198",
            brightGreen: "#56d364",
            brightYellow: "#e3b341",
            brightBlue: "#79c0ff",
            brightMagenta: "#d2a8ff",
            brightCyan: "#56d4dd",
            brightWhite: "#f0f6fc",
          },
          allowProposedApi: true,
        });

        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);

        // Try WebGL addon, fall back to canvas
        try {
          const { WebglAddon } = await import("@xterm/addon-webgl");
          const webglAddon = new WebglAddon();
          terminal.loadAddon(webglAddon);
          webglAddon.onContextLoss(() => {
            webglAddon.dispose();
          });
        } catch {
          // WebGL not available — canvas fallback (default)
        }

        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;

        // Mount to DOM
        terminal.open(containerRef.current!);
        fitAddon.fit();

        setIsLoading(false);

        // Request PTY session
        send({
          event: "requestTerminal",
          payload: { cols: terminal.cols, rows: terminal.rows },
        });

        actions.setTerminalSession({ active: true });

        // Forward keystrokes to server
        terminal.onData((data: string) => {
          send({ event: "terminalData", payload: data });
        });

        // ResizeObserver for container resizing
        resizeObserver = new ResizeObserver(() => {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit();
            if (terminalRef.current) {
              send({
                event: "requestTerminal",
                payload: {
                  cols: terminalRef.current.cols,
                  rows: terminalRef.current.rows,
                },
              });
            }
          }
        });
        resizeObserver.observe(containerRef.current!);
      } catch (err) {
        console.error("[TerminalPanel] Failed to initialize:", err);
        setIsLoading(false);
      }
    };

    init();

    // Listen for terminal data from WS (via custom DOM event)
    const handleTermData = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (terminalRef.current && typeof data === "string") {
        terminalRef.current.write(data);
      }
    };

    window.addEventListener("ws:terminalData", handleTermData);

    return () => {
      window.removeEventListener("ws:terminalData", handleTermData);
      resizeObserver?.disconnect();
      if (terminal) {
        terminal.dispose();
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
    };
  }, [send, actions]);

  // ── Restart handler ────────────────────────────

  const handleRestart = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.clear();
      send({
        event: "requestTerminal",
        payload: {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        },
      });
      actions.setTerminalSession({ active: true });
    }
  }, [send, actions]);

  return (
    <div className="ide-terminal">
      <div className="ide-terminal-header">
        <span>
          💻 Terminal
          {terminalSession && !terminalSession.active && (
            <span style={{ color: "var(--error)", marginLeft: 8 }}>
              (exited: {terminalSession.exitCode ?? "?"})
            </span>
          )}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {terminalSession && !terminalSession.active && (
            <button className="btn btn-ghost btn-sm" onClick={handleRestart}>
              ↻ Restart
            </button>
          )}
        </div>
      </div>

      <div className="ide-terminal-content" ref={containerRef}>
        {isLoading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            <div className="loader-spinner" />
          </div>
        )}
      </div>

      {/* Exit overlay */}
      {terminalSession && !terminalSession.active && (
        <div className="ide-terminal-exit">
          <span>Terminal session ended</span>
          <button className="btn btn-secondary btn-sm" onClick={handleRestart}>
            ↻ Restart Terminal
          </button>
          <span
            style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}
          >
            Terminal reset. Run your command again.
          </span>
        </div>
      )}
    </div>
  );
}
