// The changed lines a description can be checked against: where they come from (git, GitHub),
// when a diff counts as searchable, and what a session's transcript says was printed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDiff, changedText, parseDiffOutput } from '../src/diff.js';
import { amendDiff, branchDiff, commitDiff, stagedDiff, worktreeDiff } from '../src/git.js';
import { fileChange } from '../src/github.js';
import { parseGitPatch, splitPatch } from '../src/patch.js';
import { testCountsIn, transcriptText } from '../src/session.js';

describe('splitPatch (GitHub)', () => {
  it('keeps only the added and removed lines, and reads "--" and "++" content correctly', () => {
    const patch = ['@@ -1,3 +1,3 @@ fn()', ' context', '-old line', '+new line', '--- a sql comment', '+++ b counter', ' more context'].join('\n');
    expect(splitPatch(patch)).toEqual({ added: 'new line\n++ b counter', removed: 'old line\n-- a sql comment' });
  });
});

describe('parseGitPatch (git diff -U0)', () => {
  const out = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 111..222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1,2 @@',
    '-const retries = 1;',
    '+const retries = 3;',
    '+const backoff = 200;',
    'diff --git a/old/b.ts b/new/b.ts',
    'similarity index 90%',
    'rename from old/b.ts',
    'rename to new/b.ts',
    '--- a/old/b.ts',
    '+++ b/new/b.ts',
    '@@ -5 +5 @@',
    '-export const X_Retry_After = 1;',
    '+export const X_Retry_After = 2;',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-legacyThing();',
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
    'diff --git a/with space.md b/with space.md',
    '--- a/with space.md\t',
    '+++ b/with space.md\t',
    '@@ -1 +1 @@',
    '-a',
    '+++ a heading that starts with plus signs',
  ].join('\n');

  it('attributes lines to the right file: renames, deletions, binaries, spaces, and header-looking content', () => {
    const m = parseGitPatch(out);
    expect(m.get('src/a.ts')).toEqual({ added: 'const retries = 3;\nconst backoff = 200;', removed: 'const retries = 1;' });
    expect(m.get('new/b.ts')?.added).toBe('export const X_Retry_After = 2;');
    expect(m.get('gone.ts')).toEqual({ added: '', removed: 'legacyThing();' });
    expect(m.has('logo.png')).toBe(false);
    expect(m.get('with space.md')).toEqual({ added: '++ a heading that starts with plus signs', removed: 'a' });
  });

  it('splits numstat from the patch even when a removed line looks like a numstat row', () => {
    const both = ['2\t1\tsrc/a.ts', '', 'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', '-\t-\tnot a numstat row', '+ok', '+fine'].join('\n');
    const files = parseDiffOutput(both);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'src/a.ts', additions: 2, deletions: 1, added: 'ok\nfine', removed: '\t-\tnot a numstat row' });
  });
});

describe('searchable', () => {
  const withText = { path: 'src/a.ts', additions: 2, deletions: 1, added: 'x', removed: 'y' };
  it('needs every file that changes lines to carry them', () => {
    expect(buildDiff([withText]).searchable).toBe(true);
    expect(buildDiff([withText, { path: 'src/b.ts', additions: 4, deletions: 0 }]).searchable).toBe(false);
  });
  it('lets generated files, empty changes and renames without edits through', () => {
    const lock = { path: 'package-lock.json', additions: 900, deletions: 40 };
    const moved = { path: 'src/new.ts', additions: 0, deletions: 0, renamed: true };
    expect(buildDiff([withText, lock, moved]).searchable).toBe(true);
  });
  it('is false for a diff that only has line counts, or a file list cut short', () => {
    expect(buildDiff([{ path: 'a.ts', additions: 1, deletions: 0 }]).searchable).toBe(false);
    expect(buildDiff([withText], undefined, true).searchable).toBe(false);
  });
  it('joins the changed lines of a diff, leaving generated files out', () => {
    const d = buildDiff([withText, { path: 'dist/app.min.js', additions: 1, deletions: 1, added: 'MINIFIED', removed: 'OLD' }]);
    expect(changedText(d)).toEqual({ added: 'x', removed: 'y' });
  });
});

describe('GitHub files', () => {
  it('carries the patch when GitHub sends one, and marks the file unsearchable when it does not', () => {
    expect(fileChange({ filename: 'a.ts', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' })).toMatchObject({ path: 'a.ts', added: 'b', removed: 'a' });
    expect(fileChange({ filename: 'big.json', additions: 9000, deletions: 0 }).added).toBeUndefined();
  });
});

describe('diffs from real git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzcut-evidence-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...a: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...a], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (p: string, s: string) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), s);
  };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, '.gitconfig'), '[user]\n\tname = T\n\temail = t@example.com\n');
  git('init', '-q', '-b', 'main');
  write('src/webhook.js', 'export function send(url) {\n  return fetch(url);\n}\n');
  write('docs/old.md', 'legacy note\n');
  write('assets/logo.png', 'not really a png\n');
  git('add', '.');
  git('commit', '-q', '-m', 'start');
  git('checkout', '-q', '-b', 'retry');

  write('src/webhook.js', 'export function send(url, tries = 3) {\n  return retry(fetch, url, tries);\n}\n');
  git('rm', '-q', 'docs/old.md');
  write('src/retry.js', 'export const MAX_BACKOFF_MS = 800;\n');
  git('add', '.');

  it('reads the staged change: added lines, removed lines, new files and deletions', () => {
    const d = stagedDiff(dir)!;
    expect(d.searchable).toBe(true);
    const { added, removed } = changedText(d);
    expect(added).toContain('return retry(fetch, url, tries);');
    expect(added).toContain('MAX_BACKOFF_MS');
    expect(removed).toContain('return fetch(url);');
    expect(removed).toContain('legacy note');
    expect(added).not.toContain('fetch(url);\n}'); // context lines are never kept
  });

  it('reads a branch, a commit, and an amend the same way', () => {
    git('commit', '-q', '-m', 'Retry sends');
    expect(changedText(branchDiff('main', dir)!).added).toContain('MAX_BACKOFF_MS');
    expect(changedText(commitDiff('HEAD', dir)!).removed).toContain('legacy note');
    write('src/retry.js', 'export const MAX_BACKOFF_MS = 800;\nexport const JITTER_MS = 100;\n');
    git('add', '.');
    expect(changedText(amendDiff(dir)!).added).toContain('JITTER_MS');
  });

  it('reads untracked files for a commit that stages them itself, and calls an unreadable one unsearchable', () => {
    git('commit', '-q', '-m', 'Add jitter');
    write('src/fresh.js', 'export function freshName() {}\n');
    const d = worktreeDiff(dir)!;
    expect(d.searchable).toBe(true);
    expect(changedText(d).added).toContain('freshName');
    write('src/huge.txt', 'x'.repeat(2_100_000));
    expect(worktreeDiff(dir)!.searchable).toBe(false);
    rmSync(join(dir, 'src/huge.txt'));
  });

  it('keeps a binary change searchable: it has no lines to describe', () => {
    write('assets/logo.png', 'a\u0000changed binary\n');
    git('add', 'assets/logo.png');
    expect(stagedDiff(dir)!.searchable).toBe(true);
  });
});

describe('what a session printed', () => {
  it.each([
    ['vitest', ' Test Files  13 passed (13)\n      Tests  412 passed (412)\n   Duration  16.28s', [13, 412]],
    ['jest', 'Tests:       3 failed, 209 passed, 212 total', [3, 209, 212]],
    ['pytest', '=========== 212 passed, 4 skipped in 3.20s ===========', [212, 4]],
    ['cargo', 'test result: ok. 212 passed; 0 failed; 0 ignored', [212, 0]],
    ['mocha', '  212 passing (3s)\n  1 failing', [212, 1]],
    ['maven', 'Tests run: 14, Failures: 0, Errors: 0, Skipped: 0', [14, 0]],
    ['unittest', 'Ran 14 tests in 0.512s\n\nOK', [14]],
    ['phpunit', 'OK (14 tests, 30 assertions)', [14, 30]],
    ['rspec', '14 examples, 0 failures', [14, 0]],
    ['playwright', '  162 passed (2.3m)', [162]],
    ['big numbers', '1,284 passed', [1284]],
  ])('reads %s', (_name, out, counts) => {
    const got = testCountsIn(out);
    for (const c of counts) expect(got).toContain(c);
  });

  it('does not take durations, dates or stray numbers near the word "test" for counts', () => {
    const got = testCountsIn('Duration 16.28s\nstarted 2026-09-28 at 14:51:05\nrunning the test harness on port 8080\nfixed test 214 flakes in CI');
    expect(got).not.toContain(16);
    expect(got).not.toContain(2026);
    expect(got).not.toContain(8080);
    expect(got).not.toContain(214);
  });

  const line = (o: unknown) => JSON.stringify(o);
  const transcript = [
    line({ type: 'user', message: { role: 'user', content: 'the staging error rate was 2.1% after the outage, see #4121' } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Tests  212 passed (212)' }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'ok 14 tests' }] }] } }),
    'not json',
  ].join('\n');

  it("reads the user's messages and each command's output from a Claude Code transcript", () => {
    const t = transcriptText(transcript);
    expect(t.hasOutput).toBe(true);
    expect(t.text).toContain('2.1%');
    expect(t.text).toContain('#4121');
    expect(t.testCounts).toEqual(expect.arrayContaining([212, 14]));
  });

  it('says there was no output when the transcript has none, so nothing is judged', () => {
    const t = transcriptText(line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }));
    expect(t.hasOutput).toBe(false);
    expect(t.testCounts).toEqual([]);
  });

  it("keeps the end of a long output: a test run's summary is the last thing it prints", () => {
    const long = 'noise line\n'.repeat(20_000) + 'Tests  777 passed (777)';
    const t = transcriptText(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: long }] } }));
    expect(t.text).toContain('777 passed');
    expect(t.testCounts).toContain(777);
  });
});
