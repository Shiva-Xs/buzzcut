# Manual read of 2,643 PRs

Every PR in `bench/cache/` is read by a person (or a model reading like one) next to buzzcut's verdict, to answer one question: does buzzcut make the call a reviewer would make?

```bash
node bench/eval/make-batches.mjs    # PRs not judged yet → bench/eval/batches/batch-NNN.md, 40 per file
```

Record one line per PR in `judgments.tsv` (tab-separated, keyed by URL):

| call | meaning |
|---|---|
| `ok` | buzzcut's verdict is what a reviewer would say |
| `fp` | buzzcut flags or sends back something a reviewer would find fine |
| `fn` | hard-to-read slop that buzzcut lets through, or barely notes |
| `meh` | borderline |

`buzzcut` column: `SENT BACK` (fails, the agent must rewrite), `NOTES` (passes with warnings), `CLEAN`.

## Progress

160 of 2,643 read (agent PRs, alphabetical from `0xf4b1` to `brendanv`): 129 ok, 15 fp, 5 fn, 11 meh.

## What the read found, and what changed

Everything below was fixed, each with a test named after the PR it came from.

**Blocking false positives in `phantom-tests`** (the "claims tests that aren't in the diff" check). Of its 42 hits in the corpus, 34 weren't claims of new tests: running them ("Ran unit tests and a custom verify script"), instructions ("Run `pnpm test` to verify"), paths (`apps/web/src/app/engine-test/page.tsx`), names ("Adds GitHub Spec Kit"), modifiers ("test harness", "test target"), questions, struck-out or template boxes, and CI-only diffs. `examples/.test/` now counts as a test directory. A later rewrite made the rule fire only when an author says they added or wrote tests: on the corpus it went from 40 hits to 4, and all 4 are real. Each of the 40 is a case in `test/phantom-corpus.test.ts`.

**Warnings that stack into a block.** Length and shape warnings (length, bullets, title length, em dashes, a missing why) now count for 20 points at most toward a send-back, so a readable PR with facts isn't sent back for them. Prose tells still add up in full. `template-on-tiny` no longer blocks Problem / Fix / Result / Testing sections on a small fix, and never counts a Tested heading.

**Checks that miss evidence.** `ticked-boxes` and `vague-verification` read commands without backticks (`pnpm test:regression`) and results anywhere in the PR; `unbacked-claim` reads the next two lines for the measurement.

**Non-English PRs.** `missing-why` and `em-dash` step aside for text mostly in another script.

**Smaller:** tickets in the why check are case-sensitive, so a UUID in a link or "utf-8" isn't one; "Bound" is its own verb; the first sentence is never read as a closing summary; a "Why:" label counts as a why; and an empty or one-line body on a 300+ line diff gets `thin-description` (advice only).

The new PR shape itself is tested in [format.md](format.md): 30 real agent PRs rewritten and judged blind. [corpus/](corpus) runs the whole loop, skill, `buzzcut context`, `buzzcut pr`, on any cached PR, with a blind judge and a fact check.
