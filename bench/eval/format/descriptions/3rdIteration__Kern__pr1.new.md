Add CrowPanel 10.1" support, per-board CI firmware and a web flasher

Adds the Elecrow CrowPanel Advanced 10.1" ESP32-P4 as a fourth board, `crowpanel_101`, and makes CI build and publish firmware for every board, with a browser flasher on GitHub Pages.

### Board support
- New `crowpanel_101` BSP: 1024x600 MIPI DSI panel (EK79007, 2 lanes at 900 Mbps), GT911 touch, I2C on GPIO 45/46, PWM backlight on GPIO 31, and a second LDO channel (4, 3.3 V) that the panel needs besides the DSI PHY's
- `KERN_BOARD_CROWPANEL_101` in Kconfig and `sdkconfig.defaults.crowpanel_101`; the simulator and `just clean` know the board

### CI and flashing
- The build job is a matrix over `wave_4b`, `wave_35`, `wave_5` and `crowpanel_101` and uploads each board's flashable files as `firmware-<board>` (kept 30 days); `scripts/ci-checks.sh` builds all four for each commit
- On pushes to `master`, `deploy-flasher` publishes `flasher/index.html` with the four builds to GitHub Pages: an esptool-js 0.6.0 page for Chrome and Edge that flashes the latest build or a downloaded zip
- `actions/download-artifact` is pinned to v4.1.3 (arbitrary file write in >= 4.0.0, < 4.1.3); `test-each-commit` marks the workspace a safe directory; push builds run only on `master`, so a PR isn't built twice
- The README lists the board, the flasher and how to flash CI artifacts, with a warning not to use them as a signer for real funds

The deploy needs Pages set to GitHub Actions in the repo settings.

Not tested: check the four matrix builds, and flash `crowpanel_101` on the board.
