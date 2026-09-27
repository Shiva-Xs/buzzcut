// The website's roast: the same analyzer and roast as the CLI, run in the visitor's browser
// against GitHub's public API. Nothing is sent anywhere else; there's no server.
import { analyze, gradeOf, passes, prMessage } from './analyze.js';
import { DEFAULTS } from './config.js';
import { buildDiff } from './diff.js';
import { createClient, fetchPr, fetchRecentPrs, fetchTemplate, GitHubError, parsePrRef, parseRepoRef, type PullRequest } from './github.js';
import { boardShareUrl, boardSummary, renderBoard, renderRoast, roastCard, shareUrl, type Board, type BoardRow, type RoastCard } from './roast.js';
import type { Grade } from './types.js';

export interface BoardCard {
  subject: string;
  average: number;
  grade: Grade;
  verdict: string;
  rows: { id: string; title: string; score: number; grade: Grade; words: number; lines: number; pass: boolean; url: string }[];
  yappiest: { id: string; words: number; lines: number } | null;
  failing: number;
  overBudget: number;
}

export type WebRoast =
  | { kind: 'pr'; card: RoastCard; share: string; text: string }
  | { kind: 'repo'; board: BoardCard; share: string; text: string };

const client = () => createClient({ token: null });

function friendly(e: unknown): Error {
  if (e instanceof GitHubError && (e.status === 403 || e.status === 429)) {
    return new Error("GitHub lets a browser make 60 requests an hour without a login, and this one used them up. Try again later, or run npx buzzcut roast in a terminal.");
  }
  if (e instanceof GitHubError && e.status === 404) return new Error("Couldn't find that on GitHub. Only public PRs and repos can be roasted here.");
  if (e instanceof TypeError) return new Error("Couldn't reach GitHub. Check your connection and try again.");
  return e instanceof Error ? e : new Error(String(e));
}

function boardCard(b: Board, owner: string, repo: string): BoardCard {
  const s = boardSummary(b);
  const { grade, verdict } = gradeOf(s.avg);
  const lines = (r: BoardRow) => r.report.diff?.changedLines ?? 0;
  return {
    subject: b.subject,
    average: s.avg,
    grade,
    verdict,
    rows: s.rows.map((r) => ({
      id: r.id,
      title: r.title,
      score: r.report.score,
      grade: r.report.grade,
      words: r.report.words,
      lines: lines(r),
      pass: passes(r.report, DEFAULTS.max),
      url: `https://github.com/${owner}/${repo}/pull/${r.id.slice(1)}`,
    })),
    yappiest: s.yappiest && s.yappiest.report.score > 10 ? { id: s.yappiest.id, words: s.yappiest.report.words, lines: lines(s.yappiest) } : null,
    failing: s.rows.filter((r) => !passes(r.report, DEFAULTS.max)).length,
    overBudget: s.over,
  };
}

/** Roast a PR (URL or owner/repo#123), or a repo's last merged PRs (owner/repo). */
export async function roast(input: string, count = 8): Promise<WebRoast> {
  try {
    const ref = parsePrRef(input);
    if (ref) {
      const c = client();
      const pr = await fetchPr(ref, c);
      if (pr.bot) throw new Error(`${pr.owner}/${pr.repo}#${pr.number} was opened by a bot (${pr.author}). Dependency bumps and changelogs aren't yap.`);
      const template = await fetchTemplate(c, ref.owner, ref.repo, pr.baseSha).catch(() => null);
      const r = analyze(prMessage(pr.title, pr.body), pr.diff, { template });
      return { kind: 'pr', card: roastCard(pr, r, { template }), share: shareUrl(pr, r), text: renderRoast(pr, r, { color: false, template, share: true }) };
    }
    const repo = parseRepoRef(input);
    if (!repo) throw new Error('Paste a GitHub PR link (github.com/owner/repo/pull/123) or a repo (owner/repo).');
    const c = client();
    const prs = await fetchRecentPrs(c, repo, count);
    if (!prs.length) throw new Error(`No merged PRs by people found in ${repo.owner}/${repo.repo}.`);
    const template = await fetchTemplate(c, repo.owner, repo.repo).catch(() => null);
    const rows: BoardRow[] = prs.map((pr) => ({ id: `#${pr.number}`, title: pr.title, report: analyze(prMessage(pr.title, pr.body), pr.diff, { template }) }));
    const worst = [...rows].sort((a, b) => b.report.score - a.report.score)[0]!;
    const board: Board = { subject: `${repo.owner}/${repo.repo} · last ${rows.length} merged PRs`, kind: 'pr', rows, next: `npx buzzcut roast ${repo.owner}/${repo.repo}${worst.id}` };
    return { kind: 'repo', board: boardCard(board, repo.owner, repo.repo), share: boardShareUrl(board), text: renderBoard(board, { color: false }) };
  } catch (e) {
    throw friendly(e);
  }
}

export interface Sample {
  title: string;
  body: string;
  /** the diff, as [path, additions, deletions] */
  files: [string, number, number][];
  number?: number;
}

/** The page's examples: made-up PRs, so nobody real gets roasted on the homepage. */
export function demo(sample: Sample): WebRoast {
  const diff = buildDiff(sample.files.map(([path, additions, deletions]) => ({ path, additions, deletions })));
  const number = sample.number ?? 482;
  const pr: PullRequest = { owner: 'acme', repo: 'api', number, url: `https://github.com/acme/api/pull/${number}`, author: 'example', bot: false, title: sample.title, body: sample.body, diff };
  const r = analyze(prMessage(sample.title, sample.body), diff);
  return { kind: 'pr', card: roastCard(pr, r), share: shareUrl(pr, r), text: renderRoast(pr, r, { color: false, share: true }) };
}

/** Words in a piece of prose, the way buzzcut counts them (for the page's live counters). */
export { countWords } from './text.js';
