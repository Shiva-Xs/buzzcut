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
