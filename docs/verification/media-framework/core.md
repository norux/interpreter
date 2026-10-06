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

## 2026-10-06 — core iteration 1/5 (C2, resumed run)

Result: C2 implemented and verified. The earlier missing-`uv` blocker is resolved.
Stage core remains incomplete: C3–C5 are unchecked. Commit: the
`feat: implement media framework core lifecycle` commit containing this report.
The requested independent runner file
`.ralph/media-framework/2026-10-06T11-28-49-587Z-core-verification.txt` was absent.
No root AGENTS.md exists; the supplied standing instructions were followed.

### Implemented scope and ownership

`packages/core/session-controller.ts` composes typed media and engine ports.
Every Start owns a distinct engine, selected target and copied language settings.
Control cleanup is serialized; Stop invalidates the live generation synchronously
and closes the queue before awaiting cancel/input close/engine close. A late probe
or preparation cannot start input. A handle returned by a late input open is closed.
Cleanup is idempotent; a cancel failure still attempts input and engine closure and
reports failure. Closed predecessors cannot close a successor's engine.

Seek, rate/source changes, pause/resume and suspension advance the epoch before
canceling pending work, clear overlay intent and retain comparison history.
Reopening reprobes input/engine availability and prepares the new epoch.
Old-session/old-epoch events are rejected. Source/translation languages must match
the requested pair. The host supplies unique session IDs and session-owned engine
instances; adapters remain responsible for interrupting their owned operations
when canceled/closed. There is no new browser or model adapter in this iteration.

`audio-queue.ts` bounds pending sample duration and individual payload bytes using
the engine's declared limits, validates PCM frame size/duration and identity,
reports discarded milliseconds, and wakes a blocked consumer on close. Overload
and observed sample gaps invalidate interpretation context and pause processing
with a reason and loss total. An explicit play/resume revalidates and starts a fresh
epoch; no automatic retry loop or automatic video pause is used.

`timeline.ts` rejects stale sequences, gaps, changed capture-clock origins and
invalid anchors. It maps epoch-relative audio ranges through playback anchors only
when both have the same clock ID. It preserves fresh seek/rate anchors across epoch
advancement and leaves video time unknown when clocks cannot be compared.

`revision-store.ts` accepts increasing source and translation revisions separately,
invalidates translation pairing on source changes, preserves translation revision
and final watermarks through pending states, and rejects finalized-to-provisional
regression. Combined pairs validate both sides before mutating history. Exact
source revision, utterance, identity and language must match. Stored records are
bounded by the runtime profile; an eviction watermark prevents retired utterances
from returning without an unbounded tombstone list. C3 still owns the specific
300-utterance policy, cadence, replay and fade behavior.

Core imports only contracts/core and compiles with ES2022, `types: []`, no DOM,
Chrome, Node or model ambient types. The dependency acceptance now explicitly
requires all five core modules in the compiler's actual file graph. The core test
command includes the lifecycle/queue/timeline/store regressions, and project lint
includes `packages/core`. The extension continues using its existing path until
C4 connects the companion bridge. No server protocol, published v0.1.0 artifact,
installation path or user settings changed, and no duplicate VAD/ASR was added.

### Environment and exact acceptance evidence

Executed only in the requested worktree on Darwin arm64; Node v24.15.0,
npm 11.12.1, uv 0.12.23, CPython 3.12.15, TypeScript 7.0.2, Biome 2.5.15,
Vite 8.3.2 and existing Playwright Chromium 153.0.8010.12. The first project verify
created the ignored worktree `.venv` and installed 33 locked dependency packages
in 28 ms. No apps or models were installed/downloaded.

| Command | Actual result | Evidence |
| --- | --- | --- |
| `npm run test:framework:core` | PASS, final exit 0: ES2022/no-DOM compilation and 14 tests, 0 failures/skips; 105.452542 ms | `.ralph/media-framework/core-1-c2-framework.log`; committed core tests and dependency test |
| `npm run verify` | PASS, final exit 0: Biome 58 files/24 ms/no findings, Ruff passed, extension typecheck, Vite 19 modules/21 ms, JS 46 passed/0 failures/skips/14372.083125 ms, Python 222 passed/66.89 s | `.ralph/media-framework/core-1-c2-verify-final.log` |
| `npm run verify` (first run, before loss handling refinement) | PASS, exit 0: JS 46 passed/15125.091458 ms, Python 222 passed/68.03 s; final run above verifies the refinement | `.ralph/media-framework/core-1-c2-verify.log` |
| `npm run test:captions-correction-browser` | PASS, exit 0: 1000 ms cadence, immediate first/final, burst coalescing, latest revision, in-place update, clear and replacement | `.ralph/media-framework/core-1-c2-correction-browser.log`; emitted JSON `passed: true`, `realAudioOrModels: false` |
| `npm run test:transcript-browser` | PASS, exit 0: comparison and runtime scripts; generated source/translation, time columns, cadence, safe text, history/eviction/reopen, stale rejection, Stop retention, real extension messaging/window; UI page errors `[]` | `.ralph/media-framework/core-1-c2-transcript-browser.log`; regenerated UI/runtime artifacts inspected |
| `node --import tsx --test --test-name-pattern='overload and sample gaps' tests/framework-core.test.ts` (before fix) | FAIL, exit 1: 0 passed/1 failed, 96.354958 ms; automatic reopening produced 2 input handles where 1 was required | `.ralph/media-framework/core-1-c2-loss-regression.log`; same regression passes in final core/JS checks after pausing on loss |
| `git diff --check` | PASS, exit 0, no whitespace errors | CLI output |

An intermediate lint run exited 0 with one optional-chain warning in the new
controller; it was corrected. Final lint has no findings. The final full verify
was rerun because loss handling and the core dependency assertion changed after
the first run's JavaScript checks.

The synthetic stream test sends one 200-byte/100-ms PCM chunk through the input,
queue and test engine port, accepts original text before its matching translation,
rejects incorrect language pairs, and maps its range to 9000–9200 ms at rate 2.
Pressure/gap fixtures report 300 ms discarded/missing audio, fence old results and
require explicit resume. Deferred promises exercise late probe, preparation and
input acquisition; seek/Stop tests assert synchronous identity invalidation.
These tests establish orchestration, ordering and cancellation only. The generated
text does not establish ASR accuracy or translation quality, and synthetic PCM
does not establish access to an actual selected video's samples.

The transcript browser check changed only the nondeterministic runtime
`closedWindowId` (2092352814 → 722084735). After inspecting the fresh evidence,
that generated file was restored; screenshots and `ui.json` matched the committed
artifacts. No unrelated files or user apps were modified. `.ralph` logs and `.venv`
remain ignored; no credentials, model weights, user audio/transcripts or temporary
runner state are included in the commit.

### Remaining scope

No C2 environment blocker remains. The next unfinished item is C3: extract caption
cadence, immediate first/final rendering, sequential long-final replay, 250 ms fade
and recent-300 policy across the core/renderer boundary. C4's combined companion
adapter and C5's complete policy/adapter acceptance coverage remain unfinished,
even though all four required commands pass for the currently implemented scope.
No selected-video acquisition, real inference/model preparation, recognition or
translation accuracy, Safari or physical iPhone acceptance was performed. This is
C2 progress, not Stage core or whole-framework completion.
