// The evidence in a draft: numbers and measurements, issue and PR refs, links, file:line
// pointers, commands and outputs quoted as code, hashes, and quoted messages. When an agent trims a draft, it must not lose these on the way (the
// dropped-facts rule), so buzzcut remembers the last draft of each message it checked.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git } from './git.js';

const EVIDENCE =
  /https?:\/\/[^\s)>\]]+|(?<![\w/])#\d+\b|\b[A-Z][A-Z0-9]+-\d+\b|\b[\w./-]+\.[A-Za-z]+:\d+\b|\$\d+(?:[.,]\d+)*\b|\b\d+(?:[.,]\d+)*\s?(?:%|ms|µs|us|ns|s|sec|seconds?|min|minutes?|h|hours?|x|×|kb|mb|gb|tb|px|rps|qps|rows?|tests?|files?|lines?|calls?|requests?|errors?|users?|orders?|items?|bytes?)(?![\w])|\b(?:\d{1,3}(?:,\d{3})+|\d{3,})(?:[.,]\d+)*\b|\bv?\d+\.\d+(?:\.\d+)*\b/g;
// Tool footers, badges, screenshots and local URLs aren't facts about the change.
const NOISE = /localhost|127\.0\.0\.1|claude\.(?:com\/claude-code|ai\/code)|chatgpt\.com\/codex|cursor\.com\/(?:assets|agents|background|artifacts|cn)|app\.devin\.ai|shields\.io|user-attachments|\.(?:png|jpe?g|gif|svg|webp|mp4|mov)\b/i;

const norm = (s: string) => s.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.,;:]+$/, '');

/** The evidence in a message, normalized, leaving out code blocks, comments and trailers. */
export function evidenceOf(text: string): string[] {
  const prose = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*([\w-]+-by|change-id):/i.test(l))
    .join('\n');
  const out = new Set<string>();
  for (const m of prose.matchAll(EVIDENCE)) {
    if (NOISE.test(m[0])) continue;
    const f = norm(m[0]);
    // Years and dates on their own are rarely what a reviewer needs.
    if (/^(19|20)\d\d$/.test(f)) continue;
    out.add(f);
  }
  // Commands and outputs quoted as code (`npm test`, `Status: NotSigned`), not bare names.
  for (const line of prose.split('\n')) {
    const parts = line.split('`');
    for (let i = 1; i < parts.length - 1; i += 2) {
      const span = parts[i]!.trim();
      if (span.length > 2 && /[\s:=]/.test(span)) out.add(norm(span));
    }
  }
  // Hashes and commit SHAs.
  for (const m of prose.matchAll(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}\b/g)) out.add(m[0]);
  // Quoted messages: an error, a dialog, what the user asked for. Quotes pair up in order, across
  // line breaks, so a quote that wraps onto the next line doesn't make the text between two
  // quotes ('got "never why". missing-why now reads "') look like one.
  for (const m of prose.matchAll(/["“]([^"”]*)["”]/g)) {
    const q = m[1]!.replace(/\s+/g, ' ').trim();
    if (q.length >= 12 && q.length <= 160 && q.split(' ').length >= 3) out.add(norm(q));
  }
  return [...out];
}

// "3,900" and "3900" are the same number.
const digits = (s: string) => s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');

/** Evidence from `before` that `after` no longer mentions. */
export function droppedEvidence(before: string[], afterText: string): string[] {
  const now = digits(norm(afterText.replace(/[`*_]/g, '')));
  return before.filter((f) => !now.includes(digits(f)));
}

// ─── the last draft of each message ──────────────────────────────────────────

export interface Draft {
  evidence: string[];
  /** unix ms */
  at: number;
  /** the change the draft described (see diffSignature); a different change means a new message */
  diff?: string;
  /** a hook already sent this message back once for dropping facts */
  warned?: boolean;
}

const TTL = 60 * 60 * 1000;

function draftFile(key: string, cwd: string): string | null {
  const common = git(['rev-parse', '--git-common-dir'], cwd)?.trim();
  if (!common) return null;
  const id = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return join(resolve(cwd, common), 'buzzcut-drafts', `${id}.json`);
}

export function readDraft(key: string, cwd: string, now = Date.now()): Draft | null {
  try {
    const f = draftFile(key, cwd);
    if (!f || !existsSync(f)) return null;
    const d = JSON.parse(readFileSync(f, 'utf8')) as Draft;
    return now - d.at < TTL && Array.isArray(d.evidence) ? d : null;
  } catch {
    return null;
  }
}

/** Never throws: it's bookkeeping. */
export function saveDraft(key: string, cwd: string, draft: Draft): void {
  try {
    const f = draftFile(key, cwd);
    if (!f) return;
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, JSON.stringify(draft));
  } catch {
    // a read-only .git shouldn't break anything
  }
}

export function clearDraft(key: string, cwd: string): void {
  try {
    const f = draftFile(key, cwd);
    if (f) rmSync(f, { force: true });
  } catch {
    // bookkeeping only
  }
}
