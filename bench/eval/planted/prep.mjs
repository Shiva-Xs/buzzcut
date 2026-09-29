// Prepares the planted-error test: each PR of the frozen held-out set (bench/heldout.json) gets
// ONE assigned kind of false statement, to be written by a model that isn't the one building the
// checks (see TASK.md). The kinds and the assignment are fixed here, before any rule exists.
//
//   node bench/eval/planted/prep.mjs      writes inputs/NNN.json (ignored by git, rebuilt from the cache)
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const cacheDir = fileURLToPath(new URL('../../cache/heldout/', import.meta.url));
const frozen = JSON.parse(readFileSync(new URL('../../heldout.json', import.meta.url), 'utf8'));

/** Every kind, what the writer is asked to do, and whether a lookup could catch it by design. */
export const KINDS = {
  invented_name: {
    catchable: true,
    ask: 'Say, in one added or replaced sentence, that the PR adds, changes or uses a specific code identifier (a function, class, constant, config key, HTTP header or environment variable) that appears NOWHERE in the added or removed lines shown, and that you have good reason to think does not exist in this project. Match the project\'s own naming style. Put the name in backticks. planted.name = the exact identifier.',
  },
  invented_file: {
    catchable: true,
    ask: 'Say, in one added or replaced sentence, that the PR changes or adds a file at a path that is NOT in the files list and that you think does not exist in the project (a plausible directory and extension for this project). Put the path in backticks. planted.path = the exact path.',
  },
  removal_as_addition: {
    catchable: true,
    ask: 'Pick an identifier that appears ONLY in the removed lines shown (not in the added lines) and say the PR adds or introduces it, as if it were new. Put the name in backticks. planted.name = the exact identifier.',
  },
  wrong_number: {
    catchable: false,
    ask: 'Add or change one specific number (a count, limit, timeout, version, status code or percentage) so that it contradicts the diff or is not supported by it, in a natural sentence. Do not name any new identifier. planted.number = the false figure as you wrote it.',
  },
  wrong_behavior: {
    catchable: false,
    ask: 'Add one sentence describing what the code does that the diff shows to be false or the opposite (say something is retried when the diff stops retrying it, an error is thrown when it is swallowed, a default is on when it is off). Name no new identifier and give no number. planted.claim = that sentence.',
  },
};
const ORDER = Object.keys(KINDS);

const sample = (s, n) => (s.length > n ? s.slice(0, n) + '\n…(cut)' : s);
const prs = frozen.prs
  .map((url) => {
    const [, o, r, n] = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    return { url, file: join(cacheDir, `${o}__${r}__pr${n}.json`) };
  })
  .sort((a, b) => a.url.localeCompare(b.url));

mkdirSync(join(here, 'inputs'), { recursive: true });
let made = 0;
const counts = {};
prs.forEach((p, i) => {
  const pr = JSON.parse(readFileSync(p.file, 'utf8'));
  const added = pr.files.map((f) => f.added ?? '').join('\n');
  const removed = pr.files.map((f) => f.removed ?? '').join('\n');
  let kind = ORDER[i % ORDER.length];
  // Fallbacks, decided here and not by anything downstream: a removal needs removed lines,
  // and a number needs something to contradict.
  if (kind === 'removal_as_addition' && removed.trim().length < 40) kind = 'invented_name';
  if (kind === 'wrong_number' && !/\d/.test(pr.body + added)) kind = 'invented_name';
  counts[kind] = (counts[kind] ?? 0) + 1;
  const id = String(i + 1).padStart(3, '0');
  writeFileSync(
    join(here, 'inputs', `${id}.json`),
    JSON.stringify({ id, kind, instruction: KINDS[kind].ask, title: pr.title, body: pr.body, files: pr.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })), added: sample(added, 12000), removed: sample(removed, 12000) }, null, 1),
  );
  made++;
});
mkdirSync(join(here, 'out'), { recursive: true });
console.log(`wrote ${made} inputs`, counts);
