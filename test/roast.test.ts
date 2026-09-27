import { describe, expect, it } from 'vitest';
import { analyze, prMessage } from '../src/analyze.js';
import { fetchRecentPrs, parseRepoRef, type Client, type PullRequest } from '../src/github.js';
import { whyOf, worthKeeping } from '../src/keep.js';
import { renderBoard, renderRoast, renderRoastMarkdown, roastCard, shareUrl, type Board } from '../src/roast.js';
import { diff, fixture } from './helpers.js';

const d = diff('src/webhook.ts:7:2');
const pr = (body: string, title = 'Add comprehensive retry mechanism', number = 482): PullRequest => ({
  owner: 'acme',
  repo: 'api',
  number,
  url: `https://github.com/acme/api/pull/${number}`,
  author: 'somebody',
  bot: false,
  title,
  body,
  diff: d,
});

const FACTS = `## Summary

This PR introduces a comprehensive retry mechanism for webhooks.

## Why

Stripe returns 502s for about 2% of sends during their deploys, see [#471](https://github.com/acme/api/issues/471).
Sends now retry 3 times with backoff (200ms, 400ms, 800ms).

## Changes

- Updated \`src/webhook.ts\` with retry logic
- Improved code quality and maintainability
- Enhanced error handling

Overall, these changes improve reliability.`;

describe('the PR roast card', () => {
  const body = fixture('bloated-pr.md');
  const r = analyze(prMessage('Add comprehensive retry mechanism', body), d);
  const out = renderRoast(pr(body), r, { color: false });

  it('has the meter, what changed and why, the numbers, the burns and a verdict', () => {
    expect(out).toContain('YAP-O-METER');
    expect(out).toContain('100/100');
    expect(out).toContain('✓ WHAT CHANGED  "Add comprehensive retry mechanism"');
    expect(out).toContain('✗ WHY           never says why');
    expect(out).toContain('146 words for a 9-line diff (16.2 words per changed line).');
    expect(out).toContain('Could have been ~84 words. 42% of it is yap.');
    expect(out).toContain('THE ROAST');
    expect(out).toMatch(/VERDICT {2}\S/);
  });

  it('never says how long it takes to read', () => {
    expect(out).not.toMatch(/to read|Reads in|reading time|\d+ s\b/i);
  });

  it("doesn't repeat what changed and why as burns, and keeps a false claim as one", () => {
    const claimed = `${body}\n\nAdded unit tests for the retry loop.`;
    const burns = roastCard(pr(claimed), analyze(prMessage('Add comprehensive retry mechanism', claimed), d)).burns.map((b) => b.text).join(' ');
    expect(burns).not.toMatch(/never says why|doesn't say what changed/i);
    expect(burns).toMatch(/Test files changed: 0|The diff has none/);
  });

  it('says so when nothing is worth keeping', () => {
    expect(out).toContain('WORTH KEEPING  nothing: no numbers, no errors, no reason why');
  });

  it('never names the author', () => {
    expect(out).not.toContain('somebody');
    expect(renderRoastMarkdown(pr(body), r)).not.toContain('somebody');
  });

  it('keeps pedantic notes out of the roast', () => {
    const r2 = analyze(prMessage('Added retry.', body), d);
    expect(renderRoast(pr(body, 'Added retry.'), r2, { color: false })).not.toMatch(/Subject ends with a period|"Added" → "Add"/);
  });

  it('praises a good one without a roast section', () => {
    const good = fixture('good-pr.md');
    const title = 'Retry webhook deliveries on 5xx and 429';
    const g = renderRoast(pr(good, title), analyze(prMessage(title, good), d), { color: false });
    expect(g).toContain('0/100');
    expect(g).toContain('✓ WHY           "Webhook deliveries to customer endpoints fail');
    expect(g).toContain('Says what changed and why, in plain words. Frame this one.');
    expect(g).not.toMatch(/PROOF|Proof/);
    expect(g).not.toContain('THE ROAST');
    expect(g).not.toContain('NITS');
    expect(g).not.toContain('WORTH KEEPING');
    expect(g).not.toContain('words per changed line');
  });

  it('gives a decent one a nit or two, not a roast', () => {
    const decent = fixture('decent-pr.md');
    const title = 'Fix duplicate rows on page 2 of the orders list';
    const dd = diff('src/orders/list.ts:6:3', 'src/orders/types.ts:2:2');
    const c = roastCard({ ...pr(decent, title), diff: dd }, analyze(prMessage(title, decent), dd));
    expect(c.grade).toBe('B');
    expect(c.heat).toBe('nit');
    expect(c.burns.length).toBeLessThanOrEqual(2);
    expect(c.burns.map((b) => b.text)).toContain('3 section headers for a 13-line change. An opening and a Tested line would do.');
    expect(c.basics.why).toEqual({ mark: 'ok', text: '"Page 2 of the orders list repeated the last row of page 1, because the cursor query used `<=`."' });
    expect(c.keep).toBeNull();
  });

  it("doesn't frame a tidy PR that never says why", () => {
    const tidy = 'Moves the retry loop into `send()` and returns early on 4xx.';
    const big = diff('src/webhook.ts:40:12');
    const c = roastCard({ ...pr(tidy, 'Move webhook retries into send'), diff: big }, analyze(prMessage('Move webhook retries into send', tidy), big));
    expect(c.basics.why.mark).toBe('bad');
    expect(c.heat).toBe('nit');
    expect(c.closer).not.toMatch(/Frame this one/);
  });

  it('is fair to a title-only PR on a small change, and not on a big one', () => {
    const small = roastCard(pr('', 'Fix typo in the retry log message'), analyze(prMessage('Fix typo in the retry log message', ''), d));
    expect(small.basics.why.mark).not.toBe('bad');
    expect(small.closer).toBe('Title only. For a change this size, fair enough.');
    const big = diff('src/webhook.ts:300:40');
    const empty = roastCard({ ...pr('', 'Rework webhook delivery'), diff: big }, analyze(prMessage('Rework webhook delivery', ''), big));
    expect(empty.basics.why).toEqual({ mark: 'bad', text: 'no description for 340 changed lines' });
    expect(empty.closer).toBe('No description for 340 changed lines. The reviewer gets to guess.');
  });

  it('is stable for the same PR', () => {
    expect(renderRoast(pr(body), r, { color: false })).toBe(out);
  });
});

describe('why', () => {
  it('never takes a "What:" line as the reason', () => {
    const body = '💡 What: Fixes duplicate rows on page 2 of the orders list.\n🎯 Why: The cursor query used `<=`, so the last row came back twice.';
    expect(whyOf('Fix duplicate order rows', body)).toBe('🎯 Why: The cursor query used `<=`, so the last row came back twice.');
  });

  it('finds the reason, not a sentence that mentions errors', () => {
    expect(whyOf('Add retry', 'Enhanced error handling with descriptive error messages.\nModified webhook.ts error path to throw after retries.')).toBeNull();
    expect(whyOf('Add retry', 'Retries 5xx. Stripe returns 502s during deploys, so we drop about 2% of events.')).toBe('Stripe returns 502s during deploys, so we drop about 2% of events.');
    expect(whyOf('Fix crash when the cart is empty', '')).toBe('Fix crash when the cart is empty');
    expect(whyOf('[7.x] Remove license check (#100189)', '')).toBe('[7.x] Remove license check (#100189)');
    expect(whyOf('Add parser', 'Encodes text as utf-8 before hashing.')).toBeNull();
  });
});

describe('worthKeeping', () => {
  it('keeps the sentences with facts, as plain text, in order', () => {
    const k = worthKeeping(FACTS, 60, new Set(['src/webhook.ts', 'webhook.ts']));
    expect(k.sentences).toEqual([
      'Stripe returns 502s for about 2% of sends during their deploys, see #471.',
      'Sends now retry 3 times with backoff (200ms, 400ms, 800ms).',
    ]);
  });

  it('drops openers, closers, buzzwords and file tours', () => {
    const k = worthKeeping(FACTS, 60, new Set(['src/webhook.ts', 'webhook.ts']));
    expect(k.sentences.join(' ')).not.toMatch(/This PR introduces|Overall|Updated|Enhanced/);
  });

  it('shows at most three sentences', () => {
    const many = Array.from({ length: 8 }, (_, i) => `Request ${i + 1} failed with a 502 after 30s.`).join(' ');
    expect(worthKeeping(many, 400).sentences.length).toBe(3);
  });

  it('finds nothing in pure fluff', () => {
    expect(worthKeeping(fixture('bloated-pr.md'), 60, new Set(['src/webhook.ts', 'webhook.ts'])).sentences).toEqual([]);
  });
});

describe('sharing', () => {
  it('builds an X intent link with the score and the PR link only', () => {
    const body = fixture('bloated-pr.md');
    const url = shareUrl(pr(body), analyze(prMessage('Add comprehensive retry mechanism', body), d));
    expect(url.startsWith('https://x.com/intent/tweet?text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]!.split('&')[0]!);
    expect(text).toContain('100/100');
    expect(text).toContain('146 words for a 9-line diff');
    expect(text).not.toContain('comprehensive retry mechanism for webhook');
    expect(url).toContain(encodeURIComponent('https://github.com/acme/api/pull/482'));
  });

});

describe('leaderboards', () => {
  const report = (title: string, body: string, spec = 'src/a.ts:20:5') => analyze(prMessage(title, body), diff(spec));
  const board: Board = {
    subject: 'acme/api · last 3 merged PRs',
    kind: 'pr',
    next: 'npx buzzcut roast acme/api#1',
    rows: [
      { id: '#3', title: 'Fix off-by-one in pagination', report: report('Fix off-by-one in pagination', 'Page 2 repeated the last row because the cursor was inclusive. Fixes #9.') },
      { id: '#1', title: 'Add comprehensive retry mechanism', report: report('Add comprehensive retry mechanism', fixture('bloated-pr.md'), 'src/webhook.ts:7:2') },
      { id: '#2', title: 'Update', report: report('Update', '') },
    ],
  };
  const out = renderBoard(board, { color: false });

  it('ranks the yappiest first and marks what would fail', () => {
    const rows = out.split('\n').filter((l) => /^ {3}[✓✗] #/.test(l));
    expect(rows.map((l) => l.match(/#\d/)![0])).toEqual(['#1', '#2', '#3']);
    expect(rows[0]).toMatch(/^ {3}✗/);
    expect(rows[2]).toMatch(/^ {3}✓/);
  });

  it('calls out the yappiest, the laziest and the verdict', () => {
    expect(out).toContain('Yappiest  #1: 146 words for 9 changed lines.');
    expect(out).toContain('Laziest   1 PR that says nothing: "Update".');
    expect(out).toContain('Verdict   2 of 3 PRs would be sent back to rewrite.');
    expect(out).toContain('average');
  });
});

describe('parseRepoRef', () => {
  it('reads owner/repo and repo URLs, not PR URLs', () => {
    expect(parseRepoRef('vercel/next.js')).toEqual({ owner: 'vercel', repo: 'next.js' });
    expect(parseRepoRef('https://github.com/vercel/next.js/')).toEqual({ owner: 'vercel', repo: 'next.js' });
    expect(parseRepoRef('github.com/acme/api.git')).toEqual({ owner: 'acme', repo: 'api' });
    expect(parseRepoRef('https://github.com/acme/api/pull/3')).toBeNull();
    expect(parseRepoRef('just-a-word')).toBeNull();
  });
});

describe('fetchRecentPrs', () => {
  it('takes merged PRs by people and counts their lines from the files', async () => {
    const calls: string[] = [];
    const user = (login: string, type = 'User') => ({ login, type });
    const client: Client = {
      authenticated: false,
      async send() {
        throw new Error('read only');
      },
      async get<T>(path: string): Promise<T> {
        calls.push(path);
        if (path.includes('/pulls?')) {
          return [
            { number: 5, html_url: 'u5', title: 'Bump x', body: '', merged_at: '2026-01-01', user: user('dependabot[bot]', 'Bot') },
            { number: 4, html_url: 'u4', title: 'Closed, not merged', body: '', merged_at: null, user: user('a') },
            { number: 3, html_url: 'u3', title: 'Fix a thing', body: 'Because.', merged_at: '2026-01-01', user: user('a') },
            { number: 2, html_url: 'u2', title: 'Add b', body: 'Why.', merged_at: '2026-01-01', user: user('b') },
          ] as T;
        }
        return [
          { filename: 'src/a.ts', additions: 10, deletions: 2 },
          { filename: 'package-lock.json', additions: 500, deletions: 100 },
        ] as T;
      },
    };
    const prs = await fetchRecentPrs(client, { owner: 'acme', repo: 'api' }, 5);
    expect(prs.map((p) => p.number)).toEqual([3, 2]);
    expect(prs[0]!.diff.additions).toBe(510);
    expect(prs[0]!.diff.changedLines).toBe(12);
    expect(calls.length).toBe(3);
  });
});

describe('the website', () => {
  it('gives the page the same roast as the CLI, as data', async () => {
    const { demo } = await import('../src/web.js');
    const r = demo({ title: 'Add comprehensive retry mechanism', body: fixture('slop-pr.md'), files: [['src/webhook.ts', 7, 2]] });
    if (r.kind !== 'pr') throw new Error('expected a PR roast');
    expect(r.card.score).toBe(100);
    expect(r.card.grade).toBe('F');
    expect(r.card.words).toBe(117);
    expect(r.card.basics.why.mark).toBe('bad');
    expect(r.card.burns.length).toBe(5);
    expect(r.card.heat).toBe('roast');
    expect(r.card.keep).toEqual({ sentences: [], words: 0 });
    expect(r.text).toContain('THE BUZZCUT ROAST');
    expect(r.text).not.toContain('\x1b[');
    expect(r.share).toContain('x.com/intent/tweet');
  });
});
