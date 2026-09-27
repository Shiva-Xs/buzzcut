import { normalizeLine } from './template.js';

export interface Line {
  /** 1-based line number in the original text */
  n: number;
  text: string;
}

export interface TextFacts {
  /** prose lines: outside code fences, HTML comments and attribution trailers */
  lines: Line[];
  words: number;
  headings: Line[];
  /** bullet and numbered-list items, checkboxes excluded */
  bullets: Line[];
  /** words in each bullet, wrapped continuation lines included; same order as `bullets` */
  bulletWords: number[];
  /** ticked checkboxes and ✅-led lines */
  ticked: Line[];
  /** headings or bullets that start with an emoji */
  emojiLed: Line[];
  emoji: number;
  bold: number;
  /** "- **Label**: text" bullets */
  boldLabels: number;
  emDashes: number;
  /** markdown tables */
  tables: number;
  /** plain-text section labels: "Key Changes:", "- Security & Cryptography:" followed by a list */
  labels: Line[];
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// Attribution and trailers are not the author's prose, so they never count against them.
const META = /^\s*(?:[\w-]+-by|change-id):|^\s*(🤖\s*)?generated (with|by) /iu;
const HEADING = /^\s{0,3}#{1,6}\s+\S|^\s*(\*\*|__)[^*_\n]{1,60}(\*\*|__):?\s*$/;
const BULLET = /^\s*([-*+•]|\d{1,2}[.)])\s+\S/;
const LABEL = /^\s*(?:[-*+•]\s+)?[^\s:`][^:`]{0,48}:\s*$/;
const CHECKBOX = /^\s*[-*+]\s+\[[ xX]\]/;
const TICKED = /^\s*[-*+]\s+\[[xX]\]|^\s*(✅|✔️|✔|☑️)/u;
const BOLD = /(\*\*|__)(?=\S)[^*_\n]+?(?<=\S)\1/g;
const BOLD_LABEL = /^\s*([-*+•]|\d{1,2}[.)])\s+(\*\*|__)[^*_\n]+?(\*\*|__)\s*[:—–-]|^\s*([-*+•]|\d{1,2}[.)])\s+(\*\*|__)[^*_\n]+?:(\*\*|__)/;
const EMOJI = /\p{Extended_Pictographic}/gu;
const NOT_EMOJI = new Set(['©', '®', '™', '↔', '↕', '↩', '↪', '▶', '◀']);
const LEADING_EMOJI = /^\s*(#{1,6}\s+|([-*+•]|\d{1,2}[.)])\s+)?(\*\*|__)?\p{Extended_Pictographic}/u;

export function countEmoji(s: string): number {
  return (s.match(EMOJI) ?? []).filter((e) => !NOT_EMOJI.has(e)).length;
}

export function countWords(s: string): number {
  const t = s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/`[^`]*`/g, ' x ') // inline code is one word
    .replace(/https?:\/\/\S+/g, ' x '); // so is a bare URL
  return (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’_.-]*/gu) ?? []).length;
}

/** Strip HTML comments but keep line numbers stable. */
function blankComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
}

/**
 * @param skip normalized lines to leave out, e.g. the repo's PR template boilerplate
 */
export function analyzeText(body: string, firstLine = 1, skip?: Set<string>): TextFacts {
  const raw = blankComments(body.replace(/\r\n?/g, '\n')).split('\n');
  const lines: Line[] = [];
  let fence: string | null = null;

  raw.forEach((text, i) => {
    const m = text.match(FENCE);
    if (fence) {
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length) fence = null;
      return;
    }
    if (m) {
      fence = m[1]!;
      return;
    }
    if (META.test(text)) return;
    if (skip?.has(normalizeLine(text))) return;
    lines.push({ n: firstLine + i, text });
  });

  const facts: TextFacts = {
    lines,
    words: 0,
    headings: [],
    bullets: [],
    bulletWords: [],
    ticked: [],
    emojiLed: [],
    emoji: 0,
    bold: 0,
    boldLabels: 0,
    emDashes: 0,
    tables: 0,
    labels: [],
  };

  const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.text;
    if (!t.trim()) continue;
    // A table is data, not prose: count it once as structure and skip its rows.
    if (/^\s*\|/.test(t)) {
      if (TABLE_SEP.test(lines[i + 1]?.text ?? '')) facts.tables++;
      continue;
    }
    facts.words += countWords(t);
    // "Key Changes:" or "- Persistence & Models:" introducing a list is a section header in plain text.
    const next = lines.slice(i + 1).find((l) => l.text.trim())?.text ?? '';
    if (LABEL.test(t) && countWords(t) <= 5 && (BULLET.test(next) || /^\s{2,}\S/.test(next))) facts.labels.push(line);
    const heading = HEADING.test(t);
    if (heading) facts.headings.push(line);
    if (TICKED.test(t)) facts.ticked.push(line);
    else if (BULLET.test(t) && !CHECKBOX.test(t)) {
      facts.bullets.push(line);
      // A bullet runs on over wrapped lines until a blank line, the next item or a heading.
      let words = countWords(t);
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!.text;
        if (!next.trim() || BULLET.test(next) || CHECKBOX.test(next) || HEADING.test(next) || /^\s*\|/.test(next)) break;
        words += countWords(next);
      }
      facts.bulletWords.push(words);
    }
    if ((heading || BULLET.test(t)) && LEADING_EMOJI.test(t)) facts.emojiLed.push(line);
    facts.emoji += countEmoji(t);
    facts.bold += (t.match(BOLD) ?? []).length;
    if (BOLD_LABEL.test(t)) facts.boldLabels++;
    facts.emDashes += (t.match(/—/g) ?? []).length;
  }
  return facts;
}

export const SPECIFIC = new RegExp(
  [
    '`([^`]+)`', // code span
    String.raw`\b\d[\d.,]*\s?(?:%|x|×|ms|µs|us|ns|s|sec|kb|mb|gb|k|m)?(?![\w])`, // number
    String.raw`(?:^|\s)#\d+\b`, // issue ref
    String.raw`\b[A-Z][A-Z0-9]+-\d+\b`, // ticket
    String.raw`https?:\/\/\S+`, // link
    // Code named in plain text, as commit bodies do: vfs_read(), max_order_usd, EXIT_PLAN_TTL, getUserById
    String.raw`\b[A-Za-z_][\w.]*\(\)`,
    String.raw`\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b`,
    String.raw`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b`,
    String.raw`\b[a-z]+(?:[A-Z][a-z0-9]*)+\b`,
    // A file name or path outside backticks, as commit bodies write them: worker.js, _redirects:14, /wp-admin/install.php
    String.raw`(?<![\w/.-])(\/?(?:[\w.-]+\/)*[\w-]*\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|rb|php|html|css|scss|json|ya?ml|toml|md|txt|sh|sql|env|xml|lock|conf|ini)|\/[\w.-]+(?:\/[\w.*-]+)+)(?::\d+)?(?![\w/])`,
  ].join('|'),
  'g',
);

/**
 * Specific details per 100 prose words: numbers, code references, issue refs, links.
 * Code spans that only name a file from the diff don't count, since that's the diff read back.
 */
export function specificity(lines: Line[], words: number, files: Set<string> = new Set()): number {
  if (!words) return 0;
  let n = 0;
  for (const l of lines) {
    for (const m of l.text.matchAll(SPECIFIC)) {
      // A file name from the diff, in backticks or not, is the diff read back, not a detail.
      const name = m[1] ?? m[2];
      if (name && (files.has(name) || files.has(name.split('/').pop()!))) continue;
      n++;
    }
  }
  return (100 * n) / words;
}

/**
 * Share of the letters in prose that are Latin script, code spans left out. Rules that read
 * English ("never says why", em dashes) step aside for text mostly in another script.
 */
export function latinShare(s: string): number {
  const letters = s.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ').match(/\p{L}/gu) ?? [];
  if (!letters.length) return 1;
  return letters.filter((c) => /\p{Script=Latin}/u.test(c)).length / letters.length;
}

/** Trim a match down to something quotable. */
export function quote(s: string, max = 60): string {
  const t = s.replace(/\s+/g, ' ').trim().replace(/^[-*+•>#\s]+/, '').replace(/[*_`]/g, '');
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
