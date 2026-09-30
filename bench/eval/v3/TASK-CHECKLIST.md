# Task: list what a reviewer needs from each PR's notes

My message gives you SETS, for example `SETS=devR,devT`. Do the sets in that order.

For each set, go through the folders `bench/eval/v3/sets/<SET>/pr01`, `pr02`, and so on. Read `notes.md` (the author's own text about the change) and `diff.txt` (what the change did). Nothing else.

Write `bench/eval/v3/grade/<SET>/checklist/prNN.json`: a JSON array of the facts in `notes.md` that a reviewer of this change would need, each one short (under 20 words) and standing on its own. Take only what the notes say; don't add anything from the diff or from what you think is good practice.

Count as needed facts, when the notes have them:
- why the change was made, in the author's words
- the issue it closes (`Closes #12` / `Fixes #12`), and other PRs or issues it names, with why
- a question the author asks, feedback they want, or that it's a draft
- what it doesn't do, leaves for later, or what still works as before
- an example, expected output, or config the author gave
- how it was tested, or that it wasn't, if the notes say
- a number, error message, version or command that matters

Skip greetings, template headings, ticked checklists, thank-yous and anything a reviewer would learn from the diff anyway. If the notes hold no needed facts, write `[]`. At most 8 facts.

Format: `["fact one", "fact two"]`. Nothing else in the file.

## Don't

- Don't open anything else in this repository (not `skills/`, `src/`, `bench/cache/`, `bench/eval/v3/out/`, other folders).
- Don't change any file outside `bench/eval/v3/grade/<SET>/checklist/`.
- Don't commit anything.

When a set is done, write `bench/eval/v3/grade/<SET>/checklist/DONE.md` with the number of files written.
