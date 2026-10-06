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
