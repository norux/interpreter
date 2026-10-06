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
