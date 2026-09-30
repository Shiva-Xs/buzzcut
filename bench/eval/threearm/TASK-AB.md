# Task: write 24 pull request descriptions (ARM = A or B, as I tell you)

You are testing a writing skill. For each folder `bench/eval/threearm/prs/pr01` … `pr24`, you are the engineer who made the change in `diff.txt`, writing its pull request description for the reviewer. Your arm letter (A or B) is in my message; use it wherever this file says ARM.

## Rules

1. First read `skills/buzzcut/SKILL.md` from the section "Keep the facts, cut the yap" to the end. Follow those writing rules exactly.
2. For each PR folder, read three files:
   - `diff.txt`: the change you made (the lines it adds and removes).
   - `notes.md`: your notes from the session, the description you first jotted down. Everything in it is true, and it is all you know about why the change was made and how it was checked.
   - `context.txt`: what `buzzcut context` says about this diff (its size, areas, shape and word range).
3. Write the description to `bench/eval/threearm/out/ARM/prNN.md`: the title on the first line, a blank line, then the body. Nothing else in the file.
   - Keep every fact from the notes that a reviewer needs, unless the diff contradicts it. Add nothing that isn't in the diff or the notes.
   - The why and the Tested line come only from the notes. If the notes don't say what was run, write "Not tested:" and what should be checked.
   - Write as the author. Never mention "the notes" or "the session" in the PR.
4. Check it: `node bench/eval/threearm/check.mjs ARM prNN`. Fix every ✗ line. Apply each ! line unless that would remove a fact the reviewer needs. Never add a fact to satisfy a finding. Check again, at most 3 drafts per PR.
5. Do the PRs one at a time, pr01 to pr24.

## Don't

- Don't open anything under `src/`, `bench/cache/`, `bench/eval/corpus/`, `bench/eval/planted/`, `bench/eval/threearm/old/`, or any `out/` folder that isn't your own arm's.
- Don't change any file outside `bench/eval/threearm/out/ARM/`.
- Don't commit anything.

When all 24 are written and checked, write `bench/eval/threearm/out/ARM/DONE.md` with one line per PR: its id, the number of drafts, and whether the last check passed.
