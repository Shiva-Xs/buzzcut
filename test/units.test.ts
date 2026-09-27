import { describe, expect, it } from 'vitest';
import { gradeOf, passes, specificityBonus, wordBudget } from '../src/analyze.js';
import { buildDiff, isDoc, isGenerated, isTest, parseNumstat } from '../src/diff.js';
import { isBot, isCodingAgent, parsePrRef } from '../src/github.js';
import { roastLine } from '../src/roast.js';
import { countWords } from '../src/text.js';
import { imperativeOf, pastOf, verbForm } from '../src/verbs.js';
import { isVague } from '../src/vague.js';
import { fingerprint } from '../src/seen.js';
import { droppedEvidence, evidenceOf } from '../src/facts.js';
import { newerVersion } from '../src/setup.js';
import { commit, diff } from './helpers.js';

describe('parseNumstat', () => {
  it('reads additions, deletions, binaries and renames', () => {
    const out = '10\t2\tsrc/a.ts\n-\t-\timg/logo.png\n3\t3\tsrc/{old => new}/b.ts\n1\t0\tlib/x.js => lib/y.js\n';
    expect(parseNumstat(out)).toEqual([
      { path: 'src/a.ts', additions: 10, deletions: 2 },
      { path: 'img/logo.png', additions: 0, deletions: 0 },
      { path: 'src/new/b.ts', additions: 3, deletions: 3, renamed: true },
      { path: 'lib/y.js', additions: 1, deletions: 0, renamed: true },
    ]);
  });
});

describe('file classification', () => {
  it.each(['src/a.test.ts', 'a_test.go', 'tests/x.py', 'testFoo.py', 'FooTest.java', 'e2e/login.ts', 'scripts/smoke-pack.mjs'])('%s is a test', (p) => {
    expect(isTest(p)).toBe(true);
  });
  it.each(['src/latest.ts', 'src/contest.py', 'src/attestation.go', 'src/protest.rb', 'src/effects/smoke.ts'])('%s is not a test', (p) => {
    expect(isTest(p)).toBe(false);
  });
  it('knows docs', () => {
    expect(isDoc('README.md')).toBe(true);
    expect(isDoc('docs/guide/intro.mdx')).toBe(true);
    expect(isDoc('src/index.ts')).toBe(false);
  });
});

describe('budgets and grades', () => {
  it('grows the budget with the diff and caps it', () => {
    expect(wordBudget('pr', diff('a.ts:5'))).toBe(80);
    expect(wordBudget('pr', diff('a.ts:100'))).toBe(140);
    expect(wordBudget('pr', diff('a.ts:10000'))).toBe(500);
    expect(wordBudget('pr', null)).toBe(250);
    expect(wordBudget('commit', diff('a.ts:5'))).toBe(34);
    expect(wordBudget('commit', diff('a.ts:100000'))).toBe(250);
  });

  it('rewards specifics up to 2.5×', () => {
    expect(specificityBonus(0)).toBe(1);
    expect(specificityBonus(8)).toBe(2);
    expect(specificityBonus(50)).toBe(2.5);
  });

  it('maps scores to grades', () => {
    expect(gradeOf(0).grade).toBe('A');
    expect(gradeOf(25).grade).toBe('B');
    expect(gradeOf(45).grade).toBe('C');
    expect(gradeOf(65).grade).toBe('D');
    expect(gradeOf(66).grade).toBe('F');
  });
});

describe('countWords', () => {
  it('counts links, inline code and URLs as one word each', () => {
    expect(countWords('See [the docs](https://x.y/z) and `foo.bar()` at https://a.b/c now')).toBe(8);
  });
});

describe('imperativeOf', () => {
  it('handles regular, doubled and irregular forms', () => {
    expect(imperativeOf('Added')).toBe('Add');
    expect(imperativeOf('dropping')).toBe('drop');
    expect(imperativeOf('Wrote')).toBe('Write');
    expect(imperativeOf('Simplifies')).toBe('Simplify');
    expect(imperativeOf('Add')).toBeNull();
    expect(imperativeOf('Readme')).toBeNull();
  });
});

describe('parsePrRef', () => {
  it('reads URLs and shorthand', () => {
    expect(parsePrRef('https://github.com/vercel/next.js/pull/123')).toEqual({ owner: 'vercel', repo: 'next.js', number: 123 });
    expect(parsePrRef('https://github.com/a/b/pull/9/files#diff-1')).toEqual({ owner: 'a', repo: 'b', number: 9 });
    expect(parsePrRef('a/b#42')).toEqual({ owner: 'a', repo: 'b', number: 42 });
    expect(parsePrRef('https://github.com/a/b/issues/9')).toBeNull();
  });
});

describe('roastLine', () => {
  it('is deterministic for the same PR', () => {
    const f = { rule: 'ai-vocab', severity: 'warn' as const, points: 6, message: '', hint: '', data: { words: 'robust' } };
    const s = { words: 100, lines: 10, budget: 60 };
    expect(roastLine(f, s, 'https://github.com/a/b/pull/1')).toBe(roastLine(f, s, 'https://github.com/a/b/pull/1'));
  });

  it('falls back to the finding message for rules without roast copy', () => {
    const f = { rule: 'subject-period', severity: 'info' as const, points: 2, message: 'Subject ends with a period', hint: '' };
    expect(roastLine(f, { words: 1, lines: 1, budget: 60 }, 'x')).toBe('Subject ends with a period.');
  });
});

describe('passes', () => {
  it('fails on any error even when the score is under the max', () => {
    const r = commit('Add unit tests for retries', diff('src/retry.ts:5'));
    expect(r.score).toBeLessThanOrEqual(25);
    expect(passes(r, 25)).toBe(false);
    expect(passes(commit('Retry webhook sends on 5xx', diff('src/retry.ts:5')), 25)).toBe(true);
  });
});

describe('shipped metadata', () => {
  it('schema.json lists exactly the rules that exist', async () => {
    const { readFileSync } = await import('node:fs');
    const { RULE_IDS } = await import('../src/rules/index.js');
    const schema = JSON.parse(readFileSync(new URL('../schema.json', import.meta.url), 'utf8'));
    expect(Object.keys(schema.properties.rules.properties).sort()).toEqual([...RULE_IDS].sort());
  });

  it('package.json and the Claude Code plugin agree on the version', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const plugin = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
    expect(plugin.version).toBe(pkg.version);
  });
});

describe('verb forms', () => {
  it('tells imperative from past tense', () => {
    expect(verbForm('Add')).toBe('imperative');
    expect(verbForm('Added')).toBe('past');
    expect(verbForm('built')).toBe('past');
    expect(verbForm('Fixes')).toBe('other');
    expect(verbForm('Adding')).toBe('other');
    expect(verbForm('Tests')).toBeNull();
    expect(pastOf('Add')).toBe('Added');
    expect(pastOf('drop')).toBe('dropped');
    expect(pastOf('Build')).toBe('Built');
  });
});

describe('vague subjects', () => {
  it('catches subjects that say nothing', () => {
    for (const s of ['Fix the thing', 'fix it', 'Fixed issues', 'bugfix', 'Quick fix', 'hotfix', 'test', 'tmp', '...', 'Update the code', 'code changes']) expect(isVague(s), s).toBe(true);
  });
  it('leaves real subjects alone', () => {
    for (const s of ['Fix typo in README', 'Fix the login redirect loop', 'Tests for the parser', 'Trigger CI', 'Initial commit', 'Hotfix: stop double charging on retry']) expect(isVague(s), s).toBe(false);
  });
});

describe('generated files', () => {
  it("don't count toward the changed lines", () => {
    expect(isGenerated('package-lock.json')).toBe(true);
    expect(isGenerated('web/pnpm-lock.yaml')).toBe(true);
    expect(isGenerated('dist/app.min.js')).toBe(true);
    expect(isGenerated('src/lock.ts')).toBe(false);
    const d = buildDiff([{ path: 'package-lock.json', additions: 4000, deletions: 900 }, { path: 'src/a.ts', additions: 5, deletions: 1 }]);
    expect(d.additions).toBe(4005);
    expect(d.changedLines).toBe(6);
  });
});

describe('seen-message fingerprints', () => {
  it('ignore whitespace, comments and trailers added by later hooks', () => {
    const a = fingerprint('Retry webhook sends on 5xx\n\nStripe 502s during deploys.\n');
    expect(fingerprint('Retry webhook sends on 5xx  \n\n\nStripe 502s during deploys.\n\nChange-Id: I1234\nSigned-off-by: Dev <d@x.io>\n# a comment')).toBe(a);
    expect(fingerprint('Retry webhook sends on 4xx\n\nStripe 502s during deploys.')).not.toBe(a);
  });
});

describe('newerVersion', () => {
  it('compares x.y.z', () => {
    expect(newerVersion('0.2.0', '0.1.9')).toBe(true);
    expect(newerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(newerVersion('0.1.0', '0.2.0')).toBe(false);
    expect(newerVersion('1.0.0', 'garbage')).toBe(false);
  });
});

describe('evidence', () => {
  it('finds numbers, measurements, refs, links and file:line pointers, not noise', () => {
    const ev = evidenceOf('Retries 3 times (200ms, 400ms). 253 orders, largest $60.01. See #436 and PAY-12, comm.c:1028, v1.4.2.\nhttp://localhost:3000 and https://cursor.com/assets/x.png\nSigned-off-by: A <a@x.io> 2024');
    expect(ev).toEqual(expect.arrayContaining(['200ms', '400ms', '253 orders', '$60.01', '#436', 'pay-12', 'comm.c:1028', 'v1.4.2']));
    expect(ev.join(' ')).not.toMatch(/localhost|cursor\.com|2024/);
  });

  it('also keeps commands, outputs, hashes and quoted messages, but not bare names', () => {
    const ev = evidenceOf('Ran `npm test` and `Get-AuthenticodeSignature` says `Status: NotSigned`; sha256 a11033e2854aa6cf matched. SmartScreen showed "Windows protected your PC" as expected. Updated `send` too.');
    expect(ev).toEqual(expect.arrayContaining(['npm test', 'status: notsigned', 'a11033e2854aa6cf', 'windows protected your pc']));
    expect(ev).not.toContain('send');
    expect(ev).not.toContain('get-authenticodesignature');
  });

  it('pairs quotes in order, even when a quote wraps onto the next line', () => {
    const ev = evidenceOf('A PR opening "The Send Feedback button did nothing in Comfy\nwindows" got "never says why". Now "did nothing" counts.');
    expect(ev).toContain('the send feedback button did nothing in comfy windows');
    expect(ev.join('|')).not.toMatch(/got|now/);
  });

  it('tells what a rewrite dropped', () => {
    expect(droppedEvidence(['253 orders', '$60.01', '#436'], 'We saw 253 orders; see #436.')).toEqual(['$60.01']);
  });

  it('reads numbers with thousands separators whole', () => {
    const ev = evidenceOf('About 3,900 of the 5,610 changed lines, 1,275,000 rows, 1,2,3 and 12,000ms.');
    expect(ev).toEqual(expect.arrayContaining(['3,900', '1,275,000 rows', '12,000ms']));
    expect(ev).not.toContain('900');
    expect(ev.join('|')).not.toMatch(/1,2,3/);
    expect(droppedEvidence(['3,900', '12,000ms'], 'About 3900 lines, 12000ms.')).toEqual([]);
    expect(droppedEvidence(['3,900'], 'About 4,300 lines, 900 of them tests.')).toEqual(['3,900']);
  });
});

describe('bots', () => {
  it('skips dependency bots but checks coding agents', () => {
    expect(isBot({ login: 'dependabot[bot]', type: 'Bot' })).toBe(true);
    expect(isBot({ login: 'renovate[bot]', type: 'Bot' })).toBe(true);
    for (const login of ['Copilot', 'devin-ai-integration[bot]', 'google-labs-jules[bot]', 'cursor[bot]', 'chatgpt-codex-connector[bot]']) {
      expect(isCodingAgent({ login }), login).toBe(true);
      expect(isBot({ login, type: 'Bot' }), login).toBe(false);
    }
    expect(isBot({ login: 'octocat', type: 'User' })).toBe(false);
  });
});
