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
