export type Kind = 'commit' | 'pr';
export type Severity = 'error' | 'warn' | 'info';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  /** moved or renamed (git's `old => new`) */
  renamed?: boolean;
  /** marked `linguist-generated` in .gitattributes: build output nobody reviews line by line */
  generated?: boolean;
  /** the lines this file adds and removes, when the diff carried them (see patch.ts) */
  added?: string;
  removed?: string;
}

/** What the diff actually did. Every "grounded" rule checks the text against this. */
export interface DiffFacts {
  files: FileChange[];
  additions: number;
  deletions: number;
  /** additions + deletions, leaving out lockfiles and generated files */
  changedLines: number;
  tests: FileChange[];
  docs: FileChange[];
  /** everything that is neither a test nor a doc */
  source: FileChange[];
  /** the file list was cut short (very large PRs); totals are still exact */
  truncated: boolean;
  /**
   * Every file that changes lines came with them (generated files aside), so a name that isn't
   * in `changedText(diff)` isn't in the change. False for a diff that carried only line counts.
   */
  searchable: boolean;
}

export interface Message {
  kind: Kind;
  /** commit subject or PR title */
  title: string;
  body: string;
  /** 1-based line number of the body's first line in the original text */
  bodyLine: number;
}

export interface Finding {
  rule: string;
  severity: Severity;
  points: number;
  /** what is wrong, in one line */
  message: string;
  /** what to do about it, written so an agent can act on it */
  hint: string;
  line?: number;
  /** the exact text that triggered the rule */
  quote?: string;
  /** numbers and strings the roast copy can use */
  data?: Record<string, string | number>;
}

export interface Report {
  kind: Kind;
  title: string;
  score: number;
  grade: Grade;
  verdict: string;
  /** prose words in the body (code blocks, links and trailers excluded) */
  words: number;
  /** word budget for this diff */
  budget: number;
  /** specific details (numbers, code, links, paths) per 100 prose words */
  density: number;
  diff: DiffFacts | null;
  findings: Finding[];
}
