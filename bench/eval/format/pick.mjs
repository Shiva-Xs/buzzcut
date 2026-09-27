// Picks the 30 agent PRs for the format test (bench/eval/format.md): 10 tiny, 10 normal and
// 10 big diffs, in English, with a body of 40+ words to take the facts from, at most 2 per
// agent in each size. Seeded, so the same corpus gives the same 30.
//   npm run build && node bench/eval/format/pick.mjs > bench/eval/format/picked.json
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { analyze, buildDiff, DEFAULT_CONFIG, parseTemplate, prMessage } from '../../../dist/index.js';

const corpus = JSON.parse(readFileSync(new URL('../../corpus.json', import.meta.url), 'utf8'));
const cacheFile = (url) => {
  const [, owner, repo, n] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return new URL(`../../cache/${owner}__${repo}__pr${n}.json`, import.meta.url);
};
const seed = (url) => createHash('sha1').update(`format-eval:${url}`).digest('hex');
const latin = (s) => {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length ? letters.filter((c) => /\p{Script=Latin}/u.test(c)).length / letters.length : 1;
};

const items = [];
for (const { url, source } of corpus.agent) {
  let it;
  try {
    it = JSON.parse(readFileSync(cacheFile(url), 'utf8'));
  } catch {
    continue;
  }
  if (!it.baseSha || DEFAULT_CONFIG.ignore.some((re) => re.test(it.title))) continue;
  const body = it.body ?? '';
  const diff = buildDiff(it.files, { additions: it.additions, deletions: it.deletions }, it.files.length < it.changedFiles);
  const r = analyze(prMessage(it.title, body), diff, { template: it.template ? parseTemplate([it.template]) : null });
  if (r.words < 40 || latin(body) < 0.9 || diff.truncated || !diff.changedLines) continue;
  const n = diff.changedLines;
  const size = n < 30 ? 'tiny' : n < 300 ? 'normal' : n <= 3000 ? 'big' : null;
  if (!size) continue;
  items.push({ url, source, size, lines: n, words: r.words, score: r.score, seed: seed(url) });
}

const picked = [];
for (const size of ['tiny', 'normal', 'big']) {
  const perSource = new Map();
  for (const it of items.filter((x) => x.size === size).sort((a, b) => a.seed.localeCompare(b.seed))) {
    if ((perSource.get(it.source) ?? 0) >= 2) continue;
    perSource.set(it.source, (perSource.get(it.source) ?? 0) + 1);
    picked.push(it);
    if (picked.filter((x) => x.size === size).length === 10) break;
  }
}
console.log(JSON.stringify(picked.map(({ seed, ...rest }) => rest), null, 1));
