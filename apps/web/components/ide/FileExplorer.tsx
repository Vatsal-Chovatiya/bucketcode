/**
 * FileExplorer Component
 *
 * Recursive file tree with:
 * - Lazy directory expansion (fetches children on click)
 * - File type icons
 * - Active file highlighting
 * - node_modules / .git filtering
 */

"use client";

import { useState, useCallback } from "react";
import { useWorkspaceStore, type FileNode } from "../../lib/store";
import { getFileIcon } from "../../lib/utils/file-icons";
import type { ClientMessage } from "@repo/shared";

// ─── Hidden paths ────────────────────────────────────────────────

const HIDDEN_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "__pycache__",
  ".cache",
  "dist",
]);

// ─── Props ───────────────────────────────────────────────────────

interface FileExplorerProps {
  send: (msg: ClientMessage) => void;
}

// ─── Component ───────────────────────────────────────────────────

export function FileExplorer({ send }: FileExplorerProps) {
  const fileTree = useWorkspaceStore((s) => s.fileTree);

  return (
    <>
      <div className="ide-sidebar-header">
        <span>Explorer</span>
      </div>
      <div className="ide-sidebar-content">
        {fileTree.length === 0 ? (
          <div
            style={{
              padding: "20px 14px",
              color: "var(--text-muted)",
              fontSize: "12px",
              textAlign: "center",
            }}
          >
            Loading files...
          </div>
        ) : (
          <ul className="file-tree" role="tree">
            {fileTree
              .filter((node) => !HIDDEN_DIRS.has(node.name))
              .sort(sortNodes)
              .map((node) => (
                <TreeNode key={node.path} node={node} depth={0} send={send} />
              ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ─── TreeNode (recursive) ────────────────────────────────────────

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  send: (msg: ClientMessage) => void;
}

function TreeNode({ node, depth, send }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const actions = useWorkspaceStore((s) => s.actions);

  const isDir = node.type === "dir";
  const isActive = !isDir && activeFile === node.path;
  const iconInfo = getFileIcon(node.name, isDir);

  const handleClick = useCallback(() => {
    if (isDir) {
      const willExpand = !expanded;
      setExpanded(willExpand);

      // Lazy load: fetch children if expanding and no children loaded yet
      if (willExpand && (!node.children || node.children.length === 0)) {
        send({ event: "fetchDir", payload: { path: node.path } });
      }
    } else {
      // Open file
      send({ event: "fetchContent", payload: { path: node.path } });
      actions.setActiveFile(node.path);
    }
  }, [isDir, expanded, node, send, actions]);

  // Filter hidden directories from children
  const visibleChildren = (node.children || [])
    .filter((child) => !HIDDEN_DIRS.has(child.name))
    .sort(sortNodes);

  return (
    <li role="treeitem" aria-expanded={isDir ? expanded : undefined}>
      <div
        className={`file-tree-item ${isActive ? "active" : ""}`}
        style={{ "--depth": depth } as React.CSSProperties}
        onClick={handleClick}
        title={node.path}
      >
        {/* Chevron for directories */}
        {isDir && (
          <span
            className={`file-tree-chevron ${expanded ? "open" : ""}`}
            aria-hidden="true"
          >
            ▶
          </span>
        )}

        {/* Icon */}
        <span
          className="file-tree-icon"
          style={{ color: iconInfo.color }}
          aria-hidden="true"
        >
          {iconInfo.icon}
        </span>

        {/* Name */}
        <span className="file-tree-name">{node.name}</span>
      </div>

      {/* Children (expanded directories) */}
      {isDir && expanded && visibleChildren.length > 0 && (
        <ul className="file-tree" role="group">
          {visibleChildren.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              send={send}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── Sort helper: directories first, then alphabetical ───────────

function sortNodes(a: FileNode, b: FileNode): number {
  if (a.type === "dir" && b.type !== "dir") return -1;
  if (a.type !== "dir" && b.type === "dir") return 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}
