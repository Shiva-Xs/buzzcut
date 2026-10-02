# Test results (sealed set, run once on the frozen skill; FROZEN.md)

35 PRs from 11 repos used nowhere else × two kinds of notes (R full, T thin) × five arms, written by Gemini 3.8 Flash, graded by Gemini against a frozen checklist with shuffled letters (rubric v2). 70 graded descriptions per arm.

| arm | mean rank | needed facts kept | PRs missing a fact | unsupported claims (PRs) | testing claims the notes lack |
|---|---|---|---|---|---|
| B0 skill text only | **1.84** | 92% | 10 of 63 | 0 | 0 |
| B skill + context + checker | 2.76 | 80% | 22 of 63 | 8 (8) | 0 |
| C2 plain prompt, testing left out if nothing ran | 3.09 | 89% | 11 of 63 | 0 | 0 |
| D bare prompt | 3.49 | 65% | 34 of 63 | 22 (16) | 0 |
| C plain prompt, "say it wasn't tested" | 3.83 | 94% | 5 of 63 | 2 (2) | 0 |

Head to head (wins, losses): B0 over C2 61–9; B over C2 44–26; B0 over D 54–16; B over D 40–30; B0 over B 42–28; C2 over C 61–9.

By size (mean rank, B0 / B / C2 / D / C): tiny (28) 1.93 / 2.04 / 3.25 / 3.82 / 3.96; normal (28) 1.93 / 2.68 / 3.25 / 3.11 / 4.04; big (14) 1.50 / 4.36 / 2.43 / 3.57 / 3.14.

## Against the bar in PREREG.md

Against the plain prompt C2 (the stricter one):

| condition | B (full tool) | B0 (skill text) |
|---|---|---|
| mean rank at least 0.10 lower | 0.33 lower: met | 1.25 lower: met |
| more PRs won than lost | 44 to 26: met | 61 to 9: met |
| PRs with an unsupported claim no more than C2's (0) | 8: **not met** | 0: met |
| facts kept within 5 points of C2's 89% | 80%: **not met** | 92%: met |

Against the bare prompt D: B is 0.73 lower (needs 0.30) and wins 40 to 30: met.

So the skill's writing rules clear the bar, and the full tool does not. Seven of B's eight unsupported claims are lines such as "about 90% of the diff", which come from `buzzcut context`; the grader saw only the notes and the diff and could not check them. The eighth is a real invented reason ("prevent conflicts between different IDE versions"). Fixing the grader leaves B one unsupported claim against none, still not met. B's fact loss is real and sits mostly on big PRs and long links.

## Audit (25%, 17 of 70 packets, Claude graded blind first)

Order of the arms agrees on 138 of 170 pairs (81%, bar 70%); facts kept agree on 127 of 130 decisions; unsupported claims on 82 of 85. Mean ranks on the audited PRs, Claude / Gemini: B0 1.76 / 1.71, B 2.41 / 3.00, C2 3.24 / 3.29, D 3.53 / 3.00, C 4.06 / 4.00. Gemini was harsher on B than I was, which matches the unsupported "% of the diff" lines. The audited sample held no big PRs, where B did worst, so that part of the result is Gemini's alone.

## Limits

One writer model and one grader of the same family; PR text written by people, not agent sessions; the skill was tuned on the dev set and frozen before this one, and the checker's effect flipped sign between the two sets, so treat it as unknown.
