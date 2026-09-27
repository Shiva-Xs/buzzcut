// Renders the README images from real buzzcut output: `npm run build && node scripts/hero.mjs`.
// The example PR is fictional (acme/api#482) so no real person gets roasted in the README.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, buildDiff, prMessage, renderBoard, renderReport, renderRoast } from '../dist/index.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const diff = buildDiff([{ path: 'src/webhook.ts', additions: 7, deletions: 2 }]);

const bloated = analyze(prMessage('Add comprehensive retry mechanism', read('../test/fixtures/bloated-pr.md')), diff);
const good = analyze(prMessage('Retry webhook deliveries on 5xx and 429', read('../test/fixtures/good-pr.md')), diff);
const pr = {
  owner: 'acme',
  repo: 'api',
  number: 482,
  url: 'https://github.com/acme/api/pull/482',
  author: 'example',
  bot: false,
  title: 'Add comprehensive retry mechanism',
  body: read('../test/fixtures/slop-pr.md'),
  diff,
};

const THEME = {
  bg: '#0d1117',
  bar: '#161b22',
  fg: '#e6edf3',
  dim: '#8b949e',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#e3b341',
  cyan: '#79c0ff',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cells = (s) => [...s].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0);

/** Minimal ANSI → SVG: bold, dim, inverse and the four colors buzzcut uses. */
function toSvg(ansi, title) {
  const CH = 8.4;
  const LH = 20;
  const PAD = 20;
  const TOP = 44;
  const lines = ansi.replace(/\n+$/, '').split('\n');
  const plain = lines.map((l) => l.replace(/\x1b\[\d+m/g, ''));
  const cols = Math.max(...plain.map(cells), 60) + 2;
  const width = Math.ceil(cols * CH + PAD * 2);
  const height = TOP + lines.length * LH + PAD;

  const body = [];
  lines.forEach((line, i) => {
    const y = TOP + i * LH + 14;
    let x = PAD;
    const st = { bold: false, dim: false, inv: false, color: null };
    const spans = [];
    for (const part of line.split(/(\x1b\[\d+m)/)) {
      const m = part.match(/^\x1b\[(\d+)m$/);
      if (m) {
        const c = Number(m[1]);
        if (c === 1) st.bold = true;
        else if (c === 2) st.dim = true;
        else if (c === 22) st.bold = st.dim = false;
        else if (c === 7) st.inv = true;
        else if (c === 27) st.inv = false;
        else if (c === 31) st.color = 'red';
        else if (c === 32) st.color = 'green';
        else if (c === 33) st.color = 'yellow';
        else if (c === 36) st.color = 'cyan';
        else if (c === 39) st.color = null;
        else if (c === 0) Object.assign(st, { bold: false, dim: false, inv: false, color: null });
        continue;
      }
      if (!part) continue;
      const w = cells(part) * CH;
      const color = st.color ? THEME[st.color] : st.dim ? THEME.dim : THEME.fg;
      if (st.inv) {
        body.push(`<rect x="${x}" y="${y - 14}" width="${w}" height="19" rx="3" fill="${color}"/>`);
      }
      const fill = st.inv ? THEME.bg : color;
      const weight = st.bold || st.inv ? ' font-weight="700"' : '';
      // textLength pins each run to its grid width, whatever monospace font the viewer has.
      spans.push(`<tspan x="${x.toFixed(1)}" textLength="${w.toFixed(1)}" lengthAdjust="spacing" fill="${fill}"${weight}>${esc(part)}</tspan>`);
      x += w;
    }
    if (spans.length) body.push(`<text y="${y}" xml:space="preserve">${spans.join('')}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect width="${width}" height="${height}" rx="10" fill="${THEME.bg}"/>
<rect width="${width}" height="30" rx="10" fill="${THEME.bar}"/>
<rect y="20" width="${width}" height="10" fill="${THEME.bar}"/>
<circle cx="18" cy="15" r="5.5" fill="#ff5f57"/><circle cx="36" cy="15" r="5.5" fill="#febc2e"/><circle cx="54" cy="15" r="5.5" fill="#28c840"/>
<text x="${width / 2}" y="19" fill="${THEME.dim}" font-size="12" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">${esc(title)}</text>
<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="14">
${body.join('\n')}
</g>
</svg>
`;
}

// The roast card shows everyday yap (a form, bold labels, buzzwords), the same PR as the website.
const slop = analyze(prMessage(pr.title, pr.body), diff);
const roast = renderRoast(pr, slop, { color: true });
writeFileSync(new URL('../assets/roast.svg', import.meta.url), toSvg(roast, 'npx buzzcut roast acme/api#482'));

// A fictional repo's leaderboard, built from the same fixtures plus a few one-liners.
const d = (path, a, del = 0) => buildDiff([{ path, additions: a, deletions: del }]);
const board = {
  subject: 'acme/api · last 6 merged PRs',
  kind: 'pr',
  next: 'npx buzzcut roast acme/api#482',
  rows: [
    { id: '#482', title: 'Add comprehensive retry mechanism', report: bloated },
    { id: '#479', title: 'Retry webhook deliveries on 5xx and 429', report: good },
    { id: '#477', title: 'Enhance error handling', report: analyze(prMessage('Enhance error handling', '## Summary\n\nThis PR enhances error handling across the codebase to ensure a more robust and seamless experience.\n\n## Changes\n\n- Improved error messages\n- Added comprehensive logging\n- Refactored the error handler for better maintainability\n\n## Testing\n\n- [x] Tested locally\n- [x] All tests pass'), d('src/errors.ts', 14, 6)) },
    { id: '#475', title: 'Fix off-by-one in invoice pagination', report: analyze(prMessage('Fix off-by-one in invoice pagination', 'Page 2 repeated the last invoice of page 1 because the cursor was inclusive. Fixes #471.'), d('src/invoices.ts', 3, 3)) },
    { id: '#473', title: 'Update', report: analyze(prMessage('Update', ''), d('src/config.ts', 40, 12)) },
    { id: '#470', title: 'Cache exchange rates for 10 minutes', report: analyze(prMessage('Cache exchange rates for 10 minutes', 'The rates API rate-limits us at 100 calls/min, and checkout calls it on every page view. Rates are now cached for 10 minutes; they move far less than that.\n\nTested: in staging the cache cut rate API calls by ~95%.'), d('src/rates.ts', 38, 4)) },
  ],
};
writeFileSync(new URL('../assets/roast-repo.svg', import.meta.url), toSvg(renderBoard(board, { color: true }), 'npx buzzcut roast acme/api'));

const check = renderReport(good, { color: true, max: 25, label: 'pr' });
writeFileSync(new URL('../assets/check-good.svg', import.meta.url), toSvg(check, 'buzzcut check --kind pr body.md'));

// The core product: a real `git commit` from an agent, blocked by the commit-msg hook.
const repo = mkdtempSync(join(tmpdir(), 'buzzcut-hero-'));
const home = mkdtempSync(join(tmpdir(), 'buzzcut-hero-home-'));
writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Dev\n\temail = dev@example.com\n');
const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
const g = (...args) => execFileSync('git', args, { cwd: repo, env });
g('init', '-q', '-b', 'main');
mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
const bin = new URL('../bundle/buzzcut.mjs', import.meta.url).pathname;
writeFileSync(join(repo, 'node_modules', '.bin', 'buzzcut'), `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`, { mode: 0o755 });
writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
writeFileSync(join(repo, 'webhook.js'), 'export const send = () => {};\n');
g('add', '-A');
g('commit', '-q', '-m', 'Add webhook sender');
execFileSync(process.execPath, [bin, 'init', '--agents', 'none'], { cwd: repo, env });
writeFileSync(join(repo, 'webhook.js'), read('../test/fixtures/webhook-retry.js'));
g('add', '-A');
// The everyday kind of yap: nothing false, just a form, bold labels and a checklist nobody can read.
const subject = 'feat: implement comprehensive webhook retry mechanism';
const body = '## Summary\nThis commit introduces a robust retry mechanism for webhook delivery.\n\n## Changes\n- **Retry**: wrapped the send call in a retry loop\n- **Backoff**: added exponential backoff between attempts\n- **Errors**: improved error handling for failed sends\n\n## Testing\n- [x] Tested locally\n- [x] All tests pass';
const blocked = spawnSync('git', ['commit', '-m', subject, '-m', body], {
  cwd: repo,
  env: { ...env, CLAUDECODE: '1', FORCE_COLOR: '1' },
  encoding: 'utf8',
});
writeFileSync(new URL('../assets/blocked.svg', import.meta.url), toSvg(blocked.stderr, 'git commit (run by a coding agent)'));

console.log(`bloated: ${bloated.score} ${bloated.grade} (${bloated.words} words) · good: ${good.score} ${good.grade} (${good.words} words)`);
