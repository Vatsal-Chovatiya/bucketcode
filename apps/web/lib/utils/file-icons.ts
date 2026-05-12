/**
 * File Icons Utility
 *
 * Maps file extensions to emoji icons and colors for the file explorer.
 */

interface FileIconInfo {
  icon: string;
  color: string;
}

const EXTENSION_MAP: Record<string, FileIconInfo> = {
  // JavaScript / TypeScript
  ".js": { icon: "📄", color: "#f7df1e" },
  ".jsx": { icon: "⚛️", color: "#61dafb" },
  ".ts": { icon: "📘", color: "#3178c6" },
  ".tsx": { icon: "⚛️", color: "#3178c6" },
  ".mjs": { icon: "📄", color: "#f7df1e" },
  ".cjs": { icon: "📄", color: "#f7df1e" },

  // Python
  ".py": { icon: "🐍", color: "#3572a5" },
  ".pyw": { icon: "🐍", color: "#3572a5" },

  // Web
  ".html": { icon: "🌐", color: "#e34c26" },
  ".htm": { icon: "🌐", color: "#e34c26" },
  ".css": { icon: "🎨", color: "#1572b6" },
  ".scss": { icon: "🎨", color: "#c6538c" },
  ".less": { icon: "🎨", color: "#1d365d" },

  // Data / Config
  ".json": { icon: "📋", color: "#8b949e" },
  ".yaml": { icon: "⚙️", color: "#8b949e" },
  ".yml": { icon: "⚙️", color: "#8b949e" },
  ".toml": { icon: "⚙️", color: "#8b949e" },
  ".xml": { icon: "📋", color: "#8b949e" },
  ".env": { icon: "🔒", color: "#d29922" },

  // Markdown / Text
  ".md": { icon: "📝", color: "#58a6ff" },
  ".mdx": { icon: "📝", color: "#58a6ff" },
  ".txt": { icon: "📄", color: "#8b949e" },

  // Images
  ".png": { icon: "🖼️", color: "#8b949e" },
  ".jpg": { icon: "🖼️", color: "#8b949e" },
  ".jpeg": { icon: "🖼️", color: "#8b949e" },
  ".gif": { icon: "🖼️", color: "#8b949e" },
  ".svg": { icon: "🖼️", color: "#ffb13b" },
  ".ico": { icon: "🖼️", color: "#8b949e" },
  ".webp": { icon: "🖼️", color: "#8b949e" },

  // Package / Build
  ".lock": { icon: "🔒", color: "#6e7681" },
  ".gitignore": { icon: "🙈", color: "#6e7681" },
  ".dockerignore": { icon: "🐳", color: "#6e7681" },
  ".dockerfile": { icon: "🐳", color: "#0db7ed" },

  // Shell
  ".sh": { icon: "💻", color: "#3fb950" },
  ".bash": { icon: "💻", color: "#3fb950" },
  ".zsh": { icon: "💻", color: "#3fb950" },
};

const FILENAME_MAP: Record<string, FileIconInfo> = {
  "package.json": { icon: "📦", color: "#3fb950" },
  "tsconfig.json": { icon: "⚙️", color: "#3178c6" },
  "Dockerfile": { icon: "🐳", color: "#0db7ed" },
  "docker-compose.yml": { icon: "🐳", color: "#0db7ed" },
  ".gitignore": { icon: "🙈", color: "#6e7681" },
  ".env": { icon: "🔒", color: "#d29922" },
  ".env.local": { icon: "🔒", color: "#d29922" },
  "README.md": { icon: "📖", color: "#58a6ff" },
  "LICENSE": { icon: "⚖️", color: "#8b949e" },
};

const FOLDER_ICON: FileIconInfo = { icon: "📁", color: "#8b949e" };
const DEFAULT_FILE_ICON: FileIconInfo = { icon: "📄", color: "#8b949e" };

/**
 * Get icon info for a file by name.
 * Checks full filename first, then extension.
 */
export function getFileIcon(filename: string, isDir: boolean): FileIconInfo {
  if (isDir) return FOLDER_ICON;

  // Check full filename match
  if (FILENAME_MAP[filename]) {
    return FILENAME_MAP[filename]!;
  }

  // Check extension match
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = filename.substring(dotIdx).toLowerCase();
    if (EXTENSION_MAP[ext]) {
      return EXTENSION_MAP[ext]!;
    }
  }

  return DEFAULT_FILE_ICON;
}
