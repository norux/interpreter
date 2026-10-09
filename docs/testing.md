# Testing Jamak

## Default checks

```sh
npm ci
npx playwright install chromium
npm run verify
```

`verify` runs Biome, application and platform-independent type checks, the Chrome build, unit/fixture tests and the controlled-clock caption browser check. It does not establish real model accuracy or native Chrome feature availability. Build output is `apps/chrome/dist`.

`node tests/framework-chrome-popup.mjs` verifies popup progress display with mocked background snapshots: reported percentages, indeterminate loading, reopening during preparation and hiding after readiness, plus automatic/manual model-information rows, manual defaults, restoring automatic mode, selecting a language disabling detection, and Korean skipping translation probes and SODA installation. It does not verify download speed or native model accuracy.

## Automatic language checks

`npm run verify` includes mocked regression checks for alternating languages, uncertain-language PCM retention, exact revision pairing, prepared translator reuse, Korean bypass, per-turn boundaries and Stop cancellation. These are behavioral checks, not acoustic accuracy measurements.

`npm run test:auto-language:live` exercises the production popup → offscreen tab capture → real Whisper large-v3-turbo FP16/WebGPU → native TranslateKit → page overlay on `tests/fixtures/multilingual/meeting.wav`. It requires the same official Chrome translation components described below and WebGPU. It checks all six alternating English/Japanese/Korean turns, first words and sentence-content anchors, source-specific translation pairing, Korean bypass, visible captions, Stop and navigation. It downloads the pinned model when uncached; an optional `INTERPRETER_TEST_MODEL_DIRECTORY` can seed the same two SHA-256-verified official ONNX files using the harness's existing test-only provisioning. Do not commit those files.

The checked-in fixture uses Samantha/Kyoko/Yuna synthetic voices; `python3 tests/fixtures/multilingual/generate.py` reproduces it on macOS with those voices installed. Run `npm run test:conversation` for the existing English fixture; to serve the multilingual audio manually, run `python3 -m http.server 8790 --bind 127.0.0.1 --directory tests/fixtures/multilingual`, then open `/meeting.wav` and select automatic mode in Jamak. This verifies tab audio, not microphone capture or simultaneous voice separation. See [measured evidence](verification/asr/automatic-language.md).

## Caption and speaker checks

| Command | Verifies |
| --- | --- |
| `npm run test:captions-stability` | Ready captions appear immediately below earlier captions; visible reading clocks overlap; a narrow-screen burst of 12 rows remains bounded and all rows display before retiring oldest first; corrections, speaker colors, 4-second final holds and 250 ms fades remain correct |
| `npm run test:speakers` | Actual local WeSpeaker embeddings on the synthetic two-voice conversation; downloads model files when uncached |
| `npm run test:conversation` | Serves the ~58-second English conversation at `http://127.0.0.1:8790` for manual extension testing |
| `npm run test:conversation:live` | Production popup → offscreen tab audio → Chrome local recognition/translation → page overlay; final pairing, sentence order, speaker consistency, completion/fade and Stop |
| `npm run test:framework:chrome:overlay` | Extension transport, visible geometry, fullscreen and cleanup |
| `npm run test:framework:chrome:tab-input` | Real action-authorized capture/playback and target lifecycle |

Native recognition/translation checks require compatible desktop Chrome, installed local speech/translation packs, a graphical session, and the official Chrome translation components expected by the harness at `.ralph/media-framework/chrome-translation-components`. They are explicit local checks, not CI prerequisites. Some media fixture regeneration uses macOS `say`/`afconvert`; checked-in synthetic fixtures are available without regeneration.

For a caption bug, first reproduce it with a failing focused check. For audio or model behavior, inspect the actual conversation and run the corresponding real model/browser check. Report synthetic display tests separately from native inference. Do not call a test passed because preparation, mocked text or PCM acquisition succeeded.

Temporary artifacts, model caches and browser profiles are stored under ignored `.ralph/`. Never commit real user recordings or credentials. Existing files in `docs/verification/` are dated evidence; older companion results do not verify current Chrome behavior.
