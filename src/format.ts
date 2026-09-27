import { passes, SHAPE_CAP } from './analyze.js';
import type { Finding, Grade, Report, Severity } from './types.js';

export type Paint = (s: string) => string;
export interface Palette {
  bold: Paint;
  dim: Paint;
  red: Paint;
  green: Paint;
  yellow: Paint;
  cyan: Paint;
  inverse: Paint;
}

export function palette(enabled: boolean): Palette {
  const wrap = (open: number, close: number): Paint => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
    inverse: wrap(7, 27),
  };
}

export function useColor(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream.isTTY);
}

export const ICON: Record<Severity, string> = { error: '✗', warn: '!', info: '·' };

export function severityPaint(p: Palette, s: Severity): Paint {
  return s === 'error' ? p.red : s === 'warn' ? p.yellow : p.dim;
}

export function gradePaint(p: Palette, g: Grade): Paint {
  return g === 'A' || g === 'B' ? p.green : g === 'C' ? p.yellow : p.red;
}

export function diffSummary(r: Report): string {
  if (!r.diff) return 'no diff';
  const d = r.diff;
  return `${d.files.length} file${d.files.length === 1 ? '' : 's'}, +${d.additions} −${d.deletions}`;
}

export function scoreLine(r: Report, p: Palette): string {
  const g = gradePaint(p, r.grade);
  return `${p.bold('YAP SCORE')}  ${g(p.bold(`${r.score}/100`))}  ${g(p.inverse(` ${r.grade} `))}  ${r.verdict}`;
}

function tally(findings: Finding[]): string {
  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const parts: string[] = [];
  const e = count('error');
  const w = count('warn');
  const i = count('info');
  if (e) parts.push(`${e} error${e > 1 ? 's' : ''}`);
  if (w) parts.push(`${w} warning${w > 1 ? 's' : ''}`);
  if (i) parts.push(`${i} note${i > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/** Word-wrap `text` into lines of at most `width` columns. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export function renderReport(r: Report, opts: { color: boolean; max: number; label?: string; width?: number }): string {
  const p = palette(opts.color);
  const out: string[] = [];
  out.push('');
  out.push(`  ${p.bold('buzzcut')} ${p.dim(`· ${opts.label ?? r.kind} · ${diffSummary(r)} · ${r.words} words (budget ${r.budget})`)}`);
  out.push('');
  out.push(`  ${scoreLine(r, p)}`);
  out.push('');

  if (!r.findings.length) {
    out.push(`  ${p.green('✓')} Nothing to cut.`);
    out.push('');
    return out.join('\n');
  }

  const width = Math.max(...r.findings.map((f) => f.rule.length)) + 2;
  const cols = Math.min(opts.width ?? 100, 100);
  const indent = ' '.repeat(4 + width);
  for (const f of r.findings) {
    const paint = severityPaint(p, f.severity);
    const where = f.line ? p.dim(`  L${f.line}`) : '';
    out.push(`  ${paint(ICON[f.severity])} ${paint(f.rule.padEnd(width))}${f.message}${where}`);
    for (const l of wrap('→ ' + f.hint, Math.max(30, cols - indent.length))) out.push(indent + p.dim(l));
  }
  out.push('');
  const errors = r.findings.some((f) => f.severity === 'error');
  // Length and shape warnings count for at most SHAPE_CAP points, so a high score can still pass.
  const verdict = passes(r, opts.max)
    ? p.green(r.score > opts.max ? `passes (max ${opts.max}; length and shape warnings count for ${SHAPE_CAP} at most)` : `passes (max ${opts.max})`)
    : p.red(errors ? 'fails: fix the ✗ errors' : `fails (max ${opts.max})`);
  out.push(`  ${tally(r.findings)}  ${p.dim('·')}  ${verdict}`);
  out.push('');
  return out.join('\n');
}

export function toJson(r: Report, max: number, extra: Record<string, unknown> = {}): string {
  const { diff, ...rest } = r;
  return JSON.stringify(
    {
      ...extra,
      ...rest,
      pass: passes(r, max),
      max,
      diff: diff && {
        files: diff.files.length,
        additions: diff.additions,
        deletions: diff.deletions,
        changedLines: diff.changedLines,
        testFiles: diff.tests.length,
        docFiles: diff.docs.length,
        truncated: diff.truncated,
      },
    },
    null,
    2,
  );
}
