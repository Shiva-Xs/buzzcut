---
name: buzzcut
description: Write commit messages and pull request descriptions the way a good engineer did before AI, what changed and why, the changes a reviewer would ask about, and what was tested, true to the diff, then check them with buzzcut. Use whenever you commit, push, or open or update a pull request (including when the user says "push this to GitHub", "ship it", "commit and push" or "open a PR", and when a GitHub tool creates the PR), when a buzzcut hook sends a commit or PR back, or when asked for a commit message or PR description.
---

# buzzcut

Write for the reviewer. They should learn why this change exists, what to look at, and how it was checked, with every fact they need and nothing to skim past: the PR a good engineer wrote before AI. Not a single cramped paragraph, not a form, not a tour of the diff. buzzcut compares what the text claims against what the diff did and what you ran, and the repo's hooks send back anything that doesn't pass.

When the user asks you to push or ship: commit (step 1 below), push, and open the PR if they want one (step 1 with `--kind pr`). Every commit and PR goes through this, whether you use `gh` or a GitHub tool.

## Workflow

1. Look before you write: `npx -y buzzcut context` for a commit, `npx -y buzzcut context --kind pr` for a PR. It maps the diff by area with line counts, lists the test, doc and generated files and the pure renames, shows the branch's commits, and gives the shape and word range for a diff this size, plus how this repo writes its commits.
2. Write the draft to a file: `.git/BUZZCUT_MSG` for a commit, a temp file for a PR body.
3. Reread the draft twice before buzzcut sees it. Once against the diff (see "Say exactly what the diff does" below): buzzcut looks up names and files, but not what the code does, so this pass is yours. Once against what you were given (the author's notes, the issue, the conversation, an old description): anything from there that a reviewer needs and isn't in the draft goes in (see "Carry over what you were given").
4. Check it:
   - Commit: `npx -y buzzcut check .git/BUZZCUT_MSG` (compares against the staged diff)
   - PR: `npx -y buzzcut pr <body-file> --title "<title>"` (compares against the base branch; add `--base <branch>` if it isn't main or master)
5. Fix every `✗` line: those are false claims, empty subjects, forms on small diffs, or bloat bad enough to block. Treat `!` lines as advice: apply them unless that would remove real information. Check again until it exits 0, at most 3 rounds. If a finding is wrong for this repo, tell the user instead of bending the text to satisfy it.
   Before you finish, reread your first draft: every number, error message, link, command you ran with its output, and `file:line` in it should still be there unless it was wrong. `buzzcut check` flags any that went missing (`dropped-facts`).
6. Commit with `git commit -F .git/BUZZCUT_MSG`. Open the PR with `gh pr create --title "<title>" --body-file <body-file>`.

If a buzzcut hook blocks `git commit`, `git push` or `gh pr create`, it lists exactly what to fix. Fix those points and run the same command again. Never add `--no-verify` to get past it; that's the user's call, not yours.

If buzzcut can't run at all (no npx, no network), follow the rules below without it.

## Keep the facts, cut the yap

Short means no padding, not fewer facts. A description that's too thin fails the reviewer as badly as one that's padded, and buzzcut's word range is a ceiling, not a target. If keeping a fact puts you over the range, keep the fact. If a big change is mostly facts, a long description is fine: buzzcut gives dense text more room and only blocks padding.

**Carry over what you were given.** The author already told you things a reviewer needs. Go through what you have (the author's notes, the issue, the conversation, an old description) and make sure each of these is in yours, if it's there:

- the issue link with its word: `Closes #12` or `Fixes #12`, not just `#12`
- other PRs and issues they mention, and why (merge this first, a related fix, who asked)
- a question they're asking, feedback they want, or that it's a draft
- what it doesn't do or leaves for later, and what still works as before
- docs, threads and other links they cite, with what each is for
- what they ran and what it showed, "tests pass" included
- an example, expected output or config they gave
- the reason, in their words

What you cut is what's left: restating the title, the file-by-file tour, generic claims, and the boilerplate of a PR template.

**Keep, always:**

- The problem, in a sentence: what was broken or missing and how it showed (the error, the symptom, who hit it). If you know why, it goes in the opening, even on a 6-line change.
- The evidence: numbers and measurements, error messages and log lines (quoted), a spec line the author cited, issue and PR links.
- The names a reviewer needs to find the change (the function, the setting, `comm.c:1028`), and anything they'd copy character for character (a URL, a command, a config value) on its own line or in backticks. A short code block, about 10 lines at most, for the exact YAML, SQL or command that matters is fine; a tour of the code isn't.
- The reasoning that bounds the change: why the fix is enough, what it leaves alone and why, a scope limit the author stated ("this doesn't close #110"), a fallback or kept alias, a risk you know of, and advice for the next person ("if tools never fire, check for inline JSON before suspecting keys").
- What you verified, with its result: every check that ran, not a sample of them. And what you didn't (a module you didn't run, tests that already fail for another reason).

**Cut:** restating the title, the file-by-file tour, generic claims ("improves maintainability", "robust error handling"), form sections on a small change, anything the diff already shows.

**Say exactly what the diff does:**

- Describe the whole diff, not only the part you remember working on. Check the areas and line counts in `buzzcut context`: if an area holding a large share of the lines isn't in your draft (a new module, other commits the branch carries, a dependency upgrade), say what changed there, or say plainly that the branch carries it. A PR titled "Add AGENTS.md" whose diff is mostly a new I2C module misleads the reviewer, however tidy it reads.
- When you list what a change adds or removes, list all of it: a partial list reads as the whole.
- Hold each line against the diff before you finish: every name, number and value is in it; "every" and "all" are true of every file; a thing is placed in the section, table or list it's really in ("clamps production, deadtime and window", not "and temperature" when the temperature clamp lives elsewhere). Don't describe what's inside a file you didn't read.

**Never add what you don't know:**

- No guessed old behavior ("previously it failed silently"), no reason nobody gave ("we had no way to measure X", "so future sessions kept relearning them"), no benefit nobody measured, no verification that didn't happen. Every sentence should be something you saw in the diff, the conversation, or a command's output.
- The diff shows what the code does, never why someone wanted it. Don't turn one into the other: "the helper now retries 429s" is a fact; "to make delivery more reliable" is a motive, and only the session can supply it.

Write in the language the repo's commits and PRs already use (`git log --oneline -10` shows it), or the one the user writes to you in. A team that writes in Russian or Portuguese gets its PR in Russian or Portuguese; never translate it to English.

## PR descriptions

Title: what changed, specific, 72 characters or fewer ("Retry webhook deliveries on 5xx and 429", not "Webhook improvements"). Follow the repo's title style: if its commits or PRs use prefixes (`ci:`, `fix(api):`), so does yours. Plain words, no filler: "Build math.pdf in the docs job", not "…so math.pdf actually compiles". If the PR already has a title that's specific and in the repo's style, keep it.

Updating a description that's already clear (says what and why, true to the diff)? Change only what's missing, usually the why or a fact that was dropped, and keep its structure. Don't restyle a good PR to match this shape.

Body, in this order:

1. **Opening, 1 or 2 sentences: what changed and why.** The why comes from this session: the bug, the error message (quote it), the issue link, who asked for it. Say it in plain words, with no "What:" or "Why:" labels. If the session never says why, say what changed and leave the why out: a guessed reason is worse than none, and buzzcut's "never says why" is advice, not a reason to invent one.
2. **Bullets, 2 to 5 (more on big diffs): the changes a reviewer would ask about.** One change per bullet, about 25 words at most: where to look (the function, setting or endpoint) and the concrete values, old → new, limits, defaults. A bullet that runs past that is two changes or has reasoning in it: split it, and put the reasoning in the opening. Group by area, never file by file. Say which part is mechanical and how many of the lines it is (the counts are in `buzzcut context`; use them, not a percentage).
3. **Optional, one line:** a risk, breaking change, migration or follow-up.
4. **`Tested:`, when something ran.** The commands you ran in this session, or that the author or CI told you ran, and what they returned (`npm test`, 212 passed; "tests pass" from the author's notes counts). Write what you saw, no more: "ran `cargo test`" isn't "`cargo test` passed" unless you saw it pass, and a test plan or a "How to test" list isn't a run. If nothing ran and nobody told you what did, leave testing out: no "Not tested" line, because a reviewer learns nothing from it (CI and review are how an unrun change gets checked). If something a reviewer should look at was never exercised, say so in the risk line (step 3), in plain words. buzzcut reads the session and blocks "tests pass" when nothing ran. Never tick a checkbox you didn't check.

Scale it with the diff (`buzzcut context` says which one this is):

- **Tiny** (under ~30 changed lines): the opening and what you were given that a reviewer needs, then what you ran if you ran something. Bullets only if there are 2 or more separate behavior changes.
- **Normal** (~30 to 300 lines): the opening, 2 to 5 bullets, what you were given that a reviewer needs, then what you ran if you ran something.
- **Big** (300+ lines): the same, and a few short plain headers are fine (Behavior changes / What's mechanical / How to review / Risk). See "Big changes" below.

The diff tells you what changed, where, and the values. Only the session tells you why and what you ran: take those from the conversation and the commands you ran, never from the diff. If the repo has a PR template, fill it in briefly in this shape; buzzcut doesn't count its boilerplate. Prefer this shape over generic "Summary / Changes / Test plan" templates unless the user or the repo asks for one.

## Big changes (refactors, migrations, thousands of lines)

A big diff needs a map, not a tour. `buzzcut context` says where the lines are, which files are tests, generated or only renamed, and what the branch's commits were.

- Open with what changed overall and why now.
- Say what's mechanical (renames, moves, formatting, generated code) and how many lines it is (the counts are in `buzzcut context`), so the reviewer can skim it.
- List the behavior changes that need a real review, one per bullet of about 25 words, each with where to look (the function or area, not every file) and the values. A big diff gets more bullets, not longer ones.
- Say how to review it: an order, or which commits are mechanical if the history is split that way. Then risk, rollback if it matters, and what you ran to verify it.
- Group by area, never file by file.

## Commit messages

- Subject: 72 characters or fewer, no trailing period, imperative ("Add", not "Added") like git's own "Merge branch" and "Revert". Match the repo's style from `buzzcut context`: past tense if the history uses it, conventional prefixes (`fix:`, `feat(api):`) only if the repo uses them, ticket ids if the repo uses them.
- Body only when the why isn't obvious from the subject: 1 to 3 lines on why (what was broken, who needed it, what it unblocks), plus a few plain "- " bullets for a change with several parts. Not a list of every file; the diff has that.
- Plain text. git log doesn't render markdown: no headers, no bold.

## Never

- Claim tests were added unless a test file is in the diff.
- Claim it's faster, more secure, or more maintainable without a number to back it.
- Walk through the files one by one ("Updated `api.ts` to…"). The reviewer already has the diff.
- Open with "This PR introduces…" or close with "Overall, these changes…".
- Emoji headers, bold labels on every bullet, "What:" / "Why:" labels, or words like comprehensive, robust, seamless, leverage, enhance.

## Examples

### A small PR

A 9-line change that retries webhook deliveries to customer endpoints on 5xx and 429.

Bad, 146 words, sent back by buzzcut:

```
## 🚀 Summary
This PR introduces a comprehensive and robust retry mechanism for webhook delivery...
## ✨ Key Changes
- **Retry Logic**: Implemented a robust retry loop in `src/webhook.ts`...
## 🧪 Testing
- [x] Added comprehensive unit tests for retry logic
- [x] All tests pass
```

Good, yap score 0:

```
Retry webhook deliveries on 5xx and 429

Webhook deliveries to customer endpoints fail about 2% of the time with 502s and 503s while their servers restart, and we drop the event. This retries them.

- 5xx and 429 responses retry up to 3 times with backoff (200ms, 400ms, 800ms, plus up to 100ms of jitter), then throw so the job queue picks the event up
- Other 4xx responses still fail right away, since retrying won't help

Tested: `npm test`, plus a local server that returns 503 twice, then 200.
```

Two separate behavior changes, so two bullets. With only one, the opening would say it and there would be no bullets.

### A normal PR

A 140-line change across the orders API, its query and the frontend pager.

```
Page the orders list by cursor so page 2 stops repeating rows

Customers saw the last order of page 1 again at the top of page 2 (#231): the offset query shifts when a new order lands between page loads. The list now pages by a cursor on `created_at`.

- `GET /orders` takes `cursor` instead of `page` and returns `next_cursor` from the last row; `page` still works until 2.4 and logs a deprecation warning
- The query uses `created_at < :cursor` with the new index `orders_created_at_id_idx` (migration 0042), so a page reads 50 rows instead of `offset + 50`
- The frontend pager follows `next_cursor`, and "jump to page N" is gone, since a cursor can't jump

Migration 0042 builds the index concurrently: about 4 minutes on the 12M-row staging table.

Tested: `npm test` (212 passed), and paged through 5 pages of staging orders while creating new ones.
```

### A big change

A 2,400-line refactor across 61 files. A map, not a tour:

```
Move billing into its own payments module

Billing moves into src/payments so the ledger can be tested without the HTTP layer (#812). Most of the diff is mechanical.

### What's mechanical
- 48 files moved from src/billing to src/payments with import updates only: about 1,900 of the 2,400 lines. Review with "hide whitespace".

### Behavior changes
- `Ledger.post()` rejects negative amounts; it used to clamp them to 0
- Refunds over $500 need a second approver; the threshold is `REFUND_REVIEW_LIMIT`
- Webhook retries moved from the controller to `PaymentQueue`, still 3 tries

### How to review
payments/ledger.ts first, then payments/queue.ts. The commits are split: "Move billing" is mechanical, the rest are not.

Rollback is a plain revert; there's no migration.

Tested: `npm test` (1,284 passed), and a $620 staging refund waited for approval.
```

### A commit

Bad, the diff read back as a changelog (sent back by buzzcut):

```
feat: comprehensive security and persistence overhaul

Key Changes:
- Security:
  - Added JwtService with HMAC-SHA256 signing
  - Added JwtAuthenticationFilter to the filter chain
  - Replaced NoOpPasswordEncoder with BCrypt
- Persistence:
  - Added User and Role entities
  - Added UserRepo and StudentRepo
- Testing:
  - Added comprehensive unit tests for all services
```

Good, why first, then the parts a reviewer would question:

```
Replace the stub login with JWT auth and BCrypt passwords

Passwords were stored in plain text (NoOpPasswordEncoder) and every
request was trusted.

- Tokens are HMAC-SHA256, signed with JWT_SECRET, valid 24h
- Student writes need ROLE_ADMIN; reads need ROLE_USER
- An H2 test profile runs the suite without Postgres: mvn test, 14 passed
```
