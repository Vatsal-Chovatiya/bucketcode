/**
 * Zustand Workspace Store
 *
 * Single source of truth for the entire IDE state.
 * Uses selector-based access to prevent unnecessary re-renders.
 *
 * Usage:
 *   const activeFile = useWorkspaceStore(s => s.activeFile);
 *   const { openFile, closeFile } = useWorkspaceStore(s => s.actions);
 */

import { create } from "zustand";

// ─── Types ───────────────────────────────────────────────────────

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FileNode[];
}

export interface OpenFile {
  path: string;
  content: string;
  dirty: boolean;
}

export type WorkspaceStatus =
  | "COPYING"
  | "BOOTING"
  | "CONNECTING"
  | "READY"
  | "IDLE"
  | "TERMINATED";

export type WsStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "degraded";

export type SyncStatus =
  | "idle"
  | "saving"
  | "saved"
  | "degraded"
  | "error";

export type PreviewState =
  | "booting"
  | "refused"
  | "running"
  | "crashed";

export interface TerminalSession {
  active: boolean;
  exitCode?: number;
  signal?: string;
}

// ─── Store Shape ─────────────────────────────────────────────────

interface WorkspaceActions {
  // Lifecycle
  setReplId: (replId: string) => void;
  setStatus: (status: WorkspaceStatus) => void;
  setWsStatus: (status: WsStatus) => void;

  // File tree
  setFileTree: (tree: FileNode[]) => void;
  mergeSubtree: (parentPath: string, children: FileNode[]) => void;

  // Open files / tabs
  openFile: (path: string, content: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  updateFileContent: (path: string, content: string) => void;
  markDirty: (path: string) => void;
  markSaved: (path: string) => void;
  markAllClean: () => void;

  // Sync
  setSyncStatus: (status: SyncStatus) => void;

  // Terminal
  setTerminalSession: (session: TerminalSession | null) => void;

  // Preview
  setPreviewState: (state: PreviewState) => void;
  setPreviewUrl: (url: string | null) => void;

  // Banners
  setPersistBanner: (message: string | null) => void;

  // Reset
  reset: () => void;
}

export interface WorkspaceState {
  replId: string;
  status: WorkspaceStatus;
  wsStatus: WsStatus;
  fileTree: FileNode[];
  openFiles: OpenFile[];
  activeFile: string | null;
  syncStatus: SyncStatus;
  terminalSession: TerminalSession | null;
  previewState: PreviewState;
  previewUrl: string | null;
  persistBanner: string | null;
  actions: WorkspaceActions;
}

// ─── Initial State ───────────────────────────────────────────────

const INITIAL_STATE = {
  replId: "",
  status: "BOOTING" as WorkspaceStatus,
  wsStatus: "disconnected" as WsStatus,
  fileTree: [] as FileNode[],
  openFiles: [] as OpenFile[],
  activeFile: null as string | null,
  syncStatus: "idle" as SyncStatus,
  terminalSession: null as TerminalSession | null,
  previewState: "booting" as PreviewState,
  previewUrl: null as string | null,
  persistBanner: null as string | null,
};

// ─── Store ───────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  ...INITIAL_STATE,

  actions: {
    // ── Lifecycle ──────────────────────────────────
    setReplId: (replId) => set({ replId }),
    setStatus: (status) => set({ status }),
    setWsStatus: (status) => set({ wsStatus: status }),

    // ── File tree ──────────────────────────────────
    setFileTree: (tree) => set({ fileTree: tree }),

    mergeSubtree: (parentPath, children) => {
      set((state) => ({
        fileTree: mergeTreeNodes(state.fileTree, parentPath, children),
      }));
    },

    // ── Open files / tabs ──────────────────────────
    openFile: (path, content) => {
      const state = get();
      const existing = state.openFiles.find((f) => f.path === path);
      if (existing) {
        // Already open — just activate and update content
        set({
          activeFile: path,
          openFiles: state.openFiles.map((f) =>
            f.path === path ? { ...f, content } : f
          ),
        });
      } else {
        set({
          activeFile: path,
          openFiles: [...state.openFiles, { path, content, dirty: false }],
        });
      }
    },

    closeFile: (path) => {
      const state = get();
      const remaining = state.openFiles.filter((f) => f.path !== path);
      const newActive =
        state.activeFile === path
          ? remaining.length > 0
            ? remaining[remaining.length - 1]!.path
            : null
          : state.activeFile;
      set({ openFiles: remaining, activeFile: newActive });
    },

    setActiveFile: (path) => set({ activeFile: path }),

    updateFileContent: (path, content) => {
      set((state) => ({
        openFiles: state.openFiles.map((f) =>
          f.path === path ? { ...f, content, dirty: true } : f
        ),
      }));
    },

    markDirty: (path) => {
      set((state) => ({
        openFiles: state.openFiles.map((f) =>
          f.path === path ? { ...f, dirty: true } : f
        ),
      }));
    },

    markSaved: (path) => {
      set((state) => ({
        openFiles: state.openFiles.map((f) =>
          f.path === path ? { ...f, dirty: false } : f
        ),
      }));
    },

    markAllClean: () => {
      set((state) => ({
        openFiles: state.openFiles.map((f) => ({ ...f, dirty: false })),
      }));
    },

    // ── Sync ───────────────────────────────────────
    setSyncStatus: (syncStatus) => set({ syncStatus }),

    // ── Terminal ───────────────────────────────────
    setTerminalSession: (terminalSession) => set({ terminalSession }),

    // ── Preview ────────────────────────────────────
    setPreviewState: (previewState) => set({ previewState }),
    setPreviewUrl: (previewUrl) => set({ previewUrl }),

    // ── Banners ────────────────────────────────────
    setPersistBanner: (persistBanner) => set({ persistBanner }),

    // ── Reset ──────────────────────────────────────
    reset: () => set(INITIAL_STATE),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Recursively merges children into the tree at the specified parent path.
 * Used for lazy-loading subdirectories without refetching the entire tree.
 */
function mergeTreeNodes(
  nodes: FileNode[],
  parentPath: string,
  children: FileNode[]
): FileNode[] {
  return nodes.map((node) => {
    if (node.path === parentPath && node.type === "dir") {
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: mergeTreeNodes(node.children, parentPath, children),
      };
    }
    return node;
  });
}
