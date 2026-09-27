import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyze, parseCommit, prMessage } from '../src/analyze.js';
import { buildDiff } from '../src/diff.js';
import type { DiffFacts, Report } from '../src/types.js';

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

/** diff('src/a.ts:10:2', 'test/a.test.ts:5') → DiffFacts */
export function diff(...specs: string[]): DiffFacts {
  return buildDiff(
    specs.map((s) => {
      const [path, add = '0', del = '0'] = s.split(':');
      return { path: path!, additions: Number(add), deletions: Number(del) };
    }),
  );
}

export function pr(body: string, d: DiffFacts | null, title = 'Retry webhook sends on 5xx'): Report {
  return analyze(prMessage(title, body), d);
}

export function commit(message: string, d: DiffFacts | null = null): Report {
  return analyze(parseCommit(message), d);
}

export function rules(r: Report): string[] {
  return r.findings.map((f) => f.rule);
}

export function finding(r: Report, rule: string) {
  return r.findings.find((f) => f.rule === rule);
}
