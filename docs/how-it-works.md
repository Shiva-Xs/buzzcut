# How buzzcut works

The details behind the [README](../README.md): every rule, how the yap score and the word budget are computed, how big changes are handled, and the evidence for all of it. The data and scripts are in [bench/](../bench).

## What it checks

**Against the diff and the session.** These are the checks a word list can't make.

| Rule | Catches |
|---|---|
| `phantom-tests` | Says tests were added or written ("Added regression tests for…", "a new test asserts…") when no test file changed. Running tests, ticked boxes and template text are left to other checks |
| `unverified-in-session` | "Tests pass", "verified manually" when the agent ran nothing in this session |
| `length` | Word count over a budget that grows with the diff, and with how specific the writing is |
| `template-on-tiny` | A form of template sections (Summary / Key Changes / Files Changed / Notes) on a small diff |
| `thin-description` | An empty or one-line description on a 300+ line diff, or no Tested / Not tested line (advice only) |
| `diff-echo` | A file-by-file tour of files the reviewer can already see |
| `type-mismatch` | `feat:` on a docs-only diff, `docs:` that touches code |
| `ticked-boxes`, `vague-verification` | "✅ All tests pass" with no command and no result |
| `unbacked-claim` | "Improves performance" with no number |
| `missing-why` | Says what changed, never why |
| `dropped-facts` | A rewrite that lost numbers, error messages, issue links or `file:line` pointers from the draft before it |

**Against the repo's own history.** `style-convention` (conventional prefixes, or not, and which types), `style-case`, `style-ticket` (`PAY-123:` if that's the house style). Learned from the last 200 commits; quiet until there are at least 10. It learns the format only, never bad habits: a history full of "wip" doesn't make "wip" acceptable.

**Git conventions.** `commit-changelog` (a commit body that lists every change under section labels), `subject-vague` ("fix bug", "Update webhook.js"), `subject-length`, `subject-mood` ("Added" → "Add", a quiet note that follows your repo's tense), `subject-period`, `blank-line`, `empty-subject`, `markdown-in-commit`.

**Prose tells, kept light on purpose.** `ai-vocab` (comprehensive, robust, seamless, leverage…), `ai-opener` ("This PR introduces…"), `ai-closer` ("Overall, these changes…"), `chatbot-leftovers` ("Here's the PR description"), `emoji`, `bold-spam`, `bullet-bloat`, `long-bullet` (a bullet over 40 words, advice only), `em-dash`.

## How the score works

Each finding adds points, and the total is the **yap score** out of 100: A up to 10, B up to 25, C up to 45, D up to 65, then F. A message passes when it has **no ✗ errors and scores 35 or less**, where warnings about length and shape (`length`, `bullet-bloat`, `subject-length`, `em-dash`, `missing-why`, house style) count for 20 points at most and `thin-description` and `long-bullet` count for none. Prose tells (buzzwords, forms, file tours, bold labels, ticked boxes, unbacked claims, or more than twice the bullets a diff allows) count in full, and so does length once it's 2.5× the budget or comes with too many bullets: long with facts is fine, a wall of text isn't. Thin prose (few numbers, names or links) at 2.5× the budget on a diff under 30 lines is sent back on its own; on a bigger diff, at 4×.

A PR gets a word range: from `8 + 3·√(changed lines)` (at least 15) up to a budget of `60 + 8·√(changed lines)` (80 to 500 words); `buzzcut context` shows both. A commit body's budget is `25 + 4·√(changed lines)` (30 to 250). **Specific writing earns up to 2.5× more room**: numbers, code references (`vfs_read()`, `MAX_RETRIES`), issue links and URLs raise the budget. File names copied from the diff don't. Long isn't yap. Long and vague is.

The PR budget was tuned on data ([`bench/eval/format/budget.mjs`](../bench/eval/format/budget.mjs)): it's the tightest formula tested that fits all 30 descriptions written in the target shape for real agent PRs even without the specificity bonus (the old `40 + 6·√n` would have flagged 10 of them), and it flags 0.7% of the PRs from before AI as too long, down from 2.3%.

Code blocks, tables' contents, HTML comments, your repo's PR template boilerplate, and attribution lines like `Co-authored-by:` never count as prose. Lockfiles, generated files and anything `.gitattributes` marks `linguist-generated` don't count toward the changed lines. Merges, reverts, `fixup!` commits, dependency bumps and version tags are skipped, and GitHub's squash merges are judged as the PR description they carry.

## Big changes

A 3,000-line refactor gets more room, not a free pass. The budget grows with the diff (about 310 words for 1,000 lines, 500 at most, up to 2.5× that when it's dense with detail), a few short plain headers are fine, and more bullets are allowed. What it still asks for is a map instead of a tour:

- `buzzcut context` maps every diff: where its lines are by area (`src/payments  400 lines, 6 files`), which files are tests, docs, generated or only moved, and the branch's commits, so the agent can say what's mechanical and roughly how much of the diff it is.
- The skill asks for why, what's mechanical and roughly how much of it, the few behavior changes worth a real review and where they are, and how to review it. Grouped by area, never file by file.
- A file-by-file walk-through is still flagged (`diff-echo`), and facts like `comm.c:1028` must survive every rewrite (`dropped-facts`).

Of the 64 PRs by people in the benchmark with 1,000 or more changed lines, 1 is sent back (it was before this version too); of 193 such PRs by agents, 7 are.

## The evidence

Two tests, both on real PRs. **buzzcut's checks** ran on all **3,366 PRs and commits** downloaded from GitHub (`npm run bench`): 2,640 PRs from over 1,000 repos, 1,275 of them opened by coding agents, and 726 commits. That needs no model and answers whether it flags good writing and catches slop. **The PRs an agent writes with buzzcut** need a model to write them, so that test runs on samples of 30 ([bench/eval/corpus/](../bench/eval/corpus)). Everything is in [`bench/`](../bench) so you can rerun it.

**It leaves good writing alone.** The ground truth is work from before AI coding assistants existed, merged between 2018 and May 2021 in 75 projects (kubernetes, rust, node, cpython, pytorch, linux, git, postgres…), so anything flagged there is a false alarm:

| Set | Items | Sent back for an agent |
|---|---|---|
| PRs from before AI | 561 | **5 (0.9%)**, all GitHub's default "Update README.md"-style titles |
| Commits from before AI | 167 | **0** |
| PRs by people, 2026 (some may be AI-assisted) | 804 | 9 (1.1%) |
| PRs by coding agents | 1,275 | 57 (4.5%) |

An earlier build sent back 10 of the PRs from before AI, 25 by people in 2026 and 104 by agents. The difference is false alarms fixed (`phantom-tests` on "Ran unit tests", paths and product names), Problem / Fix sections no longer blocking a small fix, and length and shape warnings no longer adding up to a send-back on their own.

**An agent with buzzcut writes PRs reviewers prefer.** Sonnet 5 wrote buzzcut's version of 30 real agent PRs from repos the skill was never tuned on, from each PR's real diff and its original description (used as the agent's notes: facts kept, none added), checking with buzzcut until it passed. A separate call judged each pair blind, and a third fact-checked buzzcut's version against the diff and the notes ([bench/eval/corpus/](../bench/eval/corpus)):

| On 30 held-out agent PRs | buzzcut's version | Agent's original |
|---|---|---|
| Preferred by the blind judge | **30** | 0 |
| Opens with what changed and why | **30** | 21 |
| Understood in 30 seconds | **30** | 19 |
| Length right for the change | **30** | 9 |
| Facts a reviewer needs, missing | **11** | 67 |
| Claims the judge found unsupported | **8** | 21 |

Not perfect: the fact check found a detail the diff contradicts in 8 of the 30 (a version number, which table a record lands in), and one test result the notes didn't report. In real use the agent wrote the code and `unverified-in-session` checks its test claims against the session; the eval has neither.

With a smaller model, the same 30 written by Gemini 3.8 Flash all pass, all have a Tested line, 29 say why (the 30th's author never did), and none keep a bold label on every line, a file tour or a buzzword, against 7, 4 and 3 of the originals. A blind Gemini judge preferred the rewrite in 30 of 30, with 4 missing facts against the originals' 31; it's the same model as the writer, so read that as a second opinion, not proof ([heldout-gemini](../bench/eval/corpus)).

**The shape itself, before the eval above.** 30 real agent PRs (10 tiny, 10 normal, 10 big, from Claude Code, Copilot's agent, Cursor, Devin, Jules and Amp), each written two ways from its real diff and its original description, used as the agent's notes: facts kept, none added. A separate model judged every pair blind ([bench/eval/format.md](../bench/eval/format.md)):

| | New shape preferred | Other preferred | Tie | Facts a reviewer needs, missing |
|---|---|---|---|---|
| New shape vs the agent's original | **24 of 30** | 2 | 4 | new 9, original 61 |
| New shape vs buzzcut's old one-paragraph style | **24 of 30** | 1 | 5 | new 4, paragraph 65 |

It isn't shorter: the new shape's median is 126 words, against 104 for the originals. What changes is what's there. Against the originals, the judges flagged 19 unsupported claims in the originals and 1 in the new shape, and all 60 rewrites pass buzzcut.

**Where it falls short:** one writer wrote both rewrites of every PR, knowing which was the new shape; each pair got one verdict from one model; and the old style was held to one paragraph even on big diffs, where the old skill allowed headers. Twice the judge preferred the original, because it explained design choices the rewrite had cut.
