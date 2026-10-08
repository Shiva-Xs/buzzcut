# Round 3 results: the fixed full tool on a fresh set

37 PRs (12 tiny, 12 normal, 13 big) from 16 repos used nowhere else × two kinds of notes × three arms; Gemini writes and grades (rubric v2, with the diff summary in the packet). 74 graded descriptions per arm.

| arm | mean rank | needed facts kept | PRs missing a fact | unsupported claims (PRs) |
|---|---|---|---|---|
| B0 skill text only | **1.59** | 92% | 10 of 58 | 0 |
| B full tool, after fix 1 | 2.22 | 91% | 12 of 58 | 0 |
| C2 plain prompt | 2.19 | 83% | 20 of 58 | 1 (1) |

Head to head (wins, losses): B0 over B 49–25; B0 over C2 55–19; B against C2 33–41. Big PRs (26 graded per arm): B0 1.31, C2 2.04, B 2.65.

**Fixed:** the facts. B kept 80% of the author's facts on the sealed test set before the fix and 91% here, level with B0 (92%).
**Not fixed:** the writing. Condition by condition (PREREG.md, "Round 3"): rank within 0.15 of B0: no (0.63 behind); facts within 3 points: yes; unsupported PRs within B0's plus 2: yes; B beats C2: no (2.22 against 2.19 and 33–41); big PRs no worse than C2: no (2.65 against 2.04). Two of five.

**Why.** The extra length. On thin notes B wrote more than B0 at every size (median words: tiny 56 against 46, normal 92 against 65, big 102 against 66) and on full-notes big PRs 111 against 91. In my blind read of 19 of the 74 packets B was the one with the file-by-file bullets, the extra "Changes" headings, and two reasons the author never gave ("so Japanese developers can read…", "to improve alignment between slices…") that the grader missed. The context it was given read like a template to fill: five numbered slots, an "Optional" risk slot, and a word figure that looks like a target.

**Audit** (19 of 74 packets, Claude graded blind first): order of the arms agrees on 82% of pairs; facts kept on 119 of 123 decisions; unsupported claims on 55 of 57. Mean ranks, Claude / Gemini: B0 1.47 / 1.58, C2 2.16 / 2.16, B 2.37 / 2.26.

# Round 4: the second fix, on `fresh2` (the shipped tool)

32 PRs (12 tiny, 12 normal, 8 big) from 16 repos, 10 of them new; two kinds of notes; 64 graded descriptions per arm. The context text no longer has numbered slots, an optional risk slot or a word figure.

| arm | mean rank | needed facts kept | PRs missing a fact | unsupported claims (PRs) |
|---|---|---|---|---|
| B0 skill text only | **1.48** | 91% | 11 of 59 | 0 |
| B full tool | 1.86 | 90% | 12 of 59 | 3 (3) |
| C2 plain prompt | 2.66 | 87% | 15 of 59 | 1 (1) |

Head to head (wins, losses): B0 over C2 57–7; B over C2 49–15; B0 over B 40–24. By size, mean rank B0 / B / C2: tiny 1.38 / 1.96 / 2.67; normal 1.58 / 1.71 / 2.71; big (16) 1.50 / 1.94 / 2.56.

## Against the five conditions (PREREG.md, "Round 3")

1. Rank within 0.15 of B0: **no** (0.38 behind).
2. Facts within 3 points of B0: yes (90% against 91%).
3. PRs with an unsupported claim within B0's plus 2: **no** (3 against 0). The three: an invented open question on a thin-notes PR ("Leaves open whether there is an alternate way…") and two "skip type-checking" lines for `--transpile-only`, true of the flag but not in the notes.
4. B beats C2: yes (1.86 against 2.66, 49–15).
5. Big PRs no worse than C2: yes (1.94 against 2.56).

Three of five. The full tool is fixed against the plain prompt and on facts, and not on par with the skill text alone. The pre-registered rule for a miss applies: no more tuning, ship as is, say so in the docs.

## Audit (16 of 64 packets, Claude graded blind first)

Order of the arms agrees on 36 of 48 pairs (75%, bar 70%); facts kept on 120 of 120 decisions; unsupported claims on 48 of 48. Mean ranks, Claude / Gemini: B0 1.50 / 1.38, B 1.81 / 2.00, C2 2.69 / 2.63.

## The three runs side by side (full tool B against the skill text B0 and the plain prompt C2)

| run | B rank | B0 rank | C2 rank | B facts | B0 facts | C2 facts | B over C2 | B0 over B |
|---|---|---|---|---|---|---|---|---|
| sealed test, original tool (70/arm) | 2.76 | 1.84 | 3.09 | 80% | 92% | 89% | 44–26 | 42–28 |
| fresh, fix 1 (74/arm) | 2.22 | 1.59 | 2.19 | 91% | 92% | 83% | 33–41 | 49–25 |
| fresh2, fix 2, shipped (64/arm) | 1.86 | 1.48 | 2.66 | 90% | 91% | 87% | 49–15 | 40–24 |
