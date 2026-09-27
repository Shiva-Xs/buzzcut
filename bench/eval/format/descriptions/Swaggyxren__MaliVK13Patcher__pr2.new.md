Fix APK install on Android 16, add launcher icon, Linux build, new UIs

A user reported the v1.0.0 APK won't install on Android 16 and has no launcher icon. The adaptive icon used `@android:color/...` as drawables, which newer resource parsers reject, the most likely cause, and the SDK was 34. The branch fixes that and carries 15 more commits: new APK and Windows UIs, a Linux build and CI fixes. It supersedes #1, whose branch no longer accepts pushes.

### Android 16 install
- Real vector drawables for the launcher icon (background `#0E0E10`, a white "V" foreground, and a monochrome layer for themed icons), referenced from both adaptive icon XMLs
- `compileSdk` and `targetSdk` 34 → 35, `versionCode` 1 → 2, `versionName` 0.1.0 → 1.0.1, and v1+v2+v3 signing on the debug keystore

### UIs and packing
- The APK's `MainActivity` (about 660 lines) and the Windows `gui.py` (about 480) are rewritten with dark and light themes and advanced pack options; the APK adds a settings dialog, credits and status-bar insets
- `core/patcher.py` takes `PackOptions` (EROFS compression and level, fixed timestamp); the defaults keep lz4hc level 9

### Builds and CI
- New Linux target: a PyInstaller spec and a `build-linux` job that uploads the binary and attaches it to releases; the README covers its usage
- CI finds `libGLES_mali.so` and `build.prop` by glob and copies whichever `app-release*.apk` AGP produced; the APK build adds the kotlinx.serialization plugin and fixes the `jniLibs` path

Not tested: check CI's `build-apk`, install the APK on an Android 16 device and check the icon and themed icons, then patch a real `vendor.img` end to end.
