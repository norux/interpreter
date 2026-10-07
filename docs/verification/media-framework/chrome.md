# Chrome stage — B1 preparation and B2 ASR evaluation

2026-10-06. Commit: the `feat: add browser model preparation host` commit containing
this report. The original B1 blocker was resolved on 2026-10-07 as recorded below;
no B2–B6 or whole-framework/iPhone completion is claimed. Neither this report nor successful model construction replaces ASR,
translation, selected-video caption, or physical-device acceptance.

## Implementation and boundary

Added a foreground document preparation host in `apps/chrome/preparation.html`,
a dedicated module worker, a version-1 validated command/status boundary, and a
`ModelRepository` implementation in `packages/engines-browser`. Preparation requires
actual document user activation and a visible secure document. Stop invalidates
the request synchronously and terminates only the owned worker. Hidden/pagehide
handlers terminate residency; a fresh explicit Prepare is required on return.
The original hidden-document blocker and its verified resolution are recorded below.

The repository separates absent/evicted, downloading, cached, loading, ready and
failed states. It downloads registered immutable URLs without credentials, bounds
each response to the declared file size, verifies downloaded ONNX SHA-256 values,
checks storage estimates, handles offline absence and cache-write failure, and
disposes late loader completions after cancellation. Cache metadata alone never
sets ready: the actual Transformers.js encoder/decoder pipeline must resolve.
Explicit eviction removes only this candidate's cache. Cached metadata is not an
integrity/accuracy guarantee; the corrupt-tokenizer check demonstrates that a
cached file can still fail loading. No silent backend/model/cloud fallback exists.

`build:chrome:preparation` builds a separate document/worker bundle. Its ONNX WASM
and JS factory are packaged locally. The large packaged WASM binary is also kept
in the owned Cache API store and supplied as bytes when a new worker loads offline;
small packaged executable assets are HTTP-cached by the local acceptance fixture.
This proves offline reload in that fixture, **not extension installation/update**.
The full standalone extension/manifest and selected-video composition belong to B4.
Core, released companion v0.1.0, existing manifest/native messaging, installation
paths, server protocol and user settings were not changed.

## Exact candidate and environment

| Property | Observed/selected value |
| --- | --- |
| OS/architecture | Darwin arm64 |
| Node/npm | v24.15.0 / 11.12.1 |
| uv/Python | 0.12.23 / 3.12.15 |
| Browser | Playwright-owned Chromium 153.0.8010.12; headless attempts 1–8, headed attempts 9–10 |
| Execution | Dedicated worker, WASM, q8, one WASM thread; no WebGPU inference claim |
| Library | `@huggingface/transformers` 4.3.0 (exact dependency/lock) |
| ONNX runtime | 1.31.0-dev.20260914-8d85527a0 (dependency lock) |
| Candidate | `onnx-community/whisper-tiny` multilingual, **not the chosen default** |
| Immutable model revision | `ff4177021cc41f7db950912b73ea4fdf7d01d8e7` |
| Model preparation download | Seven model files, 43,613,734 bytes per fresh successful inventory/download |
| q8 encoder | 10,124,990 bytes; SHA-256 `2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19` |
| q8 merged decoder | 30,719,241 bytes; SHA-256 `25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3` |
| Other required model files | config 2,243; generation config 3,772; tokenizer 2,480,466; tokenizer config 282,683; preprocessor config 339 bytes |
| Additional active packaged WASM | `ort-wasm-simd-threaded.jsep.wasm`, 28,352,885 bytes; model progress excludes runtime storage |
| Additional emitted runtime asset | Dependency bundle also emits asyncify WASM (26,861.77 kB); it is not the explicitly selected runtime |

Downloads occurred inside test-owned browser contexts; repeated fresh attempts use
the same candidate only. Model bytes, browser profiles and temporary test outputs
are not committed. Pipeline loading durations below include download/preparation;
they are **not transcription latency**. Memory, model operators during recognition,
transcription error and sustained processing remain unmeasured.

Primary sources consulted: [model conversion card](https://huggingface.co/onnx-community/whisper-tiny),
[pinned model metadata](https://huggingface.co/api/models/onnx-community/whisper-tiny?blobs=true),
[Transformers.js environment configuration](https://huggingface.co/docs/transformers.js/api/env),
[4.3.0 release](https://github.com/huggingface/transformers.js/releases/tag/4.3.0),
[base Whisper MIT license](https://github.com/openai/whisper/blob/main/LICENSE).
The conversion card links the base model but has no separate license field;
conversion/distribution licensing must be resolved as part of B2 evaluation.
Installed library source confirms that v4's pipeline inventory reads config at
`main` before applying the requested revision. The cache adapter maps that lookup
only to this registered pinned candidate's already-downloaded files. It never
downloads a mutable `main` resource.

## Command evidence

Evidence files are ignored local `.ralph/media-framework/` logs, not committed
state. The observations below are copied here so the report remains useful without
those local logs. Required acceptance failures are preserved.

| Command / evidence | Actual result |
| --- | --- |
| Final `npm run verify`, `chrome-1-final-verify.log` | **PASS**, exit 0. Biome 94 files/72 ms/no findings; Ruff/typecheck; companion main 28 modules/43 ms, content 10 modules/6 ms; JS 82 passed/0 failed/0 skipped/0 cancelled, 17,060.406333 ms; Python 222 passed/66.90 s. |
| Earlier `npm run verify`, `chrome-1-verify.log` | **PASS**, exit 0. JS 77 passed/0 failed, 16,703.907958 ms; Python 222 passed/66.96 s; preceded addition of the five repository port tests. |
| `node --import tsx --test tests/framework-browser-model.test.ts`, `chrome-1-model-port.log` | **PASS**, exit 0, 5 passed/0 failed/0 skipped/0 cancelled, 100.058417 ms. Fake cache metadata/loader only: late cancellation disposal, parallel-operation rejection, eviction ownership, offline/quota failure, unregistered model rejection. Also included in final verify and preparation attempts 9–10. |
| `npm run test:framework:chrome:preparation`, final `chrome-1-preparation-attempt-10.log` | **FAIL/BLOCKED**, exit 1. Typecheck, 5 port tests and separate bundle pass. Actual loading/offline/cancellation/corruption checks below pass; native document-hidden assertion times out at 10,000 ms. Eviction/disposal/UI assertions following it are **not reached** in the browser harness. |
| `npm run test:framework:chrome`, `chrome-1-stage-acceptance.log` | **FAIL**, exit 1, `Missing script: "test:framework:chrome"`. B5's full real-video → ASR → translation → DOM harness is not implemented. The preparation command is deliberately distinct and does not substitute for full stage acceptance. |
| Final targeted Biome (9 files), typecheck and `git diff --check` | **PASS**, exit 0. Staged whitespace and post-commit cleanliness also checked. |
| `npm audit --json`, `chrome-1-final-npm-audit.json` | **PASS**, exit 0, zero vulnerabilities. |

### Failures discovered and corrected

All preparation invocations used the same command above; each returned exit 1.
These implementation/fixture failures are distinguished from the final environment
blocker. Assertions were kept; none was replaced with a fabricated success.

| Local log / command | Failure and response |
| --- | --- |
| First `npm exec vite build -- --config vite.chrome.config.ts` | Package export disallowed ORT WASM asset path. Changed to explicit installed local asset imports; bundle then passed. |
| First `npm run typecheck && npm run build:chrome:preparation` | TS2345 model-identity narrowing and TS2590 pipeline union complexity. Constructed the narrowed identity and specified the ASR pipeline generic. Subsequent typecheck/build passed. |
| First targeted Biome | Three missing button-type errors and six non-null assertion warnings. Added explicit button types and typed known HTML elements. Later port-test lint caught one implicit-any local; added the ModelStatus type. Final lint has no findings. |
| Dependency installation / `chrome-1-npm-audit.json` | Initial pinned library 3.8.1 brought 6 audited vulnerabilities (4 moderate, 2 high). Switched this new dependency to current exact 4.3.0; install and final audit report zero. This is not an unrelated dependency upgrade. |
| `chrome-1-preparation-attempt-1.log` | Activation assertion used Playwright `page.evaluate`, which grants activation; it therefore reached model loading rather than rejecting. Moved the no-activation call into the document's initial module script. |
| `chrome-1-preparation-attempt-2.log` | Seven model files cached; pipeline configuration rejected local-only loading with local models disabled. Corrected library flags, keeping remote runtime/model fetching disabled during load. |
| `chrome-1-preparation-attempt-3.log` | Still failed load: inventory's config lookup used unversioned `main`, missing the pinned cache. Installed source supplied new evidence; restricted inventory lookup to the pinned registered files. |
| `chrome-1-preparation-attempt-4.log` | Real ready in 9,972.561959 ms; remote-path assertion rejected legitimate Hub artifact redirects. |
| `chrome-1-preparation-attempt-5.log` | Recorded exact public redirect paths: pinned Hub API resolve-cache and `us.aws.cdn.hf.co` Xet storage. Updated the allowlist for those artifact redirects, retained exact seven pinned primary requests and ONNX checksums. No remote executable/inference endpoint is allowed. |
| `chrome-1-preparation-attempt-6.log` | Ready in 8,998.676792 ms; Stop during actual cached load passed, then offline worker restart failed fetching local script. Added immutable caching to packaged test assets. |
| `chrome-1-preparation-attempt-7.log` | Ready in 12,186.783834 ms; offline pipeline still failed because large WASM was not HTTP-cached. Error explicitly named local packaged WASM. Added owned Cache API runtime bytes, preserving actual offline assertions. |
| `chrome-1-preparation-attempt-8.log` | Headless: ready in 10,567.22025 ms; offline ready in 530.97025 ms; corrupt-tokenizer rejection passed. Timed out waiting for native hidden-document state. This is the first independent suspension-blocker attempt. |
| `chrome-1-preparation-attempt-9.log` | Headed execution retained recent activation across reload, so repeating the negative activation check in every module initialization started a conflicting preparation. Scoped that check to the first explicitly requested test URL. |
| `chrome-1-preparation-attempt-10.log` | Headed: ready in 9,756.306834 ms; offline ready in 534.1752089999991 ms; actual late-load Stop and corrupt-cache rejection passed. Same 10,000 ms hidden-document timeout: second independent suspension-blocker attempt. |

### Actual browser observations before the blocker

The final headed run independently observed all of the following with the real
production worker and model files, without companion/Ollama integration:

- Initial script invocation without active user gesture rejected. Actual button
  clicks start preparation synchronously in the document.
- Offline first run returned failed/`offline-model-unavailable`.
- Injected first-download transport error returned failed/`download-required` and
  did not report ready. This fault is injected, not a spontaneous network outage.
- Double Start was rejected while the model download was held. Stop rejected that
  operation with `Preparation stopped`; no later ready or status revival appeared.
- Real q8 WASM encoder/decoder pipeline reached ready after downloading exactly
  43,613,734 model bytes. Observed distinct states were absent → downloading →
  cached → loading → ready; all seven primary requests used the pinned revision.
- Stop while the actual cached pipeline was loading prevented a late ready.
- A fresh worker loaded the cached model and packaged runtime with browser offline
  mode enabled, no remote requests and no downloading status.
- Same-length invalid cached tokenizer JSON still reported cached metadata, but
  real pipeline preparation failed/`model-load-failed` with no ready. Restoring the
  original response allowed actual readiness again.

No PCM was supplied to ASR, no text was transcribed, no translation was performed,
and no caption accuracy/display claim follows from these loading checks.

## Blocker, unverified scope and resume condition

The following is the historical 2026-10-06 blocker; the 2026-10-07 investigation
below supersedes its unknown cause and resume condition.

**BLOCKED:** this local automated Chromium environment has not delivered the native
hidden/visible transition required by the document lifetime assertion. Attempts 8
(headless) and 10 (headed) independently timed out after actual model/offline
checks passed. Stop retrying this blocker without new evidence.

Two explicit local, test-owned browser diagnostics provided these observations:

- `chrome-1-visibility-diagnostic.log`: two `context.newPage()` pages and a second
  tab opened by an actual fixture button both reported `["visible", "visible"]`.
  Read-only `Browser.getWindowForTarget` showed the same test window ID for both
  pages (22540416), so separate windows did not explain the outcome.
- `chrome-1-visibility-native-flags.log`: a new headed test browser excluding
  Playwright's background-occlusion, renderer-backgrounding and timer-throttling
  disable flags still reported `["visible", "visible"]`. Those flags were applied
  only to the owned diagnostic browser, not user apps/settings/profiles.

The cause remains unknown. No permission/access-denial error was returned, and no
user browser, alternate user profile or profile configuration was accessed to
manufacture a passing hidden state. A synthetic event would test a different
scope and cannot complete this actual document-lifetime assertion.

**Resume condition:** provide a permitted real Chromium execution environment
where switching the foreground tab produces observable native hidden/visible
document transitions, or new evidence identifying the missing host behavior.
Then rerun `npm run test:framework:chrome:preparation`, retaining the visibility
assertion and executing the currently unreached real eviction/disposal/preparation
UI checks. Keep B1 unchecked until all its evidence passes.

Unverified: actual hidden/suspension cleanup and recovery, browser eviction and
production preparation UI assertions after the blocker, extension installation/
permissions/CSP, real selected-video PCM → ASR accuracy, default candidate choice,
WebGPU execution/GPU loss, Japanese/English comparison, Chrome Translator → Korean,
revision/display integration, offline end-to-end interpretation, ten-minute
backlog/loss/memory measurements, B6 quality and Safari/iPhone. Fake repository
quota/cancellation/eviction tests are not browser storage-pressure evidence.

No root/nested AGENTS.md, prior chrome report or requested
`2026-10-06T13-26-17-022Z-chrome-verification.txt` existed. The supplied Agent Core,
plan and full architecture were read. No runner changes, checkbox completions,
stage advance, agents, push/publish/app installation or user app/recording/mount
changes occurred. Credentials, weights, user audio/transcripts and `.ralph` state
are excluded from the commit.

## 2026-10-07 — native visibility blocker resolved

The cause was Playwright's default `Emulation.setFocusEmulationEnabled(true)`.
The installed Playwright 1.63.0 source enables it for every page. Chromium's
[browser-side handler](https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/emulation_handler.cc)
holds a per-session capture handle with `stay_hidden=false`. Sending `false`
through a separate CDP session changes renderer focus but cannot release the
original session's capture handle. Removing browser startup flags also cannot
remove that session override.

A controlled test with the same Chromium 153.0.8010.12, an owned temporary
profile and the same background tab observed native `hidden`, then `visible`
when enabling this override, then `hidden` when disabling it on the same CDP
session. Bringing that tab forward restored native `visible`. No document
property override or synthetic visibility event was used.

The acceptance harness now starts the bundled Chromium in its own temporary
profile and attaches to its default context with the documented
[`noDefaults: true`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).
This prevents focus emulation from being installed. It preserves the original
10-second hidden/visible assertions and cleans up the owned browser/profile.

The first corrected browser run passed native suspension/recovery, then exposed
a previously unreached eviction failure: `status()` reopened the deleted model
cache. A regression assertion failed before the fix. Status now checks whether
the cache exists before opening it; the same assertion passes, and the actual
browser confirms that eviction leaves no candidate cache.

PASS: `npm run test:framework:chrome:preparation`, exit 0; typecheck, five port
tests, separate build and all eleven real browser checks, including native
hidden/visible lifecycle, eviction, disposal and production preparation UI.
First real preparation took 9,408.123458 ms; fresh-worker offline preparation
took 623.665 ms. All 43,613,734 pinned model bytes were prepared, and page errors
were `[]`. Evidence: ignored `chrome-focus-fix-preparation-final.log`; the first
eviction failure and failing port regression are recorded in
`chrome-focus-fix-preparation.log` and `chrome-focus-fix-eviction-regression.log`.
Loading durations are not transcription latency. B2–B6 and Safari/iPhone remain
unimplemented/unverified; the full `test:framework:chrome` script is still absent.

PASS: `npm run verify`, exit 0; Biome 94 files/no findings, Ruff, typecheck,
build, 82 JS tests and 222 Python tests (66.92 s). Final whitespace checks pass.
Evidence: ignored `chrome-focus-fix-verify.log`. B1 is now checked in the plan;
the next unfinished item is B2. No automatic loop restart or later-stage work
was performed during this investigation.

## 2026-10-07 — B2 bounded ASR candidate comparison (iteration 1/5)

Commit: the `feat: evaluate browser ASR candidates` commit containing this section.
**B2 remains unchecked; no default is selected.** B1 remains complete. This work
implements a bounded utterance executor and comparison harness, not B3–B6, a
streaming/VAD `SpeechRecognizer` composition, or standalone selected-video captions.

### Implementation and exact evaluation scope

Added an ASR document host and dedicated worker using the existing pinned model
repository. The repository now explicitly selects one registered candidate and
keeps each candidate's cache/identity separate. The shared loader serves both B1
preparation and B2 recognition without changing B1's default preparation candidate.
No dependency versions, core contracts, companion v0.1.0, published installation,
existing manifest/native messaging, server protocol or user settings changed.

Each job carries session/target/epoch, utterance, language and audio range. The
boundary accepts only finite mono Float32 PCM at the declared 16 kHz rate, 0.1–30
seconds, with a matching duration and a bounded, exclusively transferred buffer.
The host snapshots metadata before transfer. One active preparation/inference is
allowed; further admission rejects `overloaded` and retains the rejected PCM.
Stop invalidates the request and terminates only the owned worker, so backend
inference need not support cooperative cancellation. Suspension also stops this
host. A failed/lost GPU cannot silently select WASM, another model or a server.
Results are final source revision 1, with no invented confidence or partial speech.
Streaming segmentation, resampling of live input, VAD and gap handling are not
implemented by this complete-utterance interface.

`test:framework:chrome:asr` loads actual production workers and model files in a
headed, test-owned Chromium 153.0.8010.12 on Darwin arm64, with the same
`connectOverCDP(..., { noDefaults: true })` lifetime arrangement as B1. It verifies
the existing synthetic fixture hashes, decodes their real VP8/Opus video audio,
and resamples one speech period with `OfflineAudioContext` to 16 kHz. Japanese
input is 111,556 samples/6.97225 s; English is 106,664 samples/6.6665 s. The
6500/9000 Hz source-isolation tags and failing sentences were not removed.
**These samples are decoded fixture audio, not the production selected-video
capture stream.** No microphone, user recording/transcript, companion, Ollama,
translation or caption DOM supplies an expected answer. This is real recognition
accuracy on two synthetic speech periods, not B5 end-to-end or B6 release quality.

Both candidates use the exact existing Transformers.js 4.3.0 and locked ORT
1.31.0-dev.20260914-8d85527a0, q8, one WASM thread, `task: transcribe`, explicit
Japanese/English and a 256-token bound. These are existing Whisper checkpoints;
newer model candidates have not been compared or presumed worse.

| Candidate | Immutable revision | Fresh seven-file model inventory |
| --- | --- | --- |
| `onnx-community/whisper-tiny` | `ff4177021cc41f7db950912b73ea4fdf7d01d8e7` | 43,613,734 bytes |
| `onnx-community/whisper-base` | `1846881b6b3a3024392c1eea3ad983695bc23925` | 79,664,191 bytes |

Base's q8 encoder is 23,201,314 bytes, SHA-256
`5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46`;
merged decoder is 53,693,315 bytes, SHA-256
`fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b`.
Its remaining files are config 2,243; generation config 3,832; tokenizer 2,480,466;
tokenizer config 282,682; preprocessor config 339 bytes. Both model ONNX checksums
are verified during download. Models download once per fresh candidate cache;
WebGPU subsequently uses the same model cache. There were six comparison invocations using only these candidates: four
prepared both models, and two cancellation-observer attempts stopped after tiny
WASM (as recorded below). No model bytes/profiles are committed.

WebGPU uses the locally packaged asyncify runtime: WASM 26,861,777 bytes and
factory 53,057 bytes. WASM execution retains B1's jsep runtime (28,352,885 bytes).
The chosen runtime bytes are cached separately from model download progress.
[The pinned base conversion card](https://huggingface.co/onnx-community/whisper-base/blob/1846881b6b3a3024392c1eea3ad983695bc23925/README.md)
identifies the base checkpoint and ONNX format but has no separate license field.
[Base Whisper uses MIT](https://github.com/openai/whisper/blob/main/LICENSE);
conversion/distribution license confirmation remains unfinished before a default
or distribution decision. [Transformers.js WebGPU documentation](https://huggingface.co/docs/transformers.js/guides/webgpu)
was consulted; actual runtime support is established by the runs below, not by
that documentation alone.

### Final actual recognition measurements

Evidence: ignored final `chrome-b2-asr-final-invocation.log`. Inference duration is measured
inside one worker clock; host round trip is measured separately inside one document
clock, after PCM resampling. Preparation duration includes download/load when
needed and is **not** transcription latency. Each table entry is one measured
utterance, not a latency percentile or sustained throughput qualification.

| Candidate / backend | Preparation ms | Japanese inference / host round trip ms | English inference / host round trip ms | Japanese CER | English WER | Browser-tree peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| tiny / WASM | 8826.730167 | 1114.100 / 1116.500 | 949.800 / 951.200 | 9/40 = 22.5% **FAIL** | 1/22 = 4.54545% | 2,506,656 |
| tiny / WebGPU | 724.548792 | 1527.300 / 1528.800 | 1013.900 / 1015.100 | 8/40 = 20% | 1/22 = 4.54545% | 2,959,952 |
| base / WASM | 12111.494292 | 2298.700 / 2300.200 | 2070.400 / 2071.800 | 7/40 = 17.5% | 1/22 = 4.54545% | 3,375,680 |
| base / WebGPU | 872.480333 | 2430.500 / 2432.000 | 2032.700 / 2033.900 | 7/40 = 17.5% | 1/22 = 4.54545% | 3,444,816 |

Real-time factors (Japanese/English) were tiny WASM 0.159791/0.142474;
tiny WebGPU 0.219054/0.152089;
base WASM 0.329693/0.310568;
base WebGPU 0.348596/0.304913. These complete-utterance factors do not include
waiting for segmentation, live queue backlog, translation or presentation.

RSS is the sum for only the owned Chromium process tree, sampled every 250 ms
with `ps`, including browser/renderers/GPU process. Baseline was 1,280,640 KiB.
Modes execute sequentially; allocator residency and shared pages affect later
peaks. Shared pages can be counted twice. This is process-footprint evidence,
**not isolated model allocation, GPU memory, JS heap, a leak test or phone memory**.

The comparison gate was set before running: NFKC/lowercase, punctuation/symbol
removal and collapsed whitespace; Japanese character edit distance excluding
spaces and English word edit distance, each <= 0.2. It remains unchanged and
fails the harness on tiny WASM Japanese. Numeric spellings are not normalized;
the English `three` → `3` accounts for its one word edit in every mode.
Japanese semantic problems also remain: tiny WASM changes `午後` to `5号` and
`予約` to `4月`; tiny WebGPU changes `駅` to `液`; both base modes change `会議`
to `海里` and `予約` to `ようやく`. A lower CER alone does not establish correct
negation/time/cancellation meaning. These failures are preserved; no default is
chosen on this evidence. Korean translation accuracy is unverified.

### Lifecycle, failures and command evidence

All four final modes completed real Japanese/English inference, transferred PCM
ownership, preserved session/target/epoch/range/language/source revision, rejected
a second job as `overloaded`, retained its PCM, and rejected the active operation
on Stop. Fresh cached WASM workers recognized speech again after Stop. Both GPU
modes were prepared again, then the **actual runtime-created GPUDevice** was
destroyed in the owned worker; recognition subsequently returned `gpu-lost` and
the host terminated its worker without fallback. The test instruments
`GPUAdapter.requestDevice` only in its owned worker to obtain that actual device;
GPU loss is not a mock notification. The final Stop check additionally observes
the production pipeline invocation while its host promise is still pending, via a
separate test-owned MessagePort and an owned worker handler wrapper. It asserts
`ASR stopped` rather than accepting an already completed result; kernel-level
interruption/cooperative backend cancellation is not claimed. Native GPU probes reported `apple` /
`metal-3` adapters in both document and worker. Final page errors and per-mode
preparation console errors were empty.

| Command / local evidence | Actual outcome |
| --- | --- |
| `npm run test:framework:chrome:asr`, attempts 1 and 2 | **FAIL**, exit 1. Both WASM candidates transcribed, cancelled, rejected overload and restarted. Both GPU loads failed; tiny WASM CER also failed. Attempt 2 captured `no available backend found ... [webgpu] TypeError: O(...).webgpuInit is not a function`. |
| Same command, first complete attempt 3 after the runtime fix | **FAIL**, exit 1. Typecheck, 7 port/transport tests (0 failed/skipped/cancelled, 58.288875 ms), build, all four actual inference/lifecycle modes, GPU loss and network/identity assertions completed. Sole final failure: tiny WASM Japanese CER 0.225 > 0.2. |
| `node --import tsx --test tests/framework-browser-asr.test.ts` | Initial GPU-reason regression failed: expected `gpu-lost`, got `ASR stopped`. Fixed error rejection to preserve its reason. Additional regressions in `chrome-b2-boundary-regression.log` failed for an oversized backing-buffer view and old-worker loss invalidating a replacement; both same assertions pass after the fixes (2 passed/0 failed, 67.256166 ms). Fake worker/transport only, not recognition evidence. |
| First ad hoc `node --input-type=module` GPU probe, `chrome-b2-gpu-capability.log` | **FAIL**, exit 1. Worker response did not finish; ending only this owned diagnostic browser produced `page.evaluate: Target page, context or browser has been closed`. This was not evidence of GPU absence. |
| `node .ralph/media-framework/gpu-probe.mjs`, corrected capability log | **PASS**, exit 0. Plain adapter fields instead of a native GPUAdapterInfo object, bounded 10-second wait; actual document/worker adapters both present, vendor `apple`, architecture `metal-3`, including shader-f16. No inference performed by this diagnostic. |
| `npm run test:framework:chrome:preparation`, final `chrome-b2-final-preparation.log` | **PASS**, exit 0. Typecheck, 5 port tests/build, all 11 actual B1 checks including native visibility, Stop, corruption, offline restart, eviction/disposal/UI. First preparation 8795.821042 ms; offline restart 561.781833 ms; page errors `[]`. Earlier regression run also passed (27708.398834 / 573.786417 ms). |
| `npm run verify`, initial `chrome-b2-verify.log` | **PASS**, exit 0. Biome 100 files/no findings, Ruff/typecheck/build, JS 84 passed/0 failed, 14816.921750 ms; Python 222 passed/66.86 s. Precedes final boundary/runtime changes. |
| `npm run verify`, final `chrome-b2-final-verify.log` | **PASS**, exit 0. Biome 100 files/no findings, Ruff/typecheck/build, JS 84 passed/0 failed/0 skipped/cancelled, 14501.676542 ms; Python 222 passed/66.93 s. Final targeted lint also validates the subsequently tightened browser harness. |
| `npm run test:framework:chrome`, `chrome-b2-stage-acceptance.log` | **FAIL**, exit 1, `Missing script: "test:framework:chrome"`. B5's required full selected-video ASR → translation → DOM acceptance remains unimplemented; the B2 command does not replace it. |
| Tightened `npm run test:framework:chrome:asr` observer runs, `chrome-b2-asr-final.log` and `chrome-b2-asr-final-port.log` | **FAIL**, exit 1. Tiny WASM transcribed both languages, but the observer reached Stop after a completed result (`unexpected result` instead of `ASR stopped`). The later modes were not reached in these two attempts. Observer scheduling was then diagnosed independently and corrected without changing this assertion. |
| `node .ralph/media-framework/worker-probe.mjs`, `chrome-b2-worker-observer.log` | **PASS**, exit 0; synthetic scheduling diagnosis only, not ASR evidence. A second message listener observed `called → completed → observer`; wrapping the original handler observed `called → observer → completed`. |
| Final invocation-observed ASR command, `chrome-b2-asr-final-invocation.log` | **FAIL**, exit 1. Typecheck, 7 port/transport tests (0 failed/skipped/cancelled, 57.821667 ms), build, all four real inference modes, invocation-observed pending Stop/overload, cached WASM restart, actual GPU loss, identity/network assertions completed; page errors `[]`. Sole final failure remains tiny WASM Japanese CER 0.225 > 0.2. |
| Targeted Biome, typecheck and whitespace | **PASS**, exit 0; no findings. Final staged/commit cleanliness is checked before delivery. |

The GPU failure was an implementation error, not missing browser permission or
hardware. New capability evidence and the captured error justified investigation
rather than repeating blind attempts. Installed ORT `dist/ort.webgpu.mjs` selects
`ort-wasm-simd-threaded.asyncify.mjs` and calls `webgpuInit`. The jsep factory had
only `jsepInit`. The loader now selects the matching local asyncify WASM/factory
for explicit WebGPU, retaining jsep for WASM; the exact same models/fixtures/gates
then complete real GPU inference. No browser flag, profile setting or access
restriction was changed to manufacture success.

The two stricter observer failures were test timing faults. Browser callback
cleanup drains microtasks before a subsequent event listener can run, as described
by the [HTML script cleanup algorithm](https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script).
The independent owned-worker scheduling probe above confirmed that order. New
evidence justified replacing the later listener with a wrapper that calls the
original production handler, then signals through its separate test port before
returning to the browser. This changes only observation timing; it preserves real
PCM/model execution, the pending-operation Stop assertion and the accuracy gate.
No production state was exported solely for tests.

### Next unfinished B2 work

Improve the preserved Japanese failures and compare an accurately qualified
candidate/profile before selecting a default. Keep the existing numerical gate
and failing fixtures. Record distribution licensing, repeatable memory/latency
and broader recognition evidence as needed; no whole-framework/iPhone claim is
made. Long boundary-spanning utterances, silence/VAD, live capture/resampling,
stream queues/gaps, sustained GPU recovery/memory, Korean translation, offline
interpretation, ten-minute playback/backlog/loss and B3–B6 remain unverified.
**No required environment/device/permission blocker remains in this iteration.**

No root/nested AGENTS.md or requested independent runner file
`2026-10-06T20-26-37-190Z-chrome-verification.txt` exists. Supplied instructions,
plan, architecture and prior Chrome report were read. No agents, runner changes,
stage advancement, push/publish/app installation or changes to unrelated files,
user apps/recordings/mounted images/browser settings occurred. Only owned test
browsers/profiles were closed; credentials, weights, user audio/transcripts and
`.ralph` state are excluded from the commit. No additional checkbox is checked.

## 2026-10-07 — B2 larger candidate and repeatability (iteration 2/5)

Commit: the `feat: compare larger browser ASR candidate` commit containing this
section. **B2 remains unchecked and no default is selected.** This iteration
extends only B2's bounded utterance comparison. It preserves B1's preparation
candidate, all earlier candidates/fixtures, the <= 0.2 CER/WER gate, and the
existing pending Stop, overload, restart and actual GPU-loss assertions.

### Candidate and compatibility evidence

Registered `onnx-community/whisper-small` at immutable revision
`36050c46d777d46dc4b5f43f6d90574fc38f8732`, with the same q8 loader/runtime,
16 kHz input, explicit language/transcribe task and 256-token bound as tiny/base.
Its seven-file inventory is **251,846,613 bytes** per fresh model cache:
config 2,227; generation config 3,893; tokenizer 2,480,466; tokenizer config
282,683; preprocessor config 339; encoder 92,326,160; merged decoder 156,750,845.
Encoder SHA-256 is
`a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92`;
decoder SHA-256 is
`ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9`.
The repository verifies these hashes during the actual download. The existing
candidate-owned cache and transport are reused; no new model-selection setting,
fallback or server route was added.

The [conversion card](https://huggingface.co/onnx-community/whisper-small)
identifies the OpenAI small checkpoint and Transformers.js-compatible ONNX.
The [Hub metadata](https://huggingface.co/api/models/onnx-community/whisper-small?blobs=true)
supplied the pinned identity, sizes and ONNX hashes above. Its card metadata has
no separate license field. [Upstream Whisper's MIT license](https://github.com/openai/whisper/blob/main/LICENSE)
is documented; conversion/distribution license confirmation remains unverified.
A web-reader request for the pinned README returned an accessibility error; it
was not treated as licensing evidence.

The 2026 [Qwen3-ASR release](https://github.com/QwenLM/Qwen3-ASR) and
[technical report](https://arxiv.org/abs/2601.21337) were considered. The official
release supports Japanese/English and is Apache-2.0; the authors' throughput
numbers do not describe this browser. Public Hub inventory inspection returned
no `.onnx` files for `Qwen/Qwen3-ASR-0.6B` revision
`5eb144179a02acc5e5ba31e748d22b0cf3e303b0` or its newer native-Transformers variant
`Qwen/Qwen3-ASR-0.6B-hf` revision
`7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c` (both HTTP 200, Apache-2.0 metadata).
`rg -n 'qwen3_asr|Qwen3ASR' node_modules/@huggingface/transformers/src node_modules/@huggingface/transformers/types`
returned no matches in installed 4.3.0. This is a compatibility gap for the
current loader, not evidence that no third-party browser conversion can exist,
or that Qwen is less accurate. No Qwen weights were downloaded or browser
operator/accuracy claim made. Existing MLX/Ollama weights were not reused.

### Actual browser evidence

Environment: Darwin arm64; Node v24.15.0/npm 11.12.1;
uv 0.12.23/Python 3.12.15; test-owned headed Chromium 153.0.8010.12.
The unchanged VP8/Opus fixtures are hash-checked, decoded and resampled with
OfflineAudioContext: Japanese 111,556 samples/6.97225 s, English 106,664
samples/6.6665 s. Isolation tags and every failing sentence remain. This is
actual transcription of decoded synthetic fixture audio, **not production
selected-video capture, translation or caption DOM acceptance**.

First single-trial comparison: `npm run test:framework:chrome:asr`, exit 1,
ignored `chrome-2-small-asr.log`. Typecheck, seven port tests (7 passed,
0 failed/skipped/cancelled, 99.278041 ms), build, all six real candidate/backend
modes, lifecycle/identity/transfer/network assertions completed; page errors
`[]`. Sole final failure: tiny/WASM Japanese CER 9/40 = 22.5% > 20%.
Small's actual results were:

| Backend | Preparation ms | Japanese inference / host round trip ms | English inference / host round trip ms | Japanese CER | English WER | Owned browser-tree peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| WASM | 28724.436416 | 7998.300 / 8000.600 | 7678.100 / 7679.700 | 1/40 = 2.5% | 1/22 = 4.54545% | 3,015,664 |
| WebGPU | 1277.629667 | 7601.900 / 7603.300 | 7104.100 / 7105.600 | 1/40 = 2.5% | 1/22 = 4.54545% | 3,520,400 |

Small preserved the tested meeting negation, tomorrow/afternoon/three/station,
and reservation non-cancellation meaning. Its only normalized Japanese edit is
`三` → `3`; English also retains `three` → `3`. Numeric normalization was not
added. Small's first-run real-time factors were WASM 1.147162/1.151744 and WebGPU
1.090308/1.065642 (Japanese/English). **Both were slower than the supplied speech
periods**, before segmentation, translation or display overhead. This improved
accuracy does not demonstrate a sustainable live default. Tiny's 午後/駅/予約
and base's 会議/予約 semantic errors remain; the failed baseline is not discarded.

The final harness repeats each preserved utterance three times per mode, records
trial identity and a pre-preparation RSS baseline, and applies every original
accuracy/metadata assertion to every trial. `npm run test:framework:chrome:asr`
with this final code returned **exit 1**, ignored `chrome-2-small-asr-repeat.log`.
Typecheck, seven port tests (7 passed/0 failed/skipped/cancelled, 60.067125 ms),
build and all **36 scored real utterances** completed. Each language/mode returned
the same text in its three trials. The only final failures were tiny/WASM
Japanese trials 1, 2 and 3, each 9/40 = 22.5%. No failed candidate/trial was
removed or accepted by changing the gate. No further ASR attempt was made.

Ranges below are the observed minimum–maximum of three trials, rounded to
0.001 ms; they are not population percentiles. Preparation includes fresh model
download/load for WASM and cached model load for the later WebGPU mode.

| Candidate / backend | Preparation ms | Japanese inference / host round trip range ms | English inference / host round trip range ms | Japanese CER (all trials) | English WER (all trials) | Mode baseline / peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| tiny / wasm | 8857.796 | 1013.200–1113.000 / 1014.300–1115.600 | 968.700–969.300 / 969.900–970.400 | 22.5% | 4.54545% | 1,305,648 / 2,593,296 |
| tiny / webgpu | 689.740 | 1150.500–1530.700 / 1151.700–1532.100 | 1009.000–1050.500 / 1010.100–1051.600 | 20% | 4.54545% | 2,869,968 / 3,485,360 |
| base / wasm | 11585.844 | 2211.400–2336.400 / 2212.700–2338.500 | 2102.900–2105.800 / 2103.900–2106.900 | 17.5% | 4.54545% | 2,934,896 / 3,323,664 |
| base / webgpu | 924.871 | 2314.900–2465.700 / 2316.400–2467.100 | 2048.100–2066.200 / 2049.400–2067.300 | 17.5% | 4.54545% | 2,986,576 / 3,324,160 |
| small / wasm | 28937.740 | 7869.900–8040.800 / 7871.100–8042.500 | 7698.900–7702.400 / 7700.200–7703.500 | 2.5% | 4.54545% | 2,924,080 / 3,408,480 |
| small / webgpu | 1256.319 | 7446.000–7665.100 / 7447.400–7666.500 | 7055.900–7067.400 / 7057.300–7068.800 | 2.5% | 4.54545% | 3,333,472 / 3,518,976 |

The overall browser-tree baseline was 1,303,792 KiB. RSS samples occur every
250 ms and sum only the owned Chromium process tree (browser, renderers, GPU
process). Each mode's baseline precedes preparation; its peak covers preparation
and scored inference before the Stop/restart tests. Shared pages can be counted
twice, allocator residency carries over, and sequential modes can release prior
allocations. These are neither isolated model/GPU allocations nor a leak test,
physical-memory limit or phone qualification. Inference and round trip use their
respective worker/document clocks without subtracting different clock origins.

Small remained slower than the speech in every repeat: WASM real-time factors
Japanese 1.128746–1.153258 / English 1.154864–1.155389; WebGPU Japanese
1.067948–1.099373 / English 1.058411–1.060137. Faster warm tiny/base trials did
not improve their normalized accuracy or preserved semantic errors.

All six final modes transferred bounded PCM, preserved identity/epoch/range/
source revision, rejected overload while retaining its 111,556 samples, and
returned `ASR stopped` after observing actual pipeline invocation with the host
operation still pending. Post-Stop recognition stayed not ready. Each WASM mode
prepared a fresh cached worker and recognized actual speech after Stop. Each
WebGPU mode prepared again, destroyed the actual runtime-created GPUDevice, and
returned `gpu-lost` without fallback. Final page errors and per-mode preparation
console errors were `[]`; the pinned-model/network assertion passed. These are
real model/worker checks, not mock GPU loss or kernel-level cooperative cancel.
Two comparison invocations prepared all three candidates; each fresh context
downloaded the small inventory once, then reused it for GPU. Models and owned
profiles are not committed; only owned test browsers/profiles were cleaned up.

### Acceptance, remaining work and boundaries

PASS: `npm run verify`, exit 0, ignored `chrome-2-verify.log`: Biome
100 files/47 ms/no findings, Ruff, typecheck, existing companion build,
84 JavaScript tests passed/0 failed/skipped/cancelled (15,385.631042 ms),
222 Python tests passed (66.98 s). This verifies repository regressions, not
B2 recognition accuracy or later-stage interpretation.

FAIL: `npm run test:framework:chrome`, exit 1, ignored
`chrome-2-stage-acceptance.log`: `Missing script: "test:framework:chrome"`.
B5's required full selected-video PCM → ASR → Korean translation → DOM
acceptance is still unimplemented. The ASR/preparation commands do not replace it.
PASS: targeted Biome for the three changed source/test files, exit 0,
3 files/no findings (`chrome-2-targeted-lint.log`). Whitespace and committed-tree
cleanliness are checked before delivery.

PASS: `npm run test:framework:chrome:preparation`, exit 0, ignored
`chrome-2-preparation.log`: typecheck, five repository port tests/build and all
eleven actual B1 browser checks, including native visibility/explicit restart,
Stop, offline reload, corrupt-cache rejection, eviction/disposal and production
preparation UI. The original tiny candidate still prepares all 43,613,734 model
bytes; first preparation was 8,831.710167 ms and fresh-worker offline preparation
577.712625 ms. These are load times, not ASR latency. Page errors were `[]`.
Console output includes the deliberately induced offline/download/corrupt-cache
failures and a favicon 404; no empty-console claim is made for this fault suite.

Next unfinished item is still **B2**: qualify a profile that preserves the tested
Japanese meaning and sustains processing on this host, preserve the failed
baseline and gates, resolve distribution licensing and select a default only
with passing evidence. No required environment/device/permission blocker was
observed. The slower small results are a measured performance limitation;
repeating the unchanged accuracy failure again is not the next step.
Unverified: long/boundary-spanning speech and VAD, silence/gap handling, streaming
SpeechRecognizer composition/live selected-video resampling, sustained queue/GPU
recovery/memory limits, broader recognition quality and model licensing, B3–B6
translation/revision/display/offline end-to-end/ten-minute acceptance, external
sites/extension installation and all Safari/iPhone behavior. Two synthetic
utterances and three repeat trials cannot establish these outcomes.

No AGENTS.md or requested independent runner failure file
`2026-10-06T20-26-37-190Z-chrome-verification.txt` exists. Supplied instructions,
plan, architecture and prior Chrome evidence were read. All changes are confined
to this worktree. Published companion v0.1.0, install/native messaging/server
paths, user settings, unrelated files and user apps/recordings/mounted images
remain unchanged. No runner edits, agents, checkbox completion, stage advance,
push/publish or app installation occurred. Credentials, model weights, user
audio/transcripts and temporary `.ralph` state are excluded from the commit.

## 2026-10-07 — B2 FP16 WebGPU profile (iteration 3/5)

Commit: the `feat: compare FP16 browser ASR profile` commit containing this
section. **B2 remains unchecked; no default is selected.** Only the next
unfinished Chrome item, B2, was extended. All tiny/base/small q8 modes, fixture
hashes and isolation tags, three trials, the <= 0.2 CER/WER gate, pending Stop,
overload, cached restart and actual GPU-loss assertions remain in the harness.

### Profile identity, compatibility and ownership

Registered an explicit small FP16 WebGPU profile at the same immutable model
ID/revision as small q8: `onnx-community/whisper-small`,
`36050c46d777d46dc4b5f43f6d90574fc38f8732`. The registry, repository and loader
now carry the selected precision; existing callers still select q8. Each precision
has its own cache. Port checks establish that preparing/evicting FP16 leaves q8's
cached state intact. These checks use fake metadata/loaders, not real recognition.
The host rejects FP16/WASM before starting a worker; the worker rejects that pair
before downloading, and the loader also checks it. FP16/WASM is **not qualified**.
There is no automatic model/backend/server fallback or new user setting.

The seven-file FP16 model inventory is **487,960,440 bytes**: config 2,227;
generation config 3,893; tokenizer 2,480,466; tokenizer config 282,683;
preprocessor config 339; encoder 176,607,756; merged decoder 308,583,076.
Encoder SHA-256:
`5549cd8666ff4b694ceb128bfa48b95bdcceec29075cf2c2212f90002cc058de`;
decoder SHA-256:
`22aba6c7f5193701cbe1519051b6ef097eb530ad6887b7093065ec59b830f61d`.
Actual downloads verify both ONNX hashes. Required model bytes exclude the
unchanged locally packaged asyncify runtime, separately cached for this profile.
The final run fetched both `_fp16.onnx` files at the pinned revision, reached real
pipeline readiness with all 487,960,440 bytes, and then performed inference.

Primary sources: [Transformers.js dtype documentation](https://huggingface.co/docs/transformers.js/guides/dtypes)
describes explicit precision selection and Whisper's sensitivity to quantization;
[pinned Hub inventory](https://huggingface.co/api/models/onnx-community/whisper-small/revision/36050c46d777d46dc4b5f43f6d90574fc38f8732?blobs=true)
provided the sizes/hashes. The web reader could not open the pinned inventory/card;
ordinary public metadata retrieval with Python returned the exact pinned SHA,
FP16 LFS sizes/hashes and `base_model: openai/whisper-small` /
`library_name: transformers.js`, with no license field. Installed 4.3.0
`src/models/session.js` and `src/utils/dtypes.js` confirm explicit `_fp16` selection
and a WebGPU `shader-f16` check. Actual operator execution is evidenced by the
run, not assumed from docs; exclusive GPU execution of every operator is not
claimed. The earlier upstream Whisper MIT evidence remains, but separate
conversion/distribution licensing confirmation is **unverified**. The previous
2026 Qwen3-ASR compatibility assessment is not changed by this precision trial.

### Actual measurements and accuracy

Environment: Darwin arm64, Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15, owned headed Chromium 153.0.8010.12,
unchanged Transformers.js 4.3.0/locked ORT runtime. The same hash-checked
synthetic VP8/Opus fixtures were decoded/resampled to 16 kHz: Japanese
111,556 samples/6.97225 s; English 106,664 samples/6.6665 s. This is real ASR
on **decoded fixture audio**, not live selected-video capture or Korean captions.
Repository verification/preparation ran after these inference measurements.

Final evidence: ignored `chrome-3-fp16-asr-second.log`. All **42 scored
utterances** completed (seven modes × two languages × three trials). Text was
identical across each language/mode's three trials. Values below are observed
minimum–maximum, rounded to 0.001 ms, not percentiles. Preparation includes fresh
download/load for q8 WASM and FP16 WebGPU; q8 WebGPU uses its preceding cache.
Worker inference and host round trip use their own clocks independently.

| Profile / backend | Preparation ms | Japanese inference / host round trip range ms | English inference / host round trip range ms | Japanese CER, all trials | English WER, all trials | Baseline / peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| tiny q8 / WASM | 9167.202 | 983.700–1101.400 / 984.800–1103.600 | 939.600–941.600 / 940.600–942.600 | 22.5% **FAIL** | 4.54545% | 1,295,520 / 2,616,112 |
| tiny q8 / WebGPU | 728.507 | 1116.600–1533.000 / 1117.700–1534.500 | 981.700–992.100 / 982.800–993.100 | 20% | 4.54545% | 2,296,672 / 2,909,488 |
| base q8 / WASM | 11674.676 | 2185.600–2305.300 / 2186.800–2307.100 | 2078.300–2083.400 / 2079.500–2084.500 | 17.5% | 4.54545% | 2,735,408 / 3,433,712 |
| base q8 / WebGPU | 934.705 | 2293.900–2439.200 / 2295.100–2440.500 | 2047.300–2051.700 / 2048.400–2053.100 | 17.5% | 4.54545% | 2,860,240 / 3,462,912 |
| small q8 / WASM | 29030.340 | 7825.000–7962.700 / 7826.600–7964.600 | 7674.800–7679.200 / 7676.100–7680.300 | 2.5% | 4.54545% | 2,802,912 / 3,245,984 |
| small q8 / WebGPU | 1245.034 | 7367.800–7568.200 / 7369.300–7569.700 | 7023.500–7075.200 / 7024.800–7076.600 | 2.5% | 4.54545% | 2,759,760 / 3,711,872 |
| small FP16 / WebGPU | 58487.164 | 726.400–1386.300 / 727.600–1388.300 | 616.900–633.800 / 617.800–634.800 | 2.5% | 4.54545% | 2,400,928 / 3,501,280 |

FP16 preserved the tested meeting negation, tomorrow/afternoon/three/station and
reservation non-cancellation meaning. Its only normalized Japanese edit remains
`三` → `3`; English remains `three` → `3`. Numeric normalization was not added.
Tiny/base's previously reported Japanese meaning errors remain. A baseline was
not dropped to produce a passing comparison. FP16 real-time factors were
Japanese 0.104184–0.198831 and English 0.092537–0.095072; its first Japanese trial
was 1386.300 ms, followed by 726.400/727.300 ms. Small q8 remained slower than
speech: WASM Japanese 1.122306–1.142056 / English 1.151249–1.151909;
WebGPU Japanese 1.056732–1.085475 / English 1.053551–1.061307. FP16 is promising
for further desktop qualification, **not evidence of sustained streaming**.

Overall RSS baseline was 1,277,184 KiB. Only the owned Chromium process tree is
summed every 250 ms, including browser/renderers/GPU process. Mode peaks cover
preparation and scored inference before Stop/restart. Shared pages can be counted
twice and allocator residency can carry over or be released between modes.
These are not isolated model/GPU allocations, a leak test or phone limits.

All seven modes passed bounded transfer and identity/epoch/range/revision checks,
rejected overload while retaining 111,556 caller samples, and returned `ASR stopped`
after observing real pipeline invocation while the host operation was pending.
Cached WASM workers recognized speech after Stop; GPU profiles prepared a fresh
cached worker and returned `gpu-lost` after destruction of the actual
runtime-created device. No fallback or kernel-level cooperative cancel is claimed.
All mode preparation console errors and final page errors were `[]`; pinned-model
network assertions passed. Final native visibility event lists were empty and
the final document was `visible`.

### Interruption and observation changes

First `npm run test:framework:chrome:asr` returned **exit 1**, ignored
`chrome-3-fp16-asr.log`. Typecheck, eight port tests (8 passed/0 failed/skipped/
cancelled, 80.7315 ms), build and all 24 tiny/base scored utterances/lifecycle
checks completed. Small WASM preparation then timed out at **240,000 ms**;
small inference, small GPU, FP16 and final network/page-error assertions were
not reached. A read-only local CDP snapshot of that owned test document observed
`prepared: false`, `prepareError: ASR stopped`, last state `downloading`,
9,355,814/251,846,613 bytes. Its browser closed before a follow-up visibility
snapshot, so the exact reason for Stop and the missed predicate remains unknown.
This is a failed attempt, not successful preparation or FP16 evidence.

The harness now records native visibility events and error-time document/model
state, brings the owned tab natively to the foreground before each mode and
asserts `document.visibilityState === visible`, and polls preparation every
100 ms rather than relying on animation frames. Both 240-second initial and
120-second restart timeouts and all success/failure assertions are preserved.
No property override, synthetic visibility event, focus emulation, permission
change, alternate user profile or browser-access workaround was used. The one
independent second attempt completed every mode without any native visibility
event. The interruption did not recur; its root cause is **unverified**. No third
ASR attempt was made.

### Acceptance, remaining work and boundaries

| Command / evidence | Actual result |
| --- | --- |
| Initial `npm run typecheck && node --import tsx --test tests/framework-browser-model.test.ts tests/framework-browser-asr.test.ts` | **FAIL**, exit 1; typecheck passed, 7 tests passed/1 failed, 100.5415 ms. New test's inventory total was mistyped as 487,957,440; the authoritative file sizes sum to 487,960,440. Corrected that expected total; precision isolation and the existing numerical recognition gate were not relaxed. |
| Final `npm run test:framework:chrome:asr`, `chrome-3-fp16-asr-second.log` | **FAIL**, exit 1. Typecheck, eight port tests (8 passed/0 failed/skipped/cancelled, 59.307834 ms), build, all 42 scored utterances and lifecycle/transport/network assertions completed. Only final failures: tiny/WASM Japanese trials 1–3 each 9/40 = 22.5% > 20%. No further ASR retry. |
| `npm run test:framework:chrome:preparation`, `chrome-3-preparation.log` | **PASS**, exit 0. Typecheck, six repository port tests (0 failed/skipped/cancelled, 56.79475 ms), build, all eleven real B1 checks including native visibility/explicit restart, Stop, offline, corruption, eviction/disposal/UI. Tiny q8 inventory remains 43,613,734 bytes; initial preparation 9011.317166 ms, offline fresh-worker preparation 539.234084 ms, page errors `[]`. Expected injected fault console errors and a favicon 404 remain visible. |
| `npm run verify`, `chrome-3-verify.log` | **PASS**, exit 0. Biome 100 files/44 ms/no findings, Ruff, typecheck, existing companion build, 85 JS tests passed/0 failed/skipped/cancelled (14889.341209 ms); 222 Python tests passed (66.96 s). Repository regressions, not recognition quality or end-to-end captions. |
| `npm run test:framework:chrome`, `chrome-3-stage-acceptance.log` | **FAIL**, exit 1: `Missing script: "test:framework:chrome"`. B5's full selected-video PCM → ASR → Korean translation → DOM harness is still unimplemented; no preparation/ASR substitute or placeholder was added. |
| Final targeted Biome | **PASS**, exit 0, 11 files/20 ms/no findings. Full verify also lints the final source. |
| Final unstaged/staged whitespace and post-commit status | Checked before delivery; no whitespace errors or uncommitted intended changes. |

Next unfinished item remains **B2**: qualify the FP16 desktop profile with bounded
streaming/gap/queue evidence and distribution licensing before choosing a default.
The failed baselines and gates remain. Broader speech/boundary/silence/VAD quality,
live selected-video resampling/SpeechRecognizer composition, sustained GPU
recovery/memory limits, B3–B6 translation/revision/DOM/offline end-to-end/ten-minute
acceptance, external-site installation and all Safari/iPhone behavior are
**unverified**. Three repeats of two synthetic utterances cannot complete them.
No required environment/device/permission blocker remains after the second run;
the first interruption's cause is still unknown. If it recurs, inspect the recorded
native visibility/document state and require an uninterrupted permitted foreground
execution environment; stop after two independent occurrences without new evidence.

No root/nested AGENTS.md or requested independent runner failure file
`2026-10-06T20-26-37-190Z-chrome-verification.txt` exists. Supplied instructions,
plan, architecture and prior Chrome report were read. All changes are confined to
this worktree. Companion v0.1.0, install/native messaging/server/core paths,
existing user settings, unrelated files and user apps/recordings/mounted images
were preserved. No agents, runner edits, checkbox completion, stage advancement,
push/publish or app installation occurred. Only owned test browsers/profiles were
closed; credentials, weights, user audio/transcripts and temporary `.ralph` state
are excluded from the commit. No Chrome stage, whole-framework or iPhone
completion is claimed.

## 2026-10-07 — B2 bounded streaming speech port (iteration 4/5)

Commit: the `feat: bound browser speech recognition streams` commit containing
this section. **B2 stays unchecked; no default is selected.** This extends only
B2. The original comparison command, every q8/FP16 candidate, failed baseline,
fixture hash/isolation tag, three-trial gate and lifecycle assertion are intact.
The unchanged comparison was not rerun to repeat its known tiny/WASM failure.

### Implementation and limits

Added `createSpeechRecognizer`, implementing the existing `SpeechRecognizer`
contract around the prepared utterance executor. One instance owns one identity,
one language and one run. It accepts only selected-scope, exclusively owned,
finite mono Float32 chunks already normalized to **16 kHz**, at most **12,800
bytes / 200 ms** each. Non-normalized input is explicitly rejected; production
selected-video resampling is still unfinished. This adapter does not prepare
models, translate, persist transcripts or modify playback/settings.

The experimental energy gate uses **20 ms frames, RMS >= 0.01**, a **500 ms
silence endpoint**, no invented confidence or interim transcript, and a **30 s
maximum segment**. It preserves frame continuity across arbitrary chunk sizes,
flushes the real EOF remainder, and does not fabricate padding for sub-100 ms
segments. Those short remainders are reported as discarded duration. This is
an energy detector, not a learned VAD or proof of music/noise discrimination.
There is no six-second forced boundary. Continuous speech crossing the 30 s
model limit still needs real boundary-quality evaluation.

One inference runs at a time, with at most **two pending utterances**, **30 s
of unrecognized retained input** across segment/queue/inference, and **two
undelivered transcript results**. Status reports pending/discarded audio duration.
A chunk can exceed the retained-input limit by at most its bounded size before
rejection and cleanup. Overload fails visibly, clears affected context and stops
the owned worker; it does not pause the video or select a fallback. Sequence,
audio-range, capture-clock continuity and identity/epoch discontinuities fail
with `audio-gap`, never join surviving samples and require a fresh explicit
session. Stop/cancel/consumer exit release the owned input iterator/reference,
clear buffers and reject late inference. The existing media graph and model
cache owners remain separate.

Port tests use a fake executor and cover arbitrary frame alignment, silence/EOF,
30 s segmentation, malformed/non-normalized/tab-mix/shared/nonfinite PCM,
sequence/epoch/clock gaps, bounded overload, cancellation while input is waiting,
and late results. They are **not recognition accuracy evidence**. The fake
30+1-second split does not establish long-speech accuracy.

### Real browser scope and first run

New `npm run test:framework:chrome:stream` builds the production host/worker and
speech adapter and runs actual small FP16 WebGPU inference in an owned headed
Chromium 153.0.8010.12, Darwin arm64, Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15, unchanged Transformers.js 4.3.0/locked ORT.
Model ID, revision, seven files/487,960,440 bytes and hashes are unchanged from
iteration 3. Native foreground visibility is checked; no focus emulation,
permission/profile change or browser-access workaround is used.

The hash-checked Japanese/English synthetic videos are decoded and resampled
with OfflineAudioContext to 111,556/106,664 samples. Each speech period retains
all original samples and its isolation tag, then adds at least 600 ms of
explicit zero silence and is delivered in 100 ms packets at real-time cadence.
Three repeats are 22.8 s Japanese / 21.9 s English, **44.7 s total paced input**,
not one ten-minute session. Test chunks carry a synthetic selected-scope tag;
this is **decoded fixture PCM, not the production selected-element route**.
The isolation tone is above the energy threshold, so these runs exercise the
explicit appended silence endpoint, not natural speech/noise VAD accuracy.

First `npm run test:framework:chrome:stream`: **PASS, exit 0**, ignored
`chrome-4-stream-first.log`. Typecheck, 5 initial port tests (0 failed/skipped/
cancelled, 48.7225 ms), build and all six real scored utterances passed the
unchanged <= 0.2 CER/WER gate. All Japanese trials were 1/40 = **2.5% CER**;
English 1/22 = **4.54545% WER**. Numeric 三/three → 3 remains an edit.
Read-only Python assertions on these six actual results additionally passed
meeting negation, tomorrow/afternoon/station and reservation non-cancellation
anchors; no mock supplied the recognized text.

| First run / language | Preparation ms | Endpoint-to-result range ms | Host run ms | Maximum pending audio ms | Baseline / peak browser-tree RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Japanese, fresh download/load | 55541.456166 | 739.800–853.400 | 23442.200 | 8180 | 1,301,328 / 3,737,296 |
| English, cached fresh worker | 1243.496625 | 669.700–752.300 | 22479.000 | 7780 | 2,988,752 / 3,885,824 |

First overall RSS baseline was 1,287,168 KiB. Normal runs dropped **0 ms**,
drained pending audio to zero and returned three ordered final source-revision-1
results each, with original identity/language and ranges. Japanese ranges were
0–7480, 7600–15080, 15200–22680 ms; English 0–7180, 7300–14480,
14600–21780 ms. Endpoint-to-result uses the document's actual packet delivery
and result clocks, including inference/transport after endpoint delivery. It
excludes speech accumulation and up to 100 ms packet quantization; it is not
first-caption latency or a percentile. RSS sums only the owned Chromium process
tree every 250 ms, including browser/renderers/GPU process, shared-page double
counting and allocator carryover. It is not isolated model/GPU allocation,
a leak test, a hardware limit or phone qualification.

First fault checks: unpaced overload returned `overloaded`, zero transcripts,
29,940 ms discarded / 0 pending (observed pending peak 29,840 ms); a deliberate
sequence gap discarded 100 ms and returned `audio-gap`. Cancel after observing
actual pipeline invocation returned `cancelled`, zero transcripts and 7480 ms
discarded. Destruction of the actual runtime-created GPUDevice returned
`gpu-lost`, zero transcripts and 7180 ms discarded, with no fallback. Each check
used a fresh cached prepared worker; these are explicit injected faults, not
normal playback failures or cooperative kernel cancellation. First final page
errors, visibility events and accuracy failures were `[]`; pinned artifact/network
assertions passed. Only owned browser/profiles were cleaned up.

### Development failures and remaining acceptance

Initial typecheck failed on six `Array.fromAsync` uses with the repository's
ES2022 library; kept ES2022 and used a local async collector. Initial port run
returned exit 1, **4 passed/1 failed** (88.672584 ms): the new arbitrary-frame
test expected 18,960 samples, but 30 × 701 source samples minus its 1920-sample
start equals **19,110**, with real EOF **1314.375 ms**. Corrected that arithmetic
and the first active sample index; the segmentation and accuracy gates were not
relaxed. Later typecheck returned exit 1, TS2352, for the deliberately invalid
SharedArrayBuffer fixture cast; corrected its explicit `unknown` coercion.
Final port runs pass all six tests. These were development failures, not absent
permissions or model accuracy failures.

After the first real build, explicitly rejected shared buffers, released the
owned input-iterator reference on cleanup, added the 30 s port check, removed an
unused copied test helper, and promoted the observed meaning anchors into the
browser assertions. The final browser run also independently checks two seconds
of pure zero PCM: no ASR call or transcript, rather than inferring this from
mock results. Final evidence below applies to these completed sources.

Final `npm run test:framework:chrome:stream`: **PASS, exit 0**, ignored
`chrome-4-stream-final.log`: typecheck, **6 port tests passed / 0 failed/skipped/
cancelled** (52.412334 ms), production build and every real browser assertion.
All six scored utterances again had Japanese CER **1/40 = 2.5%** and English
WER **1/22 = 4.54545%**, identical text per language, with the semantic anchors
now asserted inside the harness. Normal input dropped **0 ms**, returned three
ordered results per language with the same ranges as the first run, and drained
all pending audio. Final observations (min–max of three repeats, not percentiles):

| Final run / language | Preparation ms | Endpoint-to-result range ms | Host run ms | Maximum pending audio ms | Baseline / peak browser-tree RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Japanese, fresh download/load | 53687.332208 | 747.400–852.400 | 23482.900 | 8180 | 1,286,528 / 3,521,872 |
| English, cached fresh worker | 1244.739875 | 664.800–816.000 | 22466.700 | 7880 | 2,678,640 / 3,766,784 |

Final overall RSS baseline: **1,277,968 KiB**. The same clock/packet/RSS caveats
above apply. Pure zero PCM (2 s) made **0 actual host ASR calls**, emitted **0
transcripts**, dropped **0 ms** and retained **0 ms**. Unpaced overload again
reported peak pending **29,840 ms**, discarded **29,940 ms** and cleared all
results; gap, invocation-observed cancellation and actual GPU loss again
reported `audio-gap` / **100 ms**, `cancelled` / **7480 ms**, `gpu-lost` /
**7180 ms**, respectively, all with zero transcripts/pending audio and no
fallback. Final page errors, visibility events and accuracy failures were `[]`;
pinned network assertions passed. Two stream invocations each downloaded this
single FP16 inventory once in a fresh owned context, reused its cache for later
workers, and cleaned only their owned browser/profile. Weights/runtime/profile
bytes and local logs are excluded from the commit.

Other checks:

- PASS: initial `npm run verify`, exit 0, `chrome-4-verify.log`: Biome
  103 files/46 ms/no findings, Ruff/typecheck/existing companion build,
  **91 JS passed / 0 failed/skipped/cancelled**, 15133.193042 ms;
  **222 Python passed**, 66.97 s. It preceded final cleanup/observation edits;
  the final stream command typechecks/tests/builds those completed sources.
- PASS: standalone final six port tests, exit 0, 73.611916 ms,
  `chrome-4-speech-port-final.log`; final targeted Biome, exit 0,
  3 files/no findings, `chrome-4-targeted-lint.log`.
- FAIL: required `npm run test:framework:chrome`, `chrome-4-stage-acceptance.log`:
  `Missing script: "test:framework:chrome"`. An isolated invocation confirming
  its exit code returned **exit 1**, `chrome-4-stage-acceptance-exit.log`.
  This is unfinished B5 implementation, not a missing external device/permission.
  No further attempt was made, no placeholder added and no preparation/ASR-only
  command substituted for full selected-video → ASR → Korean translation → DOM.
- PASS: final `npm run verify`, **exit 0**, `chrome-4-verify-final.log`, after
  all source/test edits: Biome **103 files / 46 ms / no findings**, Ruff,
  typecheck, unchanged companion build, **91 JS passed / 0 failed/skipped/
  cancelled** (14579.564375 ms), **222 Python passed** (66.93 s).
  This is repository regression evidence, not full Chrome interpretation.
- PASS: final document-inclusive unstaged/staged whitespace checks and committed
  worktree cleanliness, checked before delivery.

### Next unfinished item and boundaries

**B2 remains next.** Qualify production selected-video normalization/streaming,
natural silence/noise VAD and boundary-spanning speech, sustained queue/GPU
recovery/memory limits and broader Japanese/English meaning accuracy, and resolve
conversion/distribution licensing before selecting a default. The pinned FP16
profile is still experimental; the known tiny/WASM numerical failure and other
candidate semantic errors remain in the original comparison. No new license
confirmation is claimed. No required environment/device/permission blocker was
observed in either streaming invocation; no blocked terminal marker applies.

Unverified: production live selected-video resampling/capture → ASR, actual
long continuous speech at the 30 s boundary, learned VAD, physical storage/GPU
memory limits and leaks, suspension during streaming, sustained GPU recovery,
B3–B6 Korean translation/revision/DOM integration, offline full interpretation,
first-download fault/ten-minute end-to-end backlog/loss, external-site extension
installation, and all Safari/iPhone behavior. Existing B1 preparation fault tests
and earlier WASM/accuracy evidence are preserved, not reclassified as these
outcomes. Neither real model readiness nor mock port tests complete them.

No root/nested AGENTS.md or requested independent runner file
`2026-10-06T20-26-37-190Z-chrome-verification.txt` exists. Supplied instructions,
plan, architecture and previous report were read. All changes stay in the
requested worktree. Companion v0.1.0, published install/native messaging/server
paths, user settings, unrelated files and user apps/recordings/mounted images
remain unchanged. No agents, runner edits, checkbox completion, stage advance,
push/publish, app installation or browser-access bypass occurred. Credentials,
weights, user audio/transcripts and temporary `.ralph` state are not committed.
No Chrome-stage, whole-framework or iPhone completion is claimed.

## 2026-10-07 — B2 selected-video normalization (iteration 5/5, blocked)

This is the historical failure. The wake-state investigation and live-input
recovery recorded below supersede its environment blocker; B2 qualification
still remains unfinished.

Commit: `feat: normalize selected-video audio for browser ASR`, containing this
section. **B2 remains unchecked and no default is selected.** Only B2 was
extended. The candidate comparison, failed tiny/WASM baseline, fixture hashes,
isolation tones, three-trial gates, and existing lifecycle assertions remain.

Added `normalizeSelectedAudio` at the browser engine boundary. It accepts the
existing selected-element worklet's exclusively owned, finite mono Float32 PCM,
at most 8192 bytes per input chunk, at 16/44.1/48 kHz. Unsupported formats/rates,
tab mixes, shared buffers and invalid PCM fail explicitly. Sequence, identity,
epoch, rate and capture-clock/range discontinuities reject `audio-gap` and close
the input; samples across a gap are never joined. The speech port now preserves
an upstream `audio-gap` reason instead of replacing it with `engine-failed`.

16 kHz is a checked pass-through. Downsampling uses a centered 64-tap
Hann-windowed sinc with a 7200 Hz cutoff and saturation to [-1, 1]. Phase and
filter history continue across arbitrary packets. It retains 32 future input
samples (0.667 ms at 48 kHz, 0.726 ms at 44.1 kHz), bounds coefficient phases
and input buffers, and emits at most 3200 samples/200 ms per output. Both clocks
retain their original anchors; EOF emits floor(input samples × 16000/input rate),
ending within one output sample (0.0625 ms) of input duration. Filter boundary
zero extension adds no duration or padded utterance. Return closes the upstream
iterator, clears filter state and ignores a late outstanding read. No playback
graph, model/default, settings or companion PCM1 rate was changed.

Five normalizer tests check packet-invariant signal output at every accepted
rate, clocks/identity/duration, speech-band gain and >Nyquist alias suppression,
gaps, malformed input and outstanding-read cancellation. A speech-port regression
first failed with `engine-failed` instead of `audio-gap`; its unchanged assertion
passes after the fix. These synthetic signal/fake-executor checks are not ASR
accuracy evidence. 44.1 kHz is unit-tested, not a real browser capture claim.

### Browser acceptance and repeated live blocker

Extended `npm run test:framework:chrome:stream` with a separate live fixture
composing production catalog/input → normalizer → speech port → actual FP16
worker. Both unchanged hash-checked Japanese/English videos must play at their
existing fixture volumes (0.4/0.25). A selected run takes one labeled speech
period and ends capture while playback continues. Intended assertions cover raw
6500/9000 Hz source isolation **before filtering**, mapping <150 ms, normalized
sample counts/clocks, the unchanged <=0.2 CER/WER and meaning gates, <2000 ms
last-packet-to-result, zero reported ASR loss, explicit Stop and repeat Start.
No decoded reference PCM, subtitle or expected text enters that input path.
These live assertions **have not passed**.

Environment: Darwin arm64, Node v24.15.0/npm 11.12.1, uv 0.12.23/Python 3.12.15,
owned headed Chromium 153.0.8010.12 attached with `noDefaults: true`; unchanged
Transformers.js 4.3.0/locked ORT. Same pinned small FP16 WebGPU model revision
`36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven files/487,960,440 bytes.
Each of two invocations prepared one fresh inventory and reused its owned cache.
Only the owned browsers/profiles were closed. No browser permission, focus
emulation, user profile, device setting or other application was changed.

Both invocations returned **exit 1** at the first live Japanese run's unchanged
**30,000 ms timeout** (`chrome-5-stream-first.log`, `chrome-5-stream-second.log`).
The first error snapshot showed a visible document, no visibility events and
a genuinely ready model. The independent second attempt added failure-state
observations without extending any timeout or weakening a gate. It observed:

- Both videos: **currentTime 0**, `paused: false`, `ended: false`,
  `seeking: false`, `readyState: 4`, no media error.
- Raw input: **0 chunks / 0 samples**, no sample rate or range received.
- Normalizer: **0 chunks / 0 samples**; transcripts: **0**.
- Speech port: running, **0 ms pending / 0 ms reported discarded audio**.
- Document visible, visibility events `[]`, model ready with all declared bytes.

**BLOCKED:** the required live video playback/capture clock did not advance in
these two permitted owned-browser attempts. Its root cause, AudioContext clock
behavior and whether a device/host issue is involved are **unverified**; no
permission denial or specific missing hardware is claimed. Zero PCM is not
transcription success. Stop retrying the same live stall without new evidence.
The explicit live Stop/restart, English capture, isolation/mapping/accuracy and
post-Stop playback assertions were not reached. No alternate browser tool or
profile was used to bypass access, and no replacement success was manufactured.

Resume with a permitted real Chromium environment where these same ordinary
videos advance and the selected-element worklet actually produces PCM, or new
evidence identifying and correcting the native-clock stall. Then rerun the
unchanged live gates. Preserve B2 until its remaining broader speech/boundary/
noise quality, sustained recovery/memory and conversion/distribution licensing
evidence also qualifies a default. B3–B6, ten-minute end-to-end/offline Korean
captions, external-site installation, Safari and iPhone remain unfinished.

### Passing scope before the live failure

Each invocation completed the existing **six actual decoded-audio ASR trials**:
Japanese CER **1/40 = 2.5%**, English WER **1/22 = 4.54545%**, all meaning
anchors, identities/ranges and bounded-queue assertions passed. These are the
same 22.8 s/21.9 s paced decoded fixtures with explicit zero silence, **44.7 s**
total per invocation, not live capture or ten-minute recognition.

| Run / language | Preparation ms | Endpoint-to-result min–max ms | Host run ms | Max pending audio ms | Baseline / peak browser-tree RSS KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| First / Japanese | 52642.763959 | 771.100–805.300 | 23473.300 | 8180 | 1,292,736 / 3,181,712 |
| First / English | 1243.748542 | 635.400–728.800 | 22436.800 | 7780 | 2,735,120 / 3,681,056 |
| Second / Japanese | 53339.821250 | 748.200–851.100 | 23461.800 | 8180 | 1,281,232 / 3,182,368 |
| Second / English | 1246.834208 | 648.500–709.400 | 22450.500 | 7780 | 1,699,072 / 3,809,104 |

Overall RSS baselines: first **1,286,512 KiB**, second **1,252,928 KiB**. Same
250 ms owned-process-tree RSS caveats as iteration 4: shared-page counting,
allocator/browser/GPU-process inclusion; not isolated GPU allocations, leaks,
physical limits or phone qualification. Latencies use one document clock after
endpoint packet delivery, exclude speech accumulation/packet quantization and
are observed ranges of three repeats, not percentiles or caption latency.

Both runs also passed the earlier explicit faults: unpaced overload, **29,940 ms
discarded / peak pending 29,840 ms**; deliberate gap, **100 ms discarded**;
actual invocation-observed cancellation, **7480 ms discarded**; actual runtime
GPUDevice destruction, `gpu-lost` / **7180 ms discarded**. Each emitted zero
transcripts and cleared pending audio without fallback. Pure zero PCM (2 s)
made **0 actual ASR calls / 0 transcripts / 0 loss**. Normal decoded runs drained
to zero with no loss. Before entering live checks, page errors, visibility events
and accuracy failures were `[]`, and pinned-artifact/network assertions passed.
These fault checks do not prove live normalized-stream cancellation or recovery.

### Command ledger and boundaries

- FAIL then fixed: first combined port run, **11 passed / 1 failed**, 140.735750 ms;
  isolated upstream-gap regression **exit 1**, 0 passed / 1 failed, 43.337917 ms.
  Final typecheck + twelve port tests **exit 0**, 94.612333 ms. Subsequent final
  rate-change test refinement: **12 passed / 0 failed/skipped/cancelled**,
  152.052208 ms. No signal or accuracy gate was weakened.
- FAIL then fixed: initial `npm run verify`, **exit 1**, Biome found five missing
  caption-track/button-type errors in the new fixture, plus a template-literal
  style notice. Added empty fixture tracks, explicit button types and literal;
  these tracks contain no source text and are never used for recognition.
- PASS: corrected `npm run verify`, **exit 0**, `chrome-5-verify-final.log`:
  Biome 106 files/31 ms/no findings, Ruff/typecheck/existing companion build,
  **97 JS passed / 0 failed/skipped/cancelled**, 15320.720834 ms;
  **222 Python passed**, 66.80 s.
- PASS: concluding `npm run verify`, **exit 0**,
  `chrome-5-verify-completed-sources.log`, after all source/test changes:
  Biome **106 files/45 ms/no findings**, Ruff/typecheck/unchanged companion build,
  **97 JS passed / 0 failed/skipped/cancelled**, **15082.746958 ms**;
  **222 Python passed**, **66.93 s**. This is repository regression evidence,
  not live selected-video recognition or complete Chrome interpretation.
- FAIL/BLOCKED: both streaming commands above, **exit 1**; their typecheck,
  **12 port tests** (first 112.928792 ms, second 97.676916 ms), build and decoded
  ASR/fault checks passed, but first live capture stalled. No third browser run.
- FAIL: required `npm run test:framework:chrome`, **exit 1**,
  `chrome-5-stage-acceptance.log`: `Missing script: "test:framework:chrome"`.
  B5's full selected-video → ASR → Korean translation → DOM harness is still
  unimplemented. The streaming command is not substituted for it.
- PASS: final targeted Biome on all six edited source/test files, **exit 0**,
  6 files/5 ms/no findings.
- PASS: final document-inclusive unstaged/staged `git diff --check`, **exit 0**;
intended changes committed and worktree status checked before delivery.

Physical speaker output, independent tab-output amplitude, real clock progress,
natural VAD, actual 30 s boundary speech and live normalized-stream loss/recovery
are unverified in this iteration. The zero pending/loss status during the stall
describes zero acquired input, not successfully preserved or recognized audio.

No checkbox was changed. No AGENTS.md or requested independent runner failure
file exists. Supplied instructions, plan, architecture and prior Chrome report
were read. All work stays in this worktree. Companion v0.1.0, published install/
native messaging/server paths, settings and unrelated files/apps/recordings/
mounted images remain unchanged. No agents, runner edits, stage advance, push,
publish, app installation or browser-access bypass occurred. Credentials,
weights, user audio/transcripts and temporary `.ralph` state are excluded from
the commit. No Chrome-stage, whole-framework or iPhone completion is claimed.

## 2026-10-07 — live playback recovered; runner wake assertion fixed

The macOS power log supplies new evidence for the previously unknown stall.
At 06:17:51 the iteration-owned `caffeinate` assertions ended and the machine
entered Idle Sleep. It entered **DarkWake at 06:17:54 for 651 seconds**, covering
both failing live attempts. A new iteration-owned guard started at 06:17:56,
after DarkWake had already begun, and held only system/idle-sleep assertions.
It ended at 06:28:45, followed by Maintenance Sleep. This explains why keeping
one iteration's CPU awake was insufficient for native real-time media playback.
Generic CoreAudio `object is not valid` messages also occur during passing runs;
they do not independently identify an audio-device failure.

The same live fixture, original media hashes, model, capture graph, normalization,
accuracy/isolation/mapping thresholds and timeouts passed while fully awake.
The runner now wraps the entire macOS invocation in `caffeinate -disu`, with an
internal inherited marker preventing nested stage guards. The display/system
assertions span all iterations and stage transitions; user-activity assertion
wakes the display at startup. They end with the utility. Dry-runs remain inert,
and persistent power settings are unchanged. No production media/ASR code or
acceptance threshold was changed to make this pass.

Verification:

- FAIL → PASS: the new runner regression initially observed zero outer guards;
  after the fix one guard remains alive across all five fixture stages and ends
  with the command. All **20 runner tests passed**.
- PASS: a separate actual macOS lifecycle check observed owned
  `PreventUserIdleSystemSleep`, `PreventUserIdleDisplaySleep`, `PreventSystemSleep`
  and `UserIsActive` assertions via `pmset`; all were released after exit. Its
  npm commands were stubs, so it proves wake assertion lifecycle only.
- PASS: `caffeinate -disu npm run test:framework:chrome:stream`, **exit 0**, with
  no diagnostic instrumentation. Twelve port tests, six decoded ASR trials,
  existing overload/gap/cancel/GPU-loss faults and all four live rounds passed.
  Japanese live CER was **1/40 = 2.5%** on both completed rounds; English live
  WER was **1/22 = 4.54545%**. The Stop round reported `cancelled` and no text.
  Maximum live mapping error was **51.233334 ms** (<150 ms); final-packet-to-text
  times were **943.7 / 881.4 / 794.7 ms** (<2000 ms). Two audible videos kept
  their original playback state and the existing isolation/zero-loss checks
  passed. Japanese captures each supplied 337,920 real 48 kHz samples normalized
  to 112,640; English supplied 323,584 normalized to 107,861.
- PASS: `npm run verify`, **exit 0**, lint/typecheck/build, **98 JS tests** and
  **222 Python tests** (66.90 s); final whitespace checks pass.

Ignored evidence: `chrome-sleep-state.log`, `chrome-sleep-guard-regression.log`,
`chrome-sleep-guard-runner.log`, `chrome-sleep-guard-native.log`,
`chrome-live-fix-final.log`, and `chrome-sleep-guard-verify.log`. The first full
recovery run also passed with read-only media/context observations; the final
run above had none. Manual sleep/lid-close behavior was not forced on the user's
machine. This resolves the recorded live-input blocker, not all B2 qualification:
broader speech/noise/boundary, sustained recovery/memory, licensing/default
selection and B3–B6/Safari/iPhone remain unfinished. B2 stays unchecked; no loop
restart, push, publish or app installation was performed.

## 2026-10-07 — B2 continuous-input queue headroom (iteration 1/5, resumed run)

Related commit: `fix: reserve browser ASR queue headroom`, containing this report.
**B2 remains unchecked; no default is selected.** The prior live-input blocker
remains resolved. This iteration extends only B2 and fixes a newly measured
continuous-input failure; it does not implement B3–B6 or complete Chrome.

### Failing regression and implementation

Extended the existing real streaming harness with five complete copies of each
hash-checked decoded speech period, with **no appended silence, source deletion,
gain change or injected replacement audio**. Japanese supplies 557,780 samples /
34,861.25 ms; English 533,320 samples / 33,332.5 ms, at 16 kHz. Both retain the
original isolation tones. Observed maximum consecutive below-threshold frames
was **0 ms** in both languages, so the fixture exercises forced segmentation,
not the 500 ms silence endpoint. These concatenated synthetic speech periods
are decoded-file ASR input, not a long live selected-video or natural-noise test.
Expected text stays outside the inference input. Every original short trial,
live-input assertion, failed candidate baseline and numerical gate is preserved.

Before the fix, `caffeinate -disu npm run test:framework:chrome:stream` returned
**exit 1**, `chrome-20261007-1-boundary.log`. All six short ASR trials, existing
fault checks and four live rounds passed. Both new continuous trials failed:

| Language | Intended duration ms | Delivered duration ms / packets | Actual job range ms | Maximum reported pending ms | Discarded ms / final pending ms | Transcripts | Host run ms | Baseline / peak RSS KiB |
| --- | ---: | ---: | --- | ---: | --- | ---: | ---: | --- |
| Japanese | 34861.25 | 30100 / 301 | 0–30000 | 30000 | 30100 / 0 | 0 | 30101.100 | 1539824 / 3912944 |
| English | 33332.5 | 30100 / 301 | 0–30000 | 30000 | 30100 / 0 | 0 | 30100.300 | 2514512 / 3690208 |

Each actual host invocation transferred 480,000 samples to the prepared FP16
worker. The next 100 ms input packet arrived while that job remained pending,
exceeded the retained-input budget and caused `overloaded` with worker Stop.
Document visibility remained native `visible`, visibility events and page
errors were `[]`. No long-input transcript completed; its accuracy and completed
inference latency are **unverified**, not successful zero-error measurements.
This is a reproducible queue/profile defect, not an absent environment/device/
permission. A fake stalled-executor test independently confirms the accounting,
bounded failure and rejection of a late result; it is not ASR evidence.

The simplest fix retains the **30 s audio budget**, one active inference, two
pending utterances and two undelivered results, and reduces the experimental
segment maximum to **20 s**. This reserves up to 10 s of input during inference,
without admitting a larger backlog, pausing playback, changing models or adding
fallback. The executor's 30 s maximum remains unchanged. The port tests assert
contiguous 20+11 s segmentation and still require overload/discard/late-result
rejection if stalled inference consumes the budget. The existing 30+1 s
instantaneous-fake-executor check was not sustained runtime evidence.

The continuous acceptance requires completion, zero discarded audio, a drained
queue, contiguous bounded ranges and authoritative identities/final revisions.
It scores the complete five-copy source using the unchanged <=0.2 CER/WER rule
and additionally requires every existing meaning anchor at least five times.
An overload is retained as a failing acceptance outcome, never counted as normal
continuous playback. Both language outcomes are collected before failing.

### Passing real rerun

Final `caffeinate -disu npm run test:framework:chrome:stream`: **PASS, exit 0**,
`chrome-20261007-1-headroom-stream.log`. Typecheck, **13 port/normalizer tests**
(96.437416 ms), build, all original browser assertions and both new continuous
trials pass. Same owned headed Chromium **153.0.8010.12**, Darwin **25.6.0 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, Python **3.12.15**. No dependency
or model changes: Transformers.js 4.3.0/locked ORT, small FP16 WebGPU,
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`,
seven model files / **487,960,440 bytes**. Each of the two invocations prepared
only this inventory in a fresh owned context, then reused its cache. Model,
runtime and owned-profile bytes/logs are excluded from the commit.

| Continuous language | Cached fresh-worker preparation ms | Delivered samples / packets | Returned ranges ms | Host job round trips ms | Host run ms | Peak pending ms | CER/WER | Baseline / peak RSS KiB |
| --- | ---: | --- | --- | --- | ---: | ---: | --- | --- |
| Japanese | 1257.178125 | 557780 / 349 | 0–20000; 20000–34861.25 | 1816.900; 1305.500 | 36166.500 | 21800 | 7/200 = **3.5% CER** | 1645568 / 3813840 |
| English | 1436.578625 | 533320 / 334 | 0–20000; 20000–33332.5 | 1510.800; 1044.100 | 34377.600 | 21500 | 5/110 = **4.54545% WER** | 2355744 / 3698976 |

Both completed with **0 ms discarded / 0 ms pending**, two final revisions, and
every meaning anchor count **5**. Japanese's seven edits include five 三→3 edits
and a duplicated ない at the segment join; this observed boundary imperfection
is preserved, not normalized away. English's five edits are three→3. Passing
this gate does not establish seamless segmentation on broader speech. Round
trips use one document clock around actual host calls; they include transport
and inference, not speech accumulation, translation or caption latency.

The six original short decoded trials again scored Japanese **1/40 = 2.5% CER**,
English **1/22 = 4.54545% WER**, and passed all meaning anchors with zero loss.
Endpoint-to-result ranges were **761.100–922.800 ms / 661.100–787.100 ms**,
preparation **52150.904542 / 1449.419125 ms**, maximum pending **8280 / 7780 ms**,
mode baseline/peak RSS KiB **1292032/3316944 / 2722240/3530832**.
Live rounds completed Japanese twice and English once with the same CER/WER,
raw 48 kHz samples **337920 / 337920 / 323584**, normalized samples
**112640 / 112640 / 107861**, no ASR loss, last-packet-to-text
**881.700 / 942.600 / 822.600 ms**, maximum mapping error **46.111334 ms**.
Stop returned `cancelled`, no text, **963.375 ms discarded / 0 pending**;
capture detached, repeat Start and original two-video playback state/isolation
checks passed. No independent speaker-output measurement is added here.

Existing injected faults still pass: unpaced overload **29940 ms discarded /
29840 ms pending peak**; gap **100 ms**; invocation-observed cancel **7480 ms**;
actual runtime GPUDevice destruction `gpu-lost` **7180 ms**, all with zero
transcripts/pending and no fallback. Two seconds pure zero PCM made **0 actual
ASR calls / 0 transcripts / 0 loss**. Page errors, native visibility events and
accuracy failures were `[]`; original pinned-network assertions passed.

Overall final browser-tree RSS baseline was **1289584 KiB**. All RSS figures
sample the owned process tree every 250 ms, include browser/renderers/GPU process,
shared-page double counting and allocator retention, and are not isolated GPU
allocations, a leak test, physical limits or phone evidence. Timings are observed
ranges or individual jobs, not percentiles or ten-minute throughput.

### Command ledger and unfinished scope

- PASS: initial `npm run verify`, **exit 0**, `chrome-20261007-1-verify.log`,
  lint/typecheck/unchanged companion build, **98 JS / 222 Python passed**,
  JS 21920.786917 ms, Python 66.85 s; preceded the new port test/fix.
- PASS: pre-fix final `npm run verify`, **exit 0**,
  `chrome-20261007-1-verify-final.log`, **99 JS / 222 Python passed**,
  JS 23866.759542 ms, Python 66.93 s. Fake overload accounting is passing
  regression scope; the real continuous harness above still failed.
- PASS: eight pre-fix speech-port tests, **exit 0**, 408.528375 ms,
  `chrome-20261007-1-boundary-port.log`; post-fix typecheck + thirteen
  port/normalizer tests, **exit 0**, 105.021542 ms,
  `chrome-20261007-1-headroom-port.log`; targeted Biome three files/no findings.
- PASS: final production/harness `npm run verify`, **exit 0**,
  `chrome-20261007-1-headroom-verify.log`: Biome **106 files / 39 ms / no findings**,
  Ruff/typecheck/unchanged companion build, **99 JS passed / 0 failed/skipped/
  cancelled** (20698.714041 ms), **222 Python passed** (66.83 s).
- FAIL then PASS: the two streaming commands above, **exit 1 then 0**.
  First command's twelve pre-fix port tests passed (97.235625 ms); final
  thirteen tests and real continuous acceptance passed. No third browser run.
- FAIL: required `npm run test:framework:chrome`, **exit 1**,
  `chrome-20261007-1-stage-acceptance.log`: `Missing script: "test:framework:chrome"`.
  This was run once before the fix; package scripts remain unchanged. B5's
  full selected-video → ASR → Korean translation → DOM harness is unimplemented.
  The passing B2 command is not a substitute, and no placeholder was added.
- PASS: document-inclusive unstaged/staged whitespace and committed worktree
  cleanliness checked before delivery. All evidence logs above live in ignored
  `.ralph/media-framework/`, not committed temporary runner state.

**Next remains B2:** broader natural speech/noise and boundary quality, sustained
queue/GPU recovery/memory limits and conversion/distribution licensing before
choosing a default. The 20 s profile is experimental and can still overload if
inference consumes its bounded headroom; only the measured fixtures are qualified.
Natural VAD, long live selected-video speech, storage/GPU limits/leaks, offline
full interpretation, ten-minute backlog/loss, Korean translation/revision/DOM,
external-site installation and all Safari/iPhone behavior remain **unverified**.
All prior failed model comparisons and incomplete checkboxes are preserved.
No required environment/device/permission blocker was observed, so no blocked
or stage-complete marker applies.

No root/nested AGENTS.md or requested independent runner evidence file
`2026-10-07T12-30-44-825Z-chrome-verification.txt` exists. Supplied instructions,
plan, architecture and prior report were read. All changes stay in this worktree.
Companion v0.1.0/published installation/native messaging/server paths, existing
settings and unrelated files/apps/recordings/mounted images are preserved.
No agents, runner edit, stage advance, push/publish, app installation or browser
access/profile/permission bypass occurred. Only owned test browser/profile
resources were closed; credentials, weights and user audio/transcripts are not
committed. No whole-framework, Chrome-stage or iPhone completion is claimed.

## 2026-10-07 — B2 active GPU loss and explicit recovery (iteration 2/5)

Related commit: `test: verify browser ASR recovery after GPU loss`, containing
this report. **B2 remains unchecked; no default is selected.** This iteration
qualifies one missing B2 lifecycle case. B3–B6 and Safari/iPhone remain unfinished.

### Change and observable acceptance

Extended only `tests/framework-chrome-stream.mjs`. The production ASR host,
worker, model inventory, bounded profile, existing fixtures and all prior gates
are unchanged. The simpler existing idle-device-loss check could not establish
what happens during inference or whether the same host can recover; it is kept
alongside the new checks. No production defect was observed in the new checks.

For each language, a worker-local observer first invokes the **production**
recognition message handler, records the actual job range/sample count through a
separate MessageChannel, then destroys the actual runtime GPUDevice. This is
explicit fault injection into actual FP16 WebGPU inference, not a fake ASR result
or evidence of naturally occurring device loss. The stream must fail `gpu-lost`,
release pending audio, produce no text and create no automatic replacement worker.
A direct recognition attempt before Prepare must still fail `gpu-lost`, retaining
its caller-owned 6,400-byte PCM buffer.

A real document-button click then calls Prepare on the **same host object**.
Acceptance requires exactly one replacement worker, cached/loading/ready states,
no downloading state, the same 487,960,440-byte profile and an actual new runtime
device. A fresh recognizer uses epoch 4 instead of the failed epoch 3. Each of its
three complete paced utterances must preserve authoritative identities/ranges,
final revision 1, all original meaning anchors, <=0.2 CER/WER, bounded pending
audio and zero loss. Recovery preparation and recognition made **zero HTTPS
requests**; this is cached model recovery, not a full offline interpretation test.
The observer never supplies source text or replacement PCM to inference.

### Passing real browser evidence

`caffeinate -disu npm run test:framework:chrome:stream`: **PASS, exit 0**, one
browser invocation, `chrome-20261007-2-gpu-recovery-stream.log`. Typecheck,
**13 port/normalizer tests** (98.194250 ms), build and every original/new real
browser assertion pass. Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 /
25G83 arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**. Same locked
Transformers.js 4.3.0 / ORT and small FP16 WebGPU model:
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
files / **487,960,440 bytes**. One fresh model inventory was downloaded in the
owned context; subsequent preparations reused its cache. No new model/dependency.

| Recovery language | Interrupted job ms / samples | Discarded ms / pending ms | Same-host cached reprepare ms | Recovered input / host run ms | Endpoint-to-result range ms | Recovered CER/WER (all three trials) | Peak pending ms | Baseline / peak RSS KiB |
| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |
| Japanese | 0–7480 / 119680 | 7480 / 0 | 1235.679125 | 22800 / 23464.600 | 764.400–854.900 | 1/40 = **2.5% CER** | 8180 | 1938016 / 3547248 |
| English | 0–7180 / 114880 | 7180 / 0 | 1232.231791 | 21900 / 22452.600 | 645.800–678.700 | 1/22 = **4.54545% WER** | 7680 | 1529408 / 3732448 |

Loss phases took 321.500 / 326.200 ms including file decoding, unpaced delivery
and a deliberate 200 ms post-failure observation. These are **not GPU-loss
notification latencies**. Worker counts stayed 8 / 10 through loss and the
rejected retry, then became 9 / 11 only after explicit Prepare. Both interrupted
jobs returned **zero transcripts**; their accuracy is unverified. Both recovered
streams drained to **0 ms pending / 0 ms discarded**, without old-epoch text.

Original checks also pass:

- Six original decoded trials: Japanese **1/40 = 2.5% CER**, English
  **1/22 = 4.54545% WER**, every meaning anchor. Preparation 53510.363833 /
  1243.239750 ms; endpoint-to-result 772.200–895.500 / 656.000–813.400 ms;
  peak pending 8180 / 7880 ms; zero loss/drained queues.
- Actual live selected-video rounds: Japanese twice and English once retain
  the same accuracy and meaning anchors. Raw 48 kHz samples **337920 / 337920 /
  323584**, normalized **112640 / 112640 / 107861**. Final-packet-to-text
  **925.700 / 864.300 / 769.800 ms**; maximum mapping error **48.513 ms**.
  Stop reports `cancelled`, no text, **963.375 ms discarded / 0 pending**;
  capture detaches, repeat Start, original two-video playback and isolation pass.
- Five-copy continuous decoded input: Japanese **34861.25 ms**, English
  **33332.5 ms**; two contiguous segments split at 20000 ms, no deleted source
  samples or appended silence. Japanese **7/200 = 3.5% CER**, English
  **5/110 = 4.54545% WER**; every meaning anchor count **5**. Peak pending
  **21700 / 21500 ms**, host run **36169.800 / 34392.500 ms**; **0 loss / 0 pending**.
  The previously recorded Japanese join imperfection remains in the score.
- Existing injected unpaced overload: **29940 ms discarded / 29840 ms peak
  pending**; gap **100 ms**; invocation-observed Stop **7480 ms**; idle actual
  GPU loss **7180 ms**, all with zero text and no fallback. Pure zero PCM:
  **0 actual ASR calls / 0 transcripts / 0 loss**. Page errors, native visibility
  events and accuracy failures are `[]`; pinned network-path assertions pass.

Overall browser-tree RSS baseline **1286640 KiB**. RSS is sampled every 250 ms
for the owned process tree, including browser/renderers/GPU process, shared-page
double counting and allocator retention. These two finite loss/recovery cycles
and short post-recovery utterances do **not** establish leak freedom, sustained
memory limits, hardware pressure recovery or phone suitability. Timings use a
single document clock after endpoint-packet delivery, exclude speech accumulation
and translation, and are observed ranges of three trials, not percentiles.

### Command ledger, remaining scope and preservation

- PASS: targeted `./node_modules/.bin/biome lint tests/framework-chrome-stream.mjs`
  (one file / 26 ms / no findings) and initial `git diff --check`, exit 0.
- PASS: the streaming command above, **exit 0**; no browser retry was needed.
- PASS: final `npm run verify`, **exit 0**, `chrome-20261007-2-verify.log`:
  Biome **106 files / 49 ms / no findings**, Ruff/typecheck/unchanged companion
  build, **99 JS passed / 0 failed/skipped/cancelled** (21628.020917 ms),
  **222 Python passed** (66.87 s). This is repository regression evidence,
  separate from real ASR and unfinished full interpretation acceptance.
- FAIL: required `npm run test:framework:chrome`, **exit 1**,
  `chrome-20261007-2-stage-acceptance-exit.log`: `Missing script:
  "test:framework:chrome"`. The earlier identical command's shell wrapper
  subsequently printed the log and returned 0; that wrapper return is not an
  npm pass. B5's full video → ASR → Korean translation → DOM harness remains
  unimplemented. No placeholder, substitution or acceptance weakening.

- PASS: final document-inclusive unstaged/staged `git diff --check`, exit 0;
  intended changes committed and post-commit worktree cleanliness checked.

**Next unfinished item remains B2:** broader natural speech/noise and boundary
quality, sustained queue/recovery/memory limits, conversion/distribution licensing
and evidence-based default selection. The failed tiny/WASM baseline and other
candidate semantic errors remain recorded and have not been rerun without new
evidence. Natural VAD, long live speech, storage/GPU pressure, complete offline
interpretation, ten-minute backlog/loss, Korean translation/revision/DOM,
external-site installation and all Safari/iPhone behavior remain **unverified**.
There is no observed missing environment/device/permission blocker in this run.
No checklist item or stage-complete/blocked marker is warranted.

No root/nested AGENTS.md or requested independent runner evidence file exists.
Supplied instructions, plan, architecture and prior Chrome report were read.
Only this worktree is changed. Published companion v0.1.0/install/native messaging/
server paths, settings and unrelated files/apps/recordings/mounted images remain
unchanged. No agents, runner edit, stage advance, push, publish, app installation
or browser-access/profile/permission bypass. Only test-owned browser resources
were closed. All named logs/builds/profiles are ignored `.ralph/media-framework/`
evidence; credentials, weights, user audio/transcripts and temporary state are
excluded from the commit. No whole-framework, Chrome-stage or iPhone completion.

## 2026-10-07 — B2 live multi-period boundary qualification (iteration 3/5)

Related commit: `test: expose live browser ASR boundary quality failure`,
containing this report. **B2 remains unchecked; no default is selected.** Only
the next unfinished Chrome item, B2, was extended. The new trial exposes a
repeatable **46.66667% Japanese CER failure**, despite successful acquisition,
inference and zero reported audio loss. It does not establish Chrome completion.

### Change and observable acceptance

Extended `tests/framework-chrome-stream.mjs` and its existing live fixture with
three complete speech periods per language, using the original hash-checked
24-second videos. This simpler extension avoids generating or replacing media.
Production catalog/input, normalizer, recognizer, host/worker, model inventory,
profile, all prior trials/failed baselines and acceptance thresholds are unchanged.
No expected text or decoded reference PCM supplies the live inference path.

The fixture records actual production host invocations, input samples delivered
at invocation/settlement, authoritative ranges and one document's timestamps.
The added trials retain <=0.2 CER/WER, every meaning anchor at least three times,
<2000 ms final-packet-to-text, bounded queues, zero reported discard, identity/
revision/mapping, raw pre-filter isolation and original playback checks. Japanese
must return two contiguous segments and deliver >100 ms more real captured PCM
while the first job is pending. Existing single-period result count, accuracy,
latency and explicit Stop/restart assertions remain. Extended accuracy/meaning/
latency failures are collected and rejected at the final assertion; collecting
English after Japanese failure does not make that failure a pass.

### Actual runs and test-assertion corrections

All browser commands below were `caffeinate -disu npm run test:framework:chrome:stream`.
All three returned **exit 1**, with successful typecheck, thirteen port/normalizer
tests and build. Logs are ignored `.ralph/media-framework/` evidence:

1. `chrome-20261007-3-live-boundary-stream.log`, port tests **94.776750 ms**:
   failed a new, incorrect first-range assertion, `60 !== 0`, in the original
   short Japanese round. The energy gate legitimately skipped 60 ms of initial
   quiet PCM. Recognition returned text, but the new scoring code and extended
   trials were not reached. This was a test assumption error, not an environment
   or recognition-quality blocker. Corrected the new assertion to allow a bounded
   <=100 ms quiet prefix, retaining contiguous subsequent speech ranges.
2. `chrome-20261007-3-live-boundary-stream-second.log`, port tests
   **105.335500 ms**: all original short live/Stop/restart and earlier decoded/
   fault/recovery checks passed. Extended Japanese returned **56/120 = 46.66667%
   CER**, failing the unchanged 20% gate. English extension and later continuous
   checks were not reached. Acquisition delivered **1,007,616 raw 48 kHz samples /
   335,872 normalized samples**, ranges **80–20080 / 20080–20992 ms**, with
   **0 discard / 0 pending**, peak pending **20912 ms**, mapping error
   **51.287667 ms**. Actual host calls took **2518.500 / 306.100 ms**. During
   the first call, delivered normalized input advanced **20095.375→20992 ms**.
   The first result repeated extra time/meeting/reservation phrases; this was
   not merely the known 三→3 numeric edit. Baseline/peak RSS **3746240/3746240 KiB**.
3. `chrome-20261007-3-live-boundary-stream-final.log`, port tests
   **101.378583 ms**: retained the Japanese failure while collecting English.
   Japanese independently reproduced **56/120 CER**. English acquired real PCM
   and returned all three utterances, then failed the new inferred segment-count
   assertion, **1 !== 2**. Its final **13.3125 ms** input remainder followed a
   full segment and was classified quiet by the existing energy gate, with
   **0 reported discard**. This is distinct from a short speech remainder,
   which the existing port reports as discarded. The zero-discard gate stays.

After the third command, corrected only the new range assertions: infer segment
count from the returned speech span and allow **0–<20 ms** trailing quiet PCM
(one energy frame), still requiring zero reported discard. No original assertion
or numerical/meaning/latency gate was relaxed. A local Python check against the
third run's recorded results returned **exit 0** for both languages' corrected
prefix/tail, contiguous ranges, final revisions/identity, bounded pending and zero
discard/drained queue. Independent NFKC/punctuation/whitespace edit-distance
recomputation returned the CER/WER below. This checks recorded real results,
**not a fresh browser run or a passing full acceptance command**. Final targeted
Biome and `node --check tests/framework-chrome-stream.mjs` passed. The revised
browser assertions and later continuous checks remain **unverified in a fresh
run of the final harness**. No further browser invocation was made after the
second independent Japanese quality failure.

### Third-run measured live evidence

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**. Unchanged Transformers.js
4.3.0/locked ORT, small FP16 WebGPU,
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`,
seven files / **487,960,440 bytes**. Each invocation prepared one fresh inventory
in its owned context and reused that cache. No new dependency/model/fixture.

| Extended live language | Raw 48 kHz samples / chunks | Normalized samples | Returned ranges ms | Actual host call ms | Peak pending ms | CER/WER | Final-packet-to-text ms | Max mapping error ms | Baseline / peak RSS KiB |
| --- | --- | ---: | --- | --- | ---: | --- | ---: | ---: | --- |
| Japanese | 1007616 / 492 | 335872 | 60–20060; 20060–20992 | 2573.400; 306.200 | 20932 | **56/120 = 46.66667% FAIL** | 1985.200 | 42.713000 | 3819232 / 3819408 |
| English | 962560 / 470 | 320853 | 40–20040 | 1557.500 | 20013.3125 | **3/66 = 4.54545%**, recomputed from recorded result | 1557.800 | 44.759667 | 3509136 / 3509136 |

Both ended with **0 ms pending / 0 ms reported discarded audio**. Japanese
capture advanced **20095.375→20992 ms** during its first pending invocation,
proving capture/inference overlap on this finite trial. Its meaning counts were
meeting/negation **3**, tomorrow/afternoon/station **5**, reservation/non-cancellation
**4**: extra repeated phrases explain why minimum anchor counts alone cannot
establish quality. English's returned text contains every meaning anchor three
times; its post-count-failure accuracy/latency/meaning assertions were not reached
inside the browser harness. English's initial quiet prefix was **40 ms**, trailing
quiet **13.3125 ms**; Japanese prefix **60 ms**, trailing quiet **0 ms**. No
independent acoustic labeling of those quiet frames was added.

The four original live rounds pass in the third run: two completed Japanese
rounds **1/40 = 2.5% CER**, English **1/22 = 4.54545% WER**, final-packet-to-text
**836.100 / 836.300 / 772.500 ms**. Short raw samples **337920 / 337920 / 323584**,
normalized **112640 / 112640 / 107861**. Stop returned `cancelled`, no transcript,
**900.6875 ms discarded / 0 pending**; capture detached and repeat Start passed.
Every collected live round retained both videos' playback/volume/mute/rate/source
state. All four original rounds and extended Japanese passed pre-filter isolation;
extended English's subsequent isolation/normalization/mapping gates were not
reached after its count assertion failed. Its range/queue checks were validated
only by the recorded-result analysis above. No independent speaker/output-level
measurement was performed here.

All six original decoded trials passed **2.5% CER / 4.54545% WER**, zero loss;
endpoint-to-result ranges **776.200–831.800 / 643.500–758.200 ms**, preparation
**53061.130916 / 1442.777500 ms**. Earlier fault gates passed: overload
**29940 ms discarded / 29840 ms peak pending**, gap **100 ms**, invocation-observed
cancel **7480 ms**, idle actual GPU loss **7180 ms**, all with zero transcripts/
pending and no fallback. Pure zero PCM made **0 ASR calls / 0 transcripts / 0 loss**.
Active loss/recovery passed for both languages; explicit cached Prepare took
**1235.211000 / 1231.740375 ms**, zero HTTPS requests, and all recovered trials
retained **2.5% CER / 4.54545% WER**. The later five-copy decoded continuous
trials were **not reached in any of these three invocations**, not revalidated
by their historical passes. Final page errors and native visibility events were
`[]`; the original pre-live pinned-network assertion passed.

Overall third-run RSS baseline **1299968 KiB**. RSS sums only the owned browser
process tree every 250 ms, includes shared-page double counting, allocator
retention and browser/renderers/GPU process, and is not isolated GPU allocation,
leak freedom, memory pressure or phone qualification. Host call/last-packet times
use one document clock; they exclude speech accumulation/translation/display
and are single trials, not percentiles or ten-minute throughput.

### Required checks, remaining scope and preservation

- PASS: `npm run verify`, **exit 0**, `chrome-20261007-3-verify.log`: Biome
  **106 files / 45 ms / no findings**, Ruff/typecheck/unchanged companion build,
  **99 JS passed / 0 failed/skipped/cancelled** (**21574.524625 ms**),
  **222 Python passed / 66.95 s**. Its lint preceded the final test-range
  correction; final two-file Biome (**8 ms**) and script syntax check also passed.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261007-3-stage-acceptance.log`: `Missing script:
  "test:framework:chrome"`. B5's full selected-video → ASR → Korean translation
  → DOM harness remains unimplemented. No placeholder or B2 substitute was added.
- FAIL: all three streaming invocations as detailed above; two independently
  reached the same Japanese live quality failure. No thresholds, candidate
  failures or fixture sentences were removed. No further identical retry.
- PASS: final document-inclusive unstaged/staged whitespace checks; intended
  changes committed and post-commit worktree cleanliness checked before delivery.

**Next unfinished item remains B2:** improve and evaluate the live Japanese
multi-period/boundary quality failure, then rerun the final real harness. Broader
natural speech/noise, learned VAD, sustained queue/recovery/memory limits,
conversion/distribution licensing and evidence-based default selection remain
unfinished. Longer live input, ten-minute backlog/loss, complete offline
interpretation, Korean translation/revisions/DOM, external installation and all
Safari/iPhone behavior remain **unverified**. No required environment/device/
permission was absent; this is a quality failure and incomplete implementation,
so no blocked or stage-complete marker applies. No checkbox was changed.

No root/nested AGENTS.md or requested independent runner file exists. Supplied
instructions, plan, architecture and prior Chrome report were read. Work stays
in this worktree. Published companion v0.1.0/install/native messaging/server
paths, settings and unrelated files/apps/recordings/mounted images are preserved.
No agents, runner edits, stage advance, push/publish/app installation or browser
access/profile/permission bypass occurred. Only owned test browser resources
were closed. Logs, profiles, model weights and user audio/transcripts are excluded
from the commit. No whole-framework, Chrome-stage or iPhone completion is claimed.

## 2026-10-07 — B2 speech-band pause boundaries (iteration 4/5)

Related commit: `fix: split long browser ASR at speech-band pauses`, containing
this report. **B2 remains unchecked; no default is selected.** Only the next
unfinished Chrome item is changed. The two prior 46.66667% Japanese live CER
failures remain evidence; the unchanged failing configuration was not retried.

### Diagnostic, failing regression and implementation

An explicit local, test-owned headless Chromium diagnostic decoded three periods
from each unchanged hash-checked fixture and used the production 48→16 kHz
normalizer. No model or live acquisition was involved. At diagnostic gain 0.4,
Japanese minimum full-band frame RMS was **0.012378603**, above the existing
0.01 gate; two cascaded 3 kHz one-pole detector stages reached **0.003711438**.
They exposed 260 ms quiet intervals at **11560–11820 / 18520–18780 ms** and a
240 ms interval at **13860–14100 ms**. English minima were **0.000042931 /
0.000012759** at that same diagnostic gain (the real live English volume is
0.25). **That gain assumption was incorrect for the input path:** the live
pre-filter isolation gate measures a 0.06 carrier independent of speaker volume.
Japanese decoded/normalized samples were **1004004/334668**, English
**959976/319992**. These measurements explain why a high-frequency carrier can
hide speech-band pauses. They do not label natural speech, establish VAD
accuracy or independently prove the cause of Whisper's repeated phrases.

The diagnostic initially failed importing the built module because its temporary
server did not serve imported asset chunks (exit 1). One edit command also failed
because `python` is absent (exit 1); `python3` applied the local server correction.
The corrected diagnostic returned **exit 0**. Logs:
`chrome-20261007-4-energy-diagnostic{,-second}.log` under ignored
`.ralph/media-framework/`. Only its owned profile was removed; no browser access
restriction was encountered or bypassed.

The interim 3 kHz browser run passed every existing check but kept Japanese's
first live cut at **20060 ms**, still a full 20 s segment. Its three-period CER
was **10/120 = 8.33333%** (all anchor counts 3), versus the historical 56/120.
English actually cut at **11200 ms** and scored **3/66 = 4.54545% WER**. This
does **not** establish that earlier Japanese segmentation fixed the historical
repetition failure. Both five-copy decoded inputs still split at 20000 ms and
scored **7/200 CER / 5/110 WER**, with zero loss. Command:
`caffeinate -disu npm run test:framework:chrome:stream`, **PASS, exit 0**,
`chrome-20261007-4-pause-stream-first.log`, fourteen port tests / **95.937125 ms**.

A corrected diagnostic used **unscaled** production-normalized PCM and two
**2 kHz** stages: Japanese full-band/detector minima **0.030946507 /
0.004713234**, quiet **11580–11800 ms (220 ms)**, **13900–14100 (200 ms)**,
**18540–18780 (240 ms)**; English minima **0.000107327 / 0.000017043**,
quiet **10940–11260 ms (320 ms)**. Sample counts are unchanged. Command:
`node .ralph/media-framework/chrome-20261007-4-energy-diagnostic.mjs`, **PASS,
exit 0**, `chrome-20261007-4-energy-diagnostic-unscaled.log`. This new signal
evidence prompted the final 2 kHz cutoff, without changing source PCM or gain.

A new synthetic signal/fake-executor regression first failed **1 job != 2**,
**exit 1**, one failed/zero passed (**99.425417 ms**),
`chrome-20261007-4-pause-regression-before.log`. The fifteen-second signal contains
1 kHz speech-band energy, a 6.5 kHz carrier and a 300 ms speech-band pause at
eleven seconds. After correcting the gain assumption, strengthened the regression
to a **0.06** carrier and **100 ms of actual zero PCM after the cut**. It again
failed with the interim 3 kHz detector, **exit 1**, 0 passed/1 failed /
**118.460209 ms**, `chrome-20261007-4-unscaled-regression-before.log`. The final
2 kHz port returns contiguous **0–11200 /
11200–15000 ms** jobs; concatenating their PCM is **byte-identical** to all input
samples, with zero pending/discarded audio. This is segmentation/transport evidence,
not transcription accuracy.

The experimental speech port retains its full-band RMS gate, 20 ms frames,
500 ms endpoint, 20 s segment maximum, 30 s retained-audio budget, one active
inference and two pending jobs/results. After ten seconds, **200 ms below 0.01
speech-band RMS** permits an earlier cut. The two 2 kHz detector filter states persist
across frames/chunks; only detector energy is filtered. ASR receives unchanged
PCM, and continuation after such a cut preserves intervening quiet frames rather
than silently skipping them. No padding, overlapping/deduplicated text, repeated
phrase suppression, model/backend fallback, setting or playback change is added.
This remains an energy heuristic, with unevaluated fricative/music/noise behavior;
the 20 s forced cut still applies when no suitable pause is observed.

Updated only the long live trial's count assumption to require two bounded
pause-delimited results for **both** languages. The former inference of count
solely from span/20000 cannot describe earlier boundaries. The original one-period
count, contiguous ranges, complete tail, authoritative identity/revision, actual
invocation/sample accounting, capture/inference overlap, <=20% CER/WER, all meaning
anchors, <2000 ms latency, zero loss, mapping/isolation/playback and fault gates
remain. Earlier cuts can also occur in the five-copy decoded tests, so their
count must fall within **ceil(duration/20000)–ceil(duration/10000)** and every
non-final range must be **10–20 s** (formerly only <=30 s). Contiguous coverage
through exact EOF, every sample/sentence/hash, zero loss, aggregate <=20% CER/WER
and all five occurrences of each meaning anchor remain required. The existing
DC signal test still explicitly requires the forced **20+11 s** split. No failed
candidate or fixture was removed.

### Final real browser evidence

`caffeinate -disu npm run test:framework:chrome:stream`: **PASS, exit 0**,
`chrome-20261007-4-pause-stream-final.log`. Typecheck, **14 port/normalizer tests /
101.382375 ms**, build and every original/final real assertion pass. Owned headed
Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node **v24.15.0**,
npm **11.12.1**, uv **0.12.23**, unchanged Transformers.js **4.3.0**/locked ORT.
Same small FP16 WebGPU model:
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
files / **487960440 bytes**. Each of the two browser invocations downloaded this
one inventory in its fresh owned context and reused its cache thereafter. No new
dependency, model, fixture or default. The final run preceded final repository
verification, with no concurrent verify workload.

| Three-period live input | Raw 48 kHz samples / chunks | Normalized samples | Returned ranges ms | Actual host calls ms | CER/WER | Last-packet-to-text ms | Peak pending ms | Maximum mapping error ms | Baseline / peak RSS KiB |
| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| Japanese | 1007616 / 492 | 335872 | 60–11860; 11860–20992 | 1223.400; 977.600 | **3/120 = 2.5% CER** | 978.600 | 12995.375 | 45.899 | 3649696 / 3655680 |
| English | 962560 / 470 | 320853 | 40–11200; 11200–20053.3125 | 1016.600; 798.800 | **3/66 = 4.54545% WER** | 800.900 | 12162 | 43.831 | 3099728 / 3099728 |

Both live trials preserve **all anchor counts exactly 3**, **0 ms discarded /
0 pending**, contiguous ranges and complete EOF. Japanese now actually cuts
before the forced maximum. During its first inference, delivered normalized input
advances **11860.6875→13055.375 ms**; English advances **11220.6875→12202 ms**.
These are real selected-video acquisition/inference overlaps, not decoded PCM or
expected text supplied to the live path. No independent acoustic labeling or
causal/repeatability claim beyond these observed trials is made.

| Five-copy decoded input | Samples / duration ms | Returned ranges ms | Actual host calls ms | Host run ms | CER/WER | Peak pending ms | Baseline / peak RSS KiB |
| --- | --- | --- | --- | ---: | --- | ---: | --- |
| Japanese | 557780 / 34861.25 | 0–11780; 11780–23040; 23040–34861.25 | 1142.400; 1014.400; 1160.100 | 36022.000 | **5/200 = 2.5% CER** | 12900 | 1555872 / 3846912 |
| English | 533320 / 33332.5 | 0–11140; 11140–21360; 21360–33332.5 | 997.500; 875.200; 964.200 | 34298.900 | **5/110 = 4.54545% WER** | 12100 | 1903376 / 3685952 |

Every decoded-input meaning anchor occurs **exactly 5** times. Three contiguous
segments per language meet the tightened 10–20 s non-final range gate, exact
sample/range coverage, **0 ms loss / 0 pending** and unchanged accuracy gates.
No appended silence or source sample deletion. The only scored edits here are
numeric spelling changes, which remain edits. This is decoded synthetic input,
separate from live selected-video acquisition and natural speech qualification.

Original checks also pass:

- All six paced decoded utterances retain **2.5% CER / 4.54545% WER** and every
  meaning anchor. Preparation **54891.633875 / 1236.911916 ms**; endpoint-to-result
  **747.300–870.800 / 669.800–714.500 ms**, peak pending **8180 / 7780 ms**,
  zero loss/drained. RSS baseline/peak KiB **1289600/3216160 / 2725936/3802864**.
- Three original completed live rounds: Japanese twice **2.5% CER**, English
  **4.54545% WER**, raw/normalized samples **337920/112640** twice and
  **323584/107861**, last-packet-to-text **866.500 / 843.300 / 751.100 ms**.
  Stop: `cancelled`, no text, **900.6875 ms discarded / 0 pending**. Capture
  detaches, repeat Start, both videos' original playback state and pre-filter
  isolation pass. Maximum mapping error across all six rounds **51.212333 ms**.
- Injected unpaced overload: **29940 ms discarded / 29840 ms peak pending**;
  sequence gap **100 ms**; invocation-observed cancel **7480 ms**; idle actual
  GPU-device destruction **7180 ms**, all with zero transcripts/pending and no
  fallback. Pure zero PCM: **0 ASR calls / 0 transcripts / 0 loss**.
- Active actual GPU loss/recovery: interrupted Japanese/English jobs discard
  **7480 / 7180 ms**, no text, no automatic worker replacement; retry remains
  `gpu-lost` with caller PCM retained. Explicit same-host cached Prepare takes
  **1230.973000 / 1232.318417 ms**, **0 HTTPS requests**; three fresh-epoch trials
  each retain **2.5% CER / 4.54545% WER**, all meaning anchors and zero loss.
  Recovered endpoint-to-result **773.400–885.800 / 649.100–759.900 ms**, peak
  pending **8180 / 7780 ms**. Interrupted-job accuracy remains **unverified**.
- Page errors, native visibility events and accuracy failures are `[]`;
  original pinned-model/network-path checks pass.

Overall owned browser-tree RSS baseline **1276624 KiB**. RSS is sampled every
250 ms for the owned browser/renderers/GPU process tree and includes shared-page
double counting and allocator retention; it is not isolated GPU/model allocation,
leak freedom, device pressure or phone memory. Host calls/endpoints use one
document clock, exclude speech accumulation/translation/display, and are individual
observations or three-trial ranges, not percentiles or ten-minute throughput.
No independent speaker-output-level measurement is added in this iteration.

### Command ledger and qualification limits

- PASS: final `npm run verify`, **exit 0**, `chrome-20261007-4-verify-final.log`:
  Biome **106 files / 47 ms / no findings**, Ruff/typecheck/unchanged companion
  build, **100 JS passed / 0 failed/skipped/cancelled / 21331.810166 ms**,
  **222 Python passed / 66.90 s**. This verifies final 2 kHz production/tests;
  subsequent edits only complete these Markdown evidence records.
- PASS: interim `npm run verify`, **exit 0**, `chrome-20261007-4-verify.log`:
  Biome **106 files / 35 ms / no findings**, Ruff/typecheck/unchanged companion
  build, **100 JS passed / 0 failed/skipped/cancelled / 22054.464666 ms**,
  **222 Python passed / 66.94 s**. This covered the interim 3 kHz source and
  overlapped the first browser run's early trials; it is not final 2 kHz verification.
- PASS: final cutoff's `npm run typecheck` and fourteen speech/normalizer tests,
  **0 failed/skipped/cancelled / 102.450333 ms**, `chrome-20261007-4-unscaled-port.log`.
  The preceding 3 kHz typecheck/fourteen tests also passed (**95.957667 ms**),
  `chrome-20261007-4-pause-port.log`. Both use synthetic signals/fake executors.
- FAIL then fixed: initial targeted Biome **exit 1** for the new test's returning
  `forEach` callback. Used a block callback; subsequent three-file Biome checks
  **exit 0 / 9 ms and 18 ms / no findings**.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261007-4-stage-acceptance.log`: `Missing script: "test:framework:chrome"`.
  Package scripts are unchanged. B5's full selected-video → ASR → Korean
  translation → DOM acceptance remains unimplemented. No placeholder or B2-only
  substitution was added and no identical retry was made.
- PASS: final document-inclusive unstaged/staged `git diff --check`, exit 0;
  intended files committed and post-commit worktree cleanliness checked before
  delivery. No temporary `.ralph` state is staged.

**Next unfinished item remains B2:** broader speech/noise/boundary recognition,
sustained queue/GPU recovery/memory qualification, conversion/distribution licensing
and an evidence-based default. Prior tiny/WASM and candidate semantic failures
remain recorded and were not rerun without new evidence. The finite synthetic
fixture trials do not establish natural VAD, storage/GPU pressure, leak freedom,
ten-minute backlog/loss, full offline interpretation, Korean translation/revisions/
caption DOM, external-site installation, or Safari/iPhone behavior. Those remain
**unverified**. No checkbox is changed; no stage/whole-framework/iPhone completion
is claimed. No required environment/device/permission blocker was observed in
either browser invocation; no blocked/stage-complete terminal marker applies.

No root/nested AGENTS.md or requested independent runner file
`2026-10-07T12-30-44-825Z-chrome-verification.txt` exists. Supplied instructions,
plan, architecture and previous report were read. All changes stay in this worktree.
Published companion v0.1.0/installation/native messaging/server paths, settings,
unrelated files and user apps/recordings/mounted images remain unchanged. No agents,
runner edits, stage advance, push/publish/app installation or browser access/profile/
permission bypass. Only test-owned browser/profile resources are cleaned up.
Credentials, model/runtime weights, user audio/transcripts and ignored `.ralph`
logs/state are excluded from the commit.

## 2026-10-07 — B2 sustained decoded-input qualification (iteration 5/5)

Related commit: `test: measure sustained browser ASR processing`, containing
this report. **B2 remains unchecked; no default is selected.** Only B2 advances.

### Change and observable acceptance

Retained the existing five-period continuous regression and added **at least
600 seconds per language** to the same real streaming harness. Each longer run
repeats complete original, hash-checked speech periods: **87 Japanese / 91
English**. OfflineAudioContext decodes/resamples the original videos to 16 kHz;
the harness concatenates every sample, including the isolation tags, without
appended silence, gain changes, removed sentences or expected text in ASR input.
It delivers 100 ms packets at real-time cadence to the production speech port,
ASR host and actual small FP16 WebGPU worker. This is **paced decoded synthetic
PCM, not a ten-minute live selected-video session or Korean-caption pipeline**.

All original short/live/fault/recovery trials and candidate/fixture/accuracy
failures remain. The sustained runs require <=20% aggregate CER/WER, each aggregate
meaning-anchor count >= the repeat count, complete contiguous EOF coverage,
10–20 s non-final ranges, exact actual invocation/sample correspondence,
zero discarded audio, <=30 s pending input and a drained final queue. Every
sustained segment must additionally meet the existing long-live **<2000 ms
endpoint-to-text** limit. Actual input runtime must cover the supplied duration.
Per-minute queue maxima/final pending/loss and minute RSS snapshots are recorded;
no unevaluated memory ceiling or leak-free claim is introduced.

Only the test harness changes. Model/backend/profile/defaults, production
segmentation/normalization, companion/settings, dependency lock, fixture bytes,
package scripts and later stages are unchanged. The loop requires about twenty
additional minutes for the two sustained runs; it does not accelerate or pause
a user's video to hide inference backlog.

### Actual command ledger and measurements

- **FAIL:** `caffeinate -disu npm run test:framework:chrome:stream`, **exit 1**,
  one real browser invocation, `chrome-20261007-5-sustained-stream.log` under
  ignored `.ralph/media-framework/`. Typecheck, **14 port/normalizer tests /
  0 failed/skipped/cancelled / 94.436583 ms**, build and every original browser
  regression pass. Both new sustained trials complete. The sole final failure
  is `en/continuous-91: missing repeated meaning anchors`. No retry of this
  unchanged quality failure, no sentence/candidate deletion or threshold change.
- **FAIL:** required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261007-5-stage-acceptance.log`: `Missing script:
  "test:framework:chrome"`. B5's selected-video → ASR → Korean translation →
  caption DOM acceptance is still unimplemented. No B2 substitute/placeholder.
- **PASS:** local Python recorded-result equality check: the sustained English
  text is exactly **83 complete normalized fixture periods**, each with
  `three` → `3`, rather than 91. **8 × 22 missing words + 83 numeric
  substitutions = 259 edits**. This analyzes the actual returned text; it is
  not another inference run, acoustic diagnosis or proof of a segmentation cause.
- **PASS:** final `npm run verify`, **exit 0**,
  `chrome-20261007-5-verify.log`: Biome **106 files / 46 ms / no findings**,
  Ruff/typecheck/unchanged companion build, **100 JS passed / 0 failed/skipped/
  cancelled / 21502.833291 ms**, **222 Python passed / 66.96 s**. All source/
  test changes are covered; subsequent edits only finish Markdown evidence.
- **PASS:** `node --check tests/framework-chrome-stream.mjs`, targeted Biome
  **1 file / 9 ms / no findings**, preliminary whitespace checks, all exit 0.
  Final document-inclusive/staged whitespace and committed cleanliness are
  checked before delivery.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, locked test Python
**3.12.15** (system `python3` used for result analysis is **3.9.6**). Unchanged
Transformers.js **4.3.0** and locked ORT, small FP16 WebGPU,
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
files / **487960440 bytes**. This invocation prepares one inventory in a fresh
owned context and reuses its cache. No new model/dependency/default. Repository
verification starts after the browser invocation; it does not overlap inference.

| Sustained decoded input | Periods / samples / packets | Input / host duration ms | Segments; non-final min–max / final duration ms | CER/WER | Endpoint-to-text min–max ms | Actual host-call min–max ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| Japanese | 87 / 9705372 / 6066 | 606585.750 / 607531.700 | 53; 10000–12560 / 9145.750 | **93/3480 = 2.672414% CER** | 944.300–1226.100 | 944.100–1225.900 | 13840 | 1669936 / 3759536 / 1491888 |
| English | 91 / 9706424 / 6067 | 606651.500 / 607591.600 | 46; 10220–13340 / 11971.500 | **259/2002 = 12.937063% WER** | 659.000–1092.600 | 658.900–1092.000 | 14420 | 1679552 / 3599072 / 1471600 |

Japanese passes all sustained assertions, with each meaning-anchor count
**exactly 87**. English passes aggregate <=20% WER but **fails meaning**: each
of `not meet today`, `station tomorrow`, `in the afternoon` and
`not cancel the reservation` occurs **83**, below required **91**. The complete
PCM was delivered and accounted for by contiguous actual jobs through exact EOF;
this is missing recognized speech, not reported input loss. Zero discarded
samples or fast inference cannot make it successful transcription. Its causal
relationship to segmentation/model behavior is **unverified**. Japanese's 93
edits are retained too; they are not all asserted to be numeric substitutions.

Both languages have **0 ms reported audio loss / 0 final pending**, authoritative
session/epoch/utterance/source-revision/final identity, exact actual invocation
samples/ranges and every segment below 2000 ms endpoint-to-text. Both full-band
quiet maxima are **0 ms**, below the unchanged 500 ms endpoint gate: this remains
carrier-tagged synthetic speech, not natural silence/noise qualification. Fresh
worker preparation for these sustained runs is **1339.427459 / 1345.693541 ms**,
not transcription latency.

| Completed minute | Japanese max / last pending ms | English max / last pending ms | Japanese RSS snapshot KiB | English RSS snapshot KiB |
| --- | --- | --- | ---: | ---: |
| 1 | 13160 / 2100 | 14400 / 11960 | 2515568 | 2552128 |
| 2 | 13140 / 3640 | 14400 / 5300 | 2383088 | 2486160 |
| 3 | 13720 / 4960 | 14400 / 11960 | 2356784 | 2440832 |
| 4 | 13760 / 7800 | 14400 / 5300 | 2211712 | 2436336 |
| 5 | 13800 / 9340 | 14400 / 11980 | 2239152 | 2370576 |
| 6 | 13660 / 2300 | 14400 / 5300 | 2224592 | 2403472 |
| 7 | 13840 / 3740 | 14400 / 11960 | 1498896 | 2357904 |
| 8 | 13660 / 8060 | 14400 / 5200 | 1416832 | 2058400 |
| 9 | 13700 / 12280 | 14400 / 11980 | 1440800 | 2065392 |
| 10 | 13820 / 2560 | 14420 / 5320 | 1460016 | 1434128 |

Every minute reports **0 discarded ms**. The final partial minute peaks at
**9145.750 / 11971.500 ms**, then drains to zero. Initial RSS snapshots are
**2787536 / 2814928 KiB**; minute snapshots occur within **0.244 / 0.239 s**
after their nominal boundaries. RSS is sampled every 250 ms for only the owned
browser process tree; the table is one snapshot per minute, not minute peaks.
The overall peaks include preparation. Shared-page double counting, retained
allocators, browser/renderers/GPU process and harness-owned combined/packet PCM
copies contribute. These observations do not isolate GPU/model memory, establish
leak freedom or impose a hardware-pressure/mobile limit. Queue/latency use the
document clock; RSS uses the Node clock, with no cross-clock subtraction.
Latency excludes speech accumulation and translation/display; ranges are observed
extrema across 53/46 jobs, not population percentiles.

The original regressions pass in this same invocation:

- Six short paced decoded trials: **2.5% CER / 4.54545% WER**, every meaning
  anchor, zero loss/drained, peak pending **8180 / 7780 ms**. Initial preparation
  **52652.379792 / 1237.573917 ms**; endpoint-to-text **772.000–839.600 /
  666.000–747.900 ms**.
- Five completed live selected-video rounds: short Japanese twice/English once
  **2.5% CER / 4.54545% WER**, last-packet-to-text **843.800 / 842.700 /
  779.500 ms**; raw/normalized samples **337920/112640** twice,
  **323584/107861**. Three-period Japanese/English retain every anchor 3 times,
  **3/120 CER / 3/66 WER**, **971.000 / 782.500 ms** final-packet-to-text,
  samples **1007616/335872 / 962560/320853**. All completed rounds have zero
  loss/drained; maximum mapping error across all six rounds **51.270 ms**.
  Pre-filter isolation, both videos' playback state, capture detach/repeat Start
  pass. Stop emits `cancelled`, no text, **920.6875 ms discarded / 0 pending**.
- Original five-period decoded regressions: three segments each, **5/200 CER /
  5/110 WER**, all anchor counts exactly 5, zero loss/drained, peak pending
  **12900 / 12200 ms**, input **34861.250 / 33332.500 ms**, host run
  **36036.600 / 34289.200 ms**. These stay independent of the longer failure.
- Injected overload/gap/invocation-observed cancel/idle actual GPU loss discard
  **29940 / 100 / 7480 / 7180 ms**, no text/pending or fallback. Pure zero PCM
  makes zero actual ASR calls/text/loss. Active actual GPU loss discards
  **7480 / 7180 ms**; same-host explicit cached Prepare **1234.995416 /
  1241.883750 ms**, **0 HTTPS requests**, three fresh-epoch trials per language
  retain **2.5% CER / 4.54545% WER**, all anchors, zero loss/drained.
  Interrupted-job accuracy and sustained pressure recovery remain unverified.
- Page errors, native visibility events are `[]`; original pre-live pinned
  model/network assertion passes. Final failure list contains only the
  sustained English meaning failure above. Only owned test resources close.


### Remaining scope and preservation

Next unfinished item remains **B2**, first the sustained English missing-speech
quality failure above, then broader natural speech/noise/boundary recognition,
sustained live acquisition and recovery under pressure, storage/GPU
memory limits, conversion/distribution licensing and evidence-based default
selection. Historical failed tiny/WASM and candidate semantic outcomes remain;
they are not rerun without new evidence. Learned VAD, leak freedom, hardware
pressure, complete offline interpretation, ten-minute live PCM → ASR → Korean
translation → caption DOM, external installation, B3–B6 and Safari/iPhone remain
**unverified**. No required environment/device/permission was absent in this
invocation. This is a quality failure/incomplete implementation, so neither
blocked nor stage-complete marker applies. No checkbox or stage/whole-framework/
iPhone completion claim.

No root/nested AGENTS.md or requested independent runner file
`2026-10-07T12-30-44-825Z-chrome-verification.txt` exists. Supplied instructions,
plan, architecture and previous report were read. Work stays in this worktree.
Published companion v0.1.0/install/native messaging/server paths, user settings,
unrelated files/apps/recordings/mounted images are preserved. No agents, runner
edits, stage advance, push/publish/app installation or browser access/profile/
permission bypass. Only test-owned browser/profile resources are cleaned up.
Credentials, model/runtime weights, user audio/transcripts and ignored `.ralph`
logs/state are excluded from the commit.
