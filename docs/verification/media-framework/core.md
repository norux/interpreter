# Media framework core verification

## 2026-10-06 — core iteration 1/5 (C1)

Result: C1 contracts verified; Stage core incomplete and blocked on missing `uv`
for required project verification. C2–C5 remain unfinished. Commit: the
`feat: define media framework v1 contracts` commit containing this report.

### Implemented scope

`packages/contracts/index.ts` defines internal version 1 envelopes and ports:
opaque video/document/frame handles, session/epoch identity, sequenced PCM chunks
with explicit selected-video versus legacy tab-mix scope,
with capture clocks and audio ranges, playback anchors/events, independent source
and translation revisions, pending/paired captions, capability/reason/status,
model preparation states and runtime limits, presentation intents and renderer
progress. Media, combined interpretation, separate ASR/translation, model and
output ports depend only on ES2022 types.

The new contracts are not connected to the running extension yet. The existing
server Caption/PCM1 protocol, extension behavior, settings defaults/persistence,
published companion v0.1.0 and installation paths are unchanged. C4 will map the
existing atomic source/translation protocol in the companion bridge and report
`combined-interpretation` with `asrOnlyUpdates: false`. No local second VAD/ASR
pipeline was added. Type declarations are not runtime validation: incoming
envelopes, numeric bounds and exact source/translation pairing still need checking
when the live boundary/store is implemented in C2/C4.

`tsconfig.framework.json` compiles contracts and future core code with ES2022,
`types: []` and no DOM. Positive and negative type fixtures cover envelope versions,
opaque handles, mandatory epochs/clocks, independent revision fields, pending
translations, capability reasons and engine-defined confidence. The isolated
fixtures are excluded from the DOM-enabled extension config because their
negative ambient-type checks must fail there. No existing tests were excluded.
The dependency test checks the compiler's actual file graph and rejects adapter,
provider, Node ambient and DOM/WebWorker library dependencies.

`test:framework:core` currently checks C1 conformance and dependency isolation.
It must grow with C2–C4 lifecycle, epoch/revision/cancellation, queue and caption
policy regressions before C5 or the stage can be completed. Its present success
does not establish those unimplemented behaviors.

### Environment and exact evidence

Executed in the requested worktree on Darwin arm64; Node v24.15.0, npm 11.12.1,
TypeScript 7.0.2, Vite 8.3.2, Biome 2.5.15. Existing npm dependencies and Playwright
Chromium 153.0.8010.12 were used. No dependencies/models/apps were installed.
No root AGENTS.md, previous core report or requested independent runner
`2026-10-06T11-16-52-271Z-core-verification.txt` existed at iteration start.

| Command | Actual result | Evidence |
| --- | --- | --- |
| `npm run test:framework:core` | PASS, exit 0: standalone typecheck and 1 dependency test, 0 failures; final duration 76.439792 ms | `.ralph/media-framework/core-1-contracts.log`; committed type fixtures and dependency test |
| `npm run typecheck && npm run build && npm run test:js` | PASS, exit 0: extension types/build and 33 JS tests, 0 failures, 0 skipped; tests 14479.204 ms | `.ralph/media-framework/core-1-js.log` (tests); build output: 19 modules, 271 ms |
| `./node_modules/.bin/biome lint extension packages/contracts tests scripts/ralph-loop.mjs vite.config.ts` | PASS, exit 0: 52 files, no findings | Final CLI output, 19 ms |
| `npm run verify` | FAIL/BLOCKED, exit 127 in lint: Biome passed (52 files, 23 ms), then `sh: uv: command not found`; subsequent verify steps were not reached | `.ralph/media-framework/core-1-verify.log` |
| `npm run test:python` | FAIL/BLOCKED, exit 127: `uv run --locked pytest` then `sh: uv: command not found`; no Python tests executed | `.ralph/media-framework/core-1-python.log` |
| `npm run test:captions-correction-browser` | PASS, exit 0: Chromium 153.0.8010.12; 1000 ms cadence, immediate first/final, burst coalescing, latest revision, in-place updates, clear and replacement | `.ralph/media-framework/core-1-correction-browser.log` |
| `npm run test:transcript-browser` | PASS, exit 0: both comparison and runtime scripts passed; generated source/translation, time columns, correction cadence, safe text, history/eviction/reopen, stale rejection, Stop retention and real extension messaging/window | `.ralph/media-framework/core-1-transcript-browser.log`; generated UI JSON reported no page errors |
| `git diff --check` | PASS, exit 0, no whitespace errors | CLI output |

The transcript check regenerated the existing fixture images/JSON. All images
and `ui.json` matched their committed versions. Only the nondeterministic
`closedWindowId` in `runtime.json` changed; that file was restored to its original
version after reading the fresh evidence to preserve unrelated artifacts.

Initial implementation checks exposed two harness mistakes, both corrected:
the legacy TypeScript JS API is not exported by this installed TypeScript 7
package (`ts.sys.readFile` failed), and its standard libraries reside in the
platform compiler package rather than only `typescript/lib` (dependency check
rejected `lib.es5.d.ts`). Final checks use `tsc --listFilesOnly` and allow only
the compiler's standard-library directories, still rejecting browser libraries.

Logs under `.ralph` are local diagnostic state and are not committed. This report
records their results durably. No user audio, transcripts, credentials or model
weights were created or committed.

### Unverified scope and resume condition

Python lint/tests and therefore full `npm run verify` remain unverified. Two
independent required commands confirmed the same missing executable; no further
attempt at that blocker was made. Resume when `uv` is available in the runner's
PATH, provision the locked Python dependencies with `uv sync --locked`, then
rerun `npm run verify`. Do not replace it with partial JS success.

The next unfinished item is C2: session controller, bounded queue, timeline and
revision store, with browser-free lifecycle and late-event/Stop/Start/seek checks.
No actual selected-video PCM, ASR or translation accuracy, browser engine load,
Safari or physical iPhone test was performed. Browser regression fixtures here
are presentation/messaging checks only. Stage core completion is not claimed.
