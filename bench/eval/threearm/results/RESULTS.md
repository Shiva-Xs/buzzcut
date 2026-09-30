# Three-arm writing comparison: results

Gemini 3.8 Flash (Antigravity) wrote a description for each of 24 real PRs (10 tiny, 10 normal, 4 big) from the held-out test half, in three arms, from the diff and the author's own text as notes, with the same rules about facts (keep what the notes say a reviewer needs, add nothing):

- **A** the skill, with the published buzzcut 0.1.2 as the checker
- **B** the skill, with this branch as the checker
- **C** a plain "write a clear description", with no skill, context or checker

The skill text is identical in A and B. Judged blind by Claude (labels shuffled per PR, key sealed until all 24 were judged).

## Without a judge

| measure | original text | A | B | C |
|---|---|---|---|---|
| median words | 101 | 61 | 56 | 76 |
| sent back by 0.1.2 / by this branch | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| has a Tested or Not tested line | 0% | 100% | 100% | 100% |
| a name or file the diff and repo lack | 0 | 0 | 0 | 0 |
| the author's numbers, links and refs kept | 100% | 41% | 44% | 53% |

All three arms pass both checkers, and no arm invented a checkable name or file, so the lookups had nothing to catch here. (One figure was flagged in C; it was a false alarm: the notes have the issue as a URL and C wrote `#3732`.) The writers dropped between 47% and 59% of the author's numbers, links and refs; the skill arms dropped the most.

## Blind judge

| arm | mean rank (1 best, 3 worst) | best | worst | unsupported claims (PRs) | needed facts missing (PRs) |
|---|---|---|---|---|---|
| A skill + 0.1.2 | 1.79 | 6.0 | 6.0 | 4 (4) | 13 (11) |
| B skill + this branch | 2.00 | 4.5 | 11.5 | 3 (3) | 20 (13) |
| C plain prompt | **1.54** | **11.5** | 4.5 | 3 (3) | **2 (2)** |

Best and worst count ties split, over the 22 PRs that were not all-tie. Per PR: `judged.json`.

## What it shows

- **On this task the plain prompt was preferred.** The skill arms were shorter and dropped things a reviewer needs: the closes keyword, the author's open question, a second PR the author cited, a stated scope limit, backward-compatibility. C dropped a needed fact in 2 PRs, A in 11, B in 13. That direction agrees with the deterministic count of the author's numbers and links kept.
- **A against B is noise.** Same skill, different checker; the two differ by 2 PRs on missing facts, well inside what 24 PRs can resolve.
- **Unsupported claims were rare and even** across arms (3 to 4 each, out of 24 descriptions).

## What it does not show

- The earlier published result (buzzcut's version preferred over the agent's original in 30 of 30) compared against agent-written originals, with no plain-prompt control. This is that control, and it doesn't favor the skill on this task.
- **Not the real use.** The notes here are human PR text; an agent writes from its own session. A model given good notes and a diff had nothing to invent, which is why the lookups caught nothing. A test that gives thin notes would be the one that can show whether the lookups matter.
- **One judge, one model family, 24 PRs.** The judge is Claude, not the writer's family, but there is one of it. Ranks are coarse and ties were allowed.
- **The blinding leaked.** C wrote its test line as "Testing: Not tested." and the skill arms as "Not tested: what to check", so an attentive judge can tell them apart. Judgments were made on content, but the leak is real.
- The judge counted "missing needed facts" by hand against the notes and diff. Facts it counted may be ones a reviewer wouldn't miss.
