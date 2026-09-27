refactor(types): annotate youtube-ad-blocker.js so it type-checks

`clean_adblock/youtube-ad-blocker.js` had 3 type-check errors and now has 0, with JSDoc and narrowing rather than changes to the global types.

- `isAdElement` and `hideAd` take `@param {HTMLElement}`; elements from `querySelectorAll` and `closest()` are checked with `instanceof HTMLElement` before `hideAd`
- The `window['YouTubeAdBlocker']` test export goes through an inline JSDoc cast
- One check is narrower at runtime: added mutation nodes were matched on `nodeType === 1` (any element, SVG included) and now must be an `HTMLElement`

Tested: `make precommit` passes.
