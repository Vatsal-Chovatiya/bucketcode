/**
 * Language Detection Utility
 *
 * Maps file extensions to Monaco Editor language IDs.
 */

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // JavaScript / TypeScript
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",

  // Python
  ".py": "python",
  ".pyw": "python",

  // Web
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",

  // Data / Config
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".xml": "xml",
  ".graphql": "graphql",
  ".gql": "graphql",

  // Markdown / Text
  ".md": "markdown",
  ".mdx": "markdown",
  ".txt": "plaintext",

  // Shell
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",

  // Docker
  ".dockerfile": "dockerfile",

  // SQL
  ".sql": "sql",

  // Misc
  ".env": "ini",
  ".gitignore": "ini",
  ".editorconfig": "ini",
};

const FILENAME_TO_LANGUAGE: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
  ".env": "ini",
  ".env.local": "ini",
  ".env.development": "ini",
  ".env.production": "ini",
  ".gitignore": "ini",
  ".dockerignore": "ini",
};

/**
 * Detect the Monaco language ID from a file path.
 * Checks full filename first, then extension, then defaults to plaintext.
 */
export function detectLanguage(filePath: string): string {
  // Extract filename from path
  const parts = filePath.split("/");
  const filename = parts[parts.length - 1] || "";

  // Check full filename match
  if (FILENAME_TO_LANGUAGE[filename]) {
    return FILENAME_TO_LANGUAGE[filename]!;
  }

  // Check extension match
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = filename.substring(dotIdx).toLowerCase();
    if (EXTENSION_TO_LANGUAGE[ext]) {
      return EXTENSION_TO_LANGUAGE[ext]!;
    }
  }

  return "plaintext";
}
