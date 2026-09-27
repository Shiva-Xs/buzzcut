Show a branded splash on cold start and init NewPipe off the main thread

Cold launch showed a black screen for 2 to 3 s: the activity theme's `windowBackground` was transparent, so the window had nothing to draw until Compose's first frame. The app now shows a splash from the moment the icon is tapped, and `NewPipe.init` no longer runs on the main thread.

- MainActivity starts on a new `Theme.Lisney.Starting` from `androidx.core:core-splashscreen` 1.0.1: brand blue `#3B82F6` with the launcher's music-note glyph, then `Theme.Lisney`; a backport drawable gives the same look on API 24 to 30
- `installSplashScreen()` keeps the splash up until the first composition sets `keepSplash = false`, and `Theme.Lisney`'s background goes from transparent to white, so nothing flashes black in between
- `NewPipe.init` (20 to 50 ms, per the code comment) moves from `Application.onCreate` to a `GlobalScope` coroutine on `Dispatchers.IO` that completes a `CompletableDeferred`
- `searchSongs`, `getStreamInfo` and `relatedSongs` in `NewPipeRepo` call `LisneyApp.awaitNewPipe()` first, so no extractor call runs before init

Tested: `./gradlew :app:assembleDebug`, BUILD SUCCESSFUL in 1m 52s, no new warnings. Not tested on a device: kill the app, tap the icon, and check the blue card shows with no black frame, then search and play a song right after launch.
