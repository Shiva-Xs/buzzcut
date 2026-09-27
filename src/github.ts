import { buildDiff } from './diff.js';
import { parseTemplate, TEMPLATE_PATHS, type Template } from './template.js';
import type { DiffFacts, FileChange } from './types.js';

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PullRequest extends PrRef {
  url: string;
  author: string;
  /** opened by a GitHub App or a *[bot] account */
  bot: boolean;
  title: string;
  body: string;
  diff: DiffFacts;
  baseSha?: string;
}

/** Accepts a PR URL (any /pull/N/... suffix) or the `owner/repo#123` shorthand. */
export function parsePrRef(input: string): PrRef | null {
  const s = input.trim();
  const url = s.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pulls?\/(\d+)/i);
  const short = s.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  const m = url ?? short;
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, ''), number: Number(m[3]) };
}

export interface RepoRef {
  owner: string;
  repo: string;
}

/** `owner/repo` or a repo URL (not a PR URL: parsePrRef takes those). */
export function parseRepoRef(input: string): RepoRef | null {
  const s = input.trim().replace(/\/+$/, '');
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i) ?? s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export interface Client {
  get<T>(path: string): Promise<T>;
  send<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T>;
  authenticated: boolean;
}

/** A tiny REST client. The token is only ever sent to `baseUrl` (api.github.com by default). */
export function createClient(opts: { token: string | null; fetch?: typeof fetch; baseUrl?: string }): Client {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = (opts.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'buzzcut',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (opts.token) h.Authorization = `Bearer ${opts.token}`;
    return h;
  };
  const handle = async <T>(res: Response, path: string): Promise<T> => {
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
    if (res.status === 404) {
      throw new GitHubError(opts.token ? `Not found: ${path}` : 'Not found. If the repo is private, set GITHUB_TOKEN or log in with `gh auth login`.', 404);
    }
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      throw new GitHubError(
        opts.token ? 'GitHub rate limit hit. Try again in a few minutes.' : 'GitHub rate limit hit (60/hour without a token). Set GITHUB_TOKEN or run `gh auth login`.',
        res.status,
      );
    }
    throw new GitHubError(`GitHub API returned ${res.status} for ${path}`, res.status);
  };
  return {
    authenticated: Boolean(opts.token),
    async get<T>(path: string) {
      return handle<T>(await doFetch(`${baseUrl}${path}`, { headers: headers() }), path);
    },
    async send<T>(method: 'POST' | 'PATCH', path: string, body: unknown) {
      const res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return handle<T>(res, path);
    },
  };
}

export interface ApiPull {
  html_url: string;
  merged_at?: string | null;
  number: number;
  title: string;
  body: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  user: { login: string; type: string } | null;
  base?: { sha: string; ref: string };
}

interface ApiFile {
  filename: string;
  additions: number;
  deletions: number;
}

const MAX_FILE_PAGES = 3;

// Coding agents open PRs from bot accounts too, and those are exactly what buzzcut is for.
const CODING_AGENTS = /^(?:copilot|copilot-swe-agent|devin-ai-integration|google-labs-jules|jules|cursor|cursoragent|claude|anthropic-claude|chatgpt-codex-connector|codex|openhands(?:-agent)?|sweep-ai|amazon-q-developer|factory-droid|codegen-sh|codeflash-ai)(?:\[bot\])?$/i;

export function isCodingAgent(user: { login: string } | null | undefined): boolean {
  return CODING_AGENTS.test(user?.login ?? '');
}

/** An automation bot (dependabot, renovate, release tooling): nothing to judge. Coding agents don't count. */
export function isBot(user: { login: string; type: string } | null | undefined): boolean {
  if (isCodingAgent(user)) return false;
  return user?.type === 'Bot' || /\[bot\]$/.test(user?.login ?? '');
}

export async function fetchPrFiles(client: Client, ref: PrRef, changedFiles: number): Promise<FileChange[]> {
  const base = `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const files: FileChange[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES && files.length < changedFiles; page++) {
    const batch = await client.get<ApiFile[]>(`${base}/files?per_page=100&page=${page}`);
    files.push(...batch.map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions })));
    if (batch.length < 100) break;
  }
  return files;
}

export function toPullRequest(ref: PrRef, pr: ApiPull, files: FileChange[]): PullRequest {
  return {
    ...ref,
    url: pr.html_url,
    author: pr.user?.login ?? 'ghost',
    bot: isBot(pr.user),
    title: pr.title,
    body: pr.body ?? '',
    diff: buildDiff(files, { additions: pr.additions, deletions: pr.deletions }, files.length < pr.changed_files),
    baseSha: pr.base?.sha,
  };
}

export async function fetchPr(ref: PrRef, client: Client): Promise<PullRequest> {
  const pr = await client.get<ApiPull>(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
  return toPullRequest(ref, pr, await fetchPrFiles(client, ref, pr.changed_files));
}

/** The repo's PR template at `ref`, so its boilerplate isn't held against the author. */
export async function fetchTemplate(client: Client, owner: string, repo: string, ref?: string): Promise<Template | null> {
  for (const path of [TEMPLATE_PATHS[0]!, '.github/PULL_REQUEST_TEMPLATE.md']) {
    try {
      const f = await client.get<{ content?: string; encoding?: string }>(
        `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
      );
      if (f.content && f.encoding === 'base64') return parseTemplate([{ path, text: Buffer.from(f.content, 'base64').toString('utf8') }]);
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
    }
  }
  return null;
}

/**
 * The last `count` merged PRs written by people (bots skipped), each with its file list.
 * One list call plus one per PR, so ~11 requests for 10 PRs: fine without a token.
 */
export async function fetchRecentPrs(client: Client, ref: RepoRef, count: number): Promise<PullRequest[]> {
  const list = await client.get<ApiPull[]>(`/repos/${ref.owner}/${ref.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`);
  const picked = list.filter((p) => p.merged_at && !isBot(p.user)).slice(0, count);
  const out: PullRequest[] = [];
  for (const p of picked) {
    const pr: PrRef = { ...ref, number: p.number };
    // The list endpoint has no line counts, so they come from the files (first page).
    const files = await fetchPrFiles(client, pr, 100);
    const additions = files.reduce((t, f) => t + f.additions, 0);
    const deletions = files.reduce((t, f) => t + f.deletions, 0);
    out.push(toPullRequest(pr, { ...p, additions, deletions, changed_files: files.length }, files));
  }
  return out;
}
