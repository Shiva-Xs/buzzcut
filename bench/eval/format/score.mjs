// Words, yap score and verdict for each picked PR's original description, its one-paragraph
// rewrite (old skill) and its new-shape rewrite, scored against the PR's diff from bench/cache.
//   npm run build && node bench/eval/format/score.mjs [path/to/dist/index.js] > scores.json
// Pass another build's dist/index.js to score with its rules (the tables in format.md use this
// branch's and the pre-change build's).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const dist = process.argv[2] ? pathToFileURL(process.argv[2]).href : new URL('../../../dist/index.js', import.meta.url).href;
const { analyze, buildDiff, parseTemplate, passes, prMessage, DEFAULT_CONFIG } = await import(dist);
const HERE = new URL('./', import.meta.url);
const picked = JSON.parse(readFileSync(new URL('picked.json', HERE), 'utf8'));

const out = [];
for (const p of picked) {
  const [, o, r, n] = p.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  const key = `${o}__${r}__pr${n}`;
  const it = JSON.parse(readFileSync(new URL(`../../cache/${key}.json`, import.meta.url), 'utf8'));
  const diff = buildDiff(it.files, { additions: it.additions, deletions: it.deletions });
  const template = it.template ? parseTemplate([it.template]) : null;
  const judge = (title, body) => {
    const rep = analyze(prMessage(title, body), diff, { template });
    return { words: rep.words, score: rep.score, grade: rep.grade, pass: passes(rep, DEFAULT_CONFIG.max), rules: rep.findings.map((f) => f.rule) };
  };
  const desc = (v) => {
    const [title, , ...rest] = readFileSync(new URL(`descriptions/${key}.${v}.md`, HERE), 'utf8').trimEnd().split('\n');
    return judge(title, rest.join('\n'));
  };
  out.push({ key, url: p.url, source: p.source, size: p.size, lines: diff.changedLines, original: judge(it.title, it.body ?? ''), old: desc('old'), new: desc('new') });
}
console.log(JSON.stringify(out, null, 1));
