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

## 2026-10-08 — B2 repeated-speech decoding regression (iteration 1/20)

Related commit: `fix: preserve repeated speech in browser ASR`, containing this
report. **B2 remains unchecked; no default is selected.** Only B2 advances.

### Failing regression and implementation

Analyzed the preceding sustained English run: eight individual 13.32–13.34 s
jobs omitted one full speech period despite complete contiguous PCM coverage.
Replayed those exact sample ranges and a neighboring passing range through the
production FP16 host/worker, reconstructing samples from the unchanged,
hash-checked decoded fixture period. No stored transcript, expected text, gain
change, silence padding or replacement samples enter inference.

The pre-change diagnostic independently reproduced all eight omissions: each
required English meaning occurred once instead of twice. The neighboring
128040–141380 ms job retained both periods. This establishes a recognition
failure on those PCM ranges, independent of live acquisition or paced delivery;
it does not establish the model's internal cause. Evidence:
`chrome-20261008-1-replay-before.log` under ignored `.ralph/media-framework/`.
The process ended with an uncaught `AssertionError` (actual 1, expected 2);
its shell exit status was not captured, so that status is **unverified**.

The worker now requests `return_timestamps: true` for the experimental FP16
profile. The unchanged q8 baselines use false. Language/transcribe task,
256-token bound, model/backend, sample ranges, segmentation, queue budgets,
cache identity and authoritative source revision remain unchanged. This uses
Whisper's timestamp logits processor to guide decoding; the host still returns
text with its original job range. It does not expose or claim accurate model
word/segment timestamps. The installed Transformers.js 4.3.0 Whisper generator
skips its seek loop when `max_new_tokens` is explicit, so this retains bounded
single-job generation rather than introducing retries or a second ASR pass.
The [Transformers.js ASR API](https://huggingface.co/docs/transformers.js/api/pipelines)
documents timestamp generation; actual quality/latency is established below.

The post-change diagnostic passes all nine ranges, **exit 0**, with every meaning
exactly twice; host calls **1098.800–1615.600 ms**. Evidence:
`chrome-20261008-1-replay-timestamps.log`. The permanent streaming harness now
retains these nine regressions, asserting <=20% WER, exactly two occurrences of
each meaning, authoritative identity/revision/range/sample counts, and <2000 ms
host calls. In the final full run all nine score **2/44 = 4.545455% WER**, with
**1100.200–1201.500 ms** host calls. Numeric `three` → `3` remains an edit.
Every original candidate, failing baseline, fixture/sentence/hash/isolation tag,
accuracy/meaning/latency gate and sustained check is preserved.

### First full-run failure and fixture interaction

First `caffeinate -disu npm run test:framework:chrome:stream` returns **exit 1**,
`chrome-20261008-1-stream.log`: typecheck, **14 port/normalizer tests /
101.506750 ms**, six short ASR trials, nine replays, fault/recovery checks and
short/live Japanese boundary scoring pass. The final English live round fails
unchanged playback-state equality: its volume changes **0.25 → 0.8845703125**.
Its later scoring and all continuous trials are **not reached**.

An independent lightweight owned-browser diagnostic passes **30 native button
cycles**, **exit 0**, without reproducing that volume mutation. It observes the
Prepare button at **x=656.421875, y=173** beside videos ending at y=188, on the
native media-control row. It uses actual fixture playback but substitutes button
handlers and performs no inference; this is UI diagnosis, not ASR acceptance.
Evidence: `chrome-20261008-1-controls.log`. The mutation's exact cause remains
**unverified**. The live harness now uses trusted keyboard Enter activation for
Prepare/Start/Stop, avoiding pointer movement alongside native volume controls.
Actual activation, visible-document/model readiness, native media controls and
all playback/volume/mute/rate/source equality assertions remain required. The
final run passes them; no browser access denial or profile/permission workaround
is involved, and no production playback behavior or user setting is changed.

### Final real browser measurements

Final `caffeinate -disu npm run test:framework:chrome:stream`: **PASS, exit 0**,
`chrome-20261008-1-stream-final.log`; typecheck, **14 port/normalizer tests /
0 failed/skipped/cancelled**, production build and all real browser assertions.
This is real FP16 WebGPU ASR on synthetic fixture PCM, with separate short and
three-period **live selected-video** paths. The ten-minute trials remain
**paced decoded synthetic PCM**, not ten-minute live Korean-caption acceptance.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, locked test Python
**3.12.15**; unchanged Transformers.js **4.3.0** / locked ORT. Same small FP16
WebGPU model `onnx-community/whisper-small` at
`36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven files / **487960440 bytes**.
Four model-bearing browser invocations each prepare one fresh inventory and reuse
its owned cache; the lightweight control diagnostic downloads no model. No new
model/dependency/default or committed weights/profile. Verification follows
inference and does not overlap its measurements.

| Sustained decoded input | Periods / samples | Input / host duration ms | Segments; non-final / final duration ms | CER/WER | Endpoint-to-text min–max ms | Actual host-call min–max ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| Japanese | 87 / 9705372 | 606585.750 / 607630.000 | 53; 10000–12560 / 9145.750 | **96/3480 = 2.758621% CER** | 1018.600–1338.100 | 1018.500–1337.900 | 13940 | 1762192 / 3659248 / 1529456 |
| English | 91 / 9706424 | 606651.500 / 607720.800 | 46; 10220–13340 / 11971.500 | **91/2002 = 4.545455% WER** | 973.700–1260.000 | 973.400–1259.300 | 14600 | 1610672 / 3214608 / 1460016 |

**Every meaning occurs exactly 87 / 91 times**, rather than the previous English
83. Both retain exact contiguous sample/range coverage through EOF, zero reported
discard and zero final pending. A local Python comparison passes: final English
text normalizes to exactly 91 original fixture periods with `three` → `3`,
explaining all 91 edits. Japanese retains 96 edits, versus the previous 93;
this small CER increase is recorded rather than normalized away. Sustained
fresh-worker preparation **1434.215375 / 1544.304375 ms** is model loading,
not recognition latency. Full-band quiet maxima remain 0 ms, so this still
qualifies carrier-tagged synthetic repetition rather than natural VAD/noise.

| Completed minute | Japanese max / last pending ms | English max / last pending ms | Japanese RSS snapshot KiB | English RSS snapshot KiB |
| --- | --- | --- | ---: | ---: |
| 1 | 13360 / 2100 | 14500 / 11960 | 2473200 | 2832784 |
| 2 | 13240 / 3640 | 14540 / 5300 | 1545408 | 1411744 |
| 3 | 13920 / 4960 | 14500 / 11960 | 1526096 | 1425136 |
| 4 | 13860 / 7800 | 14600 / 5300 | 1534304 | 1396096 |
| 5 | 13940 / 9340 | 14500 / 11980 | 1552672 | 1406032 |
| 6 | 13760 / 2300 | 14500 / 5300 | 1553904 | 1409152 |
| 7 | 13940 / 3840 | 14500 / 11960 | 1500272 | 1394560 |
| 8 | 13860 / 7960 | 14500 / 5200 | 1490384 | 1401472 |
| 9 | 13900 / 12280 | 14500 / 11880 | 1503392 | 1403456 |
| 10 | 13920 / 2460 | 14520 / 5320 | 1496288 | 1400464 |

All minute windows report **0 discarded ms**; final partial-minute peaks are
**9145.750 / 11971.500 ms**, then drain to zero. Initial RSS snapshots are
**2791344 / 3045824 KiB**; minute snapshots occur within **0.105 / 0.199 s** of
their boundaries. Overall browser-tree baseline is **1291152 KiB**. RSS samples
every 250 ms include browser/renderers/GPU process, shared-page double counting,
allocator retention and harness PCM copies. These are observations, not isolated
GPU/model allocation, leak freedom, storage/hardware pressure or phone limits.
Latency uses one document clock after endpoint delivery, excludes accumulation,
translation/display and reflects observed ranges, not population percentiles.
RSS uses a separate Node clock with no cross-clock subtraction.

Original regressions also pass:

- Six short decoded trials retain **2.5% CER / 4.545455% WER**, every meaning,
  zero loss/drained queues; endpoint-to-text **831.100–997.200 /
  746.000–858.800 ms**, peak pending **8280 / 7880 ms**. Initial preparation
  **54323.660709 / 1448.657750 ms** is not recognition latency.
- Five-period decoded inputs retain every meaning five times, **5/200 CER /
  5/110 WER**, three contiguous segments each, zero loss/drained. Host durations
  **36128.800 / 34387.800 ms**, peak pending **13000 / 12200 ms**.
- Five completed live rounds retain **2.5% CER / 4.545455% WER** and all meanings
  once/three times. Three-period Japanese/English ranges are **80–11860 /
  11860–20992 ms** and **60–11200 / 11200–20053.3125 ms**. Raw/normalized
  samples **1007616/335872 / 962560/320853**; last-packet-to-text
  **1034.300 / 845.100 ms**, pending peaks **13060.6875 / 12270 ms**. Real
  delivery advances during inference; maximum mapping error across all rounds
  **65.915 ms**. Short final-packet-to-text **987.400 / 929.400 / 905.900 ms**.
  Explicit Stop emits cancelled/no text, **835.375 ms discarded / 0 pending**.
  Capture detach/repeat Start, pre-filter source isolation and both videos'
  original playback/volume/mute/rate/source states pass.
- Injected overload/gap/invocation-observed cancel/idle actual GPU loss discard
  **29940 / 100 / 7480 / 7180 ms**, no text/pending/fallback. Pure zero PCM
  makes **0 actual ASR calls / 0 transcripts / 0 loss**. Active actual GPU loss
  discards **7480 / 7180 ms** with no text; same-host explicit cached recovery
  takes **1231.844916 / 1232.938958 ms**, **0 HTTPS requests**, and all six
  fresh-epoch utterances retain prior accuracy/meaning and zero loss. Accuracy
  of interrupted jobs and sustained recovery under pressure remain unverified.
- Page errors, native visibility events and final accuracy failures are `[]`;
  original pinned-model/network gates pass. No independent speaker measurement
  or external-site installation claim is added.

### Required acceptance and remaining work

- PASS: final `npm run verify`, **exit 0**, `chrome-20261008-1-verify.log`:
  Biome **106 files / 47 ms / no findings**, Ruff/typecheck/unchanged companion
  build, **100 JS passed / 0 failed/skipped/cancelled / 21024.682459 ms**,
  **222 Python passed / 67.01 s**. All production/harness changes are covered;
  subsequent edits only complete these Markdown records.
- PASS: final streaming command above, **exit 0**, **14 port tests /
  101.968292 ms** and all real browser assertions. One final invocation, no
  retry of its passing result. Earlier full invocation's failure is retained.
- PASS: standalone typecheck and targeted Biome for the two source/test files,
  **2 files / 21 ms / no findings**; script syntax and whitespace checks,
  exit 0. Final document-inclusive/staged whitespace and committed cleanliness
  are checked before delivery.
- FAIL then corrected: initial post-run Python summary extractor, **exit 1**,
  `KeyError: 'gpuRecoveries'` after printing sustained/live results. Corrected
  to the actual `gpuRecoveryRuns` field; extraction and exact normalized-English
  equality analysis **exit 0**. This is recorded-result analysis, not inference.

Required full-stage `npm run test:framework:chrome` is **FAIL, exit 1**, once,
`chrome-20261008-1-stage-acceptance.log`: `Missing script: "test:framework:chrome"`.
B5 full selected-video → ASR → Korean translation → DOM acceptance is still
unimplemented; no placeholder or ASR-only replacement is added.

Next unfinished item remains **B2**: broader natural speech/noise/boundary
recognition, sustained live acquisition/recovery under pressure, storage/GPU
memory limits, conversion/distribution licensing and evidence-based default
selection. Prior q8 numerical/semantic failures remain recorded and were not
rerun without new evidence. Model timestamp accuracy, learned VAD, full offline
interpretation, ten-minute live Korean captions, B3–B6, external installation,
Safari and iPhone remain **unverified**. No checkbox or selected-stage/
whole-framework/iPhone completion claim. No required environment/device/
permission was absent; neither terminal marker applies.

No root/nested AGENTS.md or requested independent runner file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` exists at the initial read.
Supplied instructions, plan, architecture and previous report were read. Work
stays in this worktree. Published companion v0.1.0/install/native messaging/server
paths, settings and unrelated files/apps/recordings/mounted images are preserved.
No agents, runner edit, stage advance, push/publish/app installation or browser
access/profile/permission bypass. Only owned test browser/profile resources are
cleaned up. Credentials, model/runtime weights, user audio/transcripts and ignored
`.ralph` state/logs are excluded from the commit.


## 2026-10-08 — B2 deterministic noise qualification (iteration 2/20)

Related commit: `test: expose browser ASR noise quality failures`, containing
this report. **B2 remains unchecked; no default is selected.** Only B2 advances.

### Implementation and observable acceptance

Added `npm run test:framework:chrome:noise`, a separate real-browser evaluation
of the existing production speech recognizer, ASR host and small FP16 WebGPU
worker. Extending the existing synthetic corpus is the smaller first step before
acquiring a natural-speaker corpus or introducing another detector/model. The
existing comparison, streaming/sustained harness, candidates, hashes, isolation
tags, sentences, numerical/meaning/latency gates and failed baselines are intact.
No production inference, segmentation, PCM normalization, model/default, user
setting, dependency lock, companion or later-stage implementation changes.

For each language, five deterministic cases run at real-time cadence:

- Six seconds of white noise with nominal RMS **0.006**, below the existing
  0.01 frame-energy gate: require zero actual ASR calls and zero text.
- Six seconds of white noise with nominal RMS **0.02**, and separately a
  **120 Hz sine hum / RMS 0.04**: require no nonempty recognized text. A model
  returning an empty string is permitted; generated speech on these known
  speech-free signals fails even if latency and queue accounting pass.
- Three complete decoded original speech periods with **0.006 / 0.02** additive
  white noise, **600 ms leading gap**, then each original period followed by
  zero alignment to the next 20 ms frame and **800 ms gap**. Noise is added
  across the entire input, including gaps. The low-noise case must retain three
  endpoints; both require <=20% aggregate CER/WER and every preserved meaning
  exactly three times. The louder-noise case additionally requires contiguous
  actual job coverage from sample zero through exact EOF.

White noise uses xorshift32 seeded **0x12345678**, mapped to a uniform signal
with amplitude `sqrt(3) * nominal RMS`. No speech samples/sentences or isolation
tags are removed, gain-scaled, clipped or replaced; expected text never enters
inference. Noise and gaps are explicit new fixture conditions. Each actual job
is compared sample-for-sample to its mixed input range before transfer; input
and job SHA-256, actual samples/ranges, identity/epoch/final/source revision,
preparation, host calls, endpoint-to-text, queues and owned browser-tree RSS
are recorded. Audio remains ephemeral; no new audio or model bytes are committed.
Latency remains <2000 ms after actual endpoint delivery, retained input <=30 s,
zero reported discard and a drained queue. Cases accumulate quality failures
so both languages finish; the command exits nonzero on any of them.

### Actual command ledger and environment

- FAIL: first `caffeinate -disu npm run test:framework:chrome:noise`, **exit 1**,
  `chrome-20261008-2-noise.log` under ignored `.ralph/media-framework/`.
  Typecheck/build and actual model readiness pass, preparation
  **64741.750333 ms**. Before the first trial, `page.evaluate` cannot access the
  module-scoped `createSpeechRecognizer` import. Exposed that import through the
  owned fixture's global object. **No noise inference or quality was reached.**
  The targeted lint initially reports one informational template-style finding
  (exit 0); corrected it before the next browser invocation.
- FAIL: corrected same command, **exit 1**, once,
  `chrome-20261008-2-noise-final.log`. Typecheck/build, all **10 completed cases /
  14 actual ASR jobs**, accounting/identity/ranges/latency/queue checks and pinned
  model/network checks execute. **Seven cases / nine quality assertions fail**,
  detailed below. No retry of this unchanged quality failure.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-2-stage-acceptance.log`: missing script. B5's full selected-
  video PCM → ASR → Korean translation → caption DOM acceptance is unimplemented;
  the new B2 command does not replace it or add a placeholder success.
- PASS: `node --check tests/framework-chrome-noise.mjs`, targeted Biome
  **1 file / 26 ms / no findings**, preliminary whitespace checks, exit 0.
- PASS: local Python analysis of recorded results, exit 0: all ten cases
  complete with zero final pending/discard and every actual job equals its input
  slice. Louder-noise English normalizes to exactly **two** original speech
  periods with `three` → `3`: **22 missing words + 2 numeric edits = 24 edits**.
  This is result analysis, not another inference or a passing quality outcome.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**; unchanged
Transformers.js **4.3.0** / locked ORT. Same small FP16 WebGPU model
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`,
seven files / **487960440 bytes**. Two browser invocations each prepare one fresh
inventory, then reuse their owned cache; the first performs no inference.
The completed run initially prepares in **56440.175833 ms**; its nine fresh
cached workers prepare in **1217.414917–1221.528584 ms**. These are loading times,
not transcription latency. All remote paths are pinned model artifacts/allowed
redirects (**14 unique paths**, exactly **7 pinned primary file paths**).
Page errors and native visibility events are `[]`. No missing environment,
device or permission was observed; no browser access/profile/permission bypass.

### Recognition results and accounting

Values below are observed single-case results/ranges, rounded to 0.001 ms;
raw per-job evidence remains in the named log, not population percentiles.
Every case reports **0 discarded ms / 0 final pending**. This does not establish
successful recognition on a failed case. Low-noise controls make no ASR call,
so their lack of text is energy-gating evidence, not transcription accuracy.

| Language / input | Input / host duration ms | Actual jobs / samples | CER/WER or no-speech text | Meaning / outcome | Endpoint-to-text ms | Peak pending ms |
| --- | --- | --- | --- | --- | --- | ---: |
| Japanese / quiet noise | 6000 / 6004.000 | 0 / 0 | No text | PASS | No inference | 0 |
| Japanese / white noise | 6000 / 6513.500 | 1 / 96000 | ご視聴ありがとうございました | FAIL: fabricated speech | 513.200 | 6000 |
| Japanese / hum | 6000 / 6444.500 | 1 / 96000 | ご視聴ありがとうございました | FAIL: fabricated speech | 444.600 | 6000 |
| Japanese / speech + quiet noise | 23940 / 24572.700 | 3 / 119680 each | **3/120 = 2.5% CER** | All seven anchors exactly 3; PASS | 871.800–987.300 | 8100 |
| Japanese / speech + white noise | 23940 / 24792.900 | 2 / 248960 + 134080 | **49/120 = 40.833333% CER** | Anchor counts 1 or 2; FAIL accuracy/meaning | 852.200–964.300 | 16500 |
| English / quiet noise | 6000 / 6001.200 | 0 / 0 | No text | PASS | No inference | 0 |
| English / white noise | 6000 / 6406.700 | 1 / 96000 | Thank you. | FAIL: fabricated speech | 405.900 | 6000 |
| English / hum | 6000 / 6383.500 | 1 / 96000 | you | FAIL: fabricated speech | 383.300 | 6000 |
| English / speech + quiet noise | 23040 / 23522.000 | 3 / 114880 each | **4/66 = 6.060606% WER** | `not meet today` only 2; other anchors 3; FAIL meaning | 721.100–837.700 | 7700 |
| English / speech + white noise | 23040 / 23762.600 | 2 / 240960 + 127680 | **24/66 = 36.363636% WER** | Every anchor only 2; FAIL accuracy/meaning | 722.000–797.900 | 15800 |

English low-noise third-period text says `we will not need today` instead of
`we will not meet today`; its passing numerical gate cannot override the failed
meaning gate. Japanese louder noise substitutes meeting/station/time words and
returns fewer repeated meanings. Its counts are **会議 1, しません 2, 明日 1,
午後 1, 駅 1, 予約 2, 取り消さない 2**. No normalization removes these errors.
Neither model-internal causes nor a specific segmentation cause are established.

Original decoded Japanese/English samples per period are **111556 / 106664**;
noisy speech inputs total **383040 / 368640** samples. Japanese low-noise job
ranges are **600–8080 / 8380–15860 / 16160–23640 ms**, English
**600–7780 / 8080–15260 / 15560–22740 ms**. Only known below-gate gap noise is
skipped at these endpoints. Louder noise uses **0–15560 / 15560–23940 ms**
Japanese and **0–15060 / 15060–23040 ms** English, with every input sample in
an actual job through EOF. Missing recognized periods are not input loss.
Across all fourteen jobs, actual host calls range **381.700–982.000 ms**;
endpoint-to-text **383.300–987.300 ms**, excluding speech accumulation,
translation/display. Job sample equality and authoritative identity/revisions
pass even where their text is wrong.

Measured white-noise RMS for six-second controls is **0.006005269 / 0.020017564**,
hum **0.04**. For noisy speech, the logged `snrDb` includes the original isolation
carrier and is averaged over the **entire waveform including gaps**; it is not
speech-only SNR. Japanese low/high values **18.166835 / 7.709260 dB**, English
**19.091265 / 8.633690 dB**. Mixed peaks **0.232694 / 0.256783 / 0.237575 /
0.253527**, all below 1 without clipping. Noise is synthetic stationary white
noise/a sine, not natural room noise, music or independent acoustic labeling.

| Language / input | Baseline / peak / final owned browser-tree RSS KiB |
| --- | --- |
| Japanese / quiet noise | 1300320 / 3772816 / 3497680 |
| Japanese / white noise | 2232640 / 3806288 / 2242384 |
| Japanese / hum | 2201472 / 3813360 / 2886368 |
| Japanese / speech + quiet noise | 1773216 / 3634048 / 2772880 |
| Japanese / speech + white noise | 1769920 / 3720160 / 2074912 |
| English / quiet noise | 1601984 / 3695824 / 2362704 |
| English / white noise | 2238256 / 3657104 / 2954880 |
| English / hum | 1796304 / 3756928 / 2985440 |
| English / speech + quiet noise | 1840176 / 3498944 / 2166304 |
| English / speech + white noise | 1545216 / 3819920 / 1950544 |

Overall baseline **1296128 KiB**. RSS samples every 250 ms include preparation,
shared-page double counting, allocator retention and browser/renderers/GPU
process. These are observations, not isolated model/GPU allocation, leak freedom,
hardware/storage pressure or mobile limits. Latency uses one document clock;
RSS uses Node's clock without subtracting different clock origins.


### Required verification, next item and preservation

PASS: final `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-2-verify.log`: Biome **107 files / 48 ms / no findings**,
Ruff/typecheck/unchanged companion build, **100 JS passed / 0 failed/skipped/
cancelled / 21766.127792 ms**, **222 Python passed / 66.90 s**. Verification
starts after noise inference; measurements do not overlap its workload. Subsequent
edits complete only these Markdown records. Final document-inclusive unstaged/
staged whitespace, intended commit and clean worktree are checked before delivery.

**Next unfinished item remains B2:** improve speech-free noise rejection and the
recorded noisy speech meaning/repetition failures while retaining these cases,
original fixtures and gates, then rerun real qualification. The new noise command
must pass before using its scope to qualify a default. A phrase blacklist,
expected-text injection, sample/sentence removal or relaxed quality criterion
would not establish that qualification. Broader natural speech/boundary/noise,
sustained live acquisition/recovery under pressure, storage/GPU memory limits,
conversion/distribution licensing and evidence-based default selection remain
unfinished. Existing preparation/comparison/streaming commands are **not rerun
this iteration** because their source is unchanged; their historical evidence,
including failed candidates, is retained without claiming a fresh pass.

Learned VAD, natural-speaker robustness, model timestamp accuracy, full offline
interpretation, ten-minute live PCM → ASR → Korean captions, B3–B6, external
installation and Safari/iPhone remain **unverified**. This is a measured quality
failure and incomplete B2 implementation, with no missing required environment,
device or permission; neither blocked nor stage-complete marker applies. No
checkbox, default or stage/whole-framework/iPhone completion claim is added.

No root/nested AGENTS.md or requested independent runner file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` exists at initial read.
Supplied instructions, plan, architecture and previous report were read. Work
stays in this worktree. Published companion v0.1.0/install/native messaging/server
paths, settings and unrelated files/apps/recordings/mounted images are preserved.
No agents, runner edit, stage advance, push/publish/app installation or browser
access/profile/permission bypass. Only owned test browser/profile resources are
closed/removed. Credentials, weights, user audio/transcripts and ignored `.ralph`
state/logs are excluded from the commit.

## 2026-10-08 — B2 learned speech detector evaluation (iteration 3/20)

Related commit: `test: evaluate learned browser speech detection`, containing
this report. **B2 remains unchecked; no ASR default is selected.** Only B2
advances. The production recognizer still uses its experimental energy detector;
the iteration 2 ASR noise hallucinations and noisy meaning/repetition failures
are unresolved and remain recorded. No transcription is performed in this new
detector evaluation, and its success does not qualify transcription accuracy.

### Implementation, candidate and fixed gates

Added `npm run test:framework:chrome:vad`, an isolated test worker and a real
headed Chromium evaluator. Qualifying a detector before changing production
segmentation is the smaller first step. No production port, model repository,
ASR worker/decoding/segmentation/normalizer, dependency/lock, default or setting
changes. The original ASR comparison, streaming and noise commands, models,
sentences, fixture bytes/tags and every acceptance gate are intact. This new
command is separate from the required full Chrome acceptance.

The candidate is `onnx-community/silero-vad` at immutable revision
`e71cae966052b992a7eca6b17738916ce0eca4ec`, full-precision `onnx/model.onnx`,
**2,243,022 bytes**, SHA-256
`a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808`.
[Pinned Hub inventory](https://huggingface.co/api/models/onnx-community/silero-vad/revision/e71cae966052b992a7eca6b17738916ce0eca4ec?blobs=true)
supplied the revision, size and LFS hash; ordinary public metadata retrieval
returned HTTP 200. The [model card](https://huggingface.co/onnx-community/silero-vad/blob/e71cae966052b992a7eca6b17738916ce0eca4ec/README.md)
declares MIT and the [pinned LICENSE](https://huggingface.co/onnx-community/silero-vad/blob/e71cae966052b992a7eca6b17738916ce0eca4ec/LICENSE)
contains the Silero Team MIT notice (HTTP 200, 1,075 bytes). These concern this
VAD artifact, not unresolved Whisper conversion/distribution licensing. No
upstream Silero major version or natural-language coverage is inferred from
the conversion's name. Model bytes/notices are not packaged for distribution.

Actual execution uses the already locked ORT Web **1.31.0-dev.20260914-8d85527a0**,
WASM only, one thread, dedicated module worker, packaged plain WASM runtime
**14,264,838 bytes** and its JS factory. No new dependency/backend or fallback.
The [upstream wrapper](https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/utils_vad.py)
documents 16 kHz, 512 new samples plus 64 context samples and recurrent state
`[2,1,128]`; actual browser graph names are `input/state/sr` and `output/stateN`.
Each independent input resets context/state. Only the final detector frame is
zero-padded; input sample coverage and padding are recorded separately. This
does not pad, filter or remove any speech supplied to ASR, since ASR is not run.

The same ten iteration 2 noise cases are reproduced sample-for-sample. Golden
mixed-input hashes from that run are committed in the evaluator, and both the
document and actual worker must match them. Every source-video hash/sample,
three complete periods, isolation tag, seeded noise, leading/inter-period gap
and gain is unchanged; no expected text enters model inference. All frames
cover the input contiguously through EOF, after exclusively transferring PCM.
They run at real-time 32 ms cadence, rather than accelerated offline inference.

Gates declared before the first run: fixed **0.5** model-specific activity
threshold; every known noise-only case must have **zero** active frames; each
known complete speech period must contain **>=250 ms** of detected activity;
total actual inference must consume **<10% of input duration**. The speech gate
measures presence, not phoneme recall, word boundaries or transcript meaning.
No accepted frame-by-frame speech labels exist for these synthetic periods.
The full ASR <=20% CER/WER, exact meaning counts, zero loss and latency gates
remain in the unchanged ASR harnesses and are not replaced by these probe gates.

### Actual command ledger and environment

- FAIL then corrected: preliminary `npm run typecheck`, **exit 1**, TS2322:
  inferred `TypedTensor<"float32">` cannot accept the runtime's general `Tensor`
  output. Annotated the recurrent state with the actual exported `Tensor` type;
  subsequent browser commands typecheck successfully. No model run reached this
  compile failure. Preliminary two-file Biome, syntax and whitespace **exit 0**.
- PASS: first `caffeinate -disu npm run test:framework:chrome:vad`, **exit 0**,
  `chrome-20261008-3-vad.log` under ignored `.ralph/media-framework/`.
  Typecheck/build, all ten paced cases and offline cached-worker zero control
  pass. Preparation **1759.900 ms**, offline preparation **99.800 ms**. After
  this invocation started, strengthened final-code accounting to count all
  HTTPS requests during offline work, not just unique paths, and assert that
  identical controls reset recurrent state after intervening speech. These
  additional assertions are qualified by the separate final run below.
- PASS: final same command, **exit 0**, `chrome-20261008-3-vad-final.log`.
  Typecheck/build, all ten cases/**4,066 actual detector calls**, all hashes,
  exclusive transfer, sample/range/cadence/padding, activity/performance gates,
  identical-control recurrent reset and offline checks pass. Fresh preparation
  **1751.700 ms**; cached fresh-worker offline preparation **99.900 ms**, then
  **32 actual zero-control calls**, maximum probability **0.012012064**,
  **zero HTTPS requests**. Preparation is loading time, not inference latency.
  No third invocation or unchanged failure retry.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-3-stage-acceptance.log`: `Missing script:
  "test:framework:chrome"`. B5 full selected-video PCM → ASR → Korean translation
  → DOM acceptance remains unimplemented; no placeholder/substitute is added.
- PASS: final two-file targeted Biome **4 ms / no findings**, script syntax and
  preliminary whitespace, **exit 0**. Recorded-result summary extraction first
  failed **exit 1 / SyntaxError** from a malformed shell heredoc terminator;
  corrected extraction **exit 0**. This is result analysis, not inference.
- PASS: final `caffeinate -disu npm run verify`, **exit 0**,
  `chrome-20261008-3-verify.log`: Biome **109 files / 34 ms / no findings**,
  Ruff/typecheck/unchanged companion build, **100 JS passed / 0 failed/skipped/
  cancelled / 21725.9045 ms**, **222 Python passed / 66.86 s**, Python
  **3.12.15**. Verification starts after both detector invocations, without
  inference/test workload overlap. Subsequent changes finish only these records.
- PASS: separate recorded-result comparison, **exit 0**: all ten complete
  probability arrays, input hashes and period activity measurements are exactly
  equal across the two independent browser invocations. This analyzes real
  predictions; it does not perform new inference or establish ASR accuracy.

Final document-inclusive unstaged/staged whitespace checks, intended commit
and clean worktree are checked before delivery; ignored `.ralph` evidence is
excluded from staging.

Environment observed again: owned headed Chromium **153.0.8010.12**, macOS
**26.6.2 / 25G83 arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**.
Each of two successful invocations downloads this single **2,243,022-byte**
model once into its own evaluation cache/profile, verifies size/hash, then
loads that cache in a fresh worker offline. Locally bundled WASM is separately
cached. The final run sees exactly two unique HTTPS paths: the immutable model
and its Hub Xet artifact redirect. Page errors and native visibility events
are `[]`. No browser access, permission or required environment is absent.

### Final measured detector results and limits

Japanese speech inputs contain **383,040 samples / 23,940 ms**, English
**368,640 / 23,040 ms**, with original period lengths **111,556 / 106,664**.
Controls each contain **96,000 / 6,000 ms**. Japanese speech gets **448** final
detector padding samples, controls **256**, English speech **0**. These padding
counts are excluded from real sample coverage and activity-duration statistics.
The table reports observed values rounded to 0.001 ms, not percentiles.

| Language / input | Active / actual frames | Maximum probability | Activity ms in each complete speech period | Total / max frame inference ms | Worker duration / maximum delivery lag ms | Baseline / peak / final owned RSS KiB |
| --- | --- | ---: | --- | --- | --- | --- |
| Japanese / quiet noise | 0 / 188 | 0.048502624 | No speech | 152.900 / 7.300 | 6002.700 / 5.200 | 1584128 / 1632576 / 1632096 |
| Japanese / white noise | 0 / 188 | 0.039015114 | No speech | 138.500 / 2.400 | 6002.700 / 5.200 | 1632096 / 1633616 / 1633776 |
| Japanese / hum | 0 / 188 | 0.203411162 | No speech | 126.700 / 1.600 | 6003.500 / 5.100 | 1633776 / 1634624 / 1637968 |
| Japanese / speech + quiet noise | 600 / 749 | 0.999292493 | 6356.250 / 6328.250 / 6364.250 | 524.700 / 1.600 | 23946.300 / 6.100 | 1638000 / 1755216 / 1738288 |
| Japanese / speech + white noise | 610 / 749 | 0.999487519 | 6484.250 / 6424.250 / 6364.250 | 497.700 / 1.500 | 23945.200 / 5.200 | 1738336 / 1762320 / 1762688 |
| English / quiet noise | 0 / 188 | 0.048502624 | No speech | 126.300 / 1.500 | 6002.200 / 5.200 | 1762752 / 1763072 / 1763008 |
| English / white noise | 0 / 188 | 0.039015114 | No speech | 125.300 / 1.500 | 6003.200 / 5.200 | 1763040 / 1763440 / 1763440 |
| English / hum | 0 / 188 | 0.203411162 | No speech | 124.800 / 1.400 | 6001.300 / 5.200 | 1763472 / 1764496 / 1764208 |
| English / speech + quiet noise | 609 / 720 | 0.999265790 | 6370.500 / 6362.500 / 6322.500 | 481.600 / 1.700 | 23042.200 / 5.500 | 1764224 / 1780096 / 1776352 |
| English / speech + white noise | 606 / 720 | 0.999298453 | 6370.500 / 6426.500 / 6418.500 | 472.100 / 1.400 | 23044.200 / 5.200 | 1776400 / 1791728 / 1790320 |

There are seven unique mixed PCM inputs: the three noise controls are each run
twice with intervening speech; their complete probability arrays are exactly
equal after per-input state reset. The first invocation also has the identical
per-case probability arrays/activity counts, verified from recorded results.
This finite repeatability is not natural speech/noise robustness. The strongest
noise-only probability is hum's **0.203411162**, below the fixed threshold.
All inference totals use <10% of input duration. Worker-frame cadence, duration
and inference use one worker clock; RSS uses Node's separate clock without
subtracting origins. No ASR/caption latency is measured.

Overall browser-tree baseline **1,286,560 KiB**. RSS samples every 250 ms include
the browser/renderers/GPU process, shared-page double counting, retained
allocators and ephemeral harness PCM. VAD execution is WASM; an incidental GPU
process in the RSS sum is not GPU inference evidence. These observations do
not establish isolated model memory, simultaneous VAD+ASR memory, leak freedom,
storage/hardware pressure or mobile limits. No user audio/transcript is saved.
The recorded peak field captures periodic samples through inference before the
separate final RSS snapshot; that later snapshot can slightly exceed the field.

### Remaining B2 work and preservation

**Next unfinished item remains B2:** integrate a qualified learned detector once
at the browser pipeline boundary with production model-cache/lifetime/queue
ownership, then rerun the retained real ASR noise/meaning/repetition gates.
The present evaluator does not segment or recognize speech and cannot establish
that detector-guided cuts preserve words. The original production noise quality
failure is historical and unresolved; unchanged ASR/preparation/streaming/noise
commands were not rerun this iteration. Their historical passes and failed
candidates remain evidence, not fresh results. Broader natural speakers/noise/
boundaries, sustained live acquisition/recovery under pressure, storage/GPU
memory limits, Whisper conversion/distribution licensing and evidence-based
ASR default selection remain unfinished.

Production learned VAD, full offline interpretation, Korean translation/revision/
caption DOM, ten-minute live end-to-end, B3–B6, external installation and all
Safari/iPhone behavior remain **unverified**. No missing required environment,
device or permission was observed, so neither terminal marker applies. No
checkbox or selected-stage/whole-framework/iPhone completion claim is added.

Root/nested AGENTS.md and requested independent runner evidence file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent at initial read.
Supplied instructions, plan, architecture and previous Chrome report were read.
Work stays in this worktree; companion v0.1.0/install/native messaging/server,
settings and unrelated files/apps/recordings/mounts are preserved. No agents,
runner edit, stage advance, push/publish/app installation or browser access/
profile/permission bypass. Only owned test browsers/profiles are closed/removed.
Credentials, model/runtime weights, user audio/transcripts and temporary ignored
`.ralph` state/logs are excluded from the commit.

## 2026-10-08 — B2 learned speech admission (iteration 4/20)

Related commit: `feat: gate browser ASR with learned speech detection`, containing
this report. **B2 remains unchecked; no ASR default is selected.** Only B2 changes.

### Implementation and fixed acceptance

Integrated the previously evaluated Silero candidate with the production model
registry/repository, a document host and a dedicated WASM worker. Preparation
reports absent/downloading/cached/loading/ready with identity and bounded progress;
ready requires an actual ORT session. The worker verifies cached model size/hash
again before loading. Its cache is independent of every ASR precision and of the
previous isolated evaluator. The existing repository owns download cancellation,
quota/offline failures and cache writes. No dependency or lock change.

Candidate: `onnx-community/silero-vad`, immutable revision
`e71cae966052b992a7eca6b17738916ce0eca4ec`, full-precision `onnx/model.onnx`,
**2,243,022 bytes**, SHA-256
`a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808`.
The prior pinned MIT/card/license evidence remains; no new upstream major-version
or Whisper conversion/distribution licensing claim. Locked ORT Web
**1.31.0-dev.20260914-8d85527a0**, one-thread WASM, local plain runtime
**14,264,838 bytes**, separately cached/excluded from model progress.

One host owns one recurrent detector stream: **512 new samples + 64 context at
16 kHz**, state `[2,1,128]`, fixed model-specific **0.5** speech threshold in the
production host. It admits one preparation/frame operation, transfers its own
bounded copy and retains recognizer PCM unchanged. Short detector frames mark EOF;
only VAD receives final zero padding. Stop/hidden/pagehide terminate the owned
worker and invalidate pending/late results; explicit Prepare creates fresh state.
Dispose removes host listeners. Workers validate envelopes, frames and results.

`createSpeechRecognizer` accepts this detector explicitly, awaits it once per
512-sample frame, and submits a candidate segment only if it contains detected
speech. The simpler admission gate is evaluated before replacing the endpoint
policy: the existing **500 ms energy endpoint**, speech-band pause after **10 s**,
**20 s segment / 30 s retained audio / one active + two queued jobs / two pending
results** remain. Learned framing is **32 ms**, the energy comparison remains
**20 ms**. ASR receives exact unfiltered input slices; VAD probabilities are not
ASR confidence. Detector failure fails the stream, with no automatic fallback.
Existing four-argument callers deliberately retain the original comparison
profile; no product default/setting changes. Full host/UI composition remains B4.

Added `npm run test:framework:chrome:noise:learned`, using the same ten noise cases
and every existing <=20% CER/WER, exact-three meanings, zero reported discard,
three low-noise endpoints, <2000 ms latency and louder-noise contiguous-zero-to-EOF
ASR coverage gate. Both modes now additionally assert the seven original mixed
PCM hashes from iteration 2. Original fixture hashes/tags/sentences, noise seed/
gain/gaps, failed candidate comparisons and every previous command/gate remain.
No expected text enters inference. Learned mode also requires all detector samples
through EOF, explicit padding, <10% duration in actual VAD inference and **zero
active frames and ASR calls** on each known speech-free control. Offline fresh
workers/zero-control and pending-host-request Stop are checked separately.

### Command ledger

All named logs are ignored `.ralph/media-framework/` evidence, excluded from Git.

- FAIL before fix: `node --import tsx --test tests/framework-browser-speech.test.ts`,
  **exit 1**, `chrome-20261008-4-regression.log`: **9 passed / 1 failed /
  120.415334 ms**. Energetic input reaches ASR despite the supplied negative
  detector; the intentional unexpected-ASR error becomes `engine-failed`.
- FAIL then corrected: initial `npm run typecheck`, **exit 1**, tool output
  **TS18046 / TS2322** for unknown response sample counts. Narrowed the count and
  validated against pending request metadata, including request type; subsequent
  typechecks pass. No inference reaches the compile failure.
- PASS: standalone updated speech tests, **10 passed / 101.030125 ms**, then
  speech/VAD transport tests **12 passed / 109.000792 ms**, and final production
  host-interface tests **12 passed / 197.124792 ms**, all **exit 0**; logs
  `chrome-20261008-4-unit{,-final,-final-host}.log`. Fake transport/executor only:
  PCM ownership, bounded admission, energetic-noise rejection, full energetic
  sample/range coverage, cancellation during a pending detector, invalid/late
  responses, EOF and suspension. These tests do not establish model accuracy.
- FAIL: first `caffeinate -disu npm run test:framework:chrome:noise:learned`,
  **exit 1**, `chrome-20261008-4-learned-noise.log`: typecheck/**12 port tests /
  89.079584 ms**, all ten real cases/**4,066 detector calls / 10 ASR jobs**, offline
  loading/control/Stop and accounting pass; four quality assertions fail on the
  two louder-noise speech cases. First joint preparation **54292.370 ms**.
  This run used a fixture wrapper to turn probability into a speech decision;
  afterwards moved that fixed threshold/decision into the production VAD host.
- FAIL: final same command, **exit 1**, `chrome-20261008-4-learned-noise-final.log`:
  typecheck/**12 port tests / 91.535250 ms**, all ten cases/**4,066 actual detector
  calls / 10 real ASR jobs**, every accounting/identity/latency/network/queue and
  offline assertion pass; the same **four** louder-noise quality assertions fail.
  This run covers the final host-owned decision interface. No third learned run.
- FAIL: `caffeinate -disu npm run test:framework:chrome:noise`, **exit 1**,
  `chrome-20261008-4-energy-noise.log`: typecheck/build, **10 cases / 14 real ASR
  jobs** complete; **seven cases / nine quality assertions fail**, reproducing
  the prior energy-profile results. Rerun checks preservation after the recognizer
  and model-registry changes. Cold preparation **56392.695792 ms**, subsequent
  **1217.039792–1322.526625 ms**. Both languages' louder-noise coverage, input
  hashes, zero reported queue loss/drained state and all latency checks pass.
- PASS: final recorded-result analysis, **exit 0**: all ten input hashes,
  complete detector probability arrays and actual transcript strings are exactly
  equal between the two learned browser invocations. Analysis is not inference.
- PASS: `caffeinate -disu npm run test:framework:chrome:preparation`, **exit 0**,
  `chrome-20261008-4-preparation.log`: typecheck/**6 repository tests /
  101.979958 ms**, build and **all 11 B1 browser assertions**, including native
  visibility, pending Stop, offline/corruption/eviction and original preparation
  UI. Unchanged tiny q8 inventory **43613734 bytes**, first actual load
  **9345.616042 ms**, cached offline load **540.388833 ms**, page errors `[]`.
  Expected injected offline/download/corrupt-cache errors and favicon 404 remain.
  This is loading/lifetime evidence, not transcription accuracy.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-4-stage-acceptance.log`: `Missing script:
  "test:framework:chrome"`. B5's full selected-video PCM → ASR → Korean
  translation → DOM acceptance is unimplemented; no substitute or placeholder.
- PASS: final targeted eight-file Biome **19 ms / no findings**, script syntax
  and preliminary whitespace, **exit 0**. Required `verify` is recorded below
  after completion; it starts after all inference/preparation browser commands.

### Final real measurements and scope

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**; unchanged Transformers.js **4.3.0**
and locked ORT. Actual small FP16 WebGPU ASR uses the unchanged pinned
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
files/**487960440 bytes**. Each of three noise browser invocations downloads
one such inventory in a fresh owned cache; the two explicit learned invocations
also download the single **2243022-byte** VAD model once each. Subsequent workers
reuse their own cache. No remote inference, companion or Ollama participates.

Final joint preparation **54769.621666 ms**; cached joint preparations
**1220.571458–1420.684375 ms**, not ASR latency. Final **16 unique HTTPS paths**
are pinned ASR/VAD model paths and allowed artifact redirects; page errors/native
visibility events `[]`. Cached fresh VAD and ASR workers reach real ready offline
with **zero HTTPS requests**. Actual offline VAD zero-frame probability
**0.012012064**, inference **7.900 ms**, **512 real samples / 0 padding**;
Stop rejects a second pending host request with `VAD stopped`, retaining **2048
caller PCM bytes**. This does not prove invocation-observed kernel cancellation,
offline speech ASR or offline interpretation.

Inputs are paced **100 ms decoded synthetic PCM packets**, not live selected-
element capture. Within each packet the recurrent detector runs serial 512-sample
frames; it is not a newly claimed uniform 32 ms delivery cadence. Japanese/English
speech inputs contain **383040 / 368640 samples**, original periods **111556 /
106664**, with all three source periods retained in the delivered input. Detector
final padding is **448 / 0** for speech and **256** for each 96000-sample control,
excluded from actual input duration/coverage. Every ASR job equals its supplied
mixed-input slice exactly. Quiet-input segmentation can omit initial/gap frames;
its ranges below are disclosed rather than asserting independently labeled phoneme
recall. Louder-noise jobs cover every input sample contiguously through exact EOF.

| Language / input | Input / host ms | Active VAD / ASR jobs | Accuracy | Meaning gate | Endpoint-to-text ms | Peak pending ms | VAD total / max-frame ms |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| ja / quiet-noise | 6000.000 / 6002.400 | 0 / 0 | No text | PASS, no ASR calls | No ASR | 28.000 | 121.800 / 8.900 |
| ja / white-noise | 6000.000 / 6001.000 | 0 / 0 | No text | PASS, no ASR calls | No ASR | 6000.000 | 129.500 / 13.300 |
| ja / hum | 6000.000 / 6001.700 | 0 / 0 | No text | PASS, no ASR calls | No ASR | 6000.000 | 128.700 / 14.100 |
| ja / speech-quiet-noise | 23940.000 / 24580.600 | 600 / 3 | 3/120 = 2.500000% CER | PASS, all counts 3 | 879.400–947.300 | 8136.000 | 438.800 / 9.500 |
| ja / speech-white-noise | 23940.000 / 24814.200 | 610 / 2 | 47/120 = 39.166667% CER | FAIL, counts 1–2 | 873.500–927.600 | 16500.000 | 450.100 / 11.500 |
| en / quiet-noise | 6000.000 / 6003.200 | 0 / 0 | No text | PASS, no ASR calls | No ASR | 28.000 | 128.700 / 10.100 |
| en / white-noise | 6000.000 / 6002.600 | 0 / 0 | No text | PASS, no ASR calls | No ASR | 6000.000 | 133.600 / 11.400 |
| en / hum | 6000.000 / 6002.500 | 0 / 0 | No text | PASS, no ASR calls | No ASR | 6000.000 | 132.600 / 12.400 |
| en / speech-quiet-noise | 23040.000 / 23530.600 | 609 / 3 | 3/66 = 4.545455% WER | PASS, all counts 3 | 730.300–844.100 | 7868.000 | 404.400 / 8.000 |
| en / speech-white-noise | 23040.000 / 23753.500 | 606 / 2 | 24/66 = 36.363636% WER | FAIL, counts 1–2 | 713.400–770.400 | 15700.000 | 423.300 / 9.500 |

Both louder-noise cases fail the **20% error and exact-three meaning gates**:
Japanese **47/120 = 39.166667% CER**, English **24/66 = 36.363636% WER**.
Japanese counts: 会議 **1**, しません **2**, 明日 **2**, 午後 **1**, 駅 **1**,
予約 **2**, 取り消さない **2**. Every English meaning occurs only **2** times.
Zero queue loss and actual VAD activity do not establish recognized speech.
Low-noise English now scores **3/66** and all counts 3, versus energy-only
**4/66** and `not meet today` count **2**; this does not isolate a causal model or
boundary improvement. All other energy-only quality failures remain: four noise
hallucinations; Japanese high-noise **49/120 CER**; English high-noise **24/66 WER**.

Learned low-noise Japanese ASR ranges **576–8096 / 8384–15872 / 16160–23648 ms**;
English **576–7808 / 8064–15264 / 15552–22752 ms**. Louder-noise Japanese ranges
**0–15584 / 15584–23940 ms**, samples **249344 + 133696**; English
**0–14976 / 14976–23040 ms**, samples **239616 + 129024**. All ten cases report
**0 discarded ms / 0 final pending**. Deliberately rejected speech-free context
is distinct from queue loss. Actual ASR host calls **707.300–944.800 ms**,
endpoint-to-text **713.400–947.300 ms**, using one document clock; VAD inference
uses its worker clock independently. These exclude speech accumulation,
translation/display and are finite observations, not population percentiles.

| Language / input | Baseline / peak / final owned browser-tree RSS KiB |
| --- | --- |
| ja / quiet-noise | 1298352 / 3481424 / 3030800 |
| ja / white-noise | 1776864 / 3839920 / 1724512 |
| ja / hum | 1540464 / 3437696 / 2347360 |
| ja / speech-quiet-noise | 1310368 / 3460096 / 1712240 |
| ja / speech-white-noise | 1670800 / 3273072 / 1342880 |
| en / quiet-noise | 1333856 / 3601408 / 1860800 |
| en / white-noise | 1845968 / 3567280 / 2974064 |
| en / hum | 1691568 / 3554064 / 2897024 |
| en / speech-quiet-noise | 1614128 / 3453792 / 1495984 |
| en / speech-white-noise | 1468544 / 3581712 / 1497744 |

Overall final RSS baseline **1296688 KiB**. Sampling every 250 ms includes joint
model preparation, browser/renderers/GPU process, shared-page double counting,
allocator retention and ephemeral harness PCM. This observes simultaneous VAD/
ASR residency, not isolated model/GPU allocation, pressure limits, leak freedom
or phone suitability. White noise/hum and speech are unchanged synthetic inputs;
natural room noise/music/speakers and independent acoustic labels remain unverified.

### Required verification, next unfinished work and preservation

PASS: final `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-4-verify.log`: Biome **112 files / 56 ms / no findings**,
Ruff/typecheck/unchanged companion build, **103 JS passed / 0 failed/skipped/
cancelled / 21695.400542 ms**, **222 Python passed / 66.90 s**, Python **3.12.15**.
All production/test sources are covered; subsequent edits complete only Markdown
records. Verification starts after all model/browser invocations. Final document-
inclusive unstaged/staged whitespace and committed cleanliness are checked before
delivery, excluding ignored `.ralph` evidence.

**Next unfinished item remains B2:** improve and evaluate louder-noise speech
meaning/repetition and accuracy with the retained fixtures/gates, then qualify
learned segmentation on broader natural speakers/noise/boundaries, live acquisition,
sustained queue/GPU recovery and memory/storage limits before selecting a default.
Admission alone does not solve these word/meaning failures. No phrase blacklist,
expected-text injection, removed period/sentence or relaxed score is introduced.
After the second learned run's same quality failures, no third attempt is made.

Full streaming/sustained ASR comparison commands and isolated VAD evaluation are
**not rerun this iteration**; their historical passing/failed evidence is retained,
not a fresh pass of the new learned profile. Learned live selected-element input,
quiet word-boundary/phoneme recall, combined active GPU loss/pressure recovery,
VAD-specific real cache eviction/corruption/storage exhaustion and long-running
memory are **unverified**. The generic fake repository faults/B1 checks cannot
substitute for these. Whisper conversion/distribution licensing, offline speech
recognition/full interpretation, Korean translation/revisions/DOM, ten-minute live
Korean captions, B3–B6, external installation and all Safari/iPhone behavior remain
unfinished. No required environment/device/permission was absent; these are measured
quality failures and unfinished implementation, so neither terminal marker applies.
No checkbox or selected-stage/whole-framework/iPhone completion claim is added.

Root/nested AGENTS.md and requested independent runner evidence file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent at initial read.
Supplied instructions, plan, architecture and prior Chrome report were read. Work
stays in this worktree; published companion v0.1.0/install/native messaging/server,
settings and unrelated files/apps/recordings/mounted images are preserved. No agents,
runner edit, stage advance, push/publish/app installation or browser access/profile/
permission bypass. Only owned explicit test browser/profile resources are closed/
removed. Credentials, model/runtime weights, user audio/transcripts and temporary
ignored `.ralph` logs/state are excluded from the commit.

## 2026-10-08 — B2 learned pause boundaries (iteration 5/20)

Related commit: `fix: split browser ASR at learned speech pauses`, containing this
report. **B2 remains unchecked; no ASR default is selected.** Only B2 advances.

### Implementation and retained acceptance

The prior learned admission profile rejected noise-only controls but retained
energy endpoints, merging louder-noise speech and losing repeated meanings.
This iteration uses the already resident detector to identify pauses. No extra
VAD pass, model, backend, dependency, retry or fallback is added. The energy-only
comparison keeps its previous endpoint and speech-band filter behavior.

The explicit learned profile observes at least **500 ms** of inactive frames,
then splits on the next active frame. The cut lies within one **32 ms / 512-sample**
frame of the pause midpoint, retaining context on both sides. Jobs are exact,
unfiltered input slices; retained context moves within the existing segment
buffer. This is a **delayed boundary policy**, not an immediate silence endpoint:
a long pause can defer submission until the next onset, EOF or the existing
**20 s** cap. These shorter synthetic gaps do not qualify long-silence first
caption latency. The **30 s** retained-audio budget, one active plus two queued
jobs, two pending results, identity/ranges/revisions and cancellation remain.
No product default or user setting changes.

All ten noise cases, seven mixed-input hashes, fixture hashes/tags/sentences/
periods, noise seed/gain/gaps and existing gates are unchanged: **<=20% CER/WER**,
every meaning **exactly three times**, three low-noise endpoints, contiguous
louder-noise ASR coverage **zero to exact EOF**, zero reported discard,
**<2000 ms** endpoint-to-text, actual VAD inference **<10%** of input duration,
and zero active VAD frames/ASR calls on speech-free controls. No acceptance
harness or package script is edited. Expected text never enters inference.

### Regression and initial command evidence

Logs below are ignored `.ralph/media-framework/` evidence, excluded from Git.

- FAIL before fix: `node --import tsx --test tests/framework-browser-speech.test.ts`,
  **exit 1**, `chrome-20261008-5-regression.log`: **11 passed / 1 failed /
  121.126125 ms**. Three detector-labeled utterances over energetic input merge
  into one **0–8640 ms** job instead of three contiguous jobs.
- PASS after first change: `npm run typecheck` and speech/VAD tests, **exit 0**,
  `chrome-20261008-5-unit.log`: **13 passed / 115.706167 ms**.
- FAIL found during review: same standalone speech command, **exit 1**,
  `chrome-20261008-5-alignment-regression.log`: **12 passed / 1 failed /
  139.594750 ms**. An odd-frame pause leaves half-frame context and later buffer
  overflow/`engine-failed`. Aligning cuts to detector frames restores the exact
  **20 s** maximum cut without padding ASR PCM. Subsequent typecheck passes.
- PASS: final speech/VAD tests, **exit 0**, `chrome-20261008-5-unit-final.log`:
  **15 passed / 182.174833 ms**. Fake detector/executor only: complete energetic
  PCM/ranges/EOF, odd-frame pause then maximum cut, pending-job overload/late
  result rejection, and retained transport/lifetime regressions. Not accuracy.
- FAIL: first `caffeinate -disu npm run test:framework:chrome:noise:learned`,
  **exit 1**, `chrome-20261008-5-learned-noise.log`: typecheck/**13 unit tests /
  97.120542 ms**, all ten real cases/**4066 detector calls / 12 ASR jobs** and
  accounting/hash/range/latency/network/offline/Stop gates complete. Sole failure:
  louder-noise Japanese meaning counts. Low/high Japanese **3/120 / 8/120 CER**;
  low/high English **3/66 / 4/66 WER**. Japanese high counts: 会議 **2**, 駅 **1**,
  others **3**; other speech cases retain all meanings three times. Build predates
  the frame-alignment correction/final overload test, so not final verification.
  Joint preparation **54488.666250 ms**. Fresh VAD/ASR workers load offline with
  zero HTTPS requests; actual VAD zero control **0.012012064 / 10.400 ms**.
  Pending VAD Stop rejects `VAD stopped`, retaining **2048 caller PCM bytes**.
  Page errors/native visibility events `[]`.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-5-stage-acceptance.log`: missing script. B5 full selected-video
  PCM → ASR → Korean translation → DOM acceptance remains unimplemented; no
  substitute or placeholder is added.
- PASS: targeted two-file Biome, **exit 0 / 23 ms / no findings**, and preliminary
  whitespace. Final browser/verify/commit evidence follows after execution.

### Final real browser evidence

FAIL: final same learned-noise command, **exit 1**,
`chrome-20261008-5-learned-noise-final.log`: typecheck/**15 unit tests /
121.145125 ms**, build and all ten real cases/**4066 VAD calls / 12 ASR jobs**,
all hash/PCM/range/revision/accounting/network/offline/Stop/latency assertions
pass. Sole failure is the same louder-noise Japanese exact-three meaning gate.
No third attempt is made. All error-rate gates now pass; this does **not** turn
the remaining meaning failure into acceptance.

| Language / input | Input / host ms | Active VAD / ASR jobs | Accuracy | Meaning | Endpoint-to-text ms | Peak pending ms | VAD total / max-frame ms |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| ja / quiet-noise | 6000.000 / 6006.000 | 0 / 0 | No text | PASS | No ASR | 28 | 113.900 / 9.500 |
| ja / white-noise | 6000.000 / 6006.100 | 0 / 0 | No text | PASS | No ASR | 6000 | 132.600 / 8.100 |
| ja / hum | 6000.000 / 6004.600 | 0 / 0 | No text | PASS | No ASR | 6000 | 132.900 / 10.400 |
| ja / speech-quiet-noise | 23940.000 / 24829.000 | 600 / 3 | 3/120 = 2.500000% CER | PASS | 888.300–1494.300 | 9104 | 429.400 / 11.000 |
| ja / speech-white-noise | 23940.000 / 24801.800 | 610 / 3 | 9/120 = 7.500000% CER | FAIL | 860.900–1356.200 | 9500 | 431.100 / 18.700 |
| en / quiet-noise | 6000.000 / 6003.700 | 0 / 0 | No text | PASS | No ASR | 28 | 137.600 / 9.500 |
| en / white-noise | 6000.000 / 6002.400 | 0 / 0 | No text | PASS | No ASR | 6000 | 131.900 / 11.900 |
| en / hum | 6000.000 / 6001.800 | 0 / 0 | No text | PASS | No ASR | 6000 | 129.800 / 12.400 |
| en / speech-quiet-noise | 23040.000 / 23734.500 | 609 / 3 | 3/66 = 4.545455% WER | PASS | 694.200–1271.600 | 8656 | 418.500 / 11.300 |
| en / speech-white-noise | 23040.000 / 23765.300 | 606 / 3 | 4/66 = 6.060606% WER | PASS | 724.100–1216.700 | 9000 | 429.100 / 8.100 |

Japanese high-noise counts: 会議 **2**, しません **3**, 明日 **3**, 午後 **3**,
駅 **1**, 予約 **3**, 取り消さない **3**. Every meaning in the other three speech
cases occurs **3** times. Compared with iteration 4's learned admission, louder-
noise Japanese error falls from **47/120** to **9/120** and English from **24/66**
to **4/66**. These comparisons concern this synthetic corpus; they do not establish
natural noise robustness or independent phoneme recall. The earlier failures
and every candidate remain preserved. No blacklist or expected-text injection.

Final ASR ranges, in ms:

- Japanese low: **576–8096 / 8096–15872 / 15872–23940**.
- Japanese high: **0–8128 / 8128–15872 / 15872–23940**.
- English low: **576–7744 / 7744–15264 / 15264–23040**.
- English high: **0–7712 / 7712–15200 / 15200–23040**.

Every job exactly equals its supplied mixed-input slice. High-noise inputs cover
all **383040 / 368640 samples** contiguously to EOF; low-noise initial context
omission is disclosed above. All cases finish with **0 pending / 0 reported
lost ms**. Deliberately rejected speech-free context is distinct from queue loss.
The detector covers every actual input sample, with final detector-only padding
**448 Japanese / 0 English / 256 control samples**. ASR receives no padding.
Actual ASR host calls **690.800–986.700 ms**; endpoint-to-text includes waiting
for the next onset after the midpoint cut, and excludes prior speech accumulation,
translation and display. Both use one document clock. VAD inference uses its
worker clock independently; RSS uses Node time. No different origins subtracted.
These are finite observations, not population latency percentiles.

Final joint preparation **54992.495667 ms**, cached joint preparations
**1218.996959–1422.250708 ms**; these are loading, not transcription latency.
Fresh cached VAD/ASR workers reach ready offline with **0 HTTPS requests**.
Real VAD zero control: **0.012012064 probability / 8.700 ms / 512 input samples /
0 padding**. Pending host-request Stop rejects `VAD stopped` and retains **2048
caller PCM bytes**. This is not offline speech ASR/full interpretation or an
invocation-observed kernel cancellation check. Final allowed remote paths **16**,
page errors/native visibility events `[]`.

| Language / input | Baseline / peak / final owned browser-tree RSS KiB |
| --- | --- |
| ja / quiet-noise | 1296256 / 3276432 / 3081552 |
| ja / white-noise | 3084112 / 3741024 / 3282608 |
| ja / hum | 1946832 / 3775600 / 3295280 |
| ja / speech-quiet-noise | 1977952 / 3821840 / 1536528 |
| ja / speech-white-noise | 1506688 / 3391680 / 1639776 |
| en / quiet-noise | 1642256 / 3619504 / 2204752 |
| en / white-noise | 1725840 / 3560272 / 2220864 |
| en / hum | 1564048 / 3749408 / 2723264 |
| en / speech-quiet-noise | 2723360 / 3669680 / 1724320 |
| en / speech-white-noise | 1724416 / 3844528 / 1642816 |

Overall baseline **1294672 KiB**. RSS sampled every 250 ms sums only the owned
browser/renderers/GPU process, including shared-page double counting, retained
allocators, joint preparation and ephemeral PCM. These are not isolated model/GPU
allocations, pressure limits, leak freedom or phone suitability.

### Scope, remaining acceptance and preservation

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**; unchanged Transformers.js **4.3.0**
and locked ORT. Actual small FP16 WebGPU ASR remains
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
files/**487960440 bytes**. Silero WASM VAD remains
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`, one file/
**2243022 bytes**. Each explicit browser invocation downloads one of each inventory
in a fresh owned cache, then subsequent workers reuse it. No remote inference,
companion or Ollama. Inputs are **100 ms paced decoded synthetic PCM**, not
live selected-element acquisition, natural speech/noise or uniform 32 ms delivery.

**Next unfinished item remains B2:** improve louder-noise Japanese meaning,
qualify natural speakers/noise/word boundaries and delayed long-silence latency,
then select a default only from passing evidence. Learned live capture, sustained
queue/GPU-loss recovery, actual storage/eviction/corruption/pressure limits and
long-running memory remain unverified; Whisper conversion/distribution licensing
remains unfinished. Energy-only noise, full ASR comparison/stream/sustained,
isolated VAD and B1 preparation UI commands are not rerun this iteration. Their
historical passes/failures remain historical, not final learned-profile passes.

Offline speech ASR/full interpretation, Korean translation/revisions/DOM,
ten-minute live Korean captions, B3–B6, external installation and all Safari/
iPhone behavior remain **unverified**. No required environment/device/permission
is absent; measured quality failure/unfinished implementation warrants neither
terminal marker. No checkbox or stage/framework/iPhone claim is added.

Root/nested AGENTS.md and requested independent runner file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent at initial read.
Supplied instructions, plan, architecture and prior Chrome evidence were read.
Work stays in this worktree. Companion v0.1.0/install/native messaging/server/
settings and unrelated files/apps/recordings/mounted images are preserved.
No agents, runner edit, stage advance, push/publish/app installation or browser
access/profile/permission bypass. Only owned explicit test browsers/profiles are
cleaned up. Credentials, model/runtime weights, user audio/transcripts and
ignored temporary `.ralph` evidence/state are excluded from the commit.

### Final required verification

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-5-verify.log`: Biome **112 files / 51 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**106 JS passed / 0 failed/skipped/cancelled / 21536.304625 ms**,
**222 Python passed / 66.91 s**, Python **3.12.15**. Runs after both actual browser
invocations; subsequent edits only finish Markdown records. This does not
supersede the real Japanese quality failure or missing full Chrome acceptance.

PASS: document-inclusive `git diff --check` and `git diff --cached --check`,
**exit 0**. Staged paths are only the plan, this report, the speech recognizer
and its regression tests; no ignored `.ralph` evidence/state is staged. The
intended commit and post-commit worktree cleanliness are checked before delivery.


## 2026-10-08 — B2 bounded learned silence (iteration 6/20)

Related commit: `fix: bound learned ASR silence submission`, containing this
report. **B2 remains unchecked; no default ASR model is selected.** Only B2
advances. The earlier louder-noise Japanese meaning failure is preserved.

### Change and observable acceptance

Assumption: the explicit experimental learned profile should submit detected
speech during a long pause while input remains open. The simpler bounded pause
cut fits the existing detector and segment buffer; no timer, extra detector,
model/backend, retry, fallback, dependency, public option or setting is added.
Short detected pauses retain the previous next-onset midpoint cut. After
**>=1,500 ms** of inactive detector samples (**1,504 ms** at full 32 ms frames),
the recognizer submits without another onset/EOF and retains **256 ms / 4,096
samples** for the next segment. All submitted PCM remains exact unfiltered input.
Continuous segmentation, the 20 s cap, 30 s retained budget, one active plus two
queued jobs, two pending results and identity/cancellation rules remain intact.

The new unit regression holds input open after 32 active and 47 inactive frames;
the old implementation produces no result. The fixed implementation submits
**0–2,272 ms**, retaining **256 ms**, before EOF/another onset. A second regression
checks resumed speech receives exact contiguous retained context and a speech-free
EOF tail produces no extra ASR job. Synthetic detectors/executors prove boundary,
accounting and cancellation behavior only; their strings are not accuracy evidence.

Added standalone `node tests/framework-chrome-silence.mjs`, using existing real
WASM VAD and FP16 WebGPU ASR in an owned headed Chromium. These are **new additive
cases**: two complete copies of each unchanged decoded Japanese/English fixture,
600 ms leading context, >=5 s between speech periods and after the last period,
seeded 0.006 RMS white noise, and 100 ms paced delivery. Both videos retain their
original bytes, tags and full sentences. The ten-case noise harness, its three
periods, mixed hashes, exact-three meaning counts, <=20% error, range/EOF and
latency gates are unchanged. This new check does not replace that acceptance.

Declared new-case criteria: actual text before the next onset or EOF, **<3,000 ms**
from the last real detector-active frame's delivery, existing **<2,000 ms** from
ASR range-end delivery, **<=20% CER/WER**, every meaning exactly twice for the two
new periods, every original speech sample covered by exact ASR slices, contiguous
job ranges, zero reported loss/final pending, existing queue/segment limits,
detector coverage/padding and inference <10% input duration. Input hashes from
the first independent run are pinned for the final run. Expected text is used
only to score outputs, never as an inference prompt or input.

### Command ledger

All evidence files below are ignored local `.ralph/media-framework/` logs; no
weights, PCM, user transcripts, credentials or temporary state enter Git.

- FAIL before fix: `node --import tsx --test tests/framework-browser-speech.test.ts`,
  **exit 1 / 14 passed / 2 failed / 171.103709 ms**,
  `chrome-20261008-6-regression.log`. Open-stream long silence never submits;
  energetic speech-free EOF context stays attached until **7,424 ms**.
- PASS after fix: `node --import tsx --test tests/framework-browser-speech.test.ts tests/framework-browser-vad.test.ts`,
  **exit 0 / 17 passed / 0 failed/skipped/cancelled / 143.194042 ms**,
  `chrome-20261008-6-unit.log`; `npm run typecheck`, **exit 0**.
- PASS: explicit local Node/tsx replay of all four historical real detector
  schedules over synthetic energetic PCM, **exit 0 / four cases**,
  `chrome-20261008-6-schedule-replay.log`. Every job range equals iteration 5's
  recorded range, including EOF. This proves branch/range equivalence for those
  schedules, **not a real PCM/model/accuracy rerun**. Recorded pauses are at most
  **928 ms** after speech, below the new limit. No third unchanged attempt at
  iteration 5's twice-observed Japanese quality failure is made.
- PASS: first `caffeinate -disu node tests/framework-chrome-silence.mjs`, **exit 0**,
  `chrome-20261008-6-silence.log`: both new real cases, four ASR jobs, all declared
  quality/latency/accounting/network checks pass. Japanese **2/80 = 2.5% CER**,
  English **2/44 = 4.545455% WER**; every meaning twice. Japanese last-active to
  text **2,376.100–2,441.000 ms**, English **2,262.900–2,299.300 ms**. Joint first
  preparation **54,174.446625 ms**, cached **1,323.269584 ms**, not ASR latency.
  Before the final run, only the new harness's fixed mixed-input hash assertions
  and redundant scaffold simplification are added; recognizer behavior is unchanged.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-6-stage-acceptance.log`: missing script. Full B5 selected-video
  PCM → ASR → Korean translation → DOM remains unimplemented; no placeholder.
- PASS: `node --check tests/framework-chrome-silence.mjs`, targeted three-file
  Biome (**20 ms / no findings**) and preliminary `git diff --check`, **exit 0**.
  Final browser and required verify evidence follows below.


### Final real browser measurements

PASS: final `caffeinate -disu node tests/framework-chrome-silence.mjs`, **exit 0**,
`chrome-20261008-6-silence-final.log`: both fixed mixed hashes, **1,518 actual VAD
calls / four actual ASR jobs**, all declared quality/latency/sample/range/revision/
queue/network gates pass. Every Japanese meaning appears **2** times; every
English meaning appears **2** times. No extra ASR/text is emitted for the final
generated noise-only tail. This new success does not supersede the retained
louder-noise Japanese failure in the original three-period suite.

| Language | Input / host ms | CER/WER | Endpoint-to-text ms | Last-active-delivery to text ms | Peak pending ms | VAD total / max-frame ms |
| --- | --- | --- | --- | --- | ---: | --- |
| ja | 24,552 / 24,554.700 | 2/80 = 2.5% CER | 1,080.000–1,251.700 | 2,379.700–2,451.700 | 13,004 | 456.100 / 12.900 |
| en | 23,976 / 23,982.600 | 2/44 = 4.545455% WER | 940.500–979.000 | 2,240.300–2,279.700 | 12,660 | 446.600 / 11.200 |

Japanese ASR ranges **576–8,896 / 8,896–20,832 ms**, exact sample counts
**133,120 / 190,976**; English **576–8,640 / 8,640–20,320 ms**, counts
**129,024 / 186,880**. Initial **576 ms** is speech-free leading context;
every original speech sample is covered in its corresponding ASR job. The
remaining generated speech-free tails **3,720 / 3,656 ms** are deliberately
rejected at EOF, distinct from queue loss. All cases finish with **zero reported
dropped / zero pending ms**. Each detector covers all **392,832 / 383,616** input
samples; detector-only final padding is **384 samples per language**, never ASR
padding. These observations qualify these synthetic inputs only; they do not
label natural quiet phonemes or establish recall at an unobserved boundary.

Both transcripts/language arrive before the next original speech onset or input
EOF, with input still flowing. Actual ASR host calls **733.900–944.700 ms**.
Endpoint and last-active delivery latencies use a single document clock and
include pacing/segmentation/inference waiting; they exclude prior utterance
accumulation, Korean translation and display. Detector inference uses its own
worker clock; RSS sampling uses Node time, with no cross-origin subtraction.
These are four finite observations, not population latency percentiles or full
interpretation latency.

Fixed complete mixed-input SHA-256 values:

- ja: `6b1cd4f56f4ac185852ffe7dd526c5ef65e833ded5f69c58f03c6657a1a4099e`.
- en: `29e60d64bc9202558dabb542e7518a301fdc2578756baa24723ae7d38b00cc27`.

Joint first/cached preparation **55,280.454209 / 1,220.172375 ms**, distinct from
ASR latency. One fresh inventory each per browser invocation: unchanged small
FP16 WebGPU `onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`,
seven files/**487,960,440 bytes**, and WASM
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`, one file/
**2,243,022 bytes**. English creates fresh workers using the same owned cache.
There are **16** allowed model artifact/redirect paths, no remote inference,
companion or Ollama. Page errors/native visibility events are both `[]`.

| Language | Baseline / peak / final owned browser-tree RSS KiB |
| --- | --- |
| ja | 1,300,016 / 3,321,952 / 1,853,664 |
| en | 1,855,312 / 3,815,104 / 1,718,672 |

Overall RSS baseline **1,298,448 KiB**, sampled every 250 ms for only the owned
browser process tree. It includes browser/renderers/GPU, shared-page double
counting, allocators, joint model loading/residency and harness PCM; not isolated
GPU/model allocations, pressure limits, leak freedom or phone suitability.
Observed environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 /
25G83 arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged locked
Transformers.js/ORT. Input is decoded synthetic PCM, not live selected-element
acquisition or natural speech/noise.

### Remaining acceptance and preservation

**Next unfinished item remains B2:** improve the retained louder-noise Japanese
meaning failure; qualify natural speakers/noise/word boundaries, learned live
acquisition, sustained queue/GPU-loss recovery, model storage/pressure and
long-running memory; resolve Whisper conversion/distribution licensing, then
select a default only from passing evidence. The new long-pause latency gate
passes for these controlled cases; broader quiet speech/boundaries remain
unverified. The original noise suite, full model comparison/stream/sustained,
isolated VAD and B1 UI commands are not rerun. Historical successes/failures are
retained as historical evidence, not fresh full-profile qualification.

Offline speech ASR/full interpretation, Korean translation/revisions/DOM,
ten-minute live Korean captions, B3–B6, external installation and Safari/iPhone
remain **unverified**. Full Chrome-stage acceptance fails as recorded above.
No required environment/device/permission is absent for this iteration's B2
work, so no blocked marker applies; unfinished B2–B6 preclude a completion
marker. No checkbox or stage/framework/iPhone completion claim is added.

Root/nested AGENTS.md and requested independent runner evidence file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent at the initial read.
Supplied instructions, plan, architecture and prior Chrome evidence were read.
Work stays in this worktree; companion v0.1.0/install/native messaging/server/
settings and unrelated files/apps/recordings/mounted images are preserved. No
agents, runner edit, other stage, push/publish/app installation or blocked-browser
access/profile/permission bypass. Only owned explicit test browsers/profiles are
closed/removed. No credentials, weights, user audio/transcripts or temporary
ignored `.ralph` evidence/state is staged or committed.


### Final required verification and Git checks

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-6-verify.log`: Biome **113 files / 51 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**108 JS passed / 0 failed/skipped/cancelled / 21,126.336958 ms**,
**222 Python passed / 66.94 s**, Python **3.12.15**. Verification follows both
real model/browser invocations; subsequent changes complete only Markdown
records. This does not supersede full Chrome acceptance's missing-script failure
or the prior louder-noise Japanese meaning failure.

PASS: final document-inclusive `git diff --check` and `git diff --cached --check`,
**exit 0**. Only the plan, this report, recognizer, regression tests and new
long-silence harness are staged. The intended commit and post-commit clean
worktree are checked before delivery; ignored `.ralph` state is excluded.


## 2026-10-08 — B2 learned live selected-video qualification (iteration 7/20)

Related commit: `test: qualify learned ASR on live selected video`, containing
this report. **B2 remains unchecked; no default model is selected.** Only B2
advances. Earlier noisy Japanese meaning failures remain unresolved.

### Change and acceptance scope

Assumption: the experimental learned profile must be measured with the existing
selected-element acquisition and normalization, beyond its decoded-input tests.
The simpler approach reuses the established live fixture. Added
`npm run test:framework:chrome:live:learned` and an independent owned-browser
harness; the fixture opts into the existing real WASM detector with a fourth
argument. Its default remains the energy profile. Neither production engines,
contracts/core, models/dependencies nor user settings change. Existing energy,
noise, comparison, sustained and full-stage acceptance are not replaced.

Six rounds use the unchanged hash-checked Japanese/English synthetic WebM files:
Japanese Start, active-input Stop, Japanese restart, English Start, then three
complete speech periods per language. Both media elements play concurrently.
Actual selected-element 48 kHz PCM passes through the production 16 kHz
normalizer, learned VAD and FP16 WebGPU ASR. No decoded/oracle PCM, microphone,
companion, Ollama, translation or caption DOM supplies the inference input.
Fixture text scores outputs only; no expected-text prompt or blacklist.

Declared gates retain **<=20% CER/WER**, every original meaning exactly once or
three times, raw selected tag within **12% of 0.06**, unselected tag **<0.003**,
video-time map error **<150 ms**, exact normalization sample/clock accounting,
contiguous ASR ranges and exact captured PCM slices, **<=20 s** segments,
**<=30 s** retained audio, zero reported loss/drained queues on completed runs,
**<2,000 ms** last-packet-to-final-text, leading skipped context **<=100 ms** and
trailing context **<20 ms**. Every normalized sample must reach the real detector;
only its last frame may receive detector-only padding. Detector inference must
use **<10%** of input duration. Stop requires cancellation, discarded-duration
status, no transcript, stopped capture and continuing original playback. Japanese
long input must keep acquiring PCM during actual ASR. The repeated meaning gate
is stricter than the original live harness's minimum-count check, without editing
that original check.

A new segment-count calculation initially counted all captured samples, including
already-permitted leading quiet context, and falsely required two jobs for a
**19,989.3125 ms** admitted English window. Corrected it to count the contiguous
admitted window; the separate **<=100 ms** leading/**<20 ms** trailing and each
**<=20 s** job checks remain. No numerical threshold, fixture, original acceptance
or model behavior changes. A count failure now accumulates diagnostics before
nonzero exit so remaining quality/coverage results are retained.

### Command ledger and failed evidence

All evidence paths below are ignored local `.ralph/media-framework/` files.
No model/runtime weights, captured PCM, credentials or temporary state enter Git.

- FAIL: first `caffeinate -disu npm run test:framework:chrome:live:learned`,
  **exit 1**, `chrome-20261008-7-live-learned.log`. Typecheck and **22 focused tests /
  0 failed / 126.421583 ms** pass. The new segment-count assertion interrupts
  final English scoring. Japanese single/restart **1/40 CER**; English single
  **1/22 WER**; Japanese three-period **10/120 CER**, all corresponding meanings
  once/three times. English input **320,853 samples / 20,053.3125 ms**, ASR range
  **32–20,032 ms**. Its rejected final context is **21.3125 ms**, above the retained
  **<20 ms** gate, although that assertion is not reached. This derived coverage
  observation is preserved; no speech-loss or quiet-phoneme label is inferred.
- FAIL: diagnostic same command, **exit 1**,
  `chrome-20261008-7-live-learned-final.log`. Typecheck and **22 tests** pass; all
  six real rounds complete, with all meanings and error/latency/coverage gates
  passing except the erroneous count calculation. English range **64–20,053.3125
  ms**, admitted duration **19,989.3125 ms**, no rejected EOF context. Japanese
  three-period **7/120 CER**, English **3/66 WER**, all meanings exactly three.
  This new evidence identifies the harness arithmetic error; a corrected run
  follows, rather than a third unchanged attempt at that assertion.
- PASS: `caffeinate -disu node .ralph/media-framework/chrome-20261008-7-energy-live-control.mjs`,
  **exit 0**, `chrome-20261008-7-energy-live-control.log`. Explicit local control
  extracts the existing stream harness's complete six-round live block and owned
  server/browser setup, invoking the shared fixture without the learned argument.
  Its original assertions, including two long-input jobs, remain intact. All
  playback/Stop/restart/isolation/accounting/meaning/error/latency checks pass:
  Japanese **1/40, 1/40, 3/120 CER**, English **1/22, 3/66 WER**; every meaning
  once/three times. Completed runs report zero loss/final pending, maximum
  pending **13,060.6875 ms**, final-packet latency **824–1,058.800 ms**. This is
  a fresh default live-path control, **not** a rerun of the full decoded/sustained/
  GPU-loss stream command. The temporary control source stays ignored.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-7-stage-acceptance.log`: missing script. B5's full selected-video
  PCM → ASR → Korean translation → DOM acceptance is unfinished; no placeholder.
- PASS: final harness syntax (`node --check`), targeted Biome (**34 ms / no
  findings**) and preliminary `git diff --check`, **exit 0**. Final required
  verify and document-inclusive Git checks are recorded below after execution.

### Corrected final real browser results

PASS: final `caffeinate -disu npm run test:framework:chrome:live:learned`,
**exit 0**, `chrome-20261008-7-live-learned-corrected.log`: typecheck,
**22 focused tests / 0 failed/skipped/cancelled / 134.290166 ms**, build, six
live rounds, **1,960 actual detector calls / six actual ASR jobs**, all declared
checks. Mock unit results establish protocol/segmentation behavior only; the
following accuracy measurements come from the real models and acquired video PCM.

| Round / language / periods | Actual normalized samples | ASR ranges ms | CER/WER | Last-packet-to-final-text ms | Peak pending ms | VAD inference total ms |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| 0 / ja / 1 | 111,957 | 64–6,997.3125 | 1/40 = 2.5% | 969.400 | 6,933.3125 | 166.800 |
| 2 / ja / 1, restart | 112,640 | 64–7,040 | 1/40 = 2.5% | 1,050.800 | 6,976 | 160.000 |
| 3 / en / 1 | 107,861 | 64–6,741.3125 | 1/22 = 4.545455% | 847.100 | 6,677.3125 | 160.600 |
| 4 / ja / 3 | 335,872 | 64–20,064 / 20,064–20,992 | 10/120 = 8.333333% | 1,556.800 | 20,928 | 455.100 |
| 5 / en / 3 | 320,853 | 64–20,053.3125 | 3/66 = 4.545455% | 1,652.100 | 19,989.3125 | 459.200 |

Every meaning occurs exactly once/three times. All completed runs have zero
reported dropped audio, zero final pending and zero rejected EOF context; all
start after **64 ms** of below-energy leading context. Each job is an exact slice
of the actual normalized live input. ASR sample counts are **110,933 / 111,616 /
106,837 / (320,000 + 14,848) / 319,829**. Complete raw samples are **335,872 /
337,920 / 323,584 / 1,007,616 / 962,560**, and normalized counts are exactly
`floor(raw/3)` with the original capture clock. Detector calls are **219 / 220 /
211 / 656 / 627**; final padding **171 / 0 / 171 / 0 / 171** samples, never ASR
padding. Maximum observed detector inference is **10.400 ms**. Video mapping
errors **27.210–51.265 ms**; selected tag amplitudes **0.060024–0.060092**, other
video tag **0.000280–0.000605**.

Stop round 1 captures **43,008 raw / 14,336 normalized samples**, completes **27**
real detector calls, emits no ASR job/text, reports **831.375 ms** deliberately
cancelled input and zero pending, then detaches capture. Both videos retain the
same source/volume/rate/mute/playback state and continue playing in every round;
no new independent speaker-output-level measurement is claimed. Native visibility
events/page errors are `[]`. Only the owned browser/profile is closed/removed.

Observed ASR host call durations **331.200–2,120.000 ms**. The earlier Japanese
20-second job takes **2,120.000 ms**, exceeding two seconds of inference; the
preserved live gate is last-packet-to-final-text, not a per-job two-second promise.
Long-input final latency includes waiting for earlier work. These numbers use one
document clock, exclude speech accumulation/model preparation/Korean translation/
display and are finite observations, not population percentiles. Twenty seconds
of accumulation can still precede the first long-input text. VAD durations use
its worker clock separately; RSS uses Node time, without subtracting clock origins.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged locked
Transformers.js/ORT. Actual small FP16 WebGPU ASR remains
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
files/**487,960,440 bytes**; actual WASM detector remains
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`, one file/
**2,243,022 bytes**. Three learned browser invocations each download one inventory
of each in a fresh owned cache, then reuse it for fresh workers. The separate
energy control downloads one ASR inventory. Final first preparation
**67,553.088875 ms**, fresh cached workers **1,223.875334–1,423.112625 ms**; these
are load times, not ASR latency. All later ASR/VAD statuses contain `cached`, no
`downloading`. All **16** final remote paths/requests are pinned artifact/allowed
redirect paths; no remote inference, companion or Ollama.

Final owned-browser-tree RSS baseline **1,437,920 KiB**, 250 ms sampling. Per-round
baseline/peak/final KiB: **3,324,736/3,418,576/2,063,136**;
**3,246,240/3,246,240/2,846,192** (Stop);
**3,752,688/3,752,688/1,535,504**;
**3,743,584/3,760,832/1,897,248**;
**3,793,744/3,801,536/1,451,888**;
**2,914,400/2,914,400/1,602,544**. Case sampling starts after preparation and
includes browser/renderers/GPU, shared-page double counting, allocators, resident
models and the harness's bounded captured-PCM snapshots. This is not isolated
GPU/model memory, preparation peak, pressure limits, leak freedom or mobile evidence.

### Remaining acceptance and preservation

**Next unfinished item remains B2:** improve retained louder-noise Japanese
meaning; qualify natural speakers/noise/word boundaries and live EOF alignments,
including the first run's **21.3125 ms** rejected context. A passing later capture
with different alignment does not fix that historical observation or prove quiet
phoneme recall. Add sustained learned live input, queue/GPU-loss recovery under
pressure, storage/memory qualification and Whisper conversion/distribution license
confirmation, then select a default only from passing evidence. Original noise,
full comparison/stream/sustained, isolated VAD and B1 preparation commands are not
rerun; their historical passes/failures stay historical. No third unchanged noisy
Japanese quality attempt is made.

Offline speech/full interpretation, Korean translation/revisions/DOM, ten-minute
live Korean captions, B3–B6, installation and Safari/iPhone remain **unverified**.
Required full Chrome acceptance fails as recorded. No required environment,
device or permission is absent; incomplete implementation/quality qualification
warrants neither terminal marker. No checkbox or stage/framework/iPhone claim.

Root/nested AGENTS.md and requested independent runner evidence file are absent
at initial read. Supplied instructions, plan, architecture and prior report were
read. Work stays here; companion v0.1.0/install/native messaging/server/settings
and unrelated files/apps/recordings/mounted images are preserved. No agents,
runner edit, stage advance, push/publish/app installation or browser access/
profile/permission bypass. Credentials, model weights, user audio/transcripts and
temporary ignored `.ralph` state are excluded from the commit.


### Final required verification

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-7-verify.log`: Biome **114 files / 52 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**108 JS passed / 0 failed/skipped/cancelled / 24,828.208084 ms**,
**222 Python passed / 66.89 s**, Python **3.12.15**. It runs after all actual
browser/model invocations; subsequent changes only finish Markdown evidence.
This does not supersede the missing full Chrome acceptance, earlier rejected EOF
context or louder-noise Japanese meaning failure.


PASS: document-inclusive `git diff --check` and `git diff --cached --check`,
**exit 0**. Staged paths are only this report, the plan, package scripts, the live
fixture and the learned live harness. No `.ralph` evidence/state, credentials,
weights or user data are staged. Commit and post-commit cleanliness are checked
before delivery.


## 2026-10-08 — B2 fixed EOF alignment qualification (iteration 8/20)

Related commit: `test: expose browser ASR EOF alignment failures`, containing this
report. **B2 remains unchecked; no default model is selected.** Only B2 advances.

Assumption: iteration 7's 21.3125 ms rejected live EOF context requires fixed-input
coverage/accuracy evidence; a later live capture with a different alignment is
not a regression fix. Added `npm run test:framework:chrome:eof` and a separate
owned-browser harness using the existing production recognizer, WASM detector
and FP16 WebGPU ASR. The simpler evaluation preserves production segmentation
while measuring the boundary, before changing admission or adding lookahead.
No production/core/contract/model/dependency/settings changes. Existing live,
noise, comparison, sustained and full-stage acceptance gates are intact.

Each language receives three complete unchanged, hash-checked synthetic speech
periods decoded/resampled to 16 kHz, preceded by exactly 512 zero samples. The
initial six-case run appends 0, 341 or 511 zero samples; the final harness retains
those cases and adds 853 and 1,365. Every original input sample is retained in
the delivered stream; no expected text, silence label, blacklist, replaced audio,
gain adjustment or filtering enters inference. Known appended zeros vary only
EOF alignment. These are 100 ms paced **decoded synthetic PCM**, not a new live
selected-element, natural-speaker, Korean translation or caption DOM claim.

The harness retains <=20% CER/WER, every meaning exactly three times, <=20 s
jobs, <=30 s retained audio, zero reported drop/drained queue, <=100 ms leading
context, **<20 ms trailing context** and <2,000 ms endpoint-to-text. It separately
requires every original tail sample to reach ASR, records complete input/job
SHA-256 values and compares every actual job sample to its input slice. Detector
coverage is exact, only the final detector frame may be padded, and real VAD
inference must use <10% of input duration. Identity/epoch/range/final revision,
contiguous jobs, cached fresh workers, pinned artifact requests, native visible
document and empty page-error/visibility-event checks remain explicit. Quality
failures accumulate through both languages before nonzero exit.

The final instrumentation records rejected-tail RMS/peak without retaining audio.
This distinguishes sample rejection from reported queue loss and avoids labeling
unobserved quiet phonemes from a detector decision. ASR/VAD model construction
alone is not a recognition pass. No checkbox or stage/framework/iPhone completion
claim is added.


### Initial command evidence

All named evidence is ignored local `.ralph/media-framework/` state. Audio,
model/runtime weights, owned profiles and temporary logs are excluded from Git.

- FAIL: first `caffeinate -disu npm run test:framework:chrome:eof`, **exit 1**,
  `chrome-20261008-8-eof.log`. Typecheck/build, six completed real cases,
  **3,847 VAD calls / nine actual ASR jobs**, complete detector/ASR sample and
  revision accounting, model/cache/network/page-lifetime assertions pass. Five
  assertions fail: Japanese's first 20 s job in each case takes **2,096.200 /
  2,044.400 / 2,004.100 ms** from endpoint delivery to text, over the retained
  **<2,000 ms** gate; English rejects **20.8125 / 31.4375 ms** of EOF context,
  over **<20 ms**. No original tail sample is rejected in these controlled cases.
  Japanese **7/120 = 5.833333% CER**, English **3/66 = 4.545455% WER**, all
  meanings exactly three times. Those recognition passes do not override the
  failed latency/coverage gates. Initial zero-tail English passes every gate.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-8-stage-acceptance.log`: missing script. B5's required full
  selected-video PCM → ASR → Korean translation → DOM harness is unimplemented.
  No placeholder, ASR-only substitute or weakened acceptance is added.
- PASS: `node --check tests/framework-chrome-eof.mjs`, targeted one-file Biome
  (**39 ms / no findings**) and preliminary `git diff --check`, **exit 0**.

The first run's rejected English tails follow the forced **32–20,032 ms**
segment. Initial English zero-tail job is **32–20,031.5 ms**. Japanese ranges
are **32–20,032 / 20,032–20,948.75 / 20,970.0625 / 20,980.6875 ms** (the latter
three endpoints belong to separate cases). Every case drains to zero pending and
reports zero drop. This independently demonstrates why queue-loss status alone
cannot establish EOF coverage. Japanese final-job endpoint latencies
**1,416.700–1,549.300 ms** pass, while its earlier first-job latencies fail; a
passing final-packet metric cannot be substituted for the per-endpoint check.

Initial preparation **65,413.829458 ms**, cached fresh workers
**1,219.649209–1,322.491958 ms**, separate from ASR latency. Initial owned-tree
RSS baseline **1,294,624 KiB**, case peak **3,870,576 KiB**. Final page errors and
native visibility events are `[]`; allowed remote paths **16**. The final second
invocation adds rejected-tail RMS/peak and two additional alignments while
retaining all six initial cases and thresholds. No third unchanged attempt is
planned. Final results and required repository verification follow below.


### Final actual browser evidence

FAIL: second/final `caffeinate -disu npm run test:framework:chrome:eof`, **exit 1**,
`chrome-20261008-8-eof-final.log`. Typecheck/build, **ten completed real cases /
6,419 detector calls / 15 ASR jobs** and all accounting/cache/network/lifetime
assertions complete. **Nine** assertions fail: every Japanese first-job
endpoint latency is **2,033.300–2,058.000 ms**, and four English EOF remainders
exceed the unchanged <20 ms gate. No third browser attempt is made.

All five Japanese results score **7/120 = 5.833333% CER**; all five English
results **3/66 = 4.545455% WER**. Every meaning occurs exactly three times in
every case. Every original tail sample reaches ASR; every job is an exact slice
of its supplied PCM; all final pending/reported drop values are zero. These
passes do not override the failed endpoint/coverage criteria.

| Language / appended samples | Delivered samples | Endpoint-to-text ms (ordered jobs) | Rejected EOF context ms | Peak pending ms | VAD total ms |
| --- | ---: | --- | ---: | ---: | ---: |
| ja / 0 | 335,180 | 2,048.400 / 1,501.600 | 0.0000 | 20916.7500 | 383.400 |
| ja / 341 | 335,521 | 2,033.300 / 1,464.700 | 0.0000 | 20938.0625 | 411.000 |
| ja / 511 | 335,691 | 2,040.500 / 1,459.900 | 0.0000 | 20948.6875 | 407.500 |
| ja / 853 | 336,033 | 2,058.000 / 1,457.100 | 0.0000 | 20970.0625 | 392.100 |
| ja / 1,365 | 336,545 | 2,042.300 / 1,413.400 | 0.0000 | 21002.0625 | 399.600 |
| en / 0 | 320,504 | 1,743.400 | 0.0000 | 19999.5000 | 400.100 |
| en / 341 | 320,845 | 1,762.700 | 20.8125 | 20020.8125 | 381.400 |
| en / 511 | 321,015 | 1,748.400 | 31.4375 | 20031.4375 | 406.200 |
| en / 853 | 321,357 | 1,732.200 | 52.8125 | 20052.8125 | 399.700 |
| en / 1,365 | 321,869 | 1,698.000 | 84.8125 | 20084.8125 | 406.600 |

Every job starts after **32 ms / 512 samples** of generated leading zeros.
Japanese first ranges are **32–20,032 ms / 320,000 samples**; final ranges
start at **20,032 ms**, with exact lengths **14,668 / 15,009 / 15,179 / 15,521 /
16,033 samples**, respectively. English zero-tail range is
**32–20,031.5 ms / 319,992 samples**; every other English case is
**32–20,032 ms / 320,000 samples**. Ranges remain contiguous and each job is
<=20 s. Each original period is unchanged **111,556 / 106,664 samples**.

The four rejected English tails have measured **RMS 0 / peak 0** and contain
only appended zeros: original input ends at **20,031.5 ms**, before the last
ASR endpoint. This establishes rejection of known generated silence in these
cases, **not** lost source speech or a diagnosis/fix of iteration 7's live
21.3125 ms context. All nine quality assertions still fail; no threshold or
silence exception is added to turn them into acceptance. A shorter returned
final-packet latency cannot replace the declared per-endpoint latency gate.
The forced cut/admission/minimum-job interaction needs a measured policy change
before qualification, with natural quiet speech still unverified.

Detector calls per case are **655 / 656 / 656 / 657 / 658** Japanese and
**626 / 627 / 627 / 628 / 629** English. Detector-only final padding is
**180 / 351 / 181 / 351 / 351** and **8 / 179 / 9 / 179 / 179 samples**;
no ASR padding or PCM alteration. Maximum detector inference **11.400 ms**.
Actual ASR host calls **301.200–2,048.200 ms**. Ten separate sessions deliver
**205,285 ms** of paced input in total; this is not one sustained or ten-minute
live session. Latencies use one document clock, exclude earlier utterance
accumulation/model preparation/Korean translation/display, and are finite
observations rather than population percentiles. VAD inference uses its own
worker clock; RSS uses Node time, with no cross-origin clock subtraction.

PASS: explicit Python recorded-result analysis, **exit 0**: all six repeated
inputs have identical full-input SHA-256 and transcript strings across both
browser invocations; all ten final results preserve exact meaning/error/PCM/
queue checks and rejected tails are zero. This analysis is not a third model
run or a passing quality command. Final complete input SHA-256 values:

- ja / 0: `7549f15c5ecf98c7c41de153f9fdebba8c046a1021ebce27b6422f3b817f5e44`.
- ja / 341: `167590708e48bad676bdb8e1a8dbaad1cffb67c889e0dadb5df157a6f2f184c1`.
- ja / 511: `128e88a9e73924fe7ddb38f9260df486e02fe95e816422c43fbb45eabe41ae89`.
- ja / 853: `fc9a29413ef3804e99c83228c43a661423fdb88eedee651c000ff6429fd9f83f`.
- ja / 1365: `6b810cdf95bbfce4f9bfb46117ffe3d68bff7a2009e76106c4de0d5bd1214f5c`.
- en / 0: `d24f5a9e67a43b8d4308739e7282b9dd312b6256734e7e7af64375f59c37fe38`.
- en / 341: `2183150335da45390337c18efccaeae0deb0883ab2810bdd564c1b7102e46d8b`.
- en / 511: `b818724035538379eca22d3375c9f14ad1a06b3513d6fed2848645c82b61a2b9`.
- en / 853: `5eb3801f5a32ea5ffc687153e39fda9502890c4a9d3e448988a11bb931ac5902`.
- en / 1365: `e5a43fc25bf20e636ac5363a6e746e6934f5bd61a01d70132e320d84c0903d21`.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged locked
Transformers.js **4.3.0** / ORT. Same small FP16 WebGPU ASR
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
model files/**487,960,440 bytes**, and WASM
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`, one model
file/**2,243,022 bytes**. Each of the two browser invocations downloads one
inventory of each in a fresh owned cache, then reuses it for fresh workers.
Final first preparation **56,891.995917 ms**, cached workers
**1,218.376334–1,321.242250 ms**, separate from recognition. All **16** remote
paths are pinned model artifacts/allowed redirects; no remote inference,
companion or Ollama. Page errors/native visibility events are `[]`.

Final owned-tree RSS baseline **1,303,264 KiB**, observed peak **3,946,208 KiB**,
sampled every 250 ms including preparation. Per-case baseline/peak/final KiB:

- ja / 0: **1,305,376 / 3,647,888 / 2,077,840**.
- ja / 341: **2,051,488 / 3,946,208 / 2,048,496**.
- ja / 511: **1,579,760 / 3,864,064 / 2,166,096**.
- ja / 853: **1,585,056 / 3,861,808 / 2,144,336**.
- ja / 1365: **1,592,864 / 3,773,040 / 1,952,160**.
- en / 0: **1,627,280 / 3,772,560 / 2,370,912**.
- en / 341: **1,873,792 / 3,739,312 / 2,058,224**.
- en / 511: **1,639,424 / 3,728,864 / 2,036,080**.
- en / 853: **1,607,392 / 3,644,352 / 1,832,624**.
- en / 1365: **1,622,016 / 3,818,128 / 2,209,488**.

RSS includes browser/renderers/GPU, shared-page double counting, allocators,
joint model loading/residency and harness PCM. This is not isolated model/GPU
allocation, storage/memory pressure, leak freedom or mobile qualification.

### Remaining acceptance and preservation

**Next unfinished item remains B2:** resolve the measured forced-boundary
latency/EOF-coverage interaction while retaining these cases and gates, then
qualify natural speech/noise/word boundaries and the earlier live EOF observation.
The retained louder-noise Japanese meaning failure, sustained learned live
acquisition/queue/GPU-loss recovery under pressure, model storage/memory,
Whisper conversion/distribution licensing and evidence-based default selection
remain unfinished. Original noise/full comparison/stream/sustained/VAD/B1 UI
commands are not rerun; historical successes/failures remain historical.

Offline speech/full interpretation, Korean translation/revisions/DOM, ten-minute
live Korean captions, B3–B6, installation and Safari/iPhone remain **unverified**.
Required full Chrome acceptance fails as recorded. No required environment,
device or permission is absent; this is failed qualification/incomplete
implementation, so neither terminal marker applies. No checkbox or stage/
framework/iPhone completion claim is added.

Root/nested AGENTS.md and requested independent runner evidence file are absent
at initial read. Supplied instructions, plan, architecture and prior report were
read. Work stays in this worktree; companion v0.1.0/install/native messaging/
server/settings and unrelated files/apps/recordings/mounted images are preserved.
No agents, runner edits, stage advance, push/publish/app installation or blocked
browser access/profile/permission bypass. Only owned test browsers/profiles are
closed/removed. Credentials, weights, user audio/transcripts and temporary ignored
`.ralph` state are excluded from Git.


Final required verification: PASS, `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-8-verify.log`: Biome **115 files / 56 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**108 JS passed / 0 failed/skipped/cancelled / 21,660.429583 ms**,
**222 Python passed / 66.92 s**, Python **3.12.15**. Verification runs after both
actual browser/model invocations; later edits only finish Markdown evidence.
This does not override the failed EOF qualification or missing full Chrome
acceptance. Final document-inclusive unstaged/staged whitespace and post-commit
cleanliness are checked before delivery. Staged paths are only this plan, the
Chrome report, package script and EOF harness; no temporary `.ralph` state,
credentials, model weights or user data are staged.


## 2026-10-08 — B2 earlier learned boundaries for long speech (iteration 9/20)

Related commit: `fix: bound long browser ASR at learned pauses`, containing this
report. **B2 remains unchecked; no ASR default is selected.** Only B2 advances.

### Regression, scope and unchanged acceptance

Assumption: iteration 8's measured per-endpoint latency and EOF rejection need a
segmentation change, not another unchanged retry or a silence exception. Read the
supplied instructions, plan, architecture and existing Chrome report. Root/nested
AGENTS.md and the requested independent runner evidence file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent at initial read.

Read-only analysis of the retained iteration 8 final detector trace finds late
inactive pauses of **256 ms at 14,560–14,816 ms** for Japanese and **224 ms at
11,072–11,296 ms** for English. Both are shorter than the existing 500 ms onset
boundary. The smaller change uses those already observed pauses after ten seconds,
before adding lookahead, overlapping inference or changing admission/minimum jobs.

The explicit learned profile now accepts a **>=200 ms detected pause after 10 s**,
splitting only on the next onset near the midpoint on detector-frame boundaries.
Before 10 s it retains the **>=500 ms** policy. The **1,500 ms immediate long-
silence endpoint / 256 ms retained context**, **20 s maximum segment**, **30 s
retained PCM**, **one active plus two queued jobs / two pending results**, exact
unfiltered ASR slices, cancellation and energy-only comparison remain intact.
There is no new model/backend/dependency, padding, expected-text prompt, fallback,
blacklist, product default or settings change. Continuous speech without a suitable
pause still reaches the forced boundary; this is not a universal short-tail fix.

Two added fake-detector/executor regressions assert an earlier 224 ms long-input
pause, contiguous exact sample/range coverage through all five retained EOF
offsets, bounded minimum/maximum jobs, zero reported loss/drained state, and no
short-pause fragmentation before ten seconds. Transport strings are not ASR
accuracy evidence. The real EOF, live/noise/comparison/sustained and full-stage
harnesses, all fixtures, hashes, sentences and thresholds are untouched.

All ten actual EOF cases retain **<=20% CER/WER**, **every meaning exactly three
times**, **<2,000 ms per-endpoint-to-text**, **<20 ms trailing context**, **<=100 ms
leading context**, every original tail sample submitted, exact ASR PCM/ranges,
**<=20 s jobs / <=30 s queue / zero reported drop / drained queue**, complete
actual detector coverage and **<10% input duration in VAD inference**, cached
fresh workers, pinned artifact paths and visible-document/page-error checks.
Model construction or a passing final-packet metric cannot replace these gates.

### Initial exact command evidence

Named evidence is ignored local `.ralph/media-framework/` state, excluded from
Git. Model/runtime weights, owned profiles and ephemeral PCM stay outside commits.

- FAIL before fix: `node --import tsx --test tests/framework-browser-speech.test.ts`,
  **exit 1**, `chrome-20261008-9-regression.log`: **17 passed / 1 failed /
  174.034875 ms**. Actual range is only **0–20,000 ms**, versus the required
  **0–11,200 / 11,200–20,031.5 ms**; inactive EOF context never reaches ASR.
- PASS after fix: `npm run typecheck` then
  `node --import tsx --test tests/framework-browser-speech.test.ts tests/framework-browser-vad.test.ts tests/framework-browser-normalize.test.ts`,
  **exit 0**, `chrome-20261008-9-unit.log`: **24 passed / 0 failed/skipped/
  cancelled / 172.869125 ms**. Fake transport/segmentation/lifecycle only.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-9-stage-acceptance.log`: missing script. B5's full selected-
  video PCM → ASR → Korean translation → DOM harness is unfinished. No placeholder
  or ASR-only substitute is added.
- PASS: targeted two-file Biome **23 ms / no findings** and preliminary
  `git diff --check`, **exit 0**. Final required verification follows actual
  browser/model checks below.


### Passing actual fixed EOF evidence

PASS: `caffeinate -disu npm run test:framework:chrome:eof`, **exit 0**, once,
`chrome-20261008-9-eof.log`: typecheck/build, **ten cases / 6,419 real WASM VAD
calls / 20 actual FP16 WebGPU ASR jobs** and every unchanged assertion pass.
All five Japanese cases score **6/120 = 5.000000% CER**, all English cases
**3/66 = 4.545455% WER**, every meaning exactly three times. Every original
and appended tail sample reaches ASR; leading context is **32 ms** of generated
zeros and trailing rejected context **0 ms** in every case. All jobs are exact
contiguous input slices, <=20 s; final reported loss/pending are both zero.

PASS: explicit Python recorded-result analysis, **exit 0**: all ten complete
input SHA-256 values equal the corresponding iteration 8 final inputs; quality,
meaning, unchanged endpoint, EOF and original-tail gates pass in all ten records.
Analysis is not another model invocation. Input hashes remain listed in iteration
8 above, unchanged; no transcript or user audio is retained in this report.

| Language / appended samples | Endpoint-to-text ms (ordered jobs) | Peak pending ms | VAD total ms | Baseline / peak / final RSS KiB |
| --- | --- | ---: | ---: | --- |
| ja / 0 | 1,688.600 / 842.200 | 16,268.000 | 375.200 | 1,302,672 / 3,987,392 / 2,388,944 |
| ja / 341 | 1,670.400 / 841.600 | 16,268.000 | 393.900 | 1,760,960 / 3,598,064 / 1,511,728 |
| ja / 511 | 1,661.700 / 826.900 | 16,268.000 | 395.300 | 1,503,904 / 3,793,680 / 2,216,032 |
| ja / 853 | 1,631.200 / 833.900 | 16,268.000 | 409.100 | 1,662,304 / 3,653,280 / 1,648,016 |
| ja / 1365 | 1,653.400 / 814.100 | 16,268.000 | 374.400 | 1,650,496 / 3,807,696 / 1,541,456 |
| en / 0 | 1,318.600 / 913.100 | 12,468.000 | 384.300 | 1,531,968 / 3,837,712 / 1,548,368 |
| en / 341 | 1,293.000 / 928.100 | 12,368.000 | 388.400 | 1,548,592 / 3,714,208 / 1,539,088 |
| en / 511 | 1,311.500 / 920.200 | 12,468.000 | 391.000 | 1,526,496 / 3,774,608 / 1,688,368 |
| en / 853 | 1,275.500 / 922.300 | 12,368.000 | 372.900 | 1,673,184 / 3,641,344 / 1,645,936 |
| en / 1365 | 1,323.400 / 917.500 | 12,468.000 | 392.600 | 1,630,880 / 3,864,704 / 1,597,952 |

Japanese ranges are **32–14,688 ms** followed by **14,688 ms–exact EOF**
(**20,948.750 / 20,970.0625 / 20,980.6875 / 21,002.0625 / 21,034.0625 ms**).
English ranges are **32–11,200 ms** followed by **11,200 ms–exact EOF**
(**20,031.500 / 20,052.8125 / 20,063.4375 / 20,084.8125 / 20,116.8125 ms**).
Neither language reaches the forced 20 s cut in this corpus. The earlier rejected
English context and Japanese latency are resolved for these exact controlled
inputs; speech with no eligible pause and natural phoneme recall remain unqualified.

Actual ASR host calls **812.000–1,478.700 ms**; endpoint-to-text
**814.100–1,688.600 ms** includes pause-to-onset admission delay. The same document
clock measures host deliveries and text; VAD inference uses its worker clock
separately, maximum **11.600 ms**, and RSS uses Node time. These exclude earlier
speech accumulation, model preparation, Korean translation and display, and are
finite observations, not population percentiles. Ten separate sessions deliver
**205,285 ms** total decoded input, not one sustained or ten-minute live session.
Detector coverage/padding is identical to iteration 8; no ASR padding/filtering.

First joint preparation **67,917.292958 ms**, cached fresh workers
**1,220.205041–1,321.115583 ms**, separate from recognition. Every later ASR/VAD
status contains `cached`, no `downloading`. Allowed remote artifact/redirect paths
**16**, page errors/native visibility events `[]`, no remote inference, companion
or Ollama. Owned-tree RSS baseline **1,299,040 KiB**, peak **3,987,392 KiB**,
250 ms samples including preparation/browser/renderers/GPU/shared-page double
counting/allocators/models/ephemeral harness PCM. This is not isolated GPU/model
allocation, pressure/leak freedom, storage qualification or phone evidence.


### Passing live selected-video evidence

PASS: `caffeinate -disu npm run test:framework:chrome:live:learned`, **exit 0**,
once, `chrome-20261008-9-live.log`: typecheck/**24 targeted tests /
206.399125 ms**, build and **all six actual selected-video rounds / 1,961 WASM
VAD calls / seven FP16 WebGPU ASR jobs**. One round explicitly cancels during
real learned processing; the other five score recognition. The existing fixture,
model, gates and harness are unchanged. No companion/Ollama/translation/caption DOM.

| Round / language / periods | Actual normalized samples | Accuracy | Meaning counts | Last-packet-to-text ms | Peak pending ms | Trailing context ms |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| 0 / ja / 1 | 111,957 | 1/40 = 2.500000% CER | all 1 | 1,015.100 | 6,933.3125 | 0 |
| 1 / ja / Stop | cancelled | no text | no score | no score | cancelled pending 0 | no score |
| 2 / ja / 1 | 112,640 | 1/40 = 2.500000% CER | all 1 | 921.400 | 6,976 | 0 |
| 3 / en / 1 | 107,861 | 1/22 = 4.545455% WER | all 1 | 888.900 | 6,677.3125 | 0 |
| 4 / ja / 3 | 335,872 | 3/120 = 2.500000% CER | all 3 | 859.100 | 16,319.375 | 0 |
| 5 / en / 3 | 321,536 | 3/66 = 4.545455% WER | all 3 | 950.000 | 12,394 | 0 |

Single-period ranges are Japanese **64–6,997.3125 / 64–7,040 ms**, English
**64–6,741.3125 ms**. Three-period ranges are Japanese
**64–14,752 / 14,752–20,992 ms**, English **64–11,200 / 11,200–20,096 ms**.
Every job equals its normalized selected-video input slice, with contiguous
ranges/identity/epoch/final revision/video mapping and no ASR PCM filtering/padding.
Every completed round drains to zero pending and reports zero loss; leading
context **64 ms** satisfies <=100 ms, trailing context **0 ms** satisfies <20 ms.
This passing live alignment, combined with the unchanged fixed EOF corpus, improves
on iteration 7's live 21.3125 ms rejection without claiming all possible alignments
or quiet-phoneme recall. A no-pause forced boundary remains unqualified.

Actual captured sample counts, five completed rounds:
**335,872 / 337,920 / 323,584 / 1,007,616 / 964,608** at **48 kHz**, resampled
exactly to `floor(rawSamples/3)` at 16 kHz. Maximum mapping errors by round
**24.579 / 53.895 / 42.055 / 48.248 / 59.260 ms**, below the unchanged 150 ms
gate. Selected **6.5 kHz** tag amplitudes **0.060024–0.060073**; unselected
**8 kHz** leakage **0.000292–0.000605**, below 0.003. Both audible fixture
videos retain source/volume/rate/mute/playback state and advance in every round.
No new independent speaker-output-level measurement is claimed. Completed/Stop
capture detaches while playback continues. No native visibility events/page errors.

Stop after at least 20 normalized chunks rejects `cancelled`, emits no transcript,
reports **799.375 ms explicitly discarded / 0 pending**, and stops capture after
**27 real detector frames**. Fresh explicit Start then passes; no late result
revives the cancelled session. During the Japanese long run's first actual ASR
job, delivered normalized audio advances **14,932.6875–16,383.375 ms** while
inference continues. Queue pressure/GPU loss over a sustained learned live run
are still unverified; this finite short run cannot establish them.

Live host calls **854.700–1,458.500 ms**. Last-packet-to-text is the live harness's
unchanged latency metric; it is distinct from the EOF harness's per-endpoint
metric. Durations use one document clock, exclude speech accumulation/model
preparation/translation/display, and are observations, not population percentiles.
VAD has its own worker clock, max **10.100 ms**, completed-round totals
**160.000 / 159.400 / 155.800 / 459.700 / 427.900 ms**, each <10% input duration.

Initial preparation **77,344.567125 ms**, cached fresh workers
**1,222.854041–1,420.398417 ms**; later statuses are cached without downloading.
Pinned artifact/redirect **16 paths / 16 requests**; no remote inference. Owned-
tree RSS baseline **1,430,672 KiB**, case baseline/peak/final KiB:
**3,804,208 / 3,850,912 / 1,777,792**;
**3,925,728 / 3,937,648 / 3,560,880** (Stop);
**4,024,096 / 4,029,280 / 1,880,720**;
**3,935,088 / 3,935,088 / 1,601,744**;
**3,711,056 / 3,716,288 / 1,721,856**;
**2,802,816 / 2,805,024 / 1,691,056**.
Case peaks start after preparation; 250 ms tree samples include browser/renderers/
GPU/shared-page double counting/allocators/resident models/harness PCM. They do not
establish preparation peak, isolated model memory, pressure limits or leak freedom.

PASS: corrected explicit Python recorded-live-result assertions, **exit 0**, for
all scored recognition/meaning/EOF/queue gates and Stop. Initial metadata extraction
returned **exit 1 / TypeError** after printing complete scored rounds because it
applied `len` to the integer `remoteRequests`; corrected extraction reports **16**.
This is a reporting-script failure, not a model/harness failure or another model run.

### Environment, remaining acceptance and preservation

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged Transformers.js **4.3.0**
and locked ORT. Same small FP16 WebGPU ASR
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
model files/**487,960,440 bytes**, and WASM detector
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`, one file/
**2,243,022 bytes**. Each of the two browser invocations downloads one inventory
of each into a fresh owned cache, then reuses it across fresh workers. Only owned
test browsers/profiles are closed/removed; cached weight/audio/profile/log state
is excluded from Git.

**Next unfinished item remains B2:** qualify long/no-pause/quiet word boundaries
and natural speakers/noise, resolve retained louder-noise Japanese meaning,
measure sustained learned live pressure/GPU recovery and storage/memory, confirm
conversion/distribution licensing, then select a default from passing evidence.
Original noise/full candidate comparison/stream/sustained/VAD/B1 commands are not
rerun; their historical results remain historical. The new passing short learned
live run does not establish ten-minute performance or invalidate those failures.

Required full Chrome acceptance **fails** as recorded. Offline speech/full
interpretation, Korean translation/revisions/DOM, ten-minute live Korean captions,
B3–B6, installation and Safari/iPhone remain **unverified**. No required
permission/device/environment is absent; incomplete qualification/implementation
warrants neither terminal marker. No checkbox or stage/framework/iPhone completion
claim. Published companion v0.1.0/install/native messaging/server/user settings and
unrelated files/apps/recordings/mounted images are preserved. No agents, runner
edit, stage advance, push/publish/app installation or browser-access/profile/
permission bypass. Work stays in this worktree; credentials, model weights, user
audio/transcripts and temporary ignored `.ralph` state are excluded from commits.


### Final required verification

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-9-verify.log`: Biome **115 files / 52 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**110 JS passed / 0 failed/skipped/cancelled / 20,986.647666 ms**,
**222 Python passed / 66.95 s**, Python **3.12.15**. It runs after both real
browser/model invocations; later changes only finish Markdown evidence. This
passing repository check does not override the missing full Chrome acceptance
or remaining B2 qualification. Final document-inclusive unstaged/staged whitespace,
commit scope and post-commit cleanliness are checked before delivery. Staged paths
are only the recognizer, its regression tests, this report and the plan; no
credentials, weights, user audio/transcripts or temporary `.ralph` state.


## 2026-10-08 — B2 quiet onset context qualification (iteration 10/20)

Related commit: `fix: retain quiet browser speech onset context`, containing this
report. **B2 remains unchecked; no ASR default is selected.** Only B2 advances.

### Scope, regression and retained acceptance

Assumption: the next quiet-boundary qualification should first attenuate the
existing sentences, before introducing a new detector or segmentation policy.
The supplied instructions, plan, architecture and Chrome evidence were read.
Root/nested AGENTS.md and the requested independent runner evidence file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent at initial read.

Added `test:framework:chrome:quiet`, an explicit mode of the existing EOF harness.
It evaluates both unchanged hash-checked synthetic fixtures at gain **1 / 0.25 /
0.1**, including their carriers, with three complete periods, the same **512**
zero prefix samples and **511** appended zero samples. Timing, sample positions,
labels and source files are preserved; Float32 attenuation happens only in fixture
construction. VAD and ASR receive the same attenuated PCM without gain restoration,
trimming, denoising, label prompts or fallback. This is controlled input amplitude
qualification, not a natural quiet speaker, actual volume setting, live capture,
ambient noise or Korean-caption test. The default EOF command retains all ten
original cases. Fixture hashes, sentences and every original gate remain intact.

The first real run exposes delayed initial context retention: tenth-volume
Japanese starts ASR at **192 ms**, English at **1,696 ms**, failing **<=100 ms**.
English first receives learned speech admission at 1,696 ms. A fake-detector
regression reproduces precisely **1,696–3,200 ms** instead of **0–3,200 ms**.
The smaller fix lowers only the learned path's full-band **context-retention RMS
from 0.01 to 0.001**. The detector still alone admits a segment to ASR, with its
unchanged **0.5 probability** threshold. The energy-only comparison stays at 0.01.
No model, backend, dependency, default or user setting changes.

The added unit regression verifies byte-identical quiet context before delayed
admission, and **40 s** of rejected quiet input with **zero ASR calls**, <=20 s
pending retention and zero final loss/pending. Existing 20 s segments/30 s total
queue, active/pending/result bounds, minimum jobs, long-silence context, pause cuts,
cancellation and errors remain. Mock strings prove transport, not recognition.

All real cases keep **<=20% CER/WER**, **every meaning exactly three times**,
**<2,000 ms per endpoint**, **<=100 ms leading / <20 ms trailing context**, every
original tail position reaching ASR, exact contiguous unfiltered ASR slices,
**<=20 s jobs / <=30 s queue / zero reported drop / drained queue**, complete
actual VAD coverage and **<10% input duration in detector inference**, cached
fresh workers, pinned network paths and visible-document/page-error checks.
Failing quieter cases remain in acceptance; no threshold is weakened.

### Exact command ledger and final quiet evidence

Named evidence files are ignored local `.ralph/media-framework/` state.

- FAIL before fix: `node --import tsx --test tests/framework-browser-speech.test.ts`,
  **exit 1**, `chrome-20261008-10-regression.log`: **18 passed / 1 failed /
  216.075084 ms**, with the exact 1,696 ms context loss above.
- PASS after fix: `npm run typecheck` and
  `node --import tsx --test tests/framework-browser-speech.test.ts tests/framework-browser-vad.test.ts tests/framework-browser-normalize.test.ts`,
  **exit 0**, `chrome-20261008-10-unit.log`: **25 passed / 0 failed/skipped/
  cancelled / 202.460709 ms**. Fake transport/lifecycle only.
- FAIL before fix: `caffeinate -disu npm run test:framework:chrome:quiet`,
  **exit 1**, `chrome-20261008-10-quiet-first.log`: all six actual cases complete.
  Japanese gains 0.25/0.1 exceed latency at **2,046.700 / 2,076.000 ms**;
  tenth-volume Japanese/English fail leading context; quieter English has the
  required `not meet today` anchor **2 / 1** times instead of three. Other
  meaning anchors are three. Scores: Japanese **6/120, 7/120, 8/120 CER**;
  English **3/66, 4/66, 10/66 WER**. Passing error rate does not erase meaning loss.
- FAIL after fix: the same quiet command, **exit 1**,
  `chrome-20261008-10-quiet-final.log`: **six cases / 3,849 real WASM VAD calls /
  24 actual FP16 WebGPU ASR jobs**. All cases now start at **32 ms**, end at exact
  EOF, drain with zero reported loss and preserve every original tail position.
  Japanese gains 0.25/0.1 still fail latency; quieter English still has `not meet
  today` **two** times. All other meaning anchors are exactly three. Four retained
  qualification failures; no third unchanged quiet retry.
- PASS: explicit Python analysis of both recorded real results, **exit 0**
  (tool output; source logs above): all six complete input hashes and **every VAD
  probability/activity** are identical before/after. All final onset/EOF/exact-job/
  queue/detector-cost gates pass. This is analysis, not another model invocation.
- FAIL: required `npm run test:framework:chrome`, **exit 1**,
  `chrome-20261008-10-stage-acceptance-final.log`: missing script. The earlier
  invocation in `chrome-20261008-10-stage-acceptance.log` also fails with the same
  message, but its log-reading shell wrapper returns 0 without preserving npm's
  exit; it is not passing acceptance. No further unchanged stage retry. B5's full
  selected-video PCM → ASR → Korean translation → DOM harness is unfinished.
- PASS: targeted three-file Biome **20 ms / no findings**, script syntax and
  preliminary whitespace checks, **exit 0**. Final repository checks follow below.

Final quiet measurements (ordered per-job endpoint latencies; single observations):

| Language / gain | Error | Required meeting-negation anchor count | Endpoint-to-text ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | ---: | --- | ---: | --- |
| ja / 1 | 6/120 = 5.000000% CER | 3 | 1651.300 / 813.000 | 16268.0000 | 1,296,288 / 3,536,064 / 3,024,384 |
| ja / 0.25 | 7/120 = 5.833333% CER | 3 | 2034.800 / 1459.500 | 20948.6875 | 2,024,288 / 3,752,432 / 1,933,168 |
| ja / 0.1 | 7/120 = 5.833333% CER | 3 | 2066.100 / 1487.500 | 20948.6875 | 1,473,296 / 3,780,448 / 2,100,736 |
| en / 1 | 3/66 = 4.545455% WER | 3 | 1326.200 / 919.200 | 12468.0000 | 1,616,864 / 3,642,176 / 1,516,080 |
| en / 0.25 | 4/66 = 6.060606% WER | 2 | 738.300 / 742.800 / 923.300 / 810.200 / 1111.000 / 806.900 / 1188.800 / 407.000 | 4784.0000 | 1,505,552 / 3,582,320 / 2,210,192 |
| en / 0.1 | 4/66 = 6.060606% WER | 2 | 1039.000 / 790.400 / 1012.400 / 755.600 / 741.000 / 788.600 / 671.500 / 345.300 | 5268.0000 | 2,060,160 / 3,820,784 / 1,642,928 |

Unchanged full inputs, before/after (language / gain / SHA-256):

- ja / 1: `128e88a9e73924fe7ddb38f9260df486e02fe95e816422c43fbb45eabe41ae89`.
- ja / 0.25: `491c4684b7a43ba42659fd754f209385ce0b8bbf974958c9a256d99e5d8832dc`.
- ja / 0.1: `9e6411995353b2c6ec0e88281747237d34c8f13ee5eb4c6869862658b7655408`.
- en / 1: `b818724035538379eca22d3375c9f14ad1a06b3513d6fed2848645c82b61a2b9`.
- en / 0.25: `cfd0cf214a38e5ecd3afed61d7393efe27b8941802a7d226f970cac54331215f`.
- en / 0.1: `75cce312bca08ad11f5a870d774a4a372185ad9a52f7e1ba2324a7ba0f944550`.

Japanese original decoded hash is
`015684bdb023e8a53ea991d73b4e2ff56266c94a9876a8239a2940521b213d8c`;
English is `f19362f78f79ac81c6c0b2189753ce6c17b640f340184443ed2b08270c0b93a8`.
Both fixtures retain their committed file hashes. Scaled peak/RMS at gain 0.1:
Japanese **0.022405460477 / 0.005200482007**, English
**0.023079598323 / 0.005802434112**. Gain 0.25 is -12.0412 dB and 0.1 is -20 dB
relative to the input, not a speaker-output-level measurement.

Final Japanese baseline ranges are **32–14,688 / 14,688–20,980.6875 ms**;
both quieter Japanese cases force **32–20,032 / 20,032–20,980.6875 ms**. Their
late detected inactive pauses are **192 / 160 ms**, shorter than the unchanged
200 ms policy. Baseline English ranges **32–11,200 / 11,200–20,063.4375 ms**.
Both quieter English cases produce **eight** contiguous jobs: their meaning loss
cannot be treated as correct merely because WER remains below 20%. Retaining
tenth-volume English onset improves **10/66 to 4/66 WER** and its meeting-negation
count from one to two, but still fails required meaning. This is a limited fix.

ASR host calls **302.800–2,059.400 ms**; per-endpoint latency uses one document
clock, including admission delay but excluding accumulation/preparation/translation/
display. VAD uses its worker clock separately, maximum **12.200 ms**; final case
VAD totals **393.300 / 400.100 / 405.700 / 389.000 / 342.200 / 344.700 ms**,
all <10% input duration. Six sessions deliver **123,132.375 ms** total input,
not one sustained/ten-minute run. No phoneme labels or natural-speaker recall claim.

Final initial joint preparation **56,855.619250 ms**, cached fresh workers
**1,220.753333–1,424.953584 ms**. First invocation initial preparation
**58,005.919250 ms**. Each invocation downloads one inventory of the unchanged
pinned small FP16 ASR (**seven files / 487,960,440 bytes**) and Silero WASM
(**one file / 2,243,022 bytes**) into its fresh owned cache, then uses cached
workers without downloading. ASR revision
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`;
VAD revision `onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`.
Every invocation observes **16 pinned artifact/redirect paths**, page errors and
native visibility events `[]`, no remote inference/companion/Ollama.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged locked
Transformers.js **4.3.0**/ORT. Final quiet owned-tree RSS baseline **1,294,560 KiB**,
peak **3,820,784 KiB** (first invocation peak **3,878,448 KiB**). 250 ms samples
include preparation, browser/renderers/GPU/shared-page double counting/allocators/
models/harness PCM. They do not prove isolated model allocation, memory pressure,
leak freedom, storage qualification or mobile performance.

### Remaining acceptance and preservation

**Next unfinished item remains B2:** improve the retained quiet Japanese forced-
boundary latency and English meeting-negation loss without removing these cases;
then qualify no-pause/quiet phoneme boundaries/natural speakers/noise, the earlier
louder-noise Japanese meaning failure, sustained learned live pressure/GPU recovery,
memory/storage and conversion/distribution licensing before selecting a default.
Earlier live/noise/full-candidate/stream/sustained/VAD/B1 commands are not rerun;
their historical evidence remains historical. Offline full speech/interpretation,
Korean translation/revisions/DOM, ten-minute live Korean captions, B3–B6,
installation and Safari/iPhone remain **unverified**.

No required environment/device/permission is absent. This is incomplete
implementation and failed quality qualification; neither terminal marker applies.
No checklist item or stage/framework/iPhone completion is claimed. Work stays in
this worktree; companion v0.1.0/install/native messaging/server/user settings and
unrelated files/apps/recordings/mounted images are preserved. No agents, runner
edit, stage advance, push/publish/app installation or browser access/profile/
permission bypass. Only owned test browsers/profiles are closed/removed. No
credentials, weights, user audio/transcripts or temporary ignored `.ralph` state
are staged. Final original EOF and required verification evidence follows.


### Passing original EOF verification

PASS: `caffeinate -disu npm run test:framework:chrome:eof`, **exit 0**, once,
`chrome-20261008-10-eof.log`: typecheck/build, **ten original cases / 6,419 real
WASM VAD calls / 20 actual FP16 WebGPU ASR jobs**, all unchanged assertions pass.
Every Japanese case scores **6/120 = 5% CER**, every English **3/66 = 4.545455%
WER**, every meaning exactly three times, **32 ms leading / 0 ms trailing**
context, every original/tail position submitted, exact contiguous jobs, zero loss
and drained queue. Explicit Python recorded-result analysis, **exit 0**, confirms
all ten full input hashes match iteration 9; no inference rerun.

| Language / appended samples | Endpoint-to-text ms | VAD total ms | Baseline / peak / final RSS KiB |
| --- | --- | ---: | --- |
| ja / 0 | 1668.700 / 809.200 | 387.300 | 1,297,616 / 3,397,856 / 2,740,144 |
| ja / 341 | 1662.000 / 833.100 | 407.800 | 1,947,696 / 4,078,384 / 1,948,304 |
| ja / 511 | 1642.800 / 835.000 | 386.700 | 1,911,248 / 3,880,368 / 2,185,024 |
| ja / 853 | 1652.900 / 834.900 | 385.300 | 1,664,384 / 3,630,368 / 2,208,304 |
| ja / 1365 | 1664.800 / 809.700 | 405.500 | 1,709,520 / 3,830,720 / 2,009,184 |
| en / 0 | 1327.900 / 885.600 | 380.100 | 1,717,664 / 3,835,984 / 1,894,208 |
| en / 341 | 1348.900 / 912.700 | 386.800 | 1,867,984 / 3,675,664 / 1,526,128 |
| en / 511 | 1342.800 / 917.800 | 383.000 | 1,515,712 / 3,693,520 / 1,630,048 |
| en / 853 | 1313.200 / 917.900 | 378.700 | 1,620,672 / 3,764,224 / 1,585,984 |
| en / 1365 | 1314.600 / 924.700 | 379.800 | 1,577,920 / 3,637,024 / 1,735,008 |

Ranges stay **32–14,688 / 14,688–exact EOF** for Japanese and
**32–11,200 / 11,200–exact EOF** for English, matching the prior original corpus.
Peak pending **16,268 ms**, ASR host calls **806.900–1,459.100 ms**, maximum VAD
call **17.500 ms**. Initial joint preparation **54,506.992958 ms**, cached workers
**1,218.138334–1,520.548958 ms**, 16 pinned remote paths, page errors/visibility
events `[]`. Owned-tree RSS baseline **1,293,872 KiB**, peak **4,078,384 KiB**,
with the same sampling and limitations stated above. This third browser invocation
downloads one fresh inventory of the same two pinned candidates and reuses it.
No new model/dependency. The original EOF pass preserves baseline acceptance;
it does not override quieter-input failures or missing full Chrome acceptance.


### Final required verification

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-10-verify.log`: Biome **115 files / 52 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**111 JS passed / 0 failed/skipped/cancelled / 21,677.050 ms**,
**222 Python passed / 66.92 s**, Python **3.12.15**. Runs after all three actual
browser/model invocations; later edits only finish Markdown evidence. This pass
does not override the four retained quiet-input qualification failures or missing
full Chrome acceptance. B2–B6 remain unchecked. Final document-inclusive whitespace,
six-file commit scope and post-commit cleanliness are checked before delivery.


## 2026-10-08 — B2 shorter late quiet pauses (iteration 11/20)

Related commit: `fix: split late browser speech at shorter pauses`, containing this
report. **B2 remains unchecked; no ASR default is selected.** Only B2 advances.

### Scope, regression and unchanged acceptance

Assumption: the retained quiet Japanese latency failure should first use the
existing learned pause evidence, before changing a model or adding segmentation
machinery. The prior real trace has a **192 / 160 ms** late pause at gains
**0.25 / 0.1**, below the experimental 200 ms rule, forcing the 20 s cut. The
smaller fix permits **five full detector frames / 160 ms after ten seconds**.
Earlier pauses still require 500 ms; the split still waits for another learned
speech onset and retains each side of the pause contiguously. 128 ms remains too
short. Learned admission **probability >=0.5**, context-retention RMS **0.001**,
1,500 ms immediate silence endpoint/256 ms retained context, 20 s maximum,
30 s total retained audio, pending jobs/results, energy comparison and every
model/backend/dependency/user setting remain unchanged. No ASR samples are
filtered, padded, overlapped, omitted or prompted with labels.

The new fake-detector regression covers 128/160/192 ms late pauses crossed with
five exact EOF offsets. It requires the 128 ms control's 20 s cut and the 160/192
ms cases' **14,496 ms** midpoint, exact concatenated Float32 PCM, bounded jobs,
complete detector coverage and zero reported loss/pending. These strings establish
transport/segmentation, not recognition. The existing pre-ten-second pause,
quiet-onset/noise rejection, long-silence, queue and cancellation regressions remain.

No browser harness, fixture/hash/sentence, quality or latency gate changes.
`test:framework:chrome:quiet` still evaluates all six gain cases with three full
periods, 512 zero prefix samples and 511 zero tail samples, including the original
carrier. VAD and ASR receive the same scaled input without gain restoration. Gates
remain **<=20% CER/WER**, **every meaning exactly three times**, **<2,000 ms
per endpoint**, **<=100 ms leading / <20 ms trailing context**, every original
sample position through EOF, exact contiguous unfiltered ASR slices, **<=20 s
jobs / <=30 s queue / zero reported loss / drained queue**, complete VAD coverage
and **<10% input duration in detector inference**, real cached fresh workers,
pinned model paths and visible-document/page-error checks. Failing English cases
remain failing. This is controlled synthetic amplitude qualification, not natural
quiet speech, live volume settings, acoustic phoneme labels or Korean captions.

### Exact command ledger and quiet evidence

All named logs are ignored local `.ralph/media-framework/` evidence.

- FAIL: initial standalone speech tests, **exit 1**, **19 passed / 1 failed /
  211.850667 ms**, `chrome-20261008-11-regression.log`: the new 128 ms control
  incorrectly expected an unadmitted 31.5 ms EOF remainder to be an ASR job.
  Corrected only this newly added fake fixture to 21 s, providing admitted
  speech after the maximum cut and enough actual samples for a second job.
  The real fixtures and all existing expectations are untouched.
- FAIL before fix: `node --import tsx --test tests/framework-browser-speech.test.ts`,
  **exit 1**, **19 passed / 1 failed / 220.662750 ms**,
  `chrome-20261008-11-regression-final.log`: the corrected five-frame case
  produces **0–20,000 / 20,000–21,031.5 ms**, failing the required
  **0–14,496 / 14,496–21,031.5 ms**. This establishes the boundary regression.
- PASS after fix: `npm run typecheck` and
  `node --import tsx --test tests/framework-browser-speech.test.ts tests/framework-browser-vad.test.ts tests/framework-browser-normalize.test.ts`,
  **exit 0**, **26 passed / 0 failed/skipped/cancelled / 263.828375 ms**,
  `chrome-20261008-11-unit.log`. Fake transport/lifecycle only.
- FAIL: `caffeinate -disu npm run test:framework:chrome:quiet`, **exit 1**, once,
  `chrome-20261008-11-quiet.log`: typecheck/build, **six real cases / 3,849 WASM
  VAD calls / 24 FP16 WebGPU ASR jobs** complete. All Japanese gates now pass,
  including quiet latency. Exactly **two English meaning failures** remain:
  `not meet today` occurs twice at gains 0.25/0.1 instead of three. Every other
  anchor occurs three times; all error-rate, endpoint, coverage, queue and
  detector-cost gates pass. No unchanged quiet retry.
- PASS: explicit Python recorded-result assertions, **exit 0** (tool output;
  source logs are the prior iteration's final quiet log and this quiet log):
  **all six input hashes and every VAD probability/activity are identical**.
  Every current onset/EOF/exact-job/queue/error-rate/latency/cost check passes;
  the assertions also verify exactly the two retained English meaning failures.
  This analysis is not another model invocation.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-11-stage-acceptance.log`: missing script. B5's full selected-
  video PCM → ASR → Korean translation → DOM harness remains unfinished.
  No placeholder or ASR-only substitute is added; no further unchanged retry.
- PASS: `./node_modules/.bin/biome lint packages/engines-browser/speech-recognizer.ts tests/framework-browser-speech.test.ts`,
  **exit 0 / two files / 7 ms / no findings**, and preliminary whitespace.

| Language / gain | Error | Meeting-negation count | Endpoint-to-text ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | ---: | --- | ---: | --- |
| ja / 1 | 3/120 = 2.5% CER | 3 | 1406.100 / 1038.500 | 13168 | 1,296,624 / 3,556,496 / 2,060,944 |
| ja / 0.25 | 3/120 = 2.5% CER | 3 | 1489.300 / 834.900 | 16168 | 2,032,608 / 3,765,376 / 1,514,336 |
| ja / 0.1 | 6/120 = 5% CER | 3 | 1560.900 / 837.400 | 16268 | 1,488,256 / 3,793,968 / 1,540,416 |
| en / 1 | 3/66 = 4.545455% WER | 3 | 1340.900 / 922.500 | 12468 | 1,540,640 / 3,678,464 / 1,507,600 |
| en / 0.25 | 4/66 = 6.060606% WER | 2 | 737.200 / 765.800 / 913.800 / 802.100 / 1085.100 / 831.000 / 1200.800 / 427.300 | 4784 | 1,500,384 / 3,810,272 / 2,312,576 |
| en / 0.1 | 4/66 = 6.060606% WER | 2 | 1011.700 / 826.500 / 1033.800 / 756.300 / 759.700 / 798.500 / 650.700 / 361.100 | 5268 | 2,146,160 / 3,807,744 / 1,515,680 |

All cases start at **32 ms** and end at exact EOF, with **zero reported loss /
zero final pending**, all original/tail positions submitted. Japanese midpoint
splits are **11,776 / 14,720 / 14,752 ms** for gains 1/0.25/0.1, then exact EOF
**20,980.6875 ms**. Quieter Japanese latency falls from **2,034.800 / 2,066.100**
to **1,489.300 / 1,560.900 ms** on these single observations. Quieter English
ranges, texts and meaning failures are unchanged; eight contiguous jobs remain
per case. Gains 1/0.25/0.1 input hashes are exactly those recorded in iteration 10;
there is no new input normalization or deletion. A passing error rate still does
not override the English meaning failures.

ASR host calls **347.700–1,452.500 ms**, max VAD call **11.700 ms**. Ordered case
VAD totals **386.300 / 394.200 / 386.900 / 377.400 / 358.000 / 341.000 ms**,
all <10% input duration. Six sessions total **123,132.375 ms** input; this is not
one sustained session. Endpoint latency uses one document clock, includes
admission delay and excludes speech accumulation/preparation/translation/display.
VAD's worker clock is separate. These are observations, not population percentiles.

Initial joint preparation **61,777.770125 ms**; cached fresh workers
**1,217.629417–1,322.989875 ms**, with no later downloading. Same pinned small
FP16 WebGPU ASR `onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`
(**seven files / 487,960,440 bytes**) and Silero WASM
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**). This invocation downloads one inventory each
into a fresh owned cache and reuses it. **16 pinned artifact/redirect paths**,
page errors/visibility events `[]`, no remote inference/companion/Ollama.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, unchanged locked
Transformers.js **4.3.0**/ORT. Quiet overall RSS baseline **1,292,928 KiB**, peak
**3,810,272 KiB**. Every 250 ms the harness sums only the owned browser tree,
including preparation/browser/renderers/GPU/shared-page double counting/allocators/
resident models/harness PCM. This is not isolated model memory, leak freedom,
memory/storage pressure or mobile performance. Original EOF/live and final
required verification evidence are recorded below after their actual runs.


### Passing original EOF acceptance

PASS: `caffeinate -disu npm run test:framework:chrome:eof`, **exit 0**, once,
`chrome-20261008-11-eof.log`: typecheck/build and **ten unchanged cases / 6,419
real WASM VAD calls / 20 FP16 WebGPU ASR jobs**, all original assertions pass.
Japanese **3/120 = 2.5% CER**, English **3/66 = 4.545455% WER**, every meaning
exactly three, **32 ms leading / 0 ms trailing**, all original/tail positions
submitted, exact contiguous PCM, **zero loss / drained queue**. Explicit Python
recorded-result assertions, **exit 0**, confirm **all ten input hashes and every
VAD probability/activity match iteration 10**, plus the current quality/coverage/
latency/queue gates. This analysis is not another inference run.

| Language / appended samples | Endpoint-to-text ms | VAD total ms | Baseline / peak / final RSS KiB |
| --- | --- | ---: | --- |
| ja / 0 | 1414.000 / 1047.500 | 410.700 | 1,300,000 / 3,340,544 / 1,814,976 |
| ja / 341 | 1388.200 / 1039.300 | 414.100 | 1,815,680 / 3,796,112 / 1,420,272 |
| ja / 511 | 1380.600 / 1048.600 | 393.700 | 1,410,384 / 3,855,968 / 1,511,760 |
| ja / 853 | 1336.400 / 1034.100 | 402.500 | 1,474,400 / 3,586,096 / 1,729,312 |
| ja / 1365 | 1391.100 / 1011.600 | 379.700 | 1,729,584 / 3,634,144 / 1,660,928 |
| en / 0 | 1334.600 / 904.800 | 382.900 | 1,661,456 / 3,670,784 / 1,539,200 |
| en / 341 | 1302.700 / 919.600 | 378.900 | 1,528,512 / 3,647,504 / 1,561,744 |
| en / 511 | 1297.800 / 920.900 | 387.800 | 1,551,296 / 3,707,808 / 1,735,824 |
| en / 853 | 1299.000 / 899.800 | 383.300 | 1,735,888 / 3,776,992 / 1,761,040 |
| en / 1365 | 1327.400 / 907.600 | 402.300 | 1,688,736 / 3,649,568 / 1,663,296 |

Japanese splits at **11,776 ms**, English **11,200 ms**, followed by exact EOF
for each offset. Peak pending **13,168 ms**, ASR host calls **894.500–1,306.000
ms**, max VAD call **21.900 ms**. Initial preparation **53,783.445292 ms**,
cached fresh workers **1,218.631041–1,423.059458 ms**, 16 pinned remote paths,
page errors/visibility events `[]`. This second browser invocation downloads one
inventory of each unchanged pinned candidate into a fresh owned cache and reuses
it. Owned-tree RSS baseline **1,295,856 KiB**, peak **3,855,968 KiB**, with the
same clock/sampling/shared-page/allocator/model/harness limitations above.
This original EOF pass does not override quieter English or full-stage failures.


### Passing live selected-video acceptance

PASS: `caffeinate -disu npm run test:framework:chrome:live:learned`, **exit 0**,
once, `chrome-20261008-11-live.log`: typecheck/**26 tests / 263.294291 ms**,
build and all **six real selected-video rounds / 1,961 WASM VAD calls / seven
FP16 WebGPU ASR jobs**. Production catalog/input → normalizer → learned detector
→ actual ASR uses captured samples; expected text/decoded reference PCM does not
supply inference. Original isolation, timing/mapping, input identity, unfiltered
job slices, preserved playback/volume/mute/rate/source, continued capture and
fresh cached workers pass. These are short synthetic videos, not natural speakers,
quiet live volume settings, Korean translation/DOM or ten-minute interpretation.

| Round / language / periods | Raw 48 kHz / normalized samples | ASR ranges ms | Error | Last-packet-to-text ms | Max map error ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 0 / ja / 1 | 337920 / 112640 | 64–7040 | 1/40 = 2.5% CER | 948.400 | 32.559 | 6976 | 3,081,056 / 3,194,432 / 1,966,848 |
| 1 / ja / Stop | 43008 / 14336 | No ASR | Unscored | No text | 42.354 | Cancelled | 3,071,712 / 3,071,712 / 2,791,248 |
| 2 / ja / 1 | 337920 / 112640 | 96–7040 | 1/40 = 2.5% CER | 1069.700 | 48.573333 | 6944 | 3,799,392 / 3,807,200 / 1,920,096 |
| 3 / en / 1 | 323584 / 107861 | 32–6741.3125 | 1/22 = 4.545455% WER | 886.500 | 41.695 | 6709.3125 | 3,762,240 / 3,766,624 / 1,487,040 |
| 4 / ja / 3 | 1007616 / 335872 | 64–11840 / 11840–20992 | 3/120 = 2.5% CER | 1088.200 | 45.910333 | 13204.6875 | 3,589,456 / 3,594,672 / 1,537,968 |
| 5 / en / 3 | 962560 / 320853 | 32–11168 / 11168–20053.3125 | 3/66 = 4.545455% WER | 852.000 | 43.205333 | 12426 | 2,910,368 / 2,910,368 / 1,505,984 |

Every scored meaning occurs once/three times as applicable; completed runs end
at exact EOF with **zero loss / zero pending**. Stop interrupts **27 real VAD
frames**, reports **863.375 ms explicit discard / zero pending**, emits no text,
detaches capture and leaves playback advancing; fresh Start passes. Leading
context **32–96 ms**, trailing **0 ms**. During the long Japanese first ASR job,
normalized acquisition advances **11,946–13,268.6875 ms**, establishing finite
capture/inference overlap, not sustained pressure/GPU recovery. ASR host calls
**848.100–1,341.700 ms**. Live last-packet latency is a different metric from the
EOF endpoint metric; both use one document clock and exclude accumulation/
preparation/translation/display. VAD's separate worker clock has max **10 ms**,
completed-round totals **161.800 / 153.800 / 160.500 / 464.600 / 434.500 ms**,
all <10% input duration.

Initial preparation **52,841.797500 ms**, cached fresh workers
**1,319.293250–1,441.663708 ms**; third browser invocation downloads one inventory
of each unchanged pinned candidate and reuses it, **16 pinned paths / 16 requests**,
page errors/native visibility events `[]`. Browser/OS/dependencies unchanged.
Owned-tree baseline **1,434,240 KiB**. Live case baselines/peaks start **after
preparation**; same 250 ms RSS/shared-page/allocator/GPU/harness limitations apply.
These figures do not establish preparation peak, isolated model memory, leaks,
storage/memory pressure or mobile performance.

PASS: corrected explicit Python assertions over this recorded live result,
**exit 0**, for all recognition/meaning/latency/queue/Stop checks. Initial metadata
extraction returned **exit 1 / KeyError: queue** because it read model `statuses`
instead of `queueStatuses`; corrected extraction uses the recorded queue stream.
This is a reporting-script failure, not a model/harness failure or a rerun.

### Remaining acceptance and preservation

**Next unfinished item remains B2:** improve retained quiet English fragmented
meeting-negation loss without removing its cases/gates, then qualify no-pause/
quiet phoneme boundaries, natural speakers/noise, the earlier louder-noise
Japanese meaning failure, sustained learned live queue/GPU recovery, memory/
storage and conversion/distribution licensing before selecting a default.
Original noise/full-candidate/stream/sustained/VAD/B1 commands are **not rerun**;
prior passes/failures remain historical. Offline full speech/interpretation,
Korean translation/revisions/DOM, ten-minute live Korean captions, B3–B6,
installation and Safari/iPhone remain **unverified**. Required full Chrome
acceptance **fails** as recorded; short actual ASR passes do not complete it.

No required environment/device/permission is absent. This is failed quality
qualification/incomplete implementation; neither terminal marker applies.
All unfinished checkboxes remain unchecked; no stage/framework/iPhone completion
claim. Supplied instructions/plan/architecture/prior report read; root/nested
AGENTS.md and requested independent runner file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent.

Work stays in this worktree. Published companion v0.1.0/install/native messaging/
server/settings and unrelated files/apps/recordings/mounted images are preserved.
No agents, runner edit, stage advance, push/publish/app installation or blocked
browser/profile/permission bypass. Only owned test browsers/profiles are closed/
removed. Credentials, model weights, user audio/transcripts and temporary ignored
`.ralph` state are excluded from commits. Final required verification follows.


### Final required verification

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-11-verify.log`: Biome **115 files / 53 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**112 JS passed / 0 failed/skipped/cancelled / 21,219.986792 ms**,
**222 Python passed / 66.85 s**, Python **3.12.15**. Runs after all three real
browser/model invocations; later changes only finish Markdown evidence. This
passing repository check does not override the two retained quiet English meaning
failures or missing full Chrome acceptance. B2–B6 remain unchecked. Final document-
inclusive unstaged/staged whitespace, four-file commit scope and post-commit
cleanliness are checked before delivery. Only recognizer, regression tests, report
and plan are committed; credentials/weights/user data/temporary state are excluded.


## 2026-10-08 — B2 confirmed learned onset boundaries (iteration 12/20)

Related commit: `fix: confirm browser speech onset before pause cuts`, containing
this report. **B2 remains unchecked; no ASR default is selected.** Only B2 advances.

### Scope, regression and unchanged acceptance

Assumption: inspect the retained quiet English failure before changing a model.
The prior gain-0.25 trace cuts at **448 ms** after an isolated active frame,
splitting “not meet today” across jobs; gain 0.1 similarly cuts at **13,856 ms**
after an isolated 32 ms hit. The smaller change confirms a resumed onset with
**160 ms / five full consecutive active frames** before submitting its stored
pause midpoint. An inactive frame discards an unconfirmed candidate. The next
qualifying pause can create a new candidate; segment submission clears it.
Only local bounded segmentation state is added, with no new public API.

Pause eligibility remains **500 ms before ten seconds / 160 ms afterward**.
The learned probability **0.5**, context RMS **0.001**, immediate **1,500 ms**
silence endpoint/**256 ms** retained context, **20 s** segment/**30 s** queue,
pending jobs/results and energy comparison remain. No audio is filtered, padded,
overlapped, restored in gain or omitted from an admitted job. Model/backend/
dependency/default/user settings and the companion are unchanged.

The new fake-detector regression crosses **1/2/4/5 active frames** after a
qualifying pause, followed by a later genuine onset. It asserts that short blips
cannot cut, five frames preserve the original midpoint, the later candidate
works, concatenated PCM equals every supplied sample, all detector frames are
covered and the queue drains without loss. Existing long-silence, late pause,
EOF, cancellation and bounds checks remain. The stalled pending-job regression
still rejects the fourth job with the same two pending jobs; its exact reported
discard changes **4,128 → 4,256 ms** because confirmation acquires four more
frames before rejection. Its late result still cannot revive status.
These fake outputs establish segmentation/transport, not recognition.

No browser harness/script/fixture/hash/sentence or quality/latency gate changes.
Quiet acceptance retains all six cases, original carriers, three periods,
512 zero prefix samples and 511 zero tail samples. Gates remain **<=20% CER/WER**,
**every meaning exactly three times**, **<2,000 ms per endpoint**, **<=100 ms
leading / <20 ms trailing**, every original position through EOF, exact contiguous
unfiltered ASR slices, **<=20 s jobs / <=30 s queue / zero loss / drained queue**,
complete detector coverage, **<10% input duration in detector inference**, actual
cached fresh workers, pinned remote paths and visible/error-free documents.
Controlled attenuated synthetic PCM is not natural quiet speech, acoustic phoneme
labels, live volume settings or Korean translation/display evidence.

### Exact command ledger and passing quiet evidence

All named logs are ignored local `.ralph/media-framework/` evidence.

- FAIL before fix: `node --import tsx --test tests/framework-browser-speech.test.ts`,
  **exit 1 / 20 passed / 1 failed / 289.832916 ms**,
  `chrome-20261008-12-regression.log`: one-frame candidate incorrectly submits
  **0–2,880 / 2,880–5,280 / 5,280–7,200** instead of the required
  **0–5,280 / 5,280–7,200 ms**. The shell originally tails this log after the
  test, so that wrapper exits 0; the actual test result is failure as recorded.
- FAIL initial after fix: targeted speech/VAD/normalization tests, **exit 1 /
  26 passed / 1 failed / 277.623625 ms**, `chrome-20261008-12-unit-initial.log`:
  exact stalled-job discard expectation still uses the old acquisition point.
  Update only that exact value for the four additional confirmation frames;
  no queue limit, failure, late-result or input assertion is removed.
- PASS: `node --import tsx --test tests/framework-browser-speech.test.ts tests/framework-browser-vad.test.ts tests/framework-browser-normalize.test.ts`,
  **exit 0 / 27 passed / 0 failed/skipped/cancelled / 272.377667 ms**,
  `chrome-20261008-12-unit.log`. Fake transport/lifecycle only.
- PASS: `caffeinate -disu npm run test:framework:chrome:quiet`, **exit 0**, once,
  `chrome-20261008-12-quiet.log`: typecheck/build, **six real cases / 3,849 WASM
  VAD calls / 19 FP16 WebGPU ASR jobs**, every unchanged gate passes.
  Both prior quiet-English meaning failures are resolved in this observation.
- PASS: explicit Python assertions over recorded quiet results, **exit 0**,
  tool output: all **six input hashes and every VAD probability/activity/sample
  position match iteration 11**; current meaning/accuracy/latency/exact jobs/EOF/
  loss/drained queue pass. Initial analysis **exit 1 / TypeError** used
  `zip(strict=True)` in system Python **3.9.6**; corrected analysis checks list
  lengths explicitly. This reporting failure is not another model invocation.
- FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-12-stage-acceptance.log`: missing B5 full selected-video PCM
  → ASR → Korean translation → DOM harness. No placeholder/substitute/retry.
- PASS: targeted Biome **two files / 21 ms / no findings** and preliminary
  `git diff --check`, **exit 0**. Final document-inclusive checks follow.

| Language / gain | Error | Every meaning count | Endpoint-to-text ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | ---: | --- | ---: | --- |
| ja / 1 | 3/120 = 2.5% CER | 3 | 1493.900 / 1088.700 | 13168 | 1,300,272 / 3,875,568 / 1,913,776 |
| ja / 0.25 | 3/120 = 2.5% CER | 3 | 1600.700 / 839.300 | 16268 | 1,920,192 / 3,591,696 / 1,639,920 |
| ja / 0.1 | 6/120 = 5% CER | 3 | 1652.000 / 846.400 | 16368 | 1,614,464 / 3,943,904 / 2,162,032 |
| en / 1 | 3/66 = 4.545455% WER | 3 | 1440.600 / 905.600 | 12568 | 1,673,984 / 3,656,688 / 1,616,720 |
| en / 0.25 | 3/66 = 4.545455% WER | 3 | 974.900 / 1199.500 / 1289.400 / 919.000 / 1313.800 / 427.800 | 7888 | 1,606,864 / 3,815,392 / 1,600,032 |
| en / 0.1 | 3/66 = 4.545455% WER | 3 | 971.300 / 990.300 / 1194.100 / 990.300 / 424.300 | 7356 | 1,593,840 / 3,723,744 / 2,263,232 |

Japanese midpoints stay **11,776 / 14,720 / 14,752 ms**, then exact EOF
**20,980.6875 ms**. English gain 1 stays **11,200 ms**, then exact EOF
**20,063.4375 ms**. Gain 0.25 now cuts at **1,312 / 8,096 / 10,816 / 14,720 /
17,440 ms**, six jobs; gain 0.1 at **4,288 / 8,096 / 10,944 / 17,376 ms**, five
jobs; both reach exact EOF. Their WER improves from **4/66 → 3/66** and meeting
negation count **2 → 3**, without a new input hash or detector result. All cases
start at **32 ms**, end with **0 ms trailing**, and report **zero loss / pending**.

ASR host calls **420.500–1,447.200 ms**, maximum VAD call **12.900 ms**.
Ordered VAD totals **399.300 / 397.800 / 407.400 / 388.600 / 351.400 / 371.800 ms**,
all <10% input duration. Six sessions total **123,132.375 ms** input, not a
sustained session. Endpoint latency uses one document clock, includes boundary
confirmation/admission delay and excludes accumulation/preparation/translation/
display. VAD has its separate worker clock. These are observations, not percentiles.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, locked Transformers.js **4.3.0**/
ORT unchanged. Same pinned small FP16 WebGPU ASR
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`
(**seven files / 487,960,440 bytes**) and Silero WASM
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**). One fresh owned cache inventory each in this
invocation, then cached fresh workers. Initial preparation **53,364.752291 ms**,
cached **1,220.161167–1,326.351166 ms**, **16 pinned paths**, page errors/native
visibility events `[]`, no remote inference/companion/Ollama.
Quiet RSS baseline **1,297,712 KiB**, peak **3,943,904 KiB**. Every 250 ms the
harness sums only the owned browser tree, including preparation/browser/renderers/
GPU/shared-page double counting/allocators/models/harness PCM. Not isolated model
memory, leak freedom, memory/storage pressure or mobile performance.


### Passing original EOF acceptance

PASS: `caffeinate -disu npm run test:framework:chrome:eof`, **exit 0**, once,
`chrome-20261008-12-eof.log`: typecheck/build, **ten unchanged cases / 6,419 WASM
VAD calls / 20 FP16 WebGPU ASR jobs**, every original assertion passes.
Japanese **3/120 = 2.5% CER**, English **3/66 = 4.545455% WER**, every meaning
three, **32 ms leading / zero trailing**, every original/tail position submitted,
exact contiguous PCM, **zero loss / drained queue**. Explicit Python assertions,
**exit 0**, tool output, confirm all ten hashes and every detector probability/
activity/sample position match iteration 11, and all current quality/coverage/
latency/queue checks pass. No inference rerun.

| Language / appended samples | Endpoint-to-text ms | VAD total ms | Baseline / peak / final RSS KiB |
| --- | --- | ---: | --- |
| ja / 0 | 1485.800 / 1044.100 | 375.000 | 1,297,376 / 3,264,496 / 1,763,296 |
| ja / 341 | 1465.800 / 1007.300 | 400.000 | 1,765,520 / 3,766,960 / 1,767,616 |
| ja / 511 | 1477.800 / 1032.700 | 410.600 | 1,752,544 / 3,787,248 / 1,616,320 |
| ja / 853 | 1450.000 / 1033.300 | 410.300 | 1,616,656 / 3,803,568 / 1,712,832 |
| ja / 1365 | 1468.100 / 1025.400 | 401.200 | 1,712,976 / 3,790,432 / 1,666,240 |
| en / 0 | 1403.300 / 900.700 | 383.400 | 1,651,056 / 3,789,840 / 1,716,512 |
| en / 341 | 1427.500 / 885.200 | 388.000 | 1,701,328 / 3,877,552 / 1,685,696 |
| en / 511 | 1432.200 / 924.800 | 391.400 | 1,675,072 / 3,743,248 / 1,472,592 |
| en / 853 | 1419.500 / 906.000 | 404.600 | 1,458,160 / 3,699,760 / 2,064,080 |
| en / 1365 | 1432.300 / 905.900 | 389.800 | 1,661,328 / 3,857,936 / 1,807,072 |

Splits remain **11,776 ms Japanese / 11,200 ms English**, then each exact EOF.
Peak pending **13,168 ms**, ASR calls **883.400–1,276.700 ms**, max VAD call
**13.600 ms**. Initial preparation **54,996.201917 ms**, cached workers
**1,217.726000–1,421.138916 ms**, 16 pinned paths, page errors/visibility events
`[]`. This second invocation downloads one inventory each of the same pinned
ASR/VAD candidates and reuses it. Owned-tree RSS baseline **1,292,544 KiB**, peak
**3,877,552 KiB**, with the same sampling/clock/shared-page/allocator/model/harness
limitations above. Short decoded ASR passes do not complete full Chrome acceptance.


### Passing live selected-video acceptance

PASS: `caffeinate -disu npm run test:framework:chrome:live:learned`, **exit 0**,
once, `chrome-20261008-12-live.log`: typecheck/**27 tests / 257.395500 ms**,
build, **six actual selected-video rounds / 1,959 WASM VAD calls / seven FP16
WebGPU ASR jobs**. Production catalog/input → normalizer → detector → ASR uses
captured samples; labels/decoded references do not supply inference. All unchanged
isolation, input identity/exact job slices, mapping, playback/volume/mute/rate/
source, continued capture and fresh cached worker checks pass. Short synthetic
videos do not establish natural quiet speech, Korean translation/DOM, ten-minute
interpretation or sustained learned pressure/GPU recovery.

| Round / language / periods | Raw 48 kHz / normalized samples | ASR ranges ms | Error | Last-packet-to-text ms | Max map error ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 0 / ja / 1 | 335872 / 111957 | 64–6997.3125 | 1/40 = 2.5% CER | 1005.800 | 24.563667 | 6933.3125 | 3,137,696 / 3,241,552 / 1,937,904 |
| 1 / ja / Stop | 43008 / 14336 | No ASR | Unscored | No text | 40.594333 | Cancelled | 3,707,328 / 3,707,328 / 2,670,256 |
| 2 / ja / 1 | 337920 / 112640 | 64–7040 | 1/40 = 2.5% CER | 988.400 | 45.885667 | 6976 | 3,782,160 / 3,791,824 / 1,708,752 |
| 3 / en / 1 | 321536 / 107178 | 32–6698.625 | 1/22 = 4.545455% WER | 814.800 | 41.739667 | 6666.625 | 3,552,848 / 3,553,696 / 1,640,880 |
| 4 / ja / 3 | 1007616 / 335872 | 64–14752 / 14752–20992 | 3/120 = 2.5% CER | 812.600 | 40.820000 | 16490 | 3,684,272 / 3,691,120 / 1,511,520 |
| 5 / en / 3 | 962560 / 320853 | 32–11168 / 11168–20053.3125 | 3/66 = 4.545455% WER | 926.200 | 45.090333 | 12511.375 | 3,043,984 / 3,043,984 / 1,592,496 |

Every scored meaning occurs once/three times as applicable. Completed rounds
have **32–64 ms leading / zero trailing**, exact EOF, **zero loss/pending**.
Stop interrupts **27 real detector frames**, explicitly discards **831.375 ms**,
emits no transcript, detaches capture and preserves advancing playback; fresh
Start passes. The long Japanese split moves from the historical **11,840** to
**14,752 ms** in this captured run, with peak pending **16,490 ms** (still <=30 s).
Live sample timing/input differs between captures; there is no unchanged live
hash claim or causal attribution to a particular detector frame from this run.
All retained recognition/meaning/latency/queue gates pass despite the later split.

During its first ASR call, normalized acquisition advances **15,060.6875–16,554
ms**, proving finite capture/inference overlap, not sustained queue/GPU recovery.
ASR host calls **810.200–1,501.300 ms**, max VAD call **17.100 ms**. Completed-round
VAD totals **163.600 / 161.300 / 149.800 / 451.600 / 440.600 ms**, all <10% input.
Live last-packet latency and decoded EOF endpoint latency are different metrics;
both use one document clock and exclude accumulation/preparation/translation/
display. VAD has its separate worker clock.

Initial preparation **53,956.750250 ms**, cached workers
**1,319.228791–1,327.095000 ms**. This third invocation downloads one inventory
each of the unchanged pinned ASR/VAD candidates, then reuses it; **16 pinned paths /
16 requests**, page errors/native visibility events `[]`. Environment/dependencies
unchanged. Owned-tree baseline **1,430,096 KiB**; live case baselines/peaks start
**after preparation**. Same 250 ms RSS/shared-page/allocator/GPU/harness limits
apply; these case values do not establish preparation peak, isolated model memory,
leak freedom, storage/memory pressure or mobile performance.

PASS: explicit Python assertions over recorded live results, **exit 0**, tool
output, confirm all scored recognition/meaning/latency/queue checks and Stop/
playback preservation. Initial metadata display, **exit 0**, used the wrong
`rounds` key and printed an excessively large `liveRuns` summary; corrected
extraction selects the six live rounds and their scalar measurements. Reporting
only, not another browser/model invocation or acceptance failure.

### Remaining acceptance and preservation

**Next unfinished item remains B2:** qualify no-pause/quiet phoneme boundaries,
natural speakers/noise, the earlier louder-noise Japanese meaning failure,
sustained learned live queue/GPU recovery, memory/storage and conversion/
distribution licensing before selecting a default. Quiet English synthetic
qualification now passes; it does not resolve those remaining gates. Original
noise/full-candidate/stream/sustained/VAD/B1 commands are **not rerun**; their
prior passes/failures remain historical. Offline full speech/interpretation,
Korean translation/revisions/DOM, ten-minute live Korean captions, B3–B6,
installation and Safari/iPhone remain **unverified**. Required full Chrome
acceptance **fails** as recorded; short ASR acceptance does not complete it.

No required environment/device/permission is absent. This is incomplete
qualification/implementation, so neither terminal marker applies. B2–B6 remain
unchecked, with no stage/framework/iPhone completion claim. Supplied instructions,
plan, architecture and prior report read; root/nested AGENTS.md and requested
independent runner file `2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent.

Work remains in this worktree. Companion v0.1.0/install/native messaging/server/
settings and unrelated files/apps/recordings/mounted images are preserved. No
agents, runner edits, stage advance, push/publish/app installation or blocked
browser/profile/permission bypass. Only owned test browsers/profiles cleaned up.
No credentials, weights, user audio/transcripts or ignored temporary `.ralph`
state enters commits. Final required verification and commit checks follow.


### Final required verification

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-12-verify.log`: Biome **115 files / 54 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**113 JS passed / 0 failed/skipped/cancelled / 21,813.770292 ms**,
**222 Python passed / 66.94 s**, Python **3.12.15**. Runs after all three real
browser/model invocations; later changes only finish Markdown evidence. Passing
repository verification does not override missing full Chrome acceptance or
remaining B2 qualification. B2–B6 stay unchecked. Document-inclusive unstaged/
staged whitespace, exact four-file commit scope and post-commit cleanliness are
checked before delivery. Only recognizer, regression tests, report and plan are
committed; credentials/weights/user data/temporary state are excluded.


## 2026-10-08 — B2 cached offline recognition qualification (iteration 13/20)

Related commit: `test: qualify cached browser ASR offline`, containing this
report. **B2 remains unchecked; no ASR default is selected.** Only B2 advances.

### Scope and acceptance

Assumption: the louder-noise suite must be measured against iteration 12's
confirmed-onset segmentation before attributing its remaining meaning failure
to a boundary or changing the model. The first invocation retains all ten
original inputs/golden hashes and every quality, exact-three meaning, endpoint,
coverage, detector, queue, loss and offline VAD assertion. It still fails the
Japanese louder-noise meaning gate; no production fix is claimed.

The smaller additional B2 check extends that same harness with **actual offline
ASR**, where previously it checked only cached model readiness and VAD control/
cancellation. Original fixtures are hash-checked and decoded before disconnecting;
a fresh owned ASR/VAD worker pair is then prepared offline. Both repositories must
report cached/loading/ready without downloading. Each original Japanese/English
PCM period is copied and transferred to the production ASR host/worker with no
reference text in the job. New assertions require exact sample/range/session/
epoch/language/utterance/final revision identity, detached transferred buffers,
**<=20% CER/WER**, every original meaning **exactly once**, and **<2,000 ms** host
recognition. Zero HTTPS requests is required across offline preparation, VAD and
both actual ASR jobs. Online fresh-worker rounds additionally require cached
states and no downloading after the first round.

Offline clips are decoded synthetic PCM, not live selected-video acquisition,
streaming learned segmentation, media fetch availability, Korean translation or
caption DOM. Direct-job host duration includes transfer/recognition/return and
excludes decoding/preparation/accumulation; it differs from paced endpoint-to-text.
VAD and ASR worker durations use their own clocks, without subtracting timestamps from different
contexts. The existing <2,000 ms noisy endpoint gate remains unchanged.

Only the noise test and evidence documents change. No production segmentation,
model/backend/dependency/default/fixture/hash/sentence/quality gate, companion,
installation/native messaging/server/user settings or later-stage changes.

### First unchanged-suite result

FAIL: `caffeinate -disu npm run test:framework:chrome:noise:learned`, **exit 1**,
once before harness extension, `chrome-20261008-13-noise.log` in ignored local
`.ralph/media-framework/`: typecheck, **22 port tests / 0 failed/skipped/cancelled /
254.824791 ms**, build, **ten completed real cases / 4,066 WASM VAD calls /
12 FP16 WebGPU ASR jobs**. The sole failure is
`ja/speech-white-noise: every preserved meaning must occur exactly three times`.
All six noise-only controls have zero active frames, ASR calls and text; both
languages' low-noise speech and louder-noise English pass all retained gates.
Every case drains with zero reported loss; maximum pending **9,700 ms**.

| Speech case | Error | Meaning counts | Endpoint-to-text ms | Exact ASR ranges ms |
| --- | --- | --- | --- | --- |
| ja / quiet noise | 3/120 = 2.5% CER | All 3 | 1668.600 / 1498.400 / 888.600 | 0–8096 / 8096–15872 / 15872–23940 |
| ja / louder noise | 9/120 = 7.5% CER | 会議 2; 駅 1; other five 3 — FAIL | 1509.300 / 1446.600 / 880.400 | 0–8128 / 8128–15872 / 15872–23940 |
| en / quiet noise | 3/66 = 4.545455% WER | All 3 | 1323.300 / 1221.000 / 714.400 | 0–7744 / 7744–15264 / 15264–23040 |
| en / louder noise | 4/66 = 6.060606% WER | All 3 | 1268.500 / 1309.000 / 711.500 | 0–7712 / 7712–15200 / 15200–23040 |

Japanese louder-noise recognition substitutes meeting/station words in its first
two jobs. Complete contiguous PCM and <=20% CER do not override the meaning
failure. No causal attribution to segmentation or general natural-noise claim.
The existing offline control reports probability **0.012012064**, cancellation
`VAD stopped`, retained **2,048-byte** caller PCM and **zero HTTPS requests**;
that first invocation has no actual offline speech-recognition job.

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**; locked Transformers.js **4.3.0**
and ORT unchanged. Same small FP16 WebGPU
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`
(**seven files / 487,960,440 bytes**) and Silero WASM
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**). First preparation **55,427.402083 ms**;
cached workers **1,219.166667–1,521.696875 ms**. One fresh inventory each in this
invocation, then reuse; **16 pinned paths**, page errors/visibility events `[]`.
First browser-tree baseline **1,292,272 KiB**, case peak **3,761,216 KiB**.
RSS samples every 250 ms sum only the owned tree and include preparation,
renderers/GPU, shared-page double counting, allocators/models/harness PCM. These
are not isolated allocations, leak freedom, storage/memory pressure or mobile
performance. Per-case final RSS is **1,598,192–3,001,648 KiB**.


### Expanded suite and actual offline results

FAIL: second/final `caffeinate -disu npm run test:framework:chrome:noise:learned`,
**exit 1**, `chrome-20261008-13-noise-offline.log`: typecheck, **22 port tests /
0 failed/skipped/cancelled / 266.483250 ms**, build, ten original cases and both
new offline jobs complete. **4,066 recorded noise-suite VAD frames / 12 online
ASR jobs + two actual offline ASR jobs**; the offline VAD control/cancel check is
additional. The same Japanese louder-noise exact-three meaning gate is the sole
failure. All new cached-worker/offline-recognition gates pass. No third retry.

PASS: explicit Python assertions over both recorded results, **exit 0**, tool
output, confirm all **ten input hashes**, every detector probability/sample
position, all four recognition scores and meaning counts match the first run.
This analyzes evidence only; it is not another inference invocation or a claim
that clocks/memory match. Golden hashes are also asserted by both invocations.

| Speech case | Endpoint-to-text ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | ---: | --- |
| ja / quiet noise | 1649.100 / 1483.500 / 871.400 | 9700 | 2338720 / 3885920 / 2950976 |
| ja / louder noise — meaning FAIL | 1647.100 / 1469.000 / 853.900 | 9800 | 1960864 / 3788096 / 1735280 |
| en / quiet noise | 1300.300 / 1242.200 / 710.600 | 9000 | 1830288 / 3737376 / 1730976 |
| en / louder noise | 1267.900 / 1289.400 / 687.800 | 9000 | 1701424 / 3654032 / 1696672 |

Every original ASR range is unchanged from the first-run table. Both languages'
noise-only controls again have zero active frames/calls/text. All ten runs have
zero reported loss/final pending, exact admitted PCM and complete detector
coverage. Original VAD totals **124.000–456.000 ms**, all below 10% input duration.
New cached-worker assertions pass for every online round after the first.

| Actual offline ASR | Original samples / range ms | Error | Every meaning | Worker inference / host recognition ms | Transferred buffer bytes |
| --- | --- | --- | ---: | --- | ---: |
| Japanese | 111556 / 0–6972.25 | 1/40 = 2.5% CER | 1 | 880.400 / 882.100 | 0 |
| English | 106664 / 0–6666.5 | 1/22 = 4.545455% WER | 1 | 732.700 / 734.000 | 0 |

Decoded PCM SHA-256: Japanese
`015684bdb023e8a53ea991d73b4e2ff56266c94a9876a8239a2940521b213d8c`, English
`f19362f78f79ac81c6c0b2189753ce6c17b640f340184443ed2b08270c0b93a8`.
Both offline repositories emit **cached/cached/loading/ready**, no downloading.
Actual ASR results preserve epoch **5**, session `fixture-offline-asr`, target/
language/utterance identities and final source revision **1**. Reference text is
used only afterward for scoring. Numeric spelling remains an error in both
scores. The offline VAD zero control probability is **0.012012064**, inference
**8.700 ms**, caller buffer **2,048 bytes**; pending cancellation returns
`VAD stopped`. **Zero HTTPS requests** across this complete offline phase.
Offline preparation latency, memory pressure and offline learned speech streaming
are not measured by these two direct recognition jobs.

Same owned browser/OS/dependencies/pinned candidates as above, one fresh ASR/VAD
inventory each in this second invocation, then reuse. Two invocations total
**two inventories of each candidate**, no new model. Second initial preparation
**52,951.998459 ms**, cached online preparations **1,218.148000–1,321.839041 ms**,
**16 pinned paths**, page errors/native visibility events `[]`.
Second browser-tree baseline **1,311,264 KiB**, case peak **3,885,920 KiB**;
case final RSS **1,696,672–3,396,000 KiB**, with the same sampling/shared-page/
allocator/model/harness limitations above. Offline isolated allocations are
unverified. A metadata grep printed a large aggregate JSON record, **exit 0**;
scalar extraction above is the useful evidence. This reporting output is not a
third model invocation or acceptance failure. A subsequent comment/scope-label
edit describes offline coverage; executed assertions are unchanged.

### Remaining acceptance and preservation

FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
`chrome-20261008-13-stage-acceptance.log`: `Missing script: "test:framework:chrome"`.
B5's full selected-video PCM → ASR → Korean translation → DOM harness is still
unimplemented; no placeholder/substitute/retry or acceptance weakening.
PASS: `node --check tests/framework-chrome-noise.mjs`, targeted Biome **one file /
19 ms / no findings**, preliminary `git diff --check`, **exit 0**.

**Next unfinished item remains B2:** improve the louder-noise Japanese meeting/
station recognition without deleting cases or weakening meaning gates; qualify
no-pause/quiet phoneme boundaries, natural speakers/noise, sustained learned live
queue/GPU recovery, memory/storage, conversion/distribution licensing and a
passing default comparison. Two short cached offline ASR jobs now pass; complete
offline learned streaming/interpretation remains unverified. Original energy
noise/full-candidate/stream/sustained/VAD/B1/EOF/quiet/live commands are **not
rerun**; prior passing/failing evidence remains historical. Korean translation/
revisions/DOM, ten-minute live Korean captions, B3–B6, installation and Safari/
iPhone remain **unverified**. B2–B6 stay unchecked; no stage/framework/iPhone
completion claim.

No required environment/device/permission is absent. This is failed quality
qualification/incomplete implementation; neither terminal marker applies. The
second independent Japanese quality failure is retained and no further unchanged
retry is made. Root/nested AGENTS.md and requested independent runner evidence
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent; supplied instructions,
plan, architecture and prior stage report were read.

Only this worktree changes. Companion v0.1.0/install/native messaging/server/
settings and unrelated files/apps/recordings/mounted images are preserved. No
agents, runner edit, stage advance, push/publish/app installation or blocked
browser/profile/permission bypass. Only owned test browsers/profiles are cleaned
up. Credentials, model weights, user audio/transcripts and ignored temporary
`.ralph` state are excluded from commits. Final required verification and commit
checks follow.


### Final required verification and commit checks

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-13-verify.log`: Biome **115 files / 51 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**113 JS passed / 0 failed/skipped/cancelled / 21,577.451375 ms**,
**222 Python passed / 66.91 s**, Python **3.12.15**. Runs after both real-browser
invocations; subsequent changes only finish Markdown evidence. Repository
verification does not override the retained Japanese meaning failure or missing
full Chrome acceptance. B2–B6 remain unchecked. Final document-inclusive unstaged/
staged whitespace, exact three-file commit scope and post-commit worktree
cleanliness are checked before delivery. Only noise harness, report and plan
are committed; credentials/weights/user data/temporary state are excluded.


## 2026-10-08 — B2 sustained learned speech qualification (iteration 14/20)

Related commit: `test: qualify sustained learned browser ASR`, containing this
report. **B2 remains unchecked; no ASR default is selected.** Only B2 advances.

### Scope and observable acceptance

Assumption: longer paced learned-VAD processing needs its own evidence; earlier
sustained energy-detector runs do not qualify the learned path. Extend the existing
EOF harness rather than introduce another engine or speculative decoding change.
Installed Transformers.js 4.3.0 `src/models/modeling_utils.js` still marks beam
search as TODO and breaks after the first sampled token; no beam-search fix or
model-quality improvement is claimed here.

Added `npm run test:framework:chrome:sustained:learned`. It retains all ten
three-period EOF cases and their original gains, tail sizes and assertions, then
adds five periods and at least two minutes per language. The same hash-checked
synthetic videos are decoded to the same 16 kHz periods and repeated without new
interperiod gaps. Each new case uses gain 1, the existing 512-sample zero prefix
and 511-sample zero tail. Every ASR job must equal its corresponding supplied
PCM slice. No reference text enters inference. Production recognizer, model,
backend, dependencies, segmentation, queue limits, settings and fixtures are
unchanged. Existing EOF/quiet commands retain their original case sets.

New long-run assertions require more than the entire 30-second queue budget of
paced input, segment count consistent with the 20-second maximum, delivery during
all but at most one ASR job, actual queue observations in every minute, and RSS
samples at the start and both minute boundaries for the two-minute cases. They
retain **<=20% CER/WER**, every meaning **exactly the supplied period count**,
**<2,000 ms per endpoint**, <=30-second pending audio, zero reported loss, drained
queues, complete detector coverage, exact contiguous admitted ASR samples,
<=100 ms leading / <20 ms trailing context, every original tail sample reaching
ASR, cached fresh-worker and pinned-download/visibility/page-error assertions.

This is real WASM VAD and FP16 WebGPU ASR over **paced decoded synthetic PCM**.
It does not establish sustained live acquisition, natural speakers/noise,
GPU-loss recovery, Korean translation/DOM or ten-minute interpretation. Endpoint
latency uses delivery/result observations in one document clock and excludes
preparation/accumulation/translation/display. VAD inference spans use the worker
clock; RSS minute spans use the Node clock. No cross-context timestamp subtraction.

### Exact executed evidence

PASS: `caffeinate -disu npm run test:framework:chrome:sustained:learned`, **exit 0**,
once, `chrome-20261008-14-sustained-learned.log` in ignored local
`.ralph/media-framework/`: typecheck, **22 port tests / 0 failed/skipped/cancelled /
257.540292 ms**, build, **14 actual cases / 16,440 WASM VAD frames / 46 WebGPU
ASR jobs**, all retained and new gates pass. Ten retained EOF cases score Japanese
**3/120 = 2.5% CER**, English **3/66 = 4.545455% WER**, every meaning exactly
three; endpoints **904.500–1,470.500 ms** and maximum pending **13,168 ms**.

| New case | Samples / input duration ms | Error | Every meaning | Jobs / overlapping jobs | Endpoint latency ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | --- | ---: | --- | --- | ---: | --- |
| Japanese / 5 periods | 558803 / 34925.1875 | 5/200 = 2.5% CER | 5 | 3 / 2 | 1306.700–1472.100 | 13261.1875 | 1652608 / 3808640 / 1646304 |
| Japanese / 18 periods | 2009031 / 125564.4375 | 18/720 = 2.5% CER | 18 | 10 / 9 | 837.000–1643.800 | 15636 | 1650160 / 3785344 / 1438784 |
| English / 5 periods | 534343 / 33396.4375 | 5/110 = 4.545455% WER | 5 | 3 / 2 | 1071.500–1427.000 | 12568 | 1656384 / 3632368 / 1676896 |
| English / 19 periods | 2027639 / 126727.4375 | 19/418 = 4.545455% WER | 19 | 10 / 9 | 915.100–1695.300 | 18092 | 1677056 / 3617952 / 1668848 |

All 14 cases have **32 ms leading / zero trailing**, no original tail omission,
zero reported loss and final pending zero. Every new nonfinal ASR job overlaps
actual paced delivery. Long host durations are **126,401.500 ms** Japanese and
**127,644.000 ms** English, at least their real-time input durations. Long VAD
inference totals **2,134.500 / 2,147.700 ms**, below the unchanged 10% gate.
Five-period totals are **644.200 / 628.300 ms**.

Japanese 18-period ASR boundaries ms:
`32, 11776, 21664, 35616, 49536, 63520, 77440, 91392, 105344, 119296, 125564.4375`.
English 19-period boundaries ms:
`32, 11200, 21408, 37856, 51200, 61408, 77856, 91200, 101408, 117856, 126727.4375`.
All job ranges are contiguous and <=20 seconds. Japanese original period remains
**111,556 samples**, SHA-256
`015684bdb023e8a53ea991d73b4e2ff56266c94a9876a8239a2940521b213d8c`;
English **106,664 samples**, SHA-256
`f19362f78f79ac81c6c0b2189753ce6c17b640f340184443ed2b08270c0b93a8`.

New input SHA-256, ordered as the table:
`a2fd039980f0392c4d95f06f009458042d3b369e70f236c034a88442efc43293`,
`39691b3fc4d04ec6364240d06ad448fa9be6e355cbb8f453995713dce615d9c6`,
`7ce74119ff6e39ac32e1fe812469f0de5ceecac8b3ad3aea8354ef178260960e`,
`2f258189da7bcbf46afc7ca6112a2086c87b64877415d5b93c1c897df4a78405`.

Long minute queue peak/end pending ms: Japanese
**15636/10364, 15580/14556, 15556/0**; English
**18092/8700, 18092/2044, 8871.4375/0**. The third window contains the final
5.6/6.7 seconds and drain, not another full minute. Every window reports zero
loss. RSS start/60/120-second samples KiB: Japanese
**2840416 / 2293536 / 1491024**, English **3609360 / 2212848 / 2184064**.
These diagnostic samples do not establish memory-pressure handling or leak freedom.

PASS: explicit Python assertions over the recorded results, **exit 0**, tool
output: all 14 accuracy/meaning/latency/coverage/queue checks pass; every long
nonfinal job overlaps delivery. **All ten retained input hashes, decoded period
hashes, recognition scores/meaning counts and every detector probability/activity/
sample position match iteration 12's EOF run.** This is evidence analysis, not
another inference invocation or a claim that clocks/RSS match.

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**; locked Transformers.js **4.3.0** /
ORT unchanged. Same pinned small FP16 WebGPU
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`
(**seven files / 487,960,440 bytes**) and Silero WASM
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**). One fresh inventory each, then cached fresh
workers; initial preparation **52,330.776833 ms**, cached
**1,218.948458–1,437.474166 ms**, **16 pinned paths**, page errors/native
visibility events `[]`. Owned-tree RSS baseline **1,300,592 KiB**, case peak
**3,872,176 KiB**. Every 250 ms the harness sums only its owned browser tree,
including shared pages, renderers/GPU, preparation, allocators/models and harness
PCM. Case baselines precede preparation; minute samples follow it. Not isolated
model allocations, storage/memory pressure, leak freedom or mobile performance.

### Required acceptance, remaining work and preservation

FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
`chrome-20261008-14-stage-acceptance.log`: `Missing script: "test:framework:chrome"`.
B5's full selected-video PCM → ASR → Korean translation → DOM harness remains
unimplemented. No substitute, placeholder, unchanged retry or weakened acceptance.
PASS: preliminary `node --check tests/framework-chrome-eof.mjs`, targeted Biome
**one file / 6 ms / no findings** and `git diff --check`, **exit 0**.

**Next unfinished item remains B2:** improve the retained louder-noise Japanese
meeting/station meaning failure; qualify no-pause/quiet phoneme boundaries,
natural speakers/noise, sustained learned live acquisition/queue/GPU recovery,
memory/storage pressure, conversion/distribution licensing and a passing default
comparison. The noise suite is **not rerun** and iteration 13's two independent
meaning failures remain failures. Other candidate/stream/live/quiet/VAD/B1 commands
are not rerun; their evidence remains historical. Full offline learned streaming/
interpretation, Korean translation/revisions/DOM, ten-minute live captions,
B3–B6, installation and Safari/iPhone remain **unverified**. B2–B6 stay unchecked.
No stage/framework/iPhone completion claim. No required environment/device/
permission is absent; incomplete qualification/implementation warrants neither
terminal marker.

Supplied instructions/plan/architecture/prior report were read; root/nested
AGENTS.md and requested independent runner evidence
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent. Only this worktree
changes. Companion v0.1.0/install/native messaging/server/settings and unrelated
files/apps/recordings/mounted images are preserved. No agents, runner changes,
stage advance, push/publish/app installation or browser/profile/permission bypass.
Only owned test browsers/profiles are cleaned up. Credentials, model weights,
user audio/transcripts and ignored temporary `.ralph` state are excluded from
commits. Final repository verification and commit checks follow.


### Final required verification

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-14-verify.log`: Biome **115 files / 61 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**113 JS passed / 0 failed/skipped/cancelled / 21,016.428500 ms**,
**222 Python passed / 66.87 s**, Python **3.12.15**. Executed after the real
browser/model suite; later changes finish Markdown evidence only. Repository
verification does not override missing full Chrome acceptance or the historical
Japanese noise failure. B2–B6 remain unchecked. Final document-inclusive unstaged/
staged whitespace, exact four-file scope and post-commit cleanliness are checked
before delivery; only harness, package command, report and plan enter the commit.


## 2026-10-08 — B2 sustained learned live acquisition (iteration 15/20)

Related commit: `test: expose sustained learned live ASR failures`, containing this
report. **B2 remains unchecked; no ASR default is selected.** Only B2 advances.

### Scope and observable acceptance

Assumption: iteration 14's paced decoded-input results do not establish sustained
selected-element acquisition. Extend the existing learned live harness rather
than add another engine. Added `test:framework:chrome:live:sustained:learned`,
retaining all six original rounds and adding at least two minutes per language:
**18 Japanese / 19 English complete periods**. Existing commands retain their
case sets. No production engine/profile/model/dependency/default/settings changes.

The original hash-checked 24-second videos are too short for these new cases.
The owned test document decodes one original period at 48 kHz, including its
isolation carrier, and repeats it into an owned VP8/Opus MediaRecorder fixture.
Both recordings run concurrently and are written only to ignored local test
build output. These are **new re-encoded synthetic videos**, not byte-identical
copies of the original media or captured PCM. Source-period and generated-file
hashes/bytes are recorded. No microphone, user recording, installed voice, new
model, transcript prompt or source text supplies inference. The reference text
scores results afterward. The longer media plays through the actual production
catalog/input → 48-to-16 kHz normalizer → WASM VAD → FP16 WebGPU ASR path.

All original error/meaning/isolation/mapping/playback/Stop/restart/cache/identity/
exact-ASR-slice/coverage/queue gates remain: **<=20% CER/WER**, each meaning exactly
the period count, **<=100 ms leading / <20 ms trailing**, **<=20 s jobs / <=30 s
pending / zero reported loss / drained queues**, complete detector coverage and
**<10% input duration in VAD inference**. New sustained checks require >=120 s
of actually captured normalized PCM and document runtime, capture overlap in all
but at most one ASR job, queue observations in every minute, start/60/120-second
RSS samples, and **<2,000 ms at every actual normalized endpoint delivery**.
Original live final-packet latency and both-video playback preservation still
apply. Document clocks measure capture/recognition; Node clocks measure RSS;
worker clocks measure VAD inference. No cross-context origin subtraction.

This is sustained synthetic ASR, not natural speakers/noise, pressure/GPU-loss
recovery, offline streaming, Korean translation/DOM or ten-minute interpretation.

### First invocation and fixture correction

FAIL: `caffeinate -disu npm run test:framework:chrome:live:sustained:learned`,
**exit 1**, `chrome-20261008-15-sustained-live-first.log` in ignored local
`.ralph/media-framework/`: typecheck, **27 focused port tests / 0 failed/skipped/
cancelled / 259.018709 ms**, build, six original rounds and sustained Japanese
pass. Japanese captured **6,027,264 raw / 2,009,088 normalized samples**,
**18/720 = 2.5% CER**, every meaning 18, ten jobs, endpoint latency
**809.300–1,676.600 ms**, max pending **15,604.6875 ms**, zero loss/drained queue.
English also returns ten actual jobs over **2,027,520 normalized samples**, then
fails the unchanged playback-state assertion **before its quality/coverage/
latency scoring**. Do not count those unreached assertions as passes.

The failure snapshot shows both test videos naturally ended and paused at
**127.633601 / 127.600929 s**, with readyState 4, no seeking/media error. English's
last-packet-to-returned-text observation is **1,081.400 ms**. Its generated media
lasts only the longest requested speech window plus **1,000 ms**; that is too
short to keep playback open through recognition and the capture-detach check.
This is a new fixture-duration defect, not a lost user permission/device or an
adapter playback regression. Extend only the uncollected recording suffix from
**1,000 to 5,000 ms**, keeping both acquisition stop positions, every period,
original case, quality gate and playback equality assertion. A corrected second
invocation follows; no unchanged retry or assertion relaxation.

PASS: first `node --check tests/framework-chrome-live-learned.mjs`, targeted
Biome **two files / 25 ms / no findings** and preliminary `git diff --check`,
**exit 0**. Earlier targeted Biome exits 0 with three template-style infos; those
are corrected before the first browser invocation. Required full Chrome
acceptance is FAIL, **exit 1**, once, `chrome-20261008-15-stage-acceptance.log`:
`Missing script: "test:framework:chrome"`. B5's full selected-video PCM → ASR →
Korean translation → DOM harness is still unimplemented. No B2 substitute or
placeholder is added. Corrected real-browser and final repository evidence follow.


### Corrected invocation: retained qualification failures

FAIL: second/final `caffeinate -disu npm run test:framework:chrome:live:sustained:learned`,
**exit 1**, `chrome-20261008-15-sustained-live-final.log`: typecheck,
**27 focused tests / 0 failed/skipped/cancelled / 271.912458 ms**, build,
**eight actual rounds / 9,844 WASM VAD frames / 32 FP16 WebGPU ASR jobs**.
All original rounds and sustained English pass. Both sustained runs complete
all their assertions; the only final failures are Japanese's exact-18 meaning
count and per-endpoint latency. No third browser invocation.

| Sustained live input | Actual raw 48 kHz / normalized samples | Captured / document runtime ms | Error | Meaning counts | Jobs / overlapping jobs | Endpoint-to-text ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| Japanese / 18 periods — FAIL | 6027264 / 2009088 | 125568 / 127025.500 | 34/720 = 4.722222% CER | 駅 19; other six 18 | 15 / 14 | 764.700–2099.400 — FAIL | 18271.375 | 2576096 / 2580464 / 1646640 |
| English / 19 periods — PASS | 6082560 / 2027520 | 126720 / 127796.500 | 19/418 = 4.545455% WER | All 19 | 10 / 9 | 1078.100–1494.800 | 14826 | 2752752 / 2753600 / 1656096 |

Every long nonfinal job overlaps actual selected-video acquisition. All scored
runs have exact admitted normalized PCM slices, complete contiguous ASR ranges,
complete detector coverage, <=20-second jobs, zero reported loss and final pending
zero. Long leading context is **32 ms**, trailing context **zero**. Selected tag
amplitudes **0.059997429 / 0.059926197**, unselected **0.000343946 / 0.000606309**,
map error **59.063667 / 48.230333 ms**. VAD totals **2426.500 / 2502.500 ms**
are below the unchanged 10% duration gate. Both videos preserve source, volume,
mute, rate and advancing playback after completion; capture detach checks pass.

Japanese's failed endpoint is **63,648–79,808 ms**, **16,160 ms** of actual input,
not a forced 20-second job. Its host call is **1,843.300 ms**, but endpoint-to-text
is **2,099.400 ms**. The preserved final-packet metric **1,464.900 ms** cannot
replace that failing endpoint gate. Its extra station occurrence also fails
meaning despite <=20% CER and zero queue loss. First-run Japanese passed with
ten jobs; corrected-run Japanese has fifteen. Source-period hashes/sample/repeat
counts match between invocations, but new MediaRecorder output and live captures
are not byte-identical; no causal attribution to suffix, segmentation, codec or
natural noise is established. The failures remain failures.

Japanese boundaries ms:
`32, 14720, 25760, 35648, 46688, 56576, 63648, 79808, 84672, 86784, 91648, 98304, 105376, 106848, 112448, 125568`.
English boundaries ms:
`32, 11168, 21408, 34720, 48064, 61408, 74720, 88064, 101408, 114720, 126720`.

Minute queue peak/end pending ms: Japanese **16436.6875/3412.6875,
18271.375/7530, 13120/0**; English **14815.375/11924.6875, 14826/5258, 12000/0**.
Every window reports zero loss. Window three covers only final partial-minute
input/drain. Start/60/120-second RSS KiB: Japanese
**2580464 / 2221984 / 2243584**, English **2753600 / 2566000 / 2477216**;
boundary samples occur within **242.614 ms** of their nominal Node-clock minute.
RSS samples every 250 ms sum only the owned browser tree, including shared-page
double counting, renderers/GPU, allocator/model residency and harness PCM/media.
Case baselines/peaks start after preparation. These diagnostics do not establish
isolated model memory, preparation peak, leak freedom, pressure/storage handling
or mobile performance. Latencies exclude preparation, speech accumulation,
translation and display; these are observations, not population percentiles.

Five original scored rounds retain Japanese **1/40, 1/40, 3/120 CER**, English
**1/22, 3/66 WER**, every meaning once/three times, last-packet-to-text
**826.200–1068.700 ms**, zero loss/drained queues. Stop observes real detector
processing, reports `cancelled`, **863.375 ms** intentionally discarded, zero
pending/no transcript and detached capture; restart passes. Native visibility
and page errors are `[]`. Pinned model paths/requests **16 / 16**.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**. Locked Transformers.js **4.3.0**
and ORT unchanged. Same small FP16 WebGPU
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`
(**seven files / 487,960,440 bytes**) and Silero WASM
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**). One fresh inventory each per invocation,
then cached fresh workers; two invocations total, no new model. Final initial
preparation **53,753.264792 ms**, cached **1,223.167041–1,627.839250 ms**;
these are model loading, not transcription latency. Final initial owned-tree
RSS **1,440,608 KiB**, case peak **3,900,432 KiB**, with the limitations above.

Final generated media: Japanese **2,191,142 bytes**, SHA-256
`bb602501cd05377f81338d050e529fdaa0f30f3326c6d61ef81670579e7a7486`;
English **2,193,135 bytes**, SHA-256
`5a9f74ce421d8a57684a3dd63db7b8f32897fe02798a02d92e626e850e41d03f`.
Source-period 48 kHz samples/hash: Japanese **334667** /
`62849952bbacc0aef37547d98da09920ed70a8afa5f3f7ebf9004f1a5ccd3886`,
English **319991** /
`0d6a8683900044ef06ced7717b879e05d4eeb772e611fce41cc389447ea6b856`.
Both final recording durations requested **131663.104167 ms**. Files stay ignored;
recording timestamps/codec output are not asserted reproducible across runs.

PASS: explicit Python assertions over recorded results, **exit 0**, tool output:
all eight playback/cache/accounting checks, all scored input/coverage/error-rate/
queue checks, every long nonfinal capture overlap, exactly the two Japanese
qualification failures, and final generated-file hashes/bytes. Separate assertions
confirm both source-period hashes/sample/repeat counts match between invocations
and requested recording suffix alone increases by **4,000 ms**. This is evidence
analysis, not another inference run or a passing browser acceptance outcome.
PASS: final harness syntax, targeted Biome **two files / 32 ms / no findings**
and preliminary document-inclusive whitespace, **exit 0**.

### Next unfinished item and preservation

**B2 remains next:** resolve the new sustained Japanese repetition/endpoint
failures while retaining these cases/gates, along with the historical louder-noise
Japanese meeting/station failure; qualify no-pause/quiet phoneme boundaries,
natural speakers/noise, sustained learned live GPU/pressure recovery, ten-minute
live processing, memory/storage and conversion/distribution licensing before
choosing a default. Original noise/full-candidate/stream/EOF/quiet/paced-sustained/
VAD/B1 commands are not rerun; prior evidence stays historical. Offline learned
streaming/full interpretation, Korean translation/revisions/DOM, B3–B6,
installation and Safari/iPhone remain **unverified**. B2–B6 stay unchecked.
No stage/framework/iPhone completion claim. No required environment/device/
permission is absent; failed qualification/incomplete implementation warrants
neither terminal marker.

Supplied instructions/plan/architecture/prior report read; root/nested AGENTS.md
and requested independent runner evidence are absent. Work stays in this worktree;
companion v0.1.0/install/native messaging/server/settings and unrelated files/apps/
recordings/mounted images are preserved. No agents, runner edit, stage advance,
push/publish/app installation or blocked browser/profile/permission bypass. Only
owned test browser/profile/recorder resources are cleaned up. Credentials, weights,
user audio/transcripts and ignored temporary state stay out of the commit.
Required repository verification and commit checks follow after execution.


### Final required verification and Git checks

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-15-verify.log`: Biome **115 files / 57 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**113 JS passed / 0 failed/skipped/cancelled / 21,180.684167 ms**,
**222 Python passed / 66.91 s**, Python **3.12.15**. It runs after both real
browser invocations; later changes finish only Markdown evidence. This repository
pass does not override the Japanese sustained meaning/endpoint failures or missing
full Chrome acceptance. B2–B6 remain unchecked.

Document-inclusive unstaged/staged whitespace, the exact five-file commit scope
and post-commit worktree cleanliness are checked before delivery. Only package
command, learned live harness, shared test fixture, report and plan enter the
commit; ignored temporary evidence/media/models/profiles and user data are excluded.


## 2026-10-08 — B2 learned live GPU recovery (iteration 16/20)

Related commit: `test: qualify learned live GPU recovery`, containing this report.
**B2 remains unchecked; no default is selected.** Only B2 advances.

Assumption: the historical decoded-input GPU recovery check does not qualify
learned selected-video acquisition. Extend the existing live harness with
`test:framework:chrome:live:gpu-recovery`, retaining all six original rounds and
adding Japanese/English loss and recovery rounds. No engine, model, dependency,
profile, companion, installed build or settings change. Original/sustained
commands retain their cases and gates.

Test instrumentation wraps the owned ASR worker's real GPUAdapter.requestDevice
without replacing its device. After entering the production recognize handler,
it calls the actual GPUDevice.destroy(). Production device-loss notification,
host rejection, recognizer queue cleanup and capture detachment must follow.
This is an explicitly injected device failure, not naturally occurring GPU or
memory pressure. The labels never supply inference input; actual selected-element
PCM feeds the production normalizer, WASM VAD and FP16 WebGPU ASR.

Loss must interrupt a nonfinal job before the three-period capture endpoint,
return `gpu-lost`, publish no transcript, report positive discarded duration and
zero final pending audio, and detach capture while both videos keep playing.
A retry without Prepare must preserve its caller buffer and fail `gpu-lost`,
creating zero replacement workers. Explicit activated Prepare must reuse the
same ASR/VAD hosts, create exactly two fresh workers, load both pinned cached
models without remote requests and recognize three periods in a fresh epoch.
Every recovered result must have the new identity. Original <=20% CER/WER,
exact meaning counts, exact admitted PCM, detector coverage/cost, source isolation,
time mapping, <=20 s jobs/<=30 s pending, zero normal-run loss, drained queues,
<2,000 ms final-packet latency and playback/Stop checks remain unchanged.
Test failure timestamps now record the actual failure instead of retaining the
previous successful run's completion timestamp.

### Executed evidence

Ignored evidence directory: `.ralph/media-framework/`. Root/nested AGENTS.md and
requested independent runner file `2026-10-08T01-12-31-094Z-chrome-verification.txt`
are absent. Supplied instructions, plan, architecture and prior report reviewed.

Diagnostic first invocation: `caffeinate -disu npm run test:framework:chrome:live:gpu-recovery`,
**exit 0**, `chrome-20261008-16-live-gpu-first.log`: typecheck, **27 focused port
checks / 0 failed/skipped/cancelled / 253.235375 ms**, build and ten browser rounds.
All original rounds, real device-loss reporting and same-host cached recovery
checks pass. However, the first loss cases contain only one period: Japanese
capture/job endpoint **7,040 ms**, English **6,741.3125 ms**, exactly capture EOF.
This is **not accepted as loss during active acquisition**. No production defect
is inferred. Before the second invocation, increase only these loss captures to
three periods and assert both the captured duration and failed job endpoint are
below the requested endpoint. No original case or gate is removed or relaxed.

FAIL: required `npm run test:framework:chrome`, **exit 1**, once,
`chrome-20261008-16-stage-acceptance.log`: `Missing script: "test:framework:chrome"`.
B5's real video → ASR → Korean translation → DOM acceptance is unimplemented;
this B2 command is not a substitute. No unchanged retry or placeholder.
PASS: harness syntax and targeted two-file Biome, **exit 0**, initially **7 ms**,
then **33 ms / no findings** after strengthening the loss gates.


Corrected final invocation: `caffeinate -disu npm run test:framework:chrome:live:gpu-recovery`,
**PASS, exit 0**, once, `chrome-20261008-16-live-gpu-final.log`: typecheck,
**27 focused tests / 0 failed/skipped/cancelled / 265.590417 ms**, build,
**ten actual browser rounds / 4,074 WASM VAD frames / 13 WebGPU ASR invocations**
(two intentionally fail on actual device loss). All retained and new assertions
pass; failures/page errors/native visibility events `[]`. No third invocation.

| Loss input | Actual raw / normalized samples | Captured ms / failed job range ms | Retained audio explicitly discarded ms | Pending after failure | Host invocation to rejection ms |
| --- | --- | --- | ---: | ---: | ---: |
| Japanese | 727040 / 242336 | 15146 / 64–14720 | 15039.375 | 0 | 111.200 |
| English | 557056 / 185675 | 11604.6875 / 32–11168 | 11530 | 0 | 117.500 |

Both captures fail before the requested three-period endpoints (**20,916.6875 /
19,999.4375 ms**). Delivered PCM advances during the interrupted host calls:
Japanese **15,018 → 15,103.375 ms**, English **11,476.6875 → 11,562 ms**.
These are host rejection observations, not transcription latencies. Final capture
totals include a closing read after invalidation; reported discarded duration
counts retained recognizer audio, not every observed shutdown packet. Both loss
cases return no transcript, detach capture, keep source/volume/mute/rate and
advancing playback, reject an unprepared retry with the **6,400-byte caller
buffer intact**, and create **zero automatic replacement workers**.

| Explicit cached recovery | Raw / normalized samples | Error and meaning | ASR ranges ms | Last-packet-to-text ms | Peak pending ms | Baseline / peak / final RSS KiB |
| --- | --- | --- | --- | ---: | ---: | --- |
| Japanese / three periods | 1005568 / 335189 | 3/120 = 2.5% CER; all seven anchors 3 | 32–11808; 11808–20949.3125 | 1033.400 | 13364.6875 | 3283456 / 3283456 / 1441152 |
| English / three periods | 962560 / 320853 | 3/66 = 4.545455% WER; all four anchors 3 | 32–11168; 11168–20053.3125 | 850.800 | 12511.375 | 3451744 / 3451744 / 1541584 |

Recovery Prepare takes **1,325.709292 / 1,425.908666 ms**. Both same-host/same-VAD
checks pass; exactly two replacement workers are created only by explicit Prepare.
Each recovery uses the same session/target, **epoch 1**; every returned revision
matches it. Both models report cached/ready, never downloading; **zero remote
requests** during Prepare and recovered capture/inference. No silent fallback.
Exact admitted PCM, complete detector coverage, contiguous bounded jobs,
**32 ms leading / zero trailing**, zero normal-run loss and drained queues pass.
VAD totals **450.900 / 445.100 ms**, below the unchanged 10% gate. Selected tags
**0.060061224 / 0.060018365**, unselected **0.000342770 / 0.000613207**;
map errors **41.981333 / 51.268000 ms**. Playback/capture-detach checks pass.

Original scored cases retain Japanese **1/40, 1/40, 3/120 CER**, English
**1/22, 3/66 WER**, every meaning once/three times, zero loss/drained queues and
last-packet-to-text **822.600–1,046.400 ms**. Original Stop reports cancelled,
no text/zero pending/positive discard, actual detector processing and detached
capture; repeat Start passes. This is short live recovery, **not sustained or
ten-minute recovery**, Korean translation/DOM or naturally occurring pressure.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**; locked
Transformers.js **4.3.0**/ORT unchanged. Same pinned small FP16 WebGPU
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`
(**seven files / 487,960,440 bytes**) and Silero WASM
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**). Each invocation downloads one inventory each
into its own fresh test context, then reuses cached fresh workers; two invocations,
no new model. Final initial preparation **52,836.562833 ms**, cached
**1,319.075125–1,426.429208 ms**, **16 pinned paths / 16 requests** overall.
Final initial owned-tree RSS **1,449,744 KiB**, maximum case peak **3,895,200 KiB**.
250 ms owned-tree samples include shared-page double counting, renderers/GPU,
allocators/models/harness PCM; case peaks start after preparation. Not isolated
model allocations, preparation peak, leak freedom, pressure or mobile evidence.
All latency observations use one document clock; VAD inference and Node RSS
sampling use their own clocks separately. Preparation and final-packet latency
exclude each other's work, accumulation, translation and display. No population
percentile or general accuracy claim.

PASS: explicit Python assertions over final recorded results, **exit 0**, tool
output: ten rounds, no qualification failures, both real-loss cleanup/rejected
retry records and both cached same-session/fresh-epoch recoveries match.
This is evidence analysis, not another inference invocation.

### Remaining work and preservation

**Next unfinished item is B2:** resolve retained Japanese louder-noise meaning
and sustained repetition/endpoint failures; qualify natural/no-pause/quiet
phoneme boundaries, sustained learned live GPU recovery, ten-minute live input,
memory/storage pressure and conversion/distribution licensing before selecting
a default. None of those prior failing suites is rerun or reclassified here.
Other candidate/stream/EOF/quiet/noise/sustained/VAD/B1 commands remain historical.
Full offline streaming/interpretation, Korean translation/revisions/DOM, B3–B6,
installation and Safari/iPhone remain **unverified**. B2–B6 stay unchecked.
No required environment/device/permission is absent; incomplete implementation
and qualification warrant neither terminal marker. No stage/framework/iPhone
completion claim.

Only this worktree changes. Companion v0.1.0/install/native messaging/server/user
settings and unrelated files/apps/recordings/mounted images preserved. No agents,
runner edit, stage advance, push/publish/app installation or blocked-browser/
profile/permission bypass. Only owned test browser/profile resources cleaned up.
Credentials, model weights, user audio/transcripts and ignored temporary state
are excluded from the commit. Required repository verification follows.


### Final required verification and Git checks

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-16-verify.log`: Biome **115 files / 53 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**113 JS passed / 0 failed/skipped/cancelled / 21,566.812833 ms**,
**222 Python passed / 66.95 s**, Python **3.12.15**. Executed after both browser
invocations on the final test sources; later edits complete Markdown evidence only.
PASS: final syntax, targeted two-file Biome **7 ms / no findings**, recorded
same-target/same-session/fresh-epoch quality/cache assertions (both runs), and
actual capture advance during interrupted jobs (corrected run only), **exit 0**.
The first diagnostic remains insufficient active-loss evidence. Required full
Chrome acceptance remains FAIL; prior Japanese qualification failures remain
unresolved, and B2–B6 remain unchecked.

Document-inclusive unstaged/staged whitespace, exact five-file commit scope and
post-commit cleanliness are checked before delivery. Only package command, live
harness, shared test fixture, report and plan enter the commit; no ignored state,
credentials, model weights or user data. No runner change or stage advance.


## 2026-10-08 — B2 sustained live GPU recovery (iteration 17/20)

Related commit: `test: exercise sustained live GPU recovery`, containing this
report. **B2 remains unchecked; no ASR default is selected.** Only B2 advances.

Assumption: iteration 16's short live loss/recovery does not qualify sustained
acquisition or sustained recognition after recovery. The smaller next addition
extends the existing harness with
`test:framework:chrome:live:sustained:gpu-recovery`, rather than introducing an
engine policy without causal evidence for the retained Japanese quality failures.
The new explicit mode retains all six original live rounds and all original
fixtures, labels, model identities and numerical/meaning gates. Original live,
sustained and short GPU commands keep their cases; conflicting modes are rejected.
No production engine, dependency, default, companion or user setting changes.

The owned worker runs its production handler before the actual GPUDevice is
intentionally destroyed on the first ASR job ending at or after 60,000 ms.
Require at least one minute of actual selected-video acquisition and document
runtime, earlier real recognition, and failure before the requested two-minute
capture endpoint. Earlier published revisions are retained; the interrupted job
must publish none, capture must detach, retained audio loss must be explicit,
final pending must be zero, and both videos must continue with their original
source/volume/mute/rate. An unprepared retry must fail `gpu-lost`, preserve its
6,400-byte caller buffer, create no workers and publish no additional revision.

Explicit activated Prepare must reuse the same ASR/VAD hosts, create exactly two
fresh workers, load both cached pinned models without remote requests and process
at least two minutes of fresh selected-video PCM in the same session/target and
new epoch. Require exact admitted normalized PCM, complete detector coverage,
contiguous <=20-second ASR jobs, <=30-second pending audio, zero normal-run loss,
drained queues, <=20% CER/WER, every meaning exactly 18 Japanese / 19 English
times, <2,000 ms at every endpoint and the final packet, all nonfinal jobs
continuing alongside acquisition, source isolation/time mapping, playback and
capture-detach checks. Start/minute RSS and per-minute queue observations are
recorded for loss and recovery. No reference text supplies inference input.

This is injected device loss and synthetic repeated speech, not naturally
occurring GPU/memory pressure, ten-minute input, Korean translation or caption DOM.
Prior Japanese louder-noise meaning and sustained repetition/latency failures
remain historical failures; a new recovered run cannot erase them.

### Initial checks

Supplied instructions, plan, architecture and Chrome evidence reviewed.
Root/nested AGENTS.md and the requested independent runner evidence file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent.
Ignored local evidence remains under `.ralph/media-framework/`.

- PASS: `node --check tests/framework-chrome-live-learned.mjs`, targeted
  `npx biome lint tests/framework-chrome-live-learned.mjs package.json`
  (**two files / 10 ms / no findings**), and preliminary `git diff --check`, exit 0.
- FAIL: exploratory `npx biome check tests/framework-chrome-live-learned.mjs package.json`,
  exit 1, **two files / 13 ms / three errors**: pre-existing file formatting and
  import organization differ from Biome check defaults. Follow-up with formatting
  disabled isolates the unchanged `spawn, execFile` import order, exit 1,
  **8 ms / one error**. No unrelated formatting rewrite. The repository's
  prescribed `biome lint` passes; this exploratory check is not reported passing.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-17-stage-acceptance.log`: missing script
  `test:framework:chrome`. B5's complete real video → ASR → Korean translation →
  DOM acceptance remains unimplemented. No placeholder or substitute command.

Actual browser evidence and final repository/Git checks follow after execution.


### Passing real browser evidence

PASS: `caffeinate -disu npm run test:framework:chrome:live:sustained:gpu-recovery`,
**exit 0**, once, `chrome-20261008-17-sustained-gpu.log`: typecheck,
**27 focused port tests / 0 failed/skipped/cancelled / 260.784250 ms**, build,
**ten actual browser rounds / 13,888 recorded WASM VAD frames / 39 FP16 WebGPU
ASR invocations**, including two intentionally interrupted real device jobs.
Qualification failures/page errors/native visibility events are `[]`.
No second browser invocation. The script was parsed before restoring the
original strict loss-job `>1,600` comparison from the provisional `>=1,600`;
separate recorded-result assertions below explicitly verify the stricter gate
against every actual loss job. No inference/instrumentation change or gate
relaxation remains in the final source.

| Sustained loss | Raw / normalized samples | Capture / document runtime ms | Earlier revisions / all jobs | Interrupted job range ms | Retained loss ms | Pending after failure |
| --- | --- | --- | --- | --- | ---: | ---: |
| Japanese | 3,252,224 / 1,084,064 | 67,754 / 67,743 | 6 / 7 | 58,880–67,328 | 8,831.375 | 0 |
| English | 2,967,552 / 989,174 | 61,823.375 / 61,810.300 | 4 / 5 | 48,064–61,408 | 13,716.6875 | 0 |

Both losses occur after a minute and before the two-minute input endpoints.
Earlier revisions' ranges end before 60,000 ms, match the actual earlier jobs
and preserve their identities; the interrupted jobs emit no revision. They are
not scored against a complete reference because these captures intentionally
abort. During the interrupted host calls, actual delivered audio advances
**67,626 → 67,711.375 / 61,695.375 → 61,780.6875 ms**. Host rejection takes
**113.800 / 111.600 ms**, not transcription latency. Capture totals include a
closing read after invalidation; explicit loss counts retained recognizer audio,
not every observed shutdown packet. Capture-detach and preserved advancing
playback checks pass. Unprepared retries reject `gpu-lost` with **6,400 bytes**
still caller-owned, **zero workers**, no additional revisions and no remote fetch.

| Explicit cached recovery | Raw / normalized samples | Capture / document runtime ms | Error and meaning | Jobs / overlaps | Endpoint-to-text ms | Final-packet-to-text ms | Peak pending ms |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| Japanese / 18 periods | 6,027,264 / 2,009,088 | 125,568 / 126,917 | 18/720 = 2.5% CER; every anchor 18 | 10 / 9 | 1,351.600–1,742.500 | 1,353.100 | 16,436.6875 |
| English / 19 periods | 6,082,560 / 2,027,520 | 126,720 / 127,856.700 | 19/418 = 4.545455% WER; every anchor 19 | 10 / 9 | 1,137.400–1,562.300 | 1,139.700 | 14,922 |

Activated Prepare takes **1,427.981375 / 1,532.394667 ms**. Same ASR/VAD hosts
are retained; exactly two fresh workers are created only after explicit Prepare.
Both recovered runs retain session/target and use **epoch 1**, and every returned
revision matches it. Both models report cached/loading/ready without downloading;
**zero remote requests** throughout each Prepare and sustained capture/inference.
No silent retry, model downgrade or cloud fallback.

Exact admitted unfiltered normalized PCM, full contiguous detector coverage,
<=20-second jobs, <=30-second pending audio, zero normal-run loss and final pending
zero all pass. All nine nonfinal recovered jobs per language overlap continuing
actual acquisition. Leading quiet context is **32 ms**, trailing context **zero**.
VAD totals **2,480.600 / 2,468.700 ms** are below the unchanged 10% duration gate.
Selected tag amplitudes **0.059995427 / 0.059913914**, unselected
**0.000350456 / 0.000604796**; maximum time-map errors
**48.423000 / 53.357667 ms**. Both videos preserve source/volume/mute/rate and
advancing playback; capture detach passes after completion and after loss.

Recovered Japanese boundaries ms:
`32, 14720, 25760, 35648, 49600, 63520, 77472, 88512, 98400, 112352, 125568`.
Recovered English boundaries ms:
`32, 11168, 21376, 34720, 48064, 61376, 74720, 88064, 101376, 114720, 126720`.

Recovered minute queue peak/end pending ms: Japanese
**16436.6875/10388.6875, 15626/7626, 13216/0**; English
**14772.6875/11924.6875, 14922/5258, 12000/0**, zero loss throughout. Window three
is only partial-minute final input/drain. Loss-case minute-one peak/end pending
**18356.6875/8084.6875 / 14815.375/11924.6875**, with zero loss before injection;
minute two ends pending zero with the explicit loss above.

| Owned browser tree RSS KiB | Baseline / peak / final | Start / 60 s / 120 s |
| --- | --- | --- |
| Japanese loss | 3034832 / 3034832 / 1730064 | 2940864 / 2533888 / not reached |
| Japanese recovery | 2788704 / 2809248 / 1584496 | 2805424 / 2747776 / 2601712 |
| English loss | 3086272 / 3100480 / 1724544 | 3096096 / 2880624 / not reached |
| English recovery | 2902432 / 2929072 / 1435984 | 2902432 / 2800688 / 1468288 |

250 ms samples sum only the owned browser tree, including shared-page double
counting, renderers/GPU, allocators/model residency and harness PCM/media. The
reported minute samples are within **225.851 ms** of nominal Node-clock boundaries.
Case baselines/peaks start after preparation. These are footprint diagnostics,
not isolated model memory, preparation peak, leaks, memory/storage pressure or
mobile/thermal qualification. Inference/endpoint observations use one document
clock; preparation/RSS sampling use the Node clock independently. VAD inference
uses its own worker clock without subtracting clocks. Latencies exclude model
preparation, speech accumulation, translation and display. No percentile claim.

Original scored rounds retain Japanese **1/40, 1/40, 3/120 CER**, English
**1/22, 3/66 WER**, all meanings once/three times, zero normal loss/drained queues
and final-packet-to-text **816.800–1,046.000 ms**. Stop observes actual detector
processing, returns cancelled/no text, reports **831.375 ms** retained loss,
final pending zero and detached input; restart passes. Sustained recovery passes
on these recordings do not resolve historical intermittent Japanese station
repetition/endpoint failures or louder-noise meaning failure.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**. Locked Transformers.js **4.3.0**
and ORT unchanged. Same pinned small FP16 WebGPU
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`
(**seven files / 487,960,440 bytes**) and Silero WASM
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**). One fresh inventory each, cached fresh workers
thereafter; one invocation, no new candidate. First preparation
**56,099.940417 ms**, cached **1,222.085417–1,532.394667 ms**;
**16 pinned paths / 16 requests** overall. Preparation is loading, not accuracy.
Initial owned-tree RSS **1,441,424 KiB**, maximum case peak **3,814,208 KiB**,
with the sampling/ownership limits above.

Generated ignored Japanese video **2,191,142 bytes**, SHA-256
`0c8ef930742e6ab1c3e6fdfde014f0e3f735d39415a72158baf35797faa55778`;
English **2,193,135 bytes**, SHA-256
`3767aca39cbf13048209155b2df91416937145acd7b875b37db83279346f655d`.
Source-period 48 kHz samples/hash: Japanese **334667** /
`62849952bbacc0aef37547d98da09920ed70a8afa5f3f7ebf9004f1a5ccd3886`,
English **319991** /
`0d6a8683900044ef06ced7717b879e05d4eeb772e611fce41cc389447ea6b856`.
Both requested recording durations **131,663.104167 ms**, including the unchanged
five-second uncollected suffix. Source periods match iteration 15, but new
MediaRecorder output/live captures are not asserted byte-identical. No causal
attribution to codec, natural noise, timing or recovery is established.

PASS: explicit Python assertions over recorded results, **exit 0**, tool output:
ten rounds/no failures, stricter **>1,600** exact-input loss jobs, actual acquisition
advance during interrupted jobs, retained earlier revisions/no interrupted revision,
rejected intact-buffer retries/no workers, same-session/target fresh-epoch cached
recoveries, sustained meaning/error/latency/accounting and generated file
hashes/bytes. Evidence analysis only; no additional inference invocation.
PASS: final harness syntax, targeted repository Biome lint **two files / 37 ms /
no findings** and document-inclusive preliminary whitespace, exit 0.

### Remaining work and preservation

**Next unfinished item remains B2:** resolve the historical louder-noise Japanese
meaning and sustained station repetition/endpoint failures; qualify natural
speakers/noise/no-pause/quiet phoneme boundaries, ten-minute live acquisition,
memory/storage pressure and conversion/distribution licensing before selecting a
default. This new result qualifies one controlled sustained injected-loss/recovery
run, not repeatability or natural pressure. Original live/noise/full-candidate/
stream/EOF/quiet/paced-sustained/VAD/B1/short-GPU commands are not rerun or
reclassified. Offline full streaming/interpretation, Korean translation/revisions/
DOM, B3–B6, installation and Safari/iPhone remain **unverified**. B2–B6 remain
unchecked. No required environment/device/permission is absent; incomplete
qualification/implementation warrants neither terminal marker. No stage,
whole-framework or iPhone completion claim.

Only this worktree changes. Companion v0.1.0/install/native messaging/server/
user settings and unrelated files/apps/recordings/mounted images are preserved.
No agents, runner edit, stage advance, push/publish/app installation or blocked
browser/profile/permission bypass. Only owned test browser/profile/recorder
resources are cleaned up. Credentials, model weights, user audio/transcripts and
ignored temporary state stay out of the commit. Final verify and Git checks follow.


### Final required verification and Git checks

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-17-verify.log`: Biome **115 files / 52 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**113 JS passed / 0 failed/skipped/cancelled / 21,023.033625 ms**,
**222 Python passed / 66.93 s**, Python **3.12.15**. Executed after the sole
real browser invocation, including the final strict loss-job source assertion;
later edits finish Markdown evidence only. This pass does not override missing
full Chrome acceptance or historical Japanese quality failures. B2–B6 unchecked.

PASS: explicit four-file scope, unchanged plan checkboxes and document-inclusive
unstaged whitespace assertions, exit 0. Final syntax and prescribed targeted
Biome lint also pass, exit 0. Staged whitespace, the exact four-file commit and
post-commit worktree cleanliness are checked before delivery. Only package command,
existing live harness, this report and plan enter the commit; no credentials,
weights, user data, generated media/profiles or ignored temporary state.


## 2026-10-08 — B2 turbo FP16 noise comparison (iteration 18/20)

Related commit: `feat: evaluate turbo browser ASR noise profile`, containing this
report. **B2 remains unchecked; no default is selected.** Only B2 advances.

Assumption: the retained small-FP16 Japanese louder-noise meaning failure warrants
an explicit candidate comparison before changing segmentation or decoding policy.
The smaller implementation registers another pinned model in the existing
repository/worker and reuses the complete noise harness. No new engine abstraction,
model fallback, production default, dependency or user setting is introduced.

Added `turboFp16` and `test:framework:chrome:noise:turbo`. This opt-in command requires
learned VAD and retains all ten cases, original source/mixed-input hashes, seeded
noise, three complete utterance periods, reference labels, every meaning exactly
three times, <=20% CER/WER, <2,000 ms endpoint latency, <=20-second contiguous ASR
jobs, <=30-second pending audio, zero loss/drained queues, exact unfiltered PCM,
complete detector coverage, <10% VAD duration and zero noise-only active frames,
ASR calls and text. Original commands still select small FP16. Cached offline
fresh-worker ASR for both languages retains its own exact-once meaning gates.
Every preparation/offline ready status must identify the selected pinned model
and declared byte inventory; another model cannot substitute. Remote artifact
allowlists use only the explicit selected candidate and pinned VAD.

Fake transport checks additionally cover turbo's rejected WASM route with no
worker/fallback, explicit candidate forwarding and termination on small-model
readiness. These checks are not recognition or GPU-accuracy evidence.

### Candidate discovery and initial checks

Supplied instructions, plan, architecture and prior Chrome report reviewed.
Root/nested AGENTS.md and the requested independent runner evidence file
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent. Local logs remain
ignored under `.ralph/media-framework/`.

- FAIL: web-reader lookups for medium and the pinned turbo README returned
  accessibility errors; no licensing or model evidence inferred from those errors.
  Initial system-Python urllib metadata lookup for
  `onnx-community/whisper-medium?blobs=true` returned HTTP 401, exit 1. No
  authentication/profile/permission bypass or medium weights download.
- PASS: public `node --input-type=module` fetch inspection, exit 0: Xenova medium
  and ONNX-community turbo metadata HTTP 200, followed by pinned turbo
  README/config/generation/preprocessor HTTP 200. Medium is not registered or
  downloaded. Turbo metadata/card and the upstream
  [model card](https://huggingface.co/openai/whisper-large-v3-turbo) identify the
  multilingual pruned model; browser support is assessed by actual execution.
- PASS: focused `node --import tsx --test` over model, ASR, VAD and speech port
  files, exit 0, `chrome-20261008-18-ports.log`: **30 passed / 0 failed/skipped/
  cancelled / 267.951292 ms**. Fake cache/worker/executor evidence only.
- PASS: final preliminary `node --check tests/framework-chrome-noise.mjs`,
  registered-byte-sum check (**1,621,338,971**) and prescribed five-file Biome
  lint (**23 ms / no findings**), exit 0; preliminary whitespace also passes.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-18-stage-acceptance.log`: missing `test:framework:chrome` script.
  Full selected-video PCM → ASR → Korean translation → DOM acceptance remains
  unimplemented. No placeholder command or substituted success.

Actual browser results and final required repository checks follow.


### Actual browser results

FAIL: `caffeinate -disu npm run test:framework:chrome:noise:turbo`, **exit 1**,
once, `chrome-20261008-18-turbo-noise.log`: typecheck, **30 port tests / 0 failed/
skipped/cancelled / 259.001834 ms**, build, **ten complete online cases / 4,066
recorded WASM VAD frames / twelve online plus two offline real FP16 WebGPU ASR
jobs**. Only qualification failures are the first endpoint in each Japanese
speech case exceeding the unchanged 2,000 ms gate. Page errors and native
visibility events are `[]`. No second browser invocation or gate relaxation.

| Speech case | Error | Meanings | Endpoint-to-text ms | Peak pending ms |
| --- | --- | --- | --- | ---: |
| Japanese / quiet noise — latency FAIL | 3/120 = 2.5% CER | Every anchor 3 | **2,384.200**, 1,893.300, 1,258.600 | 10,400 |
| Japanese / louder noise — latency FAIL | 3/120 = 2.5% CER | Every anchor 3 | **2,009.100**, 1,889.900, 1,263.500 | 10,200 |
| English / quiet noise — PASS | 3/66 = 4.545455% WER | Every anchor 3 | 1,839.000, 1,682.300, 1,177.800 | 9,600 |
| English / louder noise — PASS | 3/66 = 4.545455% WER | Every anchor 3 | 1,827.500, 1,787.300, 1,188.700 | 9,600 |

All six noise-only controls have **zero active VAD frames / zero ASR calls /
zero text**, with 6,000 ms maximum pending. Every run has zero reported loss,
final pending zero, exact mixed PCM submitted to ASR, complete contiguous detector
coverage and job ranges, bounded jobs/queues, and <10% detector duration.
Speech VAD totals **424.500 / 437.500 / 417.000 / 402.300 ms** in table order.
Inputs are Japanese **383,040 samples / 23,940 ms**, English **368,640 / 23,040**;
noise-only inputs each **96,000 / 6,000**. Louder-noise SNR is **7.709260 /
8.633690 dB**. Seeded white noise is synthetic; no natural-noise claim.

Job boundaries ms, same table order:
`0,8096,15872,23940`; `0,8128,15872,23940`;
`0,7744,15264,23040`; `0,7712,15200,23040`.
The failed Japanese endpoint host calls are only **1,680.200 / 1,405.100 ms**;
these exclude endpoint-to-submission waiting and cannot replace the failed
endpoint metrics. No attribution of latency to shader compilation or memory
pressure is established. No first-job deletion/warm-up exemption/rounding to pass.

PASS: Python assertions over the retained iteration-13 small-FP16 log
`chrome-20261008-13-noise-offline.log` and this run, exit 0: **all ten input hashes,
all detector active counts and all twelve actual ASR job sample counts/ranges/
hashes match**. Small's louder Japanese result remains **9/120 CER**, meeting 2 /
station 1; turbo returns **3/120**, all seven meanings 3 on those same jobs.
Louder English changes **4/66 → 3/66 WER**, all four meanings 3 in both.
This is a historical candidate comparison with identical measured inputs, not
simultaneous timing, repeatability, a segmentation fix or general model ranking.
Original small/noise and sustained-live failures are not reclassified or rerun.

PASS: cached offline fresh workers reach cached/loading/ready for the exact turbo
and VAD inventories without downloading. **Zero remote requests** across offline
prepare/control/inference. Actual no-speech VAD probability **0.012012064457**;
pending detector Stop returns `VAD stopped` and preserves **2,048 caller bytes**.
Offline Japanese **111,556 samples / 6,972.25 ms**, **1/40 CER**, every meaning 1,
worker inference **1,499.500 ms**, document host **1,501.400 ms**. English
**106,664 / 6,666.5 ms**, **1/22 WER**, every meaning 1, **1,199.200 / 1,200.500 ms**.
Both PCM buffers transfer (zero caller bytes), and pinned identity/session/target/
epoch/range/final revision checks pass. Original PCM hashes remain
`015684bdb023e8a53ea991d73b4e2ff56266c94a9876a8239a2940521b213d8c` /
`f19362f78f79ac81c6c0b2189753ce6c17b640f340184443ed2b08270c0b93a8`.
This is cached ASR/detector evidence, not offline streaming or Korean captions.

### Model, environment and memory evidence

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**; host has **17,179,869,184 bytes**
physical memory. Locked Transformers.js **4.3.0** and ORT unchanged.

Pinned candidate:
`onnx-community/whisper-large-v3-turbo@360ebcde2559d60bb474678be3c1de9ef347d01a`,
**seven files / 1,621,338,971 bytes**. Metadata/card/config were retrieved from the
public Hub; [pinned card](https://huggingface.co/onnx-community/whisper-large-v3-turbo/blob/360ebcde2559d60bb474678be3c1de9ef347d01a/README.md)
links the upstream model and Transformers.js-compatible conversion. Pinned config
has 32 encoder / 4 decoder layers, 128 mel features and 16 kHz preprocessing.
Upstream card reports MIT; separate conversion/distribution license confirmation
remains **unverified**, as the conversion card has no license field.

Config **1,332**, generation **3,897**, tokenizer **2,480,617**, tokenizer config
**282,843**, preprocessor **340** bytes. Encoder FP16 **1,274,342,603 bytes**,
SHA-256 `fdadc70836e6b028fd5e580417c312208dad073d2d01e509e2d127c1373399d8`;
merged decoder FP16 **344,227,339 bytes**,
`fdf10afca73a0c7bf87286cfb96cf7028a9edbc9bb02512509a526f95b126c9d`.
The production repository verifies both actual ONNX download hashes before load.
Silero remains pinned at `e71cae966052b992a7eca6b17738916ce0eca4ec`,
**one file / 2,243,022 bytes**. One fresh inventory each, then cached fresh workers;
**16 distinct pinned/redirect paths** observed. Locally packaged runtime storage
is additional to model bytes. No medium or other new weights downloaded.

First preparation **163,271.711250 ms**; nine cached online preparations
**2,133.598791–2,841.023500 ms**. Preparation is distinct from inference/accuracy.
Initial owned-browser-tree RSS **1,290,912 KiB**, maximum case peak
**6,592,704 KiB**. Speech baseline/peak/final KiB:
Japanese quiet **3598000/6562592/2456768**, louder **996672/5350208/1576016**;
English quiet **3983008/6315984/745456**, louder **748480/5248736/733792**.
250 ms samples sum only the owned browser tree, including preparation, shared-page
double counting, browser/renderers/GPU, allocator/model/harness residency. Baselines
carry sequential allocator effects. These are process RSS diagnostics, not isolated
model/GPU allocations, available-memory guarantees, leak, pressure/storage or
mobile/thermal evidence. Endpoint/host observations use one document clock;
preparation/RSS use Node and VAD inference its own worker clock independently.
Latencies exclude download/preparation, translation and DOM. No percentile claim.

PASS: explicit Python recorded-result assertions, exit 0: ten completed cases,
exactly the two retained Japanese endpoint failures, all error/meaning/PCM/queue/
noise gates and both cached offline recognitions/lifecycle outcomes match.
Evidence analysis only; no inference rerun. Final syntax/preliminary whitespace
also pass. The browser command itself remains **FAIL**.

### Remaining work and preservation

**Next unfinished item remains B2:** bring turbo's two Japanese endpoints below
2,000 ms while preserving this exact-input meaning improvement; qualify actual
live input, sustained repetition, overload/ASR Stop/GPU loss and recovery, memory/
storage pressure, natural/no-pause/quiet phoneme boundaries, broader candidate
comparison and licensing before selecting a default. Existing small's louder-noise
and sustained station/latency failures remain. Turbo's cached synthetic-noise
results do not qualify those live/lifecycle paths or a default.

Full Chrome acceptance remains FAIL (missing script); B2–B6 remain unchecked.
Korean translation/revisions/DOM, ten-minute playback, full offline interpretation,
installation and Safari/iPhone remain unverified. No required environment/device/
permission is absent; unfinished qualification/implementation warrants neither
terminal marker. No stage/framework/iPhone completion claim.

Only this worktree changes. Published companion v0.1.0/install/native messaging/
server/settings and unrelated files/apps/recordings/mounted images preserved.
No agents/runner edits/stage advance/push/publish/app installation or blocked
browser/profile/permission bypass. Only the owned test browser/profile resources
are cleaned up. Credentials/weights/user audio/transcripts/temporary ignored state
stay out of the commit. Final required verify and Git checks follow.


### Final required verification and Git checks

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-18-verify.log`: Biome **115 files / 52 ms / no findings**,
Ruff, typecheck, companion build **28 main / 10 content modules**,
**113 JS passed / 0 failed/skipped/cancelled / 21,903.350209 ms**,
**222 Python passed / 66.91 s**, Python **3.12.15**. Run after the sole actual
browser invocation on final implementation/test sources; subsequent edits only
finish Markdown evidence. This does not override either turbo latency failure,
the retained small qualification failures or missing full Chrome acceptance.

PASS: exact seven-file scope, append-only plan/report, unchanged every original
checkbox and document-inclusive unstaged whitespace assertions, exit 0. Final
staged whitespace/scope and post-commit cleanliness checked before delivery.
Only candidate registry/worker whitelist, transport test, existing noise harness,
package command, report and plan enter the commit. No generated assets, models,
profiles, credentials, user data or ignored temporary state are committed.


## 2026-10-08 — B2 turbo sustained live GPU qualification (iteration 19/20)

Related commit: `test: qualify turbo sustained live GPU recovery`, containing
this report. **B2 remains unchecked; no default is selected.** Only B2 advances.

Assumption: iteration 18's decoded synthetic-noise/cached inference evidence does
not qualify turbo's production selected-video acquisition, Stop, sustained
repetition or GPU-loss/recovery path. The smaller change explicitly selects this
already registered candidate in the existing live harness and fixture, retaining
all original scenarios and gates before considering decoding/segmentation changes.

Added `test:framework:chrome:live:sustained:gpu-recovery:turbo`; only that opt-in
command chooses `turboFp16`. Original commands/fixture calls still use small FP16.
Each round must report the selected pinned identity and full required-byte count;
remote artifact checks use that exact candidate and the unchanged pinned VAD.
Recovery reuses the same host/session/target and requires two fresh cached workers,
fresh epoch and zero remote requests. The turbo preparation wait is 240 seconds,
matching its existing noise harness and the measured 163.272-second first load;
small retains 120 seconds. Preparation waiting is separate from the unchanged
**<2,000 ms** recognition gates; it changes no readiness or accuracy assertion.

The complete six original live rounds and four sustained loss/recovery rounds
retain their input/isolation/mapping/playback/detach, cached readiness, actual
live Stop during VAD processing, exact normalized job PCM, contiguous bounded ranges, <=30-second
pending audio and accounting assertions. Scored runs retain complete VAD coverage,
<=20% CER/WER and every meaning exactly the complete period count. Interrupted
loss rounds establish lifecycle/accounting, not quality. Loss follows at least one
minute of acquisition and must publish no interrupted revision, cancel/detach,
retain explicit discarded duration and reject unprepared retries without workers
or transferred PCM. Each recovery supplies at least two minutes of selected-video
PCM; acquisition must advance during every nonfinal job. No failed input/text,
first job, endpoint or original scenario is removed; no production model/policy,
dependency, companion installation path or user setting is changed.

### Initial command evidence

Supplied instructions, plan, architecture and Chrome report reviewed. Root/nested
AGENTS.md and requested independent runner evidence
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent. Local logs remain
ignored under `.ralph/media-framework/`.

- PASS: `node --check tests/framework-chrome-live-learned.mjs`, targeted
  `biome lint tests/framework-chrome-live-learned.mjs tests/fixtures/chrome-live-asr.html`
  (**two files / 7 ms / no findings**) and preliminary `git diff --check`, exit 0.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-19-stage-acceptance.log`: missing script. The full selected-video
  PCM → ASR → Korean translation → DOM harness remains unimplemented. No
  placeholder/substituted success and no unchanged retry.

Actual browser results, final repository verification and Git checks follow.


### Actual browser results and diagnostic evidence

FAIL: `caffeinate -disu npm run test:framework:chrome:live:sustained:gpu-recovery:turbo`,
**exit 1**, once, `chrome-20261008-19-turbo-live-gpu.log`: typecheck,
**27 port tests / 0 failed/skipped/cancelled / 256.120291 ms**, build,
**ten completed rounds / 13,665 recorded WASM VAD frames / 46 actual FP16 WebGPU
ASR calls**, including two deliberately destroyed GPU jobs. Page errors/native
visibility events `[]`. Exactly two final failure categories: Japanese recovered
18-period meaning count and endpoint latency. No rerun or gate relaxation.

| Recovered live input | Raw 48 kHz / normalized samples | Captured / document runtime ms | Error | Meanings | Jobs / capture overlaps | Endpoint-to-text ms | Peak pending ms |
| --- | --- | --- | --- | --- | --- | --- | ---: |
| Japanese / 18 periods — FAIL | 6027264 / 2009088 | 125568 / 126999.200 | 20/720 = 2.777778% CER | Tomorrow 17; other six 18 — FAIL | 13 / 12 | 1430.600–2095.600 — FAIL | 13748.6875 |
| English / 19 periods — PASS | 6082560 / 2027520 | 126720 / 128224 | 19/418 = 4.545455% WER | Every anchor 19 | 10 / 9 | 1506.800–1864.000 | 15220.6875 |

All scored runs pass exact unfiltered normalized job PCM, complete detector
coverage, contiguous <=20-second ranges, <=100 ms leading / <20 ms trailing
context, input isolation/mapping, original playback/detach, zero reported loss,
bounded queues and final pending zero. Sustained leading is **32 ms**, trailing
**zero**. Every nonfinal sustained ASR job overlaps actual acquisition. Sustained
VAD totals **2,295.900 / 2,432.900 ms** are below the unchanged 10% gate. These
passes do not override Japanese's missing future-time anchor or failed endpoints.

The two failed Japanese jobs are **32–11,648 ms** and **49,664–60,384 ms**:
endpoint-to-text **2,095.600 / 2,035.500 ms**, endpoint-delivery-to-submission
waiting **344.600 / 429.700 ms**, host-call duration **1,751.000 / 1,605.800 ms**.
All are observations on the same document clock. The host calls and final-packet
latency **1,432.700 ms** cannot replace the failed endpoint metric. No causal
claim about shader compilation, memory pressure, model size or segmentation.

Japanese recovery ASR boundaries ms:
`32,11648,23296,28640,39488,49664,60384,67360,74336,84736,95424,105344,116320,125568`.
English:
`32,11168,21376,34720,48032,61376,74688,88032,101376,114688,126720`.
Minute peak/end pending ms: Japanese **13748.6875/10324.6875,
12756.6875/3658, 9248/0**; English **15156.6875/11956.6875,
15220.6875/5290, 12032/0**. Every window has zero loss; window three is the
partial final minute and drain.

PASS within this failed command: Japanese/English active GPU-loss rounds follow
**60,671.375 / 61,780.6875 ms** of normalized acquisition, document runtimes
**60,666.100 / 61,757.100 ms**. Ten/four earlier revisions remain; interrupted
jobs **56,736–60,320 / 48,064–61,376 ms** publish none. Acquisition advances
through both actual interrupted calls. Explicit retained loss
**3,892.6875 / 13,674 ms**, pending zero, input detached and original advancing
playback preserved. Closing input reads do not equal all retained queued audio.
Unprepared retries return `gpu-lost`, preserve **6,400 bytes**, create zero
workers and publish no additional revision/request. Explicit cached Prepare
alone creates two fresh workers on the same host/session/target and every
recovered revision has epoch 1; preparation **3,254.376167 / 3,144.683875 ms**,
zero remote requests. These are controlled lifecycle/recovery observations,
not natural pressure, repeatability or a quality pass for interrupted input.

Japanese's loss round contains an unreferenced four-character phrase in the
completed **42,784–44,864 ms** job before injection. Its partial prior text is
not scored against eighteen complete periods; that observation remains a
quality concern. Loss assertions establish lifecycle/accounting only. No text
is removed, relabeled accurate or used as a transcript oracle.

Five original scored rounds pass Japanese **1/40, 1/40, 3/120 CER**, English
**1/22, 3/66 WER**, every meaning once/three times, final-packet-to-text
**1,379.700–1,459.000 ms**, zero normal loss/drained queues. Stop returns
`cancelled`, no text, detached input, zero pending and **820.6875 ms** explicit
loss; restart passes. This Stop interrupts actual VAD processing with **zero
ASR calls**, so user Stop during turbo ASR inference remains **unverified**.
Injected active GPU loss establishes a different cancellation path.

### Environment, memory and fixture evidence

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**. Locked Transformers.js **4.3.0**
and ONNX runtime **1.31.0-dev.20260914-8d85527a0** unchanged. Same pinned turbo
`onnx-community/whisper-large-v3-turbo@360ebcde2559d60bb474678be3c1de9ef347d01a`
(**seven files / 1,621,338,971 bytes**) and Silero
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**). Existing ONNX hash verification precedes load.
One fresh inventory each, cached workers thereafter, **16 pinned/redirect paths /
16 requests** overall. No new candidate/weights/dependency introduced; preparation
is loading, not accuracy. First Prepare **160,128.519042 ms**, nine cached
preparations **2,342.474542–3,589.680041 ms**. No offline streaming claim.

Initial owned-tree RSS **1,445,184 KiB**, maximum case peak **5,142,320 KiB**.

| Owned browser RSS KiB | Baseline / peak / final | Start / 60 s / 120 s |
| --- | --- | --- |
| Japanese loss | 4899360 / 4900592 / 1054800 | 4900592 / 1977856 / not reached |
| Japanese recovery | 4597632 / 4597632 / 866928 | 4580256 / 936416 / 924000 |
| English loss | 4680864 / 4680864 / 898016 | 4255712 / 3290944 / not reached |
| English recovery | 4848512 / 4848512 / 1020832 | 4819856 / 2784416 / 2775760 |

250 ms samples sum only this owned browser tree, including shared-page double
counting, renderers/GPU, allocator/model/harness/media residency. Case baselines
and peaks start after preparation; preparation peak is not qualified. Minute
samples are within **244.800 ms** of nominal Node-clock boundaries. These are
process-footprint diagnostics, not isolated GPU/model allocations, pressure,
storage, leak freedom or mobile/thermal evidence. Capture/inference endpoint
observations use the document clock; preparation/RSS use Node and VAD inference
its worker clock independently. Latencies exclude preparation, accumulation,
translation/display; no percentile claim or cross-clock subtraction.

Generated ignored Japanese video **2,191,142 bytes**, SHA-256
`39b74e778dcbeeec3249bbb0c270bcbbe5e45fdd265f6a86b977581551120b6f`;
English **2,193,135 bytes**,
`7c2cf202efbaa80f1f763494165d5ce9112644031005ae9e9a49b67191c8e41a`.
48 kHz source periods: Japanese **334667 samples** /
`62849952bbacc0aef37547d98da09920ed70a8afa5f3f7ebf9004f1a5ccd3886`;
English **319991 samples** /
`0d6a8683900044ef06ced7717b879e05d4eeb772e611fce41cc389447ea6b856`.
Requested duration **131,663.104167 ms** each includes the unchanged five-second
uncollected suffix. PASS: Python verifies actual generated hashes/bytes and exact
source period/hash/count/requested duration against iteration 17, exit 0. New
MediaRecorder outputs/live captures are not asserted byte-identical. This is a
historical candidate qualification, not a controlled simultaneous timing or
identical live-job comparison; prior small/noise/sustained failures stay failures.

PASS: explicit Python assertions over recorded results, exit 0: ten completed
rounds, exactly the two Japanese failure categories, pinned model/byte identity,
loss/no-interrupted-revision/retry/recovery, VAD-only Stop, scored quality/latency/
accounting/coverage and generated hashes/bytes. Evidence analysis, no extra
inference invocation. PASS: extracted live fixture module `node --check`, exit 0.

### Remaining work and preservation

**Next unfinished B2:** preserve the noise meaning improvement while resolving
turbo's retained noise endpoint failures and new sustained future-time/endpoint
failures, and investigate the unreferenced pre-loss phrase. Qualify actual user
Stop during turbo ASR, overload, quiet/no-pause/natural speakers/noise, ten-minute
live acquisition, memory/storage pressure and conversion/distribution licensing
before selecting a default. Original small and turbo-noise commands are not rerun
or reclassified. Other original candidate/stream/EOF/quiet/VAD/B1 results stay
historical. Full Chrome acceptance still FAILS (missing script); B2–B6 unchecked.
Full offline streaming/interpretation, Korean translation/revision pairing/DOM,
installation and Safari/iPhone remain unverified. No required environment/device/
permission is absent; qualification failures/incomplete implementation warrant
neither terminal marker. No stage/framework/iPhone completion claim.

Only this worktree changes. Companion v0.1.0/install/native messaging/server/user
settings and unrelated files/apps/recordings/mounted images preserved. No agents,
runner edits, stage advance, push/publish/app installation or blocked browser/
profile/permission bypass. Only owned test browser/profile/recorder resources
are cleaned up; model weights, generated media, credentials, user audio/transcripts
and ignored temporary state stay out of the commit. Final required verify and Git
checks follow.


### Final required verification and Git checks

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-19-verify.log`: Biome **115 files / 51 ms / no findings**, Ruff,
typecheck, unchanged companion build (**28 main / 10 content modules**),
**113 JS passed / 0 failed/skipped/cancelled / 21,593.026375 ms**,
**222 Python passed / 66.93 s**, Python **3.12.15**. Run after the sole actual
browser invocation on final implementation/test sources; subsequent changes only
finish Markdown evidence. This pass does not override Japanese's failed meaning/
endpoint gates or the missing full Chrome command. B2–B6 remain unchecked.

PASS: final live harness and embedded fixture module syntax, prescribed targeted
Biome lint **two files / 7 ms / no findings**, exact five-file scope, append-only
report/plan, unchanged every original checkbox and document-inclusive unstaged
whitespace, exit 0. Final staged whitespace/scope and post-commit cleanliness
checked before delivery. Only package command, existing live harness/fixture,
report and plan enter the commit; no generated media, weights, profiles,
credentials, user data, ignored temporary state or runner changes.


## 2026-10-08 — B2 turbo live ASR Stop and cached restart (iteration 20/20)

Related commit: `test: qualify turbo live ASR stop and restart`, containing this
report. **B2 remains unchecked; no default is selected.** Only B2 advances.

Assumption: iteration 19's live Stop interrupted VAD with zero ASR calls, so its
successful cancellation cannot qualify user Stop during turbo inference. The
smaller change extends the existing live qualification harness and fixture with
an opt-in `--asr-stop` mode rather than changing production decoding or policy.
New `test:framework:chrome:live:asr-stop:turbo` runs the six original scenarios,
then Japanese and English active-ASR Stop and three-period cached restart rounds.
Existing commands still select their original modes/candidates. All 95 original
assertion lines remain; only the mutually exclusive mode list is extended.

An owned fixture MessageChannel acknowledges the production worker handler's
actual pipeline invocation, without sending a fabricated result/status into the
validated host protocol. The harness then uses keyboard Enter on the existing
Stop button. A passive document-clock snapshot must show exactly one unresolved
host invocation, no published revision and Stop before that invocation settles.
The cancelled job must contain the exact, unfiltered normalized selected-video
PCM and end before the complete three-period capture endpoint. Cancellation must
retain explicit discarded duration covering its entire active job, zero pending
audio, bounded queues, capture detach and no revision over a two-second late-result
observation. Both original videos must remain playing at their existing volume,
mute and rate settings and advance by more than one second in that observation.
An unprepared retry must retain its 6,400-byte PCM, create no worker and reject
as not ready. Explicit cached Prepare alone must create two fresh workers on the
same ASR/VAD hosts, same session/target and a fresh epoch; all original scored
PCM/quality/meaning/latency gates apply to the restarted runs. No cloud fallback,
model/default/policy/dependency/companion or user-setting change.

### Initial checks and required acceptance

Supplied instructions, plan, architecture and Chrome evidence reviewed. Root and
nested AGENTS.md and the requested independent runner evidence
`2026-10-08T01-12-31-094Z-chrome-verification.txt` are absent. Local output remains
ignored under `.ralph/media-framework/`.

- PASS: `node --check tests/framework-chrome-live-learned.mjs`, extracted fixture
  module `node --input-type=module --check`, targeted Biome **two files / 8 ms /
  no findings**, preliminary `git diff --check` and Python preservation assertion
  for all **95** original assertion lines, exit 0.
- FAIL: `npm run test:framework:chrome`, **exit 1**, once,
  `chrome-20261008-20-stage-acceptance.log`: `Missing script: "test:framework:chrome"`.
  The full selected-video PCM → ASR → Korean translation → DOM harness remains
  unimplemented. No placeholder or substituted model/lifecycle success.


### Actual browser results

PASS: `caffeinate -disu npm run test:framework:chrome:live:asr-stop:turbo`,
**exit 0**, once, `chrome-20261008-20-turbo-asr-stop.log`: typecheck,
**27 port tests / 0 failed/skipped/cancelled / 251.934250 ms**, separate browser
build, **ten completed rounds / 4,065 actual WASM VAD frames / 13 actual FP16
WebGPU ASR calls**, including two interrupted calls. Failures, page errors and
native visibility events are all `[]`. This is a bounded B2 qualification, not
full Chrome acceptance or Korean translation/display evidence.

| Active-ASR Stop | Japanese | English |
| --- | ---: | ---: |
| Actual raw 48 kHz samples | 720,896 | 548,864 |
| Actual normalized 16 kHz samples / duration ms | 240,298 / 15,018.625 | 182,954 / 11,434.625 |
| Interrupted ASR range ms | 32–14,720 | 0–11,136 |
| Exact unfiltered active ASR samples | 235,008 | 178,176 |
| Keyboard Stop after host submission ms | 29.600 | 30.600 |
| Host rejection after Stop ms | 1.000 | 0.700 |
| Stop handler cleanup ms | 1.100 | 0.800 |
| Explicit discarded / final pending ms | 14,986 / 0 | 11,434 / 0 |
| Original video progress during observation, seconds (ja / en) | 2.064989 / 2.064992 | 2.053298 / 2.053286 |

Each Stop observed exactly one unresolved, worker-invoked job and zero revisions,
returned `cancelled`, accounted for the entire interrupted job and additional
retained context, detached capture and published no revision over the subsequent
two seconds. Job settlement is host cancellation, not an inference completion.
No next normalized delivery occurred within either approximately 30 ms call
window; advancing original playback after detach is independently observed.
Selected/other isolation-tag amplitudes were **0.060082/0.000360** Japanese,
**0.060011/0.000624** English; raw video mapping error **25.490/10.624 ms**.
These are input diagnostics, not accuracy scores for cancelled speech.

Both unprepared retries rejected as not ready, retained **6,400 bytes**, created
zero workers, kept zero revisions and left raw chunk counts unchanged. No
remote requests occurred in either cached Stop round. Explicit Prepare reused
the same ASR/VAD hosts, session and selected target; it alone created two fresh
workers and every subsequent revision used epoch **1**. Restart preparation
**2,633.435375 / 2,549.133959 ms**, zero remote requests, is model preparation
rather than recognition latency.

| Three-period restart | Japanese | English |
| --- | ---: | ---: |
| Raw / normalized samples | 1,005,568 / 335,189 | 962,560 / 320,853 |
| Actual normalized duration ms | 20,949.3125 | 20,053.3125 |
| CER / WER | 3/120 = 2.5% | 3/66 = 4.545455% |
| Every meaning count | 3 | 3 |
| Last-packet-to-text ms | 1,460.300 | 1,349.500 |
| Peak pending / discarded / final pending ms | 13,716.6875 / 0 / 0 | 13,023.375 / 0 / 0 |
| VAD frames / total inference ms | 655 / 462.900 | 627 / 426.400 |

Both restarts use two exact-PCM ASR jobs with contiguous ranges:
Japanese **64–11,808–20,949.3125 ms**, English **32–11,168–20,053.3125 ms**.
Leading quiet context **64/32 ms**, trailing **zero**; complete detector coverage,
<=20-second job ranges, unchanged error/meaning/last-packet latency gates, input
isolation/mapping, normal zero loss and detach pass. Actual selected capture
advances **1,706.6875/1,578.6875 ms** during their first ASR calls; final jobs
follow EOF. This is three-period evidence; sustained per-job endpoint metrics
and ten-minute acceptance were not measured in this invocation.

All five original scored rounds also pass: Japanese **1/40, 1/40, 3/120 CER**,
English **2/22, 3/66 WER**, every meaning once/three times, last-packet latency
**1,341.700–1,475.100 ms**, normal zero loss and drained queues. Original VAD-only
Stop still reports zero ASR calls and **863.375 ms** explicit loss; it is retained
separately from the two new active-ASR Stop rounds. No failed fixture, transcript,
original scenario or threshold is removed.

### Environment, model and memory

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**. Existing pinned turbo
`onnx-community/whisper-large-v3-turbo@360ebcde2559d60bb474678be3c1de9ef347d01a`
(**seven files / 1,621,338,971 bytes**) and Silero
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**); locked Transformers.js **4.3.0**/ORT and all
model registry hashes unchanged. The production repository verifies the existing
ONNX hashes before load. One fresh inventory per model, cached workers thereafter,
**16 pinned/redirect paths / 16 requests** overall. No new candidate/weights or
generated media. First Prepare **159,954.829417 ms**, nine cached preparations
**2,442.991459–3,611.297125 ms**. These are loading, not recognition accuracy.
No offline streaming/interpretation claim.

Initial owned browser-tree RSS **1,441,632 KiB**, max post-prepare case peak
**5,320,560 KiB**. Baseline/peak/final KiB: Japanese Stop
**3,377,520/3,377,520/2,155,424**, restart **4,500,720/4,500,720/745,040**;
English Stop **3,303,936/3,303,936/1,037,728**, restart
**4,720,816/4,720,816/818,080**. Existing 250 ms process-tree samples include
shared-page double counting, browser/renderers/GPU, allocators and harness/media/
model residency; final samples precede the two-second observation in Stop rounds.
Preparation peak is not qualified. These are footprint diagnostics, not isolated
GPU/model allocations, memory/storage pressure, leak freedom or mobile/thermal
measurements. Capture/submission/Stop/rejection/text measurements share the
document clock. Preparation/RSS use Node and VAD inference its worker clock
independently; no cross-clock subtraction or latency percentile claim.

PASS: explicit Python assertions over the recorded result, exit 0: ten completed
rounds, pinned identity/bytes, two actual-ASR Stop outcomes, preserved exact job
PCM/accounting/late suppression/retry, same target/session and fresh-epoch cached
restart, all scored accuracy/meaning/latency/queue outcomes. This analyzes the
single actual browser invocation; it does not rerun inference. Final targeted
Biome **two files / 8 ms / no findings** and harness syntax also pass.

### Remaining work and preservation

**Next unfinished item remains B2:** resolve retained turbo noise endpoint and
sustained Japanese future-time/endpoint failures, investigate the unreferenced
pre-loss phrase, qualify overload and quiet/no-pause/natural speakers/noise,
ten-minute live acquisition, memory/storage pressure and conversion/distribution
licensing before selecting a default. This invocation qualifies active user Stop
for both languages and a bounded explicit cached restart; it does not rerun or
reclassify earlier small/turbo noise/sustained failures or establish repeatability.

Full Chrome acceptance remains FAIL (missing script); B2–B6 unchecked. Korean
translation/source-revision pairing/DOM, full offline interpretation, installation
and Safari/iPhone remain unverified. No required environment/device/permission is
absent; unfinished implementation/qualification warrants neither terminal marker.
No stage/framework/iPhone completion claim.

Only this worktree changes. Published companion v0.1.0/install/native messaging/
server/settings and unrelated files/apps/recordings/mounted images preserved.
No agents, runner edits, stage advance, push/publish/app installation or blocked
browser/profile/permission bypass. Only owned test browser/profile resources are
cleaned up. Credentials/weights/user audio/transcripts/generated media/temporary
ignored state stay out of the commit. Final verify and Git checks follow.


### Final required verification and Git checks

PASS: `caffeinate -disu npm run verify`, **exit 0**,
`chrome-20261008-20-verify.log`: Biome **115 files / 56 ms / no findings**, Ruff,
typecheck, unchanged companion build **28 main / 10 content modules**,
**113 JS passed / 0 failed/skipped/cancelled / 21,917.328333 ms**,
**222 Python passed / 66.87 s**, Python **3.12.15**. Run after the sole actual
browser invocation on final implementation/test sources; subsequent changes only
finish Markdown evidence. This does not override the missing full Chrome command
or earlier retained Japanese/noise/sustained qualification failures.

PASS: Python checks of exact five-file scope, append-only report/plan, every
original checkbox and all existing npm commands/dependencies unchanged; final
harness/embedded fixture syntax, targeted Biome and document-inclusive unstaged
whitespace, exit 0. Only package command, existing live harness/fixture, report
and plan are selected for the commit. Models/media/profiles/credentials/user data/
ignored temporary state and runner changes are excluded. Staged scope/whitespace
and post-commit cleanliness are checked before delivery.


## 2026-10-08 — fix first-result submission latency

The retained Turbo noise failure was a late first submission, not missing
Japanese meaning in that suite. Previous first-result endpoint latency was
2,384.2 ms (quiet additive noise) / 2,009.1 ms (white noise), including
703.9 / 604.0 ms of submission wait. Speech recognition already preserved all
three repetitions' meaning. Baseline: `chrome-20261008-18-turbo-noise.log`.

The recognizer now uses the existing VAD probability: after admitted speech,
512 ms continuously below 0.05 can submit the **first** job, retaining 256 ms
of unchanged source context. Uncertain frames and subsequent jobs keep the
existing onset/EOF policy. No model/default/fixture/PCM/gate/harness changed.
The existing boolean-only detector interface remains supported without this
confidence-based early submission.

Final `caffeinate -disu npm run test:framework:chrome:noise:turbo`: PASS, all ten
original cases plus cached offline Japanese/English ASR, no failures/page errors/
visibility events, zero offline remote requests. Japanese first results are
**1,765.3 / 1,672.0 ms**; waits **303.8 / 208.6 ms**. All Japanese endpoints are
<=**1,912.4 ms**, English <=**1,870.9 ms**. Every original meaning occurs three
times. Both Japanese mixed-input hashes and **all job PCM hashes/ranges exactly
match the previous failing run**. Evidence:
`.ralph/media-framework/japanese-endpoint-turbo-noise-final.log`.

Regression on the original HEAD code fails: the first job submits at packet 53
(after new speech starts), instead of packet 48. Final focused ports: 28 PASS,
covering uncertain silence, retained context, subsequent-job policy, Stop and
existing quiet onset guards. Evidence: `japanese-endpoint-final-regression-before.log`
and `japanese-endpoint-unit.log`. Full `npm run verify` on the final production
change: PASS, 114 JS / 222 Python (66.88 s), lint/typecheck/build; final strengthened
submission assertion subsequently passed with all 28 focused ports. Evidence:
`japanese-endpoint-verify-complete.log`.

Rejected broader early-submission attempt reduced first latency but failed the
original EOF gate (23,648 != 23,940 ms); limiting it to the initial job preserves
that gate. An intermediate test assertion sampled acquisition before it had
finished (50 != 96 packets); waiting one event-loop turn fixed that test timing.
Evidence: `japanese-endpoint-turbo-noise.log` and
`japanese-endpoint-verify-final.log`. Neither acceptance gate was relaxed.

Quiet-input compatibility and final Git evidence are recorded below.
B2 is still incomplete: the previously recorded sustained live Japanese missing
`明日` and later endpoint failures have not been requalified by this noise fix.
Next work should target that retained failed boundary, rather than adding another
GPU/Stop qualification variant. B3–B6/Safari/iPhone remain incomplete.


Compatibility: `caffeinate -disu npm run test:framework:chrome:quiet` PASS, all six
original small-FP16 cases at gains 1/0.25/0.1. Japanese CER 2.5%/2.5%/5%; English
WER 4.545% in every case. All meanings exactly three times, maximum endpoint
1,660.2 ms, unchanged EOF/PCM/coverage/loss gates PASS. Evidence:
`.ralph/media-framework/japanese-endpoint-quiet.log`. Final targeted Biome,
typecheck and whitespace checks PASS. Only recognizer, one focused regression,
report and plan are committed; fixture audio/runner/model/defaults remain unchanged.


## 2026-10-08 — B2 failed ASR input cleanup (chrome iteration 1/20)

Related commit: `fix: close selected-video input after ASR failure`, containing
this report. B2 is the next unfinished item; B2–B6 remain unchecked. No default
model, stage/framework completion or iPhone support is selected or claimed.

Read the supplied instructions, plan, architecture and Chrome evidence. No root
or nested AGENTS.md was found. Requested independent runner evidence
`.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt` is absent.
All local logs below live in ignored `.ralph/media-framework/`. Only synthetic
fixture metrics are recorded here; no user audio/transcripts or model files enter
the commit.

### Actual change and preserved acceptance

The existing live document owns the selected-video input handle. Its ASR-error
catch exposed `liveError` without explicitly closing that handle. Returning the
recognizer's wrapping async iterator can wait behind a pending capture read,
allowing a further raw packet after the error snapshot. The catch now awaits the
owned handle's real `close()` before publishing failure. This detaches capture
and resolves its pending read; existing idempotent cleanup preserves original
video playback. No snapshot delay or assertion is added. This fixture composes
actual production input/normalization/VAD/ASR; it is not the unfinished B4 app.

Two independent before-fix browser failures establish the regression:

| Same existing sustained turbo command | Actual result |
| --- | --- |
| `chrome-20261008-restart-1-baseline.log`, unchanged source/bundle | FAIL, exit 1: English GPU-loss detach **1,448 != 1,447 raw chunks** after the existing 200 ms observation. English recovery and final remote/page-error assertions not reached. |
| `chrome-20261008-restart-1-final-live.log`, experimental short-pause guard | FAIL, exit 1: Japanese GPU-loss detach **1,663 != 1,662 raw chunks**. Both recovered sustained quality runs not reached. |

Both run `caffeinate -disu npm run test:framework:chrome:live:sustained:gpu-recovery:turbo`
once. No identical third attempt followed these failures. Inspection identified
the missing ownership cleanup; the next invocation follows that specific change.
All original harness cases, assertions, PCM/error/meaning/latency/queue/visibility/
playback/cache/epoch gates and the exact detach observation window are unchanged.
No new evaluation mode or acceptance script is introduced.

### Sustained Japanese hypothesis rejected

The initial target was the retained Japanese missing future-time anchor. The
previous 23,296 ms cut followed seven inactive VAD frames with probabilities
0.176–0.493, then sustained onset, despite a preceding confident pause having
only one isolated active frame. Simply restoring 500 ms pauses would be smaller,
but previous quiet-input qualification needed short pauses to avoid forced cuts.
An experimental guard instead required 64 ms continuously below 0.05 somewhere
in a short pause, preserving exact PCM and ordinary/boolean-only policies.

- FAIL before that experiment: `node --import tsx --test --test-name-pattern='short learned boundaries require' tests/framework-browser-speech.test.ts`,
  exit 1, `chrome-20261008-restart-1-regression-before.log`: uncertain frames split
  at **11,328 ms**, against the proposed one-job **16,000 ms** behavior.
- PASS with the experimental guard: `node --import tsx --test tests/framework-browser-vad.test.ts tests/framework-browser-speech.test.ts tests/framework-browser-normalize.test.ts`,
  exit 0, **29 passed / 0 failed/skipped/cancelled / 315.208916 ms**,
  `chrome-20261008-restart-1-ports.log`. Fake detector/executor checks cover weak
  pauses, isolated confident frames, confidence reset, sustained confidence and
  exact PCM/accounting. These establish proposed segmentation, not accuracy.

Fresh unchanged-source baseline Japanese recovery already FAILS meaning and
latency: **2,008,405 normalized samples / 125,525.3125 ms**, document runtime
**126,810.800 ms**, **20 jobs / 19 capture overlaps**, **45/720 = 6.25% CER**.
Meeting/negation occur **17**, tomorrow/afternoon **16**, remaining anchors **18**
rather than all 18. One endpoint is **2,085.800 ms**, above strict <2,000 ms.
An unrelated four-character phrase occurs in the **77,664–79,744 ms** job and is
neither relabeled accurate nor filtered. Peak pending **16,735.375 ms**, normal
loss/final pending zero, cached recovery remote requests zero. This confirms the
retained quality concern; generated/live input is not assumed byte-identical.

After fixing input cleanup, the same turbo command completes all ten rounds:
`chrome-20261008-restart-1-closed-live.log`, **FAIL, exit 1**, once, **29 ports**,
**13,727 actual WASM VAD frames / 34 actual FP16 WebGPU ASR calls**, including
two interrupted jobs. Page errors and native visibility events are `[]`.
Both GPU-loss detach, explicit discarded duration, no interrupted revision,
unprepared retry and same-host/session/target fresh-epoch cached recovery checks
PASS. First five scored rounds preserve all once/three-times meanings and error/
latency gates. These lifecycle passes do not override the Japanese quality FAIL.

| Experimental recovered input | Japanese / 18 periods | English / 19 periods |
| --- | ---: | ---: |
| Normalized samples / duration ms | 2,008,405 / 125,525.3125 | 2,027,520 / 126,720 |
| Error | **111/720 = 15.416667% CER** | 19/418 = 4.545455% WER |
| Every meaning count | **16 — FAIL** | 19 — PASS |
| Jobs / nonfinal capture overlaps | 8 / 7 | 10 / 9 |
| Endpoint-to-text ms | **1,631.700–2,156.100 — FAIL** | 1,503.500–1,888.500 — PASS |
| Final packet-to-text ms | 1,634.000 | 1,504.300 |
| Peak pending / normal loss / final pending ms | 22,111.375 / 0 / 0 | 15,220.6875 / 0 / 0 |

The guard worsened aggregate Japanese meaning preservation and latency, so it
and its proposed-policy unit test are **rejected and reverted**. Recognizer and
speech test bytes exactly match HEAD; every pre-existing acceptance fixture and
regression stays intact. The only retained code change is the error-path input
close. Earlier noise/quiet successes remain historical, not rerun or upgraded to
sustained passes. No default selection or quality-fix claim follows this result.

### Environment and model evidence

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, Python **3.12.15**. Same pinned turbo
`onnx-community/whisper-large-v3-turbo@360ebcde2559d60bb474678be3c1de9ef347d01a`
(**seven files / 1,621,338,971 bytes**) and Silero
`onnx-community/silero-vad@e71cae966052b992a7eca6b17738916ce0eca4ec`
(**one file / 2,243,022 bytes**), existing locked Transformers.js **4.3.0**/ORT and
registry hashes unchanged. Corrected sustained run: **16 pinned/redirect paths /
16 requests**, first Prepare **166,896.912417 ms**, cached Prepare
**2,482.029041–3,559.174083 ms**. Preparation is not recognition latency.

Original decoded sustained periods still match prior qualification: Japanese
**334,667 samples / 62849952bbacc0aef37547d98da09920ed70a8afa5f3f7ebf9004f1a5ccd3886**,
English **319,991 / 0d6a8683900044ef06ced7717b879e05d4eeb772e611fce41cc389447ea6b856**.
New MediaRecorder outputs and actual captured jobs are not claimed identical.
Corrected-run initial owned-tree RSS **1,455,120 KiB**, max post-prepare case peak
**5,173,792 KiB**. Sampling includes shared-page double counting and browser/GPU/
allocator/harness/model residency; preparation peak is unqualified. These are
footprint diagnostics, not GPU allocation, pressure/storage/leak/mobile/thermal
measurements. Capture/submission/text share the document clock; preparation/RSS
use Node and VAD inference its own worker clock, without cross-clock subtraction.

### Required verification

- PASS on final restored production/test sources and retained fixture close:
  `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-1-restored-verify.log`: Biome **117 files / 93 ms / no
  findings**, Ruff, typecheck, unchanged companion **28 main / 10 content modules**,
  **116 JS passed / 0 failed/skipped/cancelled / 21,879.875167 ms**, **222 Python
  passed / 66.89 s**. Later source changes only finish Markdown evidence.
- Earlier experimental `caffeinate -disu npm run verify` runs both PASS, exit 0:
  `chrome-20261008-restart-1-verify.log` (**117 JS / 21,765.325167 ms; 222 Python /
  66.89 s**) and `chrome-20261008-restart-1-final-verify.log` (**117 JS /
  21,787.832 ms; 222 Python / 66.86 s**). Their extra experimental unit test was
  not an accuracy pass and is reverted with the rejected guard.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-1-stage-acceptance.log`: missing full Chrome script.
  No placeholder or substituted ASR/lifecycle pass. Full selected-video PCM →
  ASR → Korean translation → DOM remains unfinished B3–B5 work.
- PASS: targeted Biome on the experimental sources/fixture (**three files / 19 ms /
  no findings**), extracted fixture module `node --check`, whitespace; exit 0.
  Final fixture syntax/scope/whitespace are checked again before commit.

Final restored-source bounded GPU regression and preservation/Git checks follow.


### Final-source bounded GPU regression

PASS: `caffeinate -disu npm run test:framework:chrome:live:gpu-recovery`, **exit 0**,
once, `chrome-20261008-restart-1-restored-gpu.log`: typecheck, **28 original ports /
0 failed/skipped/cancelled / 262.336417 ms**, browser build, **ten rounds / 4,077
actual WASM VAD frames / 13 actual FP16 WebGPU ASR calls**, including two interrupted
jobs. Failures, page errors and native visibility events are `[]`. This runs the
final restored recognizer with the retained input close; no new mode/candidate.

The existing command explicitly selects registered small FP16
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`
(**seven files / 487,960,440 bytes**) plus the same Silero VAD; it is a separate
candidate check, not a silent turbo fallback or default selection. Registry
hashes/dependencies are unchanged, **16 pinned/redirect paths / 16 requests**,
first Prepare **56,611.069084 ms**, cached **1,217.838916–1,320.502333 ms**.
Initial owned-tree RSS **1,440,320 KiB**, max post-prepare case peak **4,464,496 KiB**,
with the same sampling/footprint limitations above. This is loading/cancellation
and bounded synthetic ASR evidence, not memory pressure or ten-minute acceptance.

| Actual GPU-loss/recovery | Japanese | English |
| --- | ---: | ---: |
| Loss raw / normalized samples | 727,040 / 242,346 | 557,056 / 185,675 |
| Interrupted exact-PCM job ms | 64–14,752 | 64–11,168 |
| Explicit discarded / final pending ms | 15,082 / 0 | 11,540.6875 / 0 |
| Detached raw chunks, stable after 200 ms | 355 | 272 |
| Recovery normalized samples / duration ms | 335,872 / 20,992 | 320,853 / 20,053.3125 |
| Recovery CER / WER | 3/120 = 2.5% | 3/66 = 4.545455% |
| Every recovered meaning count | 3 | 3 |
| Final packet-to-text ms | 1,036.000 | 840.800 |

Both real GPU losses publish no interrupted revision, detach input, clear bounded
queues and preserve both original videos' playback/settings. Unprepared retries
return `gpu-lost`, retain **6,400 bytes**, create zero workers/revisions. Explicit
cached Prepare alone creates two fresh workers on the same ASR/VAD hosts,
session/target at epoch **1**, with zero remote requests during loss/recovery.
Recovery jobs are contiguous exact unfiltered selected PCM: Japanese
**64–11,840–20,992 ms**, English **32–11,200–20,053.3125 ms**. Normal loss/final
pending zero, complete VAD coverage, <=20-second segments, input isolation/time
mapping and original playback/detach gates pass. Original VAD-only Stop separately
retains zero ASR calls and **831.375 ms** explicit discarded audio.

Five original scored rounds also pass: Japanese **1/40, 1/40, 3/120 CER**, English
**1/22, 3/66 WER**, every meaning once/three times, final packet **801.600–1,041.600
ms**, zero normal loss and drained queues. This is bounded recovery; it does not
requalify unchanged turbo/sustained accuracy, active user Stop, offline full
interpretation, Korean translation or caption DOM. Those claims cannot follow
from model loading, PCM acquisition or lifecycle success.

An initial local summary read requested the sustained-only `hostDurationMs` field
from a bounded round and raised `KeyError`; the corrected read of existing JSON
passes, with no browser/model rerun or changed acceptance result.

### Remaining work and final preservation

Next unfinished **B2** remains the sustained Japanese future-time/negation/
repetition and endpoint failures, including the unreferenced phrase. The attempted
short-pause confidence policy is rejected, not selected. Qualify a successful
alternative against the unchanged original fixtures, then complete natural/quiet/
no-pause/noise, overload, ten-minute acquisition, pressure/storage and licensing
before selecting a default. The newly fixed cleanup race no longer prevents the
corrected runs from reaching recovery, but it does not establish ASR quality.

Full Chrome acceptance still FAILS (missing script); B2–B6 remain unchecked.
Translation/source-revision pairing/DOM, full offline interpretation, standalone
installation and Safari/iPhone remain unverified. No required environment/device/
permission is absent; incomplete implementation and rejected qualification do
not warrant a blocked or complete marker.

Only this worktree changes. Published companion v0.1.0/install/native messaging/
server/user settings, unrelated files/apps/recordings/mounted images and all
prior stage checkboxes are preserved. No agents, runner edits, stage advance,
push/publish/app installation or blocked browser/profile/permission bypass.
Owned test browsers/profiles/recorders alone are cleaned up; models/media/
credentials/user data/ignored temporary state stay out of the commit. Final
syntax, append-only evidence, unchanged production/tests/acceptance, staged scope/
whitespace and post-commit cleanliness are checked before delivery.


Final preservation checks PASS, exit 0: exact three-file scope; report/plan
append-only; every prior checkbox unchanged; recognizer/speech tests fully
restored; original live harness, runner, package/lock and architecture bytes
unchanged. Explicit assertions on recorded final JSON verify ten rounds,
4,077 VAD frames/13 real ASR calls, both loss counts/accounting and scored
fresh-epoch cached recoveries without another inference run. Final fixture
Biome **one file / 27 ms / no findings**, extracted module `node --check` and
unstaged `git diff --check` PASS. Only fixture cleanup/report/plan are staged;
staged scope/whitespace and post-commit clean status are checked at delivery.


## 2026-10-08 — B2 exact live jobs and endpoint phases (chrome iteration 2/20)

Related commit: `test: trace sustained browser ASR endpoints`, containing this
report. B2 is the next unfinished item; B2–B6 remain unchecked and no default
model is selected. Root/nested AGENTS.md and the requested independent runner file
`.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt` are absent.
The supplied instructions, plan, architecture and existing Chrome evidence apply.
All local logs cited below are ignored `.ralph/media-framework/` state.

### Retained implementation and observable verification

The existing live fixture now digests each exact ASR job's PCM before the host
transfers it. SHA-256 computation runs alongside inference and is awaited during
settlement, including cancelled/GPU-destroyed jobs. The existing exact-input
comparison still proves that these are unfiltered normalized selected-video
samples. The harness requires a valid digest for every invocation.

Sustained scored runs now report each endpoint's audio range/digest, submission
wait, document invocation duration, result dispatch and original endpoint-to-text
latency. All times use the same document clock. Added assertions require finite,
nonnegative phases that sum to the original latency within 0.001 ms. The original
strict <2,000 ms gate still uses the full endpoint-to-text latency; the invocation
phase cannot replace it. Invocation time includes fixture snapshot/hash initiation,
host transport and inference; dispatch includes digest settlement and iterator/
event-loop delivery. Neither is isolated GPU time. Preparation/RSS/worker clocks
remain separate. No new mode, model, command, reference, fixture audio, production
policy, user setting or acceptance exemption is added.

### Rejected boundary hypothesis

The retained iteration-19 VAD trace has three <0.05 frames in a pause, one isolated
active frame, then an uncertain pause inside the future-time phrase. A proposed
policy retained a pause with 64 ms below 0.05 through isolated hits, while keeping
160 ms sustained onset confirmation and exact PCM. Restoring 500 ms pauses is
simpler, but prior quiet-input qualification had already rejected forced cuts.
This new retention hypothesis is also **rejected**, rather than selected.

- FAIL before the experiment: `node --import tsx --test
  --test-name-pattern='a confident learned pause survives'
  tests/framework-browser-speech.test.ts`, one failing test, expected proposed
  **11,232 ms** boundary versus actual **11,520 ms**;
  `chrome-20261008-restart-2-regression-before.log`. The shell's subsequent log
  display returned 0; it does not turn the failing Node check into a pass.
- PASS with the experiment: `node --import tsx --test
  tests/framework-browser-vad.test.ts tests/framework-browser-speech.test.ts
  tests/framework-browser-normalize.test.ts`, exit 0, **29/29 / 278.567667 ms**,
  `chrome-20261008-restart-2-ports.log`. Fake executor/detector evidence only.
- PASS: recorded-probability replay, exit 0,
  `chrome-20261008-restart-2-trace-replay.log`: **3,924 / 3,923** frames from the
  iteration-19/prior-baseline traces. Synthetic constant PCM/fake executor show
  changed boundaries, including earlier cuts; this is not real recognition or
  proof that retention improves accuracy.
- FAIL: `caffeinate -disu npm run
  test:framework:chrome:live:sustained:gpu-recovery:turbo`, exit 1, once with the
  experiment, `chrome-20261008-restart-2-live.log`: **ten rounds / 13,672 actual
  WASM VAD frames / 37 actual FP16 WebGPU ASR calls**, including two interrupted
  calls. Both lifecycle/recovery paths and five original short scored rounds
  pass. Japanese recovery produces **79/720 = 10.972222% CER**, meeting/negation/
  tomorrow/afternoon/station **20** each rather than **18**; reservation/cancellation
  **18**. Ten endpoints **1,268.7–2,214.6 ms**, three >=2,000 ms, peak pending
  **16,863.375 ms**. English **19/418 WER**, all meanings **19**, ten endpoints
  **1,686.6–1,922.8 ms**, peak pending **15,220.6875 ms**. Normal loss/final pending
  zero, page errors/visibility events `[]`, 16 remote artifact requests, cached
  recovery requests zero. This does not reclassify any prior failed fixture.

The recognizer and its regression file are restored byte-for-byte to HEAD.
The proposed test is removed with its rejected policy; all original tests remain.
Fresh generated/live captures are not assumed identical to historical jobs.
The retained diagnostics are qualified separately on restored production sources
below; there is no third invocation of the rejected policy.

### Required repository checks

- PASS on retained final executable sources: `caffeinate -disu npm run verify`,
  exit 0, `chrome-20261008-restart-2-final-verify.log`: Biome **117 files / 75 ms /
  no findings**, Ruff/typecheck, unchanged companion **28 main / 10 content
  modules**, **116 JS / 0 failed/skipped/cancelled / 22,831.038917 ms**, **222 Python /
  66.87 s**, Python **3.12.15**. Later fixture edit only clarifies a comment.
- Earlier experimental verify PASS, exit 0,
  `chrome-20261008-restart-2-verify.log`: **117 JS / 21,525.54425 ms**, **222 Python /
  66.87 s**, Biome **117 files / 51 ms**. Its extra experimental regression is
  reverted; this pass does not qualify recognition.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-2-stage-acceptance.log`: missing full Chrome script.
  No placeholder or ASR-only substitute for selected-video → Korean captions.
- PASS: harness/extracted fixture `node --check`, two-file Biome (**28 ms / no
  findings**), preliminary whitespace and explicit preservation of every original
  harness case/assertion plus recognizer/tests/package/lock/runner/architecture,
  exit 0. Final evidence and Git checks follow.


### Actual final-source browser evidence

FAIL: the same `caffeinate -disu npm run
test:framework:chrome:live:sustained:gpu-recovery:turbo` command on restored
production sources and retained diagnostics, exit 1, once,
`chrome-20261008-restart-2-final-live.log`. Typecheck, **28 original ports /
279.572625 ms**, build and **all ten rounds** execute; **13,770 actual WASM VAD
frames / 37 actual FP16 WebGPU ASR calls**, including two interrupted GPU jobs.
All 37 pre-transfer PCM digests and all 20 sustained endpoint phase observations
PASS their new assertions. Phase residuals are exactly **0 ms** in both languages.
The unchanged aggregate quality assertion fails with exactly four categories:
Japanese three-period CER/meaning count and sustained meaning count/endpoint latency.
Page errors and every round's native visibility events are `[]`.

| Final actual recognition | Japanese / 3 periods | Japanese recovery / 18 periods | English recovery / 19 periods |
| --- | ---: | ---: | ---: |
| Normalized samples / duration ms | 335,189 / 20,949.3125 | 2,009,088 / 125,568 | 2,027,520 / 126,720 |
| Error | **26/120 = 21.666667% CER — FAIL** | 73/720 = 10.138889% CER | 19/418 = 4.545455% WER |
| Meeting/negation/tomorrow/afternoon/station count | **4, expected 3 — FAIL** | **20, expected 18 — FAIL** | All four English anchors **19 — PASS** |
| Reservation/cancellation count | 3 | 18 | Included above |
| Jobs / nonfinal capture overlaps | 2 / original overlap gate PASS | 10 / 9 | 10 / 9 |
| Endpoint-to-text ms | Sustained-only field not applicable | **1,612.6–2,147.0 — FAIL**, three >=2,000 | 1,474.6–1,893.4 — PASS |
| Final packet-to-text ms | 1,300.0 | 1,614.2 | 1,475.9 |
| Peak pending / normal loss / final pending ms | 17,023.375 / 0 / 0 | 16,095.375 / 0 / 0 | 15,220.6875 / 0 / 0 |

Other original scored rounds PASS: Japanese once/restarted once **1/40 CER**,
English once **1/22 WER**, English three periods **3/66 WER**, all respective
anchors once/three times. The final failed Japanese short round's first job
**0–14,720 ms**, digest
`1b58385dd39bb801cb02d2f3a75f63fc585abf7a82fae4e982c4fd3891dc650b`,
invocation **2,021.6 ms**; second **14,720–20,949.3125 ms**, digest
`4db36618375ef3c9740e2cb1cfbac2eae1da1f47e68e16b9472e1f2fc202bd89`.
These identify exact synthetic captured jobs; no causal attribution follows from
comparing separate generated/live captures.

The failed sustained Japanese endpoints now have complete shared-clock accounting:

| Job ms | Submission wait ms | Invocation ms | Result dispatch ms | Full endpoint ms |
| --- | ---: | ---: | ---: | ---: |
| 64–11,808 | 256.7 | 1,755.6 | 0 | **2,012.3** |
| 56,608–70,528 | 258.3 | 1,878.2 | 0 | **2,136.5** |
| 98,432–112,352 | 299.4 | 1,847.6 | 0 | **2,147.0** |

Corresponding exact PCM digests, in row order:
`9680fa065858789f81e079cf35a716dc7cfcbe61be0f84e594a14709e8b583af`,
`6a1be40cd9a730874dc09902ae708e97ef5db8d6b2424d8d4a8137ac55b83073`,
`ca7fa5c04491380024dae4a9177aee44e72009a853c21f43716985e338f368b2`.
Every original job is still exact unfiltered selected PCM, contiguous and <=20 s;
VAD coverage, isolation/time mapping, original playback/settings, bounded queues,
zero normal loss/drained queues and completion detach all PASS. GPU losses occur
at **63,914.625 / 61,781.3125 ms** normalized acquisition with five jobs each;
interrupted jobs publish no revision. Both detach observations, explicit discarded
**14,314 / 13,716.6875 ms**, rejected unprepared retry, same-host/session/target
fresh-epoch explicit cached recovery and zero recovery remote requests PASS.
Original VAD-only Stop has zero ASR calls and **863.375 ms** discarded audio.
These passes do not qualify Japanese accuracy or full interpretation.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83
arm64**, Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, Python **3.12.15**.
Same pinned turbo **360ebcde2559d60bb474678be3c1de9ef347d01a**, seven files /
**1,621,338,971 bytes**, same Silero **e71cae966052b992a7eca6b17738916ce0eca4ec**,
one file / **2,243,022 bytes**, locked Transformers.js **4.3.0**; registry/
checksums/dependencies unchanged. Final **16 pinned/redirect paths / 16 requests**,
first Prepare **166,731.1815 ms**, nine cached **2,236.303334–3,484.784208 ms**.
Initial owned-tree RSS **1,448,720 KiB**, maximum post-prepare case peak
**5,073,568 KiB**. RSS includes shared-page double counting, browser/GPU/allocator/
model/harness/media residency; preparation peak, isolated allocation, pressure,
storage, leak freedom, mobile and thermal behavior are unqualified.

Original source period hashes still match prior qualification: Japanese
**334,667 samples / 62849952bbacc0aef37547d98da09920ed70a8afa5f3f7ebf9004f1a5ccd3886**;
English **319,991 / 0d6a8683900044ef06ced7717b879e05d4eeb772e611fce41cc389447ea6b856**.
Final generated Japanese **2,191,142 bytes /
a657f73b02952dead8e4fff65ceefd0df9561ca1c13065013303fc3ed914f12c**;
English **2,193,135 /
17378a4e5d1376ab39483faa4a6cb4b02b847d35358a4f435d5d60cb2eb87043**.
These ignored test media files' actual hashes/sizes are independently checked,
exit 0; neither recordings nor model weights enter the commit. Separate restored
and experimental captures are not asserted byte-identical. The restored run also
has extra Japanese repetitions, so retention is not established as their cause.

PASS: explicit Python assertions over final JSON, exit 0,
`chrome-20261008-restart-2-final-summary.json`: ten rounds, all 37 job digests,
20 range/hash/phase associations, original latency equality, ordered finite
phases/zero residual, original normal loss/drain/cached-recovery and page/visibility
evidence. This analysis is not another inference invocation or a quality pass.

### Remaining B2 work and preservation

Next B2: resolve Japanese extra/missing meaning and late endpoints using these
exact job identities and clock phases, then qualify the unchanged original cases
and remaining natural/quiet/no-pause/noise, overload, ten-minute acquisition,
pressure/storage and licensing requirements before choosing a default. The
historical missing future-time/unreferenced-phrase failures are not relabeled or
removed. No third same-policy browser invocation follows the failed hypothesis.

UNVERIFIED: full Chrome acceptance (missing command), Korean translation/revision
pairing/DOM, offline complete interpretation, standalone installation, B3–B6 and
Safari/iPhone. Earlier noise/quiet/offline/active-ASR keyboard Stop results remain
historical; those commands are not rerun after this fixture instrumentation.
No required environment/device/permission is absent; qualification failures and
unfinished implementation warrant neither blocked nor complete status. No
checklist item or stage/whole-framework/iPhone completion is claimed.

Only the existing live harness/fixture and append-only report/plan are committed.
Companion v0.1.0/install/native messaging/server/user settings, original production
and regression sources, commands/dependencies/runner/architecture, all previous
checkboxes and unrelated files/apps/recordings/mounted images are preserved.
No agents, new stage, push/publish/app installation or browser/profile/permission
bypass. Owned test browser/profile/recorders alone are cleaned up. Model weights,
credentials, user audio/transcripts and temporary ignored state stay out of Git.
Final syntax, lint, whitespace, append-only scope and Git checks follow.


Final preservation checks PASS, exit 0: exact four-file staged scope, staged
whitespace, append-only report/plan and every prior checkbox unchanged; original
production/regression/package/lock/runner/architecture bytes preserved. Final
harness and extracted fixture syntax, two-file Biome (**21 ms / no findings**)
and document-inclusive unstaged whitespace PASS. Only diagnostics/report/plan
are staged; model/media/profile/credential/user/ignored temporary state is
excluded. The final staged whitespace and post-commit clean status are checked
at delivery. No checklist is checked on these diagnostic passes.


## 2026-10-08 — B2 rejected short-pause start boundary (chrome iteration 3/20)

Related commit: `docs: record rejected browser ASR pause boundary`, containing
this report. B2 remains the next unfinished item; B2–B6 remain unchecked and no
default model is selected. Root/nested AGENTS.md and requested independent runner
file `.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt`
are absent. Supplied instructions, plan, architecture and prior Chrome evidence
were read. Evidence below is ignored local `.ralph/media-framework/` state.

### Implemented hypothesis, regression and rejection

Assumption tested: a short inactive interval after ten seconds can include a
word onset that learned VAD admits late. Moving the cut to the start of that
interval might keep the word in one ASR job. This is a smaller change than a new
model or decoding policy. The experimental recognizer changed only the position
of cuts for qualifying pauses shorter than 500 ms; the five-frame short-pause
threshold, five-frame onset confirmation, ordinary-pause midpoint, first-result
confidence rule, exact PCM, 20-second segment and 30-second pending bounds stayed.

A new regression supplied a marked, detector-delayed onset in a 224 ms pause.
Two existing short-pause tests' expected boundary positions were adjusted to the
experimental rule; all their exact-sample, EOF, frame-coverage and loss assertions
remained. This is simulated segmentation evidence, not labeled recognition.

- FAIL before implementation: `node --import tsx --test
  --test-name-pattern='a late short learned pause keeps'
  tests/framework-browser-speech.test.ts`, exit 1, one failing test,
  **11,200 ms actual versus 11,072 ms proposed cut**;
  `chrome-20261008-restart-3-regression-before.log`.
- PASS with experiment: `node --import tsx --test
  tests/framework-browser-vad.test.ts tests/framework-browser-speech.test.ts
  tests/framework-browser-normalize.test.ts`, exit 0, **29/29 / 283.427375 ms**,
  `chrome-20261008-restart-3-ports.log`. Fake executor/detector only.
- PASS: targeted two-file Biome (**8 ms / no findings**) and experimental
  whitespace, exit 0. Neither establishes recognition quality.

The real sustained run below FAILS both languages' endpoint gates and Japanese
meaning count. The hypothesis is **rejected**. Recognizer and regression file,
including both changed expectations and the added test, are restored byte-for-byte
to HEAD. No policy, test, fixture, acceptance exemption or diagnostic code is
retained. No second invocation of this rejected policy or unchanged baseline is
made; separate generated/live captures are not assumed identical or causal proof.

### Actual browser qualification — FAIL

`caffeinate -disu npm run
 test:framework:chrome:live:sustained:gpu-recovery:turbo`, exit 1, once,
`chrome-20261008-restart-3-live.log`: typecheck, **29 experimental port tests /
311.132458 ms**, browser build, **ten rounds / 13,987 actual WASM VAD frames /
47 actual FP16 WebGPU ASR calls**, including two interrupted GPU jobs. Exactly
three aggregate failures: Japanese recovered meaning count, Japanese recovered
endpoint latency and English recovered endpoint latency. Page errors and all
native visibility-event arrays are `[]`.

| Sustained recovered input | Japanese, 18 periods | English, 19 periods |
| --- | ---: | ---: |
| Normalized samples / duration ms | 2,008,405 / 125,525.3125 | 2,027,520 / 126,720 |
| Error | 56/720 = 7.777778% CER | 19/418 = 4.545455% WER |
| Meanings | **Station 19 instead of 18 — FAIL**; other six 18 | All four anchors 19 — PASS |
| Jobs / nonfinal capture overlaps | 19 / 18 | 10 / 9 |
| Full endpoint-to-text ms | **1,136.1–2,241.8 — FAIL**, one >=2,000 | **1,512.6–2,035.2 — FAIL**, three >=2,000 |
| Final packet-to-text ms | 1,137.7 | 1,516.7 |
| Peak pending / normal loss / final pending ms | 16,788.6875 / 0 / 0 | 15,359.375 / 0 / 0 |

The failed Japanese first endpoint is exact PCM **64–14,624 ms**, SHA-256
`8f55c3e7adf41de7e2501816cfb2daa30f26197f84ffc5f05f54d516545ed57d`.
Shared-document-clock phases are **388.2 ms submission wait + 1,853.6 ms invocation
+ 0 ms dispatch = 2,241.8 ms full latency**. Failed English endpoints are
**2,029.0 / 2,035.2 / 2,013.7 ms**. The original strict full-endpoint gate remains;
invocation time cannot replace it. All 47 pre-transfer digests and all 29
sustained endpoint range/hash/phase associations are recorded in the original
harness output and extracted `chrome-20261008-restart-3-summary.json`.

Five original scored short rounds PASS: Japanese **1/40, 1/40, 3/120 CER**,
English **1/22, 3/66 WER**, every meaning once/three times, final-packet latency
**1,348.6–1,482.3 ms**. Exact unfiltered normalized selected PCM, input isolation,
time mapping, original playback/settings, contiguous <=20-second jobs, complete
VAD coverage, queue bounds, zero normal loss/drain and detach assertions PASS.
Those observations do not qualify the failed sustained meanings/endpoints.

Both real GPU-loss paths PASS cancellation/detach and preserve playback. Their
interrupted jobs publish no revision; discarded audio is explicit:
Japanese **14,431.375 ms**, English **13,812.6875 ms**, final pending zero.
Unprepared retries return `gpu-lost`, keep **6,400 bytes**, create zero workers.
Explicit cached Prepare creates fresh workers on the same host/session/target,
recovered epoch 1 and zero recovery remote requests. Original VAD-only Stop
returns `cancelled`, retains zero ASR calls and **863.375 ms** discarded audio.
This is controlled lifecycle evidence, not active user Stop during ASR, natural
pressure or full offline interpretation.

Environment: owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**,
Node **v24.15.0**, npm **11.12.1**, uv **0.12.23**, Python **3.12.15**. Unchanged
pinned turbo `360ebcde2559d60bb474678be3c1de9ef347d01a`, seven files /
**1,621,338,971 bytes**; Silero `e71cae966052b992a7eca6b17738916ce0eca4ec`, one
file / **2,243,022 bytes**; locked Transformers.js **4.3.0**. No new weights or
candidate. **16 pinned/redirect paths / 16 requests**, first Prepare
**160,132.855458 ms**, cached **2,288.391375–3,447.485916 ms**. Initial owned-tree
RSS **1,428,624 KiB**, maximum case peak **4,821,360 KiB**. RSS includes shared
pages, allocator, browser/GPU/model/media/harness residency; it does not qualify
isolated allocation, preparation peak, memory pressure, leaks or mobile behavior.

Source period hashes remain the prior Japanese/English hashes recorded above.
Actual generated media sizes/hashes independently PASS: Japanese **2,191,142
bytes / 925cf163699829695c8a28ed27caf755f4936666f856aeff3bd0eefb02e7aeff**;
English **2,193,135 bytes /
a3a0db9d766d9fbaf6f1e58eda7e89de3724604e9a78b05f491ec0c1f73df9a4**.
Python assertions over the captured JSON PASS all 47 digest formats, scored exact
PCM/zero final loss/drain/visibility, and 29 endpoint phase sums within 0.001 ms.
This analysis is not another inference run or an accuracy pass. Synthetic media,
model weights and temporary logs remain excluded from Git.

### Required checks on restored final sources

- PASS: `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-3-final-verify.log`: Biome **117 files / 61 ms /
  no findings**, Ruff/typecheck/unchanged companion build, **116 JS /
  22,047.025917 ms / 0 failed/skipped/cancelled**, **222 Python / 66.92 s**.
- Earlier experimental `caffeinate -disu npm run verify` also PASS, exit 0,
  `chrome-20261008-restart-3-verify.log`: Biome **117 files / 48 ms**,
  **117 JS / 21,239.95575 ms**, **222 Python / 66.83 s**. Its extra regression
  and proposed policy are reverted; this pass does not qualify recognition.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-3-stage-acceptance.log`: missing full-stage script.
  No placeholder, weakened gate or ASR-only substitute is added.

Next unfinished B2: a successful alternative must resolve Japanese extra/missing
meanings and the full endpoint gates on unchanged original fixtures. Exact-job
replay would help distinguish capture/segmentation from decoding variability;
the current hashes alone cannot reproduce PCM or establish causality. Remaining
natural/quiet/no-pause/noise, overload, ten-minute acquisition, pressure/storage
and licensing qualification must precede default selection. Historical failed
future-time/unreferenced-phrase cases remain failed/unqualified.

UNVERIFIED: full Chrome selected-video → ASR → Korean translation → DOM,
source/translation pairing, complete offline interpretation and installation;
B3–B6 and Safari/iPhone. No environment/device/permission is absent. This is a
rejected implementation hypothesis and unfinished qualification, not an external
blocker or stage completion. No checkbox or completion marker is justified.

Only this report and the append-only plan progress entry are retained. Companion
v0.1.0/install/native messaging/server/settings, executable sources, regression
fixtures/gates, dependencies, runner, architecture and all prior checkboxes are
preserved. No agents, stage advance, push/publish/app installation, access/profile
bypass or user-app/recording/mounted-image changes. Owned test browser/profile/
recorders alone are cleaned up by the existing harness. Final append-only scope,
whitespace, staged exclusion and post-commit clean state are checked at delivery.


Final preservation checks PASS, exit 0: exactly report/plan changed; both are
append-only; every existing checkbox unchanged; recognizer/regressions restored
byte-for-byte and runner/package/lock/architecture unchanged. Document-inclusive
`git diff --check` PASS. Only those two documentation files are staged, and staged
scope/whitespace plus post-commit cleanliness are verified before delivery.


## 2026-10-08 — B2 exact captured-job replay (chrome iteration 4/20)

Related commit: `test: replay exact browser ASR jobs`, containing this report.
B2 remains next unfinished; B2–B6 stay unchecked and no default is selected.
Repository AGENTS.md and the requested independent runner file
`.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt` are absent.
Supplied instructions, plan, architecture and prior Chrome evidence apply.
Evidence paths below are ignored local `.ralph/media-framework/` state.

### Implementation and observable criterion

Assumption: historical hashes identify jobs but cannot reproduce their PCM.
Before another segmentation/decoding change, preserve the actual failing input
and establish whether its text repeats with fresh workers. The smaller change
extends the existing live harness and fixture; production recognition is unchanged.

After each scored capture settles and detaches, reconstruct its jobs from the
already retained normalized synthetic selected-video PCM. Check every byte count
and SHA-256 against the actual pre-transfer job digest, then save Float32 LE,
16 kHz mono files and a manifest containing pinned model, fixture hash, identity,
range, original text and original invocation/endpoint observations. These files
remain outside Git. No regenerated, filtered, trimmed or decoded replacement
samples enter replay; expected text is used only for scoring.

Normal completion stops the executor. An explicit Enter press on the existing
Prepare button creates fresh cached workers after all live measurements. Require
cached readiness, pinned identity and zero remote requests. Replay each
Japanese multi-period job once through the production executor, checking digest,
actual buffer transfer, identity/range/language/revision and finite timing.
Compare text and apply the original CER/meaning gates to the combined replay.
Every original live case, source line and assertion remains in order; live
failures cannot be replaced by replay passes. Full endpoint latency retains its
strict <2,000 ms gate. Replay timing has no capture, VAD execution or segmentation
wait, and cannot qualify that gate or complete interpretation.

### Commands and failures

- FAIL/INTERRUPTED: first `caffeinate -disu npm run
  test:framework:chrome:live:sustained:gpu-recovery:turbo`, exit 1,
  `chrome-20261008-restart-4-live.log`. Static lifecycle review found the replay
  setup incorrectly assumed normal completion retained a ready executor. The
  owned browser alone (PID 28731, verified direct child of owned harness 28730)
  was stopped with SIGTERM during preparation. Harness cleanup completed;
  `page.waitForFunction: Target page, context or browser has been closed` is the
  intentional interruption, with **zero live rounds/ASR calls**. Its **28 ports /
  254.05975 ms** and generated media do not establish accuracy or a blocker.
  Added explicit cached Prepare; no production teardown change or access bypass.
- FAIL: corrected same command, exit 1, once,
  `chrome-20261008-restart-4-final-live.log`: typecheck, **28 original focused
  ports / 270.89775 ms**, build and all **ten live rounds** complete. **13,764
  actual WASM VAD frames / 36 actual FP16 WebGPU ASR calls**, including two
  interrupted GPU jobs; **11 additional real replay calls**. Exactly three
  aggregate failures: sustained Japanese meaning count, sustained Japanese full
  endpoint latency, and reproduction of the meaning failure in replay. No third
  invocation or rejected-policy experiment follows.
- PASS: `python3 .ralph/media-framework/chrome-20261008-restart-4-analyze.py`,
  exit 0, `chrome-20261008-restart-4-analysis.log` and
  `chrome-20261008-restart-4-summary.json`:
  actual generated-media hashes/sizes; **26 archived jobs / 20,076,536 PCM bytes**;
  all archived hashes/ranges/text versus captured originals; **19 original
  endpoint phase associations/sums**; all replay-file/identity/transfer/text
  comparisons. This analysis is not another inference or an accuracy pass.
- PASS: earlier `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-4-verify.log`: Biome **117 files / 41 ms**, Ruff,
  typecheck/build, **116 JS / 21,553.665959 ms**, **222 Python / 66.89 s**.
  This precedes the corrected replay Prepare setup; final-source verification
  is recorded below.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-4-stage-acceptance.log`: missing full-stage script.
  No placeholder or ASR-only substitute is added.
- PASS: harness/extracted fixture `node --check`, final two-file Biome
  **10 ms / no findings**, whitespace and explicit preservation of every
  original harness/fixture source line and assertion (except the observation
  initializer's additional fields), exit 0. No temporary state is tracked.

### Actual live and exact replay results

The archive is `.ralph/media-framework/chrome-live-jobs-jHFVhY/`, including
`manifest.json`, per-job `.f32` and per-round replay JSON. All **11/11 replay
texts exactly match originals**, including the failed sustained output. Fresh
cached Prepare takes **3,173.517417 ms**, with **zero remote requests**; each
replay also has zero remote requests. This demonstrates reproduction of this
failure on the same PCM; it does not isolate segmentation versus decoding as
its cause or reproduce historical jobs whose PCM was not retained.

| Scored input | Japanese / 3 periods | Japanese recovery / 18 periods | English recovery / 19 periods |
| --- | ---: | ---: | ---: |
| Live error | 3/120 = 2.5% CER | 82/720 = 11.388889% CER | 19/418 = 4.545455% WER |
| Live meanings | All seven 3 — PASS | Meeting/negation/tomorrow/afternoon/station **20/18 — FAIL**; reservation/cancellation 18 | All four 19 — PASS |
| Jobs / nonfinal capture overlaps | 2 / original overlap PASS | 9 / 8 | 10 / 9 |
| Full endpoint range ms | Sustained-only field | **1,604.5–2,187.0 — FAIL** | 1,486.4–1,908.3 — PASS |
| Last packet to text ms | 1,451.0 | 1,607.2 | 1,493.9 |
| Peak pending / normal loss / final pending ms | 13,716.6875 / 0 / 0 | 16,906 / 0 / 0 | 15,188.6875 / 0 / 0 |
| Replay jobs / identical texts | 2 / 2 | 9 / 9 | Not replayed |
| Replay CER / meaning counts | Original 2.5% / all 3 — PASS | Original 11.388889% / five **20/18 — FAIL** | Not replayed |
| Replay worker inference ms | 1,533.0–1,742.6 | 1,550.0–1,819.0 | Not measured |
| Replay document round trip ms | 1,536.1–1,747.4 | 1,552.1–1,821.3 | Not measured |

Worker durations use their own clock; replay document round trips start after
archive/base64 decoding and digest initiation, encompass the production executor,
and use one document clock. They are separate from original full endpoints.
The three failed live endpoint phases remain:

| Original job ms | Submission wait ms | Invocation ms | Dispatch ms | Full endpoint ms |
| --- | ---: | ---: | ---: | ---: |
| 32–14,720 | 256.6 | 1,930.4 | 0 | **2,187.0** |
| 14,720–28,640 | 300.2 | 1,832.3 | 0 | **2,132.5** |
| 70,496–84,416 | 299.8 | 1,846.4 | 0 | **2,146.2** |

`round-7-job-2.f32` and `round-7-job-6.f32` each return three meeting/tomorrow/
station anchors and two reservation anchors, identically in original and replay.
Their exact digests are respectively
`9832bc0f279335df6e7e38580e89e99abd138320ff7e243a57cc45ab8027e151` and
`71dff3bc24f8304f5da4804996dfb42e2762edcc53eebcbcde7a5a54fafd9b5c`.
The first late job digest is
`bac07ec284d01e9b942ac8ff23a712a6fc0f066519a59f76cefbf7240f99f710`.
Original endpoint/range/hash/phase observations are also in the archive manifest;
shorter replay invocation durations do not turn any live endpoint into a pass.

Other short scored rounds PASS: Japanese **1/40 CER** twice and English
**1/22 WER** once, all meanings once; English three periods **3/66 WER**,
all meanings three times. Five short final-packet latencies are **1,345–1,601.5
ms**. Actual unfiltered normalized selected PCM, isolation tags, time mapping,
original playback/settings, contiguous <=20-second jobs, complete VAD coverage,
<=30-second queues, zero normal loss/drain and detach checks PASS. Japanese/
English recovery supplies **2,008,405 / 2,027,520 samples**, acquisition
**125,525.3125 / 126,720 ms**, document runs **127,131.9 / 128,211.8 ms**.

Both real GPU-loss paths PASS after **63,907.5 / 61,761.1 ms** document runs,
five jobs each; interrupted work publishes no revision. Discarded audio is
**14,303.375 / 13,706 ms**, pending zero. Unprepared retries retain 6,400 bytes,
return `gpu-lost`, create zero workers. Explicit same-host/session/target cached
recovery creates fresh workers/epoch 1 with zero remote requests. Original
VAD-only Stop PASS, with zero ASR calls. These are controlled lifecycle checks,
not natural GPU pressure, active-ASR user Stop or full offline interpretation.

### Environment, remaining scope and preservation

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, Python **3.12.15**. Same pinned
turbo **360ebcde2559d60bb474678be3c1de9ef347d01a**, seven files /
**1,621,338,971 bytes**; Silero **e71cae966052b992a7eca6b17738916ce0eca4ec**,
one file / **2,243,022 bytes**; locked Transformers.js **4.3.0**. No new
candidate, weight revision, decoding or dependency policy. **16 pinned/redirect paths /
16 remote requests**, first Prepare **169,274.188792 ms**, nine cached
**2,366.434083–3,963.245417 ms**. Initial owned-tree RSS **1,428,752 KiB**,
maximum post-prepare case peak **5,060,624 KiB**. RSS includes browser/GPU/shared
pages/allocator/model/media/harness and possible archive allocation residency;
isolated allocation, preparation peak, memory pressure/leaks and mobile behavior
are unqualified. Replay has no separate memory qualification.

Source period hashes remain the previously recorded originals. Corrected generated
Japanese **2,191,142 bytes / ef377d070573e6fcca70367dfa55d56dc21de40a3c3bab66c099858232e8600a**;
English **2,193,135 bytes / fa435cf8febdc3882284a132c49eaca1b1ddbb00a88fa1e51af99013e4e65f50**.
Separate generated captures are not asserted byte-identical; archived/replayed
jobs are actually hash-verified identical. Models/media/profiles/logs stay ignored.

Next unfinished B2: resolve the reproduced Japanese extra meanings, starting
with the exact job-2/job-6 bytes, and the unchanged full endpoint gates. Qualify
remaining original/natural/quiet/no-pause/noise, overload, ten-minute acquisition,
pressure/storage and licensing requirements before selecting a default. Historical
missing-time/unreferenced-phrase failures remain failed/unqualified. Prior noise,
quiet, offline and active-ASR Stop suites were not rerun by this diagnostic work.

UNVERIFIED: full Chrome selected-video → ASR → Korean translation → DOM,
source/translation pairing, full offline interpretation, standalone installation,
B3–B6 and Safari/iPhone. No required environment/device/permission is absent;
these are reproducible qualification failures and unfinished implementation.
No checkbox or stage/whole-framework/iPhone completion is claimed.

Only the existing harness/fixture and append-only report/plan are retained.
Production/regression/model/fixture-audio/dependency/runner/architecture bytes,
companion v0.1.0/install/native messaging/server/user settings, all prior
checkboxes and unrelated files/apps/recordings/mounted images are preserved.
No agents, other stage, push/publish/app installation or access/profile/permission
bypass. Only owned test browsers/profiles/recorders are cleaned up. Credentials,
weights, user audio/transcripts and temporary `.ralph` state stay out of Git.
Final-source verification and Git preservation checks follow below.


Final-source verification PASS: `caffeinate -disu npm run verify`, exit 0,
`chrome-20261008-restart-4-final-verify.log`: Biome **117 files / 56 ms /
no findings**, Ruff/typecheck, unchanged companion **28 main / 10 content
modules**, **116 JS / 22,150.513125 ms / 0 failed/skipped/cancelled**,
**222 Python / 66.95 s**. Diagnostic replay is verified on the retained final
executable sources; quality/full-stage failures above remain failures.

Final preservation checks PASS, exit 0: exactly harness/fixture/report/plan
changed; report/plan append-only; every prior checkbox and original harness/
fixture source line/assertion preserved (observation initializer extended).
Production/regression/model registry/audio fixtures/package/lock/runner/
architecture and companion/settings are unchanged. Document-inclusive whitespace,
final two-file Biome, harness/extracted fixture syntax, staged whitelist and
staged whitespace pass. Temporary model/media/profile/credential/user/`.ralph`
state is excluded. Commit and post-commit clean status are checked at delivery.


## 2026-10-08 — B2 identical-input FP16 candidate comparison (chrome iteration 5/20)

Related commit: `test: compare browser ASR on identical captured jobs`, containing
this report. B2 remains the next unfinished item; B2–B6 remain unchecked and no
default is selected. Root/nested AGENTS.md and the requested independent runner
file `.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt`
are absent. Reviewed the supplied instructions, selected-stage plan, architecture
and prior Chrome evidence, including iteration 4's exact captured-job failure.
All evidence paths below are ignored local `.ralph/media-framework/` state.

### Implementation and observable criterion

Assumption: changing candidates might preserve meanings that turbo duplicates
on these exact jobs. The smaller diagnostic compares existing pinned candidates
before changing production decoding/segmentation or repeating full live capture.
Added `tests/framework-chrome-replay.mjs` and `test:framework:chrome:replay`.
The command requires an explicit synthetic live-job archive, validates its format,
original pinned model, both fixture hashes/references, every job byte count/hash,
finite bounded PCM, identity/range and contiguous <=20-second jobs before build
or browser launch. It compares small FP16 and turbo FP16 on **every archived run**,
two trials each, with a fresh production worker per trial and trusted Prepare.
The second preparation must be cached with zero remote requests. Every inference
must transfer the verified original bytes, preserve revision metadata and make
zero remote requests. Expected speech is used only for scoring, never inference.

The existing <=20% CER/WER and exact meaning-count gates apply to both candidates
and all seven archived rounds. Failed candidates/rounds remain in the aggregate
failure exit. No existing live/candidate/noise/quiet/endpoint acceptance, sentence,
fixture audio, production model/decoder/segmentation/default or user setting
changes. Replay has no acquisition, VAD/segmentation wait, translation or display;
its timings cannot qualify the original strict full-endpoint <2,000 ms gate.
The historical endpoint observations remain unchanged in replay job records.

### Exact commands and results

- FAIL: `caffeinate -disu npm run test:framework:chrome:replay --
  .ralph/media-framework/chrome-live-jobs-jHFVhY`, exit 1, once,
  `chrome-20261008-restart-5-replay.log`: typecheck/build, **four fresh workers /
  104 actual FP16 WebGPU ASR calls**, all seven original archived rounds per
  candidate/trial. Exactly two aggregate failures: turbo Japanese round 7
  meaning counts, once in each trial. All other accuracy/meaning, byte/transfer,
  revision, fresh-worker/cache/network/visibility assertions PASS. No third
  comparison invocation. This failure is retained, not relabeled a full pass.
- PASS: inline Python assertions over captured JSON, exit 0,
  `chrome-20261008-restart-5-analysis.log` and
  `chrome-20261008-restart-5-summary.json`: **104/104** digest/transfer/identity/
  range associations, unchanged original endpoint observations, **26/26 identical
  texts between fresh-worker trials per candidate**, exactly the two retained
  failures. Analysis is not another inference or an accuracy pass.
- PASS: explicit corruption guard, Python parent exit 0,
  `chrome-20261008-restart-5-integrity-guard.log`: a one-byte change in a separate
  temporary synthetic archive is rejected by the child with exit 1/actual hash
  mismatch before build/browser/inference. The original archive is untouched;
  only this owned temporary copy is removed.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-5-stage-acceptance.log`: missing full-stage script.
  No placeholder, weaker gate or ASR replay substitute is added.
- PASS: new harness `node --check`, targeted Biome **one file / 5 ms / no
  findings**, exit 0; JSON assertions confirm every existing package command,
  dependency and field unchanged, with only the new replay command added.
  Final repository verification and preservation checks follow below.

### Identical-input recognition evidence

Unchanged iteration-4 archive: `chrome-live-jobs-jHFVhY/`, **26 jobs /
20,076,536 Float32 LE PCM bytes**, 16 kHz mono. Manifest SHA-256:
`507fb85e56e5482568ed8ebed8a9f29c500a574871b4e23468d8c5f808413b2d`.
Archived selected-video acquisition was real in iteration 4; **no new selected-
video capture or VAD inference** is performed here. Both trials reproduce the
following scores exactly:

| Archived input | Small FP16, each trial | Turbo FP16, each trial |
| --- | ---: | ---: |
| Japanese one period, rounds 0/2 | 1/40 = 2.5% CER; all anchors once | 1/40 = 2.5% CER; all anchors once |
| Japanese three periods | 3/120 = 2.5% CER; all anchors three | 3/120 = 2.5% CER; all anchors three |
| Japanese recovered 18 periods, nine jobs | **21/720 = 2.916667% CER; all seven anchors 18 — PASS** | **82/720 = 11.388889% CER; five anchors 20 — FAIL**, reservation/cancellation 18 |
| English once / three / recovered 19 periods | 1/22, 3/66, 19/418 = 4.545455% WER; all four anchors 1/3/19 | Same errors and anchor counts — PASS |

Japanese `round-7-job-2.f32` and `round-7-job-6.f32` return **two** meeting/
tomorrow/station anchors with small versus **three** with turbo, each with two
reservation/cancellation anchors, in both trials. Their digests remain
`9832bc0f279335df6e7e38580e89e99abd138320ff7e243a57cc45ab8027e151` and
`71dff3bc24f8304f5da4804996dfb42e2762edcc53eebcbcde7a5a54fafd9b5c`.
Turbo **26/26 texts in each trial** exactly equal archived originals, including
the failed Japanese output. Small differs on every Japanese multi-period job;
its overall anchors pass without deleting/replacing any input or output phrase.
This establishes a candidate-dependent output difference on identical PCM under
the unchanged FP16 timestamp-decoding policy. It does not establish that all
historical live boundary/noise failures are solved, or isolate every cause.

| Recovered archived jobs | Small trial 1 / 2, ms | Turbo trial 1 / 2, ms |
| --- | ---: | ---: |
| Japanese worker inference | 1,266.3–1,385.7 / 1,262.7–1,372.1 | 1,552.4–1,812.7 / 1,549.2–1,787.1 |
| Japanese document round trip | 1,268.3–1,387.8 / 1,264.8–1,373.9 | 1,554.4–1,814.7 / 1,551.2–1,788.9 |
| English worker inference | 936.2–1,150.8 / 898.2–1,149.9 | 1,391.9–1,536.7 / 1,379.2–1,550.1 |
| English document round trip | 937.7–1,152.8 / 899.8–1,151.7 | 1,397.1–1,538.6 / 1,380.7–1,551.9 |

Worker durations use their own clock. Document round trips start after archive/
base64 decoding and digest initiation, include production executor/transfer and
use one document clock. Neither includes live segmentation/submission waits;
no cross-clock subtraction or projected live latency pass is claimed. Prior
Japanese live endpoints **2,187 / 2,132.5 / 2,146.2 ms remain FAIL**.

### Environment, preparation, memory and remaining work

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, locked Transformers.js **4.3.0**.
No new candidate, dependency or weight revision. Small
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
files / **487,960,440 bytes**; turbo
`onnx-community/whisper-large-v3-turbo@360ebcde2559d60bb474678be3c1de9ef347d01a`,
seven files / **1,621,338,971 bytes**. Original registry inventory/checksums are
used. Fresh owned-profile downloads: **14 requests each / 28 total**; remote
paths are limited to pinned artifacts/redirects. Inference and second cached
preparations each have **zero remote requests**. First/cached Prepare:
small **56,674.836291 / 1,221.903708 ms**, turbo
**164,750.979167 / 3,013.058792 ms**. Preparation is not recognition latency.
Page errors and native visibility-event arrays are `[]`.

Initial owned-tree RSS **1,297,552 KiB**. Trial peak RSS (250 ms sampling):
small **3,951,008 / 4,369,424 KiB**, turbo **5,666,672 / 5,585,104 KiB**.
Sampling includes preparation and replay, but does not ensure the true peak is
caught. Values include shared-page double counting, allocator/browser/GPU/model/
archive-copy residency, and sequential candidate/trial effects. They are process
footprint diagnostics, not isolated model allocation, memory pressure/storage,
leak freedom or mobile/thermal qualification.

Next B2: requalify the promising small FP16 result against the unchanged **live
sustained** and **louder-noise** failures and full endpoint gate, then remaining
original/natural/quiet/no-pause/overload/ten-minute/storage/pressure and licensing
requirements before selecting a default. Historical missing future-time and
unreferenced-phrase failures are preserved. No original live/noise/quiet/offline/
active-ASR Stop or GPU-loss suite is rerun by this replay-only iteration.

UNVERIFIED: full Chrome selected-video PCM → ASR → Korean translation → DOM,
source/translation revision pairing, complete offline interpretation, standalone
installation, B3–B6 and Safari/iPhone. No required environment/device/permission
is absent; these are qualification failures and unfinished implementation, so
neither blocked nor stage/whole-framework/iPhone completion is claimed.

Only the new comparison harness/command and append-only report/plan are retained.
Production, all existing regressions/harnesses/fixture audio, runner, dependency
lock/architecture, companion v0.1.0/install/native messaging/server/user settings,
prior checkboxes and unrelated files/apps/recordings/mounted images are preserved.
No agents, stage advance, push/publish/app installation or browser/profile/access
bypass. Only owned test workers/browser/profile and corruption-copy cleanup;
credentials, weights, user audio/transcripts and temporary `.ralph` state stay out
of Git. Final verification and preservation evidence follows below.


Final-source `caffeinate -disu npm run verify` PASS, exit 0,
`chrome-20261008-restart-5-verify.log`: Biome **118 files / 55 ms / no findings**,
Ruff/typecheck, unchanged companion **28 main / 10 content modules**, **116 JS /
21,573.570208 ms / 0 failed/skipped/cancelled**, **222 Python / 66.93 s**.
Replay quality and missing full-stage command failures remain failures.

Final preservation checks PASS: report/plan append-only relative to original
HEAD; every prior checkbox unchanged; only new harness/replay command and those
two documents changed; every existing package command/dependency/field preserved.
Actual original archive bytes independently sum to **20,076,536**; all turbo
outputs match originals (26/26 each trial), small has 14/26 original text matches
and passes all archived meaning gates. Production, old tests/harnesses/fixtures,
lock/runner/architecture/companion/settings untouched. Syntax, targeted lint,
document-inclusive whitespace and staged whitelist/exclusion/whitespace checked
before commit. Commit and post-commit clean status are checked at delivery.


## 2026-10-08 — B2 small FP16 live/noise requalification (chrome iteration 6/20)

Related commit: `docs: record live browser ASR candidate rejection`, containing
this report. B2 remains next unfinished; B2–B6 stay unchecked, with no default
selected. Repository AGENTS.md and the requested independent runner evidence
`.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt` are absent.
Reviewed the supplied instructions, plan, architecture and retained Chrome evidence.

Assumption tested: iteration 5's passing small FP16 exact-job replay might also
satisfy the original live sustained and louder-noise gates. The smaller next step
is to execute those existing commands on current production code before changing
segmentation/decoding or choosing a default. That assumption is rejected below.
Only this report and the plan progress log change; no production, harness,
fixture, model/default, dependency, acceptance or user-setting change is retained.
Evaluation is partial B2 progress, not completion or a transcription fix.

### Exact commands and acceptance results

All evidence paths below are ignored local `.ralph/media-framework/` state.
Each browser command ran once, sequentially, without a concurrent model test.

- FAIL: `caffeinate -disu npm run test:framework:chrome:live:sustained:learned`,
  exit 1, `chrome-20261008-restart-6-small-live.log`: typecheck, **28 port tests /
  266.118 ms**, eight live rounds, **9,846 actual WASM VAD frames / 33 actual
  FP16 WebGPU ASR calls**, then **18 actual exact-job replay calls**. Exactly two
  aggregate failures: Japanese 18-period live meaning counts and their identical
  replay meaning counts. All remaining original gates passed, including English
  sustained recognition, short rounds, every full endpoint, PCM acquisition,
  isolation/time mapping/playback preservation, coverage/queue/loss/drain/detach,
  pinned model/cache, visibility and page errors. No second live invocation.
- FAIL: `caffeinate -disu npm run test:framework:chrome:noise:learned`, exit 1,
  `chrome-20261008-restart-6-small-noise.log`: typecheck, **23 port tests /
  257.162042 ms**, all ten original cases, **4,066 actual WASM VAD frames / 12
  actual FP16 WebGPU ASR calls**, then two cached offline ASR calls. Sole
  aggregate failure: Japanese louder-noise meaning counts. All other original
  assertions passed. No second noise invocation or weakened acceptance.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-6-stage-acceptance.log`: missing full-stage script.
  No placeholder or ASR-only substitute added.
- PASS: `caffeinate -disu npm run verify`, exit 0,
  `chrome-20261008-restart-6-verify.log`: Biome **118 files / 54 ms / no findings**,
  Ruff/typecheck, unchanged companion **28 main / 10 content modules**, **116 JS /
  21,024.014292 ms / 0 failed/skipped/cancelled**, **222 Python / 66.93 s**.
- PASS: inline Python live archive/result assertions, exit 0,
  `chrome-20261008-restart-6-live-analysis.log` and `...-live-summary.json`:
  **33 jobs / 20,082,004 bytes**, every actual byte count/hash/bounded PCM/range,
  exact-input flag, original endpoint phase sum and normal loss/drain association.
  **18/18 replay texts equal originals**, with zero replay remote requests.
- PASS: final `uv run --locked python` noise/result analysis, exit 0,
  `chrome-20261008-restart-6-noise-analysis.log` and `...-noise-summary.json`:
  all ten cases, original failure retained, exact jobs, complete queues/drain,
  no-speech rejection, latency and offline results. Analysis is not another
  inference or an accuracy pass. Four earlier analysis invocations failed:
  system Python lacked `zip(strict=...)`; the invocation hash field is
  `pcmSha256`, not `inputSha256`; historical English louder-noise score and
  job-range equality assertions were false. Corrected analysis records those
  differences instead of assuming identical segmentation/output across versions.

### Live recognition and exact failure evidence

| Scored input | Error | Meaning counts | Jobs / overlapping nonfinal jobs | Full endpoint range ms | Peak pending / loss / final pending ms |
| --- | --- | --- | --- | --- | --- |
| Japanese 18 periods | **31/720 = 4.305556% CER** | **Negation 19/18, reservation 16/18 — FAIL**; other five anchors 18 | 16 / 15 | **909–1,731.2 — PASS** | 13,290 / 0 / 0 |
| English 19 periods | **19/418 = 4.545455% WER** | All four anchors 19 — PASS | 10 / 9 | **1,093–1,460.3 — PASS** | 14,836.6875 / 0 / 0 |

Japanese/English actual normalized selected-video input: **2,009,088 / 2,027,520
samples**, **125,568 / 126,720 ms**; document runs **126,596.5 / 127,815.3 ms**.
Last-packet-to-text: **1,035.3 / 1,094.9 ms**. Every job is contiguous and
<=20 seconds; normal loss/drain and capture overlap pass. This is two minutes,
not ten minutes, with synthetic speech rather than natural speaker qualification.
Japanese one-period rounds score **1/40 CER**, English **1/22 WER**; three-period
rounds **3/120 CER / 3/66 WER**, all original meanings at their expected counts.
Their final-packet latencies are **780.3–1,010.9 ms**. VAD-only Stop/restart
passes with no ASR call in the stopped round; active-ASR Stop/GPU loss were not
rerun by this selected mode.

Archive: `chrome-live-jobs-fsSZ3n/`, manifest SHA-256
`d5ee81df396d4349bbafcc2858a80cb37333455bd06b72f6728ee80761723d6e`.
All 16 sustained Japanese archived jobs replay exactly with the same failed
scores/counts. `round-6-job-4.f32`, range **25,600–36,000 ms**, digest
`6e52d6adc5095cd356fbaa96c270905c68a4b7c526bfdf86936331a51be1e74b`,
contains two decoded cancellation mentions but zero reservation anchors; the
synthetic reservation word is substituted twice. The following job,
`round-6-job-5.f32`, **36,000–42,752 ms**, digest
`984d61a4794b666e057cd674d3e8b6e1b0f5a64d1023f41acca57956659d5b1b`,
begins with a duplicated negation fragment. These are observed text/range
associations, not proof that changing that boundary solves recognition.
Fresh cached replay Prepare **1,329.70825 ms**, zero remote requests; preparation
and replay invocation timing do not replace original live endpoint measurements.

### Original noise and offline evidence

All six noise-only cases (quiet/white/hum for both languages) have zero active
VAD frames, zero ASR calls and no fabricated speech. Japanese quiet-noise speech
**3/120 = 2.5% CER**, all anchors three; louder noise **9/120 = 7.5% CER**, meeting
**2/3**, station **1/3**, all other anchors three — FAIL. English both speech
cases **3/66 = 4.545455% WER**, every anchor three — PASS. Endpoint ranges:
Japanese quiet **870.8–1,484.3 ms**, louder **839.3–1,449.4 ms**; English quiet
**680.1–1,229.7 ms**, louder **707.7–1,283.8 ms**. Original <=20% error and exact
meaning gates stay intact; aggregate error alone cannot qualify these meanings.
SNR Japanese/English louder **7.709260 / 8.633690 dB**. Seeded white noise is
synthetic, not a natural-noise qualification. Pending <=9,300 ms, zero normal
loss and final pending zero.

Compared with retained `chrome-20261008-13-noise-offline.log`, **10/10 complete
mixed-input hashes match**, as do **9/10 case job hashes/ranges** and all meaning
counts. Japanese louder-noise inputs/jobs/scores/failed meanings match exactly.
English louder-noise jobs/ranges differ and WER changes from **4/66 to 3/66**;
no identical-input-job or causal improvement claim is made for that case.
Two fresh-worker cached offline ASR jobs pass: Japanese **1/40 CER**, English
**1/22 WER**, all meanings once, worker times **863.4 / 738.4 ms**, document round
trips **864.5 / 739.3 ms**, transferred buffers detached and zero remote requests.
Actual cached VAD/noise control and VAD cancellation pass. These are short
synthetic decoded-file recognitions, not offline live interpretation/translation.

### Environment, preservation and next unfinished work

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, project Python **3.12.15**; locked
Transformers.js **4.3.0**. Same pinned small
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
files / **487,960,440 bytes**, and Silero
`e71cae966052b992a7eca6b17738916ce0eca4ec`, one file / **2,243,022 bytes**.
Live **16 remote paths / 16 requests**; noise **16 remote paths**; only pinned
artifacts/redirects. Live initial/cached Prepare **57,374.806042 /
1,219.757833–1,424.973583 ms**; noise **64,521.969625 /
1,218.442917–1,221.92125 ms**. No new model or revision downloaded.
Live initial/peak owned-tree RSS **1,439,680 / 4,272,752 KiB**; noise
**1,248,736 / 3,999,776 KiB**. RSS is sampled every 250 ms and includes shared
pages/allocators/browser/GPU/model/archive; isolated allocation, pressure/leaks,
storage limits and mobile/thermal behavior remain unqualified.

Source period hashes remain the previously recorded originals. New ignored
Japanese generated video **2,190,176 bytes /
8425529e032a22fa77f1a8692bb766f9ab3ea03493ed9f33752811b2404db1ac**;
English **2,192,169 bytes /
70de442d5034444e7430535a1e45fe967a998f96350f3b55d9c3c024b9a5daf5**.
Fresh recordings/captures are not byte-identical to iteration 4, so its successful
small replay cannot predict this live job layout. Original historical small/turbo
failures remain failures; this run does not isolate their causes.

Next B2: correct the reproduced Japanese reservation/negation errors on the
retained exact jobs and preserve the original louder-noise meanings/endpoint
gates before choosing a default. Remaining natural/quiet/no-pause, overload,
ten-minute acquisition, storage/memory pressure and licensing qualification is
unfinished. Full Chrome PCM → ASR → Korean translation → DOM, pairing, offline
interpretation/standalone installation, B3–B6 and Safari/iPhone are UNVERIFIED.
No required environment/device/permission is absent; these are qualification
failures and unfinished implementation, with neither terminal marker warranted.
No unchanged failed suite is retried after this evidence.

Only append-only report/plan evidence is committed. Companion v0.1.0/install/
native messaging/server/user settings, every prior checkbox, production/tests/
fixtures/runner/architecture and unrelated files/apps/recordings/mounted images
are preserved. No agents, stage advance, push/publish/app installation or access/
profile/permission bypass. Only owned browser/profile/recorder resources were
cleaned up. No credentials, model weights, user audio/transcripts or temporary
`.ralph` state enter Git. Final scope/whitespace/staged exclusion, commit and
post-commit clean status are checked at delivery.

Final evidence-preservation checks PASS, exit 0: inline project-Python assertions
confirm exactly two append-only documents, all prior checkboxes unchanged, actual
live/noise/replay counts and historical hash comparisons consistent, and no
tracked `.ralph` state. `git diff --check` passes. Final executable sources are
unchanged from the successful verify and the failed real-browser qualifications;
no subsequent code edit requires another model run. Staged whitelist/whitespace
and clean post-commit status are verified at delivery.

## 2026-10-08 — B2 monotonic ASR timestamps (chrome iteration 7/20)

Related commit: `fix: constrain browser ASR timestamps`, containing this report.
B2 remains next unfinished; B2–B6 stay unchecked and no default is selected.
Repository AGENTS.md and the requested independent runner file
`.ralph/media-framework/2026-10-08T07-45-37-544Z-chrome-verification.txt` are absent.
Reviewed the supplied instructions, plan, architecture and Chrome evidence.

### Implemented rule and rejected accuracy hypothesis

Assumption: the missing monotonic timestamp rule in locked Transformers.js 4.3.0
might explain the retained Japanese errors. The smaller investigation uses both
existing exact-job archives before changing segmentation, downloading another
candidate or selecting a default. Installed
`src/generation/logits_process.js`'s `WhisperTimeStampLogitsProcessor` implements
pairing and timestamp probability rules but omits the forward-position mask in
[Whisper's reference decoder](https://github.com/openai/whisper/blob/main/whisper/decoding.py).
The reference permits a next segment start to equal the previous end, while
requiring segment ends to advance beyond their start.

Added a private worker-local SDK logits processor before the existing timestamp
processor for the two FP16 profiles. It masks earlier timestamp positions and
zero-length segment ends using the prepared model's timestamp token ID. It does
not suppress text repetitions, inject reference text, trim/change PCM, introduce
retries, change segment boundaries or alter the 256-token limit. q8 decoding stays
non-timestamped. No public contract, host API or dependency change is needed.

The new regression executes the actual unexported worker through the existing
Vite TypeScript transformer with fake preparation/inference and real SDK
processors/tensors. It checks forward/end/start constraints, available repeated
text/EOS tokens, row/sequence independence and unchanged q8 options. **This is
decoding-rule evidence, not real transcription accuracy.** The rule is retained
as a demonstrated decoding constraint repair; the real-input investigation below
**rejects it as an observed remedy for these transcription failures**. Generated
timestamp trajectories were not archived, so no claim is made that a real job
previously selected a backwards timestamp.

### Commands and exact outcomes

All evidence paths below are ignored local `.ralph/media-framework/` files.
Browser commands ran sequentially, once per distinct archive, without concurrent
model/repository tests. Each existing harness performs two fresh-worker trials
per candidate; no third trial/invocation or unchanged live failure retry.

- FAIL first: `node --import tsx --test tests/framework-browser-timestamps.test.ts`,
  `chrome-20261008-restart-7-timestamps-before.log`: **2 failed / 1 passed /
  1,744.558708 ms**; both FP16 inference calls lacked the monotonic processor.
  The enclosing shell also displayed the log and exited 0; that exit is not a
  regression pass. The Node child exit was not separately captured.
- PASS final: the same Node command, exit 0,
  `chrome-20261008-restart-7-timestamps-final.log`: **3 passed / 0 failed /
  333.125416 ms**, with zero skipped/cancelled. Initial numeric Tensor indexing
  produced **three TS7053 typecheck errors**; a trailing successful lint made
  that initial compound shell exit 0, not a typecheck pass. Switching to the
  public flat Tensor data/dimensions resolved them. Subsequent combined
  typecheck/regressions/two-file Biome command exits 0 (3 passed /
  **321.535584 ms**, lint **2 ms / no findings**).
- FAIL: `caffeinate -disu npm run test:framework:chrome:replay --
  .ralph/media-framework/chrome-live-jobs-fsSZ3n`, exit 1,
  `chrome-20261008-restart-7-replay.log`: **132 actual FP16 WebGPU ASR calls**,
  all eight archived rounds in all four trials. Exactly two failures: small
  Japanese 18-period meaning counts, one per trial. Turbo passes every archived
  gate here. Every other existing score/meaning/integrity/transport/revision/
  preparation/cache/network/visibility assertion passes.
- FAIL: `caffeinate -disu npm run test:framework:chrome:replay --
  .ralph/media-framework/chrome-live-jobs-jHFVhY`, exit 1,
  `chrome-20261008-restart-7-turbo-original-replay.log`: **104 actual WebGPU
  ASR calls**, all seven archived rounds in all four trials. Exactly two
  failures: turbo Japanese 18-period meaning counts, one per trial. Small passes
  every archived gate here. All other original assertions pass.
- PASS: `uv run --locked python
  .ralph/media-framework/chrome-20261008-restart-7-analyze.py`, exit 0,
  `chrome-20261008-restart-7-analysis.log` and `...-summary.json`: **236/236**
  original byte/hash/metadata/revision/transfer/timing associations; every
  candidate's texts identical between fresh trials on each archive. Actual
  archive bytes independently hashed, original files/observations unchanged.
- PASS: inline locked-project-Python historical comparison, exit 0,
  `chrome-20261008-restart-7-history-comparison.log`: **104/104** earlier-archive
  inputs and full revisions/texts equal iteration 5's pre-change comparison;
  same scores, meaning counts, model identities and aggregate failures. Analysis
  commands perform no inference and cannot convert failed accuracy into a pass.
- FAIL: required `npm run test:framework:chrome`, exit 1, once,
  `chrome-20261008-restart-7-stage-acceptance.log`: missing full-stage script.
  No placeholder, weaker gate or replay substitute is added.

Final repository verification and preservation evidence follows below.

### Recognition results on unchanged PCM

Both trials reproduce each score/count below. The <=20% CER/WER gate and exact
meaning-count gates remain unchanged; low aggregate error does not excuse
missing or duplicated meanings.

| Archive / sustained Japanese | Small FP16 | Turbo FP16 |
| --- | --- | --- |
| `fsSZ3n`, 16 jobs / 18 periods | **31/720 CER (4.305556%); negation 19/18, reservation 16/18 — FAIL**; other five anchors 18 | **24/720 CER (3.333333%); all seven anchors 18 — PASS** |
| `jHFVhY`, nine jobs / 18 periods | **21/720 CER (2.916667%); all seven anchors 18 — PASS** | **82/720 CER (11.388889%); five anchors 20/18 — FAIL**; reservation/cancellation 18 |

English 19-period input on both archives/candidates: **19/418 WER = 4.545455%**,
all four anchors 19, PASS. One-period Japanese/English: **1/40 CER / 1/22 WER**,
all meanings once, PASS. Three-period Japanese small **3/120 CER**, turbo
**6/120 CER** on `fsSZ3n` and **3/120 CER** on `jHFVhY`; all meanings three,
PASS. Three-period English **3/66 WER**, every meaning three, PASS.

Small `fsSZ3n` **33/33 texts per trial** equal its original captured outputs,
including the failed Japanese reservation/negation jobs. Turbo `jHFVhY`
**26/26 per trial** equal its original captured outputs, including the failed
duplicate meanings. The other candidate has **19/33 original text matches** on
`fsSZ3n` and **14/26** on `jHFVhY`. All `jHFVhY` outputs also exactly equal the
previous comparison, including small's cross-candidate differences. Thus the
archives still demonstrate candidate/input-dependent qualification, without a
measured before/after accuracy improvement from the timestamp constraint.

Unchanged archive inventory:

- `chrome-live-jobs-fsSZ3n/`: **33 jobs / 20,082,004 Float32 LE PCM bytes**,
  manifest SHA-256
  `d5ee81df396d4349bbafcc2858a80cb37333455bd06b72f6728ee80761723d6e`.
- `chrome-live-jobs-jHFVhY/`: **26 jobs / 20,076,536 bytes**, manifest SHA-256
  `507fb85e56e5482568ed8ebed8a9f29c500a574871b4e23468d8c5f808413b2d`.

Original selected-video acquisition happened in iterations 6 and 4 respectively.
This iteration performs **no new live capture or VAD inference**. Both languages
use the original 16 kHz mono bytes, with unchanged contiguous <=20-second job
ranges, references, fixture hashes and identity. Each buffer is actually
transferred/detached. No regeneration, filtering, substitutions or failed-case
deletion occurs.

| Japanese sustained replay | Worker range trial 1 / 2, ms | Document round trip trial 1 / 2, ms |
| --- | --- | --- |
| `fsSZ3n` small | 444.2–1,205.0 / 443.6–1,200.0 | 444.8–1,206.9 / 444.0–1,201.8 |
| `fsSZ3n` turbo | 986.3–1,580.4 / 1,000.7–1,581.0 | 986.7–1,581.8 / 1,001.3–1,582.5 |
| `jHFVhY` small | 1,255.0–1,354.8 / 1,260.5–1,359.4 | 1,257.0–1,357.1 / 1,262.7–1,361.3 |
| `jHFVhY` turbo | 1,541.6–1,803.1 / 1,543.4–1,792.4 | 1,544.1–1,805.1 / 1,545.2–1,794.7 |

Worker durations use the worker clock. Round trips start after archive decoding/
digest initiation and use one document clock; no clocks are directly subtracted.
These omit live acquisition, VAD, boundary/submission waits and preparation.
They cannot qualify full endpoint latency. Prior turbo Japanese live endpoints
**2,187 / 2,132.5 / 2,146.2 ms remain FAIL**; no live improvement is measured.

### Environment, residency and remaining work

Owned headed Chromium **153.0.8010.12**, macOS **26.6.2 / 25G83 arm64**, Node
**v24.15.0**, npm **11.12.1**, uv **0.12.23**, locked Transformers.js **4.3.0**.
No new candidate, weight revision or dependency. Same registered small
`onnx-community/whisper-small@36050c46d777d46dc4b5f43f6d90574fc38f8732`, seven
files / **487,960,440 bytes**, and turbo
`onnx-community/whisper-large-v3-turbo@360ebcde2559d60bb474678be3c1de9ef347d01a`,
seven files / **1,621,338,971 bytes**, with original pinned inventory/checksums.
Each fresh owned profile makes **28 remote requests / 28 paths** (14 per
candidate), only pinned artifacts/redirects. Every second cached Prepare and
every inference has **zero remote requests**. This online cached observation is
not a disconnected-browser/offline interpretation test. Page errors and native
visibility arrays are `[]` for both commands.

First/cached Prepare in milliseconds: `fsSZ3n` small
**53,370.614583 / 1,224.647250**, turbo **166,269.386250 / 3,015.415167**;
`jHFVhY` small **58,439.105083 / 1,221.134042**, turbo
**164,525.412917 / 3,026.312084**. These are preparation, not recognition times.

Initial owned-tree RSS: **1,291,520 / 1,288,256 KiB** for the two commands.
Trial peaks: `fsSZ3n` small **4,339,168 / 4,194,448 KiB**, turbo
**5,789,312 / 5,765,264 KiB**; `jHFVhY` small **4,876,400 / 4,665,376 KiB**,
turbo **5,742,288 / 5,881,008 KiB**. Existing 250 ms sampling includes shared
page double counting, browser/GPU/model/archive/allocator residency and sequential
trial effects, and can miss peaks. It is not isolated model memory, a leak test,
storage/memory-pressure qualification or mobile/thermal evidence.

Next B2: resolve the preserved Japanese errors with an actually passing candidate
and profile across both retained live job layouts and original louder-noise/full
endpoint gates. This rule repair does not establish that boundary changes or
another model will fix them. Original noise/quiet/no-pause/active-ASR Stop/GPU
loss/overload/live sustained suites were **not rerun** here. Natural speech,
ten-minute live acquisition, pressure/storage and licensing qualification remain
unfinished before default selection. Full Chrome PCM → ASR → Korean translation
→ DOM, revision pairing, offline interpretation, standalone installation, B3–B6
and Safari/iPhone are **UNVERIFIED**. No required environment/device/permission
is absent; these are remaining implementation and qualification failures, with
neither blocked nor stage/whole-framework/iPhone completion claimed.

Only this private worker fix, its focused regression and append-only report/plan
are intended for Git. Existing acceptance harnesses/fixtures, runner, dependencies,
architecture, companion v0.1.0/install/native messaging/server/user settings,
all prior checkboxes and unrelated resources stay unchanged. No agents, stage
advance, push/publish/app installation or access/profile/permission bypass.
Only owned test browser/profile resources are cleaned up; model weights, user
audio/transcripts, credentials and temporary `.ralph` state are excluded.

Final-source `caffeinate -disu npm run verify` PASS, exit 0,
`chrome-20261008-restart-7-verify.log`: Biome **119 files / 54 ms / no findings**,
Ruff/typecheck, unchanged companion **28 main / 10 content modules**, **119 JS /
21,365.304958 ms / 0 failed/skipped/cancelled**, **222 Python / 66.89 s**.
Final executable sources are those used in both real replay commands and this
verification. Replay semantic failures and missing full-stage command remain
FAIL; all previous checkboxes stay unchanged. Final targeted lint, document-
inclusive whitespace, four-file scope/append-only history/staged exclusion and
post-commit cleanliness are checked at delivery.

Final preservation assertions PASS, exit 0,
`chrome-20261008-restart-7-preservation.log`: exactly four intended files,
append-only report/plan, every prior checkbox unchanged, **236** validated replay
associations and both pairs of retained failures, no tracked `.ralph` state and
clean `git diff --check`. Final two-file Biome also PASS **2 ms / no findings**.
No executable edit followed the successful verify or browser runs. Staged
whitelist/exclusion/whitespace, commit and clean post-commit status are checked
at delivery.
