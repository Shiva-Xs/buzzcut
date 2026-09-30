// The source lookups: a name, file, figure or test count in a description is looked up in the
// diff, the repo and the session. Real git repos, real `git grep`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyze, parseCommit, passes, prMessage } from '../src/analyze.js';
import { buildDiff } from '../src/diff.js';
import { stagedDiff } from '../src/git.js';
import { claimsIn, codeShaped, factsIn, gitRepoSearch, makeResolver, norm, passedClaims, pathOf, type RepoSearch } from '../src/lookup.js';
import type { SessionFacts } from '../src/rules/rule.js';
import { LEVELS } from '../src/rules/sourced.js';
import { agentHook } from '../src/hooks.js';
import { analyzeText } from '../src/text.js';
import type { Report } from '../src/types.js';
import { finding } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'buzzcut-sourced-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
const git = (...a: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...a], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (p: string, s: string) => {
  mkdirSync(dirname(join(dir, p)), { recursive: true });
  writeFileSync(join(dir, p), s);
};
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A small repo with a webhook sender, a retry policy that already exists, a header helper the
// change removes, and a doc that names an idempotency key.
writeFileSync(join(dir, '.gitconfig'), '[user]\n\tname = T\n\temail = t@example.com\n');
git('init', '-q', '-b', 'main');
write('src/webhook.js', 'export async function send(url, body) {\n  const res = await fetch(url, { method: "POST", body });\n  return res.ok;\n}\n');
write('src/policy.js', 'export function retryPolicy() {\n  return { max: 3 };\n}\n');
write('src/headers.js', 'export function legacyRetryHeader() {\n  return "X-Legacy";\n}\n');
write('docs/api.md', 'Clients may send an idempotency_key to make a call safe to repeat.\n');
git('add', '.');
git('commit', '-q', '-m', 'start');

// The change: retry on 5xx, with a cap constant, and the legacy header helper goes away.
write('src/webhook.js', 'export const MAX_BACKOFF_MS = 800;\nexport async function send(url, body, tries = 3) {\n  for (let i = 0; i < tries; i++) {\n    const res = await fetch(url, { method: "POST", body });\n    if (res.status < 500) return res.ok;\n    await new Promise((r) => setTimeout(r, Math.min(200 * 2 ** i, MAX_BACKOFF_MS)));\n  }\n  return false;\n}\n');
git('rm', '-q', 'src/headers.js');
git('add', '.');

const diff = stagedDiff(dir)!;
const repo = gitRepoSearch(dir);
const session = (extra: Partial<SessionFacts> = {}): SessionFacts => ({ tests: ['npm test'], exercised: ['npm test'], hasOutput: true, text: 'Tests  212 passed (212)', testCounts: [212], ...extra });
const check = (body: string, opts: { repo?: RepoSearch | null; session?: SessionFacts | null; d?: typeof diff } = {}): Report =>
  analyze(prMessage('Retry webhook sends on 5xx', body), opts.d ?? diff, { repo: 'repo' in opts ? opts.repo : repo, session: opts.session ?? null });
const rules = (r: Report) => r.findings.map((f) => f.rule);
const sourced = (r: Report) => r.findings.filter((f) => ['unsourced-name', 'unsourced-fact', 'test-count-mismatch'].includes(f.rule));

describe('names and files', () => {
  it('leaves an honest description alone', () => {
    const r = check('`send()` now takes `tries` and waits `200 * 2 ** i` ms between attempts, capped by `MAX_BACKOFF_MS`, because Stripe returns 502 while it deploys.\n\nTested: not run.');
    expect(sourced(r)).toEqual([]);
  });

  it('flags a name the change is said to add that exists nowhere', () => {
    const f = finding(check('Adds an `X-Retry-Budget` header so receivers can see the attempts left, and retries `send()` on 5xx.'), 'unsourced-name');
    expect(f?.severity).toBe('warn');
    expect(f?.message).toContain('`X-Retry-Budget`');
    expect(f?.message).toContain("isn't in the diff or anywhere in the repo");
  });

  it('finds a name however it is spelled, in the diff and in the rest of the repo', () => {
    // MAX_BACKOFF_MS is in the diff; idempotency_key only in a doc the diff doesn't touch.
    expect(sourced(check('Adds `maxBackoffMs` as the cap between attempts.'))).toEqual([]);
    const f = sourced(check('Adds an `idempotencyKey` argument to `send()`.'));
    expect(f.map((x) => x.severity)).toEqual(['info']);
    expect(f[0]!.message).toContain('already exist');
  });

  it('finds a header named in plain prose, and leaves the headers HTTP defines alone', () => {
    const f = finding(check('Retries `send()` on 5xx and attaches an Idempotency-Key header so receivers can drop duplicates.', { repo: gitRepoSearch(tmpdir()) }), 'unsourced-name');
    expect(f).toBeUndefined(); // no checkout to search: nothing is judged
    const r = check('Retries on 5xx and adds a Retry-Budget header so receivers can see the attempts left.');
    expect(finding(r, 'unsourced-name')?.message).toContain('`Retry-Budget`');
    expect(sourced(check('Retries on 5xx and sends a Retry-After header, and reads the Content-Type header.'))).toEqual([]);
  });

  it('accepts a dotted name when each part is in the repo, and flags one whose parts are not', () => {
    // Policy and retryPolicy are both in the fixture repo; neither part of Ledger.spendUnits is
    expect(sourced(check('Uses `Policy.retryPolicy` in the retry loop.'))).toEqual([]);
    expect(finding(check('Uses `Ledger.spendUnits` in the retry loop.'), 'unsourced-name')?.severity).toBe('warn');
  });

  it('notes, without blocking, a name that is only mentioned and exists nowhere', () => {
    const f = finding(check('The `RetryBudgetManager` was the cause of the outage.'), 'unsourced-name');
    expect(f?.severity).toBe('warn');
  });

  it('flags a name a sentence says the change does something with, whatever the verb', () => {
    for (const s of ['Handles the case where the `RetryBudgetManager` gives up.', 'Outlines the limits for `RetryBudgetManager`.', 'Also whitelists `RetryBudgetManager` in the linter.', 'Ensures unexpected states throw `RetryBudgetException`.']) {
      expect(finding(check(s), 'unsourced-name')?.severity, s).toBe('warn');
    }
  });

  it('lets a name through when the sentence says where it comes from', () => {
    for (const s of ['Retries when `ERR_STREAM_PREMATURE_CLOSE` comes from the Node runtime.', 'Handles `RetryBudgetManager` from the upstream SDK.', 'Wraps the third-party `RetryBudgetManager`.']) {
      expect(sourced(check(s)), s).toEqual([]);
    }
  });

  it('looks at the words just before a name for a negation, not the whole sentence', () => {
    expect(finding(check('Also initializes `RetryBudgetManager` when no CLI options are supplied.'), 'unsourced-name')?.severity).toBe('warn');
    expect(sourced(check('Does not add `RetryBudgetManager` yet.'))).toEqual([]);
    expect(sourced(check('Works without `RetryBudgetManager`.'))).toEqual([]);
  });

  it('checks a bare file name in backticks, and files with any common extension', () => {
    expect(finding(check('Adds an exclude directive for `release_checklist.py`.'), 'unsourced-name')?.severity).toBe('warn');
    expect(finding(check('Updates `docs/topics/url-length-benchmarks.rst`.'), 'unsourced-name')?.severity).toBe('warn');
    expect(finding(check('Updates `ui/app/templates/role.hbs`.'), 'unsourced-name')?.severity).toBe('warn');
    expect(sourced(check('Updates `webhook.js`.'))).toEqual([]); // in the diff
    expect(sourced(check('Runs on Node.js 20.'))).toEqual([]); // "Node.js" is not a file
  });

  it('with a session, even a name only mentioned that no command showed is flagged as made up', () => {
    const s = session({ text: 'saw retryPolicy in policy.js' });
    expect(finding(check('The `RetryBudgetManager` was the cause of the outage.', { session: s }), 'unsourced-name')?.severity).toBe('warn');
    expect(sourced(check('The `retryPolicy` was the cause of the outage.', { session: s }))).toEqual([]);
  });

  it('catches a removal described as an addition, and lets removals and renames through', () => {
    const f = finding(check('Adds `legacyRetryHeader()` so old receivers keep working.'), 'unsourced-name');
    expect(f?.message).toContain('the diff only removes it');
    expect(sourced(check('Removes `legacyRetryHeader()` and replaces it with a retry loop in `send()`.'))).toEqual([]);
    expect(sourced(check('Adds `legacyRetryHeader()` back.'))).toEqual([]);
    // a plain word in backticks counts for this one check only: the diff itself contradicts "adds"
    expect(finding(check('Adds `X-Legacy` support.'), 'unsourced-name')?.message).toContain('the diff only removes');
  });

  it('flags a file the change is said to touch that exists nowhere, and accepts one in the diff or the repo', () => {
    expect(finding(check('Updates `src/retry/policy.ts` to cap the delay.'), 'unsourced-name')?.severity).toBe('warn');
    expect(sourced(check('Updates `src/webhook.js` and reads `src/policy.js`.'))).toEqual([]);
    const f = sourced(check('Adds `src/policy.js` with the retry limits.'));
    expect(f.map((x) => x.severity)).toEqual(['info']);
  });

  it('skips sentences about other things: existing code, plans, negations, tested lines', () => {
    for (const s of [
      'Uses the existing `RetryBudgetManager` for the delays.',
      'A follow-up could add `RetryBudgetManager`.',
      "Doesn't add `RetryBudgetManager` yet.",
      'Tested: `RetryBudgetManager` behaves.',
      'Fixed the parser. Tested with `RetryBudgetManager`.',
      '> `RetryBudgetManager` is what the issue asked for',
    ]) {
      expect(sourced(check(`Retry sends on 5xx.\n\n${s}`)), s).toEqual([]);
    }
  });

  it('is silent without evidence: no patch text, no repo checkout, a file list cut short', () => {
    const counts = buildDiff([{ path: 'src/webhook.js', additions: 8, deletions: 1 }]);
    expect(sourced(check('Adds an `X-Retry-Budget` header.', { d: counts }))).toEqual([]);
    expect(sourced(check('Adds an `X-Retry-Budget` header.', { repo: null }))).toEqual([]);
    const cut = buildDiff([{ path: 'src/webhook.js', additions: 8, deletions: 1, added: 'x', removed: '' }], undefined, true);
    expect(sourced(check('Adds an `X-Retry-Budget` header.', { d: cut }))).toEqual([]);
  });

  it('is silent when the repo search fails, rather than guessing', () => {
    const broken: RepoSearch = { find: () => null, hasFile: () => null };
    expect(sourced(check('Adds an `X-Retry-Budget` header and touches `src/retry/policy.ts`.', { repo: broken }))).toEqual([]);
  });

  it('still flags an invented name in a commit message', () => {
    const r = analyze(parseCommit('Add RetryBudgetManager for the webhook delays\n\nAdds `RetryBudgetManager` so sends back off together.'), diff, { repo });
    expect(finding(r, 'unsourced-name')?.severity).toBe('warn');
  });

  it('never blocks by default: the measured false-alarm rate on honest PRs was too high (see LEVELS)', () => {
    const r = check('Adds an `X-Retry-Budget` header so receivers can see the attempts left.');
    expect(finding(r, 'unsourced-name')?.severity).toBe('warn');
    expect(passes(r, 35)).toBe(true);
    expect(LEVELS.nameNowhere).toBe('warn');
  });

  it('blocks when the repo opts in with "rules": { "unsourced-name": "error" }', () => {
    const r = analyze(prMessage('Retry webhook sends', 'Adds an `X-Retry-Budget` header so receivers can see the attempts left.'), diff, { repo, rules: { 'unsourced-name': 'error' } });
    expect(finding(r, 'unsourced-name')?.severity).toBe('error');
    expect(passes(r, 35)).toBe(false);
  });

  it('can be switched off like any rule', () => {
    const r = analyze(prMessage('Retry webhook sends', 'Adds an `Idempotency-Key` header.'), diff, { repo, rules: { 'unsourced-name': 'off' } });
    expect(rules(r)).not.toContain('unsourced-name');
  });
});

describe('figures and references', () => {
  const s = session({ text: 'the staging error rate was 2.1% during their outage, see #4121\nTests  212 passed (212)' });

  it('notes a figure or reference that no command printed and the user never wrote, only when there is a session', () => {
    const body = 'Retries on 5xx. Delivery failures fell from 2.1% to 0.03% in staging over 48 hours, fixing #4123.';
    const f = finding(check(body, { session: s }), 'unsourced-fact');
    expect(f?.severity).toBe('warn');
    expect(f?.message).toContain('`0.03%`');
    expect(f?.message).toContain('`#4123`');
    expect(f?.message).not.toContain('`2.1%`');
    expect(f?.message).not.toContain('`#4121`');
    expect(finding(check(body), 'unsourced-fact')).toBeUndefined(); // no session: a person's figure may come from anywhere
  });

  it('checks an HTTP status code when a word before it says it is one', () => {
    const f = finding(check('Retries when the receiver returns 429 or a 503.', { session: s }), 'unsourced-fact');
    expect(f?.message).toContain('`429`');
    expect(finding(check('Retries 500 files at a time.', { session: s }), 'unsourced-fact')).toBeUndefined();
    // a line about HTTP: every listed status code in it is one
    expect(finding(check('Retries on 5xx and 429 responses.', { session: s }), 'unsourced-fact')?.message).toContain('`429`');
  });

  it('takes a figure that is in the diff, and stays silent when the session has no output', () => {
    expect(finding(check('Caps the delay at 800 ms.', { session: s }), 'unsourced-fact')).toBeUndefined();
    expect(finding(check('Failures fell to 0.03% in staging.', { session: session({ hasOutput: false, text: '' }) }), 'unsourced-fact')).toBeUndefined();
  });
});

describe('test counts', () => {
  it('sends back a count no test run printed, and takes the one that was, or a sum of two runs', () => {
    expect(finding(check('Retries on 5xx.\n\nTested: `npm test` (214 passed).', { session: session() }), 'test-count-mismatch')?.severity).toBe('error');
    expect(finding(check('Retries on 5xx.\n\nTested: `npm test` (212 passed).', { session: session() }), 'test-count-mismatch')).toBeUndefined();
    expect(finding(check('Retries on 5xx.\n\nTested: 300 passed.', { session: session({ testCounts: [100, 200] }) }), 'test-count-mismatch')).toBeUndefined();
  });

  it('says what the runs did print', () => {
    const f = finding(check('Retries on 5xx.\n\nTested: 214 passed.', { session: session({ testCounts: [212, 26, 13] }) }), 'test-count-mismatch');
    expect(f?.hint).toContain('212, 26, 13');
  });

  it('is silent without output, without a test run, or for "N tests" that is not a pass claim', () => {
    expect(finding(check('Tested: 214 passed.', { session: session({ hasOutput: false, testCounts: [] }) }), 'test-count-mismatch')).toBeUndefined();
    expect(finding(check('Tested: 214 passed.', { session: session({ tests: [], testCounts: [212] }) }), 'test-count-mismatch')).toBeUndefined();
    expect(finding(check('Adds 3 tests for the retry path.\n\nTested: 212 passed.', { session: session() }), 'test-count-mismatch')).toBeUndefined();
  });

  it("doesn't ask for a made-up count back when the agent rewrites without it", () => {
    // dropped-facts must not demand the figure buzzcut just told the agent to remove.
    const first = check('Retries on 5xx.\n\nTested: `npm test` (214 passed).', { session: session() });
    const r = analyze(prMessage('Retry webhook sends on 5xx', 'Retries on 5xx.\n\nTested: `npm test` (212 passed).'), diff, { repo, session: session(), previous: { evidence: ['214 passed'], strict: true } });
    expect(finding(first, 'test-count-mismatch')).toBeDefined();
    expect(finding(r, 'test-count-mismatch')).toBeUndefined();
  });
});

describe('vague testing', () => {
  it.each(['works locally', 'Works fine', 'worked on my machine', 'verified locally', 'sanity checked'])('flags "%s" with no command or result', (s) => {
    expect(finding(check(`Retries on 5xx.\n\nTested: ${s}.`), 'vague-verification')).toBeDefined();
  });
  it('lets it through when the command or result is there', () => {
    expect(finding(check('Retries on 5xx.\n\nTested: `npm test` (212 passed); works fine locally.'), 'vague-verification')).toBeUndefined();
  });
});

describe('the word budget', () => {
  // Enough specifics to earn a bonus, not enough to hit the 2.5x cap that would hide the difference.
  const real = 'Retries `send()` on a 5xx up to three times. The wait caps at `MAX_BACKOFF_MS`, and receivers behind a load balancer return 502 for about 4 minutes on each deploy. Before this the event was dropped and nobody was told; now the sender waits and tries again, then reports the failure to the caller.';
  const invented = real.replace('MAX_BACKOFF_MS', 'MAX_RETRY_CAP_MS').replace('return 502', 'return 503').replace('4 minutes', '9 minutes');
  const s = session({ text: 'the receiver returned 502 for about 4 minutes during the deploy' });

  it('gives extra room to specifics it can find, and none to ones it cannot', () => {
    const a = check(real, { session: s });
    const b = check(invented, { session: s });
    expect(a.density).toBeGreaterThan(b.density);
    expect(a.budget).toBeGreaterThan(b.budget);
  });

  it('counts what it cannot check, so a person with no session is judged as before', () => {
    const noSession = check(invented);
    const bare = analyze(prMessage('Retry webhook sends on 5xx', invented), buildDiff([{ path: 'src/webhook.js', additions: 8, deletions: 1 }]));
    // A name it can look up and doesn't find costs its bonus; a figure it can't check keeps it.
    expect(noSession.density).toBeLessThan(bare.density);
    expect(noSession.density).toBeGreaterThan(check(invented, { session: s }).density);
  });
});

describe('the lookup pieces', () => {
  it('reads one name however it is spelled', () => {
    expect(new Set(['Idempotency-Key', 'idempotency_key', 'idempotencyKey()', 'IDEMPOTENCY_KEY'].map(norm)).size).toBe(1);
  });

  it.each(['retryPolicy', 'RetryPolicy', 'max_retries', 'MAX_RETRIES', 'X-Retry-After', 'Idempotency-Key', 'Ledger.post', 'send_email()'])('%s looks like code', (s) => {
    expect(codeShaped(s)).toBe(true);
  });
  it.each(['retry', 'webhook', 'Stripe', 'GitHub', 'iPhone', 'README.md', 'package.json', 'foo', 'TypeScript', '3.2.1'])('%s does not', (s) => {
    expect(codeShaped(s)).toBe(false);
  });

  it('takes paths with a directory and a known extension, and not URLs or absolute ones', () => {
    expect(pathOf('src/retry/policy.ts')).toBe('src/retry/policy.ts');
    expect(pathOf('./src/a.js')).toBe('src/a.js');
    for (const s of ['/etc/hosts.conf', '~/x/y.json', 'github.com/foo/bar.go', 'node_modules/x/y.js', 'a.ts', '../x/y.ts']) expect(pathOf(s), s).toBeNull();
  });

  it('reads what a sentence says the change does to a name', () => {
    const [a, b, c] = claimsIn('', analyzeText('Adds `aaaBbbCcc`, removes `dddEeeFff` and calls `gggHhhIii`.').lines);
    expect([a!.adds, b!.removes, c!.touches]).toEqual([true, true, true]);
  });

  it('pulls measured figures, references and pass claims out of prose, not tested lines', () => {
    expect(factsIn(analyzeText('Fell from 2.1% to 0.03% in 48 hours, see #4121.\nTested: 3 s.').lines).map((f) => f.text)).toEqual(['2.1%', '0.03%', '#4121']);
    expect(passedClaims('', analyzeText('212 passed and all 48 tests, plus 3 tests added.').lines).map((c) => c.n)).toEqual([212, 48]);
  });

  it('sees nothing to look in when there is no evidence at all', () => {
    expect(makeResolver({ diff: buildDiff([{ path: 'a.ts', additions: 1, deletions: 0 }]), session: null, repo })).toBeNull();
  });
});

describe('the repo search', () => {
  it('finds a name spelled any way in the tracked files, in one call', () => {
    const found = repo.find(['Idempotency-Key', 'NoSuchThingAnywhere', 'RETRY_POLICY', 'legacyRetryHeader']);
    // legacyRetryHeader is only in a file the change deletes: gone from the tree, so not found here
    expect(found).toEqual(new Set(['Idempotency-Key', 'RETRY_POLICY']));
  });

  it("never lets an untracked file, such as the description's own draft, vouch for a name", () => {
    write('pr-body.md', 'Adds an `X-Draft-Only-Header` header.\n');
    expect(repo.find(['X-Draft-Only-Header'])).toEqual(new Set());
    rmSync(join(dir, 'pr-body.md'));
  });

  it("answers null outside a repo, so nothing is judged", () => {
    const outside = gitRepoSearch(tmpdir());
    expect(outside.find(['whateverName'])).toBeNull();
    expect(outside.hasFile('src/a.ts')).toBeNull();
  });

  it('checks that a file exists', () => {
    expect(repo.hasFile('src/policy.js')).toBe(true);
    expect(repo.hasFile('src/retry/policy.ts')).toBe(false);
  });
});

describe('what an agent is told', () => {
  // one -m per paragraph, as git joins them: real newlines, not a backslash-n inside the quotes
  const payload = (message: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit ' + message.split('\n\n').map((m) => `-m ${JSON.stringify(m)}`).join(' ') }, cwd: dir });
  const run = (message: string) => agentHook(payload(message), 'claude', { cwd: dir, env: {}, color: false });

  it('passes a commit with a made-up name, and hands the agent the note instead of blocking', () => {
    const r = run('Retry sends on 5xx\n\nAdds an `X-Retry-Budget` header so receivers can see the attempts left.');
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBeUndefined();
    expect(out.additionalContext).toContain('these notes are for you. Nothing was blocked');
    expect(out.additionalContext).toContain('X-Retry-Budget');
  });

  it('says nothing about a commit whose names are all real', () => {
    const r = run('Retry sends on 5xx\n\nAdds `MAX_BACKOFF_MS` to cap the wait between attempts.');
    expect(r.stdout).toBe('');
  });

  it('still blocks what is wrong for other reasons, and includes the notes in that feedback', () => {
    const r = run('fix bug\n\nAdds an `X-Retry-Budget` header.');
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
