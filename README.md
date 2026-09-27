<div align="center">

# buzzcut

**AI yaps, we cut. Pull requests written like the good old days.**

Your agent writes the code. buzzcut makes the commit messages and PR descriptions it writes say what changed and why, in plain words, so your reviewers read the PR itself instead of pasting it into another AI to find out what it does. Each draft is checked against the diff before it runs; when it's a form, a file tour or padding, the agent is told exactly what to cut and rewrites it. You don't do anything.

No API key, no LLM, zero dependencies. Works in Claude Code, Cursor, Windsurf, Antigravity, VS Code and the terminal.

[![npm](https://img.shields.io/npm/v/buzzcut?color=3fb950&label=npm)](https://www.npmjs.com/package/buzzcut)
[![ci](https://github.com/Shiva-Xs/buzzcut/actions/workflows/ci.yml/badge.svg)](https://github.com/Shiva-Xs/buzzcut/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<img src="assets/blocked.svg" alt="A coding agent's git commit blocked by buzzcut: markdown headers, bold labels and ticked boxes for a 9-line change, with the fix for each" width="760">

</div>

## Why

Senior engineers keep saying it: AI-written PRs are hard to read. Not always long, just written for nobody: `## Summary / ## Changes / ## Testing` on a 9-line fix, a bold label on every bullet, a tour of files the diff already shows, "comprehensive and robust", a checklist of boxes nobody checked. So reviewers paste the PR into another chatbot to find out what changed. Somewhere in there was the one sentence they needed: what changed, and why.

In 1,275 real PRs opened by coding agents in 2026 ([bench/](bench)): 20% never said why, 21% didn't say how the change was tested, 16% had more bullets than the change deserved, 16% put a bold label on every line, and 4% filled out a full template for a small diff.

We're not going to stop writing code with AI. buzzcut makes what it writes for people read the way a good engineer wrote a PR before AI: a title that says what changed, an opening on why, the few changes a reviewer would ask about with where to look and the values, and what was tested. Not squeezed into one paragraph, not a form. And since it reads the diff, a claim the diff contradicts is sent back too.

Put it on your machine, commit it to a repo for your team, or run the GitHub Action on every PR in your org (below).

## Install once

```bash
npm i -g buzzcut
buzzcut setup
```

`setup` covers the whole machine:

- **Every repo:** a global `commit-msg` and `pre-push` hook. Git runs it no matter which editor or agent makes the commit, including VS Code's ✨ button. Each repo's own hooks (git-lfs, pre-commit, husky's) keep working.
- **Every agent it finds:** the buzzcut skill, so the agent writes a good message the first time, and the agent's own pre-command hook, so a bad `git commit`, `gh pr create` or GitHub connector call (`create_pull_request`, `push_files`) is stopped *before it runs* with a list of fixes.
- **VS Code's ✨ buttons:** "Generate commit message" and "Generate PR description" follow the same rules.

`buzzcut doctor` shows what's installed where. `buzzcut setup --uninstall` puts everything back exactly as it was.

| Where | How buzzcut steps in | Tested with the real app |
|---|---|---|
| Claude Code (terminal; the VS Code extension reads the same settings) | Skill + PreToolUse hook + git hooks | ✅ 5 real terminal sessions: blocks, agent rewrites, commits; PRs through `gh` and through a GitHub MCP connector |
| Antigravity | Skill + PreToolUse hook + git hooks | ✅ Blocked `"Update webhook.js"`, agent (Claude Opus 4.6) rewrote and committed. With the skill, Gemini 3.8 Flash wrote a 52-word commit for a 37-file change where it had written 214 words and 22 bullets without it |
| Cursor | Skill + beforeShellExecution hook + git hooks | ✅ Blocked `"Update webhook.js"`, agent (Grok 4.6) rewrote and committed |
| Windsurf | Skill + pre_run_command hook + git hooks | ✅ Blocked `"Update webhook.js"`, agent (SWE-1.6) rewrote and committed |
| VS Code (Copilot agent, ✨ buttons) | Skill + agent hook + button instructions + git hooks | Built to VS Code's documented format |
| Codex, Gemini CLI, others | Skill + git hooks | |
| Any terminal, any person | Git hooks (warn only) | ✅ end-to-end tests with real `git commit` / `git push` |

Setting up a repo for a whole team instead? `npm i -D buzzcut && npx buzzcut init` writes the same hooks and skill into the repo, to commit and share.

## What happens when you say "push this to GitHub"

Say you've run `buzzcut setup` and you're in VS Code, Cursor or a terminal with your agent of choice:

1. **You:** "push this to GitHub and open a PR".
2. **The agent loads the buzzcut skill**, since its description covers committing, pushing and opening PRs. It runs `buzzcut context` and gets a map of the diff (areas with line counts, which files are tests, docs, generated or only renamed, the branch's commits), the shape and word range for a diff that size, and how this repo writes commits.
3. **It writes the message and runs `git commit`.** The agent's pre-command hook hands the command to buzzcut *before it runs*. A message with an invented test, a fake "verified", or a wall of fluff is sent back with the exact fixes; the agent rewrites it and runs the command again. You don't see any of this unless you look.
4. **Git's own `commit-msg` hook checks it again.** That covers every editor, every tool and the ✨ button, because git runs it no matter who commits.
5. **`git push`:** the `pre-push` hook re-checks what's going out, which catches an agent's `git commit --no-verify`.
6. **`gh pr create` or a GitHub connector call:** the PR description is checked against the branch diff and what the agent actually ran, the same way.

The result is a commit and a PR a reviewer can read, with nothing made up, and you didn't do anything.

**Agents buzzcut can't recognize** (a new tool, or one without pre-command hooks): they still get the skill if they read `~/.agents/skills`, and git's hooks still check every commit. Since buzzcut can't tell them from a person, it only warns, but the warning tells the agent how to fix and amend its own commit, and agents act on it. To block every commit in a repo regardless, set `"block": "always"` in `.buzzcut.json`, or set `BUZZCUT_AGENT=1` in that tool's environment.

## What gets blocked, and what's only advice

buzzcut cuts fluff, never facts. A message is **blocked** only for:

- **Claims the diff contradicts:** "added unit tests" with no test file changed.
- **Claims the session contradicts:** "tests pass" or "verified manually" when the agent ran nothing. Claude Code and Antigravity pass buzzcut the session transcript, and it reads which commands actually ran (locally; it never leaves your machine). An honest *"Not tested"* is always fine.
- **Subjects that say nothing:** "fix bug", "wip", "Update webhook.js".
- **Forms on small diffs:** `## Summary / ## Changes / ## Testing / ## Notes` on a 9-line fix. Headings that say something specific ("Root cause: Cython 3.3.0"), a Tested section, and tables of data never count; Problem / Fix / Result sections on a small fix only get advice.
- **Changelogs in commits:** "Key Changes:" and 20 bullets listing every class. git log is read for why; the facts stay, the list goes.
- **Extreme bloat:** 4× the word budget when it's vague, 6× when it's dense with detail, or a pile of prose tells (buzzwords, bold labels, a file tour) that takes the score over 35. Warnings about length and shape (a long PR, many bullets, a long title, no Tested line) count for 20 points at most, so a long PR full of facts is never sent back for its length alone.
- **Rewrites that lose facts:** when a sent-back draft comes back without numbers, error messages, issue links or `file:line` pointers it had, it's sent back once more with the list. The agent may cut padding, not evidence.

Everything else (long-ish, a few bullets, a buzzword, a big diff with a one-line description) is a note the agent sees but that doesn't block anything. Coding agents are blocked; people only ever get a warning (change that with `"block"` in the config).

## Before and after

The same 9-line change: retry webhook deliveries to customer endpoints on 5xx and 429. The after is the shape buzzcut asks for: what changed and why, the changes a reviewer would ask about, and what was tested.

<table>
<tr><th>Before: 146 words, yap score 100 (F)</th><th>After: 80 words, yap score 0 (A)</th></tr>
<tr valign="top"><td>

```md
## 🚀 Summary
This PR introduces a comprehensive and
robust retry mechanism for webhook
delivery, significantly enhancing the
reliability and resilience of our
notification system.

## ✨ Key Changes
- **Retry Logic**: Implemented a robust
  retry loop in `src/webhook.ts`...
- **Exponential Backoff**: Leveraged...
- **Code Quality**: Improved code
  readability and maintainability

## 🧪 Testing
- [x] Tested locally
- [x] No breaking changes

Overall, these changes significantly
improve the robustness of our webhook
delivery pipeline...
```

</td><td>

```md
Retry webhook deliveries on 5xx and 429

Webhook deliveries to customer
endpoints fail about 2% of the time
with 502s and 503s while their
servers restart, and we drop the
event. This retries them.

- 5xx and 429 responses retry up to
  3 times with backoff (200ms, 400ms,
  800ms, plus up to 100ms of jitter),
  then throw so the job queue picks
  the event up
- Other 4xx responses still fail
  right away, since retrying won't
  help

Tested: `npm test`, plus a local
server that returns 503 twice, then
200.
```

</td></tr>
</table>

## Roast any PR, any repo, or your own history

```bash
npx buzzcut roast https://github.com/owner/repo/pull/123   # one PR, as a card
npx buzzcut roast owner/repo                               # its last 10 merged PRs, ranked
npx buzzcut roast                                          # inside a repo: its last 20 commits
```

Or with no install at all, in your browser: **[buzzcut-pr.pages.dev](https://buzzcut-pr.pages.dev)**. It runs the same checks locally in the page, against GitHub's public API.

<img src="assets/roast.svg" alt="buzzcut roasting a 117-word PR description for a 9-line diff: it never says why, yap score 100, grade F" width="720">

Every card starts with what a reviewer asks: does it say **what changed** (the title), and **why** (the sentence that gives a reason)? Then it cuts in proportion: a clean PR gets a compliment, a decent one a nit or two, a yappy one the full roast, backed by numbers (words per changed line, how far over budget). **Worth keeping** pulls out the sentences that carry facts, which is what a short version would say. Add `--share` for a link that posts the roast on X, or `--md` for a comment.

<img src="assets/roast-repo.svg" alt="buzzcut ranking a repo's last merged PRs by yap score" width="720">

No author names on any card, and PRs opened by bots are skipped.

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

The PR budget was tuned on data ([`bench/eval/format/budget.mjs`](bench/eval/format/budget.mjs)): it's the tightest formula tested that fits all 30 descriptions written in the target shape for real agent PRs even without the specificity bonus (the old `40 + 6·√n` would have flagged 10 of them), and it flags 0.7% of the PRs from before AI as too long, down from 2.3%.

Code blocks, tables' contents, HTML comments, your repo's PR template boilerplate, and attribution lines like `Co-authored-by:` never count as prose. Lockfiles, generated files and anything `.gitattributes` marks `linguist-generated` don't count toward the changed lines. Merges, reverts, `fixup!` commits, dependency bumps and version tags are skipped, and GitHub's squash merges are judged as the PR description they carry.

## Big changes

A 3,000-line refactor gets more room, not a free pass. The budget grows with the diff (about 310 words for 1,000 lines, 500 at most, up to 2.5× that when it's dense with detail), a few short plain headers are fine, and more bullets are allowed. What it still asks for is a map instead of a tour:

- `buzzcut context` maps every diff: where its lines are by area (`src/payments  400 lines, 6 files`), which files are tests, docs, generated or only moved, and the branch's commits, so the agent can say what's mechanical and roughly how much of the diff it is.
- The skill asks for why, what's mechanical and roughly how much of it, the few behavior changes worth a real review and where they are, and how to review it. Grouped by area, never file by file.
- A file-by-file walk-through is still flagged (`diff-echo`), and facts like `comm.c:1028` must survive every rewrite (`dropped-facts`).

Of the 64 PRs by people in the benchmark with 1,000 or more changed lines, 1 is sent back (it was before this version too); of 193 such PRs by agents, 7 are.

## Config

Optional. `.buzzcut.json` at the repo root (or a `"buzzcut"` key in `package.json`):

```json
{
  "$schema": "https://unpkg.com/buzzcut/schema.json",
  "max": 35,
  "block": "agents",
  "length": "normal",
  "rules": { "em-dash": "off", "length": "error" },
  "ignore": ["^release:"]
}
```

| Key | Default | Meaning |
|---|---|---|
| `max` | `35` | Highest passing yap score |
| `block` | `"agents"` | Who a failing message blocks: `"agents"` (people get a warning), `"always"`, or `"never"` (advice only) |
| `length` | `"normal"` | How long descriptions should be: `"short"` (0.6× the words and bullets), `"normal"`, or `"detailed"` (1.6×). `buzzcut context` passes it to the agent, so it writes to that length the first time. The checks for false claims and dropped facts are the same at every length |
| `rules` | `{}` | Per rule: `"off"`, `"info"`, `"warn"` or `"error"` |
| `ignore` | `[]` | Regexes for subjects to skip, on top of the built-in ones |

A typo in a rule name is an error, not a silently ignored setting. A broken config never blocks a commit; buzzcut prints the problem and lets it through.

## GitHub Action

Catches PRs from people and agents that don't have buzzcut installed.

```yaml
# .github/workflows/buzzcut.yml
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  buzzcut:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # optional: lets it learn your commit style
      - uses: Shiva-Xs/buzzcut@v0
```

It checks the description and each commit (up to 30), writes a job summary, keeps one PR comment up to date, and fails the check when something is blocked. PRs opened by coding agents' bot accounts (Copilot, Devin, Jules, Cursor, Codex) are checked; dependency and release bots are skipped. Inputs: `max`, `comment`, `commits`, `fail`. Outputs: `score`, `grade`, `pass`. On fork PRs the token can't comment, so it warns and relies on the job summary.

## Does it work on real PRs?

Two tests, both on real PRs. **buzzcut's checks** ran on all **3,366 PRs and commits** downloaded from GitHub (`npm run bench`): 2,640 PRs from over 1,000 repos, 1,275 of them opened by coding agents, and 726 commits. That needs no model and answers whether it flags good writing and catches slop. **The PRs an agent writes with buzzcut** need a model to write them, so that test runs on samples of 30 ([bench/eval/corpus/](bench/eval/corpus)). Everything is in [`bench/`](bench) so you can rerun it.

**It leaves good writing alone.** The ground truth is work from before AI coding assistants existed, merged between 2018 and May 2021 in 75 projects (kubernetes, rust, node, cpython, pytorch, linux, git, postgres…), so anything flagged there is a false alarm:

| Set | Items | Sent back for an agent |
|---|---|---|
| PRs from before AI | 561 | **5 (0.9%)**, all GitHub's default "Update README.md"-style titles |
| Commits from before AI | 167 | **0** |
| PRs by people, 2026 (some may be AI-assisted) | 804 | 9 (1.1%) |
| PRs by coding agents | 1,275 | 57 (4.5%) |

An earlier build sent back 10 of the PRs from before AI, 25 by people in 2026 and 104 by agents. The difference is false alarms fixed (`phantom-tests` on "Ran unit tests", paths and product names), Problem / Fix sections no longer blocking a small fix, and length and shape warnings no longer adding up to a send-back on their own.

**An agent with buzzcut writes PRs reviewers prefer.** Sonnet 5 wrote buzzcut's version of 30 real agent PRs from repos the skill was never tuned on, from each PR's real diff and its original description (used as the agent's notes: facts kept, none added), checking with buzzcut until it passed. A separate call judged each pair blind, and a third fact-checked buzzcut's version against the diff and the notes ([bench/eval/corpus/](bench/eval/corpus)):

| On 30 held-out agent PRs | buzzcut's version | Agent's original |
|---|---|---|
| Preferred by the blind judge | **30** | 0 |
| Opens with what changed and why | **30** | 21 |
| Understood in 30 seconds | **30** | 19 |
| Length right for the change | **30** | 9 |
| Facts a reviewer needs, missing | **11** | 67 |
| Claims the judge found unsupported | **8** | 21 |

Not perfect: the fact check found a detail the diff contradicts in 8 of the 30 (a version number, which table a record lands in), and one test result the notes didn't report. In real use the agent wrote the code and `unverified-in-session` checks its test claims against the session; the eval has neither.

With a smaller model, the same 30 written by Gemini 3.8 Flash all pass, all have a Tested line, 29 say why (the 30th's author never did), and none keep a bold label on every line, a file tour or a buzzword, against 7, 4 and 3 of the originals. A blind Gemini judge preferred the rewrite in 30 of 30, with 4 missing facts against the originals' 31; it's the same model as the writer, so read that as a second opinion, not proof ([heldout-gemini](bench/eval/corpus)).

**The shape itself, before the eval above.** 30 real agent PRs (10 tiny, 10 normal, 10 big, from Claude Code, Copilot's agent, Cursor, Devin, Jules and Amp), each written two ways from its real diff and its original description, used as the agent's notes: facts kept, none added. A separate model judged every pair blind ([bench/eval/format.md](bench/eval/format.md)):

| | New shape preferred | Other preferred | Tie | Facts a reviewer needs, missing |
|---|---|---|---|---|
| New shape vs the agent's original | **24 of 30** | 2 | 4 | new 9, original 61 |
| New shape vs buzzcut's old one-paragraph style | **24 of 30** | 1 | 5 | new 4, paragraph 65 |

It isn't shorter: the new shape's median is 126 words, against 104 for the originals. What changes is what's there. Against the originals, the judges flagged 19 unsupported claims in the originals and 1 in the new shape, and all 60 rewrites pass buzzcut.

**Where it falls short:** one writer wrote both rewrites of every PR, knowing which was the new shape; each pair got one verdict from one model; and the old style was held to one paragraph even on big diffs, where the old skill allowed headers. Twice the judge preferred the original, because it explained design choices the rewrite had cut.

## CLI

```
buzzcut setup [--no-git-hooks] [--no-agents] [--no-vscode] [--uninstall] [--dry-run]
buzzcut doctor
buzzcut init [--agents claude,cursor,windsurf,antigravity,copilot|all|none] [--uninstall]
buzzcut context [--kind pr] [--base <ref>] [--json]
buzzcut check [file|-]        A commit message against the staged diff
buzzcut pr [file|-]           A PR body against the branch (no file: the open PR, via gh)
buzzcut log [-n 10]           Score your recent commits
buzzcut roast <pr-url>        Roast any public GitHub PR (or owner/repo#123)
buzzcut roast <owner/repo>    Rank a repo's last merged PRs (-n 10)
buzzcut roast                 Inside a repo: rank its last commits (-n 20)
                               --share (post on X), --md, --json

check / pr options
  -m, --message <text>   --title <text>   --base <ref>   --rev <commit>
  --kind commit|pr       --no-diff        --max <n>      --json
```

`roast` and `pr` use `GITHUB_TOKEN`, or your `gh` login if you have one, only to call api.github.com.

## Use it as a library

```ts
import { analyze, prMessage, buildDiff, passes } from 'buzzcut';

const diff = buildDiff([{ path: 'src/webhook.ts', additions: 7, deletions: 2 }]);
const report = analyze(prMessage('Update webhook.ts', 'This PR introduces a robust retry mechanism for webhook delivery.'), diff);
report.score;        // 21
passes(report, 35);  // false: the title doesn't say what changed
report.findings;     // [{ rule: 'subject-vague', severity: 'error', … }, { rule: 'ai-opener', … }, { rule: 'ai-vocab', … }]
```

## FAQ

**Is this an AI detector?** No. It flags patterns, not authors. A person who writes "leverage" gets the same note as a model that does.

**Doesn't blocking make PRs worse?** It blocks false claims, empty subjects, forms on small diffs and a pile of prose tells; length, bullets and other shape warnings are only advice. The agent keeps the why, the numbers and what it actually ran, and says "Not tested" instead of inventing a test plan. In the blind test ([bench/eval/format.md](bench/eval/format.md)), the judges flagged 1 unsupported claim across 30 descriptions in this shape, and 19 in the agents' originals.

**Why block agents but only warn people?** An agent rewrites a message in two seconds and doesn't mind being told twice. A person in the middle of a hotfix does. Set `"block": "always"` if your team wants the stricter version.

**Can the agent just use `--no-verify`?** The agent hooks stop the command before git runs, and the `pre-push` hook re-checks anything that slipped through. The skill also tells agents never to bypass it.

**Will it make an agent rewrite my old commits?** No. `pre-push` only blocks an agent for commits that skipped the commit check. Commits a person was warned about and kept, and anything from before buzzcut was set up, get a note and go through, and the agent is told not to rewrite them.

**My repo writes "Added …", not "Add …".** buzzcut learns the tense from the last 200 commits and follows it, along with conventional prefixes, ticket ids and capitalization. Imperative is only the default for a repo with no history.

**Does it read my agent sessions?** Only the transcript file the agent's own hook hands it, only to list which commands ran, and only on your machine. Nothing is sent anywhere.

**Does it work from GUI editors?** Yes. Editors launched from the Dock often don't see your shell's `PATH` (nvm users especially), so `setup` calls node and its own copy of buzzcut by absolute path.

**What if a teammate doesn't have buzzcut installed?** Repo hooks look for it in `node_modules/.bin` and on `PATH`, and quietly do nothing when it's missing. Nobody gets locked out of committing.

**Why no LLM?** A deterministic check is free, fast (20 to 40 ms per hook call), private, and gives the same answer every time, so it can gate commits and CI. Your coding agent is already a language model. What it lacks is something objective to check its writing against.

**Windows?** The git hooks are POSIX sh, which Git for Windows runs, and CI runs the full test suite on Windows.

## Credits

Several prose patterns follow Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing). Related projects: [humanizer](https://github.com/blader/humanizer) rewrites general prose, [ai-slop-linter](https://github.com/Bubblegunn/ai-slop-linter) lints wording, and [anti-slop](https://github.com/peakoss/anti-slop) gates incoming PRs.

MIT © [Shivateja Janjirala](https://shivateja.dev)
