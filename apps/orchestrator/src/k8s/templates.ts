import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Template Cache
// ---------------------------------------------------------------------------
// YAML templates are read once at startup and cached in memory.
// This avoids filesystem I/O on every /start request.
// ---------------------------------------------------------------------------

const templateCache = new Map<string, string>();

/**
 * Supported template names mapping to filenames in infra/k8s/.
 */
const TEMPLATE_FILES = {
  pod: 'pod.yaml',
  service: 'service.yaml',
  ingress: 'ingress.yaml',
} as const;

type TemplateName = keyof typeof TEMPLATE_FILES;

/**
 * Loads all YAML templates from disk into the cache.
 * Called once at startup. Fails fast if any template is missing.
 */
export function loadTemplates(): void {
  for (const [name, filename] of Object.entries(TEMPLATE_FILES)) {
    const filePath = path.join(config.templatesDir, filename);

    if (!fs.existsSync(filePath)) {
      throw new Error(
        `[templates] Missing template: ${filePath}. ` +
        `Ensure infra/k8s/${filename} exists.`
      );
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    templateCache.set(name, content);
    console.log(`[templates] Loaded ${name} template from ${filePath}`);
  }
}

/**
 * Placeholder variables that get substituted into templates.
 */
export interface TemplateVars {
  replId: string;
  language: string;
  s3Path: string;
}

/**
 * Renders a YAML template by replacing all `{placeholder}` tokens
 * with the corresponding values from `vars`.
 *
 * @param name - Template name: 'pod' | 'service' | 'ingress'
 * @param vars - Key-value pairs for placeholder substitution
 * @returns Parsed JavaScript object ready for the k8s API
 *
 * @example
 * ```ts
 * const podBody = renderTemplate('pod', {
 *   replId: 'repl-7xq2k',
 *   language: 'node-js',
 *   s3Path: 'bucketcode/code/repl-7xq2k/'
 * });
 * ```
 */
export function renderTemplate<T = Record<string, unknown>>(
  name: TemplateName,
  vars: TemplateVars,
): T {
  const raw = templateCache.get(name);

  if (!raw) {
    throw new Error(
      `[templates] Template '${name}' not loaded. Call loadTemplates() first.`
    );
  }

  // Replace all occurrences of {key} with the corresponding value.
  // Uses a global regex to handle multiple occurrences of the same placeholder.
  let rendered = raw;
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = new RegExp(`\\{${key}\\}`, 'g');
    rendered = rendered.replace(placeholder, value);
  }

  // Warn if any unreplaced placeholders remain (developer error)
  const unreplaced = rendered.match(/\{[a-zA-Z]+\}/g);
  if (unreplaced) {
    console.warn(
      `[templates] Warning: unreplaced placeholders in '${name}': ${unreplaced.join(', ')}`
    );
  }

  const parsed = yaml.load(rendered) as T;
  return parsed;
}
