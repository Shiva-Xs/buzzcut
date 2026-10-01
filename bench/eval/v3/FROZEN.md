# Frozen for the test run

The skill and the checker are fixed from this point. A change to any of them means a fresh test pool, since this one will have been seen.

- Commit: `fec476dcf83c01818214ca94b27bbc73a0e13d2b` (branch `v0.3`)
- `src/` tree: `8c83ff6d3eb70b31bb3af673a96b035ebdd631f1`
- `skills/buzzcut/SKILL.md` sha256 starts `17466764afab378899db4a4f`
- Test list: `manifest-test.json` sha256 starts `ec1cf97290008c4d`, drawn from `pool.json` (sha256 in that file) before anything in it was read
- Test sets were rebuilt after the freeze so their `context.txt` files carry the frozen wording; the list of PRs did not change
- Arms: D, C, C2, B0, B. Writer and grader: Gemini 3.8 Flash in Antigravity. Grader rubric v2. Audit: 25% by Claude, blind
- Pass bar: PREREG.md ("Pass and fail"), against C2 and C, whichever is stricter
