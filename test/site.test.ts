import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixture } from './helpers.js';

// The site's before/after panel is written by hand. This keeps its "after" identical to the
// fixture the roast box scores, so the page never shows a PR buzzcut hasn't checked.
describe('site', () => {
  // Git for Windows checks files out with CRLF line endings; compare the text, not the newlines.
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('shows the checked good PR in the before/after panel', () => {
    const src = read('../site/app.js').match(/const AFTER = (\{[\s\S]*?\n {2}\});/)?.[1];
    expect(src).toBeDefined();
    const after = new Function(`return ${src}`)() as { title: string; opening: string; bullets: string[]; tested: string };
    const plain = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\[\[|\]\]/g, '');
    const body = [plain(after.opening), '', ...after.bullets.map((b) => `- ${plain(b)}`), '', after.tested].join('\n');
    expect(body).toBe(fixture('good-pr.md').replace(/\r\n/g, '\n').trim());
    expect(read('../scripts/build-site.mjs')).toContain(`clean: { title: '${after.title}'`);
  });
});
