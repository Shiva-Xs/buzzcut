feat(ui): wrap the sidebar prompt to 2 lines

The sidebar row's right column (badge, elapsed, meta) is 3 lines tall but the prompt on the left used a single line, leaving space unused. `.u-sub` in `UnitRow.svelte` now clamps the prompt to 2 lines with `-webkit-line-clamp` and `line-clamp`, at `line-height: 1.35`, instead of `nowrap` with an ellipsis. svelte-check reports 0 errors, eslint and prettier are clean, and the 23 UI tests pass.
