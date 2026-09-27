fix(container): start the podman socket on Linux when it isn't running

On Linux the podman API socket only exists when systemd socket activation or Podman Desktop provides it, so without either Kaiden had no socket to connect to. `PodmanSocketLinuxFinder` now starts `podman system service --time=0` when the rootless socket is missing, as Podman Desktop does.

- `findPaths` spawns the service once (later polls don't spawn again) and waits up to 5 s (50 × 100 ms) for the socket; if it never appears it logs an error and returns what it found, which may be the rootful socket
- Under Flatpak (`FLATPAK_ID` set) it runs `flatpak-spawn --host podman system service --time=0`
- `dispose()`, marked `@preDestroy()`, kills the spawned process when the extension deactivates
- The spec moves the no-socket cases to fake timers and adds cases for spawning, Flatpak, dispose and no second spawn

Tested: the unit tests, 11 passing. Not tested on a real machine: on Linux without Podman Desktop, check that Kaiden finds podman containers, that the service exits with Kaiden, and that repeated polls don't start a second one.
