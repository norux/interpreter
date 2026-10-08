# Media framework video verification

## 2026-10-06 — video iteration 1/5 (V1)

Result: V1 catalog and explicit selection verified. Stage video is incomplete:
V2–V5 remain unchecked. Commit: the `feat: add explicit video catalog and selection`
commit containing this report.

### Implemented scope and ownership

`packages/media-web/catalog.ts` implements the existing `MediaCatalog` port in a
page-owned adapter. Each catalog has a fresh document identity and a host-provided
frame identity. Each video gets an opaque target ID, label, viewport visibility,
dimensions and playback state. DOM elements, source URLs and MediaStreams remain
local; `resolve` is an adapter-local operation for future Web Audio composition.
Neither contracts nor core imports this DOM adapter.

`packages/media-web/selection.ts` mounts an accessible native select and explicit
confirmation button. It suggests a visible candidate, preferring playing video
then displayed area; a suggestion does not start or select a session. Confirmed
selection changes only on another explicit confirmation, invalidation or disposal.
New advertisements and playback in another video never replace the selected
target. Invalidated selection emits `null` so a future host can stop its session,
clears the pending choice and requires the user to choose and confirm again.
Candidate labels are inserted as text.

Removal/reinsertion, `<video src>`/`<source>` mutations, resource reload events,
changed `currentSrc` or `srcObject`, page destruction and navigation retire handles.
Resolution drains pending mutation records so even removal/reinsertion within
the same JavaScript task cannot reuse a target. URL changes are checked on every
discovery/resolution and every 250 ms without replacing the site's history APIs;
popstate/hashchange also invalidate the document. A host using a same-URL router
must call `invalidateDocument()` at its route boundary. `pagehide` disposes the
owner; a restored/destroyed context requires a fresh catalog and confirmation.
Disposal removes owned subscriptions, observer and timer, and is idempotent.

Discovery visits only the owner's document. Same-origin and cross-origin frames
need their own permitted page adapter with an assigned frame identity. Parent
selection neither accesses child frame DOM nor requests/bypasses permissions.
The UI states this boundary. The controlled cross-origin frame in the test is
served locally and explicitly instantiates its own adapter; this is not evidence
of extension host permissions or arbitrary external iframe support.

The fixture mounts the production modules through a local test bundle. Wiring
them into a standalone platform host belongs to B4/S3, not this iteration. The
existing extension's companion tab-mix capture, published v0.1.0 companion,
server protocol, installation paths, user settings/defaults/storage and all
other stage checkboxes remain unchanged. No graph, inference or persistence is
created by catalog/selection.

### Acceptance coverage

`npm run test:framework:video` currently runs DOM-only/no-extension-ambient
adapter typechecking and the V1 browser harness in `tests/framework-video.mjs`.
The harness bundles the actual modules, uses isolated headless Chromium and a
loopback fixture server, and closes only its owned browser/server. It fails on
assertion, compile or browser launch errors. It must grow with V2–V5 to verify
actual selected-video PCM, audibility, time mapping, media restrictions and
speech fixtures before Stage video completion. Its current exit 0 covers V1
only; the JSON explicitly lists the missing acceptance and sets
`realSelectedVideoPCM: false`, `originalAudibility: "unverified"` and
`asrAccuracy: "unverified"`.

| Observation | Actual evidence |
| --- | --- |
| Stable identity and metadata | 3 top-document videos; visible flags `[true, true, false]`; main display 320×180; repeated discovery returns the same IDs; exported handles contain only ID/document/frame, no resource URL |
| Explicit selection and advertisement isolation | No callback before confirmation; another playing video and a newly inserted playing advertisement leave the confirmed main target and picker unchanged |
| Frame isolation | 2 independent frame owners, distinct document/frame identities; each discovers its own 1 video; parent/child reject each other's handles; native parent access to cross-origin child document throws |
| Source and element replacement | Changing video source retires its target; source-child remove/reinsert at the same final URL retires its target; video detach/reinsert also fails resolution within the same JavaScript task |
| SPA/document identity | `pushState` path change retires old targets immediately on resolution and requires reconfirmation; explicit same-URL host invalidation also retires document handles |
| Safe labels and cleanup | HTML-looking labels create no image elements; catalog/picker dispose twice safely; disposed catalog returns no candidates, old handles fail; page errors `[]` |

The fixture videos start with unloaded placeholder resource URLs. Actual playing
state is exercised with a generated canvas MediaStream (video only, no audio)
in the second video/advertisement. No fake `paused`/`ended` properties or mock
catalog replace the actual DOM implementation. These observations establish
catalog/selection behavior only, not PCM acquisition, original audibility or
speech recognition. No user media or transcripts are used.

### Environment and command evidence

Requested worktree, Darwin arm64; Node v24.15.0, npm 11.12.1, uv 0.12.23,
Python 3.12.15, existing Chromium 153.0.8010.12. Existing dependencies/caches
were used; no dependencies, models or apps were installed. Root `AGENTS.md`,
prior video report and requested independent runner file
`.ralph/media-framework/2026-10-06T12-10-53-313Z-video-verification.txt` were absent.

| Command | Actual result | Evidence |
| --- | --- | --- |
| `npm run test:framework:video` (final implementation) | PASS, exit 0: standalone adapter typecheck and Chromium V1 DOM checks; 3 top videos, 2 frame owners, page errors `[]`; JSON `passed: true`, scope `V1 catalog and selection only` | `.ralph/media-framework/video-1-v1-acceptance.log`; committed harness/fixture and coverage table above |
| `npm run verify` (before final same-task resolution fix) | PASS, exit 0: Biome 71 files/24 ms, Ruff/typecheck/build; main 28 modules/93 ms + content 10 modules/22 ms; JS 64 passed/0 failed/0 skipped/15027.675708 ms; Python 222 passed/66.92 s | `.ralph/media-framework/video-1-v1-verify.log` |
| `npm run verify` (final implementation) | PASS, exit 0: Biome 71 files/39 ms/no findings, Ruff/typecheck/build; main 28 modules/40 ms + content 10 modules/6 ms; JS 64 passed/0 failed/0 skipped/0 cancelled/14561.168125 ms; Python 222 passed/66.90 s | `.ralph/media-framework/video-1-v1-final-verify.log` |
| `./node_modules/.bin/biome lint packages/media-web tests/framework-video.mjs tests/fixtures/video-selection.html` | PASS, exit 0: 4 files/3 ms/no findings | Final CLI output |
| `git diff --check` | PASS, exit 0, no whitespace errors; rerun before commit | CLI output |

Failures observed and fixed without relaxing assertions/acceptance:

- Initial `npm run test:framework:video`: FAIL, exit 1 after adapter typecheck;
  harness parse error `SyntaxError: Unexpected token ')'` at line 16. Corrected
  the build options closing brace; all later browser runs reached assertions.
- Initial `npm run verify`: FAIL, exit 1 at Biome, 71 files/37 ms, 3
  `useMediaCaption` errors on the new fixture videos; Ruff/typecheck/build/tests
  were not reached. Added empty caption tracks for the silent selection fixture;
  subsequent full lint passes without suppressions or configuration changes.
- Expanded `npm run test:framework:video`: FAIL, exit 1,
  `page.waitForFunction: Timeout 30000ms exceeded` at source-child reinsertion.
  The unchanged final source URL incorrectly kept the selection valid. Retire
  the owning video on source-child mutations; the same assertion now passes.
  Evidence: CLI output and committed `Source child reload retires a target even
  when the final URL is unchanged` assertion.
- Same-task regression `npm run test:framework:video`: FAIL, exit 1,
  `true !== false` for `Same-task resolution must reject a detached/reinserted
  element before observer delivery`. Draining pending mutation records during
  resolution fixed it; the unchanged assertion now passes. Evidence:
  `.ralph/media-framework/video-1-v1-same-task-regression.log`.
- Initial targeted Biome check exited 0 with 7 non-null assertion warnings.
  The document window is now narrowed into a non-null local binding; final
  lint reports no findings.

### Unverified scope and next item

No environment/device/permission blocker was encountered for V1. Browser access
was not blocked. Actual selected-video audio, Stop/repeat Start audibility,
already-owned graphs, PCM/video anchors, epoch invalidation at the input layer,
CORS/silence/mute/blob/MSE/protected routes and Japanese/English/two-audible-video
fixtures remain unimplemented and unverified (V2–V5). Model loading, real ASR
accuracy/translation quality, standalone Chrome interpretation, Safari and physical
iPhone acceptance are also unverified. No whole-stage/framework/iPhone claim is made.

Next unfinished item: V2 same-origin Web Audio input, graph ownership and real
original playback/volume checks after Stop and repeated Start. Preserve V2–V5
checkboxes until their acceptance actually passes. No later stage was advanced.
Temporary test bundles/logs under `.ralph` are ignored and never committed;
credentials, model weights and user audio/transcripts are not part of this commit.

## 2026-10-06 — video iteration 2/5 (V2)

Result: V2's selected-element Web Audio input and original **browser playback
output** acceptance pass in Chromium. V3–V5 remain unchecked; Stage video is
incomplete. Commit: `feat: capture selected video audio without rerouting playback`
containing this report. Physical speaker/listener audibility is unverified; the
sound evidence below is actual browser output PCM, measured independently of
the adapter's captured PCM, rather than a hardware/listening test.

### Implementation and boundaries

`packages/media-web/audio-input.ts` implements the existing `VideoInput` port.
It resolves only the confirmed catalog handle and checks session target identity,
user activation, loaded ordinary same-origin HTTP(S) media and active playback.
The selected element's `captureStream()` feeds a session-owned Web Audio
`MediaStreamAudioSourceNode` and `pcm-worklet.js`. The worklet transfers 2048-frame
mono float32 batches (8192 bytes) at the actual context rate, with session/epoch,
sequence, audio range and a unique **audio-context clock** identity. No raw
`performance.now()` values from different contexts are subtracted. These capture
ranges are not video-time mappings; no playback anchors/epoch transitions are
claimed here.

The simpler selected-stream route avoids taking irreversible ownership of a
`MediaElementAudioSourceNode`. It neither duplicates a site's source node nor
closes/suspends the site's context. Only the capture worklet's silent output
reaches the session context's destination; original playback is left on its
existing path. This route is consistent with the architecture's Web Audio input
boundary and is capability-gated rather than selected by browser name.
[The element-capture specification](https://www.w3.org/TR/mediacapture-fromelement/#html-media-element-media-capture-extensions)
defines streams consumable by Web Audio, independently of the element's mute and
volume. Browsers lacking element capture are unavailable; no destructive graph
fallback, tab-mix fallback, `crossOrigin` rewrite or resource reload is used.
Actual Safari/iPhone execution remains unverified.

Stop clears queued PCM, resolves the waiting consumer, disconnects/closes the
worklet and session context, removes owned subscriptions and stops captured
tracks. It never stops website-owned source tracks. Repeated Stop is safe, and
new Start creates a fresh session-owned stream/context. Duplicate Start on the
same adapter is rejected. Startup failure also cleans up; invalidation listeners
are installed before async preparation. Catalog retirement/pagehide and playback
discontinuities terminate input rather than silently joining incompatible audio.
V3 must replace that conservative restart behavior with playback events, anchors
and actual epoch cancellation. Queue limits come from the composing host; overflow
clears input and rejects consumption with `audio-gap` and discarded duration.

The route guard is conservative about unloaded media, `srcObject`, non-HTTP/blob
resources, explicit cross-origin resources and `mediaKeys`; it does not complete
V4's access/silence/mute/redirect/CORS/MSE/DRM classification. `probe` reports
route eligibility; the controlled fixture's actual samples establish access for
that resource, not every same-origin-looking URL or external site's player.
The adapter is not connected to the published companion or standalone host.
Contracts/core, existing tab capture, companion v0.1.0, server/install paths,
settings/defaults and persistence remain unchanged.

### Real audio acceptance

`npm run test:framework:video` preserves every V1 assertion and then runs
`tests/framework-video-audio.mjs`. The second harness bundles production modules
independently and creates a synthetic 8-second 160×90 VP8/Opus WebM (132920 bytes
in the final run) with a 440 Hz, amplitude 0.15 tone. That encoded video is served
via loopback HTTP and actually decoded/played in a video element. The adapter
receives that selected video's captured audio, not an oscillator wired directly
into the production input, injected PCM, user media or model output.

The independent output oracle is Chromium `getDisplayMedia` tab loopback from
**only the test-owned tab**, selected by the unique fixture title. This is test
instrumentation, not a production input route. It does not capture another user's
tab, microphone or system audio. The owned test browser omits its default
`--mute-audio` flag. Output settings explicitly disable AGC, echo cancellation,
noise suppression and local-playback suppression; assertions require those actual
settings. The oracle receives stereo 44.1 kHz browser output, while the adapter
produces mono 48 kHz input. No blocked browser/profile access was encountered or
bypassed; no existing user browser was controlled.

Two fresh fixture pages exercise ordinary playback and a real pre-existing
site-owned `MediaElementAudioSourceNode -> destination` graph. Each runs three
Start/Stop/repeat Start cycles and a slow-consumer overflow check.

| Final observed quantity | Ordinary playback | Site-owned graph |
| --- | --- | --- |
| Baseline browser-output RMS, video volume 0.4 | 0.0424504604 | 0.0424298507 |
| Output RMS during three captures | 0.0424359863, 0.0423800114, 0.0424406988 | 0.0423582886, 0.0423427098, 0.0423522249 |
| Output RMS after three Stops | 0.0422993116, 0.0423715646, 0.0422526045 | 0.0423275278, 0.0423699237, 0.0422400332 |
| Decoded selected-tone peaks | 0.1497109532–0.1508632004 | 0.1509743333–0.1510555446 |
| Decoded tone frequency | 439.918534–440.142639 Hz | 439.918534 Hz |
| PCM/session checks | At least 5 batches/round, 8192 bytes/batch, mono float32/48 kHz, sequences start at 0, fresh round session IDs | Same |
| Duplicate Start and queue overflow | Rejected duplicate; `audio-gap: Video input queue overflow (128 ms discarded)` with 100 ms queue limit | Same |
| Playback and cleanup | No PCM after Stop; repeated Stop succeeds; playback advances >1 second; paused=false, volume=0.4, muted=false, rate=1; page errors `[]` | Same |

Acceptance requires nonzero real output, baseline within 12% of the encoded tone's
expected RMS `0.15 * 0.4 / sqrt(2)`, each during/after level within 12% of baseline,
PCM peak 0.12–0.18 and frequency within 12 Hz of 440. Measured output deviations
are below 0.6%. Neither selected PCM alone nor graph connectivity substitutes for
this independent original-output measurement. Human hearing/physical speakers,
speech content and transcription/translation accuracy were not tested.

### Commands, failures and exact evidence

Requested worktree on Darwin arm64; Node v24.15.0/npm 11.12.1, uv 0.12.23,
Python 3.12.15, existing Chromium 153.0.8010.12. AGENTS.md and the requested
independent runner failure file were absent. Existing dependencies were used;
no dependency/model/app installation, delegation, push, publish or later stage.
Temporary logs/bundles stay in ignored `.ralph`; generated media stays in memory.

| Command/run | Actual result | Local diagnostic evidence |
| --- | --- | --- |
| First `npm run test:framework:video` | FAIL, exit 1 after V1/typecheck; capture rejected with `target-invalidated: Restart capture after a playback discontinuity` at audio harness line 71 | `.ralph/media-framework/video-2-v2-first.log` |
| Video check after track-event fix | FAIL, exit 1; first batch's startup silence biased tone estimate to 234.375 Hz at line 75 | `.ralph/media-framework/video-2-v2-track-fix.log` |
| Video check after steady-tone measurement | FAIL, exit 1; original-output level assertion at line 79 | `.ralph/media-framework/video-2-v2-steady-tone.log` |
| Video check with output diagnostic | FAIL, exit 1; baseline RMS 0.0926495353 vs during 0.0187868360, showing processed oracle audio | `.ralph/media-framework/video-2-v2-output-diagnostic.log` |
| Video check with raw output oracle | PASS, exit 0; V1 and both V2 audio cases, real PCM/output, three restarts each, overflow errors expected, page errors `[]` | `.ralph/media-framework/video-2-v2-output-raw.log` |
| Final expanded `npm run test:framework:video` | PASS, exit 0; standalone DOM/no-extension-ambient typecheck, unchanged V1 assertions and final V2 checks/numbers above, including duplicate Start, actual raw settings, expected baseline and advancing playback | `.ralph/media-framework/video-2-v2-final-acceptance.log` |
| First targeted Biome | FAIL, exit 1: 5 errors (4 button types and returning `forEach` callback), 1 unused import warning, 6 files/22 ms; all corrected | CLI output |
| Final targeted Biome | PASS, exit 0: 7 files/16 ms, no findings | CLI output |
| `npm run verify` before final expanded harness checks | PASS, exit 0: Biome 75 files/41 ms, Ruff/typecheck/build (28 main modules/43 ms, 10 content modules/6 ms), JS 64 passed/0 failed/0 skipped/0 cancelled/15082.3175 ms, Python 222 passed/66.94 s | `.ralph/media-framework/video-2-v2-verify.log` |
| Final `npm run verify` | PASS, exit 0: Biome 75 files/25 ms/no findings, Ruff/typecheck/build (28 main modules/41 ms, 10 content modules/6 ms), JS 64 passed/0 failed/0 skipped/0 cancelled/14398.072792 ms, Python 222 passed/66.92 s | `.ralph/media-framework/video-2-v2-final-verify.log` |
| `git diff --check` and staged whitespace check | PASS, exit 0; no whitespace errors | CLI output, rerun before commit |

The preliminary API-only smoke on `about:blank` returned a TypeError because
`navigator.mediaDevices` was undefined there; that was not a media acceptance
result. The actual harness uses the secure loopback origin and obtained real
output tracks on both owned pages. A separate preliminary actual-WAV/video
experiment with an existing site source node yielded a captured audio track and
peak 0.15259254; the encoded VP8/Opus acceptance above supersedes that smoke.

Fixed causes without relaxing assertions: ignore queued initial capture-track
events belonging to the same track while rejecting later replacement audio;
measure steady decoded PCM with crossing intervals rather than a startup-silence
biased first-batch crossing count; disable processing in the test-only output
oracle and assert its actual settings/expected tone level. The original V1
assertions and V2 level/peak/frequency/cleanup thresholds were preserved.

### Remaining acceptance and next item

No environment/device/permission blocker was encountered for this V2 browser
scope. Real browser-output audio is verified; physical speaker/listener audibility
is unverified. This iteration does not establish speech accuracy, ASR/translation,
source-time mapping, the complete CORS/redirect/silence/mute/iframe/blob/MSE/DRM
matrix, simultaneous two-audible-video isolation, Japanese/English speech fixtures,
standalone Chrome host integration, Safari or physical iPhone support. V3–V5 and
all later stage checkboxes remain unfinished. No whole-framework claim is made.

Next unfinished item: V3 playback anchors, video/PCM time mapping and epoch
invalidation/cancellation for seek, pause/resume, rate and source changes. The
current conservative input termination at a discontinuity is not completion of
that item. No next item or stage was implemented during this iteration.

## 2026-10-06 — video iteration 3/5 (V3 partial, blocked)

Result: V3 remains **unchecked**. Playback-anchor and discontinuity plumbing is
implemented and its mock-port checks pass; real video/PCM mapping and
input-driven epoch cancellation acceptance is blocked. Commit: the
`feat: add video playback anchors and record audio blocker` commit containing
this report. No stage/framework/iPhone completion claim is made.

### Implemented scope and remaining verification

`audio-input.ts` now emits a `play` anchor before PCM. Both the anchor's
`monotonicMs` (`AudioContext.currentTime`) and capture frames (`currentFrame` in
that context's worklet) use the same fresh clock identity. The anchor observes
video `currentTime` and `playbackRate`; the existing core timeline can map ranges
without subtracting clocks from different execution contexts. No contracts,
core logic, models or interpretation providers changed.

Seek, pause, rate, source and end events synchronously stop PCM delivery, discard
queued batches, emit a terminal playback event with the **old** identity and
release only session-owned resources. The existing session controller consumes
that event, advances the epoch before cancel and rejects old-epoch results. The
adapter does not independently increment the epoch. Catalog retirement produces
`source`; a replacement element/source still requires reconfirmation and a new
handle, rather than automatically capturing an advertisement.

Same-session epoch reopening retains the original Start authorization only for
that session and target. A new session still needs user activation. Reopening
while seeking waits for `seeked` before acquiring the stream, then emits a fresh
context-clock anchor and resets audio sequence/range origin. Pagehide cancels
pending seek preparation. Pause remains the architecture's explicit resume flow:
the host must observe the user's resume and call the controller, which revalidates
and opens the input with its current identity. There is no standalone browser
host added or automatic resume claimed by this iteration.

The existing audio fixture now distinguishes playback events from PCM and
requires the initial `play` anchor. Every V1 and V2 assertion/threshold is
preserved. `tests/framework-video-input.test.ts` adds nine **mock-port** checks
for anchor ordering/clock equality/rate mapping, queued and late PCM rejection
for five discontinuities, source retirement, fresh clock/zero audio origin after
seek, activation scope, and pagehide preparation cleanup. These checks inject
PCM and simulate DOM/audio nodes; they establish contract/lifecycle behavior,
not decoded audio or speech recognition. The pre-change implementation fails
the unchanged initial-anchor assertion; the new implementation passes it.

### Real-audio blocker and independent attempts

Two isolated `npm run test:framework:video` attempts, before the production input
edit, passed V1/typechecking but failed the existing encoded-fixture assertion
at `tests/framework-video-audio.mjs:54`: `A real encoded video/audio fixture must
exist`. The second attempt added byte-count diagnostics and measured **110 bytes**
after the eight-second recorder run, below the unchanged >10000-byte requirement.
Neither attempt reached decoded video, original-output sampling or the new
anchor assertion. They are FAIL/BLOCKED, not V3 regressions or successful PCM
acceptance. No video-stage acceptance retry was made after those two attempts.

An explicit local diagnostic in a separate, newly owned Chromium instance
observed the real AudioContext and recorder; no user browser/profile or apps
were touched. Over three one-second observations:

| Elapsed wall time | Context state | AudioContext time | Drawing callback count | Page visibility | Recorder data chunks |
| --- | --- | --- | --- | --- | --- |
| ~1 s | running | 0.005333333333333333 s | 11 | visible | none |
| ~2 s | running | 0.005333333333333333 s | 21 | visible | none |
| ~3 s | running | 0.005333333333333333 s | 31 | visible | none |

The diagnostic recorder emitted a zero-byte chunk when stopped and no recorder
error event. The page timer advanced while the real audio rendering clock stayed
at 5.333 ms. Required real-time Chromium audio rendering is unavailable in this
run; the underlying OS/device/browser cause is **unverified**. Mock samples,
offline rendering, a dummy output device, muted-browser flags or another browser
would not establish the required real playback-output acceptance. None was used
to substitute success or bypass this blocker. No permissions/settings/user
apps/recordings/mounted images were changed. Diagnostic script/logs remain in
ignored `.ralph/media-framework/` and are not committed.

Resume condition: provide an environment where the test-owned Chromium's real
AudioContext clock advances and its existing eight-second encoded fixture and
independent tab-output oracle work. Rerun `npm run test:framework:video` with all
existing thresholds; then finish real seek/pause-resume/rate/source mapping
checks and delayed-result cancellation through the actual input/core composition.
Measure mapping error and confirm original playback through those transitions
before checking V3. Preserve V4/V5 and all later stages until their own evidence
passes. Human speaker/listener audibility and ASR/translation quality remain
unverified independently of this environment blocker.

### Commands and evidence

Requested worktree, Darwin arm64, Node v24.15.0/npm 11.12.1, uv 0.12.23,
Python 3.12.15, Chromium 153.0.8010.12 from both V1 runs. Root `AGENTS.md` and
`.ralph/media-framework/2026-10-06T12-10-53-313Z-video-verification.txt` were absent.
No dependency/model/app installation, delegation, push, publish or later stage.
Published companion v0.1.0, server/protocol/install paths, existing user settings,
active apps and unrelated files are preserved.

| Command/run | Actual result | Evidence |
| --- | --- | --- |
| First `npm run test:framework:video` | FAIL/BLOCKED, exit 1; adapter typecheck/V1 PASS, existing >10000-byte encoded-media assertion FAIL; V2/V3 not reached | `.ralph/media-framework/video-3-v3-regression.log` |
| Second independent `npm run test:framework:video`, byte diagnostic | FAIL/BLOCKED, exit 1; adapter typecheck/V1 PASS; same assertion FAIL, encoded media 110 bytes; V2/V3 not reached | `.ralph/media-framework/video-3-v3-regression-second.log` |
| `node .ralph/media-framework/video-3-generator-diagnostic.mjs` | Diagnostic exit 0, **not acceptance**; real context clock frozen at 5.333 ms, no encoded samples | CLI observations/table above; local script |
| Pre-change `node --import tsx --test --test-name-pattern='AudioContext anchor' tests/framework-video-input.test.ts` | EXPECTED FAIL, child exit 1, 0 passed/1 failed/74.684292 ms; `assert.ok("type" in value)` rejects PCM in place of initial anchor; wrapper restores edited input in `finally`, exit 0 | `.ralph/media-framework/video-3-v3-mock-regression.log` |
| Final `node --import tsx --test tests/framework-video-input.test.ts` | PASS, exit 0, 9 passed/0 failed/0 skipped/0 cancelled, 48.566958 ms; **mock-port scope only** | `.ralph/media-framework/video-3-v3-port-tests-final.log` |
| `./node_modules/.bin/tsc -p tsconfig.media-web.json` | PASS, exit 0, DOM/no-extension-ambient adapter compile | CLI output |
| `npm run test:framework:core` | PASS, exit 0, ES2022/no-DOM compiles and 31 passed/0 failed/0 skipped/0 cancelled, 126.609042 ms; existing mock engine/input cancellation and stale-result checks | `.ralph/media-framework/video-3-v3-core.log` |
| Targeted Biome on adapter/fixtures/new port tests | PASS, exit 0, 7 files/5 ms, no findings | CLI output |

| Final `npm run verify` | PASS, exit 0; Biome 76 files/31 ms/no findings, Ruff/typecheck/build (28 main modules/42 ms, 10 content modules/6 ms); JS 73 passed/0 failed/0 skipped/0 cancelled/14752.749583 ms; Python 222 passed/66.93 s | `.ralph/media-framework/video-3-v3-verify.log` |
| `git diff --check` | PASS, exit 0, no whitespace errors | CLI output |

Final real-audio acceptance is **UNVERIFIED/BLOCKED**; it is not rerun against
the same stalled renderer. V3–V5 remain unchecked. All intended changes, including
this report and the plan progress log, are included in the named commit; ignored
`.ralph` diagnostic state is excluded.

## 2026-10-06 — video iteration 1/5 (resumed run, V3)

Result: **V3 passes** real video/PCM mapping and input-driven core epoch
acceptance. V4/V5 remain unchecked; Stage video is incomplete. Commit: the
`fix: preserve selected video PCM timeline` commit containing this report.
The earlier blocked record remains historical evidence, not a current blocker.

### Resume evidence and implemented scope

Before retrying audio acceptance, the unchanged local, test-owned Chromium
generator diagnostic observed AudioContext time advancing to 0.976,
1.9786666666666666 and 2.981333333333333 seconds. Recorder parts were
14372/17058/18085 bytes, with no recorder errors. This is new evidence compared
with the prior frozen 5.333 ms clock; it justified resuming the actual acceptance.
No user browser, profile, device setting, app, recording or mounted image changed.
The underlying cause of the prior environment stall remains unknown.

The existing production input anchors and core timeline/controller are now
composed in a real-media harness. Its first run exposed a production batching
bug: a partially filled worklet batch could span a capture-clock jump. The next
batch then started at audio time 48 ms after a reported first batch ending at
42.666666666666664 ms. The worklet now discards an incomplete batch when input
channels disappear or `currentFrame` skips its expected position. It never fills
the missing interval with fabricated samples or rewrites the capture clock.
A gap after a delivered batch remains visible to the core's unchanged strict
gap check. Two processor regressions prove both partial-batch discard and that
later missing input/clock jumps still return `gap`, not `accepted`.

The real fixture server now serves byte ranges, Content-Length and Content-Range
for the encoded media. Without range support, the attempted seek to 3 seconds
returned to zero; correcting the server establishes an actual seek rather than
relaxing the timestamp assertion. Production resource loading is unchanged.
The harness bundles and serves actual core modules and their shared chunks.
`test:framework:video` also includes the nine existing input-port checks and two
new processor checks; it still runs every V1/V2 real-browser assertion.

### Actual mapping, epochs and original output

`tests/framework-video-timeline.mjs` and `tests/fixtures/video-timeline.html`
consume the same real 8-second, 132920-byte VP8/Opus 440 Hz video used by V2.
The production input provides actual mono float32/48 kHz decoded PCM to the
production core. Only inference is a generated delayed test-engine port; it
consumes real input ranges and deliberately completes after cancellation.
Neither PCM injection nor a model substitutes for the real input in this test.

Each owned page checks these transitions: Start at a nonzero video position,
seek to 3000 ms, rate 1 → 1.25, pause, explicit user resume, source replacement,
explicit new Start on the replacement, and Stop. The old source handle is
unavailable with `target-invalidated` and cannot silently adopt the replacement.
The source requires a new target and session. Pause retains comparison history
and stops real PCM/output; resume reprobes and opens a fresh input epoch.

| Final acceptance observation | Ordinary playback | Site-owned source graph |
| --- | --- | --- |
| Real PCM chunks observed | 55 | 55 |
| Maximum absolute mapped end time vs contemporaneous video currentTime | 64.513 ms | 20.367333333333136 ms |
| Mapping acceptance bound (set before measurement) | Every chunk <150 ms | Every chunk <150 ms |
| Fresh input epochs/clocks | Session 1 epochs 0/1/2/4, session 2 epoch 0; 5 distinct clocks | Same |
| Seek anchor video time | 3000 ms | 3000 ms |
| Rate and resumed anchors | Rate 1.25 for epochs 2/4 | Same |
| Baseline independent tab-output RMS | 0.042402341022025156 | 0.04244749534354694 |
| Output RMS through capture/transitions/Stop | 0.04137963980017511–0.042425620696573074 | 0.04230716424593729–0.04246032014759532 |
| Paused output RMS | 0 | 0 |
| Accepted generated result IDs | initial, seek, rate, resume | Same; no late-seek/rate/pause/source result |
| Page errors | `[]` | `[]` |

Every reopened epoch starts at sequence/audio origin zero, has at least five
real chunks and includes nonzero decoded tone samples (peak 0.12–0.18).
Capture frames and anchors share that epoch's AudioContext clock ID; no raw
`performance.now()` values from different contexts are subtracted. Mapped
duration equals PCM duration × observed playback rate within 0.001 ms. Actual
controller caption video ranges equal the independently observed input timeline
ranges exactly. The <150 ms observation bound covers this fixture's batch/message
timing; it is not an ASR latency, acoustic-content alignment or long-run drift claim.

Cancellation observes the incremented epoch before cancel for seek/rate/pause/
source; pause advances to epoch 3 and explicit resume to epoch 4. Overlay-clear
callbacks carry the retired identity, history survives pause, queued/late input
is covered by the preserved input-port tests, and delayed engine completions
never reappear as accepted captions. Original browser-output RMS stays within
the unchanged 12% bound at volume 0.4/muted=false through the transitions and
Stop, measured by the independent test-owned tab loopback with audio processing
disabled. There are no samples after pause or Stop.

### Exact commands and failures

Environment: requested worktree, Darwin arm64; Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15, Chromium 153.0.8010.12. Root/nested AGENTS.md and
the requested `2026-10-06T12-54-43-105Z-video-verification.txt` were absent.
Existing dependencies/caches were used. No installation, delegation, browser
access bypass, push, publish, later-stage work or companion/settings changes.

| Command/run | Exact outcome | Ignored local evidence |
| --- | --- | --- |
| Unchanged `node .ralph/media-framework/video-3-generator-diagnostic.mjs` | Diagnostic exit 0, advancing real clock/nonempty recorder parts above; not acceptance | `video-1-resume-clock-diagnostic.log` |
| Baseline `npm run test:framework:video` | PASS, exit 0; V1/V2 restored, real encoded video 132920 bytes; no V3 transition harness yet | `video-1-v3-baseline.log` |
| First expanded video acceptance | FAIL, exit 1; V1/V2 pass, timeline fixture ready timeout 30000 ms because shared bundle chunks were not served | `video-1-v3-transitions-first.log` |
| Expanded acceptance after shared-chunk fix | FAIL, exit 1; initial-epoch timeout 10000 ms; only one real chunk before core failure | `video-1-v3-transitions-bundle-fix.log` |
| Acceptance with lifecycle diagnostic | FAIL, exit 1; real input terminates at startup; statuses running → failed/engine-failed → stopping → idle, one chunk | `video-1-v3-transitions-diagnostic.log` |
| Acceptance with PCM-order diagnostic | FAIL, exit 1; second real batch starts at 48 ms vs previous end 42.666666666666664 ms, strict timeline returns gap | `video-1-v3-pcm-order-diagnostic.log` |
| Processor regression before fix | EXPECTED FAIL; 0 passed/1 failed/87.854375 ms, first batch frame 0 vs required 640; wrapper's following cat exited 0 | `video-1-v3-worklet-regression.log` |
| Missing-input-only worklet fix | Processor PASS, 1/0/44.094958 ms; real acceptance FAIL, exit 1, same timestamp gap; no threshold changed | `video-1-v3-worklet-fix.log` |
| Added clock-jump processor regression before clock fix | EXPECTED FAIL, exit 1; 1 passed/1 failed/91.526958 ms, first frame 0 vs 640 | CLI output |
| Final processor regressions | PASS, exit 0; 2 passed/0 failed/0 skipped/0 cancelled/44.146875 ms | `video-1-v3-worklet-tests.log` |
| Real acceptance after clock-jump fix | FAIL, exit 1; startup/core now advance, actual seek returns to zero and caption range fails >=2900 ms assertion | `video-1-v3-clock-gap-fix.log` |
| Final `npm run test:framework:video` after fixture byte-range fix | PASS, exit 0; adapter compile, 11 port/processor tests passed/0 failed/0 skipped/0 cancelled/49.676625 ms, V1/V2 and both V3 real-media cases above | `video-1-v3-seek-range-fix.log` |
| Initial targeted Biome | FAIL, 2 noAssignInExpressions errors; corrected both fixture assignments | CLI output |
| Final targeted Biome | PASS, exit 0; 9 files/5 ms/no findings | CLI output |
| First `npm run verify` (before production gap fixes) | PASS, exit 0; Biome 78 files/48 ms, Ruff/typecheck/build 28+10 modules, JS 73/0/0 skipped/0 cancelled/14581.829375 ms, Python 222 passed/66.89 s | `video-1-v3-verify.log` |
| `npm run verify` after final production gap fix, before final fixture server fix | PASS, exit 0; Biome 79 files/48 ms/no findings, Ruff/typecheck/build (28 modules/59 ms, 10 modules/7 ms); JS 75/0/0 skipped/0 cancelled/15032.733666 ms; Python 222 passed/66.96 s | `video-1-v3-final-verify.log` |
| Final `npm run verify`, all final code/fixtures | PASS, exit 0; Biome 79 files/28 ms/no findings, Ruff/typecheck/build (28 modules/33 ms, 10 modules/6 ms); JS 75 passed/0 failed/0 skipped/0 cancelled/14342.633083 ms; Python 222 passed/66.91 s | `video-1-v3-committed-tree-verify.log` |
| Final `git diff --check` and `git diff --cached --check` | PASS, exit 0, no whitespace errors; includes final report/plan | CLI output |

All logs referenced above are under `.ralph/media-framework/` and remain ignored.
The standalone `python` formatting helper exited 127 without changing files;
the existing project `uv run --locked python` performed the edit successfully.
This is not a required-environment blocker. Final whole-tree verify and
whitespace results are recorded in the table above. All intended changes are
included in the named commit; temporary diagnostic state is excluded.

### Unverified scope and next item

V3 is checked only after real mapping/epoch/input/output acceptance passed.
There is no current environment/device/permission blocker for this tested
Chromium scope. Physical speaker/listener audibility, speech/ASR/translation
accuracy, acoustic-content timestamp accuracy, long-run drift, Safari/iPhone and
standalone host integration remain unverified. The current result does not
complete the full media-access matrix or simultaneous two-audible-video isolation.

Next unfinished item: **V4** CORS allowed/denied, genuine silence, muted video,
cross-origin iframe, blob/MSE and protected-media route classification, preserving
original playback and explicitly rejecting unproven access. V4/V5 and every
later stage remain unchecked. No later item was implemented in this iteration.
Published companion v0.1.0, installation/server/protocol paths and existing user
settings remain untouched. Credentials, weights, user media/transcripts and
temporary `.ralph` state are excluded from the commit.

## 2026-10-06 — video iteration 2/5 (resumed run, V4)

Result: **V4 passes** route classification and real browser playback preservation.
V5 remains unchecked; Stage video is incomplete. Commit: the
`feat: classify selected video media access` commit containing this report.

### Input scope and access proof

The existing selected-element `captureStream → Web Audio → worklet` path is
retained. The catalog exposes its local frame identity so the input explicitly
rejects foreign-frame handles with `frame-permission-required`. Parent discovery
still does not traverse frame DOM. Each permitted frame owns its own adapter.

CORS-mode HTTP media is eligible for Start. Eligibility is **not sample access
proof**: the browser's actual `captureStream()` origin-clean check remains the
gate. Its native SecurityError is reported with `media-access-denied` and owned
preparation resources are released. An existing no-CORS resource cannot be made
capturable by a permissive response header or a late crossOrigin attribute.
A same-origin-looking URL that redirects to inaccessible cross-origin media
also fails the native check. No production fetch, crossOrigin assignment, reload,
source-node rerouting, mute change or tab-mix fallback is introduced.

Ordinary blob and real MSE playback are conservatively `media-route-unknown`;
neither a blob's origin nor its availability for download proves this adapter's
route. A real attached Clear Key MediaKeys object is `protected-media`, even for
the fixture's clear payload. This verifies the conservative protected-route guard;
encrypted payload, licenses and decryption are **unverified and unsupported**.
Unknown routes are rejected while their original playback continues.

Genuine encoded silence remains available and supplies near-zero decoded PCM.
A muted tone remains available and supplies nonzero decoded PCM while the
original playback output stays muted. No zero-sample heuristic labels either as
an access denial. Route/Start errors are input-port results; wiring a standalone
host's user-facing status display remains later-stage work.

### Actual media and playback evidence

`tests/framework-video-access.mjs` and `tests/fixtures/video-access.html` run as
part of the unchanged `npm run test:framework:video` command, after every existing
V1/V2/V3 assertion. The fixture server serves CORS-permitted/denied resources and
a real HTTP redirect on two loopback origins (`127.0.0.1` and `localhost`).
Two real MediaRecorders encode an eight-second 160×90 VP8/Opus tone and silence;
the final files are **147286** and **21622 bytes**. Synthetic frame numbers keep
both encoded video fixtures above the unchanged >10000-byte requirement.
Generated media stays in memory; no user audio or transcripts are used.

Final serial acceptance observations (RMS values are actual independent browser
tab-output PCM, with audio processing and local-playback suppression disabled):

| Route | Actual input result | Baseline output RMS | After Stop/rejection RMS |
| --- | --- | --- | --- |
| CORS-mode load, ACAO `*` | Available; 11 real chunks, peak 0.15105554461479187 | 0.04237199701293925 | 0.04229652185648752 |
| Cross-origin load, no CORS permission/mode | `media-access-denied`, 0 chunks | 0.042450689157224386 | 0.04242723660795439 |
| ACAO `*` but resource loaded without CORS mode | `media-access-denied`, 0 chunks | 0.04239205771492109 | 0.04238349935125653 |
| No-CORS playback, attribute changed to anonymous after load | Eligible at probe; native capture SecurityError → `media-access-denied`, 0 chunks | 0.04241134400814177 | 0.04238609016376156 |
| Same-origin URL → cross-origin no-CORS redirect | Eligible at probe; native capture SecurityError → `media-access-denied`, 0 chunks | 0.04241728486891036 | 0.042391961810427724 |
| Encoded genuine silence | Available; 11 real chunks, peak 2.0345869483764863e-34 | 8.137982825476283e-35 | 8.137984608355612e-35 |
| Muted encoded tone | Available; 11 real chunks, peak 0.15105554461479187 | 0 | 0 |
| Ordinary blob playback | `media-route-unknown`, 0 chunks | 0.042406917975572785 | 0.04242615820887474 |
| Real MediaSource/SourceBuffer playback | `media-route-unknown`, 0 chunks | 0.042307423097040414 | 0.042383291035958136 |
| Real MediaKeys attached | `protected-media`, 0 chunks | 0.04242404447567434 | 0.04241636109996062 |

All during/after output levels pass the unchanged 12% baseline bound for audible
routes; silence/mute stay below 0.001. Audible baselines also match the encoded
tone's expected `0.15 * 0.4 / sqrt(2)` within 12%. During values and full JSON
are in `.ralph/media-framework/video-2-v4-serial-acceptance.log`.
Every route preserves exact `src`, `currentSrc`, `crossOrigin`, volume, mute,
rate, paused state and reload count through probe/Start/Stop. Playback advances
more than 0.4 seconds. Rejected routes deliver no PCM; supported routes stop
delivery and tolerate repeated Stop. Every page has `pageErrors: []`.

The controlled cross-origin iframe has an explicitly owned adapter. Parent
native DOM access still throws SecurityError, parent discovery returns only its
one video, and a foreign-frame probe returns permission-required/
`frame-permission-required`. The frame's own activated Start captures five real
tone chunks; its original output after Stop is **0.04221221158992649 RMS**.
This is permitted local frame-owner testing, not a browser-access bypass or
proof of extension permission installation on arbitrary sites. The parent's
video is deliberately paused by the fixture before testing the frame's output;
simultaneous two-audible-video isolation remains V5.

Existing V3 real input/core acceptance still observes 55 chunks in each ordinary
and site-owned graph case, with maximum mapping errors **57.51900000000023** and
**28.036333333333914 ms**, both below the unchanged every-chunk <150 ms bound.
Seek/pause/resume/rate/source cancellation, late generated-engine result rejection
and original output assertions all pass. No engine/model/ASR/translation was added.

### Exact command results and failures

Environment: requested worktree, Darwin arm64, Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15, Chromium 153.0.8010.12. Root/nested AGENTS.md and
the requested `2026-10-06T12-54-43-105Z-video-verification.txt` were absent.
All log names below are under ignored `.ralph/media-framework/`.

| Command/run | Exact result | Evidence |
| --- | --- | --- |
| Baseline `npm run test:framework:video` | PASS, exit 0; existing V1/V2/V3 before V4 changes | `video-2-v4-baseline.log` |
| Before-fix `node --import tsx --test --test-name-pattern='CORS\|foreign-frame' tests/framework-video-input.test.ts` | EXPECTED FAIL, Node child exit 1, 0 passed/2 failed/104.073916 ms; log-printing shell wrapper exit 0 | `video-2-v4-port-regression.log` |
| After-fix `node --import tsx --test tests/framework-video-input.test.ts` | PASS, exit 0, 11 passed/0 failed/0 skipped/0 cancelled/76.64525 ms; **mock-port scope only**, including denial cleanup and pre-resource guards | CLI output |
| First expanded `npm run test:framework:video` | FAIL, exit 1; silent encoded fixture 7256 bytes below >10000; actual audio/matrix checks not reached | `video-2-v4-first-acceptance.log` |
| Expanded video acceptance after changing synthetic picture frames | FAIL, exit 1; V1/V2/V3 pass, CORS real PCM captured, then 10000 ms timeout because fixture assigned read-only `window.closed` | `video-2-v4-changing-frames.log` |
| Video acceptance after `captureClosed` flag fix | PASS, exit 0; 13 port/worklet tests/48.045208 ms, V1–V4 real matrix including all ten cases and owned frame | `video-2-v4-capture-closed-fix.log` |
| First `npm run verify` | FAIL, exit 1; Biome 81 files/38 ms and Ruff PASS, typecheck TS2339 on four new test Capability `.reason` accesses; build/tests not reached | `video-2-v4-verify.log` |
| Video acceptance run concurrently with final verify | FAIL, exit 1; 13 port/worklet tests PASS, V1 PASS, existing V2 first-round frequency 454.4792425345958 Hz exceeds unchanged 440 ±12 Hz bound; V3/V4 not reached | `video-2-v4-final-acceptance.log` |
| Final `npm run verify`, after explicit test union narrowing | PASS, exit 0; Biome 81 files/25 ms/no findings, Ruff/typecheck/build (28 main modules/44 ms, 10 content modules/7 ms); JS 77 passed/0 failed/0 skipped/0 cancelled/15110.082291 ms; Python 222 passed/67.01 s | `video-2-v4-final-verify.log` |
| One independent serial `npm run test:framework:video`, after verify finished | PASS, exit 0; adapter compile, 13 port/worklet tests/0 failed/0 skipped/0 cancelled/49.190459 ms, all V1–V4 browser assertions and final measurements above | `video-2-v4-serial-acceptance.log` |
| Targeted Biome and standalone adapter typecheck | PASS, exit 0; Biome 8 files/4 ms/no findings; `tsc -p tsconfig.media-web.json` no errors | CLI output |
| Final `git diff --check` and `git diff --cached --check` | PASS, exit 0, no whitespace errors, including report/plan | CLI output |

The single 454.479 Hz failure's cause is **unverified**. No frequency/output/
mapping assertion was weakened and no PCM was repaired or fabricated. After
verify finished, one independent serial run passed all unchanged criteria.
There is no current required-environment blocker; the failed run remains evidence
and must not be hidden by the passing run. No acceptance retry follows this pass.

### Unverified scope and next item

V4 is checked only after the actual route/output matrix and both required final
commands pass. Protected-media decryption, arbitrary-site compatibility,
extension frame permissions, physical speaker/listener audibility, speech/ASR/
translation accuracy, standalone host UI, Safari and physical iPhone remain
unverified. Mocks and near-zero PCM are not transcription-accuracy evidence.

Next unfinished item: **V5** Japanese/English ordinary speech-video fixtures and
simultaneous two-audible-video selection isolation, with real PCM/playback/mapping
measurements. V5 and every later-stage checkbox remain unchanged. No whole-stage,
whole-framework or iPhone completion is claimed. Published companion v0.1.0,
installation/server/protocol paths and user settings/apps/recordings/mounted
images are preserved. Existing caches were used; no installation, delegation,
push, publish or blocked-access bypass occurred. Credentials, weights, user
audio/transcripts and temporary `.ralph` state are excluded from the commit.

## 2026-10-06 — video iteration 3/5 (resumed run, V5)

Result: **V5 and Stage video pass** the required real input acceptance and
whole-tree verification. V1–V5 are checked; later stages remain unfinished. Commit: the
`test: verify selected speech video isolation` commit containing this report.
Only V5 was implemented; later-stage work was not started.

### Fixtures and input scope

Added committed, synthetic Japanese/English ordinary HTTP video files under
`tests/fixtures/video-speech/`. They contain local macOS `say` speech from the
already installed Kyoko/Samantha voices, repeated in 24-second 320×180 VP8/Opus
videos. Japanese is **450500 bytes**, SHA-256
`6cf37e5d26eda80957c97cc9785e474357a3e8ca53a62d4dd4782727912593ff`;
English is **446449 bytes**, SHA-256
`eaa1416429c5bb037614035eafbbf01e5ef2292a65c162ee48acc2565cc8a615`.
The manifest preserves the synthetic source texts, Korean meaning anchors,
voices, speech durations (6.972229166666667/6.666479166666667 seconds), generation
provenance and hashes. These are fixture labels, not recognized/translated output.
There is no user audio or transcript. No model or voice installation occurred.

Optional regeneration: `node tests/fixtures/video-speech/generate.mjs` requires
those installed macOS voices and an existing Playwright Chromium. It uses only
an owned local browser/server; raw synthetic WAVs stay in ignored `.ralph`.
Acceptance reads the committed videos and verifies their hashes, and does not
require macOS speech synthesis or regenerate binaries. Browser encoding can
change bytes, so regeneration also updates the manifest.

`tests/fixtures/video-speech.html` mounts the production selection/catalog/input
and core timeline. Two visible videos both play throughout three captures:
Japanese, repeat Start on Japanese, then explicit selection of English. A second
page repeats all three with real pre-existing site-owned source nodes for both
videos. User playback states stay Japanese volume 0.4, English volume 0.25,
muted=false, rate=1, paused=false, with unchanged sources/CORS attributes.
Only the selected element's `captureStream → Web Audio → worklet` provides PCM.
No production module, companion protocol, published companion v0.1.0, install
path or user setting was changed.

### Independent oracles and acceptance bounds

`tests/framework-video-speech.mjs` is appended to the existing stage harness;
every existing V1–V4 assertion/threshold still runs. A separately decoded copy
of each committed file provides reference speech only, never input-port samples.
Four 3 kHz low-pass biquads suppress the 6500/9000 Hz fixture isolation tags.
The most energetic half-second captured speech window must have RMS >0.008 and
normalized correlation >0.85 with the selected reference. The selected reference
search is within ±250 ms of the mapped position, at eight-sample steps followed
by single-sample refinement. The wrong-source comparison sweeps its first
14 seconds at 10 ms steps and must remain <0.35. This is waveform/source identity
checking, **not ASR or translation accuracy**. It is not an exhaustive wrong-file
correlation search or a long-run acoustic timestamp guarantee.

Each encoded file includes its own continuous 0.06-amplitude isolation tag.
Captured selected-tag amplitude must remain within 12% of 0.06; the unselected
video's tag must remain <0.003. Tag amplitude uses RMS power of 1024-sample Hann
windows, so phase changes cannot cancel a present source across a long interval.
The independently decoded references also pass the same tag presence/absence
checks. Selected-speech identity and independent tag exclusion together reject
substitution of the other video or use of the whole-tab mix.

The test-owned tab loopback is solely an independent playback oracle. It measures
both original output tags before/during/after each selected capture, requiring
amplitude within 12% of expected user-volume levels **0.024/0.015** and within 12%
of baseline. Actual AGC, echo cancellation, noise suppression and local playback
suppression settings are all false. A 500 ms initial wait fills the loopback
transport/analyser window; it does not repair samples. No other user tab,
microphone, system audio or existing user browser/profile is accessed.

Every chunk is real mono float32/48 kHz PCM, 8192 bytes, with consecutive sequence
and matching session/target/epoch. The production timeline accepts every chunk
without gaps; each capture's playback anchor and PCM share one context clock.
Mapped PCM duration must agree within 0.001 ms, and every mapped end must stay
within the existing <150 ms bound of contemporaneous selected-video currentTime.
No raw clocks from different contexts are subtracted. Stop is idempotent and
must end delivery; both videos must advance >6 seconds through the three rounds.

### Final real measurements

Final serial `npm run test:framework:video`, exit 0, Chromium 153.0.8010.12:

| Playback graphs / selected round | Real chunks | Selected speech correlation | Wrong speech correlation | Speech RMS | Selected / unselected tag amplitude | Maximum mapping error |
| --- | --- | --- | --- | --- | --- | --- |
| Ordinary / Japanese Start | 60 | 1.000000 | 0.164628 | 0.039920 | 0.060108 / 0.000543 | 3.285667 ms |
| Ordinary / Japanese repeat | 59 | 1.000000 | 0.143934 | 0.041216 | 0.060199 / 0.000324 | 3.204000 ms |
| Ordinary / English selection | 59 | 0.992871 | 0.149958 | 0.045265 | 0.059830 / 0.001000 | 4.214333 ms |
| Site-owned / Japanese Start | 59 | 1.000000 | 0.122749 | 0.039636 | 0.059834 / 0.000547 | 0.760667 ms |
| Site-owned / Japanese repeat | 60 | 1.000000 | 0.126805 | 0.041132 | 0.060170 / 0.000436 | 2.576333 ms |
| Site-owned / English selection | 58 | 0.980234 | 0.212450 | 0.045744 | 0.059976 / 0.001108 | 2.574000 ms |

There are **355** real V5 chunks across six captures. Ordinary baseline output
tags are 0.024030307556010523/0.015069822758528454; site-owned baseline tags are
0.024096912453999857/0.0150827599434453. All during/after levels pass both unchanged
12% output bounds; Japanese output spans 0.02389846036201667–0.0242746783593005,
English output spans 0.014947580202868562–0.015124776337104445. Both original videos
advance 9.478854/9.478863 seconds (ordinary) and 9.375648/9.375649 seconds
(site-owned). All pages have `pageErrors: []`, exact playback states are preserved,
and there is no PCM after Stop. Selected waveform match offsets in the local
±250 ms search range from -71.6455 to -0.333333334 ms; these are distinct from the
contemporaneous video-position mapping errors and do not establish ASR timing.

The same final stage run also revalidates all prior video scope: V1 identity/UI,
V2 real output/three restarts per graph/overflow, V3 55 real chunks per graph with
maximum mapping errors **67.38999999999942/28.072333333333518 ms**, cancellation
and stale generated-engine result rejection, and V4 ten route cases plus the
owned cross-origin frame. Real runtime tone/silence are 147286/21622 bytes.
No PCM acquisition, mock engine event or decoded reference is called recognized
speech or a Korean subtitle.

### Exact commands, failures and evidence

Environment: requested worktree, Darwin arm64; Node v24.15.0/npm 11.12.1,
uv 0.12.23/Python 3.12.15, Chromium 153.0.8010.12. Root/nested AGENTS.md and the
requested `2026-10-06T12-54-43-105Z-video-verification.txt` were absent. The
user-supplied Agent Core instructions were followed. Logs/scripts/bundles/raw
synthetic WAVs named below remain ignored under `.ralph/media-framework/`.

| Command/run | Exact outcome | Local evidence |
| --- | --- | --- |
| `node tests/fixtures/video-speech/generate.mjs` | PASS, exit 0; two real encoded synthetic speech videos with sizes/hashes above; fixture generation, not acceptance | `video-3-v5-generate.log` |
| First expanded `npm run test:framework:video` | FAIL, exit 1; 13 port/worklet tests PASS (55.349125 ms), all V1–V4 PASS; V5 baseline tags 0.012343929318266892/0.008652159913031917 fail 12% expected-output bound before capture | `video-3-v5-first-acceptance.log` |
| First `node .ralph/media-framework/video-3-v5-diagnostic.mjs` | Diagnostic FAIL, exit 1; helper attempted to serve nonexistent favicon bundle; no acceptance | `video-3-v5-output-diagnostic.log` |
| Diagnostic after helper 404 fix | Diagnostic PASS, exit 0; decoded tags 0.059790095284170876/0.05994606459915941; early observation 0.007443820336273424/0.005824384190492887 rises to 0.024043493278875082/0.015025096203143618 on next observation; strongest bins stay 6500/9000 Hz | `video-3-v5-output-diagnostic-fixed.log` |
| `node .ralph/media-framework/video-3-v5-targeted.mjs`, after loopback warm-up | FAIL, exit 1; first Japanese capture passes; second has 60 real chunks, selected low-pass speech correlation 1.0/wrong 0.16957981050486484, but long-window selected-tag projection 0.029800045401415974 fails the unchanged 12% bound | `video-3-v5-targeted.log` |
| `node .ralph/media-framework/video-3-v5-tag-diagnostic.mjs` | Diagnostic PASS, exit 0; both decoded files' first 12 one-second windows show own tags near 0.06; short-window power detects each tag without long-window phase cancellation; not acceptance | `video-3-v5-tag-diagnostic.log` |
| Targeted V5 after short-window power measurement | PASS, exit 0; all six actual captures, both playback graph modes; selected correlations 1.0, wrong maximum 0.20703848085286755, mapping maximum 5.497333333333245 ms | `video-3-v5-short-window.log` |
| Initial targeted Biome | PASS, exit 0; 5 files/23 ms, one approximate-constant warning; corrected to Math.SQRT1_2 | CLI output |
| Final targeted Biome | PASS, exit 0; 5 files/17 ms/no findings | CLI output |
| Final `npm run test:framework:video` | PASS, exit 0; adapter compile, 13 port/worklet tests/0 failed/0 skipped/0 cancelled/54.665125 ms, all V1–V5 actual browser assertions and measurements above | `video-3-v5-final-acceptance.log` |
| Final `npm run verify` | PASS, exit 0; Biome 85 files/41 ms/no findings, Ruff/typecheck/build (28 main modules/43 ms, 10 content modules/6 ms), JS 77 passed/0 failed/0 skipped/0 cancelled/15076.266834 ms, Python 222 passed/66.96 s | `video-3-v5-final-verify.log` |
| Final `git diff --check` and `git diff --cached --check` | PASS, exit 0; no whitespace errors, including final report/plan; rerun before commit | CLI output |

The initial output failure was traced to an unfilled loopback observation window.
The long-window captured-tag discrepancy's underlying phase/transport cause is
**unverified**; it is not silently labeled a production fix. Short-window power
measures the actual tag presence without coherent cancellation, while all PCM,
sequence, gap, mapping, source-correlation and output criteria remain enforced.
There is no sample fabrication, timestamp repair, output gain change, route
fallback, blocked-access bypass or acceptance retry after the final full pass.
All failed runs remain documented. No production capture behavior was changed.

### Unverified scope and completion boundary

This evidence covers actual selected speech-video PCM, simultaneous two-audible
video isolation, input/clock ordering, short-run video mapping, real browser-output
preservation and cleanup in the owned Chromium fixtures. Physical speaker/listener
hearing, speech recognition/translation accuracy, long-run content alignment/drift,
external-site compatibility, extension installation/frame permissions, encrypted
media decryption, standalone host integration, Safari and physical iPhone remain
**unverified**. These belong to later acceptance or unsupported scope, not V5 PCM
claims. V5 runs no recognizer, translator or real model.

Only V5 is newly checked after both required final commands passed. Stage video
completion does not mean whole-framework or iPhone completion. No current required
Chromium environment/device/permission blocker remains in the tested scope. Plan,
runner, companion, user settings, unrelated files, existing apps/recordings/mounted
images and later-stage checkboxes are preserved. No installation, other agents,
push or publishing occurred. Credentials, weights, user audio/transcripts and all
temporary `.ralph` state are excluded from the commit.


## 2026-10-08 — completed-video recheck: replacement-output startup

The `all` run passed its core recheck, then stopped in the completed video's V3
acceptance before starting Chrome. The regression was
`Original output through transition` at the replacement source's first output
measurement: ordinary playback baseline **0.04246887152389713**, replacement
**0.03538971938093776** (16.67% lower), exceeding the unchanged 12% bound.
The failure snapshot placed replacement playback at **0.191086 seconds**.
Evidence: `.ralph/media-framework/2026-10-08T00-52-38-744Z-video-verification.txt`.

The harness awaited `video.play()` and a 250 ms wall-clock observation delay,
without first requiring the replacement's decoded playback to advance.
`play()` completion alone does not establish a filled independent loopback
observation window. V3 now waits for actual replacement playback to reach
0.5 seconds before the existing measurement. A stalled replacement still fails
Playwright's bounded wait; the output/volume/mute/PCM/epoch assertions remain.
Production playback/input, output gain, fixture content and runner are unchanged.
The original low sample's exact transport/decoder cause is unverified; this
change removes the missing playback-readiness precondition, rather than claiming
an established production gain defect.

An unchanged diagnostic V3 run passed both graphs; a no-input diagnostic passed
20 source replacements. Neither reproduces a persistent gain loss. The first
broader diagnostic later failed V5 selected-Japanese PCM correlation
(**0.8269517449646506**, required >0.85). Its cause is unverified; V5 was not changed.
Evidence: `video-transition-before.log` and `video-replacement-before.log` under
ignored `.ralph/media-framework/`.

Final `caffeinate -disu npm run test:framework:video`: **PASS**, all 13 port/worklet
tests and V1–V5 browser gates. Ordinary replacement output was
**0.042373914364523646**, baseline **0.04237058498067174**; site-owned graph
replacement **0.04221966343690239**, baseline **0.04239380953340751**.
V3 maximum mapping errors were **67.849 ms / 28.061333333334005 ms**, below 150 ms.
Evidence: `.ralph/media-framework/video-transition-fixed.log`.
Targeted Biome and `git diff --check`: **PASS**.
`caffeinate -disu npm run verify`: **PASS**, Biome 106 files, Ruff, typecheck,
build, **100 JavaScript / 222 Python tests** (Python 66.91 s).
Evidence: `.ralph/media-framework/video-transition-verify.log`.
Later stages remain incomplete.
