# Jamak agent harness

Jamak is a desktop Chrome extension for on-device live Korean subtitles. `apps/chrome` is the only shipping application. iPhone Safari and a macOS app are planned, not implemented. Do not recreate the removed server or companion app without an explicit request.

## Read before editing

- [Documentation index](docs/README.md)
- [Architecture and runtime boundaries](docs/architecture/media-framework.md)
- [Coding conventions](docs/coding-conventions.md)
- [Verification and local fixtures](docs/testing.md)

Read the relevant feature verification document when changing recognition, translation, speaker assignment or caption lifecycle.

## Scope and implementation

State assumptions and observable success criteria before coding. Preserve the existing architecture and use the smallest change that satisfies the request. Establish a failing regression check for bugs. Keep unrelated changes out. Internal channel names, CSS selectors and model cache keys may retain the old `interpreter` prefix for compatibility; user-facing branding is Jamak.

Application code and brand assets are MIT-licensed; keep upstream model attribution and separate licenses intact.

Never commit credentials, model weights, user recordings, `.ralph` output or OS metadata. Synthetic, reproducible test fixtures belong in `tests/fixtures`.

With Chrome defaults, manual English and Japanese prefer Chrome local streaming speech when its API is supported, regardless of WebGPU. Publish interim revisions through the existing native path; coalesce drafts for 180 ms and publish native finals immediately. Use Whisper when the local speech API is unsupported. Keep engine selection, popup model descriptions and cached-model checks consistent. Whisper timestamp segments are not sentence boundaries: preserve unfinished speech across snapshot cuts and never replay a committed prefix after punctuation corrections. Drain retained tails at a completed automatic speech boundary before detecting the next turn's language.

Keep `PRIVACY.md` consistent with local audio/text/speaker processing, in-memory transcript retention and external model downloads. Stop releases capture/inference resources but can leave transcript text in the background snapshot or an open history window; do not promise immediate text deletion on Stop.

## Documentation synchronization — required for feature changes

Whenever a feature is added, removed or modified, review and update all of the following in the same change:

1. `README.md`: supported capabilities, installation, limitations and platform status.
2. `AGENTS.md`: agent workflow, application scope and invariants affected by the feature.
3. `docs/`: architecture, coding conventions and verification instructions or evidence affected by the feature.

Make concrete edits wherever the behavior or instructions changed. If a document remains accurate, explicitly report that it was reviewed and why no edit was needed. Do not add meaningless edits just to touch a file. Do not mark the work complete while documentation contradicts implementation, or present planned platforms as supported.

## Automatic language invariants

Automatic mode supports English/Japanese/Korean speech through the selected multilingual Whisper; Chrome defaults use Turbo FP16/WebGPU, while explicit q8 selections use WASM. Automatic detection is opt-in; the popup defaults to manual Japanese. Selecting English/Japanese/Korean disables detection. With Chrome defaults, manual English and Japanese prefer SODA; manual Korean uses fixed-language Whisper and bypasses translation. `auto` is a session selection, never a transcript language: each utterance carries its detected `en`, `ja` or `ko` through recognition, translation and overlay validation. English/Japanese translate to Korean; Korean speech bypasses native translation and pairs with its original text. Preserve first-word PCM and queued speech boundaries during inference. Recent language is a session-local tie breaker, not a fixed language per speaker. Stop/navigation must retire both prepared translation pairs and pending recognition.

Ready captions stack below earlier captions and accrue reading time concurrently. Retire completed rows oldest first, preserve each row’s measured two-line parts and correction offsets, and never spend the reading time of clipped/offscreen rows. The model-information table uses the prepared engine’s actual model list when available.

Fullscreen captions use a manual popover in the page's top layer, including video-only and embedded-frame fullscreen. Keep the overlay noninteractive, preserve caption revisions and reading progress through entry/exit, and remove the top-layer surface on Stop/disposal. Do not replace the page's fullscreen target or modify its video element.

Recognition and translation selections are independent, on-device only and persisted in extension-origin localStorage without additional permissions. Advanced selection stops the old session before preparing the new models; prepared snapshots freeze both choices. Keep engine/backend selection, cache readiness, popup model information and documentation aligned. Explicit model failure must stay visible, never silently switch to another model. Korean bypasses every translator. Preserve pinned revisions, sizes/hashes and separate upstream licenses, including NLLB’s noncommercial restriction.

Download progress must come from background preparation state, survive popup closure and reflect the current model stage. Keep stages without reported progress indeterminate; downloaded files do not imply that model loading is complete.

## Verification and delivery

Run `npm run verify` for broad changes. For a scoped change, run the checks listed in `docs/testing.md` that demonstrate its behavior. Distinguish mocked display tests from real audio/model/browser verification. Report commands, failures and environment limitations honestly.

For Japanese recognition or translation changes, use the non-looping two-voice `tests/fixtures/conversation/ja` fixture and `npm run test:conversation:ja:live`. Check final source/Korean meanings and actual display completion; preparation or a paired translation alone does not prove quality. Record remaining recognition/translation errors explicitly.

Use Conventional Commits with one intent per commit. Push, publish, rename a remote repository or modify external settings only when the user has authorized the action.

Chrome Web Store releases use `npm run release:chrome` with API V2 and private `.env.chrome-store` credentials; see [release setup](docs/releasing.md). The command uploads and submits for automatic publication after approval. Use `-- --dry-run` for local verification/packaging without authorization to publish. Increase the extension manifest version for new uploads; never package credentials or release archives in `apps/chrome/dist`.

The main checkout owns the private release credentials. Orca can copy or link `.env.chrome-store` into new workspaces through its local shared-path setting. Keep these files Git-ignored and owner-readable only; do not print their values or assume a workspace copy follows later credential changes.
