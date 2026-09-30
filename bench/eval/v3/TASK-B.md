# Task: write pull request descriptions with a writing skill and its checker (ARM = B)

My message gives you SETS, for example `SETS=devR,devT`. Do the sets in that order.

## Rules

1. First read `skills/buzzcut/SKILL.md` from the section "Keep the facts, cut the yap" to the end. Follow those writing rules exactly.
2. For each set, go through the folders `bench/eval/v3/sets/<SET>/pr01`, `pr02`, and so on, in order. You are the engineer who made the change in `diff.txt`. For each PR folder read three files:
   - `diff.txt`: the change you made (the lines it adds and removes).
   - `notes.md`: your notes from the session, the description you first jotted down. Everything in it is true, and it is all you know about why the change was made and how it was checked. It may be short.
   - `context.txt`: what `buzzcut context` says about this diff (its size, areas, shape and word range).
3. Write the description to `bench/eval/v3/out/<SET>/B/prNN.md`: the title on the first line, a blank line, then the body. Nothing else in the file.
   - Keep every fact from the notes that a reviewer needs, unless the diff contradicts it. Add nothing that isn't in the diff or the notes.
   - The why and anything about how it was checked come only from the notes. Follow the skill for when a Tested line belongs.
   - Write as the author. Never mention "the notes" or "the session" in the PR.
4. Check it: `node bench/eval/v3/check.mjs <SET> B prNN`. Fix every ✗ line. Apply each ! line unless that would remove a fact the reviewer needs. Never add a fact to satisfy a finding. Check again, at most 3 drafts per PR.
5. Do the PRs one at a time, pr01 upward.

## Don't

- Don't open anything under `src/`, `bench/cache/`, `bench/eval/corpus/`, `bench/eval/planted/`, `bench/eval/threearm/`, `bench/eval/v3/grade/`, or any `out/` folder other than `out/<SET>/B/`.
- Don't change any file outside `bench/eval/v3/out/<SET>/B/`.
- Don't commit anything.

When all the PRs in a set are written and checked, write `bench/eval/v3/out/<SET>/B/DONE.md` with one line per PR: its id, the number of drafts, and whether the last check passed.
