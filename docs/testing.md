# Testing Jamak

## Default checks

```sh
npm ci
npx playwright install chromium
npm run verify
```

`verify` runs Biome, application and platform-independent type checks, the Chrome build, unit/fixture tests and the controlled-clock caption browser check. It does not establish real model accuracy or native Chrome feature availability. Build output is `apps/chrome/dist`.

## Caption and speaker checks

| Command | Verifies |
| --- | --- |
| `npm run test:captions-stability` | Pending corrections retain text; queued sentences preserve reading order; speaker backgrounds differ without labels; final captions hold at least 4 seconds and fade for 250 ms |
| `npm run test:speakers` | Actual local WeSpeaker embeddings on the synthetic two-voice conversation; downloads model files when uncached |
| `npm run test:conversation` | Serves the ~58-second English conversation at `http://127.0.0.1:8790` for manual extension testing |
| `npm run test:conversation:live` | Production popup → offscreen tab audio → Chrome local recognition/translation → page overlay; final pairing, sentence order, speaker consistency, completion/fade and Stop |
| `npm run test:framework:chrome:overlay` | Extension transport, visible geometry, fullscreen and cleanup |
| `npm run test:framework:chrome:tab-input` | Real action-authorized capture/playback and target lifecycle |

Native recognition/translation checks require compatible desktop Chrome, installed local speech/translation packs, a graphical session, and the official Chrome translation components expected by the harness at `.ralph/media-framework/chrome-translation-components`. They are explicit local checks, not CI prerequisites. Some media fixture regeneration uses macOS `say`/`afconvert`; checked-in synthetic fixtures are available without regeneration.

For a caption bug, first reproduce it with a failing focused check. For audio or model behavior, inspect the actual conversation and run the corresponding real model/browser check. Report synthetic display tests separately from native inference. Do not call a test passed because preparation, mocked text or PCM acquisition succeeded.

Temporary artifacts, model caches and browser profiles are stored under ignored `.ralph/`. Never commit real user recordings or credentials. Existing files in `docs/verification/` are dated evidence; older companion results do not verify current Chrome behavior.
