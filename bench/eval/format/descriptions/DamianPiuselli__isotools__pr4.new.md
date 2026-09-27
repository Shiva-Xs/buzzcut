Fix the pylint job failing with exit code 28 at a passing score

The pylint job failed even at 8.50/10, the 8.5 threshold: pylint exits with the W/R/C message-category bits (28 here) whenever it finds those messages, and `--fail-under` can only add failure bits, not suppress them. `pylint.yml` now runs pylint with `--exit-zero`, tees the output, and a Python step parses the "rated at" score and fails only below 8.5, or when it can't find a score.

Not tested: the workflow runs on the next push; check it passes at the current score and fails below 8.5.
