# Changelog

## 0.1.2

- The website moved to trybuzzcut.pages.dev (buzzcut-pr.pages.dev redirects there), and the README links follow.
- The README gives the skill-only install (`npx skills add Shiva-Xs/buzzcut`) and the Claude Code plugin commands.

## 0.1.1

- The agent hooks check the repo a command runs in. `cd other-repo && git commit …` and `git -C other-repo commit …` are judged by that repo's history and config, and a command started outside any repo is now checked at all (before, the agent hook let it through and only git's commit-msg hook caught it).
- `buzzcut init` no longer writes into a global `core.hooksPath`. On a machine where `buzzcut setup` ran, `init` in a repo followed the global setting and overwrote the machine-wide hooks with repo-level ones; it now writes to the repo's own `.git/hooks`, which the global hooks run, and warns when a global hooks folder that isn't buzzcut's would stop them from running.
- The GitHub Action is named "buzzcut PR check" for the Marketplace, since the name buzzcut belongs to an existing GitHub organization. Workflows keep using `Shiva-Xs/buzzcut@v0`.
- A shorter README (2,186 words); the full rule list, scoring and evidence moved to docs/how-it-works.md.

## 0.1.0

First public release. PRs take the shape a good engineer wrote before AI: what changed and why, the changes a reviewer would ask about, and what was tested.

- New `"length"` setting in `.buzzcut.json`: `"short"`, `"normal"` (the default) or `"detailed"`. It scales the word range and the bullets allowed (0.6× or 1.6×), and `buzzcut context` tells the agent, so it writes to that length the first time. The checks for false claims and dropped facts don't change.
- The skill writes in the language the repo already uses and never translates a PR to English.
- The skill, tuned on what reviewers of the held-out eval pointed out: reread every line against the diff before checking (names, values, "every", which section a thing is in); never turn what the code does into a motive; keep URLs, commands and config values where a reviewer can copy them, with a short code block allowed; keep the author's tips for the next person; keep the repo's title style and a title that's already good; and when a description is already clear, add only what's missing instead of restyling it.
- `buzzcut context --kind pr` asks for a prefixed title (`fix:`, `ci:`) when the repo's commits use prefixes.
- The skill never writes shorter than the problem needs: the problem in a sentence, the evidence the author gave, the explanation of anything a reviewer would stop at, and a snippet that shows the exact change stay in. Small models (Haiku, Gemini Flash) cut those first.
- `missing-why` reads more reasons: a purpose without "that" ("so tests are picked up on XPU CI"), a need stated as a sentence ("Agents need durable memory"), and a problem someone hit ("users were trapped in the sidebar", "became unreadable", "had to re-tab"). Found in a 30-PR run with Gemini 3.8 Flash, where 5 rewrites that said why were told they didn't.
- The skill keeps a scope limit the author stated ("this doesn't close #110") and every check that ran, not a sample.
- The skill describes the whole diff, not only the part the agent remembers: an area with a large share of the lines gets a line of its own, or the PR says the branch carries it.
- The webhook example (README, skill, site, test fixture) retries deliveries to customer endpoints on 5xx and 429 with jitter, instead of calls "to Stripe". The site's before/after panel is now the tested fixture word for word, and a test keeps it that way.
- The skill asks for an opening on what changed and why, 2 to 5 bullets a reviewer would ask about (where to look, old → new values), an optional risk line, and a `Tested:` / `Not tested:` line, scaled for tiny, normal and big diffs. Commits: 1 to 3 lines on why, plus a few plain bullets.
- `buzzcut context --kind pr` maps every diff: areas with line counts, test, doc and generated files and pure renames, the branch's commits, the shape for its size, and a word range.
- The PR budget is `60 + 8·√n` (80 to 500 words), tuned on 30 rewrites and the benchmark; `bullet-bloat` allows 5 bullets on any PR; `template-on-tiny` blocks only a full form on a small diff; length and shape warnings count for 20 points at most toward a send-back.
- New `thin-description` (advice only): an empty or one-line body on a 300+ line diff, or no Tested line.
- Fewer false alarms: `phantom-tests` on test runs, paths and names, verification checks that missed bare commands, non-English text, UUIDs read as tickets. Files marked `linguist-generated` don't count as changed lines.
- `buzzcut check` no longer compares a commit message with the previous commit's draft in the same file.
- Over-long descriptions are sent back again: length counts in full toward a send-back from 2.5× the budget, and in full together with `bullet-bloat` when both fire. Thin prose at 2.5× on a diff under 30 lines is sent back on length alone (4× on bigger diffs, so a long explanation of a real change still passes). On the corpus: 3 more agent PRs sent back (AbramNel/MultiChart#1, 965 words and 22 bullets), no change before AI.
- New `long-bullet` (advice only): a bullet over 40 words, wrapped lines included. The skill asks for one change per bullet, about 25 words.
- `phantom-tests` fires only when the author says they added or wrote tests ("Added regression tests for X", "a new test asserts…") and no test file changed. Test runs, checkbox lines, questions, template instructions, docs about test commands and "test" inside another noun (test step, test harness) no longer fire. On the corpus: 40 hits → 4, all real.

### From the first build

- `buzzcut setup`: one command per machine. A global `commit-msg` / `pre-push` hook for every repo (each repo's own hooks keep running), the skill for every coding agent found, each agent's pre-command hook, and VS Code's ✨ commit-message and PR-description buttons. `buzzcut doctor` reports what's installed; `--uninstall` restores everything. Updating buzzcut updates the machine setup too.
- `buzzcut init`: the same hooks and skill written into one repo, to commit for a team. Works with husky, `core.hooksPath` and existing hooks.
- Agent hooks for Claude Code (and VS Code's agent mode, which reads the same format), Cursor, Windsurf and Antigravity. They read the message out of `git commit` / `gh pr create` commands (heredocs included) and GitHub connector calls (`create_pull_request`, `update_pull_request`, `push_files`, `create_or_update_file`), and send bad ones back before they run, with the fixes.
- Session-aware: when the agent's transcript is available (Claude Code, Antigravity), "tests pass" or "verified manually" is checked against the commands the agent actually ran.
- 30 rules. A message is blocked only for false claims (tests that don't exist, verification that didn't happen), subjects that say nothing, a full template on a small diff, commit bodies that narrate every change as bullets, extreme bloat, or a rewrite that quietly dropped facts (`dropped-facts`: numbers, measurements, issue links, `file:line` pointers, hashes, commands and outputs, and quoted messages must survive a rewrite). Everything else is advice.
- Agents buzzcut can't recognize still get told how to fix and amend their own commit, in the warning git prints.
- Big changes get a map, not a free pass: `buzzcut context` says where the lines are and how many files only moved, and the skill asks for what's mechanical, the behavior changes worth review, and how to review it.
- Learns each repo's commit format (conventional prefixes, case, ticket ids, subject length, past or imperative tense) from its history, and ignores the repo's PR template boilerplate. Lockfiles and generated files don't count toward the word budget.
- `pre-push` blocks an agent only for its own commits that skipped the commit check (`--no-verify`). A person's commit that was warned and kept, or history from before buzzcut, is never something an agent is told to rewrite.
- `buzzcut roast`: one PR as a card that opens with whether it says what changed and why, then cuts in proportion to the grade (a compliment, a nit or two, or the full roast, with the sentences worth keeping), a repo's last merged PRs as a leaderboard (`roast owner/repo`), or a repo's own commits (`roast` inside it). `--share` makes a link that posts it on X.
- `buzzcut context`, `check`, `pr` and `log`. `log` and `roast` judge GitHub squash merges as the PR description they carry, and skip merges, reverts, releases and dependency bumps.
- `.buzzcut.json` config with a JSON Schema.
- GitHub Action that checks the PR description and each commit, writes a job summary, and keeps one comment up to date. PRs from coding agents' bot accounts are checked; dependency bots are skipped.
- Benchmark on 3,366 real PRs and commits (`bench/`), with PRs and commits from before AI coding assistants existed (2018 to May 2021) as the ground truth for false alarms, and blind evals of the PRs agents write with the skill.
- A website (`site/`): a hero you can shave, a roast receipt that runs in the browser against GitHub's public API (with three made-up PRs to compare), the same PR before and after, what 1,275 real agent PRs get wrong, the "push it" flow, and how to roll it out to a team.
- Agent skill (`npx skills add Shiva-Xs/buzzcut`) and Claude Code plugin.
