# Testing Jamak

## Default checks

```sh
npm ci
npx playwright install chromium
npm run verify
```

`verify` runs Biome, application and platform-independent type checks, the Chrome build, unit/fixture tests and the controlled-clock caption browser check. It does not establish real model accuracy or native Chrome feature availability. Build output is `apps/chrome/dist`.

`node tests/framework-chrome-popup.mjs` verifies popup progress display with mocked background snapshots: reported percentages, indeterminate loading, reopening during preparation and hiding after readiness, plus automatic/manual model-information rows, manual defaults, Japanese native speech preference even on WebGPU, restoring automatic mode, selecting a language disabling detection, and Korean skipping translation probes and SODA installation. It also checks the separate Advanced window, original tab/source forwarding, both selectors, preparation immediately on selection, persistence on reopen, Stop and reset to both Chrome defaults. It does not verify download speed or native model accuracy.

## Model selection checks

`npm run verify` includes all recognition/translation option combinations with mocked worker preparation, native preference/explicit override, selected WASM/WebGPU backend, Korean bypass, disposal and stale-result cancellation. It validates settings and cache identities; these are routing checks, not real model quality.

- `node tests/framework-chrome-model-translation.mjs`: downloads both pinned alternative translation models, executes real WASM English/Japanese → Korean translations on synthetic text, checks source revision pairing, Stop and cache-only reload. Uses an owned regular browser profile; incognito Cache Storage can fail on large files. First downloads total ~1.55 GB.
- `node tests/framework-chrome-model-options.mjs`: actual unpacked extension action → separate Advanced → Tiny q8 / M2M100 q8 → real model downloads → tab capture of the checked-in synthetic English clip → Korean page overlay, persisted selectors, popup model information, switching to Base during a running session while retaining M2M100, a fresh caption session and Stop. Uses an owned Chrome profile and actual action authorization. It does not establish conversational accuracy for every Whisper variant or a latency bound.

Both scripts write ignored evidence under `.ralph/media-framework/`. See [model selection evidence](verification/model-options.md). Existing real acoustic checks continue to verify Chrome defaults; use the explicit selections when comparing models, and report their names/backends with measurements.

## Automatic language checks

`npm run verify` includes mocked regression checks for alternating languages, uncertain-language PCM retention, exact revision pairing, prepared translator reuse, Korean bypass, per-turn boundaries and Stop cancellation. These are behavioral checks, not acoustic accuracy measurements.

`npm run test:auto-language:live` exercises the production popup → offscreen tab capture → real Whisper large-v3-turbo FP16/WebGPU → native TranslateKit → page overlay on `tests/fixtures/multilingual/meeting.wav`. It requires the same official Chrome translation components described below and WebGPU. It checks all six alternating English/Japanese/Korean turns, first words and sentence-content anchors, source-specific translation pairing, Korean bypass, visible captions, Stop and navigation. It downloads the pinned model when uncached; an optional `INTERPRETER_TEST_MODEL_DIRECTORY` can seed the same two SHA-256-verified official ONNX files using the harness's existing test-only provisioning. Do not commit those files.

The checked-in fixture uses Samantha/Kyoko/Yuna synthetic voices; `python3 tests/fixtures/multilingual/generate.py` reproduces it on macOS with those voices installed. Run `npm run test:conversation` for the existing English fixture; to serve the multilingual audio manually, run `python3 -m http.server 8790 --bind 127.0.0.1 --directory tests/fixtures/multilingual`, then open `/meeting.wav` and select automatic mode in Jamak. This verifies tab audio, not microphone capture or simultaneous voice separation. See [measured evidence](verification/asr/automatic-language.md).

## Caption and speaker checks

| Command | Verifies |
| --- | --- |
| `npm run test:captions-stability` | Ready captions appear immediately below earlier captions; visible reading clocks overlap; a narrow-screen burst of 12 rows remains bounded and all rows display before retiring oldest first; corrections, speaker colors, 4-second final holds and 250 ms fades remain correct |
| `npm run test:speakers` | Actual local WeSpeaker embeddings on the synthetic two-voice conversation; downloads model files when uncached |
| `npm run test:conversation` | Serves two-voice conversations at `http://127.0.0.1:8790`: English (~58 s) or Japanese (~76 s, `?language=ja`) |
| `npm run test:conversation:live` | Production popup → offscreen tab audio → Chrome local recognition/translation → page overlay; final pairing, sentence order, speaker consistency, completion/fade and Stop |
| `npm run test:conversation:ja:live` | Production Japanese Chrome local streaming → TranslateKit → overlay; native interim results without Whisper jobs, first source/Korean display timings, CER ≤12%, eight turns' source/Korean content, two speakers, ordered display without replay, completion/fade and Stop; lexical relationship errors are reported separately in `missingKoreanDetails`; local report `.ralph/caption-conversation/live-ja.json` |
| `npm run test:framework:chrome:overlay` | Real extension transport and browser Fullscreen API: selected video/player, shipping whole-tab video and cross-origin embedded video; stacked captions/corrections, visible geometry, pointer passthrough, inline restoration and top-layer cleanup on Stop; caption inputs are synthetic |
| `npm run test:framework:chrome:tab-input` | Real action-authorized capture/playback and target lifecycle |

Native recognition/translation checks require compatible desktop Chrome, installed local speech/translation packs, a graphical session, and the official Chrome translation components expected by the harness at `.ralph/media-framework/chrome-translation-components`. They are explicit local checks, not CI prerequisites. Some media fixture regeneration uses macOS `say`/`afconvert`; checked-in synthetic fixtures are available without regeneration.

The default Japanese conversation check requires Chrome's on-device speech API and Japanese/English/Korean SODA packs, following the same native streaming path as English. To check the Whisper fallback explicitly, run `node tests/framework-chrome-tab-engine.mjs --japanese-conversation --whisper` on WebGPU. To reuse already downloaded official Whisper weights, set `INTERPRETER_TEST_MODEL_DIRECTORY` to a directory containing `interpreter-turbo-encoder-verified.onnx` and `interpreter-turbo-decoder.onnx`; the harness verifies their registered sizes and SHA-256 values before seeding only its disposable extension cache. Other artifacts still use official downloads. A passed content/flow gate does not establish exact Japanese word recognition or perfect translation of kinship, politeness or implied subjects.

The conversation report records media playback state/events and each ASR job's PCM RMS/peak. If text repeats after playback ends, compare playback restarts, job audio ranges and input energy before attributing the repeat to recognition or caption timers. These diagnostics do not change production audio processing.

For a caption bug, first reproduce it with a failing focused check. For audio or model behavior, inspect the actual conversation and run the corresponding real model/browser check. Report synthetic display tests separately from native inference. Do not call a test passed because preparation, mocked text or PCM acquisition succeeded.

Temporary artifacts, model caches and browser profiles are stored under ignored `.ralph/`. Never commit real user recordings or credentials. Existing files in `docs/verification/` are dated evidence; older companion results do not verify current Chrome behavior.
