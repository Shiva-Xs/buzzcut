// Adds hand-written agent commits (not squash merges) to corpus.json via the commit search API,
// slowly enough for GitHub's secondary rate limits.
//   node bench/collect-agent-commits.mjs && node bench/fetch.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('corpus.json', import.meta.url);
const corpus = JSON.parse(readFileSync(file, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SQUASH = /\(#\d+\)\s*$/;
const have = new Set([...corpus.humanCommits, ...corpus.agentCommits].map((c) => c.sha));
const perRepo = new Map(corpus.agentCommits.map((c) => [c.repo, 0]));
for (const c of corpus.agentCommits) perRepo.set(c.repo, (perRepo.get(c.repo) ?? 0) + 1);

const QUERIES = [
  ['claude-code', '"Co-Authored-By: Claude"'],
  ['claude-code', '"Generated with Claude Code"'],
  ['cursor', 'author-email:cursoragent@cursor.com'],
  ['copilot', 'author-name:copilot-swe-agent[bot]'],
  ['aider', 'author-name:aider'],
];

for (const [source, q] of QUERIES) {
  let n = 0;
  for (const page of [1, 2, 3]) {
    await sleep(12000);
    let found;
    try {
      found = JSON.parse(execFileSync('gh', ['api', '-X', 'GET', 'search/commits', '-f', `q=${q}`, '-f', 'sort=committer-date', '-f', 'per_page=100', '-f', `page=${page}`], { encoding: 'utf8', maxBuffer: 64 << 20 })).items;
    } catch (e) {
      process.stderr.write(`${source} ${q} p${page}: failed (${e.message.split('\n')[0]})\n`);
      break;
    }
    for (const c of found) {
      const repo = c.repository.full_name;
      const subject = c.commit.message.split('\n')[0];
      if (have.has(c.sha) || SQUASH.test(subject) || c.parents?.length > 1 || (perRepo.get(repo) ?? 0) >= 2) continue;
      perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
      corpus.agentCommits.push({ repo, sha: c.sha, source, hand: true });
      have.add(c.sha);
      n++;
    }
    if (found.length < 100) break;
  }
  process.stderr.write(`${source} ${q}: +${n}\n`);
}

writeFileSync(file, JSON.stringify(corpus, null, 2) + '\n');
console.log(`agent commits ${corpus.agentCommits.length}`);
