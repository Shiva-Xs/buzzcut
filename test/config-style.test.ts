import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectAgent } from '../src/agent.js';
import { analyze, prMessage, wordRange } from '../src/analyze.js';
import { contextOf, renderContext } from '../src/context.js';
import { applyRuleSettings, ConfigError, isIgnored, loadConfig, parseConfig, DEFAULTS } from '../src/config.js';
import { RULE_IDS } from '../src/rules/index.js';
import { profileFrom } from '../src/style.js';
import { normalizeLine, parseTemplate } from '../src/template.js';
import { commit, diff, finding, fixture, rules } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'buzzcut-cfg-'));

describe('length setting', () => {
  const d = diff('src/orders.ts:60:40');
  const bullets = (n: number) => `Page 2 repeated rows because the offset shifted.\n\n${Array.from({ length: n }, (_, i) => `- change ${i + 1} in \`list.ts\``).join('\n')}`;

  it('defaults to normal and scales the word range', () => {
    expect(parseConfig({}, 'x', RULE_IDS).length).toBe('normal');
    expect(parseConfig({ length: 'short' }, 'x', RULE_IDS).length).toBe('short');
    const normal = wordRange('pr', d);
    expect(wordRange('pr', d, 'short').budget).toBe(Math.round(normal.budget * 0.6));
    expect(wordRange('pr', d, 'detailed').budget).toBe(Math.round(normal.budget * 1.6));
    expect(wordRange('commit', d, 'short').budget).toBeLessThan(wordRange('commit', d).budget);
  });

  it('moves the length and bullet limits, not the facts rules', () => {
    const words = 'Page 2 repeated rows because the offset query shifted when an order landed. ' + Array(14).fill('The pager now follows the cursor from the last row instead.').join(' ');
    const at = (length: 'short' | 'normal' | 'detailed', body: string) => analyze(prMessage('Page orders by cursor', body), d, { length });
    expect(finding(at('normal', words), 'length')).toBeUndefined();
    expect(finding(at('short', words), 'length')).toBeDefined();
    // 100 changed lines: 9 bullets at normal, 5 short, 14 detailed
    expect(finding(at('normal', bullets(8)), 'bullet-bloat')).toBeUndefined();
    expect(finding(at('short', bullets(8)), 'bullet-bloat')).toBeDefined();
    expect(finding(at('normal', bullets(12)), 'bullet-bloat')).toBeDefined();
    expect(finding(at('detailed', bullets(12)), 'bullet-bloat')).toBeUndefined();
    const claim = 'Page 2 repeated rows because the offset shifted.\n\nAdded unit tests for the cursor.';
    for (const l of ['short', 'normal', 'detailed'] as const) expect(finding(at(l, claim), 'phantom-tests')?.severity).toBe('error');
  });

  it('tells the agent in buzzcut context when it is not normal', () => {
    expect(renderContext(contextOf('pr', d, { length: 'short' }))).toContain('Length: short');
    expect(renderContext(contextOf('pr', d))).not.toContain('Length:');
  });
});

describe('config', () => {
  it('accepts a full config', () => {
    const c = parseConfig({ max: 40, block: 'always', rules: { 'em-dash': 'off', length: 'error' }, ignore: ['^release:'] }, 'x', RULE_IDS);
    expect(c).toMatchObject({ max: 40, block: 'always', rules: { 'em-dash': 'off', length: 'error' } });
    expect(isIgnored('release: 1.2', c)).toBe(true);
  });

  it.each([
    [{ max: 'lots' }, /"max" must be a number/],
    [{ max: 101 }, /"max" must be a number/],
    [{ block: 'sometimes' }, /"block" must be/],
    [{ length: 3 }, /"length" must be "short", "normal" or "detailed"/],
    [{ rules: { legnth: 'off' } }, /unknown rule "legnth"/],
    [{ rules: { length: 'loud' } }, /must be "off", "info", "warn" or "error"/],
    [{ ignore: ['('] }, /isn't a valid regex/],
    [{ colour: 'blue' }, /unknown key "colour"/],
    [[], /expected a JSON object/],
  ])('rejects %j', (raw, msg) => {
    expect(() => parseConfig(raw, 'x', RULE_IDS)).toThrow(msg);
  });

  it('loads .buzzcut.json, then package.json, then defaults', () => {
    const a = tmp();
    writeFileSync(join(a, '.buzzcut.json'), '{ "max": 10 }');
    expect(loadConfig(a, RULE_IDS).max).toBe(10);

    const b = tmp();
    writeFileSync(join(b, 'package.json'), JSON.stringify({ name: 'x', buzzcut: { block: 'never' } }));
    expect(loadConfig(b, RULE_IDS).block).toBe('never');

    expect(loadConfig(tmp(), RULE_IDS)).toBe(DEFAULTS);
  });

  it('reports broken JSON clearly', () => {
    const a = tmp();
    writeFileSync(join(a, '.buzzcut.json'), '{ max: 10 ');
    expect(() => loadConfig(a, RULE_IDS)).toThrow(ConfigError);
  });

  it('skips merges, reverts, fixups, dependency bumps and version tags by default', () => {
    for (const s of ['Merge pull request #12 from a/b', 'Revert "Add x"', 'fixup! Add x', 'Bump lodash from 4.17.20 to 4.17.21', 'chore(deps): bump vite to 5.1.0', 'v1.2.3']) {
      expect(isIgnored(s, DEFAULTS)).toBe(true);
    }
    expect(isIgnored('Add retry', DEFAULTS)).toBe(false);
  });

  it('skips release changelogs', () => {
    // regression: ant-design/ant-design#30772, a 2021 release changelog sent back for its list
    expect(isIgnored('docs: Add 4.16.1 changelog', DEFAULTS)).toBe(true);
    expect(isIgnored('Changelog for v2.3.0', DEFAULTS)).toBe(true);
    expect(isIgnored('Add a changelog check to CI', DEFAULTS)).toBe(false);
  });

  it('turns rules off and changes severity', () => {
    const r = commit('Added comprehensive retries.', diff('src/a.ts:5'));
    const out = applyRuleSettings(r.findings, { 'ai-vocab': 'off', 'subject-mood': 'error' });
    expect(out.map((f) => f.rule)).not.toContain('ai-vocab');
    expect(out.find((f) => f.rule === 'subject-mood')?.severity).toBe('error');
  });

  it('applies rule settings through analyze and rescores', () => {
    const d = diff('src/a.ts:5');
    const plain = analyze(prMessage('T', 'A comprehensive, robust change because it broke.'), d);
    const off = analyze(prMessage('T', 'A comprehensive, robust change because it broke.'), d, { rules: { 'ai-vocab': 'off' } });
    expect(off.score).toBeLessThan(plain.score);
  });
});

describe('detectAgent', () => {
  it.each([
    [{ CLAUDECODE: '1' }, 'Claude Code'],
    [{ CURSOR_AGENT: '1' }, 'Cursor'],
    [{ GEMINI_CLI: '1' }, 'Gemini CLI'],
    [{ CODEX_SANDBOX: 'seatbelt' }, 'Codex'],
    [{ AI_AGENT: 'amp' }, 'amp'],
    [{ BUZZCUT_AGENT: '1' }, 'agent'],
    [{ BUZZCUT_AGENT: '0', CLAUDECODE: '1' }, null],
    [{ CLAUDECODE: '0' }, null],
    [{}, null],
  ])('%j → %s', (env, want) => {
    expect(detectAgent(env as NodeJS.ProcessEnv)).toBe(want);
  });
});

describe('repo style', () => {
  const conventional = Array.from({ length: 20 }, (_, i) => ({ subject: `${['fix', 'feat', 'chore'][i % 3]}(api): handle case ${i}`, body: i % 4 ? '' : 'Because.' }));

  it('asks for a prefixed PR title in a repo whose commits use prefixes', () => {
    const d = diff('src/api.ts:20:5');
    expect(renderContext(contextOf('pr', d, { style: profileFrom(conventional) }))).toContain("with a prefix like this repo's commits (fix:, feat:, chore:)");
    expect(renderContext(contextOf('pr', d))).not.toContain('with a prefix');
  });

  it('profiles a conventional, lowercase repo', () => {
    const s = profileFrom(conventional)!;
    expect(s.conventional).toBe(1);
    expect(s.types).toEqual(['fix', 'feat', 'chore']);
    expect(s.capitalized).toBe(0);
    expect(s.body).toBe(0.25);
  });

  it('needs at least 10 hand-written commits', () => {
    expect(profileFrom(conventional.slice(0, 9))).toBeNull();
    const merges = Array.from({ length: 30 }, () => ({ subject: 'Merge branch main', body: '' }));
    expect(profileFrom(merges)).toBeNull();
  });

  it('learns the tense the history uses, and stops nagging a past-tense repo', () => {
    const past = ['Added login rate limit', 'Fixed invoice rounding', 'Updated README badges', 'Removed old cron job', 'Added CSV export', 'Fixed crash on empty cart', 'Renamed billing module', 'Added retry to mailer', 'Moved config loader', 'Fixed typo in signup email'].map((subject) => ({ subject, body: '' }));
    const style = profileFrom(past)!;
    expect(style.mood).toBe('past');
    const d = diff('src/a.ts:5');
    const run = (subject: string) => analyze({ kind: 'commit', title: subject, body: '', bodyLine: 2 }, d, { style });
    expect(finding(run('Added retry for webhook sends'), 'subject-mood')).toBeUndefined();
    const imperative = finding(run('Add retry for webhook sends'), 'subject-mood');
    expect(imperative?.severity).toBe('info');
    expect(imperative?.message).toContain('"Added …"');
    expect(profileFrom(conventional)!.mood).toBe('imperative');
    const mixed = profileFrom([...past.slice(0, 5), ...['Add CSV export', 'Fix crash on empty cart', 'Rename billing module', 'Add retry to mailer', 'Move config loader'].map((subject) => ({ subject, body: '' }))])!;
    expect(mixed.mood).toBe(null);
    expect(finding(analyze({ kind: 'commit', title: 'Added retry', body: '', bodyLine: 2 }, d, { style: mixed }), 'subject-mood')?.severity).toBe('info');
  });

  it('flags a missing prefix, a wrong type and the wrong case', () => {
    const style = profileFrom(conventional);
    const d = diff('src/a.ts:5');
    const run = (subject: string) => rules(analyze({ kind: 'commit', title: subject, body: '', bodyLine: 2 }, d, { style }));
    expect(run('Handle the 429 case')).toEqual(expect.arrayContaining(['style-convention', 'style-case']));
    expect(run('improvement(api): handle the 429 case')).toContain('style-convention');
    expect(run('fix(api): handle the 429 case')).not.toContain('style-convention');
  });

  it('flags a conventional prefix in a repo that never uses them', () => {
    const plain = profileFrom(Array.from({ length: 20 }, (_, i) => ({ subject: `Handle case ${i}`, body: '' })));
    const r = analyze({ kind: 'commit', title: 'fix: handle it', body: '', bodyLine: 2 }, diff('a.ts:3'), { style: plain });
    expect(finding(r, 'style-convention')?.severity).toBe('info');
  });

  it('asks for a ticket id when the repo always has one', () => {
    const style = profileFrom(Array.from({ length: 20 }, (_, i) => ({ subject: `PAY-${100 + i}: Handle case ${i}`, body: '' })));
    const r = analyze({ kind: 'commit', title: 'Handle the refund case', body: '', bodyLine: 2 }, diff('a.ts:3'), { style });
    expect(finding(r, 'style-ticket')?.message).toContain('PAY-100');
  });

  it('lets a repo with long subjects keep them', () => {
    const long = profileFrom(Array.from({ length: 20 }, (_, i) => ({ subject: `Handle case ${i} `.padEnd(95, 'x'), body: '' })));
    const subject = 'Handle the case where the webhook endpoint returns a 502 during a deploy window';
    expect(finding(commit(subject), 'subject-length')).toBeDefined();
    expect(finding(analyze({ kind: 'commit', title: subject, body: '', bodyLine: 2 }, null, { style: long }), 'subject-length')).toBeUndefined();
  });
});

describe('PR templates', () => {
  const template = parseTemplate([
    {
      path: '.github/pull_request_template.md',
      text: '## Summary\n\n<!-- What and why -->\n\n## How did you test this change?\n\n- [ ] I ran the tests\n- [ ] I updated the docs\n',
    },
  ]);

  it('normalizes lines so ticked template boxes still match', () => {
    expect(normalizeLine('- [x] I ran the tests')).toBe(normalizeLine('- [ ] I ran the tests'));
    expect(normalizeLine('## Summary:')).toBe('## summary');
  });

  it("doesn't count the template's headers and checkboxes against the author", () => {
    const body = '## Summary\n\nRetries 5xx because Stripe 502s during deploys.\n\n## How did you test this change?\n\n- [x] I ran the tests\n- [x] I updated the docs\n';
    const d = diff('src/a.ts:10');
    const without = analyze(prMessage('Retry 5xx', body), d);
    const withT = analyze(prMessage('Retry 5xx', body), d, { template });
    // "How did you test this change?" is the Tested part of the shape, so only the boxes count.
    expect(rules(without)).toEqual(['ticked-boxes']);
    expect(withT.findings).toEqual([]);
  });

  it('still judges what the author wrote under the template', () => {
    const body = `## Summary\n\n${fixture('bloated-pr.md')}`;
    const r = analyze(prMessage('Retry 5xx', body), diff('src/webhook.ts:7:2'), { template });
    expect(r.grade).toBe('F');
  });
});
