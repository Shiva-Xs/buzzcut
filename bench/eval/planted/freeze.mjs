// Freezes the planted errors a model wrote (out/NNN.json) into one file and a hash, so they can't
// change after the checks are scored against them.
//   node bench/eval/planted/freeze.mjs
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
if (existsSync(here('planted.jsonl'))) {
  console.error('planted.jsonl is frozen. Delete it deliberately if you really mean to redo it.');
  process.exit(1);
}
const lines = [];
for (let i = 1; i <= 311; i++) {
  const id = String(i).padStart(3, '0');
  const out = JSON.parse(readFileSync(here(`out/${id}.json`), 'utf8'));
  lines.push(JSON.stringify({ id, kind: out.kind, body: out.body, planted: out.planted ?? {}, whatIsFalse: out.whatIsFalse ?? '' }));
}
const text = lines.join('\n') + '\n';
writeFileSync(here('planted.jsonl'), text);
const sha = createHash('sha256').update(text).digest('hex');
writeFileSync(here('planted.sha256'), sha + '\n');
console.log(`froze ${lines.length} planted statements, sha256 ${sha.slice(0, 12)}`);
