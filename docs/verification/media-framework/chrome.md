# Chrome stage — B1 model preparation

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
