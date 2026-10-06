# Verification evidence

## Iteration 1 — project scaffold (2026-10-05)

Checkout: `/Users/norux/orca/workspaces/interpreter/aspidochelone`.
Checklist item 1 passed. These checks establish the build and health endpoint,
not tab capture or translation.

### Environment and dependencies

- macOS arm64; Node v24.15.0; npm 11.12.1.
- System Python was 3.9.6; uv was absent from PATH.
- Installed uv 0.12.23 in the ignored repository-local `.tools/uv` environment.
  `uv sync` downloaded CPython 3.12.15 and created `.venv`.
- Locked Vite 8.3.2, TypeScript 7.0.2, FastAPI 0.142.2, Uvicorn 0.54.0,
  and their dependencies in `package-lock.json` and `uv.lock`.
- No MLX, Ollama, model weights, or cloud inference dependencies are required
  by this scaffold. Model dependencies will be selected with the actual adapters.

Commands executed successfully from this checkout:

```sh
python3 -m venv .tools/uv
.tools/uv/bin/python -m pip install uv
.tools/uv/bin/uv sync
.tools/uv/bin/uv run --locked python --version
# Python 3.12.15
.tools/uv/bin/uv lock --check
npm ci
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
git diff --check
```

The final verification after `npm ci` passed JS/Python lint, TypeScript checks,
production build, one JS build test, and one Python health test. No tests were
skipped and the final run emitted no warnings. The dependency reinstall reported
zero vulnerabilities.

### Extension build acceptance

`extension/dist/manifest.json` parses as JSON, declares Manifest V3, a module
service worker, popup, Chrome minimum version 116, and tabCapture/offscreen/
activeTab/scripting permissions. All declared entries exist. The build also
contains `offscreen.html`, `offscreen.js`, `worklet.js`, and `content.js`;
offscreen HTML references its compiled script. HTML script references resolve
to files in the build and contain no uncompiled TypeScript URLs.

The service worker, worklet, and content entries are intentionally inert scaffold
modules. The offscreen entry and popup only state that capture is unimplemented.
Their presence is packaging evidence, not working audio or captions.

### Running companion acceptance

Started the actual server under the uv-managed Python 3.12 environment:

```sh
.tools/uv/bin/uv run --locked uvicorn server.app:app --host 127.0.0.1 --port 8765
```

From another command, executed:

```sh
curl --fail --silent --show-error -i http://127.0.0.1:8765/health
```

Observed `HTTP/1.1 200 OK`, `content-type: application/json`, and
`{"status":"ok"}`. Uvicorn logged successful startup and the health request.
Stopped it with SIGINT; shutdown completed and the process exited with code 0.
This verifies a real loopback HTTP listener in addition to the in-process test.

### Failed checks and fixes

- Initial TypeScript check failed with TS2882 for the CSS import. Added
  `vite/client` asset declarations; subsequent type checks passed.
- Artifact inspection found Vite removed the empty offscreen module. Strengthened
  the build test to require `offscreen.js` and its HTML reference, observed the
  test fail with ENOENT, then added the offscreen scaffold status entry. The
  rebuilt artifacts passed the stronger check.
- Running verification again exposed linting of generated minified `dist` files.
  Enabled Biome's Git ignore handling so lint applies to source, while build
  tests still inspect generated artifacts. Repeated verification passed without
  changing source lint rules.
- Initial health test passed with Starlette's deprecated `httpx` warning.
  Used its currently documented `httpx2` dependency and refreshed the uv lock;
  the final health test passed without that warning.

Compatibility references checked during setup:
[Vite](https://vite.dev/guide/),
[uv projects](https://docs.astral.sh/uv/guides/projects/),
[FastAPI](https://fastapi.tiangolo.com/tutorial/first-steps/),
[Chrome offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen),
[Starlette TestClient](https://starlette.dev/testclient/).

### Pending verification

No browser was launched or extension loaded in this iteration. Actual tab audio,
original playback, captions, fullscreen/YouTube, local models, performance, and
cloud adapters/live calls remain unimplemented and unverified. No claim about
browser access availability is made yet. Item 2 must implement the feature-local
contracts and capture transport, then run its actual Chrome acceptance checks.

## Iteration 2 — capture implementation, acceptance blocked (2026-10-05)

Item 2 remains unchecked. This checkout now has capture/PCM/session transport
code and small feature-local input, model, and output contracts. Models and
caption rendering are unimplemented. No user audio or transcript was used,
recorded, or committed. No cloud keys were sought or cloud inference requested.

### Automated checks that passed

```sh
npm install --save-dev --save-exact playwright@1.63.0
npx playwright install chromium
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
PATH="$PWD/.tools/uv/bin:$PATH" npm run test:capture-browser
npm ci
.tools/uv/bin/uv lock --check
git diff --check
```

Final verification: lint/typecheck/build, 6 JS tests and 16 Python tests passed;
no skips or warnings. JS checks cover little-endian PCM16, stereo downmix,
clipping, silence, 20 ms positions, fractional 44.1 kHz resampling across 128
sample quanta, and releasing resources when Stop races with pending stream or
worklet acquisition. Python checks cover exact origin and loopback host denial,
unset origin configuration, single-use/expired/wrong tokens, three transport
start/stop cycles, actual in-process binary frame receipts, and malformed PCM.
Invalid sizes/alignment, WAV magic, rates, channel count, version, sample count,
sequence, non-finite/wrong timestamps, and text instead of binary close with an
error. These tests do not establish real tab capture.

The transport uses a 28-byte little-endian `PCM1` header with rate, sequence,
relative audio timestamp (ms), sample count, version and channels. Each packet
contains 480 mono PCM16 samples at 24 kHz. Server receipt counters come from
validated packets, not a fixture caption. The browser transport refuses more
than one second of queued packets. Server commands set a 4096-byte WebSocket
message limit and an eight-message receive queue. Slow model/backlog behavior
still belongs to the later model/session work.

### Actual browser worklet and loopback evidence (not tab capture)

Playwright 1.63.0 downloaded its official Chrome for Testing 153.0.8010.12 to
the normal Playwright cache. `npm run test:capture-browser` builds the extension,
creates its dedicated profile under ignored `.ralph/`, launches a companion
with the exact loaded extension ID, and shuts both down after checking them.
It does not depend on native Accessibility permissions or an API key.

Observed final stdout:

```json
{"browser":"153.0.8010.12","inputRate":44100,"frames":50,"samples":24000,"peak":3275,"tabCapture":"not exercised"}
```

The smoke loads the actual extension and offscreen document, checks runtime
worker→offscreen status messaging, obtains HTTP 200 from a running `/health`,
and uses the actual extension-origin POST `/sessions` and authenticated binary
WebSocket. A generated non-sensitive 440 Hz tone at 44.1 kHz runs through the
built AudioWorklet into the companion, which validates 50 frames and counts
24,000 samples. The generated signal and tokens exist only in memory. The
smoke explicitly does **not** call tabCapture or claim audible original playback,
popup lifetime, tab closure, model inference, captions, or visual acceptance.

### Attempted real tab capture and exact blocker

Installed regular Chrome reported `Google Chrome 154.0.8037.93`; only its
version was queried. The headed capture attempt used Chrome for Testing
153.0.8010.12, a dedicated `.ralph/capture-profile`, and this checkout's unpacked
`extension/dist`. The extension ID was
`njkbhbpbdgplmegajekncppbhpjbpkop` (non-secret; another path/profile may differ).
An actual loopback companion was started with this ID and WebSocket limits.
The non-sensitive stereo fixture in `tests/fixtures/audio.html` was served on
127.0.0.1:8766 and its Play button was clicked through Playwright. No microphone,
fake capture device, prerecorded user audio, or YouTube captions were used.

Native `cua.getApp("Google Chrome for Testing")` was attempted twice. Both calls
returned that **Computer Use permissions are still pending**: the user had not
finished granting macOS **Accessibility and Screen Recording** permissions in
the ChatGPT Computer Use window. No native toolbar click or screenshot was
possible. No permission or security setting was changed to bypass this.

As a diagnostic, Chrome's `chrome.action.openPopup({windowId})` successfully
opened the actual action popup. A CDP trusted mouse click on its Start button
produced Chrome's exact error:

```text
Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.
```

The target was the HTTP fixture, not a Chrome internal page; the missing actual
toolbar invocation was the observed failure. Programmatically opening a popup
does not establish the required activeTab grant. No tab PCM reached the
companion from this attempt. Original audio playback, capture after popup
closure, real Start/Stop repetition, captured tab close, navigation, and
disconnect cleanup remain **unverified acceptance checks**. Automated transport
restart and generated-worklet results cannot substitute for them.
The diagnostic browser, fixture listener, and companion were stopped.

### Failed checks and corrections

- Initial lint/typecheck found non-null assertions, nullable popup references,
  storage typing, and Python line lengths; source fixes passed the existing rules.
- First Python capture run: 14 failed and 2 passed. Starlette TestClient uses
  `ws://testserver` for relative WebSocket URLs even when its HTTP base URL is
  configured. The production loopback Host guard correctly denied that host.
  Changed tests to `ws://127.0.0.1:8765/audio`; all 16 then passed. The guard
  and acceptance criteria were preserved. Malformed-case IDs avoid dumping
  full synthetic PCM packets in future failure reports.
- A pending-stream test initially used a mock getter that did not exist in
  Node's navigator. Removed that incorrect mock setup; the explicit scoped
  mediaDevices fixture and both startup cancellation tests pass.

Implementation references checked:
[Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture),
[background capture](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture),
[offscreen restrictions](https://developer.chrome.com/docs/extensions/reference/api/offscreen),
[Playwright extension testing](https://playwright.dev/docs/chrome-extensions), and
[AudioWorklet process](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process).

### Resume item 2 after native browser access is available

Finish the macOS Accessibility and Screen Recording permissions requested by
ChatGPT Computer Use, then resume the runner in this checkout. Load/reload
`extension/dist` in a dedicated Chrome test profile, obtain the exact extension
ID from `chrome://extensions`, and run:

```sh
export PATH="$PWD/.tools/uv/bin:$PATH"
npm ci
uv sync --locked
npm run build
INTERPRETER_EXTENSION_ID=your_32_letter_extension_id npm run dev:server
# In a second repository terminal:
uv run --locked python -m http.server 8766 --bind 127.0.0.1 --directory tests/fixtures
```

Open `http://127.0.0.1:8766/audio.html`, click Play, then use the **actual extension
toolbar icon** and Start. Verify increasing companion receipt counts and audible
original audio. Close and reopen the popup and verify capture continues; repeat
Start/Stop and verify resources are released; close the captured tab and check
offscreen/capture teardown; exercise navigation and companion disconnect.
Keep the malformed PCM regression tests passing. Record the actual observations,
then check item 2 only if all of its required acceptance checks pass. No later
checklist item or final completion criterion has been satisfied by this iteration.

## Ralph iteration 1/30 — resumed item 2, cleanup regression fixed (2026-10-05)

This runner invocation resumed the next unchecked item, **item 2**. Earlier
iteration entries above are retained as history. Item 2 remains unchecked:
actual tab capture and lifecycle checks now pass, but audible original playback
has no listening confirmation. No models, captions, or later items were attempted.

### Browser access and real capture evidence

`orca skills get computer-use --json` loaded the current native guide.
`orca computer capabilities --json` reported the macOS provider;
`orca computer permissions --json` reported both `accessibility` and
`screenshots` **granted**. The previous permission blocker is resolved.
Orca's native extension-menu click then returned `window_not_focused`; its
restore attempt did not expose the action popup. Switched to the available
`cua_repl` native app control, which successfully inspected the dedicated
**Google Chrome for Testing** window and invoked Interpreter through Chrome's
Extensions toolbar menu. The returned native tree showed the actual action
popup. Clicking its actual **Start** button showed increasing PCM receipts.
No broad permission, fake device, microphone, or API popup invocation was used
as a substitute for the initial toolbar grant.

Used Playwright 1.63.0 / Chrome for Testing **153.0.8010.12**, a fresh ignored
`.ralph/native-capture-*` profile, the built unpacked extension, and the generated
440/880 Hz stereo page at `http://127.0.0.1:8766/audio.html`. A temporary,
uncommitted `.ralph/capture-acceptance.mjs` launched the browser and the following
listeners, and read storage/runtime/tabCapture state via the browser debugger:

```sh
.tools/uv/bin/uv run --locked uvicorn server.app:app --host 127.0.0.1 \
  --port 8765 --ws-max-size 4096 --ws-max-queue 8
# Companion environment: INTERPRETER_EXTENSION_ID=njkbhbpbdgplmegajekncppbhpjbpkop
.tools/uv/bin/uv run --locked python -m http.server 8766 \
  --bind 127.0.0.1 --directory tests/fixtures
```

All extension Start/Stop clicks in this acceptance run used native `cua_repl`.
After the initial toolbar invocation, `chrome.action.openPopup()` reopened the
popup only on an already granted fixture tab. It was not used to create a grant.
Browser debugger reads confirmed `chrome.tabCapture.getCapturedTabs()` was
`active` while the companion receipt counters increased. This is **real tab
capture evidence**, unlike the prior synthetic-worklet smoke.

Final rebuilt-extension observations:

| Check | Actual observation |
| --- | --- |
| Tab PCM arrival | 200 frames / 96,000 samples / peak 2881; actual captured tab active; one offscreen document |
| Popup closure | Popup target disappeared; same session continued to 350 frames / 168,000 samples; reopened popup showed 500 frames |
| Stop | Popup idle; zero offscreen contexts; tab capture `stopped` |
| Repeat Start | New session reached 150 frames / 72,000 samples / peak 2881 |
| Navigation | Navigating fixture to `audio.html?navigation` produced idle, zero offscreen contexts, capture `stopped`; new Start worked |
| Captured tab close | Before close: 150 frames / 72,000 samples; after close: idle, zero offscreen contexts, no captured tabs |
| Companion shutdown | After SIGINT: error `Companion disconnected. Start again to reconnect.`, zero offscreen contexts, tab capture `stopped` |
| Recovery | Restarted companion and clicked Start; new session reached 700 frames / 336,000 samples / peak 2881; popup later showed 1300 frames |
| Final Stop | Popup idle; zero offscreen contexts; capture `stopped`; test browser and listeners shut down |

Counters reflect validated binary PCM reaching the actual companion. No fixture
caption, recorded user audio, transcript, or model result was involved.

### Regression, fix, and automated checks

The first real tab-close attempt exposed a race: offscreen's track-ended handler
reported idle without a tab ID before the worker's tab-removal handler read the
status. Capture stopped, but the offscreen document remained alive.

Added `tests/service-worker.test.ts` and ran:

```sh
node --import tsx --test tests/service-worker.test.ts
```

It failed before the fix with `Ended tab must not leave an offscreen document
alive` (`true !== false`). The worker now queues terminal-report cleanup and
reads the current offscreen status before closing it. The regression also checks
that disconnect errors survive cleanup and a delayed terminal report does not
close a newly capturing session. No shared abstraction or public API was added.
The real browser tab-close and disconnect results above were rerun against the
rebuilt fix.

```sh
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
```

Passed lint, typecheck, production build, **7 JS tests + 16 Python tests**, with
zero skips or warnings. Existing malformed PCM, origin/token, and restart
checks remain enabled. `git diff --check` passed. The optional real-worklet
transport smoke was also rerun; its separate result is recorded below.

Official documentation rechecked:
[Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).
Chrome documents the native invocation requirement and the destination
connection used to preserve playback; that supports the implementation but is
not evidence that a person heard audio on this machine.

### Remaining blocker and resume action

**Audible original playback is unverified.** Native screenshots and debugger
receipt counters cannot establish that the physical/default output remained
audible. An asynchronous listening question was sent while the generated tone
and real capture were running; no listening response was received during this
run. There is no system-output listening tool available in this session. The
code's destination connection is not being reported as successful listening.

A person with access to this Mac's audio output must play the fixture, invoke the
extension toolbar, click Start, and confirm that the same tone continues during
capture (and after closing the popup). Use the README's two listener commands
and dedicated-profile procedure; the temporary harness is not a required artifact.
Record that actual confirmation and any new failures, rerun the acceptance
checks and `npm run verify`, then check item 2 only if all pass. The test tone,
browser, and listeners were stopped at the end of this run. Native browser
permissions need not be requested again. No unrelated credentials were read.

Worklet/transport rerun: `PATH="$PWD/.tools/uv/bin:$PATH" npm run
test:capture-browser` exited 0, with stdout:

```json
{"browser":"153.0.8010.12","inputRate":44100,"frames":50,"samples":24000,"peak":3275,"tabCapture":"not exercised"}
```

This separate smoke still exercises generated offscreen audio only. The native
fixture-tab evidence is in the table above. Final `git diff --check` passed.

## Ralph iteration 1/30 — item 2 listening acceptance retry (2026-10-06)

Resumed item 2 in `/Users/norux/orca/workspaces/interpreter/aspidochelone`.
No repository AGENTS.md exists; the supplied user instructions apply.
`.ralph/verification.txt` reads `No completion verification attempted in this run.`
No source change was necessary for the already implemented capture path.

Executed `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`: exit 0, lint,
typecheck, production build, **7 JS tests and 16 Python tests passed**, no skips
or warnings. Malformed PCM and terminal cleanup regression checks remain enabled.

Started the existing ignored `.ralph/capture-acceptance.mjs` harness using
`node .ralph/capture-acceptance.mjs`. It launched Chrome for Testing
**153.0.8010.12** with the rebuilt unpacked extension and a fresh ignored profile,
the loopback companion on port 8765, and the generated stereo fixture on port
8766. The harness is temporary state and is not part of this commit. No models,
cloud inference, microphone, user audio, or transcripts were involved.

Native `cua_repl` opened Chrome's actual Extensions toolbar, invoked Interpreter,
and clicked the popup's Start button. The initial activeTab grant came from this
native invocation. The companion received **100 frames / 48,000 samples /
peak 2881**, with Chrome reporting capture `active` and one offscreen document.
Native Escape closed the popup. A subsequent debugger read found no popup
target, the same capture session still active, one offscreen document, and
**800 frames / 384,000 samples / peak 2881**. These observations establish real
tab PCM delivery and popup-independent capture, not audible speaker output.

An asynchronous listening question was sent before the retry and another while
the actual capture was active with the popup closed. The remaining acceptance
requires a person's confirmation that the original generated tone remains
audible during capture and after popup closure. **No listening response arrived**
during the test, including a 60-second listening window after recording the
popup-closure evidence. There is no system-output listening tool in this session.
Receipt counts, the audio activity indicator, and the destination connection
cannot substitute for that missing result. **Item 2 remains unchecked and
blocked on user input.**

Reopened Interpreter through the native toolbar; the popup showed 5000 PCM
frames received. Clicked its actual Stop button: the popup returned to Ready,
debugger state was idle, offscreen contexts were empty, and Chrome reported the
captured tab `stopped`. Sent `exit` to the harness to close the dedicated browser
and stop both listeners. `lsof` confirmed no listeners on ports 8765 or 8766,
and the dedicated browser process was gone. The temporary Node harness remained
alive after cleanup, so it was terminated with SIGTERM (tool-reported exit 1); this was not
a successful harness exit. No temporary `.ralph` files are included in the commit.

To resume, a person able to hear this Mac's output must confirm the same tone
remains audible after fixture Play → toolbar Interpreter → Start, and after
closing the popup. If the tone is inaudible, report the state in which it stops
so the failure can be reproduced and fixed. Use the listener commands and
fixture procedure above; native permissions already work. Preserve item 2's
unchecked state until this last acceptance check passes. No later checklist
item or final completion criterion was satisfied by this retry.

## User-assisted capture acceptance passed (2026-10-06)

The user requested another listening test and was present to confirm playback.
Ran `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`: exit 0, lint,
typecheck, build, 7 JS tests and 16 Python tests passed with zero skips.
No source changes were needed; malformed PCM and cleanup regressions remain enabled.

Ran the existing ignored `node .ralph/capture-acceptance.mjs` with a new dedicated
profile, Chrome for Testing 153.0.8010.12, the rebuilt unpacked extension, the
generated 440/880 Hz stereo fixture, and loopback listeners on 8765/8766.
Native `cua_repl` invoked the actual Extensions toolbar → Interpreter → Start.
The companion received 100 frames / 48,000 samples / peak 2881 with capture
active and one offscreen document. The user confirmed the tone before capture
("들려") and during actual capture ("ㅇㅇ 들려").

An intervening session change and idle state were observed; those observations
were not used as evidence of popup-independent capture. Started capture again
through the native popup, then used native Escape to dismiss only the popup.
Debugger reads showed no popup target, one offscreen document, active capture,
and the same session increasing from 250 to 1850 frames (120,000 to 888,000
samples), peak 2881. The user answered **"계속 들림"** to the specific question
about playback with the popup closed and capture still running. This is the
listening evidence that resolves the earlier acceptance blocker.

Reopened the native popup: 2550 frames received. Native Stop returned Ready;
debugger state was idle, offscreen contexts empty, capture stopped. Native Start
created a new active session with 150 frames / 72,000 samples / peak 2881.
Closed the captured fixture tab through its native tab-close button while a
separate blank tab kept the test browser alive for inspection. State became
idle with `Captured tab closed or audio ended.`, no offscreen contexts, and no
captured tabs.

Sent `exit` to the harness. No listeners remained on 8765/8766 and the dedicated
browser process was gone. The temporary Node harness remained alive after
cleanup and was terminated with SIGTERM; this is not reported as harness exit 0.
No temporary state was committed. Combined with the earlier documented
navigation/disconnect evidence, the current capture, listening, popup lifetime,
Start/Stop, tab-close and malformed PCM checks satisfy item 2. The plan now
marks it complete. Models, captions, later items and overall completion remain
pending; the next item is the subtitle overlay.

## Ralph iteration 1/30 — item 3 caption overlay passed (2026-10-06)

Implemented a feature-local DOM `OutputSink` in `extension/captions/overlay.ts`.
It renders generated Korean test captions with `textContent` in Shadow DOM;
no model, stored transcript, existing YouTube caption, or speech translation was
used as evidence. The worker injects the built content script on an authorized
capture Start, initializes its session, and clears the previous sink on Stop or
terminal cleanup. Repeated injection installs only one listener. A cleared
session ignores late captions. Caption provider transport remains item 4 work.

### Commands and actual results

```sh
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
npm run test:captions-browser
# Headed, dedicated ignored profile; invoke actual Extensions → Interpreter,
# dismiss its popup, then press Enter in this command's terminal:
node tests/captions-browser.mjs --youtube
git diff --check
```

Final `npm run verify` passed lint/typecheck/build, 7 JS tests and 16 Python
tests, with zero failures/skips/warnings. Both caption browser commands exited
0 with Chrome for Testing **153.0.8010.12** / Playwright **1.63.0**, and printed
`generatedCaptions: true`, `audioTranslation: "not exercised"`, `passed: true`.
The local fixture is served on `127.0.0.1:8766`; it needs no companion or key.
The YouTube test used the public `Me at the zoo` page, a fresh dedicated profile,
and native `cua_repl` Extensions → Interpreter invocation for activeTab.
The popup was dismissed without starting audio capture. The actual theatre and
fullscreen controls were clicked through Playwright with the captions present;
fullscreen playback was observed. Browser contexts and fixture listeners were
closed by the harness, with exit 0. Profiles stay ignored under `.ralph/`.

Browser assertions passed for the following observable behavior:

- White 18–32px text with black shadow and translucent background; two-line
  maximum, 80vw/960px width, centered with safe margins, and pointer-events none.
  Hostile fixture div styles do not change caption color/font.
- Revision 2 replaces revision 1 in one cue; a delayed revision 1 is ignored.
  Reinjecting `content.js` leaves exactly one host.
- At 390×700, long generated Korean text advances through measured two-line
  chunks. Concatenating the displayed chunks exactly equals the entire input;
  every chunk meets the height assertion, then the host expires.
- Fixture Play and scrubber clicks succeed with the overlay present.
- Actual wrapper fullscreen moves the host inside `document.fullscreenElement`;
  exiting restores it to the document root. Clear removes the host immediately,
  and subsequent captions for the cleared session do not restore it.
- YouTube normal/theatre/fullscreen captions sit above the controls. The final
  cue bottom/control top values were **604.80/625.80**, **607/628**, and
  **720/741** CSS pixels respectively at 1280×800. General fixture cue bottom
  was 720; narrow fixture bottom was 620.

### Visual evidence reviewed

All six final PNGs were opened with `view_image` and visually inspected.
Korean words wrap cleanly, text remains readable on the gradient fixture and
video/background, captions stay in at most two lines, and the controls remain
visible below them. The narrow screenshot shows the first chunk; the remaining
text is verified by the progression assertion, not claimed to fit in that image.

| View | Screenshot | Measured cue height / line height |
| --- | --- | --- |
| General page | [normal](verification/captions/normal.png) | 94 / 43.008 px |
| Narrow 390×700 | [narrow](verification/captions/narrow.png) | 58 / 25.2 px |
| Fixture wrapper fullscreen | [fullscreen](verification/captions/fullscreen.png) | 94 / 43.008 px |
| YouTube normal | [normal](verification/captions/youtube-normal.png) | 94 / 43.008 px |
| YouTube theatre | [theatre](verification/captions/youtube-theatre.png) | 94 / 43.008 px |
| YouTube wrapper fullscreen | [fullscreen](verification/captions/youtube-fullscreen.png) | 94 / 43.008 px |

### Failures and corrections

- First verification failed TypeScript's storage result narrowing. Typed the
  optional `captureStatus` read. Fixture lint required explicit button types;
  supplied them. Existing checks were retained.
- Initial fullscreen assertion observed `fullscreenElement` before its event
  handler moved the host. The browser check now waits for the actual containment
  and exit placement, and captures after two animation frames with CSS animations
  disabled. It does not substitute a mocked fullscreen event.
- One overlapping test invocation failed `EADDRINUSE` on port 8766; subsequent
  browser runs were sequential after the prior harness closed its listener.
- Visual review showed the initial fixed viewport offset overlapped YouTube
  theatre controls. A small local adjustment measures YouTube's player lower
  edge in normal/theatre mode; a theatre attribute change or resize recalculates
  it. Actual fullscreen uses the regular fullscreen margin. The final browser
  test asserts the cue bottom is at least 10px above the control bar. Korean
  `word-break: keep-all` plus balanced wrapping avoids splitting ordinary words.
- Extended the existing worker regression first: `node --import tsx --test
  tests/service-worker.test.ts` failed with `Late terminal report must not clear
  the new caption session` (unexpected `new-session` clear). Moved caption clear
  into serialized cleanup after checking the current offscreen state. The final
  regression passes for disconnected-session clear, error preservation, and
  retaining a restarted session's caption/capture.

References checked: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
and [Fullscreen API guide](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API/Guide).

Item 3 acceptance passed. No blocker remains for this item. These screenshots
and assertions establish **test-caption output only**. Local models, actual
speech-to-Korean captions, cloud adapters/live calls, long-duration performance,
and item 8's actual YouTube audio translation remain unverified. Next: item 4,
MLX Qwen3-ASR + Ollama Qwen3-4B-Instruct with VAD and bounded queues.

Additional existing-transport regression: `PATH="$PWD/.tools/uv/bin:$PATH"
npm run test:capture-browser` exited 0 on the final build: Chrome
153.0.8010.12, generated 44.1 kHz worklet input, 50 frames / 24,000 samples /
peak 3275, `tabCapture: "not exercised"`. This remains worklet/transport evidence,
not new audio-translation or real tabCapture evidence.

## Ralph iteration 2/30 — 2026-10-06 — item 4 implementation, native browser blocker

Worked only in this checkout (plus normal dependency/model caches and explicit
local app verification). No checkout AGENTS.md was present. The supplied user
instructions applied; `.ralph/verification.txt` read `No completion verification
attempted in this run.` Item 4 remains **unchecked**.

Implemented the feature-local local session and connected companion captions
through offscreen → worker → the existing DOM sink. MLX imports are lazy and
optional; the shared single-worker executor serializes ASR across replacement
sessions. VAD decisions use 8 kHz PCM derived from the 24 kHz wire frames;
ASR receives a 16 kHz float32 segment through `generate`, not file-token
streaming masquerading as live input. Limits: 200 ms pre-roll/minimum speech,
500 ms silence boundary, six-second segments, two waiting segments/eight seconds
of waiting audio, 100 incoming PCM frames/two seconds. Older waiting data is
explicitly dropped and counted. Translation uses finalized text, up to three
recent context pairs, fixed loopback Ollama, no environment HTTP proxy, and no
cloud fallback. Stop cancels queued work and rejects late session captions;
already-running native inference completes before the next ASR call can start.

### Commands and passing checks

```sh
export PATH="$PWD/.tools/uv/bin:$PATH"
uv lock
uv sync --locked --extra local
# Explicit public weight preparation (no credentials supplied):
HF_HUB_DISABLE_XET=1 .venv/bin/python -c 'from huggingface_hub import snapshot_download; snapshot_download("mlx-community/Qwen3-ASR-0.6B-8bit", token=False)'
.tools/ollama/ollama serve
.tools/ollama/ollama pull qwen3:4b-instruct
npm run test:local-model
npm run test:capture-browser
# Final keyless check without the optional MLX installation:
uv sync --locked
npm run verify
git diff --check
```

- Apple M5, arm64, 16 GiB; Python 3.12.15, mlx-audio 0.5.8, MLX 0.32.3,
  Transformers 5.18.0, SciPy 1.18.1, webrtcvad-wheels 2.0.14.post1.
  Optional versions are pinned by `uv.lock`; the base environment remains small.
- Official Ollama 0.35.1 Darwin binary was downloaded to ignored `.tools/ollama`.
  Actual `/api/tags` and `/api/show` confirmed `qwen3:4b-instruct`, 4.0B,
  Q4_K_M, digest `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`.
- Actual Hugging Face snapshot
  `89e96d92ba34aca20b3e29fb10cc284097d1219f` completed, including the
  1,006,229,426-byte ASR safetensors file. The first Xet transfer stopped
  advancing at 147,527,218 bytes; terminated that download and retried with
  `HF_HUB_DISABLE_XET=1`. The HTTP retry completed in 3:30. No weights committed.
- A macOS `say` Samantha/165 fixture about sunny weather and a planned park walk
  after lunch was generated locally, then converted to mono 24 kHz PCM16 by
  `afconvert`. The fixture lasted 3.507 seconds; real VAD produced one bounded
  segment with voice end 3580 ms. No user audio was used.
- Real `MlxEngine` → `MlxTranscriber` → `LocalSession` → real Ollama emitted one
  final Korean caption. Reviewed the ASR against the generated sentence: its
  text matched. Reviewed Korean meaning: it conveyed clear weather and a planned
  walk after lunch, with a slightly conversational “decided to walk” phrasing.
  This is one synthetic sentence, not a general accuracy claim.
- The first temporary real-model smoke exited 0 with 25.947 seconds elapsed;
  this included cold imports/model loads. The committed reproducible
  `npm run test:local-model` exited 0 with 2.491 seconds elapsed, with Ollama's
  model resident and ASR reloaded from cache. These are standalone model-pipeline
  times, **not audio-end → visible browser subtitle latency or p50/p95**.
  Both runs explicitly reported `tabCapture: "not exercised"`.
- Both real-model runs set `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`.
  ASR used `local_files_only=True`; translation used only the fixed loopback
  `/api/chat`. No external inference API was requested. Explicit weight downloads
  were preparation, not inference. No API key was read or supplied.
- Actual missing-ASR-model probe returned “Local ASR model is not cached” and
  instructed using the README download command. Fixture tests additionally check
  missing MLX dependencies, missing Ollama model, stopped Ollama, timeout/server
  error, and truncated translation guidance with no fallback.
- `npm run test:capture-browser` exited 0: Chrome for Testing 153.0.8010.12,
  44.1 kHz generated worklet input → 50 frames/24,000 samples/peak 3275. It
  explicitly reports `tabCapture: "not exercised"`; it proves PCM transport only.
- Final `uv sync --locked` removed the optional MLX packages. Then `npm run
  verify` exited 0: lint/typecheck/build, JS 7 tests and Python 29 tests;
  failures/skips/warnings 0. This verifies that basic checks and transport do not
  require MLX or weights. `git diff --check` passed.
- Regression coverage includes real VAD silence, deterministic silence/length/gap
  boundaries, slow inference while the event loop ticks, newest-segment retention
  within the audio limit, cancellation with a full queue, late translation
  suppression, finalized text/context-only Ollama calls, normalized WS caption
  fields, model error closure, and authorized active-session worker routing.

### Failed checks fixed

Initial VAD smoke failed because WebRTC VAD does not accept 24 kHz. Added its
8 kHz decision input and reran the real silence/generated speech checks.
Initial capture restart/token tests returned 409 because asynchronous model
cleanup delayed release of the active slot; release now occurs synchronously
before awaiting cleanup. All original security/PCM assertions remain.
Lint caught import ordering and long lines, which were fixed in changed source.

### Required browser acceptance is blocked

`npm run test:local-browser` launched a headed isolated Chrome for Testing
153.0.8010.12 with the rebuilt unpacked extension, generated speech page, and
loopback companion in offline mode. Native `cua_repl.getApp` by bundle ID,
app name, and exact cached app path repeatedly returned:

```text
Computer Use server error -10005: cgWindowNotFound
```

Retried with a fresh tool binding and a freshly restarted test browser; the
same error persisted. Requested that the test window be brought onto the visible
desktop (and the Mac unlocked if needed); no response arrived during this run.
The harness's actual observation was empty capture status, `captured: []`, and
no cue. Thus **no real Start/tabCapture or visible translated subtitle was
verified in this iteration**. Previous tone capture and test-caption screenshot
checks do not substitute for this requirement. No permissions were widened and
no fake stream was used to claim acceptance.

The first harness invocation exited 0 for cleanup only, before adding an
acceptance-result exit flag; this was not an acceptance pass. The final harness
requires a successful `accept` command before exit 0. Its blocked attempt exited
1, as expected. Both browser/companion/fixture processes closed; the temporary
Ollama daemon was stopped. `lsof` confirmed no listeners on 8765/8766/11434 and
no local harness/model-smoke process remained. Generated audio, transcripts,
weights, profiles, download logs, and `.ralph` state were not committed.

To resume, make the dedicated Chrome testing window visible to native control,
then start Ollama and run `npm run test:local-browser` (its companion installs
`--extra local`). Invoke the real Extensions toolbar → Interpreter → Start,
close the popup, enter `play`, then `accept`; review the Korean meaning and saved
`docs/verification/local/normal.png` with an actual image viewer, and verify Stop
clears the cue. Record actual PCM/caption observations and `npm run verify` before
checking item 4. Real translated-caption appearance, actual YouTube translation,
ten-minute processing, p50/p95, and live cloud remain unverified.

API references consulted and installed implementation inspected:
[MLX Qwen3-ASR usage](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/stt/models/qwen3_asr/README.md),
[Ollama chat API](https://docs.ollama.com/api/chat), and
[the default Ollama model](https://ollama.com/library/qwen3:4b-instruct).

## Ralph iteration 1/30 — 2026-10-06 — real local browser acceptance passed

Resumed item 4 in `/Users/norux/orca/workspaces/interpreter/aspidochelone`.
No repository AGENTS.md was present; the supplied instructions applied.
`.ralph/verification.txt` contained `No completion verification attempted in this run.`
The previous native-window blocker did not recur: `cua_repl.getApp` selected
the dedicated Chrome for Testing fixture window successfully.

Commands actually run (uv added to PATH from the ignored repository tools):

```sh
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
.tools/ollama/ollama serve
curl --fail --silent http://127.0.0.1:11434/api/tags
PATH="$PWD/.tools/uv/bin:$PATH" npm run test:local-browser
# Native Extensions → Interpreter → Start; Escape; Play speech.
# Harness: accept; native Stop; check; exit.
# Strengthened harness to require Stop cleanup, then repeated:
PATH="$PWD/.tools/uv/bin:$PATH" npm run test:local-browser
# Native Extensions → Interpreter → Start; Escape; Play speech.
# Harness: accept; native Stop; stopped; exit.
# Stopped the Ollama daemon started above with SIGINT.
PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
git diff --check
```

- Chrome for Testing 153.0.8010.12, Playwright 1.63.0, Apple M5/16 GiB,
  Python 3.12.15; the same locked local dependencies and model IDs as the
  preceding item 4 implementation record. Ollama 0.35.1 `/api/tags` confirmed
  `qwen3:4b-instruct`, Q4_K_M, digest
  `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`.
- Both runs used fresh ignored profiles and generated Samantha/165 English
  weather/park speech. Native toolbar invocation and native Start granted
  actual tabCapture. Escape closed the popup before native Play speech.
  No microphone, fake stream, injected caption, or existing site subtitles
  supplied the model input/output.
- Both actual captures produced a Korean caption through real MLX ASR and real
  Ollama. At acceptance, the first session reported 1850 frames/888,000 samples;
  the final session reported 700 frames/336,000 samples. Both had peak 25093,
  state `capturing`, and captured tab status `active`. These counters include
  silence and are not a subtitle-latency measurement.
- Reviewed the Korean meaning: sunny weather today and a park walk after lunch,
  with conversational “decided to walk” phrasing. This verifies this synthetic
  sentence only. It does not establish general translation accuracy.
- Viewed the final [real local caption screenshot](verification/local/normal.png)
  with `view_image` after the final run. At 1280×800, the complete caption is a
  single readable line at bottom center, white with dark outline and a small
  translucent background. Audio controls and Play speech remain unobstructed.
  This is actual model output, unlike the item 3 injected-caption screenshots.
- The first harness exited 0 after successful caption acceptance and native
  Stop (idle/captured status stopped/no cue). Added a `stopped` command to the
  feature-local test harness and repeated on a fresh profile. It asserted idle,
  no active captured tabs, zero offscreen contexts, and zero overlay hosts after
  native Stop. Final harness exit 0 requires both real caption acceptance and
  that cleanup check. The final `stopped` assertions all passed.
- The companion set `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`; ASR loads
  cached weights only and the translator uses its fixed loopback HTTP client
  with proxy discovery disabled. Ollama recorded two successful local
  `/api/chat` calls. No external inference API/cloud provider was used. Previous
  actual missing-ASR-model guidance evidence remains applicable; the verify
  tests again passed missing dependency/model/stopped-Ollama/error checks.
- No source correction was needed. The harness change strengthens acceptance;
  README now documents `stopped` and the exit requirements. The final keyless
  `npm run verify` ran after `uv sync --locked` removed optional MLX packages:
  lint/typecheck/build, JS 7 and Python 29 tests passed, failures/skips/warnings 0.
  `git diff --check` passed. Both browser harnesses exited 0 and closed their
  browser/fixture/companion. The separately started Ollama daemon exited 0 after
  SIGINT; `lsof` and process checks found no relevant listeners on 8765/8766/11434
  or remaining local harness/server/model processes.

Item 4 acceptance is now complete. No user audio, user transcripts, credentials,
weights, generated speech files, profiles, or temporary `.ralph` state were
committed. This iteration did not measure audio-end-to-caption p50/p95 or verify
real YouTube translation, ten-minute queue behavior, or live cloud. Those remain
for later items. The next unfinished item is 5, the OpenAI direct adapter and
dedicated realtime translation protocol tests.

## Ralph iteration 2/30 — 2026-10-06 — OpenAI direct protocol acceptance

Completed item 5 in the specified checkout using the existing session/caption
interfaces. There was no repository AGENTS.md; supplied instructions applied.
`.ralph/verification.txt` still said `No completion verification attempted in this run.`
No other agents or interactive browsers were launched.

Rechecked the official [translation guide](https://developers.openai.com/api/docs/guides/realtime-translation)
and [translation server events](https://developers.openai.com/api/reference/resources/realtime/translation-server-events).
The direct adapter uses the dedicated endpoint, configures the target language
before audio, appends continuous PCM, and drains the translation close lifecycle.
It uses no voice-agent response or VAD/commit commands. Transcript fragments are
append-only; repeated alignment times are allowed. The API does not supply
utterance IDs or final transcript events, so punctuation, a 160-character limit,
and graceful close define local display boundaries. Optional timing metadata
provides approximate alignment; captured frame time is the fallback. Source
transcription is disabled and translated audio is discarded.

Commands actually run, with repository-local uv on PATH:

```sh
uv run --locked python -c 'import os, websockets; print("websockets", websockets.__version__); print("OPENAI_API_KEY", "available" if os.environ.get("OPENAI_API_KEY") else "unavailable")'
uv lock
uv run --locked ruff check server tests
uv run --locked pytest tests/test_direct.py -q
uv run --locked pytest tests/test_direct.py::test_companion_routes_selected_direct_pcm_and_captions_without_local_models -q
npm run verify
npm run test:direct-live
uv lock --check
git diff --check
```

- Python 3.12.15, websockets 17.2, anyio 4.15.1. Declare both newly imported
  transport dependencies explicitly; no optional MLX installation was required.
- Nineteen direct tests use real local WebSocket fixture connections, with a
  substituted connector asserting the exact production endpoint and server-only
  Authorization header. No fixture is reported as a successful OpenAI call.
- Confirmed `session.update` requests `audio.output.language=ko` and waits for
  acknowledgment. Four 20 ms PCM frames, including zero silence, arrived in
  order as exactly 960 bytes each after base64 decoding, without the PCM1 header.
  The fixture's expected sequence excludes voice-agent response/VAD/commit events.
- Three fragments with equal `elapsed_ms=200` revised `direct-1` through revisions
  1/2/3, yielding `좋`, `좋은 날`, and `좋은 날씨입니다.` without inserted spaces.
  Partial/final flags were false/false/true. After `session.close`, trailing text
  arrived before `session.closed`, producing a separate cue and final revision.
  Source remained empty and translated-audio events produced no output.
- A generated 600-character unpunctuated stream produced four bounded cues,
  with no characters lost when final cues were concatenated. Missing alignment
  metadata used the actual captured 20 ms frame time. Stop canceled the sender,
  discarded a late caption, awaited the close acknowledgment, and cleared all
  session socket/sender/task references. Repeated cleanup was safe.
- Withheld `session.closed` deliberately: the adapter waited five seconds then
  reported a stalled/disconnected error and released its socket/tasks. Tested
  handshake 401/403/429, provider model access/rate/invalid-event errors,
  malformed output, unprompted close, disconnection, missing key, and unknown
  provider. Keys/raw provider bodies did not enter captions or errors.
- Companion integration used real authenticated PCM transport and the actual
  DirectSession with the local provider fixture. Explicit `openai-direct` never
  created a local model session. Caption session ID/translation/final fields and
  normalized access errors reached the extension-facing socket. Missing-key and
  unknown selections closed the connection and allowed a new session token.
- Initial integration failed (15-second fixture deadline; provider saw no
  `session.close`) because ASGI disconnect cancellation interrupted cleanup.
  Added a small cancellation shield to transport cleanup. Both successful-caption
  and provider-error integration cases now observe close/ack and pass. Initial
  lint line lengths and two fallback-fixture frame/close expectation mismatches
  were also corrected; no assertions or acceptance checks were removed.
- Final `npm run verify` exit 0: lint/typecheck/production build, JS 7 and Python
  48 tests passed, failures/skips/warnings 0 (Python 5.48 seconds). `uv lock --check`
  and `git diff --check` passed. Fixture servers close their sockets within the
  test context; no browser, companion daemon, or cloud connection was started.

**Live limitation:** the process reported `OPENAI_API_KEY unavailable`. The final
explicit `npm run test:direct-live` exited 1 with
`Live smoke unavailable: OPENAI_API_KEY is not exported.` Its key gate ran before
speech generation or network connection. Model access, real Korean output,
translation meaning, latency, and cloud/browser appearance remain unverified.
No credential files were searched/read and no paid call was made.

The optional smoke is excluded from `verify`. With an exported authorized server
key, explicitly run it on macOS to send generated non-sensitive English speech
and inspect the Korean meaning. It fails on access/provider errors or missing
Korean captions and does not exercise tabCapture. Generated audio stays in an
ignored temporary directory and is cleaned up; no user audio/transcripts, keys,
weights, or temporary `.ralph` state are committed.

Under the plan's keyless cloud rule, item 5 is **implemented/fixture verified,
live unverified**. Missing credentials do not block this protocol acceptance.
Next: item 6, Luna/Anthropic text adapters and ASR selection. Final project
completion, actual YouTube translation, ten-minute behavior, and performance
measurements have not been established by this iteration.

## Ralph iteration 3/30 — 2026-10-06 — item 6 text providers / ASR selection

Worked in `/Users/norux/orca/workspaces/interpreter/aspidochelone`; no repository
AGENTS.md was present. Applied the supplied instructions and read the plan and
`.ralph/verification.txt` (`No completion verification attempted in this run.`).
Only item 6 was implemented. No other agent, browser, deployment, or paid inference
was launched. No credentials were read from files.

Checked the official [Luna model card](https://developers.openai.com/api/docs/models/gpt-6-luna),
[Responses guide](https://developers.openai.com/api/docs/guides/text),
[transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription),
[Realtime events](https://developers.openai.com/api/reference/resources/realtime/server-events),
[official transcription connection example](https://developers.openai.com/cookbook/examples/speech_transcription_methods),
and [Anthropic Messages reference](https://platform.claude.com/docs/en/api/messages/create).
The web tool could not fetch Markdown content and the attempted Responses
`/methods/create` page failed; retrieved the official Markdown with curl and used
the working Responses guide/reference. No unofficial technical source was used.

Implemented feature-local `CloudTranslator`, `LiveTranscriber`, and a small
session-selection function using the existing contracts and composed session.
Luna uses the exact `gpt-6-luna` default with Responses and supported `none`
reasoning. Anthropic requires a configured model ID; no current/latest ID or
account access is assumed. Local remains the default text/ASR path. Settings are
exported companion variables until popup item 7. ASR is independently local or
OpenAI for each of the three text translators; direct translation is unchanged.

OpenAI ASR uses client VAD, short phrase buffering, raw 24 kHz PCM appends, explicit
commits, and one in-flight turn. It does not claim continuous word-by-word display.
Partial/final transcripts keep their item ID and increasing revision; final text
replaces partial text. Captured segment times provide approximate timing. Final
items are deleted with acknowledgment so the remote conversation does not grow.
Waiting speech is limited to two segments/eight seconds, and slow input drops old
segments explicitly. Translation receives only finalized text and at most three
recent pairs. Stop cancels HTTP requests/ASR reading and discards late responses.
All API endpoints are fixed; environment proxies and automatic fallbacks are off.

Commands actually run (repository-local uv on PATH):

```sh
uv run --locked ruff check server tests
uv run --locked pytest tests/test_text.py tests/test_live.py -q
uv run --locked pytest tests/test_live.py::test_live_delta_before_commit_ack_keeps_item_and_final -q
npm run verify
uv lock --check
git diff --check
python3 - <<'PY'
import os
for key in ('OPENAI_API_KEY', 'ANTHROPIC_API_KEY'):
    print(key, 'available' if os.environ.get(key) else 'unavailable')
PY
```

- Final `npm run verify` exit 0: lint/typecheck/production MV3 build, JS **7** tests
  and Python **109** tests passed, failures/skips/warnings 0. Python took 35.87 s.
  `uv lock --check` and `git diff --check` passed. No dependency/lockfile changes.
- **61 new cases**: 41 text/selection/companion cases and 20 ASR protocol cases.
  Local WebSocket fixtures exercise actual ASR socket I/O. HTTP fixtures exercise
  each real text adapter; ASGI integration uses real authenticated extension PCM,
  actual VAD/ASR worker scheduling with deterministic inference, and the selected
  cloud adapter. These are fixtures, not real MLX/cloud inference evidence.
- Verified exact Luna/Anthropic endpoint/auth/request shape, selected model IDs,
  bounded context and text-only content, one request per final transcript, and the
  same utterance/session/audio interval in normalized Korean caption events.
  All three text adapters consume actual LiveTranscriber fixture outputs; partial
  ASR text triggers no translation or caption. Existing real local evidence is
  preserved; no new browser/audio-to-caption claim is made.
- Two speech turns preserve ordered PCM bytes (960 bytes per append), pre-roll
  timing, IDs/revisions, partial/final correction, item deletion, and socket/task
  cleanup. Real silence creates no commit. A stalled turn exercises the actual
  **30-second** deadline and releases its socket/reader/pending audio.
- With 30 generated fixture turns and a deliberately blocked first response,
  **27** old waiting utterances were dropped, pending audio remained within
  eight seconds, and cancellation released the full queue/socket with no caption.
  HTTP fixtures deliberately complete during cancellation; both cloud adapters
  discard their late result and close their clients.
- Covered missing key/model setup without network, 401/403/404 and 429 text errors,
  timeout/disconnect/invalid/empty/truncated responses, ASR handshake 401/403/429,
  ASR failure/model/rate events, invalid IDs/events/disconnect, model defaults and
  explicit overrides. Errors hide keys/raw response text. Companion error paths
  close capture and allow a replacement session token. No provider fallback occurs.
- Failures were corrected: initial line-length lint issues; a fixture pre-roll
  expected 1300 ms rather than the actual 1320 ms; deletion acknowledgment was
  awaited to avoid socket-close races. A protocol review found early deltas were
  incorrectly rejected before commit acknowledgment. Added the regression first
  (exit 1, `OpenAI ASR returned an invalid protocol event.`), reconciled the first
  delta's ID with commit acknowledgment, and reran it (exit 0), then the full suite.
  Wrong-item events still fail. No test or acceptance requirement was bypassed.

**Exact live limitation:** the process reported both `OPENAI_API_KEY unavailable`
and `ANTHROPIC_API_KEY unavailable`. Live Luna/Anthropic/OpenAI ASR were not
invoked. Account access, real output/meaning, latency, cloud browser appearance,
and live protocol compatibility remain unverified. Fixtures do not establish
these. The plan expressly permits keyless cloud fixture acceptance, so this is
not an item-6 blocker. README records explicit server-key/configuration commands
for later opt-in live verification. No keys, weights, user audio/transcripts, or
temporary `.ralph` state are included in the commit.

Item 6 acceptance passed; item 7 (popup settings and session/output replacement)
is next. Actual YouTube translation, ten-minute processing/performance, and final
completion checks remain in items 8–9.

## Ralph iteration 4/30 — 2026-10-06 — settings and session/output replacement

Scope: checklist item 7 only, in `/Users/norux/orca/workspaces/interpreter/aspidochelone`.
No checkout `AGENTS.md` exists; user instructions applied. `.ralph/verification.txt`
reads `No completion verification attempted in this run.` No other agents, native
browser automation, model downloads/inference, credential files, or paid APIs used.

The popup now selects provider, ASR, input/subtitle language and compatible model
IDs. English → Korean local MLX/Ollama remains the default. Changing a setting
stops capture and disposes its old captions; an explicit Start creates the next
session. Non-secret selections persist in extension local storage. Direct/live
ASR model IDs are fixed; Anthropic requires an accessible model ID. Existing
clients without a settings body retain environment defaults. Popup selections
otherwise override model/language/provider defaults; API keys remain server-side.

The companion validates an optional `/sessions` body, forbids unknown fields
(including keys/base URLs), and binds the immutable selection to the single-use
auth token. The WebSocket cannot override that selection. It maps language codes
to local/text prompt names, while direct/live ASR use codes. Provider endpoints
remain fixed, and no automatic paid fallback was added.

`extension/captions/output.ts` is a small feature-local fan-out around the existing
OutputSink contract. The content script uses it with the DOM sink; the memory
sink exists only in tests. It rejects other sessions and events after disposal.
No additional product output or provider framework was introduced.

Actual commands/results:

- `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`: exit 0, lint/typecheck/build,
  **9 JS + 130 Python tests passed**, no failures/skips/warnings; Python 35.91 s.
  Added two JS and 21 Python cases. Worker lifecycle fixtures verify old capture
  stop/clear, persistence, new selection at Start, rejection of content-script
  configuration and late captions. ASGI fixtures verify all four providers,
  both ASR choices for text paths, selected models/languages, server-only keys,
  token-bound settings, repeated sessions and invalid selections. These tests
  do not call real MLX or cloud models.
- `npm run test:settings-browser`: final exit 0, **Chrome for Testing
  153.0.8010.12**, Playwright 1.63.0, fresh ignored profile, headless built extension.
  Actual popup extension page persisted Luna/OpenAI ASR/Japanese/French after
  reload, fixed direct/live model fields, required an Anthropic model ID, and
  stored exactly the six non-secret fields. Built offscreen code sent those
  fields to a local HTTP fixture, surfaced its 422 validation error, and released
  its document before recording. The fixture did not perform inference.
- The same browser test exercised the real DOM sink and test memory sink together:
  identical caption, status and clear fan-out; literal `<img ... onerror=...>`
  text with no image node/execution; old-session and disposed-output rejection.
  Separately, the built content script was installed twice and replaced sessions:
  one overlay, no old caption overwrite, old clear ignored, current Stop clear,
  and no revival from a late caption. **Generated output, not audio translation.**
- `docs/verification/settings/popup.png`: visually reviewed with `view_image`.
  Standalone popup extension page at **372×600 CSS px**, rather than a native
  toolbar popup. Labels, model fields, hint and Start/Stop are legible and fit;
  an assertion keeps the action bottom within 600 px. The first layout was close
  to the height limit; increased width/reduced spacing/hint now leave clear margin.
- `npm run test:captions-browser`: exit 0, same Chrome version, built content sink;
  normal/390×700/wrapper fullscreen, revisions, duplicate installation, controls,
  lossless long-cue display, expiry, fullscreen containment/return, Stop/late
  caption rejection passed. Existing screenshot files are unchanged. No YouTube
  or real audio was exercised by this command.
- `PATH="$PWD/.tools/uv/bin:$PATH" uv lock --check`: exit 0; unchanged dependencies.
  `git diff --check`: passed. Browser/fixture processes closed; no listeners remain
  on 8765/8766.

Failures fixed, without weakening acceptance: Python line-length/import lint;
the first settings browser run failed because TypeScript 7's installed package
has no `ScriptTarget.ES2022` runtime compiler API. The test now uses the installed
Vite `transformWithOxc` to compile the real sink source for its in-page fan-out
check; built content-script acceptance remains separate and also passes.

Item 7 acceptance passed. Native capture/provider live smoke was not repeated;
previous item 4 real local capture evidence remains intact. Live cloud access,
quality and latency remain unverified. Next is item 8: real YouTube translation
and normal/theatre/fullscreen appearance, at least ten minutes of bounded
processing, lifecycle/recovery and measured p50/p95/drop/memory metrics. No blocker
was encountered in this iteration; final completion checks have not been attempted.

## Ralph iteration 5/30 — 2026-10-06 — item 8 progress, YouTube playback blocked

Worked only in the requested checkout. No repository AGENTS.md exists; supplied
instructions applied. `.ralph/verification.txt` still reads `No completion
verification attempted in this run.` Item 8 remains unchecked.

Added `npm run test:youtube-browser` and a test-only numeric ASGI wrapper. They
run the built unpacked extension in a fresh ignored headed profile, real native
Start, actual YouTube audio, cached MLX ASR and loopback Ollama. Product capture,
model and output abstractions did not change. No microphone/fake stream, injected
caption or existing YouTube caption supplied the translation. The wrapper does
not save audio or transcripts; `check` can inspect the most recent actual caption
in memory. Exit 0 requires 600 advancing media seconds, caption/queue/memory
observations, all three display modes, and Stop/navigation/disconnect/recovery.

Commands actually run, with uv on PATH:

```sh
.tools/ollama/ollama serve
npm run build
node tests/captions-browser.mjs --youtube
# Read-only native/window access probe; cancelled before generated-caption checks.
# It exited 1 (AbortError on Ctrl+C), not a caption acceptance pass.
npm run test:youtube-browser
# Ken Robinson video: Start, long, normal screenshot, reload/navigation assertion,
# native Start, long, normal/theatre/fullscreen screenshots, report, exit.
npm run test:youtube-browser -- 'https://www.youtube.com/watch?v=8KkKuTCFvzI'
# Waldinger video: Start, long, normal screenshot, disconnect, restart,
# reload, native Start, recovered, native Stop, stopped, report, exit.
# Added direct player-error diagnostics and repeated on a fresh profile:
npm run test:youtube-browser -- 'https://www.youtube.com/watch?v=8KkKuTCFvzI'
# Start, long, normal screenshot, check, blocked, native Stop, stopped, report, exit.
# All three acceptance harness invocations exited 1: required long playback absent.
UV_PROJECT_ENVIRONMENT="$PWD/.ralph/verify-venv" npm run verify
uv sync --locked
npm run verify
git diff --check
```

Environment: Chrome for Testing **153.0.8010.12**, Playwright **1.63.0**, Apple
M5/16 GiB, Python **3.12.15**, Ollama **0.35.1**. Locked MLX/ASR dependencies are
unchanged. Models: `mlx-community/Qwen3-ASR-0.6B-8bit` cached snapshot
`89e96d92ba34aca20b3e29fb10cc284097d1219f`, `qwen3:4b-instruct` Q4_K_M,
4096 context, temperature 0, think false, one ASR worker/one active session.
Ollama `/api/ps` confirmed the model's existing digest and Metal allocation.
HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE=1 and cached-only ASR were used; the text
adapter retains its fixed loopback endpoint. No cloud inference or credentials
were used, and live cloud paths remain unverified.

### Actual partial results

- Native Extensions → Interpreter → Start granted real tabCapture; Escape closed
  the popup while frames/captions continued. The final diagnostic run observed
  active capture, 1200 frames / 576,000 samples / peak 29296 at the playback-error
  check. Actual local ASR and Ollama emitted a Korean cue conveying that more than
  80 percent named becoming wealthy as a major life goal. The inspected source
  and Korean translation agreed on this passage; neither was preloaded by the
  harness. Earlier cues conveyed imagining one's future self and where to invest
  time/energy. This is limited passage evidence, not a general accuracy claim.
- A fragmented ASR result misrecognized a short phrase as a reference to walls;
  opening music also produced a spurious short Korean cue. These are observed
  quality limits, not successful semantic evidence.
- Native reload during the Ken Robinson capture passed `navigation`: idle,
  no active captured tab, offscreen contexts 0, caption hosts 0. Fresh native Start
  created a replacement session. Waldinger `disconnect` stopped the actual
  companion and passed error cleanup with the reconnect message, no active
  capture/offscreen/overlay. Restarting the companion and native Start passed
  `recovered`: a different session produced a real Korean cue. Both Waldinger
  runs passed native Stop → `stopped`: idle, no active capture, contexts 0, hosts 0.
- Inspected all four PNGs using `view_image`. [Normal](verification/youtube/normal.png)
  is a readable **two-line** real translation at 1280×800 (94 px high, 43.008 px
  line height); its bottom was 483 px, control top 504 px. White text, dark shadow,
  small translucent background and pointer-events none passed assertions.
  [Fullscreen](verification/youtube/fullscreen.png) is a real Ken Robinson cue,
  one line, inside the actual YouTube fullscreen wrapper, bottom 720 px/control
  top 741 px. Native theatre/fullscreen controls remained operable during capture.
  [Theatre](verification/youtube/theatre.png) passed geometry/pointer assertions
  (bottom 607/control top 628), but captured the short spurious music cue and a
  site promotional panel. **Meaningful speech-cue theatre acceptance remains
  pending**; this PNG does not establish it. No site CSS or promotional overlay
  was removed to improve the evidence.

### Measurements are short-run observations only

[Blocked snapshot](verification/youtube/blocked.json) was saved when the final
player error appeared, before native Stop. It explicitly has `accepted: false`:
20.021 advancing media seconds, 5 painted cues, p50 **2.480 s**, p95 **4.762 s**,
maximum sampled ASR waiting audio **820 ms**, dropped frames **0**, dropped
utterances **0**. A sixth late cue appeared before Stop; the final terminal report
had 6 cues and p50 1.976 s with the same p95. Neither report is a ten-minute sample.

The first cold Ken Robinson session had 6 painted cues, p50 1.404 s/p95 **20.219 s**,
maximum sampled waiting audio 6960 ms, 0 dropped frames/2 discarded utterances.
Cold ASR imports/model loading and Ollama loading coincided with this delay;
that correlation is not a separate profiling breakdown. After reload with both
models resident, 11 cues had p50 1.117 s/p95 1.866 s, maximum sampled waiting audio
0, no drops. These small samples do not prove the five-second goal over sustained
playback, and the cold result missed it.

The final blocked snapshot's MLX active allocation peak was **1,034,000,178 bytes**
and MLX allocation peak **1,680,164,320 bytes**. Its first 30-second process sample
was companion RSS 289,226,752 bytes, Ollama RSS 3,141,861,376 bytes, dedicated
browser RSS 1,107,591,168 bytes: summed process RSS **4,538,679,296 bytes** (4.23 GiB).
Ollama separately reported **3,175,339,786 bytes** allocated on Metal. These are
sampled RSS and GPU allocations with overlapping unified memory, not total physical
system memory, a model file size, or ten-minute stable memory. The final terminal
sample at 60 seconds had summed RSS 4,668,817,408 bytes; memory growth/leak acceptance
cannot be decided from two samples.

Timing uses first PCM-frame reception minus its relative timestamp/20 ms duration
to estimate the capture origin. A browser animation-frame observer timestamps the
first cue text display; the test pairs that with the latest numeric companion
caption event. This includes VAD, inference, transport and DOM scheduling, but
has capture/transport/scheduling uncertainty and is not a compositor trace. ASR
waiting depth is sampled each second, not an instantaneous high-water mark; the
8-second limit is also covered by existing deterministic backpressure tests.

### Exact blocker and resume requirements

The two public videos were
[Ken Robinson](https://www.youtube.com/watch?v=iG9CE55wbtY) and
[Robert Waldinger](https://www.youtube.com/watch?v=8KkKuTCFvzI). Across fresh profiles,
reloads and the companion restart, their players stopped around **42–44 seconds**
and displayed:

> 문제가 발생했습니다. 새로고침하거나 나중에 다시 시도해 보세요.

[Player-error screenshot](verification/youtube/playback-error.png) shows that
message with the final real translated cue. The site reset its media element to
time 0, duration NaN (JSON null), paused true, and `video.error` null. The diagnostic
run recorded no observed googlevideo HTTP response >=400. This does **not** identify
the cause or prove an absence of network errors. There was no login/CAPTCHA prompt
and no access-control bypass. Capture kept receiving silence after the site's
error; the harness counted only advancing media, so it never confused that silence
with ten minutes of playback.

Required external change: public YouTube playback must work uninterrupted for
at least ten minutes in the dedicated test browser. Confirm/fix that browser/site
playback outside the extension as needed, then rerun the documented harness with
the same actual native Start flow. Recheck meaningful normal/theatre/fullscreen
speech cues, the full 600 seconds, queue/drop/latency/memory results and all lifecycle
checks in the same acceptance run. Do not reuse these short observations as a
long-run pass. Item 8, final item 9 and overall completion remain pending.

## User follow-up — 2026-10-06 — playback baseline and revised plan

The user requested latency improvements and automatic Source language detection
in the plan, and authorized recording the verifiable YouTube limitation or using
another public video. `RALPH_PLAN.md` now adds unchecked items 7a/7b before item 8.
Item 8 retains actual local-model/tabCapture captions, 600 consecutive advancing
media seconds, queue/drop/memory/latency measurements and lifecycle checks. A
public alternative can satisfy those checks while YouTube failures and unverified
site-specific behavior remain explicitly documented. This supersedes the earlier
requirement to restore YouTube playback before any further work. No runner,
implementation, tests or existing failed evidence were changed in this follow-up.

### YouTube without the extension

Used `agent-browser` with the same Chrome for Testing executable as the acceptance
harness, in a separate headed session without the extension, companion or models.
Opened the public Waldinger YouTube URL and clicked the actual player Play control.
A read-only page timer sampled the media element once per second. No sign-in,
credential access, player replacement or access-control bypass was used.

[Baseline snapshot](verification/playback/youtube-without-extension.json) records
the last advancing sample at **34.221 media seconds**, followed at observation
second **35.001** by the same Korean player error, time 0, null/NaN duration and
paused state. The error persisted through the 70-second observation window.
The observed 16 googlevideo requests after playback began all reported HTTP 200;
`agent-browser errors` was empty. These limited diagnostics do not establish a
root cause or rule out response-body/network/player failures. They do establish
that this error can occur without capture or inference; translator load is not
required for the failure. Playback in the user's normal Chrome remains untested.

### Alternative: TED's official player

Opened the [same public Waldinger talk on TED](https://www.ted.com/talks/robert_waldinger_what_makes_a_good_life_lessons_from_the_longest_study_on_happiness)
in another separate headed session using the same test browser. Rejected optional
cookies and used the player's Unmute control. The initial 15-second advertisement
was excluded: the sampler selected the main video with duration >=600 seconds,
not the first `video` element. Its reported duration was **757.341 seconds**.

[TED baseline](verification/playback/ted-without-extension.json) summarizes 90
one-second samples: the main talk advanced from **8.179 to 97.179 seconds**,
**89.000 advancing media seconds**, at playback rate 1, unmuted, with no inactive
sample or observed media error. Observed manifests used
`hls.ted.com` and video segments used `pu.tedcdn.com` (HTTP 200); no YouTube iframe
was present. This is a playback candidate check, not extension capture, translated
caption appearance, a ten-minute pass, or proof that the YouTube cause is fixed.

Commands used (refs are acquired from each fresh snapshot):

```sh
npx --yes agent-browser --session interpreter-playback-diagnosis --headed \
  --executable-path '/Users/norux/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
  open 'https://www.youtube.com/watch?v=8KkKuTCFvzI' --json
# snapshot -i; click the observed Play ref; sample video state once per second.
npx --yes agent-browser --session interpreter-playback-diagnosis errors --json
npx --yes agent-browser --session interpreter-playback-diagnosis close --json
npx --yes agent-browser --session interpreter-ted-diagnosis --headed \
  --executable-path '/Users/norux/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' \
  open 'https://www.ted.com/talks/robert_waldinger_what_makes_a_good_life_lessons_from_the_longest_study_on_happiness' --json
# snapshot -i; reject optional cookies; Unmute; sample the >=600s main video.
npx --yes agent-browser --session interpreter-ted-diagnosis errors --json
npx --yes agent-browser --session interpreter-ted-diagnosis close --json
```

The existing `test:youtube-browser` rejects non-YouTube URLs and assumes one video
and theatre controls. The plan requires a small TED verification path with the
same actual native Start and 600-second assertions; passing the TED URL directly
to the existing command is not a working alternative. Next unfinished task is
7a; 7b, 8, 9 and final verification remain pending. No application code changed,
so `npm run verify` was not rerun for this documentation/evidence-only update.

## Ralph iteration 1/30 — 2026-10-06 — item 7a streaming substep

Item 7a remains **unchecked**. This iteration implements and measures local text
response streaming; it does not complete model preparation, VAD candidate
comparison, or actual browser before/after paint timing. No agents, cloud calls,
credential files, or user audio were used. `AGENTS.md` is absent and
`.ralph/verification.txt` says `No completion verification attempted in this run.`

The existing feature-local OllamaTranslator now sends `stream: true`, decodes
newline-delimited records, and accumulates content into the same utterance with
increasing partial/final revisions. It makes one request per final source
segment. Only final translations enter the three-pair context. The final record
can contain additional text. Empty/truncated output, malformed records, stream
errors, and EOF without `done: true` fail rather than become final captions.
The HTTP stream closes on cancellation and suppresses late provider bytes even
when a transport swallows cancellation. A 30-second whole-response deadline
also limits a server that continuously trickles bytes. No new provider, capture,
output, or public contract abstraction was added.

Protocol reference checked on 2026-10-06:
[Ollama chat](https://docs.ollama.com/api/chat) and
[NDJSON streaming](https://docs.ollama.com/api/streaming).

### Real model event timing, not browser paint

Run from this checkout, with the cached Qwen3-ASR 0.6B 8bit and
Ollama qwen3:4b-instruct Q4_K_M, Apple M5/16 GiB, Python 3.12.15,
mlx-audio 0.5.8, Ollama 0.35.1:

```sh
.tools/ollama/ollama serve
PATH="$PWD/.tools/uv/bin:$PATH" HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-latency.py before \
  docs/verification/latency/before-events.json
# Implement streaming, then run the identical fixture again:
PATH="$PWD/.tools/uv/bin:$PATH" HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-latency.py after \
  docs/verification/latency/after-events.json
```

The `before` command ran with the original `server/sessions/local.py` from
`cf88abf`; the label does not select old code. Audio was generated by macOS
Samantha at 165 wpm: a weather sentence and a sentence about walking to the park
after lunch, repeated four times in separate sessions with shared ASR/model
residency. PCM frames were paced to 20 ms wall-clock intervals. The first sample
used a fresh MLX engine/process and explicitly unloaded the selected Ollama
model; the following seven were warm. Speech end uses the existing VAD's last
voiced frame, including detector hangover, rather than a manually labeled
phonetic endpoint. No ASR/translation result was substituted. Both runs' actual
English ASR and final Korean results were reviewed in the terminal; both preserve
the weather, walking, park and after-lunch meaning and had identical final text.
Only numeric reports are committed. Generated audio is temporary in ignored
`.ralph` and removed by the benchmark's TemporaryDirectory.

| Measurement (ms) | Before p50 / p95 | Streaming p50 / p95 | Samples per run |
| --- | --- | --- | --- |
| Warm first session event | 1047.491 / 1233.221 | 758.851 / 886.182 | 7 |
| Warm final session event | 1047.491 / 1233.221 | 1066.540 / 1194.256 | 7 |
| Cold first session event | 20429.637 / 20429.637 | 2889.352 / 2889.352 | 1 |
| Cold final session event | 20429.637 / 20429.637 | 3135.662 / 3135.662 | 1 |

Warm first-event p50 improves 288.640 ms (27.6%); p95 improves 347.039 ms
(28.1%) on this small fixture. Final-event p50 is 19.049 ms slower and p95
38.965 ms faster, so this is evidence of earlier output, not faster completion.
The first partial may be a single Korean token, not a complete usable sentence.
VAD plus worker scheduling remains 501–502 ms. Warm ASR ranges 136.779–318.534 ms
before and 134.633–290.508 ms after; translation-to-first ranges 336.417–416.529 ms
before and 93.644–99.126 ms after. Each streamed final has 10 or 14 revisions.
All eight samples per run have zero utterance drops and zero pending audio at
termination. This sparse single-phrase benchmark does not measure queue peaks or
long-session stability; those are covered only by deterministic stress tests here.
No transport frame drop claim is made because tab transport is not exercised.

**Cold limitation:** one sample is not a percentile distribution. OS file,
Python import, and MLX compilation caches were not cleared. Cold ASR is
17775.097 ms before versus 1512.083 ms after. The implementation does not change
ASR loading, so this difference cannot be attributed to streaming or claimed as
a cold-start improvement. Cold translation-to-first is 2153.078 ms versus
875.960 ms and also includes Ollama loading. A browser run, independent repeated
cold samples, and explicit preparation timing are still required. The after
benchmark's last sample overlapped the start of the generated-caption browser
check, which can affect scheduling; do not generalize these small-sample tails.

### Regression and browser checks

- Before the change, `pytest -q tests/test_ollama_stream.py` exited 1:
  6 failed / 4 passed. In particular the gated first partial timed out because
  the old adapter buffered the entire response; cancellation and fragmented
  NDJSON also failed. After the change, the initial focused local/stream suite
  passed 23 tests (0.41 s).
- Thirteen new stream cases verify partial-before-completion with a gated
  response, one request and revisions, connection close/Stop/new-work rejection,
  late cancellation-resistant bytes, EOF/malformed/error/truncated/empty streams,
  fragmented UTF-8 and blank lines, complete long-text accumulation, final-only
  context across two utterances, and a real 30-second trickling-stream deadline.
  Existing bounded-queue/native-inference/late-session and output-session tests
  remain in the required suite. The standalone model smoke now counts final
  captions while retaining partial events; it was not rerun this iteration.
- `npm run test:captions-browser` exited 0 on Chrome for Testing 153.0.8010.12:
  built DOM sink, revision rejection/replacement, normal/narrow/wrapper
  fullscreen, all characters of a long final cue, control clicks, expiry/Stop and
  late-caption rejection. These are **generated captions**, not real capture or
  translation. Existing screenshots are unchanged; no new visual-review claim.
- First lint found eight line-length errors in changed/new Python files; fixed.
  First full verify exposed the OpenAI-ASR → local-text fixture's missing Ollama
  `done` marker. Updated that fixture to the actual terminal protocol without
  removing its source/final/ID/request-count/no-audio assertions. The required
  final full-suite outcome is recorded below after rerunning.

### Resume item 7a

Keep the checkbox open. Next: add small feature-local model preparation during
explicit Start (including cancellation/error/token lifetime), compare 250–300 ms
silence candidates on the same generated speech without shortening the six-second
maximum blindly, and record actual native Chrome tabCapture → first/final visible
caption p50/p95 before/after with numeric revision-aware paint instrumentation.
Retain baseline values as session-event evidence, not display evidence. Verify
real audible playback, meaning, long-cue behavior during progressive revisions,
Stop/provider replacement and bounded queues. Model preparation and browser paint
remain unverified here; there is no new external blocker. Item 7b/8/9 remain later
work, including Source Auto and the 600-second TED acceptance run.

Final verification after the fixture fix:

- `PATH="$PWD/.tools/uv/bin:$PATH" uv run --locked pytest -q tests/test_live.py -k actual_text_adapter`:
  exit 0, all three provider integration cases pass (0.10 s).
- `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`: exit 0, lint/typecheck/build,
  JS 9 and Python 143 tests, zero failures/skips/warnings; Python 65.99 s,
  including the real 30-second deadline case. Initial full verify was exit 1,
  1 failed / 142 passed (66.10 s), as recorded above.
- `uv lock --check`, `git diff --check`, numeric JSON sample/percentile consistency,
  and final `ruff check server tests` pass. No dependency or lockfile changes.
- Browser fixture and Ollama were shut down. `lsof -nP -iTCP:8765 -iTCP:8766
  -iTCP:11434 -sTCP:LISTEN` returned no listeners (exit 1, expected for no match).
  No audio, user transcript, credentials, model weights, or temporary `.ralph`
  state is included in this commit.

## Ralph iteration 2/30 — 2026-10-06 — item 7a explicit Start preparation

Item 7a remains unchecked. This iteration implements its model preparation step;
the 250–300 ms silence comparison and revision-aware browser latency comparison
remain required. AGENTS.md is absent in this checkout; supplied instructions apply.
`.ralph/verification.txt` still says `No completion verification attempted in this run.`
Only this checkout and the dedicated local test browser were used. No agents,
worktrees, credentials, cloud inference, push, or runner changes were used.

Observable criterion for this step: explicit Start loads the selected cached local
ASR and Ollama model before tab audio acquisition; Stop/settings/disconnect during
preparation release the session without waiting for native MLX completion or
allowing a late ready event to start recording. Preparation failure is actionable.
Speech boundary remains 500 ms and maximum phrase remains six seconds.

Implementation stays in the existing local adapters/session. Cached MLX loading
runs on the existing single executor, retaining serialization across replacement
sessions. Ollama receives an empty `messages` preload on its fixed loopback chat
endpoint with the same 4096 context size as translation. This follows the official
[Ollama API load-model documentation](https://github.com/ollama/ollama/blob/main/docs/api.md#load-a-model-1).
It generates no fabricated speech/caption and makes no cloud preparation call.
Loading does not execute synthetic ASR or remove first-inference compilation.

The companion delays `ready` until preparation finishes, with a 60-second bound.
The offscreen document waits up to 65 seconds, reports preparation, and propagates
model errors before creating the audio source. It obtains a fresh stream ID through
the existing worker after readiness. Stop aborts the pending fetch/handshake;
worker generation checks and prompt popup Stop/configuration messages interrupt
pending Start instead of sitting behind it. Native loading already running may
finish in the shared worker after cancellation, without restarting capture.

Regression and fixture evidence:

- Before implementation, `uv run --locked pytest tests/test_local_prepare.py -q`
  exited 1: all seven initial checks failed on missing preparation behavior.
- After implementation, all ten preparation cases pass: selected-model preload
  without text/audio, worker execution, five actionable Ollama failures,
  native cancellation, transport ready/error ordering with restart, disconnect
  and serialized replacement while old native loading continues.
- New offscreen JS test gates ready and proves no stream ID/getUserMedia before
  preparation, exact model-error display, Stop and ignored late-ready, then fresh
  stream acquisition on successful readiness. It initially failed because the
  cancelled Start returned transient `starting`; the cancellation result now
  returns idle. Worker regression covers Stop and configure during pending Start.
- `npm run test:settings-browser` final exit 0, Chrome for Testing
  **153.0.8010.12** / Playwright **1.63.0**: built popup Stop/configure interrupt a
  gated preparation fixture; persistence, validation cleanup, settings transport,
  DOM/memory fan-out, injection rejection and old-session rejection still pass.
  These are generated protocol/caption checks, not model inference.

Native local check commands:

```sh
.tools/ollama/ollama serve
PATH="$PWD/.tools/uv/bin:$PATH" npm run test:local-browser
# Native toolbar → Interpreter → Start; observe Preparing translation session…
# Native Stop during preparation; harness: stopped
# Native Start again, close popup; harness: play, accept
# Replay once; harness: check (complete Korean sentence reviewed in memory)
# Native Stop; harness: stopped, exit
```

The final interactive harness exited 0. Apple M5/16 GiB, Python **3.12.15**,
mlx-audio **0.5.8**, Ollama **0.35.1**, cached Qwen3-ASR **0.6B 8bit** and
qwen3:4b-instruct **Q4_K_M**, English → Korean, macOS Samantha **165 wpm**.
Native Stop while popup displayed preparation visibly returned idle; harness
asserted no captured tabs, no caption hosts and no offscreen contexts. The next
native Start successfully acquired real tabCapture after model preparation.
With popup closed, generated speech went through both actual local models;
receipt at first partial: **900 frames / 432,000 samples / peak 25,160**.
Replay check: **1750 frames / 840,000 samples**, active capture, Korean text
conveying sunny weather and walking to the park after lunch. This was model output,
not a seeded caption, microphone, existing site subtitle, or fake stream.

[Prepared partial screenshot](verification/latency/prepared-partial.png) was viewed
with `view_image`: a readable bottom-centered white/outlined Korean partial on a
small dark background; controls remain above it. The old local normal screenshot
was restored byte-for-byte. The new screenshot contains an unfinished weather cue,
so it is not final-caption meaning or full subtitle appearance acceptance.
Native Stop at the end passed idle/no active capture/offscreen 0/caption hosts 0.

Limits: this short run has no measured preparation duration, first/final paint
p50/p95, cold/warm sample comparison, queue peak, long-cue streaming comparison,
or fresh audible-listening evidence. Media unmuted/PCM arrival and unchanged source
playback wiring do not establish that a person heard the sound. The prior listening
evidence remains prior evidence. No latency improvement is claimed for this step.
There is no external blocker; 7a still needs those planned measurements before its
checkbox can change. Auto, TED 600-second processing and final acceptance remain.

Failures and corrections were preserved: one Python line-length lint was fixed;
initial full verify exited 1 with 152 passes and an unknown-provider handshake
fixture failure. Invalid selection now errors before ready; the fixture explicitly
requires that ordering while preserving error text, secret sanitation, close and
restart assertions. The two focused cases passed after correction. An initial
noninteractive local-browser invocation reached ready then stdin EOF, exiting 1;
the final invocation used a persistent PTY. An early settings-browser run while
the local harness owned port 8766 exited 13 with unsettled listen; rerunning after
closing that harness passed. No acceptance criterion or runner was weakened.

Final verification: `PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked` restored
the base environment (optional MLX removed), then `npm run verify` exited 0:
lint/typecheck/build, **10 JS + 153 Python tests**, no failures/skips/warnings,
Python **66.08 seconds**. `uv lock --check` and `git diff --check` passed.
No dependency/lockfile changes. Dedicated browser, companion, fixture and Ollama
were terminated; `lsof -nP -iTCP:8765 -iTCP:8766 -iTCP:11434 -sTCP:LISTEN`
found no listeners. No model weights, secrets, generated audio, user transcript
or temporary `.ralph` state is committed.

## Ralph iteration 3 — local VAD candidate comparison (2026-10-06)

Item 7a remains unchecked. This iteration implements only the measured local
silence-boundary change, from 500 to 300 ms. The six-second maximum, pre-roll,
minimum speech, single ASR worker, streaming translation and queue budgets remain
as before. `SpeechSegments.silence_frames` keeps the setting inside the existing
feature. OpenAI live transcription explicitly retains its existing 500 ms commit
boundary; its fixture still requires all 64 original PCM frames before commit.
No capture/model/output framework, cloud inference, other agent or runner change.

Commands (inside the designated checkout):

```sh
PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked --extra local
OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  PATH="$PWD/.tools/uv/bin:$PATH" uv run --locked --extra local \
  python tests/local-vad-latency.py
PATH="$PWD/.tools/uv/bin:$PATH" uv run --locked pytest \
  tests/test_local.py tests/test_live.py tests/test_local_prepare.py \
  tests/test_ollama_stream.py -q
npm run test:captions-browser
```

The real-model comparison exited 0 on Apple M5 / 16 GiB, Python 3.12.15,
mlx-audio 0.5.8, cached MLX Qwen3-ASR 0.6B 8bit, Ollama 0.35.1 and
`qwen3:4b-instruct` Q4_K_M, English → Korean. Three identical macOS Samantha
165 wpm clips run three times at each candidate, rotating candidate order across
repetitions: **27 warm clip runs / 36 warm finalized cues**, 9 runs / 12 cues per
candidate. Clip 2 contains a deliberately added 240 ms pause between a negated
main clause and its reason, and continues beyond six seconds. TTS can include
its own pauses; the added pause is not a claim about the exact VAD silence span.
The generated waveform is reused in memory at all candidates, paced at 20 ms.
Temporary generated audio under `.ralph` is removed by `TemporaryDirectory`.
Generated ASR/final text was reviewed only in terminal and is not saved.

[Numeric measurements](verification/latency/vad-events.json) contain nearest-rank
percentiles and each cue's audio interval, first/final event, VAD plus worker wait,
ASR duration, revision count and queue/drop measurements. Translation-to-first/
final fields are derived as event latency minus VAD/worker wait minus ASR time;
they include HTTP and event scheduling, not just model compute. These two fields
were derived from recorded raw timings after the run using the same arithmetic
now included in the harness; no new timing run is claimed.

| Warm event measurement | 500 ms baseline p50 / p95 | 300 ms selected p50 / p95 | 260 ms candidate p50 / p95 |
| --- | --- | --- | --- |
| First caption event (ms) | 680.591 / 811.228 | 493.693 / 586.934 | 454.747 / 548.191 |
| Final caption event (ms) | 985.087 / 1139.874 | 790.330 / 1113.188 | 739.896 / 1107.732 |
| VAD plus worker wait (ms) | 502.372 / 502.555 | 302.202 / 302.523 | 261.652 / 262.503 |

The selected candidate's first-event p50 improves **27.46%** in this small warm
sample. 260 ms is faster still; 300 ms was selected to keep more tolerance for
brief pauses, with deterministic 240/280 ms pause-preservation checks. This is an
implementation choice, not evidence that 260 ms has worse real-model accuracy.
ASR ranges were 140.665–287.628 / 107.115–261.435 / 110.678–269.735 ms respectively.
Derived translation-to-first ranges were 30.882–142.444 / 31.399–143.958 /
32.663–143.825 ms. The long clip hits the existing six-second maximum and emits
two cues at all candidates; its first cue ends without silence waiting, so pooled
percentiles include both kinds of boundary. The same clip/cue distribution is used
for every candidate. Nine runs at each candidate have **0 dropped utterances**,
**0 pending audio at end**, and sampled queue peak **6000 ms**, within the existing
8000 ms budget. This sparse sample does not prove long-run queue stability.
Transport frame drop and original audio playback are not exercised here.

Cold/warm distinction: one shared engine is prepared before PCM starts. The first
500 ms weather run is excluded from every warm percentile: first/final event
**15308.749 / 15546.209 ms**, ASR **14670.100 ms**, VAD/worker wait **505.134 ms**,
whole warm-up including preparation/audio **21692.324 ms**, n=1. Cached weights
and OS caches were not cleared. No cold candidate comparison or cold improvement
is claimed. Start preparation loads models but does not remove first-inference
compilation. Warm event latency excludes Start preparation.

Meaning review: weather and lunch/park source and Korean finals match across all
three candidates and repetitions. The longer clip's sources and finals also
match, including the **existing failure**: the six-second cut loses “station,”
and the generated translation contains Japanese wording mixed into Korean.
Negation, rain stopping before noon, blue umbrella and afternoon three survive,
but this is not full long-phrase meaning preservation. Shortening the maximum
was not attempted. This quality defect is a next-iteration task under 7a; do not
use matching defective baseline output as a passed meaning acceptance check.

Before the fix, the new 300 ms flush regression failed (1 failed / 1 passed /
13 deselected, exit 1): no utterance arrived on the 15th silent frame. After the
change, focused tests pass **59 cases in 60.71 seconds**, exit 0, including
300 ms flushing, 240/280 ms internal pauses, silence/noise/frame-gap handling,
six-second continuous speech, slow-ASR queue bounds, Stop/late results, model
preparation, streaming completion and existing OpenAI ASR PCM/commit protocol.
No failing assertion or acceptance criterion was weakened.

`test:captions-browser` exited 0 in Chrome for Testing **153.0.8010.12**:
normal/narrow/wrapper fullscreen, same-cue revision replacement/old-revision
rejection, every character of a long generated final, controls, expiration,
Stop and late-caption rejection. Screenshots retained identical bytes; no new
visual-review claim. This is generated caption fixture evidence, not actual
Chrome audio → model → paint, original-sound listening or long-phrase meaning.

Remaining 7a acceptance: fix/recheck the observed long-phrase quality defect,
measure revision-aware native tabCapture first/final **paint** p50/p95 using
identical speech/settings before/after with sample counts and cold/warm phases,
and verify original-sound listening, partial/final/long-cue rendering and Stop/
session replacement together with bounded queue/drop evidence. Prior event-only
baselines cannot replace paint measurements. There is no external blocker.
Source Auto, TED 600-second run and final documentation/acceptance remain after 7a.

Final base-environment verification: `PATH="$PWD/.tools/uv/bin:$PATH" uv sync
--locked` removed optional MLX packages, then `PATH="$PWD/.tools/uv/bin:$PATH"
npm run verify` exited 0: lint/typecheck/build, **10 JS + 156 Python tests**,
failures/skips/warnings 0, Python **66.02 seconds**. Final Ruff, `uv lock --check`,
`git diff --check`, and numeric sample/percentile/derived-duration consistency
checks passed. Dependency/lockfiles are unchanged. The generated-caption browser
closed; the real-model process completed and Ollama was terminated. No
8765/8766/11434 listeners remain. Only intended source/tests/documentation and
numeric evidence are committed, with no temporary `.ralph` state or generated audio.

## Ralph iteration 4 — local long-phrase quality fix (2026-10-06)

Item 7a remains unchecked. This iteration addresses the generated long clip's
missing “station” and mixed Japanese/Korean output discovered in iteration 3.
The original six-second boundary cuts through that word. A local segment can now
finish at a 100 ms VAD pause once it reaches four seconds, while retaining the
six-second hard maximum, 300 ms normal silence boundary, minimum speech, pre-roll,
single native ASR worker and all queue budgets. Shorter utterances retain their
normal silence boundary. This is a measured quiet boundary, not a sentence parser
or a guarantee that uninterrupted speech will never hit the hard limit.
OpenAI live ASR explicitly disables this local boundary; its original 500 ms
commit behavior and raw PCM remain covered by protocol tests.

The local Ollama system instruction also asks for faithful clause meaning,
unambiguous time expressions and output entirely in the selected target language.
It still streams one request per finalized source, retains final-only context,
and uses the same model, temperature, token/context limits and cancellation path.
No shared provider/capture/output API, extra model, paid request or framework.
An exploratory split-only run recovered the source but translated noon into an
afternoon time; splitting alone was therefore insufficient. Small instruction
probes also showed that generic wording does not universally ensure correctness.
The retained instruction was checked again through the actual ASR/session path.

Commands from the designated checkout:

```sh
PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked --extra local
OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  PATH="$PWD/.tools/uv/bin:$PATH" uv run --locked --extra local \
  python tests/local-boundary-quality.py before
# Apply the pause-boundary and instruction changes, then:
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  PATH="$PWD/.tools/uv/bin:$PATH" uv run --locked --extra local \
  python tests/local-boundary-quality.py after
PATH="$PWD/.tools/uv/bin:$PATH" uv run --locked --extra local pytest \
  tests/test_local.py tests/test_live.py tests/test_local_prepare.py \
  tests/test_ollama_stream.py -q
npm run test:captions-browser
```

`before`/`after` label the currently checked-out product code; they do not select
an implementation. The baseline ran before modifying the adapters; the current
`after` command rechecks the fix. The baseline is retained in
[boundary-before.json](verification/latency/boundary-before.json), and the revised
measurements in [boundary-after.json](verification/latency/boundary-after.json).
Both real-model runs exited 0, using Apple M5 / 16 GiB, Python 3.12.15,
mlx-audio 0.5.8, cached MLX Qwen3-ASR 0.6B 8bit and Ollama 0.35.1
`qwen3:4b-instruct` Q4_K_M, English → Korean. Hugging Face offline flags,
Ollama cloud disabling and the loopback text endpoint were used.

The same three Samantha 165 wpm clips as the prior VAD comparison each run three
times: **9 warm runs / 12 final cues per phase**, plus a separate first weather
inference. Clip 2 has an added 240 ms pause. SHA-256 matches for every generated
PCM waveform between phases. The harness uses actual 20 ms paced PCM, real
segmentation, real ASR and streaming local translation. Generated audio lives
only in an ignored `TemporaryDirectory` and is removed. Generated source/final
text was reviewed in terminal; neither report stores audio or transcript text.
Numeric/Boolean checks include complete source details, Korean without Japanese
kana, long-clip negation/reason/noon/blue umbrella/station/afternoon-three,
increasing revisions, exactly one final per cue, queue budget/drop/end cleanup.
These keyword checks are supplemented by the actual terminal meaning review;
keywords alone do not establish translation accuracy.

Baseline: all three long runs omitted station in ASR and translation and mixed
Japanese kana into the Korean finals. The remaining six weather/park runs passed
the recorded checks. Revised: **all 9 warm runs pass**, including the three long
runs. Its two sources retain the entire negative recommendation and reason,
noon deadline, blue umbrella, station and three in the afternoon. The Korean
finals convey those details without Japanese; noon is expressed as 12 p.m.
The weather remains sunny today. The lunch/park final conveys a planned walk
after lunch using “decided to” phrasing rather than a literal future tense; do
not treat this narrow meaning review as a general model-accuracy guarantee.
The first long chunk now covers audio 0–3880 ms, followed by 4000–7660 ms;
the removed interval is only the detected pause. The baseline chunks were
0–6000 and 6000–7660 ms. Continuous speech can still reach the hard cut.

| Warm session-event measurement | Before p50 / p95 (ms) | After p50 / p95 (ms) |
| --- | --- | --- |
| Audio end → first event, n=12 | 535.211 / 590.043 | 542.207 / 643.179 |
| Audio end → final event, n=12 | 780.227 / 1191.393 | 944.816 / 1125.235 |
| Long clip start → first cue event, n=3 | 6358.341 / 6361.030 | 4293.955 / 4296.307 |
| Long clip start → first cue final, n=3 | 7159.025 / 7191.393 | 4851.412 / 4852.295 |

This is a quality fix, not a pooled latency improvement claim. The first long
cue arrives about two seconds earlier because it no longer waits for the hard
cut, but it also has a different audio interval; do not compare those cue endpoints
as identical utterances. Preserving more meaning in the second cue needs more
translation tokens. The instruction and segmentation changes were measured
together, so neither effect is isolated. Focused fixture tests and the caption
browser run overlapped some revised samples; this is not an isolated speed
benchmark. These are **session-event times, not native Chrome paint times**.
No audible original playback, Chrome capture, transport drop or long-run memory
measurement was attempted in this quality run.

Preparation/first-inference distinction: baseline first weather event/final
1162.968/1404.155 ms, whole warm-up including preparation/audio 4018.132 ms;
revised 1253.434/1487.802 ms, whole warm-up 3949.661 ms, n=1 per phase.
Cached weights/OS caches were not cleared and exploratory probes ran earlier.
These first samples are excluded from warm distributions; there is no cold-start
comparison/improvement claim. Warm sampled waiting queue peak is 6000 ms before,
4000 ms after; **0 dropped utterances and 0 pending audio at end in every run**.
This sparse sample does not prove continuous-media queue stability.

Before implementation the brief-pause regression failed: **1 failed / 1 passed /
16 deselected**, exit 1, because the 200th frame did not produce a segment.
After implementation the focused command passes **62 tests in 60.78 seconds**,
exit 0. New assertions check every frame around the split, resumed speech and
transport-gap reset, and that OpenAI live ASR still commits all 265 frames across
the same pause in one turn. Existing tests retain the six-second continuous cap,
240/280 ms short-utterance pauses, silence/noise handling, slow-ASR bounded
queue, Stop/native serialization/late results, model preparation, streaming
completion/timeout/cancellation and live ASR protocol checks.
Ruff initially found three harness and two adapter line-length errors; fixed
before full verification without altering assertions.

The caption browser fixture exited 0 in Chrome for Testing **153.0.8010.12**:
normal/narrow/wrapper fullscreen, revision replacement/old-revision rejection,
all long-final characters, controls, expiry, Stop and late-result rejection.
The screenshots retained their original bytes; no new visual review is claimed.
These are generated captions, not this run's real audio-to-DOM results.

Remaining 7a work: native Chrome tabCapture revision-aware first/final **paint**
before/after on identical speech/settings, p50/p95/sample/cold-warm/queue-drop,
actual original-sound listening, streaming long-cue rendering and Stop/session
replacement. The fixed generated long-phrase regression need not be reimplemented.
There is no external blocker. Source Auto (7b), TED continuous 600 seconds (8)
and final documentation/acceptance (9) remain. Checklist/acceptance/runner are
unchanged, and no completion claim is made.

Final base-environment checks: `PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked`
removed optional MLX packages, then `PATH="$PWD/.tools/uv/bin:$PATH" npm run verify`
exited 0: lint/typecheck/build, **10 JS + 159 Python tests**, failures/skips/
warnings 0, Python **66.04 seconds**. Final Ruff, harness `py_compile`,
`uv lock --check`, `git diff --check` and independent numeric consistency checks
passed, including identical waveform hashes, all nearest-rank percentiles,
baseline long-clip failures and revised quality/queue checks. The reporting/hash
comparison added to the harness after the measured run was also checked against
these actual reports; no extra real-model measurement is claimed.
Dependency/lockfiles are unchanged. Model processes completed, the fixture browser
closed and Ollama was terminated; no 8765/8766/11434 listeners remain. Only intended
source/tests/docs/numeric evidence are committed, without keys, model weights,
generated audio, user transcripts or temporary `.ralph` state.

## Ralph iteration 5/30 — native revision paint comparison (2026-10-06)

Next unfinished item remains **7a**. Added test-local Chromium CDP tracing to the
existing local-browser harness and revision/final fields to the numeric companion
instrumentation. Production capture/model/output contracts and implementations,
dependencies, checklist acceptance and runner are unchanged. No other agents,
worktrees, credential files, cloud inference, push or publication were used.

Actual commands (Ollama was stopped after both sessions):

```sh
OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
PATH="$PWD/.tools/uv/bin:$PATH" node tests/local-browser.mjs before
PATH="$PWD/.tools/uv/bin:$PATH" node tests/local-browser.mjs after
node --import tsx --test tests/caption-paint.test.ts
PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
```

Both real-browser sessions exited **0**. In each, used the native Extensions
toolbar → Interpreter → Start, closed the popup, entered `measure`, then used
native Stop → `stopped` → `exit`. Chrome for Testing **153.0.8010.12**, Playwright
1.63.0, Apple M5 / 16 GiB, Python 3.12.15 / mlx-audio 0.5.8, Ollama 0.35.1,
cached MLX Qwen3-ASR 0.6B 8bit and `qwen3:4b-instruct` Q4_K_M with 4096 context,
English → Korean. Native active tabCapture, real companion PCM and both actual
models were used; no generated caption messages or microphone stream substituted
for capture. Hugging Face offline flags and Ollama cloud disabling were set.

The **controlled baseline** uses 500 ms VAD silence and withholds delivery of
partial captions to the browser. It still consumes the current real streaming
translation request and uses the current prompt, quality boundary, model
preparation and six-second cap. The revised path uses 300 ms and delivers partial
revisions. This isolates the combined silence/display-streaming change; it is
**not a historical-build benchmark**, nor a measurement of model-preparation
improvement. Separate headed profiles/companion processes, sequential phase order
and uncleared model/OS caches also limit the comparison.

Same macOS Samantha 165 wpm weather and park WAV hashes match between phases.
Each has **6 warm cues** (two short clips × three repetitions) and **1 separate
first-inference cue**. Reports contain numeric/Boolean identity, geometry, revision
and paint timing evidence, with no audio or transcript text:
[baseline](verification/latency/paint-before.json),
[streaming](verification/latency/paint-after.json).

| Warm audio-end → Chromium Paint start | Baseline p50 / p95 (ms), n=6 | Revised p50 / p95 (ms), n=6 |
| --- | --- | --- |
| First painted revision | 1277.630 / 1432.930 | 632.452 / 908.936 |
| Final painted revision | 1277.630 / 1432.930 | 1018.584 / 1374.987 |

Warm first-paint p50 decreased **50.50%** in this sample. Every revised cue first
painted a partial revision before its own increasing final revision. All recorded
caption marks in both reports matched a qualifying Paint (0 missing/coalesced
marks in this run); missing evidence is not synthesized by the analyzer. The
two weather/park finals were reviewed in terminal across all repetitions. They
say the weather is sunny today, and that we walk to the park after lunch. This
short-speech review does not establish the long-speech acceptance or general
translation accuracy.

Timing method: a test listener installed **after** the built content listener
marks its synchronous DOM update, including the message's session, utterance,
revision/final state and visible cue rectangle. CDP records actual Chromium
`Paint` events. The analyzer requires the main frame and a paint clip covering
the whole cue after that mark and before the next caption/start/clear mark.
It never pairs a revision to a subsequent revision's paint or a different frame.
Epoch conversion uses the mark's `performance.timeOrigin + performance.now()`
plus the trace timestamp difference. Audio origin is estimated from the first
received PCM frame's capture timestamp and 20 ms duration, as in the existing
browser companion instrumentation. Transport/clock scheduling error in that
origin remains; this is not an acoustic endpoint measurement. Paint **start** is
an actual browser rendering event, not rAF or server emission, but is also not
GPU completion, compositor presentation, or the moment pixels reach a display.
The cue-bounds check relies on the rendered DOM and paint clip, not OCR for every
partial revision. No synthetic 0 ms timings or cold-speed claim is made.

Separate first inference: baseline first/final paint **16089.145 / 16089.145 ms**,
ASR **15087.544 ms**; revised first/final **1312.109 / 1687.763 ms**, ASR
**937.222 ms**, n=1 each. Both were after model preparation, with existing caches;
compilation/cache differences are not a cold-start streaming improvement. Native
Start preparation elapsed time/model-loading p50/p95 were not measured here.

Both phases have sampled waiting queue peak **0 ms**, dropped transport frames
**0**, dropped utterances **0**. Receipts sample once per 50 frames, so these short
isolated clips do not establish continuous queue peaks or 10-minute stability.
Native Stop in each phase verified idle status, no active captured tab, offscreen
contexts **0**, caption hosts **0**. This is real cleanup, not simulated Stop.

After timing, `play` replayed the last selected park clip, then `accept` saved
[paint-after.png](verification/latency/paint-after.png). `view_image` review shows
the complete reviewed Korean park sentence in one readable white outlined line,
small dark background, bottom center, clear of the native audio controls. The
capture receipt then showed **3350 frames / 1,608,000 samples / peak 25,409**.
This real screenshot is separate from the paint timing run. It verifies normal
short-cue appearance; no new long/fullscreen appearance or original-speaker
listening claim is made. The available UI inspection exposes state/screenshots,
not speaker sound; unmuted media/real PCM are not human listening evidence.

The new analyzer regression passed: rejects another frame, paint outside cue
bounds, paint after a replacement revision, and hidden cues; accepts qualifying
paint timestamps. Focused unit test, lint/typecheck/build and both real-model
sessions passed without a failed acceptance check. The first small inspection
command tried a nonexistent `extension/captions/dom-sink.ts`; actual sink is
`overlay.ts`. No assertion was weakened to make a run pass.

**7a stays unchecked.** Next: real long-cue streaming meaning/rendering without
lost parts; native Stop/restart/provider replacement while real results are in
flight with late-result rejection; original-sound listening; and explicit Start
model-loading/first-inference versus prepared timing. Existing event/quality
evidence remains separate. Short native paint before/after is now recorded and
need not be reimplemented. Source Auto (7b), advancing TED 600 seconds (8) and
final checks (9) remain. No external blocker prevents the next implementation
and browser-verification work; no completion promise is made.

Final base `uv sync --locked` then `npm run verify` exited **0**: lint/typecheck/
build, **11 JS + 159 Python tests**, failures/skips/warnings **0**, Python
**66.11 seconds**. `uv lock --check`, `git diff --check` and independent numeric
report checks passed: identical hashes, seven samples per phase, increasing
revision identity, final/partial distinctions, positive first/final ordering,
epoch/latency arithmetic, nearest-rank warm p50/p95, queue/drop values. Dedicated
browsers, companions, fixture servers and Ollama closed; no 8765/8766/11434
listeners remain. No dependency/lockfile change, temporary `.ralph` state, model
weights, keys, audio or user transcript is committed.

## Ralph iteration 6/30 — real long streamed cue and repeated-context fix (2026-10-06)

Worked only on the next unfinished item, **7a**. Its checkbox remains unchecked:
the plan permits a large item to span iterations, and the remaining acceptance
checks below have not passed. No repository AGENTS.md exists; the supplied user
instructions apply. `.ralph/verification.txt` still says `No completion
verification attempted in this run.`

Commands used (with the repository uv directory on PATH):

```sh
OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
PATH="$PWD/.tools/uv/bin:$PATH" npm run build
PATH="$PWD/.tools/uv/bin:$PATH" node tests/local-browser.mjs stream
PATH="$PWD/.tools/uv/bin:$PATH" uv run --locked --extra local pytest tests/test_ollama_stream.py -k repeated_source
PATH="$PWD/.tools/uv/bin:$PATH" uv run --locked --extra local pytest tests/test_local.py tests/test_local_prepare.py tests/test_ollama_stream.py tests/test_live.py
node --import tsx --test tests/caption-paint.test.ts tests/output.test.ts
PATH="$PWD/.tools/uv/bin:$PATH" npm run test:captions-browser
PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
PATH="$PWD/.tools/uv/bin:$PATH" uv lock --check
git diff --check
```

The new stream mode uses the existing companion instrumentation and real built
content sink. A test-only listener records the current cue after each delivered
revision and observes its timed text changes. Generated source/final/part strings
remain ephemeral in the dedicated browser and are printed for meaning review.
The committed report stores only identity, counts, booleans, timestamps, character
ranges, geometry and the WAV hash. Each final part must have a matching main-frame
Chromium Paint covering its bounds before the next mark; missing paint fails.
The harness also requires partial revisions, increasing revision identity,
the same cumulative translation, two-line layout, all final characters in order,
expiry and bounded sampled queues. It does not deliver generated captions.

### Failures reproduced and fixed

The first short generated umbrella/station sentence fit in two lines at 390 px,
and also at 270 px. Both runs correctly failed the requirement to exercise more
than one final part and exited **1** after native Stop/`stopped`/`exit`. The fixture
was extended with a warm coat and the trip's purpose. Its waveform lasts
**5.1014167 seconds**, mono PCM16/24 kHz; its full source was recognized as one
utterance. The two-part assertion and meaning checks were retained.

The extended phrase then exposed an actual translation failure: repetitions 0/1
used the correct coat word, but repetition 2 produced a malformed Korean word.
Its warm-coat meaning check failed; that browser run exited **1**. Three separate
real Ollama adapter probes with two identical correct earlier source/translation
pairs reproduced the malformed word **3/3**. Those probes exited 0 because they
printed observations rather than asserting success. A real request with an added
standard-vocabulary instruction still failed its coat assertion, exiting **1**;
that prompt experiment was not applied to product code.

The small product fix skips recent context pairs whose entire source equals the
current transcript. Other recent phrases remain in the existing last-three window.
The request, streaming, final-only context insertion, model, prompt, options and
cancellation behavior remain the same. This removes redundant copies which
reproducibly corrupted this small model's translation; it adds no response cache,
model or provider abstraction. The same three adapter probes after this fix
retained the warm coat **3/3**, with assertions and exit **0**. The automated
request regression checks one request, retention of a different recent phrase,
omission of matching copies, and unchanged utterance/final delivery; **1 passed**.
This request fixture alone is not evidence of real translation quality.

### Passing real Chrome evidence

The fourth dedicated browser run used native Extensions toolbar → Interpreter →
Start, observed Preparing then capturing, closed the popup, executed `long`, then
used native Stop/`stopped`/`exit`: **exit 0**. `check` confirmed active native
tabCapture, and the companion received real PCM. Both actual cached models ran:
MLX Qwen3-ASR 0.6B 8bit and Ollama qwen3:4b-instruct Q4_K_M/context4096,
English → Korean, 300 ms silence/6-second cap/current quality boundary.
Environment: Apple M5/16 GiB, Chrome for Testing **153.0.8010.12**, Playwright
**1.63.0**, Python **3.12.15**, mlx-audio **0.5.8**, Ollama **0.35.1**.
HF offline flags and Ollama cloud-disabled mode were used; no cloud inference,
credentials, microphone replacement or prerecorded translation was used.

[Numeric evidence](verification/latency/stream-long.json) contains **3 cues**
(one first inference in the fresh companion, two later repetitions; cached weights,
no cold-cache comparison). Every source and final was reviewed in terminal:
blue umbrella, warm coat, station, afternoon three and the trip's purpose remain.
The finals were identical and read naturally; keyword assertions supplement that
review rather than proving general model accuracy. No Japanese text appeared.
This fixes the observed repeated-context failure, not all possible lexical errors.

Each cue had **27 painted partial revisions and final revision 28**. The final's
**41 characters** appeared as ranges **0–29** and **30–40**, with **6/6** final-part
covering Paints. All recorded parts stayed within two lines and the 270 × 700
viewport's side/bottom margins. Independent JSON checks passed for identity,
revision/count, contiguous ranges summing to 41, geometry, paint arithmetic and
queue/drop values. Sampled pending queue peak **0 ms**, transport frame drops
**0**, utterance drops **0**; receipts sample every 50 frames and these are short,
isolated phrases, not continuous-media queue measurements. No new audio-end
latency, loading-time or p50/p95 improvement is claimed here. The iteration-5
before/after timings remain evidence from that earlier commit and configuration.

Visually reviewed all three real first-final-part screenshots with `view_image`:
[first](verification/latency/stream-long-0.png),
[second](verification/latency/stream-long-1.png),
[third](verification/latency/stream-long-2.png). They show legible white outlined
Korean in two lines on the small dark background, centered above the bottom edge.
The images capture the first final part; the timer-driven second part is evidenced
by DOM text/range checks and Chromium Paint, not a second-part screenshot or OCR.
Paint start does not establish GPU completion or physical display presentation.

All four native Stop checks passed idle, no active captured tab, offscreen contexts
0 and caption hosts 0. Stops followed completed/expired cues; **in-flight native
model cancellation/replacement is still unverified**, not inferred from cleanup.
The caption fixture browser passed normal/narrow/wrapper-fullscreen, long final
all-character display, controls, revision rejection, expiry, clear and late cue
rejection. That fixture is separate from real audio/model evidence.

Focused local/live/prepare/stream tests: **63 passed / 60.80 seconds / exit 0**.
Paint/output unit checks: **2 passed / exit 0**. No acceptance, runner or tests
were weakened to accommodate a failed result.

An asynchronous listening question remained unanswered while generated speech
played with native capture and the popup closed. The UI tools expose no speaker
audio; unmuted controls/PCM do not prove audible playback. **Speaker listening
remains unverified**, with no invented confirmation. This does not prevent the
next independent 7a implementation/measurement work.

Next 7a work: actual inference in progress during Stop/restart/provider/session
replacement and late-result rejection; native Start loading/first-inference versus
prepared timing; original-sound listening confirmation. Also exercise successive
real long utterances when the next cue arrives before the previous cue's timed
parts finish: this run verifies complete isolated final cues, not retention under
that overlap. The single-phrase repeated-context fix and its all-part real paint
verification are now done. Source Auto (7b), TED advancing 600 seconds (8) and
final documentation/checks (9) remain.

Final base `uv sync --locked` followed by `npm run verify`: **exit 0**,
lint/typecheck/build, **11 JS + 160 Python tests**, failures/skips/warnings **0**,
Python **66.23 seconds**. `uv lock --check`, `git diff --check` and the independent
numeric report checks passed. Dedicated browser/companion/fixture processes and
Ollama were stopped; no listeners remain on 8765/8766/11434 (`lsof` exits 1 for
that empty result). Dependency/lockfiles and production capture/output contracts
were not changed. No model weights, keys, generated audio, user transcripts or
temporary `.ralph` state are committed.

## Ralph iteration 7/30 — real local inference interruption and restart (2026-10-06)

Worked on the next unfinished item, **7a**, keeping its checkbox open. No repository
AGENTS.md exists; the supplied instructions apply. `.ralph/verification.txt` says
`No completion verification attempted in this run.` No other agent, worktree,
push, publication, runner modification or credential lookup was used.

Added a `lifecycle` mode to the existing real-browser harness and opt-in numeric
companion instrumentation. It wraps the existing model preparation and actual
native MLX invocation, recording start/end, WebSocket disconnect and session end.
The built capture, model and output code and their contracts are unchanged. All
capture starts use the native Extensions toolbar → Interpreter → Start on the
fixture. Stop and provider configuration run through the actual popup document
opened in an inactive test tab, with Playwright operating its controls. The popup
closes after the action. That automation does not initiate capture or impersonate
an authorized sender. Each subsequent Start again uses the native toolbar.

Commands (uv and Ollama are the existing ignored repository tools):

```sh
OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
PATH="$PWD/.tools/uv/bin:$PATH" npm run lint
npm run typecheck
npm run build
PATH="$PWD/.tools/uv/bin:$PATH" node tests/local-browser.mjs lifecycle
npm run test:js
npm run test:captions-browser
PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
PATH="$PWD/.tools/uv/bin:$PATH" uv lock --check
git diff --check
```

The interactive sequence was native Start/close → `interrupt` → native Start/close
→ `recover` → `replace` → native Start/close → `recover` → `lifecycle-report` →
native Stop → `stopped` → `exit`. The corrected second browser run exited **0**.
Environment matches the previous run: Chrome for Testing **153.0.8010.12**,
Playwright **1.63.0**, Apple M5/16 GiB, Python **3.12.15**, mlx-audio **0.5.8**,
Ollama **0.35.1**, cached MLX Qwen3-ASR 0.6B 8bit and
qwen3:4b-instruct Q4_K_M/context4096, English → Korean, 300 ms silence/current
quality boundary/6-second cap. HF offline flags and cloud-disabled Ollama were
used. Generated Samantha 165 wpm weather/park WAV hashes match iteration 5's
paint-after evidence. Temporary generated audio stays in the ignored profile;
only numeric/identity/geometry/hash evidence is committed.

### Failures and correction

The first lint run failed on an assignment inside a while condition; it was
rewritten as an ordinary assignment. The next lint run found the expanded Python
import exceeding 88 columns; the import was split. Both checks then passed.
The first actual browser run performed both interruptions and real recoveries,
but its report failed `assert.ok(asrEnd)` and exited **1** after native Stop and
cleanup. Its translation case incorrectly searched for ASR completion after the
first translation partial, although ASR precedes translation. The correction
selects the interrupted utterance's latest ASR start and matching end. Its
no-final assertion likewise excludes earlier already-completed utterances in the
same session. This retains the requirement to interrupt the current translation
before final, and to Stop before native ASR completion. The full browser sequence
was rerun; the failed run is not passing evidence.

### Real model/capture evidence

[Numeric report](verification/latency/lifecycle.json) records three distinct
sessions and two interruptions:

- Stop during actual first MLX inference: native inference lasted **1031.749 ms**;
  Stop began **8.940 ms** after inference start, disconnect followed **32.933 ms**
  after that action, and popup idle was observed **57 ms** after the action.
  Native inference completed **989.876 ms after disconnect**, after the session
  coroutine had ended. Its result produced no caption. Capture tracks were no
  longer active; offscreen contexts and caption hosts were both **0**.
- Provider change during the second session's actual weather translation: one
  painted partial of utterance 2 preceded configuration. Luna selection began
  **5.073 ms** after that partial's server emission; disconnect followed
  **12.977 ms** later and idle was observed **34 ms** after the action. That
  utterance produced no final and no caption after disconnect/cleanup. Earlier
  utterance 1 was the already-completed park recovery. Saved settings were Luna,
  then restored to Local; no cloud session was started and no cloud inference
  is claimed.
- Each native restart used a distinct session and actual generated park audio,
  producing **13 partial revisions plus final revision 14**, all painted. The
  final Korean sentence was reviewed in terminal: it preserves the park walk
  after lunch, using the previously observed “decided to walk” wording. Keyword
  checks supplement that review; general model accuracy is not asserted. Both
  new-session finals had a matching covering main-frame Chromium Paint. There
  were **29 painted caption revisions** overall (14 + one interrupted partial +
  14), no cancelled-session delivery after cleanup or after the replacement Start.

This demonstrates suppression of a real native result that completes after Stop,
and cancellation during real Ollama streaming. It does not inject a fabricated
late caption to claim a real race. The native restart clicks happened after the
first native inference ended, so this run does not establish overlapping native
inference/replacement preparation; the existing serialized-worker fixture checks
remain separate evidence. Paint start is not GPU/display presentation; no new
screenshot/OCR or visual-review claim is made.

Preparation start → ready was **1597.402 ms** initially, then **7.000 ms** and
**37.586 ms** in the same companion. The first duration includes cached-model
loading, not model download or fresh OS caches. These three observations are
not a p50/p95 benchmark, a controlled preparation-before/after comparison, or
full native-click → capture timing: offscreen creation and the earlier click
are excluded. Cancelled first inference is not a first-caption latency sample.
Iteration 5's warm first/final Paint comparison remains the latency-improvement
evidence; this iteration does not alter that baseline or claim additional speedup.

Sampled pending-audio peak **0 ms**, frame/utterance drops **0**. Receipts sample
once per 50 frames and these are short isolated clips, not long-media queue
stability. An independent JSON check passed session identity, timing arithmetic,
interruption ordering, cleanup zeros, absent late trace rows, recovery-final Paint
identity, geometry/paint arithmetic, queue/drop values and matching waveform hashes.
Both browser runs' final native Stops passed idle/no active capture/offscreen 0/
host 0. Speaker listening remains **unverified** because these UI tools expose no
speaker audio; unmuted controls or PCM are not treated as hearing confirmation.

Remaining 7a work: successive real long utterances whose new captions arrive before
the preceding final's timed parts finish, full native Start loading/first-inference
versus prepared timing, and original-sound listening confirmation. Real inference
Stop/restart and a provider configuration interruption now have passing evidence;
do not redo the same harness work. Source Auto (7b), TED continuous advancing
600 seconds (8), and final documentation/checks (9) remain. Independent remaining
implementation/measurement can proceed without an external change; 7a completion
still needs speaker listening confirmation. No completion promise is emitted.

The first caption-fixture run failed the existing long-final two-line predicate
and exited **1**. Adding actual layout values to its failure message and rerunning
serially passed, so the first failure did not establish a reproducible third
line. A separate deterministic probe against the actual built sink held a cue
handle across its expiry: attached height **51**, line height **43.008 px**;
after expiry it was detached, height **0**, computed line height empty, and the
old two-line predicate was **false**. The old polling loop read host presence,
text and layout in separate awaited calls; expiry could occur between them. This
is the supported explanation for that intermittent failure, not measured geometry
from the original failing run. Polling now reads all three in one DOM evaluation,
retaining the two-line threshold, full final text equality and expiry checks.
The corrected `npm run test:captions-browser` exited **0**: normal/narrow/wrapper
fullscreen, all long-final characters, controls, revisions, expiry, Stop/clear
and late-caption rejection passed. It is generated-caption evidence, not real
model/audio or physical speaker evidence. Its PNG bytes are unchanged; no new
visual review is claimed. The deterministic expiry probe exited **0** and stored
only an ignored dedicated profile.

The first complete `npm run verify` before the polling correction passed lint,
typecheck/build and **11 JS + 160 Python tests**, Python **66.14 seconds**, with
no failures/skips/warnings. The final check was rerun after correcting polling.

Final `npm run verify` after the polling fix: **exit 0**, lint/typecheck/build,
**11 JS + 160 Python tests**, failures/skips/warnings **0**, Python **65.99 seconds**.
`uv lock --check`, `git diff --check` and the independent lifecycle numeric/hash
checks passed. Dedicated browser/companion/fixture/probe processes and Ollama
were stopped; no listeners remain on 8765/8766/11434 (`lsof` exits 1 for no
listeners). No dependency/lockfile, production contract or runner changes;
no secrets, weights, generated audio, user transcript or temporary `.ralph` state
are committed. README and the durable plan retain the remaining acceptance work.

## Ralph iteration 8/30 — retain overlapping final subtitle parts (2026-10-06)

Worked only in the specified checkout on the next unfinished item, **7a**.
No AGENTS.md is present; supplied instructions apply. `.ralph/verification.txt`
still says `No completion verification attempted in this run.` The checkbox stays
open. No agents, worktrees, cloud inference, publication, push, credential files,
runner modifications, dependencies or model changes were used.

The built overlay regression first failed with **30 / 42** first-final characters
displayed: the following utterance replaced its unread final part. The small local
sink now finishes a segmented final, retaining later captions until its reading
timer finishes. A queued utterance's newer revision replaces its pending partial;
older revisions are rejected. Clear/dispose discard all pending captions and timers.
Waiting output is bounded by **two captions / eight seconds of source audio**,
discarding the oldest waiting caption with a console warning containing its count,
without transcript text. This limits retained output, not wall-clock reading delay.
It deliberately discards waiting cues under overload; lossless adjacent-cue evidence
does not claim lossless overloaded output. Short current cues still allow immediate
replacement. Capture/model/output contracts and other providers are unchanged.

Commands:

```sh
node tests/captions-overlap-browser.mjs # failing regression before the sink change
npm run test:captions-overlap-browser
OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
PATH="$PWD/.tools/uv/bin:$PATH" node tests/local-browser.mjs overlap
npm run test:captions-browser
PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked
PATH="$PWD/.tools/uv/bin:$PATH" npm run verify
PATH="$PWD/.tools/uv/bin:$PATH" uv lock --check
git diff --check
```

The initial adjacent-cue check passed after the change. The extended overload
check then failed waiting for the whole string `대기 8` (9 seconds, then two
20-second attempts). Diagnostic observation showed the existing splitter displays
`대기 ` and `8` as separate timed parts, followed by `대기 ` and `9`. Increasing
the timeout did not fix the incorrect assertion. The regression now asserts the
actual complete part sequence, with the original 9-second wait. The existing
splitter also prefers a word boundary even when the full text would fit; that
pre-existing behavior is left in place. A single-word replacement fixture avoids
conflating that behavior with session disposal. Acceptance thresholds were unchanged.

Final `npm run test:captions-overlap-browser`: **exit 0**, Chrome for Testing
**153.0.8010.12**, Playwright **1.63.0**, headless **270 × 700** viewport.
[Numeric fixture evidence](verification/latency/overlap-fixture.json) records all
**42 / 42** and **38 / 38** adjacent final characters in ordered ranges
**0–29 / 30–41** and **0–28 / 29–37**, all within two lines. Queued partial → final,
old queued revision rejection, immediate clear, session disposal and old-session
rejection pass. Ten rapid waiting captions emit **eight** discard warnings and
retain the two newest; two 5.1-second waiting spans emit one further warning and
retain the newest within the eight-second budget. An independent numeric/range
check passed. These are generated-caption DOM observations, not real audio/model,
Chromium Paint, screenshot review or physical speaker evidence.

The existing `npm run test:captions-browser` also exited **0**: normal/narrow,
wrapper fullscreen containment/return, controls, revisions, all isolated long-final
characters, expiry/clear and late-caption rejection. PNG bytes are unchanged; no
new visual review is claimed.

The real harness has a small `overlap` mode ready for resumption. It requests three
actual long-phrase → short sunny-phrase pairs via native capture and both local
models, requiring the second caption's **browser receipt** before the unread first
final part, both meanings, all final characters, two-line layout and covering
Chromium Paint for every part. Its observer attributes visible text to the matching
revision rather than assuming the latest received caption is already displayed.
It stores only numeric/identity/geometry/WAV-hash data on success. The isolated
`stream` observer shares this corrected matching; its real-model rerun is pending.

**Blocker: native acceptance-window access.** The headed harness reached READY at
`http://127.0.0.1:8766/` with a dedicated ignored profile, built extension and
offline local companion. `cua.getApp` by display name, bundle ID and exact cached
app path, including a REPL reset, selected only an empty **“새 탭” / New Tab**
window. Its native Window menu listed only New Tab. Cancel/close actions did not
make the dedicated **“Local speech acceptance”** window available. `getScreenshot`
returned **`Screenshot unavailable for /Users/norux/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app.`**
No reason such as lock, permission or network failure is inferred. No native Start
was possible. Harness `check` returned **`status:{}, captured:[], text:""`**.
After `exit` and normal browser/companion/fixture cleanup it exited **1**, retaining
its acceptance gates. No PCM/model/caption/real overlap success is claimed and
`stream-overlap.json` does not exist. No fake stream or programmatic popup was used
to manufacture an activeTab grant. A request to make the test window accessible
received no reply during this iteration. Speaker listening is also unverified;
these UI tools expose no speaker audio, and no active playback was available for
a new listening confirmation.

Resume after the dedicated native test window can be made visible/accessibly
controllable: start Ollama, run the headed overlap command, native toolbar Start,
close popup, `overlap`, native Stop, `stopped`, `exit`. Review both printed actual
meanings and confirm original sound during capture/popup closure. Only a passing
run may create real-overlap evidence. Full native Start/loading versus prepared
timing remains required for 7a. Source Auto (7b), TED advancing 600 seconds (8)
and final checks (9) remain. No checkbox or completion promise is emitted.

The first full base-environment `npm run verify` passed **11 JS + 160 Python tests**
(Python **66.25 seconds**), lint/typecheck/build, failures/skips/warnings **0**.
Final `npm run verify` after the final regression corrections: **exit 0**, the same
**11 JS + 160 Python tests**, Python **66.28 seconds**, failures/skips/warnings **0**,
lint/typecheck/build passed. `uv lock --check`, `git diff --check` and the independent
fixture numeric checks passed. Dedicated harness/browser/companion/fixture processes
and the owned Ollama server are stopped; no listeners remain on 8765/8766/11434.
No new visual or real-model overlap success is claimed. All intended source,
verification and plan changes are committed together; no secrets, model weights,
audio/transcripts from the user or temporary `.ralph` state are included.

## Ralph iteration 1/30 (resumed) — real overlapping cues and native startup (2026-10-06)

The next unfinished item remains **7a**, with its checkbox open. Work stayed in
the specified checkout. No AGENTS.md is present; the supplied instructions apply.
`.ralph/verification.txt` reads `No completion verification attempted in this run.`
No other agents, worktrees, cloud inference, credentials, publication, push,
runner changes, dependencies or production capture/model/output changes were used.

Native access was available in this run: `cua.getApp` using the cached Chrome for
Testing app path selected **Local speech acceptance**, rather than New Tab.
Actual native Extensions → Interpreter → Start began preparation and capture;
Escape closed the popup. The unchanged built extension then passed
`npm run test:local-browser -- overlap`: three real long → sunny-weather pairs,
actual tabCapture/PCM/cached MLX ASR/loopback Ollama, **exit 0** after native Stop,
`stopped`, `exit`. No microphone, injected captions or existing site subtitles
were used. Both printed sources and Korean finals were reviewed: blue umbrella,
warm coat, station, afternoon three, trip and sunny weather were preserved.
The first two long finals contain **41 characters**, the third **43**; short
finals contain **11** each. All characters were displayed in order, within two
lines, with **9 / 9 covering final-part Chromium Paints**. The next caption's
browser receipt preceded the unread long part by **1077.800 / 1220.400 / 1036.000 ms**.
[Numeric real-overlap evidence](verification/latency/stream-overlap.json) contains
identity, ranges, geometry, timestamps and waveform hashes, without transcript.
An independent check passed their arithmetic, identity, ranges, geometry and
queue/drop consistency. A native screenshot was inspected while a real long
part was visible: white outlined Korean text on a small dark background, bottom
center, two lines and separate from the audio controls. No new PNG is committed.
This does not establish 600-second stability or lossless overloaded output.

The small existing local-browser harness now also measures startup in two modes:

```sh
OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
PATH="$PWD/.tools/uv/bin:$PATH" node tests/local-browser.mjs startup-before
PATH="$PWD/.tools/uv/bin:$PATH" node tests/local-browser.mjs startup-after
```

For each phase: `startup` arms the next native Start; observe native Preparing or
Capturing before closing the popup. Generated weather speech automatically plays
after capture is ready. Native Stop/`stopped` is required between each of three
samples and before `startup-report`/`exit`. Both final phases exited **0**.
All six actual Korean finals conveyed today's clear weather; each had eight
partials and final revision nine, **54 / 54 covering revision Paints**. Each native
Stop asserted idle, no active capture, offscreen contexts zero and caption hosts
zero. The waveform hash matches between phases and the previous short-weather
Paint measurement. Numeric evidence is in
[startup-before](verification/latency/startup-before.json) and
[startup-after](verification/latency/startup-after.json).

The before mode skips only `LocalSession.prepare` in the test companion wrapper;
the after mode uses product preparation. Both retain current 300 ms silence,
quality boundary, six-second cap, models, translation prompt and streaming.
Each phase starts a new companion and unloads only the selected Ollama test model.
Weights/OS/MLX caches remain; this is not a historical build or cold-cache trial.
A passive listener appended to `popup.js` **only in an ignored copy of the built
extension** records the trusted native Start click. It sends no capture command,
creates no caption and does not alter permissions or product source. Startup
includes popup configuration, offscreen creation, preparation and capture.

| Timing (ms) | Lazy before | Prepared after |
| --- | ---: | ---: |
| First inference: native click → capture | 106.100 | 3096.300 |
| First inference: prepare → ready | 0.098 (skipped) | 2965.260 |
| First inference: ASR (includes lazy load before) | 2305.362 | 912.732 |
| First inference: audio end → first / final Paint | 4566.952 / 4939.792 | 1360.681 / 1742.709 |
| First inference: native click → first / final Paint | 6319.855 / 6692.695 | 6121.747 / 6503.775 |
| Warm restart click → capture p50 / p95 (n=2) | 157.800 / 204.000 | 65.700 / 66.800 |
| Warm audio end → first Paint p50 / p95 (n=2) | 743.000 / 747.661 | 736.412 / 739.244 |
| Warm audio end → final Paint p50 / p95 (n=2) | 1139.603 / 1141.498 | 1150.602 / 1179.926 |
| Warm click → first Paint p50 / p95 (n=2) | 2552.234 / 2597.466 | 2426.853 / 2450.391 |
| Warm click → final Paint p50 / p95 (n=2) | 2946.071 / 2994.069 | 2861.749 / 2870.367 |

Preparation moves model loading ahead of audio capture, rather than removing it.
The first native-click-to-caption totals are similar, and warm audio-end-to-final
is slightly slower after. **No cold-start or general speedup is claimed from this
small sequential comparison.** First inference is n=1 per phase, excluded from
the two warm restarts. Earlier iteration 5's n=6 controlled VAD/streamed-display
improvement remains separate. Paint means main-frame Paint start covering the cue,
not GPU completion/physical display presentation. Audio-end epochs use first PCM
receipt minus its frame timestamp and 20 ms, retaining clock/transport error.
Native click uses popup performance epoch; worker capture-state timestamps have
millisecond precision. Automatic play has a recorded 19–55 ms request delay after
capture plus media startup; that delay is included in click-to-caption totals.

All three passing model runs used Chrome for Testing **153.0.8010.12**,
Playwright **1.63.0**, Apple **M5 / 16 GiB**, Python **3.12.15**, mlx-audio **0.5.8**,
Ollama **0.35.1**, cached Qwen3-ASR 0.6B 8bit and qwen3:4b-instruct Q4_K_M,
context 4096, English → Korean. Hugging Face is offline and Ollama cloud disabled.
Sampled pending-audio peak **0 ms**, frame drops **0**, utterance drops **0** in
each passing run. Receipts are every 50 frames; short isolated/pair samples do
not prove continuous queue peaks, display-overload losslessness or long-media
memory stability. Independent startup JSON checks passed ordering, session and
revision identity, all Paints/geometry, arithmetic, percentiles, hash and queues.

Failed startup instrumentation is preserved as failure, without successful
timing evidence: first the page init script did not observe native popup clicks;
then listening only to CDP target creation also missed the click. Both probes
stopped native capture/cleaned up and exited **1** before playing startup speech.
Watching target-info changes attached the observer, but an inspector window
appeared and the native popup was unavailable; that probe timed out without
capture and exited **1**. That approach was removed in favor of the small ignored
build-copy hook. An initial prepared-phase click followed immediately by Escape
showed no capturing state and returned to Ready. Its cause was not established.
A second native click, observed at Preparing before Escape, supplied that phase's
first accepted capture and the reported timestamp. The earlier unsuccessful
attempt is not a startup sample; closing the popup immediately after clicking
Start is not claimed as verified. Subsequent accepted samples observed Capturing before
closure. The acceptance gates, native invocation and cleanup requirements remain.

**Remaining blocker: original-sound listening.** A listening question was sent
while real native capture was active and the generated English playback began;
no reply arrived. These UI tools expose no speaker audio. Unmuted/active media,
PCM, destination wiring and Paints cannot replace hearing confirmation. The prior
tone confirmation is preserved as prior evidence, not a new speech-listening
check. To finish 7a, a person at this Mac must confirm generated speech remains
audible during capture and after popup closure (or report the actual failure).
Use the README overlap or startup command and native Start sequence. Real overlap
and startup measurement now have passing evidence and need no reimplementation.
Source Auto (7b), TED advancing 600 seconds (8) and final documentation/checks (9)
remain. 7a stays unchecked; no completion claim is made.

After the model/browser runs, base `uv sync --locked` and `npm run verify` passed
**exit 0**, lint/typecheck/build, **11 JS + 160 Python tests**, failures/skips/warnings
**0**, Python **66.09 seconds**. `uv lock --check`, `git diff --check` and the
independent numeric evidence checks passed. Dedicated browsers, harnesses,
companions, fixtures and the owned Ollama server stopped normally. No listeners
remain on 8765/8766/11434 (`lsof` exit 1 means none). The optional MLX environment,
generated audio, profiles, build copies and temporary Ralph state are ignored.
Only harness code, numeric evidence, README, verification documentation and the
durable plan are included in the Conventional Commit; no secrets, model weights,
user audio/transcripts, runner or dependency/lock changes are included.

## User listening confirmation — 2026-10-06 — item 7a complete

The user requested a real listening check. Started the cached local Ollama
0.35.1 server with `OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve` and ran
`npm run test:local-browser` with interactive stdin. The initial non-interactive
invocation reached READY, then closed on stdin EOF with exit 1 before native
capture; it supplies no acceptance evidence. The interactive retry used Chrome
for Testing 153.0.8010.12 and the existing generated weather/park speech fixture.

Used native Extensions → Interpreter → Start, observed Preparing then listening,
and closed the popup with Escape. Ran `play`, then asked whether the English
speech was audible to the end while capture was active and the popup was closed.
The user answered **“네, 끝까지 들렸어요”** (“Yes, I heard it to the end”). This
response is the physical listening evidence; UI tools still expose no speaker
audio. The concurrent `check` reported active tabCapture, state `capturing`,
850 PCM frames, 408000 samples and peak 25036. Those numbers corroborate capture
activity and do not substitute for the user's hearing confirmation.

An additional `play`/`accept` passed the existing real-local-model caption check,
observing the Korean partial `오늘 날씨는` with 2100 frames / 1008000 samples.
This partial is not a new full-translation quality or latency measurement.
Native Stop followed by `stopped` verified idle state, no active captured tabs,
zero offscreen contexts and zero caption hosts. `exit` completed with **exit 0**.
Restored the existing normal screenshot after the harness wrote its temporary
partial screenshot; no new visual evidence or benchmark report is committed.
The dedicated browser, companion, fixture and owned Ollama server were closed;
`lsof` found no listeners on 8765/8766/11434 (exit 1 for no matches).

The previous remaining listening blocker is now resolved. Combining this user
confirmation with the existing passing delay comparison, real overlap/startup,
quality, lifecycle and queue/drop evidence completes item 7a. Its plan checkbox
is checked; the next unfinished item is 7b (Source Auto), followed by items 8/9.
No implementation, acceptance criteria, runner, dependencies or numeric evidence
changed. The earlier 171-test full verification remains historical; this update
reran the targeted native browser acceptance and cleanup, not the full suite.

## Ralph iteration 1/30 — 2026-10-06 — rolling subtitles (7c)

The initial built-sink regression failed with exit 1: after the second short
final, only `공원으로 걸어갑니다.` remained, rather than both sentences. Replaced
the single cue/two-waiting-caption display with a feature-local rolling surface.
Capture, model adapters, caption contracts and output fan-out are unchanged.
The surface uses at most four lines (less on a short viewport), up to two per
sentence, with the oldest part advancing/expiring after 2.5–6 seconds based on
length. New sentences fill available space; revisions replace only their own
sentence text and deadline. Consumed character offsets survive resize and
fullscreen. No clipping, ellipsis, transcript storage or transcript-list UI is
introduced. DOM nodes survive other sentences' corrections.

Hidden output is bounded independently at four sentences/twelve seconds of
source audio. Actual overload drops the oldest waiting sentence, with a
cumulative count/reason in a small separate status notice and a text-free console
warning. Retired IDs are bounded at 128; an audio-position watermark rejects
older audio. Distinct direct-provider cues can share an audio timestamp, so
strictly earlier audio and remembered retired IDs are rejected rather than all
cues at the same timestamp. This fits the existing bounded/ordered producer
transport; it is not a general unlimited tombstone archive. Stop/dispose clears
all display, waiting work, timers, status and retirement guards.

`npm run test:captions-overlap-browser` exercises the current built sink on
Chrome for Testing 153.0.8010.12 / Playwright 1.63.0. Generated fixture finals
retain **42/42 and 38/38 characters**, once and in order, at 1280×800 and 270×700.
The narrow surface uses four lines (109 client pixels including padding and
rounding); wide uses two lines. All parts receive their length-based reading
time (100 ms observation tolerance), expire from the front, and coexist with
later text. Tests check unchanged nodes during multiple in-place corrections,
old revisions/final-to-partial rejection, expired/discarded revisions, preserved
suffix after resize, wrapper fullscreen/exit, controls, clear/late messages,
session replacement, and both hidden-work limits. A twelve-cue burst with tied
audio timestamps keeps four visible plus four waiting and reports four drops;
four waiting 5.1-second cues report two audio-budget drops. Numeric evidence is
`docs/verification/captions/rolling-fixture.json`. Visually reviewed
`rolling-normal.png`, `rolling-narrow.png`, `rolling-fullscreen.png`: white
outlined Korean text, chronological sentence rows, safe margins, readable
wrapping and accessible controls. These are generated DOM fixtures, not audio
translation evidence.

`npm run test:captions-browser` also passed normal/narrow/wrapper fullscreen,
style isolation, pointer-events, control clicks, revision rejection, an isolated
long final's complete characters/two-line parts, expiry, clear and late caption
checks. Its general screenshots go to ignored `.ralph/` to preserve the older
historical images. The rolling screenshots above are the new durable visual
evidence. The paint matcher now allows distinct sentences to share a covering
paint but still rejects borrowing a newer revision's paint; the new JS regression
checks this behavior.

Real validation uses `OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve`,
`PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked --extra local`, and
`npm run test:local-browser -- overlap`. Native Extensions → Interpreter → Start,
observed Preparing then listening, Escape to close popup, `overlap`, native Stop,
`stopped`, `exit`: no programmatic Start, substituted stream or injected caption.
A first narrow-only run passed three long/short pairs with all nine final parts
painted. Added per-sentence disappearance observation and narrow/normal/fullscreen
scenes to check actual reading durations, front expiry and save real screenshots.
The scene run passed the two meanings (blue umbrella, warm coat, station, 3 pm,
trip and sunny weather), all final characters and simultaneous sentences. The
numbers, identities, geometry, Paint/disappearance times and WAV hashes are in
`docs/verification/captions/rolling-local.json`; audio/transcripts remain temporary
browser/terminal data. The WAV hashes match the earlier 7a overlap report.

Real scene screenshots `rolling-local-narrow.png`, `rolling-local-normal.png`,
`rolling-local-fullscreen.png` were visually reviewed. Both Korean sentences are
readable together; narrow text wraps above the fixture buttons/audio controls.
Normal/fullscreen retain the same two sentence rows. The harness checks that the
host is inside the actual fullscreen element. Native Stop/`stopped` verifies
idle, no active captured tab, zero offscreen contexts and zero caption hosts;
both runs exited 0.

The setup is cached MLX Qwen3-ASR-0.6B-8bit / mlx-audio 0.5.8, Ollama 0.35.1
qwen3:4b-instruct, Apple M5/16 GiB, Python 3.12.15, English → Korean, current
300 ms silence/quality boundary/6-second cap. Hugging Face offline and Ollama
cloud disabled. These isolated generated-speech runs are **not** advancing
600-second public-video stability, a new latency improvement benchmark,
utterance-in-progress ASR/translation (7d), Source Auto (7b), cold-cache evidence
or a new physical speaker-listening check. The 7a user listening confirmation
remains historical. An initial `cua.getApp` before the dedicated harness window
returned `timeoutReached` (-10005); selecting the same cached app after READY
worked and native capture/Stop proceeded. No remaining interactive-access blocker.

Failure records: the expanded fixture initially missed the detached host's last
absence snapshot and failed its reading-time assertion (exit 1). Explicitly
recording the observed absence after expiry fixed the observer; the duration
assertion remains. The tied-timestamp burst check then waited only for sentence 8
and asserted all four waiting sentences too soon, seeing `문장2문장3문장8문장9`
(exit 1). Waiting for sentence 11 instead preserves the exact same final group,
drop count, reading time and timeout checks; earlier sentences retain their
individual deadlines. No failed run supplies successful evidence. No provider
credentials, live cloud calls, runner changes, agents, push or publishing.

After the tied-timestamp guard change, reran the complete native scene harness
against the final build: narrow/normal/fullscreen, **41/41/43 long characters +
11/11/11 short characters**, **7/7 final-part covering Paints**, ordered offsets,
no duplicates, front expiry and both meanings passed. This final run replaces
only the new rolling-local report/screenshots, which were visually reviewed
again. Native Stop/`stopped`/`exit` passed, exit 0. Caption receipt → short
sentence's first DOM mark was **0 / 0.09985 / 0 ms** at browser clock resolution;
these are display-wait observations, not zero audio-to-caption/physical-display
latency. Final part DOM visibility was **2703.1 / 2499.4 / 3107.9 / 3691.7 /
2500.6 / 3870.9 / 2500.8 ms**; rounding/timer observation tolerance is 100 ms.
The same sentence text was not removed/reinserted by another sentence's revision.
Sampled inference pending peak **0 ms**, dropped frames/utterances **0/0**, and
subtitle drops **0**. Peak visible sentences **2**, no hidden output in these
isolated scenes; burst retention/drop is the separate fixture above. Independent
numeric checks passed offsets/counts, identity/revision, Paint arithmetic,
durations, geometry, front expiry, queue/drop and WAV hash agreement.

Final-source `npm run verify` passed exit 0: lint/typecheck/build,
**12 JS + 160 Python tests**, failures/skips/warnings 0, Python **66.02 seconds**.
Earlier full runs also passed (Python 66.33/66.14 seconds). The final suite ran
with the base locked environment before the last native model rerun; restored
`uv sync --locked` after native verification. `uv lock --check` and
`git diff --check` passed; no dependency/lock changes. Dedicated browser,
companion, fixture and owned Ollama were closed after each actual run. The final-source basic browser regression also passed exit 0. No
listeners remain on 8765/8766/11434 after all browser/model/fixture cleanup. Only source/tests, numeric evidence, generated-speech
screenshots, README/docs and plan are intended for commit; `.ralph`, build copies,
models, credentials and user audio/transcripts are excluded.

## 2026-10-06 — Ralph iteration 2/30: local speech snapshots (7d, incomplete)

Implemented the local-ASR/local-Ollama revision path within `server/sessions/local.py`.
MLX still receives finite 16 kHz float32 arrays. The installed mlx-audio 0.5.8
`Qwen3ASRModel.generate` accepts arrays; its `stream=True` option streams tokens
from an already supplied input. This implementation instead takes cumulative
snapshots every **1,000 ms of new voiced PCM**, within the unchanged 300 ms
silence/100 ms long-pause/six-second boundaries. The interval is a candidate,
not a measured optimum. One shared native worker remains serialized. Waiting
snapshots replace one another; finals take priority. ASR and translation each
retain at most two pending segments/eight seconds of audio, with final loss
reported in status/counts rather than hidden.

The same utterance retains its ID across ASR revisions and caption revisions
increase across separate translation requests. Whitespace/case/terminal-punctuation
changes alone do not retrigger translation. A new meaningful source revision
closes the obsolete response and rejects its late bytes. Only the first response
streams its tokens into the caption immediately; subsequent corrections preserve
the earlier displayed text until the replacement response completes, avoiding
repeated collapse to a one-token prefix. A complete response for provisional
source stays a partial caption. An unchanged final source reuses its completed
translation without another request. Only confirmed pairs enter the three-pair
context. Existing caption contracts/sink/capture abstractions are unchanged.
Luna/Anthropic with local ASR and text paths with OpenAI ASR retain final-only
translation. `tests/browser_metrics.py` now forwards the internal constructor
keyword so the existing instrumented native harness can instantiate this path.

Regression work first failed with two missing-snapshot API checks, then two
pre-boundary translation timeouts. All **seven** new checks now pass: paced
pre-boundary snapshots, same-ID finalization, native inference coalescing, source
correction without prefix erasure, provisional-response versus speech-final,
unchanged/older source suppression, confirmed-only context, cancellation-resistant
late output, final priority/two-segment/eight-second limits/status, and cancel/close
cleanup. The deliberately slow ASR fixture first expected 265 frames; the existing
100 ms pause after four seconds correctly ends it at 255. Corrected the fixture
expectation to the already tested boundary, retaining all timing/queue assertions.
The translator pressure fixture keeps IDs 1/6/7, reports four dropped waiting
finals, and reaches exactly 8,000 ms pending. Provider fixtures verify that only
the local/local selection enables snapshots. No live cloud request was made.

Real model probe commands, with the repository-local Ollama binary and cloud
inference disabled:

```sh
OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-interim-model.py before
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-interim-model.py after
```

The probe uses macOS-generated weather and construction speech, paced at 20 ms
per PCM frame, with the actual cached MLX 0.6B 8bit and Ollama
`qwen3:4b-instruct` models, English → Korean, context 4096. Each phase starts a
fresh engine, unloads only the selected Ollama model, and prepares both models
before timing. Weights/OS/MLX caches remain. “First inference” is not a cold-cache
claim. Three repetitions are required for a passing report, but these runs
stopped in repetition 0 at a failed meaning check, so **no passing report or
p50/p95 comparison exists**. Temporary generated audio and console review remain
ignored; no audio/transcript or failed run is committed as successful evidence.

Both before trials correctly recognized the complete construction sentence,
but mistranslated **crane as duck**, despite steel beams/construction context.
A generic ambiguity reminder failed again and was removed. Three further
text-only generic prompt probes produced deer/duck mistranslations; none became
product changes. The after probe also fails the unchanged crane/steel meaning
assertion, **exit 1**. The new script prints observation-only numbers before its
assertions but writes `docs/verification/interim/model-{before,after}.json` only
when all repetitions/checks pass. Neither file exists from this iteration.

An earlier after trial with token-streamed corrections produced 29 provisional
events during the construction speech, two source changes, first-event latency
1,214.515 ms from the PCM start proxy, final-event latency 702.058 ms after the
end proxy; its first weather inference took 1,950.286 ms to first event and did
not finish before speech ended. These were failed model-only observations.
After preserving displayed text during correction, reran the actual models on
the final product path. The final failed trial observed:

| Generated clip | First event from PCM speech start proxy | Last final event after speech end proxy | Events during speech | Source changes | ASR / translation calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Weather, first inference (n=1) | 16,637.043 ms | 15,534.581 ms | 0 | 0 | 2 / 1 |
| Construction, following inference (n=1) | 1,239.534 ms | 696.497 ms | 15 | 2 | 4 / 3 |

Weather meaning passed; construction meaning failed again. Both clips observed
zero coalesced waiting snapshots and zero dropped ASR/translation segments.
The PCM start/end proxies are the first/last samples with absolute amplitude
at least 100 (weather 0.417–1,356.792 ms; construction 1.542–3,181.958 ms), not
VAD decisions or perceived acoustic boundaries. Event times are monotonic-clock
session events, **not tabCapture, DOM, Chromium Paint or physical display/audio**.
The large first-inference variation is unresolved; no speedup/cold-start claim
is supported. Added per-call duration/pending/RSS fields to future observation
output for diagnosis; those added fields were not reported or retained in these completed
trials. A two-clip failed trial cannot establish continuous throughput, stable
memory, normal-load completeness, or short-speech improvement.

7d remains unchecked. Next work is to diagnose first-inference latency and the
contextual meaning failure using these original models/checks, finish the paired
model probe, then implement native Chrome/covering-Paint comparison with identical
speech/settings. Short/long/continuous speech, hesitation/silence, full caption
meaning/characters, visible correction/expiry, playback, Stop/provider/session
replacement, queue/drop and process/model memory still require that acceptance.
No browser was launched in this iteration, so there is no new screenshot,
interactive-access failure, native Start, or speaker-listening evidence. Previous
7a/7c evidence remains historical. This is unfinished verification/quality work,
not a blocker requiring credentials or user input.

Restored the base locked environment after each real-model run. The initial full
`npm run verify` passed lint/typecheck/build, JS 12 + Python 167 (66.08 seconds),
with zero failures/skips/warnings. After the correction-display change, the
final full `npm run verify` also passed: JS 12 + Python 167 (66.17 seconds),
lint/typecheck/build, zero failures/skips/warnings, exit 0. `uv lock --check` and
`git diff --check` pass. No listeners remain on 8765/8766/11434.
Both owned Ollama processes were stopped; no companion/fixture/browser was
started, no dependency/lock/runner/acceptance criterion changed, and no keys,
weights, temporary `.ralph` state, user audio/transcripts, agents, push or publishing
are part of this commit.

## 2026-10-06 — Ralph iteration 3/30: snapshot interval and preparation (7d, incomplete)

Worked only in this checkout. No repository AGENTS.md is present;
`.ralph/verification.txt` says `No completion verification attempted in this run.`
Continued 7d without changing its acceptance or checkbox. No browser, companion,
cloud inference, agents, credentials, publishing, push, dependencies, lockfile or
runner changes were involved. Existing 7a/7c capture/appearance/listening evidence
remains historical.

The unchanged original model probe failed again, exit 1, on construction crane
meaning. The full source was recognized correctly. Its first weather ASR call
was **13,878.879 ms** (first event **15,751.347 ms** from the speech-start proxy),
while the following construction ASR call was **302.307 ms**. A separate native
worker profile with generated weather audio observed **983.067 ms** first ASR
and **108.134 ms** next ASR; about **732 ms** of the first call was Python imports,
primarily SciPy signal modules. An instrumented paced profile also failed crane
meaning, with **1,012.933 ms** first ASR and **193.818 ms** next ASR. Profiling
changes timing; this does **not** establish the cause of the earlier 13.9-second
call. Generic English/Korean instruction and user-wrapper text-only probes
produced incorrect animals, incorrect word senses or grammatical ambiguity.
None was adopted as a product prompt change or successful translation evidence.

Moved the existing SciPy resampler import into the shared MLX worker's preparation
and retained the function for PCM processing. This finishes a measured expensive
import before capture accepts audio and reports a missing resampler during
preparation. It adds no synthetic inference, alternate model or framework.
The new missing-resampler regression first failed `DID NOT RAISE RuntimeError`,
then passed after the fix. The local prepare/interim/queue suite passed **36/36**.
It does not prove that all first-inference variability is fixed.

The original one-second candidate still missed the first weather utterance's
speech window: its first event was **1,500.302 ms**, versus the PCM end proxy
**1,356.792 ms**. Changed the local/local snapshot interval to **500 ms of new
voiced PCM** and measured it with the same generated speech, unchanged models,
prompt, VAD boundaries, queues and meaning checks. Updated the snapshot regression
to require an event at 500 ms, later same-ID revisions and a confirmed final.
The slow-worker regression still requires final preservation and zero drops; it
now observes nine coalesced snapshots rather than four because there are twice
as many candidate snapshots. Luna/Anthropic and OpenAI-ASR request policy is
unchanged. The interval remains a **model-only candidate pending native acceptance**.

The probe now samples process RSS and pending work at a requested 100 ms interval
through session completion, including inference after PCM feeding ends, and
records preparation duration and maximum feeder scheduling lag. Sampling is
asynchronous and sampler errors propagate. Previously, memory sampling ended
with audio feeding and could miss a slow inference's memory peak. It runs all
six trials before aggregating the original meaning/during-speech/correction/drop
checks; **any failed check still exits nonzero**. Failed numeric files have
`acceptancePassed: false` and a `-failed` filename. Passing filenames still
require every check; neither `model-before.json` nor `model-after.json` exists.
Structural final/revision/provider-error assertions remain immediate failures.
This aggregation records more failed observations and does not waive a check.

Actual commands (owned Ollama was stopped afterwards):

```sh
OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
# Ran both commands first with 1000ms, then with the final 500ms candidate.
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-interim-model.py before
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-interim-model.py after
uv sync --locked
npm run verify
```

Both candidates' before/after phases completed **three repetitions of two clips**
and all **four commands exited 1**: every construction final failed crane meaning.
Weather and steel keywords passed. Console review confirmed that the continuing
construction source added lifting, steel beams and construction site, but Korean
provisionals used deer and finals still used duck. There is no successful
contextual-meaning correction claim. Numeric observations are preserved in
`docs/verification/interim/model-{before,after}-1000-failed.json` and
`model-{before,after}-failed.json` (the latter are the final 500 ms candidate).
All contain numeric/identity/boolean data, without audio or source/translation text.

These are failed-cohort **session event** measurements, not tabCapture, DOM,
Chromium Paint, physical display or acoustic timing. The PCM proxies use first/
last absolute samples at least 100, with weather **0.417–1,356.792 ms** and
construction **1.542–3,181.958 ms**. Each phase has a fresh engine/process, explicitly
unloads only the selected Ollama model and prepares both adapters before timing.
Weights/OS/MLX caches remain; first inference is separate, not cold-cache evidence.
The current final-only path is the controlled `before` baseline, not a historical
build. Percentiles use nearest rank, exclude only the engine's first weather
inference, and consequently have weather **n=2** and construction **n=3**:

| Candidate / clip | Before start→first event p50 / p95 ms | After start→first event p50 / p95 ms | Before end→final event p50 / p95 ms | After end→final event p50 / p95 ms |
| --- | ---: | ---: | ---: | ---: |
| 1000 ms / weather (n=2) | 1995.554 / 1998.369 | 1213.070 / 1259.792 | 860.981 / 864.104 | 534.192 / 546.929 |
| 1000 ms / construction (n=3) | 3846.359 / 3906.805 | 1230.778 / 1262.809 | 1157.345 / 1219.663 | 707.466 / 744.421 |
| 500 ms / weather (n=2) | 1980.522 / 2001.803 | 686.542 / 710.819 | 850.062 / 871.820 | 546.006 / 547.079 |
| 500 ms / construction (n=3) | 3850.254 / 3874.227 | 676.159 / 711.071 | 1162.354 / 1193.755 | 822.571 / 825.088 |

The 500 ms engine-first weather sample's start→first / end→final events were
**941.700 / 541.420 ms**, with preparation **2,117.094 ms** and first ASR
**340.568 ms**. The corresponding final-only phase was **2,176.562 / 1,047.037 ms**,
preparation **2,392.438 ms**, first ASR **314.012 ms**. These are n=1 observations,
not proof of cold-start improvement or an explanation of the earlier 13.9-second
outlier. Moving imports can move waiting to preparation; capture-start/UI timing
has not been remeasured.

At 500 ms all three weather trials had five provisional events during speech,
one source change and **3 ASR / 2 translation calls**. Construction had
nine during-speech provisional events, four source changes and **7 / 6 calls**
each, compared with 1000 ms construction **4 / 3 calls**, two source changes and
15 during-speech events. These counts include streamed initial tokens, not nine
independent complete translations. Shorter intervals reduced observed first-event
waiting but increased calls and construction final latency. The initial weather
source was incomplete and its provisional Korean was fragmentary before final
correction. No claim of accurate provisional clauses or acceptable flashing can
be made without the remaining semantic and visual acceptance.

For the final 500 ms pair, sampled ASR/translation pending peaks were **0 ms**,
coalesced snapshots **0**, ASR/translation drops **0**, and maximum feeder lag
across trials was **15.231 ms before / 12.597 ms after**. These are isolated clips,
not continuous-load/no-backlog proof. Sampled process RSS peaks across the phases
were **161,824,768 / 757,612,544 bytes**; MLX active memory after trials was
**1,011,746,444 bytes**, with phase peaks **1,641,162,980 bytes**. A separate
`/api/ps` snapshot after all trials reported selected Ollama model / Metal
allocation **3,175,339,786 / 3,175,339,786 bytes**; this is not a sampled peak or
Ollama process RSS. Apple unified-memory metrics overlap and must not be added.
RSS varied greatly between first and subsequent inferences; these short trials
cannot establish memory stability. Reports retain per-call timings and each
caption's audio-position→event measurement for later native comparison.

Environment: **Apple M5 / 16 GiB**, Python **3.12.15**, mlx-audio **0.5.8**,
Ollama **0.35.1**, cached MLX Qwen3-ASR **0.6B 8bit**, Ollama
**qwen3:4b-instruct Q4_K_M/context4096**, English→Korean, HF offline and Ollama
cloud disabled. Independent JSON audit passed paired WAV hashes, every increasing
same-ID revision, first/final arithmetic, nearest-rank percentiles, sample counts,
bounded sampled queues, zero recorded drops and failed acceptance flags. The
four JSON files are failed observations, not passing acceptance receipts.

7d remains unchecked. Next work is still the original construction meaning
failure, then native Chrome tabCapture/covering-Paint comparisons of the selected
candidate with the same speech/settings, continuous speech/short pauses/silence,
subtitle full-character/expiry/correction appearance, speaker playback,
Stop/provider/session replacement, queue/drop and process/model memory. No new
browser/listening/visual evidence or interactive-access failure exists from this
iteration. There is no blocker requiring user input or credentials.

Final-source `npm run verify` passed **exit 0**: lint/typecheck/build, **JS 12 +
Python 168**, zero failures/skips/warnings, Python **66.17 seconds**. Base locked
environment was restored before verification. `uv lock --check` and
`git diff --check` passed. The owned Ollama server/runner stopped normally and no
8765/8766/11434 listeners remain. Only source, tests, README, plan and failed
numeric observations are intended for commit; `.ralph`, model weights, audio,
transcripts, build outputs and credentials are excluded.

## Ralph iteration 4/30 — 2026-10-06 — native interim harness; access blocked

Continued **7d**, with its checkbox unchecked. Product capture/model/output
contracts, model IDs, prompts, queue/VAD parameters and subtitle behavior are
unchanged. No paid API, credentials, other checkout, agent, dependency/lock change,
push, publication or runner modification was used.

Started the existing cached Ollama **0.35.1** with
`OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve` and installed the locked local group
using `uv sync --locked --extra local`. Local `/api/show` reported
**Qwen3-4B-Instruct-2507 / Q4_K_M**, the stored chat template and context parameters;
no model files were replaced. Text-only requests used context4096, temperature0,
num_predict256, English→Korean, the original generated construction sentence and
short weather/bank/bird/long-subtitle controls. Four bounded diagnostic batches
made **66 local chat requests** (30 + 7 + 5 + 24). They are not ASR, tabCapture,
Paint, paced audio or continuous-processing tests.

The original product prompt again mistranslated the construction crane as duck;
generic English/Korean/literal/context/role-preservation prompts also produced
animals. An English explanation correctly identified a heavy lifting machine,
which isolates this observed failure to Korean generation rather than an absent
source word. One `think:true` request returned the same incorrect translation,
without a reasoning field; no reasoning-support claim or product change follows.
Equipment/loanword instructions produced the crane keyword but used a broken
Korean role/particle and incorrectly used the machine name for the flying-bird
control. Rejected those candidates: a keyword alone is insufficient meaning
acceptance. No fixture-specific glossary, prewritten correction, new model,
extra inference stage or prompt change was adopted. These observations do not
prove that a future generic prompt cannot improve this model. The prior failed
paced model reports remain intact; no new passing model report exists.

Added `tests/local-interim-browser.mjs` and its test-only companion
`tests/interim_browser_metrics.py`. This comparison disables **only snapshots**
in `before`, unlike the older 7a harness's changed silence/withheld-partial control.
Both phases use fresh dedicated profiles/engines, the same generated WAVs and
selected models, preparation, current VAD300ms/quality pause/6-second cap and
streaming translator. The selected Ollama model is unloaded before preparation;
weights and OS caches remain, so the separate first-inference trial is not cold
cache. There are three warm repetitions of both original clips. Capture must
start/stop through the native extension toolbar; the harness does not synthesize
Start or substitute audio input.

The harness checks unique same-ID revisions, finals, original Korean weather/
construction meanings, source changes, during-speech Paint and sample counts via
its fixed trials. It records first/final covering main-frame Chromium Paint,
per-revision audio-position estimates, per-ASR durations/allocations, translator
invocations/completion/cancellation, coalescing, drops and queue samples. It
requests companion process RSS/pending samples every100ms through the session;
these are sampled bounds, not exact peaks or total system memory. MLX active/
peak allocations overlap RSS and are not summed. `translationUpdates` includes
initial token growth; `sourceCorrections` counts changes to the recognized source,
not proof that every change improves semantic accuracy. Generated text stays in
console/browser memory; reports contain numeric/identity/boolean metadata.

Speech start/end proxies use PCM abs>=100 and observed audio `playing`/currentTime.
Capture-relative audio-position→Paint estimates use first PCM receipt minus its
frame timestamp and20ms, so include local transport uncertainty. No acoustic or
physical-display claim is made. Reports cannot replace full text/appearance/
expiry, speaker listening, continuous load, lifecycle or paid-contract acceptance.
Failed semantic reports are marked `acceptancePassed:false` with `-failed` names;
Stop cleanup is required even after a failure. The `after` comparison reads the
latest controlled `before` report from ignored `.ralph/interim-browser-before.json`.
README contains the exact interactive commands and resumption steps.

New instrumentation regressions first failed twice with the missing module after
correcting a test import mistake. Both baseline/after cases now pass, checking
unchanged VAD boundaries, snapshot selection, forwarding captions unchanged,
raw source/translation exclusion, model timing/queue metadata and provider-stream
closure. A strengthened closure check caught deferred inner-generator cleanup
(**2 failures**) in the new wrapper; explicitly awaiting `stream.aclose()` fixed
it (**2 passed**). Initial formatting/lint errors were fixed; none of the rules
or acceptance assertions were disabled. These are fixture checks, not live models.

Actual browser attempts:

```sh
npm run build
node tests/local-interim-browser.mjs before
# The runner's first invocation had closed stdin: READY, cleanup, exit1.
# Retried with a PTY; READY in Chrome153.0.8010.12, dedicated ignored profile.
```

**Blocker:** native computer control could not obtain the dedicated browser's
window. `cua.getApp` with the observed Playwright application path returned
`Computer Use server error -10005: cgWindowNotFound`. Native app inventory then
listed **Google Chrome for Testing / com.google.chrome.for.testing / running**;
selecting that bundle ID returned the **same error**. The optional
`cua.computer.launch_app` API was not available on this macOS runtime
(`cua.computer.launch_app is not a function`). No app permission was changed or
alternate automatic capture trigger used. The native Start button was never
pressed, audio never played, and neither local model processed captured audio.
**No new native caption, Paint, visual, speaker-listening, paired browser timing
or continuous-load evidence exists.** No `browser-before*.json` or
`browser-after*.json` report was created. The browser harness itself remains
unverified beyond startup, syntax/lint and the companion fixture tests.

Required external resumption: restore computer-control access to the visible
Chrome for Testing window, or use the README's interactive harness manually with
native toolbar Start/Stop. Run `before` and then `after` on the same source/settings,
review the generated source/Korean captions, and keep semantic failures failed.
The construction accuracy issue still needs implementation work. Afterwards,
finish the remaining 7d continuous/long/pause/silence/appearance/expiry/lifecycle
and memory acceptance before checking 7d; 7b,8,9 remain next in order. This native
access blocker is not a model/API credential blocker and does not invalidate
previous 7a/7c evidence.

The PTY harness exited1 after `exit` because acceptance and native Stop were not
run; it closed its owned browser/context, companion and fixture. No capture was
started, so no Stop/cleanup success is asserted. The owned Ollama process was
terminated with SIGINT and exited0. `uv sync --locked` restored the base group.
8765/8766/11434 have no listeners. Temporary profiles/audio/probes, model weights,
transcripts, build copies and `.ralph` state are excluded from the intended commit.

Final-source **`npm run verify` exited0**: lint/typecheck/build, **JS12 + Python170**,
zero failures/skips/warnings; Python **66.14seconds**. `uv lock --check` and
`git diff --check` passed. This verifies the repository and companion fixtures,
not the blocked native acceptance. All intended source/test/documentation changes
are committed together; 7d remains unchecked and no completion promise applies.

## Ralph iteration 1/30 (resumed run) — 2026-10-06 — provisional cue retention

Continued item **7d**, after the previous run's iteration 4. The checkout started
clean; no repository AGENTS.md was present. `.ralph/verification.txt` still said
`No completion verification attempted in this run.` No agents, other worktrees,
runner changes, acceptance changes, model replacements, credential files, cloud
inference, publication or push were used.

The previous native-access blocker **did not recur**. The dedicated headed
Chrome for Testing window was accessible with
`cua.getApp("com.google.chrome.for.testing")`, with the observed title
**Interim subtitle acceptance**. Native Extensions → Interpreter → Start started
actual tabCapture; the popup was closed during measurement. The generated
Samantha weather/construction clips went through captured PCM, cached MLX
Qwen3-ASR 0.6B 8bit and local Ollama qwen3:4b-instruct, not injected captions.
The owned Ollama 0.35.1 server used `OLLAMA_HOST=127.0.0.1:11434` and
`OLLAMA_NO_CLOUD=1`; the companion used HF offline flags. The models, prompt,
4096 context, English→Korean, VAD and 500ms snapshot interval were unchanged.

The first native baseline exposed a harness bug after its first actual final:
`page.evaluate: TypeError: Cannot read properties of undefined (reading 'filter')`.
The collector was in Chrome's isolated extension world, while the reader used
the page's main world. Reading through `chrome.scripting.executeScript` in the
same isolated world fixes the error without exposing model text to page globals.
This initial run produced no comparison report. Native Stop followed by `stopped`
confirmed idle/no active capture/no offscreen document/no caption host; exit1
correctly retained the harness failure.

The first full native pair then exposed a product regression. The short
provisional construction caption finished its 2.5-second reading period while
speech/correction continued. The overlay retired its utterance ID, then rejected
the real final. All three construction finals had `visible:false` and null Paint;
their server events existed. Numeric failed evidence is preserved separately in
`interim/browser-{before,after}-expiry-failed.json`. The after cohort's first
Paint was faster and occurred during speech, but neither missing finals nor the
crane→animal mistranslation constituted passing 7d acceptance.

The sink now keeps the visible ending of the **latest provisional cue** available
for correction after reading it. It does not schedule an expired timer repeatedly.
Finalization gives the corrected text its reading time; arrival of a newer
utterance retires a fully read provisional cue. Retired IDs still reject later
finals/corrections. Older finals' clocks, timed long-text parts, four visible
lines, waiting bounds and Stop/session clear behavior remain in place. No new
capture, model or output interface was introduced. If a provider never finalizes
and sends no following cue, that last provisional ending remains until clear/Stop.

The built-sink regression was added **before** the fix. Actual command
`npm run test:captions-overlap-browser` exited1 with
`The latest provisional cue must survive until finalization` (empty vs expected
cue). After the fix the same command exited0. It checks delayed final display
and reading time, later-utterance retirement, expired/old revision rejection,
rolling order, every final character, narrow wrapping, fullscreen, controls,
overload counts, audio budget, session replacement and clear. Updated numeric
fixture evidence is `captions/rolling-fixture.json`; this fixture is not audio or
model evidence. Existing generated-caption PNGs were unchanged.

The initial baseline's actual normal-screen native screenshot was inspected:
the weather subtitle was legible, centered near the bottom with white outlined
text and a small dark background, separated from the page's audio controls. That
single screen does not establish narrow/fullscreen appearance, speaker listening,
continuous load, or the final construction's semantics. No screenshot containing
user audio/transcripts was created or committed.

Final-sink commands (each browser phase was a separate fresh headed profile):

```sh
npm run build
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
node tests/local-interim-browser.mjs before
node tests/local-interim-browser.mjs after
# In each: native Start, close popup, measure, native Stop, stopped, exit.
```

Both final-sink phases ran all seven samples and **exited1**: construction
`craneMeaning` failed in all three warm samples. Their passing file names were
not created. `interim/browser-before-failed.json` and
`interim/browser-after-failed.json` have `acceptancePassed:false`. Unlike the
pre-fix cohort, **every final in both phases now has a covering Paint**. Every
after sample has a provisional Paint during speech and one visible source
correction; the same utterance ID progresses through ordered revisions to final.
The normal-screen native construction final was also visually inspected after
the fix: its entire generated sentence was visible and legible, but the Korean
crane meaning was wrong (deer). Early weather text was incomplete/occasionally
ungrammatical before the later correct final. Faster first Hangul output is not
a claim that the first partial accurately expresses the entire clause.

Final pair, **warm n=3 per cell**, milliseconds (nearest-rank p50/p95):

| Generated clip / metric | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Weather voice start → first Paint | 2375.563 / 2420.613 | 966.282 / 1126.470 |
| Weather voice end → final Paint | 1397.405 / 1471.112 | 717.271 / 720.441 |
| Construction voice start → first Paint | 4305.342 / 4310.789 | 889.054 / 960.404 |
| Construction voice end → final Paint | 1972.142 / 1982.265 | 1667.632 / 1690.207 |

Source-audio end position → non-final revision Paint (token/revision samples,
not independent utterances): weather before **n24 / 935.768 / 1175.064ms**,
after **n19 / 506.889 / 875.954ms**; construction before
**n60 / 1260.035 / 1719.059ms**, after **n19 / 415.605 / 563.568ms**
(n/p50/p95). This is the age of the recognized source snapshot at Paint using
the receipt-origin estimate; it is not a speaker or physical-display clock.
Media voice bounds use generated PCM abs≥100 aligned to observed
`playing/currentTime`. Actual capture/transport alignment has uncertainty.

The separate first-engine weather sample was before **2470.793ms** to first
Paint / **1486.421ms** end→final; after **1244.334 / 753.381ms**.
Prepare took **3506.777 / 3413.507ms**, excluded from those timings. Both phases
used cached weights/OS/MLX caches, a fresh engine and an unloaded selected Ollama
model; these are **not cold-cache measurements**. Chrome153.0.8010.12,
Playwright1.63.0, Python3.12.15, mlx-audio0.5.8, Apple M5/16GiB.

Per warm clip: before **ASR1/translation1**, source corrections0;
after weather **ASR3/translation2**, construction **ASR7/translation6**, each
with one displayed source correction. After weather translation changes were
5/4/4 and during-speech Paint counts6/5/4; construction changes6/5/5 and Paints
7/6/6. Token growth is counted separately from source correction and does not
prove semantic improvement. Neither final cohort sampled waiting ASR/translation
audio above0ms; coalesced snapshots and frame/ASR/translation drops were0.
Short separated samples with expiry pauses do not establish sustained throughput.

Requested100ms companion RSS sampling peaked at **1256030208 / 1255440384bytes**
(before/after). Per-ASR MLX active maxima were **1034243890 / 1034295082bytes**,
phase peaks **1642064124 / 1642078452bytes**. They overlap on unified memory and
are not summed. These are companion/MLX measurements, not whole-browser/Ollama
memory or evidence of long-run stability. A separate independent JSON check
passed failed-report labeling, identical WAV hashes, sample counts, monotone
revisions, one final per utterance, zero-drop/bound checks, final/during-speech
Paint flags and exact percentile arithmetic for all four native reports.

All five native attempts (initial reader failure and two full pairs) passed their
native Stop `stopped` cleanup checks: idle, no active captured tabs, offscreen0,
caption hosts0. Failed runs remained exit1. Owned browser/companion/fixture
processes closed; Ollama stopped via SIGINT/exit0. `uv sync --locked` restored
the base environment; `uv lock --check` and `git diff --check` passed.

**7d remains unchecked.** The former window-access blocker is cleared; there is
no new external-access/credential blocker. Next work is the original construction
accuracy failure using the same permitted models/fixtures, then paired/native
long/continuous/context/pause/silence, all-character/expiry/appearance, speaker
listening, in-flight Stop/provider/session replacement and sustained queue/memory
acceptance. Existing 7a/7c evidence and the new short comparison do not satisfy
these remaining checks; 7b,8,9 also remain unfinished.

Final-source **`npm run verify` exited0**: lint/typecheck/build, **JS12 + Python170**,
zero failures/skips/warnings; Python **66.18seconds**. The final-source
`npm run test:captions-browser` also exited0 with generated-caption normal/narrow/
fullscreen, long-final character and cleanup assertions. Its PNGs are ignored
`.ralph` artifacts; it is not additional audio/model evidence. No listeners
remain on8765/8766/11434. All intended source, tests, failed numeric evidence,
README, verification document and plan progress are committed together. No
checklist checkbox or completion promise is warranted by these results.

## Ralph iteration 2/30 (resumed run) — 2026-10-06 — correction reading position

Continued the next unfinished item **7d** in the specified checkout. No repository
AGENTS.md was present; the supplied instructions apply. The checkout started
clean and `.ralph/verification.txt` contained
`No completion verification attempted in this run.` No agents, other worktrees,
credentials, paid inference, model replacements, runner/criteria changes, push or
publication were used. The 7d checkbox remains unchecked.

Investigated the existing construction translation failure with **31 bounded
text-only local requests**, using the cached Qwen3-4B-Instruct-2507 Q4_K_M model
and Ollama0.35.1, with cloud disabled and context4096/num_predict256. Six requests
compared the current chat request, omitted `think`, raw standard chat-template
input, an injected empty thinking block, and user-only instructions. The standard
template and omitted flag preserved the animal mistranslation; the injected block
returned untranslated English. Ten requests tested temperatures0.1/0.3/0.5/0.7/1
at seeds42/123. Ten tested generic task wording/input wrappers, and five tested
Korean/English terminology and grammatical-role instructions. None produced an
acceptable construction translation: animal substitutions persisted, or a crane
keyword appeared with an incorrect Korean role/steel-beam meaning. No candidate,
seed, sampling setting, template change or extra inference stage was adopted.
The [primary model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)
was checked for the template/mode/sampling context; its suggested settings do not
constitute evidence of translation accuracy. Temporary diagnostic scripts stayed
under ignored `.ralph`; no generated source/translation was added to a report.
These requests are not ASR, paced model timing, tabCapture or browser evidence.

The 7d correction requirement also exposed a separate built-sink regression.
After a narrow-screen provisional caption advances past its first timed part,
shortening the already-read prefix leaves the old numeric offset beyond the new
text. The visible suffix becomes **empty**, even though it remains in the revised
translation. Added the regression before changing the product:

```sh
npm run test:captions-overlap-browser
```

It **exited1**, with `Shortening a read prefix must preserve the visible suffix
rather than skip its characters` and actual empty text. The overlay now rebases
the reading offset using the unchanged prefix/suffix of the old and new Unicode
character sequences. An unchanged unread suffix retains its position across
prefix insertions/deletions; a replacement crossing the reading position is shown
from its edit boundary. The sentence node is retained and only its own reading
deadline is refreshed. Capture/model/output contracts, bounded display/queues,
model prompts, VAD and snapshot timing remain unchanged; no shared abstraction
was added.

With the product fix, the same regression reached a second **exit1**:
`Paint instrumentation must recognize the visible final suffix after the read
prefix expires`. Its test-only visibility marker required the displayed text to
be a prefix of the caption. Timed parts legitimately display a contiguous suffix.
The marker now checks the nonempty rendered text within the same utterance's
translation. Main-frame matching, covering Paint bounds and unsuperseded revision
checks are unchanged. The added assertion verifies **visibility classification**;
it does not claim a fresh covering Paint for text that remains identical.

After both fixes, the same command **exited0**, Chrome153.0.8010.12. The added
checks cover shortened/lengthened read prefixes, unchanged visible suffix/no
prefix replay, retained DOM node, final reading time, old partial rejection, and
a complete rewrite of the current part. Existing every-final-character, normal/
270px narrow/fullscreen, four-line bounds, front expiry, controls, late responses,
clear/session replacement and counted overload assertions also passed. Numeric
generated-caption evidence is updated in `captions/rolling-fixture.json` with
`correctedReadingPosition`, `rewrittenCurrentPart` and `suffixTraceVisibility`.
The ignored `.ralph/reading-position-corrected.png` was visually reviewed: the
two-line suffix is readable with outlined white text and a dark background above
the controls at270×700. Existing generated fixture PNGs were unchanged.

**No new native audio/browser attempt was made in this iteration.** There is no
new access failure or external blocker. These headless generated-caption checks
do not establish acoustic playback, real ASR/translation correction accuracy,
continuous load, latency improvement or completion of 7d. The original failed
model/native JSON reports are preserved and no passing audio report was created.
Next iteration should continue **7d**: resolve the original construction meaning
failure with the permitted models and unchanged assertions, then finish native
paired long/continuous/context/pause/silence, all-character/expiry/appearance,
speaker listening, in-flight Stop/provider/session and sustained queue/memory
acceptance. 7b,8,9 remain subsequent work.

Final-source **`npm run verify` exited0**: lint/typecheck/build, **JS12 + Python170**,
zero failures/skips/warnings; Python **66.12seconds**. The owned Ollama process
stopped via SIGINT/exit0. The fixture browser/server closed after each failed or
passing run; no listeners remain on8765/8766/11434. `uv sync --locked` restored the
base environment; `uv lock --check` and `git diff --check` passed. No audio/
transcripts, credentials, weights, temporary `.ralph` state, dependency/lock
changes or build output are intended for commit.

## Ralph iteration 3/30 (resumed run) — 2026-10-06 — missing-final translation stall

Continued **7d**, the next unfinished checklist item, only in the specified
checkout. There is no repository AGENTS.md; the supplied instructions apply.
The checkout started clean and `.ralph/verification.txt` contained
`No completion verification attempted in this run.` No agents, other worktrees,
credentials, model changes, cloud calls, runner/acceptance changes, push or
publication were used. Capture/model/output contracts remain unchanged.

Found a session-level stall when an utterance has a provisional caption but ASR
does not emit its final text (an empty final result or a dropped waiting ASR
segment). A translation response still in progress blocked the next finalized
utterance, potentially until the response's 30-second deadline. The existing
handling advanced past a completed provisional response, but did not cancel an
unfinished one. Established the regression before editing the product:

```sh
uv run --locked pytest -q tests/test_local_interim.py -k missing_asr_final
```

It **exited 1: 1 failed, 1 passed, 7 deselected**, in 1.12 seconds. The unfinished
response case timed out waiting for cue2's final; the completed-response control
passed. The fixture withholds cue1's ASR final, queues cue2's partial and final,
and makes the old translator return late text even when cancelled.

The revising session now closes the unfinished provisional translation when a
different, later utterance has finalized source. It retires the obsolete cue and
uses the existing bounded queue to process the finalized speech. A newer partial
alone does not interrupt it, and a translation of already-finalized source keeps
its existing priority. Abandoned provisional source/translation does not enter
recent context. No final text is fabricated for the missing ASR result, and the
stream closure suppresses cancellation-resistant output and late ASR revisions.
The change adds 12 lines to the existing feature-local session. No new abstraction,
timeout, inference stage, prompt, snapshot/VAD timing or queue limit was added.

The focused compatibility command **exited 0: 100 passed in 30.78 seconds**:

```sh
uv run --locked pytest -q tests/test_local_interim.py tests/test_local.py tests/test_local_prepare.py tests/test_text.py tests/test_live.py
uv run --locked ruff check server tests
git diff --check
```

Both new cases passed, including subsequent finalized output, exclusion of
provisional context, closed obsolete stream, rejection of late output, zero final
translation drops and drained waiting work. Existing tests preserved bounded
final queues under overload, correction/final distinction, source supersession,
Stop cleanup and cloud final-only contracts. Ruff and the whitespace check passed.

**No new real-model, native browser, Paint or listening attempt was made.** These
are deterministic adapter fixtures, not acoustic, translation-quality or
sustained-load evidence. Previous failed construction/model/native reports and
their assertions remain unchanged. There is no new external-access blocker.
**7d remains unchecked.** Next work still needs the original construction meaning
failure resolved using the permitted models, and native paired long/continuous/
context/pause/silence, all-character/expiry/appearance, speaker listening,
in-flight Stop/provider/session replacement and sustained queue/memory checks.
7b,8,9 remain subsequent items.

Final-source **`npm run verify` exited 0**: lint, typecheck, extension build,
**12 JavaScript + 172 Python tests**, zero failures/skips/warnings. Python took
**66.15 seconds**. `uv lock --check` passed; no dependency or lock changes were
needed. The listener check found no processes on 8765/8766/11434. No model,
companion or browser process was started for this iteration. `git diff --check`
passed. Only the session fix, regression tests, README, this evidence and plan
progress are intended for the Conventional Commit; no credentials, weights,
audio/transcripts, build output or temporary `.ralph` state are included.

### Ralph iteration 4/30 (resumed run): continuous provisional-model load

Continued **7d**, leaving its checkbox unchecked. The specified checkout started
clean, had no AGENTS.md, and `.ralph/verification.txt` still said
`No completion verification attempted in this run.` The supplied instructions
apply. Capture/model/output contracts, product prompt/model IDs, VAD/snapshot/
queue settings, dependencies/locks, acceptance criteria and runner are unchanged.
No agents, other checkouts, credentials, paid API, push or publication were used.

Made **12 bounded text-only local requests** with generic English/Korean/Chinese
translation instructions. They used the original construction sentence and the
cached Qwen3:4b-instruct model, temperature0, context4096 and num_predict256.
Eleven candidates substituted animals; one used the crane noun with the wrong
Korean grammatical role. None was adopted. These are diagnostic requests, not
ASR, tabCapture, browser Paint, or successful semantic correction evidence.

Added `tests/local-interim-continuous.py`, a feature-local verification harness.
It feeds ten rounds of the existing weather/construction and multi-clause
trip/rain/umbrella/station fixture text into one local session, with a fixed
400ms extra pause between clips and a two-second final silence tail. Input is
scheduled every20ms without waiting for inference or subtitle expiry. Only
snapshots are disabled in `before`; both phases use the current product prompt,
models, 300ms silence/quality-pause/six-second cap, English→Korean settings,
single MLX worker, preparation and identical ASR/text warmup. Generated audio
is temporary under ignored `.ralph` and removed; generated text is reviewed in
the terminal only. Durable reports contain numeric measurements, IDs and check
flags, with no audio or transcript. Sampler errors propagate instead of leaving
an apparently successful partial memory sample.

Commands actually used, from this checkout:

```sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
uv sync --locked --extra local
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-interim-continuous.py before
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONPATH=. \
  uv run --locked --extra local python tests/local-interim-continuous.py after
```

Initial three-round/41.054-second smoke comparisons both exited1. They exposed
a checker false negative: valid Korean prohibitive `취소하지 말` was classified
as missing negation. Corrected this new harness's recognizer to accept that
specific negative construction, while retaining affirmative rejection and all
source-detail, crane/steel, time, queue, revision, finalization and timing checks.
The initial temporary numeric reports remain ignored under `.ralph`; the final
ten-round reports below use the corrected check. No product translation was
rewritten and no original fixture or prior failed report was changed.

Environment: Apple M5, **16GiB**, Python**3.12.15**, mlx-audio**0.5.8**,
MLX**0.32.3**, NumPy**2.5.3**, Ollama**0.35.1**, cached
Qwen3-ASR0.6B8bit and Qwen3:4b-instruct **4.0B/Q4_K_M**. Ollama cloud was
disabled and Hugging Face/Transformers were offline. Product translation
requests retain context4096, temperature0, num_predict256 and think:false.

Final runs used identical PCM hashes and **132178.333ms of scheduled input**.
Elapsed times were **132183.622/132182.118ms**, excluding identical warmup steps
that took **2040.893/2114.537ms** including preparation. These are cached, warmed
model runs with fresh Python/MLX engines; there is no cold-cache comparison.
Both commands **exited1**, with `acceptancePassed:false`, preserving only
`docs/verification/interim/continuous-before-failed.json` and
`continuous-after-failed.json`. All30 fixture-source/detail/final/revision checks
passed; **all ten construction translations in each phase failed crane meaning**.
No passing report was created. Manual terminal review also found some longer
translations changing the station meeting instruction into a future statement.
Keyword-check success on those clips is not complete semantic correctness.

Nearest-rank **p50/p95 in milliseconds**, **n10 clips per row per phase**:

| Session-event measurement | Snapshots disabled | Snapshots enabled |
| --- | ---: | ---: |
| Weather voice start → first event | 2000.965 / 2042.790 | 713.435 / 789.468 |
| Construction voice start → first event | 3841.208 / 3955.141 | 690.268 / 746.436 |
| Long speech voice start → first event | 6336.758 / 6396.093 | 685.471 / 723.767 |
| Weather voice end → last final event | 868.533 / 930.716 | 548.943 / 857.558 |
| Construction voice end → last final event | 1179.322 / 1290.345 | 836.010 / 851.730 |
| Long speech voice end → last final event | 853.533 / 914.083 | 1009.027 / 1158.642 |

Across all30 clips, first-event p50/p95 was **3841.208/6359.569 →
707.044/771.065ms**, and last-final p50/p95 was **902.719/1249.556 →
829.434/1131.669ms**. Long-speech final latency worsened despite the aggregate
improvement. Nonfinal-caption source-end→first event, deduplicated by
`(utteranceId,audioEndMs)` rather than treating each token as an independent
sample, was weather **n10,519.215/570.848 → n22,323.896/492.316ms**;
construction **n10,584.749/659.183 → n39,604.701/750.368ms**; long speech
**n20,451.010/652.827 → n69,540.550/831.605ms**. These include streamed
nonfinal captions from confirmed ASR segments and are not exclusively provisional
ASR events. The disabled-snapshot long clips also have captions while the overall
clip continues, after the six-second segment boundary; that is not evidence of
early provisional ASR. All of these measurements end at a **session event, not
browser Paint, acoustic output, or a physical display**.

Both phases emitted **40 final segments**, with monotonically increasing unique
caption revisions and no displayed cue left without a final. ASR calls increased
**40→252**, translator requests **40→212**, complete translator responses
**40→150**; **62** enabled-phase requests were superseded/cancelled before
completion. Total serial ASR worker time was **7266.918→59764.463ms**, about
**5.5%→45.2%** of input duration. First-event improvements therefore have a real
processing cost. Source-change counts were **0→110** (weather14, construction39,
long57), including extensions of text rather than demonstrated improvements in
meaning. Nonfinal events during clip speech were **358→281**, and total caption
events **762→390**; token events are not independent translations/corrections.

ASR/translation drops were **0/0** in both phases and snapshot coalescing0.
Requested100ms samplers collected **1171/1224** queue/RSS observations through
the end of processing. Sampled pending-audio peaks were **0→6000ms ASR** and
**0→1360ms translation**; these measure queued audio duration, not wall-clock
waiting time. Each enabled-phase20-second bin had an ASR peak6000ms, without
increasing peaks; final queues were0. Scheduled-frame lag maxima were
**23.184/28.219ms**, below this harness's100ms pacing check. This fixed,
two-minute workload shows bounded bursts and preserved finals, not a general
real-time guarantee or the required ten-minute advancing public-video test.

Process-RSS peaks were **351223808/373768192bytes**, and last12-second sample
ranges **282738688–287784960/276545536–282345472bytes**. Per-ASR MLX active
peaks were **1034002226/1034233650bytes**, process-wide MLX peaks
**1680168416/1680166368bytes**, including warmup. RSS and MLX are different
measurements and are **not summed**; these are not whole-browser/Ollama memory.
An independent numeric audit checked identical PCM/settings,30 trials/40 finals,
per-cue monotonic revisions, all check flags/failing construction instances,
sample coverage through the end, exact percentiles and the ASR-time sum.
It exited0; failed reports remain failed.

**7d remains unchecked.** No native browser/tabCapture, speaker listening,
subtitle DOM/Paint, visible semantic correction/expiry, in-flight Stop or
provider/session replacement was attempted in this iteration. No new native
access or credential blocker was established. Next work remains the original
construction and longer-sentence meaning, then the required native paired
long/continuous/context/pause/silence, appearance/listening/lifecycle and
sustained-load acceptance. The permitted models, original assertions and prior
failed evidence remain intact; 7b/8/9 remain subsequent items.

Final-source **`npm run verify` exited0**: lint/typecheck/build,
**12 JavaScript + 172 Python tests**, zero failures/skips/warnings; Python
**66.19seconds**. Ruff and `python3 -m py_compile` checked the new harness.
`uv sync --locked` restored the base environment; `uv lock --check` and
`git diff --check` passed. The owned Ollama server/runner stopped by SIGINT,
exit0; there are no8765/8766/11434 listeners. No browser or companion was
started. Only the harness, two failed numeric reports, README, this verification
record and plan are intended for the Conventional Commit. Keys, weights,
audio/transcripts, build output and temporary `.ralph` state are excluded.

## Ralph iteration 5/30 (resumed run) — 2026-10-06 — continuous native caption Paint

Continued unfinished **7d** in the specified checkout. AGENTS.md was absent and
`.ralph/verification.txt` contained `No completion verification attempted in this run.`
The checkbox remains unchecked. No agents, other checkout, credentials, paid API,
model replacement, prompt/product/VAD/snapshot/queue change, dependency/lock change,
runner/criteria modification, push or publication was used.

Eleven bounded text-only local requests (two current-product inputs and three
generic prompt candidates across construction/bird/long-speech controls) again
failed to provide an acceptable construction translation. The current full long
sentence also changed before-noon timing to 3pm; candidates either retained errors
or weakened the station instruction into a future statement. No candidate was
adopted, and these are not ASR, playback or Paint evidence.

Extended `tests/local-interim-browser.mjs` with the `continuous` command. Native
Extensions → Interpreter → Start establishes actual tabCapture, with the popup
closed. The same cached MLX0.6B8bit and Ollama qwen3:4b-instruct Q4_K_M, English→Korean,
context4096, temperature0, num_predict256, VAD300ms/quality pause/six-second cap,
preparation and streaming apply in both phases. Only snapshots are disabled in
`before`. Three rounds of weather/construction and the existing long
trip/rain/umbrella/station fixture advance to media `ended`, with 400ms added
pauses. Playback does not wait for inference or subtitle expiry. Afterwards the
harness waits for source finalization, inference drain and visible subtitle expiry.
It reports all caption metrics, revisions/Paint, calls, queues and companion RSS/MLX;
synthetic source/translation text is reviewed only in terminal output.

Commands actually used (repository-local uv/Ollama binaries):

```sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 .tools/ollama/ollama serve
PATH="$PWD/.tools/uv/bin:$PATH" uv sync --locked --extra local
PATH="$PWD/.tools/uv/bin:$PATH" npm run build
PATH="$PWD/.tools/uv/bin:$PATH" node tests/local-interim-browser.mjs before
PATH="$PWD/.tools/uv/bin:$PATH" node tests/local-interim-browser.mjs after
# Each phase: native Start, close popup, stdin continuous;
# afterwards native Stop, stdin stopped, stdin exit, even on failure.
```

The first native baseline exposed a test-only assignment bug: estimated VAD end
includes trailing silence and did not associate several clips within 200ms of
the PCM voice boundary. Preserved `continuous-browser-before-assignment-failed.json`;
its per-clip timing/checks are invalid comparison evidence. Assignment now uses
the audio interval center with the same 200ms tolerance, while retaining actual
start/end coordinates. Every caption must be assigned exactly once.

The next pair exposed the event-arrival tracer's limit: waiting captions were
not yet attached to the DOM when their final events arrived. Preserved
`continuous-browser-{before,after}-arrival-only-failed.json`; null Paint there
means no covering Paint at the event's visibility mark, not proven lifetime loss.
A feature-local test-only Shadow DOM observer now marks a still-current waiting
revision when its text is actually attached and visible. Superseded revisions
are replaced in the observer; clear/start forget them. These marks still require
an actual covering main-frame Chromium Paint, using the unchanged trace matcher.
The final pair reruns both phases with this tracer; arrival/DOM/rAF alone is not
promoted to successful Paint evidence.

The final `continuous-browser-{before,after}-failed.json` pair has identical WAV
hashes, nine clips/three rounds and twelve finalized cues per phase. Actual media
playback spans **39054.595 / 38954.386ms**, including the fixed inter-clip pauses.
Both commands exit **1**, `acceptancePassed:false`; no passing report exists.
Every caption is assigned exactly once, revisions increase per ID, every final
has covering Paint, and inference queues drain with zero reported frame/ASR/text
drops. Construction crane→animal fails in **all three samples of both phases**.
In `after`, both warm weather and construction samples also fail during-speech
Paint; the first-Paint improvement check fails. Weather and long final keyword
checks pass, but the final station instruction's strength can vary; keyword
checks alone are not comprehensive semantic acceptance.

Warm results below exclude the entire first round, **n=2 per clip per phase**.
These very small samples describe this run and do not establish a general p95.
Times are ms, p50 / p95, using the plan's nearest-rank convention:

| Clip / measurement | Before | After |
| --- | --- | --- |
| Weather voice start → first Paint | 2261.530 / 2367.091 | 2249.029 / 3389.273 |
| Construction voice start → first Paint | 4287.604 / 4406.574 | 4855.582 / 5850.322 |
| Long voice start → first Paint | 6803.912 / 6907.623 | 1672.227 / 2193.910 |
| Weather voice end → last final Paint | 1333.969 / 1402.099 | 1433.495 / 2644.245 |
| Construction voice end → last final Paint | 2036.055 / 2086.430 | 1949.965 / 2669.906 |
| Long voice end → last final Paint | 1942.524 / 1989.718 | 2466.820 / 2536.725 |

First-round weather/construction/long start→first was respectively
**2489.990/4315.375/6556.472 → 1195.473/916.383/1696.114ms**;
end→last-final **1527.044/1983.328/1723.640 → 731.641/1997.858/3418.877ms**.
Preparation **3519.878 / 3666.247ms** is excluded. Weights/OS caches were warm,
engines were fresh and the selected Ollama model unloaded; this is not a cold-cache
comparison. Partial audio-position→first covering Paint, grouped by `(ID,audioEnd)`
instead of counting every token, was **n12,899.721/1526.515 → n13,1076.482/4241.796ms**.
It includes token streaming of finalized ASR segments and actual sink waiting.
Media bounds use PCM abs≥100 and observed playing/currentTime; capture position
uses estimated first-receipt origin, including transport uncertainty, not acoustic
output timing. Later visibility Paints were observed after event arrival by
**504.019ms** (warm construction cue6 final), **188.574ms** (long cue7 provisional),
and **3410.729ms** (warm construction cue10 final). No DOM timestamp was substituted
for Paint. Reading/storage and inference waits are separate sources of delay.

ASR calls **12→67**, worker inference time **4679.217→33292.506ms**, approximately
**12.0→85.5%** of playback span; this ratio is not whole-system CPU/GPU utilization.
Translation requests **12→51**, completed **12→14** (37 revised requests incomplete/
cancelled), with observed source changes **0→7**. Counts include source extension,
not necessarily word-sense improvements. During-speech Paints by round and clip
were **[0,0,15;0,0,6;0,0,9] → [3,8,5;0,0,1;0,0,7]**. Repeated local inference and
translation cancellation are measurable costs; shared-GPU contention is a possible
contributor, not independently established as the cause here.

Sampled waiting ASR/audio peaks **1720→6500ms**, text **0→2940ms**, coalesced
snapshots **0→8**, final sampled queues zero. These audio-duration queue metrics
are not wall-clock wait. After-phase first four 10-second bins had ASR peaks
**4220/6500/5780/6000ms**, text **1100/2940/2460/1400ms**; no monotonic growth in
this short run is not sustained-ten-minute acceptance. Companion RSS had **432/443**
observations through subtitle drain, peaks **121110528/113754112 bytes**. MLX active
peaks **1034000178/1034194738**, global phase peaks **1680164320/1680166368 bytes**
are overlapping allocation metrics and are not added to RSS. Whole-browser/Ollama
memory remains unmeasured. Environment: Apple M5/16GiB, Chrome153.0.8010.12,
Playwright1.63.0, Python3.12.15, mlx-audio0.5.8/MLX0.32.3, Ollama0.35.1, offline HF
and Ollama cloud disabled.

Inspected native and ignored normal-viewport screenshots. Long/new text coexist
within the subtitle region and controls stay above it. The crane text remains
incorrect; an early long provisional fragment also has a wrong/incomplete
negation before the corrected final. This is not complete all-character/reading-time,
narrow/fullscreen, physical-display, acoustic playback, public-video or ten-minute
acceptance. No new in-flight Stop or provider/session replacement run was performed.
All **five** native attempts used native Stop and passed idle/no active captured
tab/no offscreen context/no caption host checks, including failed semantic runs.
Owned browser/companion/fixture processes exited; owned Ollama stopped with SIGINT,
exit0. Generated temporary speech is deleted and not committed. Base dependencies
were restored with `uv sync --locked`; the lock is unchanged.

An independent numeric audit passed exact-once assignment, identical hashes,
9 clips/12 finals per phase, increasing revisions, covering-Paint bounds, unchanged
coordinates, all warm nearest-rank percentiles, queue/drop flags and the correctly
false improvement flag. It is a report-correctness check, not a passing 7d test.
Next: measure a modestly longer snapshot interval or reduced obsolete work with
these same native fixtures to resolve continuous short-speech delay, and address
construction/long semantic failures with the permitted model. Preserve the original
meaning/during-speech checks. Finish remaining 7d appearance/lifecycle/acoustic
acceptance before 7b/8/9. No new external-access blocker was found.

Final `npm run verify` **exit0**: lint/typecheck/build, **12 JS + 172 Python**
tests, failures/skips/warnings0, Python **66.24s**. `node --check`, `uv lock --check`
and `git diff --check` passed. No listeners remained on8765/8766/11434. Harness,
numeric failed evidence, README/docs and plan progress are committed together;
no weights, credentials, audio/transcripts, build or temporary `.ralph` state are
committed. 7d and overall completion remain pending.
