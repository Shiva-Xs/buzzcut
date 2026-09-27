# Benchmark

buzzcut is tuned on real PRs and commits, not on examples written for it. Two questions matter, and each has its own test.

**Does it leave good writing alone?** The ground truth is work from before AI coding assistants existed: 584 PRs and 170 commits merged between 2018 and May 2021 (before Copilot's first preview) in 75 projects; 561 and 167 of them once releases, dependency bumps and merges are skipped, as the product skips them. Anything flagged there is a false alarm by definition. Recent work by people in the same projects is reported separately, since some of it may be AI-assisted.

**Does it make agent PRs readable, without losing or inventing facts?** Real agent PRs (Claude Code, Copilot's agent, Codex, Devin, Cursor, Jules, Amp) are written again the way an agent with buzzcut installed would: the skill, `buzzcut context`, and `buzzcut pr` until it passes, from each PR's real diff. A separate call judges each pair blind (it never learns which is buzzcut's), and a third fact-checks buzzcut's version against the diff. See [eval/corpus/](eval/corpus).

| File | What it does |
|---|---|
| `corpus.json` | The lists: agent PRs and commits, recent PRs and commits by people, and the 2018–2021 baseline. |
| `collect*.mjs` | How the lists were built. Rerunning them picks newer items. `collect-more.mjs` grows the corpus past 2,000 PRs: more agents, spread over six months, and more projects. |
| `fetch.mjs` | Downloads each item into `cache/` (needs `gh auth login`). It waits out GitHub's hourly rate limit, so a full corpus takes about an hour. Old PRs get their PR template as it was at the time. |
| `score.mjs` | Scores the cache offline, the way the product does (merges, reverts, releases and dependency bumps skipped): block rates per group, how often each rule fires, and `review/*.md` with everything worth a human look. |
| `eval/` | A manual read of 160 agent PRs next to buzzcut's verdict (`judgments.tsv`), and what it found. |
| `eval/corpus/` | The current writing test: an agent writes buzzcut's version of a real agent PR from its diff, a blind judge compares it with the original, and a fact check holds it against the diff. The README's numbers come from its `heldout` (Sonnet 5) and `heldout-gemini` (Gemini 3.8 Flash) runs. About $0.25 per PR. |

```bash
npm run build
npm run bench:fetch    # once
npm run bench          # after every rule change
```

The downloaded PRs and commits are committed in `cache/`, so scoring and the manual read in `eval/` work offline. The real diffs the writing test needs are downloaded by `node bench/fetch-diffs.mjs` and stay local.
