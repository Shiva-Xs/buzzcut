# Original PR vs the PR an agent writes with buzzcut

`bench/score.mjs` runs buzzcut's checks on every cached PR and commit (3,366), which needs no model. This folder tests the other half: what an agent with buzzcut installed actually writes, next to what the agent wrote on its own.

For each PR, from its real diff (`node bench/fetch-diffs.mjs`, not committed):

1. **Write.** Sonnet 5 gets the skill, `buzzcut context` for the diff, the diff (lockfiles and generated files dropped, 60 KB at most) and the original PR as its notes from the session: keep their facts, add none, and only say a test ran if the notes report it. It then runs the skill's loop: `buzzcut pr`, fix every ✗, apply the ! advice unless it would cut a fact, at most 3 drafts.
2. **Judge, blind.** A separate call sees the diff and both descriptions as A and B in a hashed order, and says which a reviewer would rather get, whether each opens with what and why, whether its length is right, whether it's cramped or sprawling, whether a reviewer gets it in 30 seconds, and what each is missing or claims without support.
3. **Fact check.** The blind judge can't tell an invented reason from one the author knew, so a third call holds buzzcut's version against the diff, its line counts and the notes: invented test runs, invented reasons, other invented claims, claims the diff contradicts, and facts from the notes it dropped.

Repos are split 70 / 30 by a hash of their name (`split.json`). The skill was tuned on PRs from the 70%; the published numbers come from 30 PRs in the other 30%.

```bash
npm run build
node bench/fetch-diffs.mjs
node bench/eval/corpus/run.mjs --run heldout --split test --set agent --sample 30
node bench/eval/corpus/summary.mjs heldout --losses
node bench/eval/corpus/show.mjs heldout            # every pair in full
```

Writer and judge use your Claude login through `claude -p`, and count toward its usage limits: about $0.25 of usage per PR.

## Runs

| Run | PRs | What changed | Preferred over the original | Claims a test ran that didn't | Contradicts the diff | Dropped a needed fact |
|---|---|---|---|---|---|---|
| `v1` | 30, tuning repos | the skill as merged | 28 (1 tie) | 5 | 3 | 12 |
| `v2` | same 30 | a test plan isn't a test run; keep what wasn't tested, fallbacks and risks; say all of what a change removes | 28 (1 tie) | 2 | 4 | 9 |
| `heldout` | 30, held-out repos | `v2`'s skill | **30** | 1 | 8 | 13 |

`heldout-gemini` is the same 30 held-out PRs written by Gemini 3.8 Flash in Antigravity IDE with the final skill, checked with `buzzcut pr` (a smaller, cheaper model, as many teams run). A blind judge (also Gemini 3.8 Flash, so it judged its own writing, without knowing which was which) preferred the rewrite in 30 of 30: what and why in 29 (originals 12), right length in 30 (10), understood in 30 seconds in 30 (19), facts a reviewer needs missing 4 (31). buzzcut's own checks, original → rewrite: passes 29 → 30, says why 22 → 29 (the one left is a PR whose notes never gave a reason), has a Tested or Not tested line 25 → 30, bold labels on every line 7 → 0, file tours 4 → 0, buzzwords 3 → 0, grade A 17 → 30, median 106 → 97 words. A read of all 30 against their notes found two places the skill needed to be firmer (a stated scope limit and every check that ran, now in it) and one tool bug (`missing-why` missed reasons like "so tests are picked up" and "users were trapped", now fixed).

On `heldout`, by the blind judge: buzzcut's version opens with what and why in 30 of 30 (originals 21), is understood in 30 seconds in 30 (19), has the right length in 30 (9), and is missing 11 facts a reviewer needs against the originals' 67.

## What's still wrong

- **Details that don't match the diff**, in 8 of the held-out 30: a version number (v6.0.3 for v6.0.2), which table a record lands in, a list that says "every" where the diff changes two files. Mostly on big diffs, where the writer sees at most 60 KB. An agent describing its own change has the whole diff and its session.
- **Dropped facts**, in 13: caveats and reasoning (what wasn't tested, a fallback, why a scope is enough) more than behavior.
- **Reasons the notes don't give**, flagged in 9, mostly purpose read from the diff ("so parallel test runs show which thread logged what"); 2 or 3 are guesses.
- **Smaller models write thinner PRs.** On 9 held-out PRs with Haiku as writer and judge, buzzcut's version was preferred in 4: every one said what and why and passed, but Haiku cut the problem statement, a quoted spec line and a snippet the reviewer wanted. Gemini 3.8 Flash, on 12 of the same PRs, kept those, but twice described only what its notes said and skipped most of the diff (a new I2C module, a framework upgrade). The skill now asks for both explicitly ("never shorter than the problem needs", "describe the whole diff"); neither run has been repeated at full size yet. The `heldout-haiku` run in `runs/` is the partial Haiku one.
- **The judge is the same model family as the writer.** It's blind and reads the diff, but a second judge on another model would make the preference number stronger.
