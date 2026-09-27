import { describe, expect, it } from 'vitest';
import { passes } from '../src/analyze.js';
import { commit, diff, finding, pr, rules } from './helpers.js';

const small = diff('src/webhook.ts:7:2');

describe('commit subjects', () => {
  it('passes a plain good commit', () => {
    const r = commit('Retry webhook sends on 5xx\n\nStripe returns 502 during deploys and we dropped the event.', small);
    expect(r.findings).toEqual([]);
  });

  it.each([
    ['Added retry to webhooks', 'Add'],
    ['Fixes the retry loop', 'Fix'],
    ['Updating deps', 'Update'],
    ['feat(api): Implemented retries', 'Implement'],
    ['PAY-12: Refactored sender', 'Refactor'],
    ['Stopped retrying 4xx', 'Stop'],
  ])('%s → %s', (subject, fixed) => {
    expect(finding(commit(subject), 'subject-mood')?.message).toContain(`"${fixed}"`);
  });

  it('reads "Bound" as its own verb', () => {
    // regression: ArduPilot/ardupilot#33155
    expect(finding(commit('Bound DEVICE_OP_WRITE count to the packet size'), 'subject-mood')).toBeUndefined();
  });

  it("doesn't flag imperative subjects or nouns", () => {
    expect(finding(commit('Add retry to webhooks'), 'subject-mood')).toBeUndefined();
    expect(finding(commit('Tests for the parser'), 'subject-mood')).toBeUndefined();
  });

  it('flags long subjects', () => {
    expect(finding(commit('A'.repeat(80)), 'subject-length')?.severity).toBe('warn');
    expect(finding(commit('A'.repeat(110)), 'subject-length')?.severity).toBe('warn');
    expect(finding(commit('A'.repeat(160)), 'subject-length')?.severity).toBe('error');
  });

  it.each(['fix bug', 'update', 'wip', 'minor changes', 'fix: stuff', 'various fixes'])('flags vague "%s"', (s) => {
    expect(finding(commit(s), 'subject-vague')).toBeDefined();
  });

  it('flags a missing blank line and a trailing period', () => {
    const r = commit('Add retry.\nIt retries.');
    expect(rules(r)).toEqual(expect.arrayContaining(['blank-line', 'subject-period']));
  });

  it('keeps # lines from -m / -F messages, since git commits them', () => {
    expect(commit('Add retry\n\n# Why\nStripe 502s.').words).toBe(3);
  });

  it('flags markdown in a commit body', () => {
    expect(finding(commit('Add retry\n\n## Summary\n- **Retry**: added'), 'markdown-in-commit')).toBeDefined();
  });

  it('ignores git comment lines and the scissors section', () => {
    const msg = 'Add retry\n\n# Please enter the commit message\n# ------------------------ >8 ------------------------\n## Summary lots of text';
    expect(commit(msg).findings).toEqual([]);
  });

  it('flags an empty message', () => {
    expect(finding(commit('# Please enter the commit message for your changes.\n'), 'empty-subject')).toBeDefined();
  });
});

describe('prose tells', () => {
  it('collects AI vocabulary', () => {
    const f = finding(pr('A comprehensive and robust change that seamlessly leverages the cache.', small), 'ai-vocab');
    expect(f?.data?.count).toBe(4);
    expect(f?.severity).toBe('warn');
  });

  it('flags the classic opener and closer', () => {
    const body = 'This PR introduces retries.\n\nOverall, these changes make delivery more reliable.';
    expect(rules(pr(body, small))).toEqual(expect.arrayContaining(['ai-opener', 'ai-closer']));
  });

  it("doesn't read the first sentence as a wrap-up", () => {
    // regression: arii/tech-dancer#3200
    const body = 'This PR ensures Python dependencies are installed before the frontend build runs.';
    expect(finding(pr(body, small), 'ai-closer')).toBeUndefined();
    expect(finding(pr(`Installs Python first.\n\n${body}`, small), 'ai-closer')).toBeDefined();
  });

  it('leaves em dashes alone in Russian', () => {
    // regression: barsik12312/word#1
    const body = 'Сервис — основа. Кнопка — в меню. Оплата — в боте. Готово — проверено.';
    expect(finding(pr(body, small), 'em-dash')).toBeUndefined();
  });

  it('treats chatbot leftovers as an error', () => {
    expect(finding(pr("Here's the PR description for the retry change.", small), 'chatbot-leftovers')?.severity).toBe('error');
  });

  it('flags emoji-led headers but not attribution', () => {
    expect(finding(pr('## 🚀 Summary\nRetries 5xx.', small), 'emoji')).toBeDefined();
    expect(finding(pr('Retries 5xx.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)', small), 'emoji')).toBeUndefined();
  });

  it('flags bold-label bullets', () => {
    const body = '- **Retry**: added\n- **Backoff**: added\n- **Errors**: better';
    expect(finding(pr(body, diff('src/a.ts:300')), 'bold-spam')).toBeDefined();
  });

  it('scales the bullet allowance with the diff', () => {
    const body = Array.from({ length: 8 }, (_, i) => `- change ${i}`).join('\n');
    expect(finding(pr(body, small), 'bullet-bloat')).toBeDefined();
    expect(finding(pr(body, diff('src/a.ts:600:300')), 'bullet-bloat')).toBeUndefined();
  });

  it('allows five bullets on any PR', () => {
    const five = Array.from({ length: 5 }, (_, i) => `- change ${i}`).join('\n');
    expect(finding(pr(five, diff('src/a.ts:1')), 'bullet-bloat')).toBeUndefined();
    expect(finding(pr(`${five}\n- change 5`, diff('src/a.ts:1')), 'bullet-bloat')?.hint).toMatch(/a reviewer would ask about/);
  });

  it('notes a bullet over 40 words, wrapped lines included, and never sends back for it', () => {
    // regression: the zainfathoni/amux#286 rewrite, ~60-word bullets on a 1,573-line diff
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
    const body = (bullet: string) => `Parks the worker without touching its evidence, because teardown was blocked (#280).\n\n${bullet}\n- \`inspect\` takes the plan's hash\n\nTested: \`go test ./...\`, 212 passed.`;
    const big = diff('src/a.ts:1000:573');
    expect(finding(pr(body(`- \`plan\` ${words(38)}`), big), 'long-bullet')).toBeUndefined();
    const f = finding(pr(body(`- \`plan\` ${words(30)}\n  ${words(29)}`), big), 'long-bullet');
    expect(f?.message).toBe('A 60-word bullet');
    expect(f?.severity).toBe('info');
    expect(f?.hint).toMatch(/One change per bullet, about 25 words/);
    const r = pr(body(Array.from({ length: 5 }, () => `- ${words(60)}`).join('\n')), big);
    expect(finding(r, 'long-bullet')?.message).toBe('5 bullets over 40 words (longest 60)');
    expect(passes(r, 35)).toBe(true);
  });

  it('ignores anything inside code fences', () => {
    const body = 'Retries 5xx because Stripe 502s.\n\n```\n## 🚀 comprehensive robust seamless\n- [x] a\n- [x] b\n```';
    expect(pr(body, small).findings).toEqual([]);
  });

  it('ignores HTML comments from PR templates', () => {
    const body = '<!-- Please describe your change comprehensively and robustly -->\nRetries 5xx because Stripe 502s.';
    expect(pr(body, small).findings).toEqual([]);
  });
});
