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

On WebGPU devices, Japanese uses Whisper large-v3-turbo; English prefers Chrome local speech. Japanese can use Chrome local speech when WebGPU is absent. Keep engine selection, popup model descriptions and cached-model checks consistent. Whisper timestamp segments are not sentence boundaries: preserve unfinished speech across snapshot cuts and never replay a committed prefix after punctuation corrections. Drain retained tails at a completed automatic speech boundary before detecting the next turn's language.

## Documentation synchronization — required for feature changes

Whenever a feature is added, removed or modified, review and update all of the following in the same change:

1. `README.md`: supported capabilities, installation, limitations and platform status.
2. `AGENTS.md`: agent workflow, application scope and invariants affected by the feature.
3. `docs/`: architecture, coding conventions and verification instructions or evidence affected by the feature.

Make concrete edits wherever the behavior or instructions changed. If a document remains accurate, explicitly report that it was reviewed and why no edit was needed. Do not add meaningless edits just to touch a file. Do not mark the work complete while documentation contradicts implementation, or present planned platforms as supported.

## Automatic language invariants

Automatic mode supports English/Japanese/Korean speech and requires the local Whisper WebGPU path. Automatic detection is opt-in; the popup defaults to manual Japanese. Selecting English/Japanese/Korean disables detection. Manual English prefers SODA; manual Japanese prefers Whisper on WebGPU and uses SODA without WebGPU; manual Korean uses fixed-language Whisper and bypasses translation. `auto` is a session selection, never a transcript language: each utterance carries its detected `en`, `ja` or `ko` through recognition, translation and overlay validation. English/Japanese translate to Korean; Korean speech bypasses native translation and pairs with its original text. Preserve first-word PCM and queued speech boundaries during inference. Recent language is a session-local tie breaker, not a fixed language per speaker. Stop/navigation must retire both prepared translation pairs and pending recognition.

Ready captions stack below earlier captions and accrue reading time concurrently. Retire completed rows oldest first, preserve each row’s measured two-line parts and correction offsets, and never spend the reading time of clipped/offscreen rows. The model-information table uses the prepared engine’s actual model list when available.

Download progress must come from background preparation state, survive popup closure and reflect the current model stage. Keep stages without reported progress indeterminate; downloaded files do not imply that model loading is complete.

## Verification and delivery

Run `npm run verify` for broad changes. For a scoped change, run the checks listed in `docs/testing.md` that demonstrate its behavior. Distinguish mocked display tests from real audio/model/browser verification. Report commands, failures and environment limitations honestly.

For Japanese recognition or translation changes, use the non-looping two-voice `tests/fixtures/conversation/ja` fixture and `npm run test:conversation:ja:live`. Check final source/Korean meanings and actual display completion; preparation or a paired translation alone does not prove quality. Record remaining recognition/translation errors explicitly.

Use Conventional Commits with one intent per commit. Push, publish, rename a remote repository or modify external settings only when the user has authorized the action.
