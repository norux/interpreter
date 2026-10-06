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

## 2026-10-06 — core iteration 2/5 (C3)

Result: C3 implemented and verified; current core/project/browser acceptance
commands pass. C4–C5 remain unchecked; Stage core is not complete.
Commit: the `feat: extract shared caption presentation policy` commit containing
this report. The requested independent runner file
`.ralph/media-framework/2026-10-06T11-28-49-587Z-core-verification.txt` was absent,
and no repository AGENTS.md was present. The supplied standing instructions apply.

### Implemented scope and boundaries

`packages/core/presentation-policy.ts` owns accepted revisions, 1000 ms correction
coalescing, immediate first source/first paired translation and final corrections,
final paired replay from part zero, ordered part advancement, reading deadlines,
250 ms fade/remove intent and recent-300 history. It uses the revision store and
an injected monotonic clock/scheduler; it has no DOM, browser, Node or model
imports. Source finality alone cannot initiate translation replay. A final source
correction immediately invalidates the displayed old pairing. Old identity,
source/translation revisions and part acknowledgements cannot skip unread text.
Only a paired final source and final translation start final replay.

Renderer progress now carries an explicit part index, visibility and measured
character count. The core preserves the existing `min(6000, max(2500, count * 90))`
reading duration. Hidden parts receive reading time when actually shown;
unchanged resize/fullscreen acknowledgements do not restart deadlines. A longer
visible part receives more reading time. Only the front visible sentence advances
or fades; the last complete provisional cue remains readable until corrected,
finalized or superseded. Fading/retired overlay entries cannot be revived, while
comparison history can still retain their latest complete accepted records.
Epoch activation clears live output and keeps history; disposal cancels delayed
work and retains history. Explicit Clear resets history and leaves a sink reusable.
The controller caps its declared storage profile at 300; the service worker uses
the same core retention limit.

The existing overlay and transcript comparison now call the shared core policy.
The overlay retains measured binary-search line fitting, four visible lines,
unread-suffix anchoring across edits, fullscreen placement, safe `textContent`
insertion and its existing visible overload notice/4-caption/12-second waiting
budget. DOM/CSS owns fade animation; core supplies its duration and removal time.
The comparison view renders full original/translation/time rows with the same
cadence, no expiry acknowledgements, and bounded history/eviction/reopen behavior.
No viewport-dependent character splitting or line fitting was moved into core.

`extension/captions/presentation.ts` is a presentation-only compatibility wrapper
for the existing Caption messages. It uses the existing caption counter for both
display revisions, labels unavailable source language `und`, and uses an explicit
`legacy-tab-output` display sentinel. It neither issues a selected-video handle
nor claims to expose server ASR revisions or early ASR-only updates. C4 still owns
combined-engine normalization, capabilities, settings and transport integration.
No second VAD/ASR, new model, selected-video acquisition or server protocol was added.
The published companion v0.1.0, installation paths and user settings are unchanged.

Sharing core between views makes the main Vite graph emit module chunks. Chrome
injects content as a classic script, so `vite.content.config.ts` builds an IIFE
and the main build's `writeBundle` hook writes that standalone `content.js`.
Content stays in the main dependency graph: both `npm run build` and the existing
`npm run dev` watch flow regenerate the injectable script. A committed build
regression parses the actual output as a classic script. A local watch check also
verified the first build and a second build after touching the overlay dependency
without changing its contents; the watcher was closed afterwards.

### Environment and exact acceptance evidence

Executed only in the requested worktree on Darwin arm64, Node v24.15.0,
npm 11.12.1, uv 0.12.23, Python 3.12.15, TypeScript 7.0.2, Biome 2.5.15,
Vite 8.3.2 and existing Playwright Chromium 153.0.8010.12. No dependencies,
models or apps were installed/downloaded. Existing locked Python dependencies
and browser caches were used.

| Command | Actual result | Evidence |
| --- | --- | --- |
| `npm run test:framework:core` | PASS, final exit 0: ES2022/no-DOM compilation, dependency graph including presentation policy, 21 passed/0 failed/0 skipped; 80.649375 ms | `.ralph/media-framework/core-2-c3-framework.log`; committed core and presentation regressions |
| `npm run verify` | PASS, final exit 0: Biome 62 files/20 ms/no findings, Ruff passed, extension typecheck, Vite main 23 modules/30 ms and standalone content 8 modules/6 ms; JS 54 passed/0 failures/skips/14684.56475 ms; Python 222 passed/66.90 s | `.ralph/media-framework/core-2-c3-verify-acceptance.log` |
| `npm run test:captions-correction-browser` | PASS, final exit 0: Chromium 153.0.8010.12, 1000 ms cadence, immediate first/final, burst/latest/in-place/clear/replacement; `realAudioOrModels: false` | `.ralph/media-framework/core-2-c3-correction-browser.log` |
| `npm run test:transcript-browser` | PASS, final exit 0: both comparison/runtime scripts, source/translation/time/cadence/safe text, history/eviction/reopen/stale rejection/Stop retention and actual extension messaging/window; UI page errors `[]` | `.ralph/media-framework/core-2-c3-transcript-browser.log`; freshly generated UI/runtime artifacts inspected |
| `npm run test:captions-overlap-browser` | PASS, exit 0: full sequential final display 42/42 and 38/38 characters, narrow parts 30+12 and 30+8; reading time, coexisting sentences/front expiry, actual CSS fade/250 ms, resize/fullscreen, provisional retention/correction/final replay, retirement and visible waiting loss (4 caption-limit drops, 2 audio-budget drops) | `.ralph/media-framework/core-2-c3-overlap-browser.log`; generated caption fixture only, no audio/models |
| Local Vite watch check using `build({ configFile: 'vite.config.ts', build: { watch: {} } })` | PASS, exit 0: `watchBuilds: 2`, classic script parsed after initial build and overlay dependency touch; regenerated output modification time increased; watcher closed | `.ralph/media-framework/core-2-c3-watch.log` |
| `node --import tsx --test tests/build.test.ts` (after standalone-build fix) | PASS, exit 0: 2 passed/0 failed/0 skipped; 43.273459 ms | `.ralph/media-framework/core-2-c3-watch-regression-fixed.log`; also included in final full verify |
| `git diff --check` | PASS, exit 0, no whitespace errors | CLI output after implementation and report updates |

Resolved implementation failures were verified before fixing them:

- First `npm run test:captions-correction-browser`: FAIL, exit 1; sharing policy
  caused a module import in injected `content.js`, so the classic script did not
  initialize (`globalThis.sendCaption is not a function`). The final IIFE build
  passes the same browser check and classic-script parsing regression. Evidence:
  `.ralph/media-framework/core-2-c3-bundle-regression.log`.
- First `npm run test:framework:core` with policy tests: FAIL, exit 1;
  19 passed/1 failed/122.822375 ms. A new final-source revision did not immediately
  clear the stale pairing (`replay` remained last instead of a new `update`). The
  final-source revision condition was corrected; that unchanged assertion passes
  in all final core/JS checks. Evidence:
  `.ralph/media-framework/core-2-c3-framework-initial.log`.
- An intermediate separate-build approach omitted content from a direct main
  build, breaking the existing watch flow. `./node_modules/.bin/vite build`
  followed by `node --import tsx --test tests/build.test.ts`: FAIL, test exit 1,
  0 passed/2 failed/45.528833 ms, missing `content.js`. The main write hook now
  performs the standalone build for regular and watch builds; both regressions
  pass. Evidence: `.ralph/media-framework/core-2-c3-watch-regression.log`.
- Earlier full verifies passed for intermediate implementations: first had
  53 JS tests/15211.686041 ms and 222 Python tests/66.95 s; the Clear-contract
  refinement had 54 JS tests/14253.916625 ms and 222 Python tests/66.84 s. The final
  full verify above reruns the completed main/watch build integration. Evidence:
  `.ralph/media-framework/core-2-c3-verify.log` and
  `.ralph/media-framework/core-2-c3-verify-final.log`.

Seven new controlled-clock core tests exercise cadence/finality, independent
source/translation pairing, sequential acknowledged replay, the 2.5–6 second
bounds, exact fade/removal, layout visibility/deadlines, recent-300 eviction,
epoch/disposal fencing and reusable Clear. They establish deterministic policy
behavior. The longer existing browser check independently establishes actual
measured narrow-screen splitting and CSS fading; those are DOM fixture results.
Neither set of generated texts establishes transcription accuracy.

Browser checks regenerated existing verification artifacts. Screenshots and
`transcript/ui.json` matched committed versions. The rolling fixture JSON changed
only measured timings; it was inspected then restored. The final transcript
runtime JSON changed only nondeterministic `closedWindowId`
(2092352814 → 308564494); it was inspected then restored. New evidence is recorded
here; unrelated artifacts and user apps/settings/recordings/mounted images were
preserved. Local `.ralph` logs/state are ignored and excluded from the commit.
No credentials, model weights, user audio or user transcripts were committed.

### Remaining scope

No required environment/device/permission blocker remains for C3. C4 is next:
connect the existing companion as a combined interpretation engine, normalize
observed source and translation revisions atomically, declare absence of ASR-only
updates, preserve settings and avoid duplicate VAD/ASR. C5's full adapter/policy
acceptance remains unfinished even though current core and browser checks pass.
No selected-video PCM, real inference/model loading, ASR/translation accuracy,
Safari or physical iPhone acceptance was performed. This is C3 progress only.

## 2026-10-06 — core iteration 3/5 (C4)

Result: C4 implemented and verified; all four required acceptance commands pass
for the final code. C5 remains unchecked; Stage core is incomplete. Commit: the
`feat: connect companion combined interpretation adapter` commit containing this
report. No repository AGENTS.md or requested independent runner failure file
`.ralph/media-framework/2026-10-06T11-28-49-587Z-core-verification.txt` exists.
The supplied standing instructions apply.

### Implemented scope and compatibility

`packages/engines-companion/engine.ts` implements the combined InterpretationEngine
port. The offscreen host retains the existing authenticated `/sessions` request,
then delegates WebSocket authentication, ready ordering, PCM transmission and
caption normalization to the adapter. Tab acquisition remains in the existing
Chrome host. The adapter performs no local VAD, ASR, translation or model loading.
Its capability explicitly declares `combined-interpretation`, `asrOnlyUpdates:
false` and the session's selected language pair. The protocol supplies no model
version/load probe, so the adapter leaves model identities empty instead of
manufacturing versions or model readiness. Preparation waits for the existing
server ready response; this is not accuracy evidence.

`captions.ts` validates unknown captions before accepting them, rejects foreign
sessions, stale/duplicate revisions and final-to-provisional regressions, and
emits only atomic source/translation pairs. Source revisions count observed text,
finality or audio-range changes; translation-only corrections retain the source
revision. The original server emission counter becomes translationRevision and
is paired with the exact locally observed sourceRevision. These are bridge
revisions, not server ASR counters. Both bridge history and core presentation
remain bounded to recent 300 utterances; retired audio cannot reappear through a
new late caption ID.

The host sends normalized pairs in a version 1 framework envelope alongside the
existing extension Caption fields; renderers reject unsupported versions/event kinds;
source, translation, finality, wire revision, ranges and diagnostic emittedAtMs
are preserved. Both existing renderers consume the shared policy through the
normalized pair, with a compatibility bridge for legacy/generated messages.
There is no server protocol change. Selected provider, ASR choice, both languages
and both model names are snapshotted and sent unchanged. The existing settings
storage key, UI choices and defaults are unchanged. Omitting settings still sends
no request body and defers to server environment settings; unavailable language
metadata is `und`, not an invented language selection.

PCM1 remains exactly 28 header bytes plus 480 mono PCM16 samples at 24 kHz per
20 ms frame. The legacy host decodes those frames into explicitly `tab-mix`
chunks and the engine re-encodes byte-identical wire packets. Sequence, identity,
epoch, format, duration and payload bounds are checked before sending. The
existing 50-frame/one-second WebSocket buffer budget is retained; the core audio
queue is also bounded to one second. Server audio/segmentation/translation limits
and implementations are unchanged. Receipt loss counts retain their existing
user-visible report. Pending normalized output is bounded; overflow and transport
errors fail visibly rather than silently accumulating captions.

The `legacy-tab-output` sentinel identifies existing presentation only, never a
selected-video handle. There is no videoRange; session elapsed audio is not
claimed as video time. The PCM clock is epoch-relative, and the original server
emittedAtMs is carried only as diagnostic data, without cross-process subtraction.
This legacy adapter is single-use: cancel closes its owned socket, fences queued
and late events, wakes a blocked audio consumer and is idempotent. A closed probe
reports `unavailable/context-destroyed` and requires a fresh authenticated Start.
The existing tab product does not route selected-video playback/seek into this
adapter; selected-input lifecycle integration remains later-stage work.

Stop invalidates the host generation and closes its audio queue before cleanup.
Late socket callbacks cannot send new output. Session socket closure is attempted
even if owned tab-source cleanup fails. No published companion v0.1.0 artifact,
launcher, server file, installation path, manifest permission or user settings
were modified. No apps, models or dependencies were installed/downloaded.

### Environment and exact acceptance evidence

Executed only in the requested worktree on Darwin arm64; Node v24.15.0,
npm 11.12.1, uv 0.12.23, Python 3.12.15, TypeScript 7.0.2, Biome 2.5.15,
Vite 8.3.2 and existing Playwright Chromium 153.0.8010.12.

| Command | Actual result | Evidence |
| --- | --- | --- |
| `npm run test:framework:core` | PASS, final exit 0: ES2022/no-DOM compilation and dependency graph, 29 passed/0 failed/0 skipped; 93.465959 ms | `.ralph/media-framework/core-3-c4-framework-envelope-final.log`; eight new adapter tests |
| `npm run verify` (before versioned-envelope refinement) | PASS, exit 0: Biome 67 files/37 ms/no findings, Ruff/typecheck/build passed; JS 62 passed/0 failures/skips/14923.986167 ms, Python 222 passed/66.91 s | `.ralph/media-framework/core-3-c4-verify-final.log` |
| `npm run verify` (final code with versioned envelope) | PASS, exit 0: Biome 67 files/22 ms/no findings, Ruff passed, extension typecheck, Vite main 28 modules/32 ms and content IIFE 10 modules/6 ms; JS 63 passed/0 failures/skips/14300.178583 ms, Python 222 passed/66.87 s | `.ralph/media-framework/core-3-c4-verify-envelope-final.log` |
| `npm run verify` (before closed-probe refinement) | PASS, exit 0: 62 JS passed/0 failures/skips/15177.497292 ms, 222 Python passed/66.99 s, Biome 67 files/21 ms/no findings, Ruff/typecheck/build passed | `.ralph/media-framework/core-3-c4-verify.log` |
| `npm run test:captions-correction-browser` | PASS, final exit 0: 1000 ms cadence, immediate first/final, burst coalescing, latest revision, in-place update, clear/replacement; `realAudioOrModels: false` | `.ralph/media-framework/core-3-c4-correction-browser-envelope-final.log`; JSON `passed: true` |
| `npm run test:transcript-browser` | PASS, final exit 0: comparison/runtime scripts, generated source/translation/time/cadence, safe text, same-row corrections, history/eviction/reopen, stale rejection/Stop retention, actual extension messaging/window; UI page errors `[]` | `.ralph/media-framework/core-3-c4-transcript-browser-envelope-final.log`; freshly regenerated UI/runtime artifacts inspected |
| `node --import tsx --test tests/offscreen-companion.test.ts` | PASS, exit 0: 1 passed/0 failed/0 skipped, 83.315959 ms; also included in full verify | `.ralph/media-framework/core-3-c4-envelope-regression-fixed.log`; committed host integration fixture |
| `node --import tsx --test --test-name-pattern='preserves PCM1 bytes' tests/framework-companion.test.ts` (before closed-probe fix) | FAIL: 0 passed/1 failed/94.029708 ms; closed engine advertised `available` instead of `unavailable` | `.ralph/media-framework/core-3-c4-closed-regression.log` |
| Same closed-probe regression after fix | PASS, exit 0: 1 passed/0 failed/0 skipped, 67.121084 ms; unchanged assertion also in final core/JS acceptance | `.ralph/media-framework/core-3-c4-closed-regression-fixed.log` |
| `node --import tsx --test tests/offscreen-companion.test.ts` (before envelope fix) | FAIL, exit 1: 0 passed/1 failed/82.728917 ms; normalized record lacked the required version 1 cross-context envelope | `.ralph/media-framework/core-3-c4-envelope-regression.log`; unchanged version assertion passes after fix |
| `git diff --check` | PASS, exit 0, no whitespace errors | CLI output after implementation; rerun after report updates |

Adapter fixtures check independent observed revisions, atomic core-store acceptance,
foreign/malformed input, 300-record eviction, exact PCM1 bytes, valid loss receipts,
no fabricated ASR-only events, old-epoch cancellation, late-event fencing,
idempotent close, sequence/format rejection, pending-output overflow, envelope
version/event rejection, socket auth,
ready/abort ordering, malformed JSON and the exact existing transport budget.
The host fixture uses fake media/AudioContext/worklet/WebSocket APIs: it exercises
the actual offscreen module, queues, engine and runtime messages with generated
PCM and captions, and asserts unchanged request settings and wire caption fields.
It does not establish real tab capture, actual model execution or audio quality.

Required browser checks also ran before the probe and versioned-envelope
refinements; those earlier runs passed. Final results above verify the completed
boundary change. Screenshots and transcript UI JSON matched committed artifacts.
Runtime JSON changed only nondeterministic closedWindowId: successive runs were
2092352814 → 20860004, → 1064539833, and final → 2142014611. The new evidence was
inspected and the unrelated generated file restored. Local `.ralph` logs remain
ignored and are excluded from the commit. No credentials, model weights, user
audio/transcripts or temporary runner state are committed. User apps, recordings
and mounted images were preserved.

### Remaining scope

C5 is next: audit the completed core/policy/adapter acceptance coverage and
browser-free type/dependency boundaries, rerun all required core-stage commands,
and finalize the stage report. C5 and every later-stage checkbox remain unfinished.
No current C4 environment/device/permission blocker was observed. Actual companion
inference/ASR or translation accuracy, real selected-video samples, browser model
loading, Safari and physical iPhone acceptance were not tested in this iteration.
Stage core and whole-framework/iPhone completion are not claimed.


## 2026-10-06 — core iteration 4/5 (C5)

Result: C5 completed; C1–C5 and all four required Stage core acceptance commands
pass. Stage core is complete for its extraction/compatibility scope. Commit: the
`test: finalize media framework core acceptance` commit containing this report.
No repository AGENTS.md or requested independent runner failure file
`.ralph/media-framework/2026-10-06T11-28-49-587Z-core-verification.txt` exists.
The supplied standing instructions apply. No later stage was advanced.

### Acceptance harness and coverage audit

The existing core acceptance already exercised the implemented lifecycle, bounded
queue, timeline, revision store, presentation policy and combined companion
adapter. C5 strengthens two uncovered acceptance boundaries:

- `tsconfig.contracts.json` extends the ES2022/no-DOM/no-ambient core config but
  compiles contracts and their conformance fixture independently. The compiler's
  actual file graph must stay within contracts/fixtures; a contracts → core import
  now fails acceptance. The separate core graph still permits contracts/core and
  requires all six implemented core modules. Both reject adapters/providers,
  browser/worker libraries and Node ambient dependencies.
- `test:framework:core` now includes the existing offscreen-host integration
  regression, so the stage command checks the actual legacy host's settings
  snapshot, omitted-settings request, byte-identical PCM1, versioned normalized
  caption envelope, original wire fields and Stop cleanup/late-event fencing.
  Negative type fixtures additionally reject Node, WebSocket and GPU ambient
  types. No assertion or required browser check was removed or weakened.

| Core checklist | Acceptance evidence and limits |
| --- | --- |
| C1 contracts | Positive/negative v1 envelope, opaque target, epoch/clock and separate revision fixtures; independent contracts/core compiler graphs |
| C2 lifecycle/queue/timeline/store | 13 controlled tests: late probe/preparation/open, synchronous Stop, consecutive Start/settings isolation, seek/rate/source/pause/suspension epoch cancellation, rejected late results, cleanup failure ownership, exact revision pairing, bounded history, pressure/gaps and common-clock mapping |
| C3 presentation | 7 controlled-clock tests: immediate first/source/translation/final, 1000 ms correction coalescing, final paired replay from part zero, acknowledged sequential parts, 2.5–6 s reading, exactly 250 ms fade/remove, visibility/deadline handling, recent-300/epoch/disposal/Clear; required browser checks independently exercise built renderers |
| C4 companion compatibility | 8 adapter tests and 1 actual offscreen-module fixture: observed independent revisions, atomic pairs, malformed/foreign/stale/final-regression rejection, bounded queues/history, unchanged PCM1/auth/ready/buffer budget, cancellation/close and settings preservation; media/socket APIs are mocks |
| C5 acceptance | Both no-DOM compiler configs, 2 dependency tests and all 4 required commands actually pass below; intentional forbidden-import experiment independently demonstrates non-success on a violated dependency boundary |

C5 changes only acceptance configuration/tests and these records. No runtime,
server protocol, published companion v0.1.0, installation path, settings UI,
storage key/default or user setting was changed. The legacy capture route remains
explicitly tab-mix. It does not establish selected-video input. No second VAD/ASR,
new model or inference implementation was introduced.

### Environment and exact acceptance evidence

Executed only in the requested worktree on Darwin arm64; Node v24.15.0,
npm 11.12.1, uv 0.12.23, Python 3.12.15, TypeScript 7.0.2, Biome 2.5.15,
Vite 8.3.2 and existing Playwright Chromium 153.0.8010.12. Existing locked Python
dependencies and browser caches were used. No dependencies, models or apps were
installed/downloaded. Each required command exited 0 on the completed code.

| Command | Actual result | Evidence |
| --- | --- | --- |
| `npm run test:framework:core` (initial expanded harness) | PASS, exit 0: two ES2022/no-DOM compilations, 31 passed/0 failed/0 skipped; 156.680125 ms | `.ralph/media-framework/core-4-c5-framework.log` |
| `node --import tsx --test tests/framework-contracts.test.ts` with temporary prohibited contracts → core export | EXPECTED FAIL, child exit 1: 1 passed/1 failed/0 skipped; 103.98 ms; contracts graph rejected `packages/core/identity.ts` as `Forbidden dependency`. Experiment wrapper exit 0 asserted that rejection and removed the fixture in `finally` | `.ralph/media-framework/core-4-c5-boundary-rejection.log`; temporary `packages/contracts/core-dependency-fixture.ts` removed, not committed |
| `npm run test:framework:core` (after removing prohibited fixture) | PASS, final exit 0: both ES2022/no-DOM compilations and compiler graphs, 31 passed/0 failed/0 skipped/0 cancelled; 118.048041 ms | `.ralph/media-framework/core-4-c5-framework-final.log` |
| `npm run verify` | PASS, exit 0: Biome 67 files/38 ms/no findings, Ruff passed, extension typecheck, Vite main 28 modules/30 ms and content IIFE 10 modules/6 ms; JS 64 passed/0 failed/0 skipped/15141.718583 ms, Python 222 passed/66.91 s | `.ralph/media-framework/core-4-c5-verify.log` |
| `npm run test:captions-correction-browser` | PASS, exit 0: Chromium 153.0.8010.12, 1000 ms cadence, immediate first/final, burst/latest/in-place/clear/replacement; emitted `passed: true`, `realAudioOrModels: false` | `.ralph/media-framework/core-4-c5-correction-browser.log` |
| `npm run test:transcript-browser` | PASS, exit 0: both comparison/runtime scripts; source/translation/audio-time/cadence/safe text/same-row correction/history eviction/session replacement/reopen/stale rejection/Stop retention, actual extension messaging/window; UI page errors `[]`, runtime `realCapture: false` | `.ralph/media-framework/core-4-c5-transcript-browser.log`; regenerated UI/runtime JSON inspected |
| `git diff --check` | PASS, exit 0, no whitespace errors, including final report/plan changes | CLI output before commit |

No unexpected acceptance failures or required core environment/permission blockers
occurred. The negative dependency experiment is intentional harness evidence,
not a passing application run or an unresolved regression. The final core run
confirms restored sources. Browser screenshots and UI JSON matched committed
artifacts; runtime JSON changed only nondeterministic `closedWindowId`
(2092352814 → 747130818). Fresh evidence was inspected and that generated file
restored. Local `.ralph` logs/state remain ignored and excluded from the commit.
No credentials, model weights, user audio/transcripts or unrelated files are
committed. Active recordings, mounted images, settings and running user apps were
preserved; only test-owned browser contexts were opened and closed.

### Unverified scope and next item

Core acceptance establishes contracts, orchestration, policy and legacy host
compatibility using generated PCM/captions and mock transport/media APIs, plus
actual built DOM rendering/extension messaging. It does not establish real
selected-video samples, companion or browser ASR accuracy, translation quality,
model loading, standalone inference, Safari or physical iPhone support. These
remain unverified and belong to later stages; no whole-framework/iPhone
completion is claimed. There is no remaining core blocker or resume condition.

C1–C5 are checked only after the four required commands passed. The next plan
item is V1 selected-video discovery/selection, left unchecked and unstarted.
The independent runner will rerun core acceptance against this commit.
