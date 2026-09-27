Add a provider-owned quarantine for invalid Claude receipt stores

Related to #280: for the `receipt_store_invalid_or_unavailable` teardown blocker, `/amux-claude` gets `quarantine plan|apply|inspect`, which parks the worker without repairing or cleaning up provider evidence. Its only action is the ordinary `amux worker park --thread <origin>`; core amux stays provider-neutral.

- `plan` is read-only and succeeds only while the lifecycle registry selects a registered receipt store that is missing, invalid or unavailable; it binds hashes of the exact origin, provider `claude`, action `park`, the amux executable and config, one store selector and up to 32 owner-supplied artifacts (each a `0600` regular file of at most 1 MiB), never raw paths or content
- `apply` checks replay state, then sets a permanent quarantine fence in `lifecycle.json` before parking; the fence blocks later launches and ordinary fence release can't remove it, while receipt stores, reports, worktrees and artifacts stay byte-identical
- It fails closed on evidence drift, conflicting replay, malformed metadata, an interrupted park (never retried) and several spellings of one origin; `inspect` takes the plan's operation hash if apply output is lost
- The park runs from a sealed copy of the executable (a write-sealed descriptor on Linux, an immutable private copy on macOS) with a captured config snapshot, never `amux` from `PATH`
- About 1,280 of the lines are `claude_delegation.py`; `store_test.go` adds 270 lines of tests, and the contract and recovery docs describe the route

`authorization_sha256` is an operator-supplied reference, not an authenticated credential, and has no TTL.

Tested: the focused quarantine test, the `/amux-claude` package tests, `go test ./...`, `go vet ./...`, gofmt, a Python compile, `./scripts/build-amux.sh /tmp/amux-issue-280`, `git diff --check` and a privacy scan. The tests use synthetic state and an injected park executor; no real provider or lifecycle action ran.
