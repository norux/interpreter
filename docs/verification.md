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
