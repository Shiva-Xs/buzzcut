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
| a name or file the diff and repo lack | 1 | 1 | 1 | 1 |
| the author's numbers, links and refs kept | 100% | 41% | 44% | 53% |

All three arms pass both checkers, and no arm invented a checkable name or file, so the lookups had nothing real to catch here. The one name flagged in every arm, and in the original text, is `NonInvariantDocblockPropertyType`, a Psalm error name the author wrote in their own notes. (One figure was flagged in C; a false alarm: the notes have the issue as a URL and C wrote `#3732`.) An earlier scoring, run without the repo snapshots, showed no flags at all, and a later one flagged a real name, `Blueprint.add_url_rule`; that exposed two lookup bugs, fixed in a separate commit. The table is the post-fix run. The writers dropped between 47% and 59% of the author's numbers, links and refs; the skill arms dropped the most.

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

---

# Round 2: the skill after "carry over what you were given"

Round 1 said the plain prompt beat the skill because the skill arms dropped the author's facts. The skill was changed in one place (a short paragraph in `skills/buzzcut/SKILL.md`, "Carry over what you were given": the closes keyword, other PRs and issues the author cites, the question they're asking or that it's a draft, what it leaves for later, examples they gave, their reason). Arm B was then run again on the same 24 PRs, with the same notes, diff and rules. A and C are unchanged from round 1. The round-1 B is called B1 below.

## Without a judge

| measure | original text | A | B1 (old skill) | B (new skill) | C |
|---|---|---|---|---|---|
| median words | 101 | 61 | 56 | 61 | 76 |
| sent back by 0.1.2 / by this branch | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| a name or file the diff and repo lack | 1 | 1 | 1 | 0 | 1 |
| the author's numbers, links and refs kept | 100% | 41% | 44% | **47%** | 53% |

Full table: `deterministic-round2.md`. The new skill keeps 3 more points of the author's links and numbers than before, and is still 6 points under the plain prompt on that count.

## Blind judge (B, B1 and C; labels reshuffled per PR, key sealed until all 24 were judged)

| arm | mean rank (1 best, 3 worst) | best | worst | unsupported claims (PRs) | needed facts missing (PRs) |
|---|---|---|---|---|---|
| B new skill | 1.50 | 10.0 | 3.5 | 1 (1) | 10 (8) |
| B1 old skill | 2.46 | 1.5 | 17.0 | 4 (4) | 25 (15) |
| C plain prompt | **1.42** | **10.5** | **1.5** | 3 (3) | **3 (2)** |

Best and worst count ties split, over the 22 PRs that were not all-tie. Head to head: B beats C in 8, loses in 10, ties in 6; B beats B1 in 17, loses in 2, ties in 5; B1 loses to C in 18 of 24. Per PR, unblinded: `judged-round2.json`.

## What it shows

- **The fix worked on what it targeted.** The old skill dropped a needed author fact in 15 of 24 PRs; the new one in 8; the plain prompt in 2. The old skill came last in 17 of 22 decided PRs; the new one in 3.5.
- **The new skill is close to the plain prompt, not past it.** Mean rank 1.50 against 1.42, and B won 8 PRs to C's 10, which 24 PRs cannot tell apart. It still drops more of the author's facts than C does (8 PRs against 2), which is the thing the skill exists to prevent.
- **It does not beat a plain prompt on this task.** What it adds over C here is the Tested / Not tested line, the "what's mechanical" split on the larger PRs, and size control. Whether a reader values those is a separate question the judge did not score.

## What it does not show

- **Same person wrote the fix and judged it.** Claude edited the skill, then judged its output. I saw the round-1 failures and knew what the fix was for, so I may have credited the carried-over facts more readily. Treat the B-against-B1 gap as a direction, not a size.
- **The judge had seen round 1.** The missing-facts count for B1 is 25 here and was 20 in round 1. The two passes compared different sets of texts, so the counts are not directly comparable.
- **One judge, one writer model, 24 PRs, the same PRs as round 1.** The skill was changed after seeing those PRs' failures, so round 2 is not held-out for the skill text. A fresh PR set is the fair test.
- **Not the real use, still.** The notes are human PR text. The lookups had nothing to catch (B had no invented names, the rest had one each, and that one is a Psalm error name from the author's own notes). The thin-notes arm that would exercise them has not been run.
- **Blinding.** All three arms ended with a testing line this time, but the styles still differ ("Not tested: ..." against "Testing:"), so the labels can be guessed.
- One B output (pr24) says the change was "tested as" the author's published fork where the author said only "published"; it then says Not tested. Counted as unsupported.
