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
