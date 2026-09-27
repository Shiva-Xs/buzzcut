import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** A repo's PR template. Its boilerplate never counts against the author. */
export interface Template {
  paths: string[];
  /** normalized template lines: headings, prompts, checkbox labels */
  lines: Set<string>;
}

/** Lowercase, collapse whitespace, untick checkboxes, drop trailing colons. */
export function normalizeLine(s: string): string {
  return s
    .replace(/^(\s*[-*+]\s+)\[[xX]\]/, '$1[ ]')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:$/, '')
    .toLowerCase();
}

export function parseTemplate(texts: { path: string; text: string }[]): Template | null {
  const lines = new Set<string>();
  for (const { text } of texts) {
    const clean = text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
    for (const l of clean.split('\n')) {
      const n = normalizeLine(l);
      if (n && n.length > 1) lines.add(n);
    }
  }
  return lines.size ? { paths: texts.map((t) => t.path), lines } : null;
}

/** Where GitHub looks for PR templates, in its own order. */
export const TEMPLATE_PATHS = [
  '.github/pull_request_template.md',
  'pull_request_template.md',
  'docs/pull_request_template.md',
];
const TEMPLATE_DIRS = ['.github/PULL_REQUEST_TEMPLATE', 'PULL_REQUEST_TEMPLATE', 'docs/PULL_REQUEST_TEMPLATE'];

/** Case-insensitive lookup of `rel` under `root`, since GitHub accepts any casing. */
function findCaseless(root: string, rel: string): string | null {
  let dir = root;
  for (const part of rel.split('/')) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
    const hit = readdirSync(dir).find((e) => e.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    dir = join(dir, hit);
  }
  return dir;
}

export function findTemplate(root: string | null): Template | null {
  if (!root) return null;
  const texts: { path: string; text: string }[] = [];
  for (const rel of TEMPLATE_PATHS) {
    const p = findCaseless(root, rel);
    if (p && statSync(p).isFile()) {
      texts.push({ path: relative(root, p), text: readFileSync(p, 'utf8') });
      break;
    }
  }
  for (const rel of TEMPLATE_DIRS) {
    const d = findCaseless(root, rel);
    if (!d || !statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d).filter((f) => /\.md$/i.test(f))) {
      texts.push({ path: relative(root, join(d, f)), text: readFileSync(join(d, f), 'utf8') });
    }
  }
  return parseTemplate(texts);
}
