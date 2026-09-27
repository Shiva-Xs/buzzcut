test: prove the doctrine command-reference check fires on its own (T224)

T224 asks the docs validator to fail when the doctrine heading or its command reference is removed. The rule shipped in `a667d44`, but the existing test drops the whole section, so it never showed the fragment rule firing on its own. This adds that case: test only, no validator change.

- The new test keeps the `Initialize Or Repair A Doctrine Pack For An Established Workspace` heading in the seeded `docs/workflows.md` and replaces only the step with `Ralphdex: Initialize Doctrine Pack` and `ralphCodex.initializeDoctrinePack`
- It asserts no `missing_heading` issue and a `missing_fragment` issue for each reference, and fails early if the fixture no longer has that line

With this, all four T224 acceptance items are met and T224 can be closed.

Tested: `npm run validate` (1436 tests, 0 fail) and `npm run check:docs` pass.
