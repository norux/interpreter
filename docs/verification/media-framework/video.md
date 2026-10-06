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
