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
