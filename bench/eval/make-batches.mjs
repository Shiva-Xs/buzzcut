// Renders every cached PR that isn't judged yet next to buzzcut's verdict, 40 per file, for a
// human read. Judgments go in judgments.tsv (one line per PR, keyed by URL).
//   node bench/eval/make-batches.mjs   → bench/eval/batches/batch-NNN.md (not committed)
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const HERE = new URL('./', import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const entry = new URL('entry.ts', HERE);
writeFileSync(
  entry,
  ['roast', 'analyze', 'diff', 'template', 'config']
    .map((m) => `export * from '${new URL(`src/${m}.ts`, ROOT).pathname}';`)
    .join('\n'),
);
const bundle = new URL('.bundle.mjs', HERE);
await build({ entryPoints: [entry.pathname], bundle: true, platform: 'node', format: 'esm', outfile: bundle.pathname, logLevel: 'error' });
rmSync(entry);
const { roastCard, analyze, prMessage, passes, buildDiff, parseTemplate, DEFAULTS } = await import(bundle.href);

const CACHE = new URL('bench/cache/', ROOT);
const judged = new Set(readFileSync(new URL('judgments.tsv', HERE), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t')[0]));
const order = { agent: 0, human: 1, baseline: 2 };
const items = readdirSync(CACHE)
  .filter((f) => /__pr\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(new URL(f, CACHE), 'utf8')))
  .filter((it) => !judged.has(it.url) && !DEFAULTS.ignore.some((re) => re.test(it.title)))
  .sort((a, b) => order[a.set] - order[b.set] || a.url.localeCompare(b.url));

const out = new URL('batches/', HERE);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' …[cut]' : s);
const SIZE = 40;
for (let b = 0; b * SIZE < items.length; b++) {
  const text = items.slice(b * SIZE, (b + 1) * SIZE).map((it) => {
    const diff = buildDiff(it.files, { additions: it.additions, deletions: it.deletions }, it.files.length < it.changedFiles);
    const template = it.template ? parseTemplate([it.template]) : null;
    const r = analyze(prMessage(it.title, it.body ?? ''), diff, { template });
    const [owner, repo] = it.repo.split('/');
    const c = roastCard({ owner, repo, number: it.number, url: it.url, title: it.title, body: it.body ?? '', diff }, r, { template });
    const verdict = !passes(r, 35) ? 'SENT BACK' : r.findings.some((f) => f.severity === 'warn') ? 'NOTES' : 'CLEAN';
    const lines = (it.body ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().split('\n');
    const shown = clip(lines.slice(0, 30).join('\n'), 1800) + (lines.length > 30 ? `\n…[${lines.length - 30} more lines]` : '');
    const f = r.findings.map((x) => `  ${x.severity === 'error' ? '✗' : x.severity === 'warn' ? '!' : '·'} ${x.rule}: ${x.message}`).join('\n');
    return [
      `### ${it.url}  [${it.set}${it.source ? '/' + it.source : ''}]`,
      `${r.diff?.changedLines ?? 0} lines, ${r.diff?.files.length ?? 0} files (${r.diff?.tests.length ?? 0} test) · ${r.words}w/budget ${r.budget} · ${r.score} ${r.grade} · ${verdict}`,
      `TITLE: ${it.title}`,
      shown || '(empty body)',
      `-- buzzcut: what ${c.basics.what.mark}, why ${c.basics.why.mark}${c.basics.why.mark === 'ok' ? ' ' + c.basics.why.text.slice(0, 90) : ''}`,
      f || '  (no findings)',
      '',
    ].join('\n');
  });
  writeFileSync(new URL(`batch-${String(b + 1).padStart(3, '0')}.md`, out), text.join('\n'));
}
rmSync(bundle);
console.log(`${items.length} PRs left to read, in ${Math.ceil(items.length / SIZE)} batches under bench/eval/batches/`);
