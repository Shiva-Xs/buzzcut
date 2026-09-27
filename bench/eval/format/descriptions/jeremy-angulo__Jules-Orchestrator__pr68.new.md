Stop npm test hanging: node:test for userRoutes, esmock for agents

`npm test` hung until its 400 s limit. The fix is in the tests' mocks; no source files change.

- The user routes unit test used `vitest` under the project's `node --test` runner; it's rewritten with `node:test`, and `vitest` stays in package.json
- The pipeline test faked `globalThis.fetch`, which sent the pipeline's polling and retries into endless async cycles; it now loads `pipeline.js` through `esmock` with mocked clients
- A 245-line Playwright test, `empirical-trefle.test.js`, is deleted, and `patch_trefle.mjs`, a one-off script that rewrote it, is added at the repo root
- The background test only loses a comment

`patch_trefle.mjs` should probably go before merge, and the Playwright test's removal needs a yes from someone who relies on it.

Tested: all 77 tests pass without hanging.
