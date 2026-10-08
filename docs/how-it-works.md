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
| `test-count-mismatch` | A test count that isn't what the agent's own run printed (error) |
| `unsourced-name`, `unsourced-fact` | A name, file, header or number the description cites that isn't in the changed lines, the repo before the change, or the session (a note; opt in to blocking with `"rules": {"unsourced-name": "error"}`) |
| `unmentioned-area` | An area with 40% or more of the changed lines that the description never mentions (advice only) |
| `thin-description` | An empty or one-line description on a 300+ line diff (advice only) |
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

**It leaves good writing alone.** The ground truth is work from before AI coding assistants existed, merged between 2018 and May 2021 in 75 projects (kubernetes, rust, node, cpython, pytorch, linux, git, postgres…), so anything flagged there counts as a false alarm (some of it is weak writing, like a commit titled "Update README.md"):

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

With a smaller model, the same 30 written by Gemini 3.8 Flash all pass, 29 say why (the 30th's author never did), and none keep a bold label on every line, a file tour or a buzzword, against 7, 4 and 3 of the originals. A blind Gemini judge preferred the rewrite in 30 of 30, with 4 missing facts against the originals' 31; it's the same model as the writer, so read that as a second opinion, not proof ([heldout-gemini](../bench/eval/corpus)).

**The shape itself, before the eval above.** 30 real agent PRs (10 tiny, 10 normal, 10 big, from Claude Code, Copilot's agent, Cursor, Devin, Jules and Amp), each written two ways from its real diff and its original description, used as the agent's notes: facts kept, none added. A separate model judged every pair blind ([bench/eval/format.md](../bench/eval/format.md)):

| | New shape preferred | Other preferred | Tie | Facts a reviewer needs, missing |
|---|---|---|---|---|
| New shape vs the agent's original | **24 of 30** | 2 | 4 | new 9, original 61 |
| New shape vs buzzcut's old one-paragraph style | **24 of 30** | 1 | 5 | new 4, paragraph 65 |

It isn't shorter: the new shape's median is 126 words, against 104 for the originals. What changes is what's there. Against the originals, the judges flagged 19 unsupported claims in the originals and 1 in the new shape, and all 60 rewrites pass buzzcut.

**Where it falls short:** one writer wrote both rewrites of every PR, knowing which was the new shape; each pair got one verdict from one model; and the old style was held to one paragraph even on big diffs, where the old skill allowed headers. Twice the judge preferred the original, because it explained design choices the rewrite had cut.

### Checking names, files and test counts

0.3 reads the changed lines (not only which files changed), searches the repo as it stood before the PR, and reads the agent's session, then looks up what a description cites. A function, file, header or number it names that is nowhere in the changed lines, the repo or the session is shown as a note; "adds X" about something the diff removes is too. A test count that isn't what the agent's own run printed blocks. Finding a name doesn't prove the sentence around it is true, so this is a lookup, not a fact-check: it can't catch a wrong number or a wrong description of what the code does.

How it was measured, on a held-out set of 311 PRs from 27 repos that appear nowhere else in the data, frozen before the rules were written ([`bench/heldout.json`](../bench/heldout.json)), split by repo into a half the rules were tuned on and a half opened once:

- **Honest PRs.** On the 212 in the sealed half, the new checks add notes to 6 (2.8%), and the same 2 (0.9%) are sent back by the existing rules in 0.1.2 and now. A first version blocked 7 on the sealed half, over the 1% bar set beforehand, so the name, file and "adds what it removes" checks ship as notes, not blocks.
- **Planted errors.** Another model (Gemini) planted errors in real PRs: invented names flagged on 54 of 62, invented files 37 of 39, removals described as additions 16 of 18, wrong numbers 3 of 32, wrong behaviors 3 of 41. 0.1.2 flagged about none of them. The list is frozen in [`bench/eval/planted/`](../bench/eval/planted).

### Writing, against a plain prompt

[`bench/eval/v3/`](../bench/eval/v3) has the plans, the arms and every result. Gemini 3.8 Flash wrote descriptions for real PRs, each with the author's full text as notes and with only its first sentences; a second pass graded them against a checklist of facts from the notes, with the arm letters shuffled. The last run, of the tool as released, used 32 PRs from 16 repos used nowhere else (64 graded descriptions per arm):

| arm | mean rank (1 is best) | needed facts kept | PRs with an unsupported claim |
|---|---|---|---|
| skill text alone | **1.48** | 91% | 0 |
| the full tool: skill + `buzzcut context` + checker | 1.86 | 90% | 3 |
| plain prompt: keep the facts, add nothing, leave testing out if nothing ran | 2.66 | 87% | 1 |

- **Both beat a good plain prompt.** The skill text alone won 57 of 64 PRs against it, the full tool 49 of 64.
- **The skill text alone still writes a little better than the full tool**: 40 PRs to 24, about 0.4 of a rank. The full tool made one invented open question on thin notes and two borderline claims; its descriptions are shorter than the plain prompt's and now as long as the skill text's.
- **The full tool got here in steps.** On the first sealed test set it kept 80% of the author's facts, ranked 2.76 against 1.84 for the skill text alone, and lost to the plain prompt on big PRs. The text `buzzcut context` gives the writer was the cause, not the checker: it told writers to give a Tested line only for what *they* ran (so the author's "tests pass" went), it gave a word range that read as a target, and it asked for a rough percentage of mechanical lines. Fixing those took the facts to 90%; removing the numbered slots and the word figure took the full tool from level with the plain prompt (33 PRs to 41) to ahead of it (49 to 15).
- **Against a bare "write the PR description"** (first test set, before those fixes): the skill text alone won 54 of 70, the full tool 40 of 70; the bare prompt kept 65% of the author's facts and made 22 unsupported claims in 16 descriptions.
- **Audits.** For each run Claude graded a quarter of the PRs blind before seeing the grades: the order of the arms agreed on 75% to 82% of pairs, the facts kept on 97% to 100% of decisions, the unsupported claims on 96% to 100%.
- **Not shown:** that this holds for other models, or for descriptions written from a real agent session instead of an author's notes. The grader and the writer are the same model family. Part of the rank gap to the plain prompt is style the grader rewards (short, no boilerplate testing line, no headings on small changes); the facts and unsupported-claim columns are not.
