feat: make the watch startup sync opt-in with --sync-on-start

Addresses #1268. `cgc watch` on an already-indexed repo synchronized every current file before watching; it now attaches the watcher at once and only processes future file events. The old startup sync stays behind `--sync-on-start`.

- `watch_helper` takes `sync_on_start` (default `False`) and passes it to `watch_directory`; without it the CLI prints "Watching for future changes only" and points to `cgc index --force` or `--sync-on-start`
- `cgc w` gets `--sync-on-start`, and now forwards `--poll` too, which it didn't before
- The shutdown message drops "Graph is up to date", since the default no longer reconciles existing changes
- New tests check that the flag reaches `watch_helper` from `watch` and `w`, and that `watch_directory` gets the matching `sync_on_start`

Not tested: run the two changed test files, and `cgc watch` on an indexed repo with and without the flag.
