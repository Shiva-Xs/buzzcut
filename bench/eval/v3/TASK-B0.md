# Task: write pull request descriptions with a writing skill (ARM = B0)

My message gives you SETS, for example `SETS=devR,devT`. Do the sets in that order.

## Rules

1. First read `skills/buzzcut/SKILL.md` from the section "Keep the facts, cut the yap" to the end. Follow those writing rules exactly. There is no buzzcut program to run in this task: write from the rules alone.
2. For each set, go through the folders `bench/eval/v3/sets/<SET>/pr01`, `pr02`, and so on, in order. You are the engineer who made the change in `diff.txt`. For each PR folder read:
   - `diff.txt`: the change you made (the lines it adds and removes).
   - `notes.md`: your notes from the session, the description you first jotted down. Everything in it is true, and it is all you know about why the change was made and how it was checked. It may be short.
3. Write the description to `bench/eval/v3/out/<SET>/B0/prNN.md`: the title on the first line, a blank line, then the body. Nothing else in the file.
   - Keep every fact from the notes that a reviewer needs, unless the diff contradicts it. Add nothing that isn't in the diff or the notes.
   - The why and the Tested line come only from the notes. If the notes don't say what was run, write "Not tested:" and what should be checked.
   - Write as the author. Never mention "the notes" or "the session" in the PR.
4. Do the PRs one at a time, pr01 upward.

## Don't

- Don't open anything under `src/`, `bench/cache/`, `bench/eval/corpus/`, `bench/eval/planted/`, `bench/eval/threearm/`, `bench/eval/v3/grade/`, `context.txt` in a PR folder, or any `out/` folder other than `out/<SET>/B0/`.
- Don't run `buzzcut` or any checker.
- Don't change any file outside `bench/eval/v3/out/<SET>/B0/`.
- Don't commit anything.

When all the PRs in a set are written, write `bench/eval/v3/out/<SET>/B0/DONE.md` with the number of PRs you wrote.
