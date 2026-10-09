# Jamak architecture

Jamak ships one Manifest V3 desktop Chrome extension from `apps/chrome`. The former Python server, macOS companion and legacy `extension/` application are removed. iPhone Safari and a macOS desktop app are roadmap items only.

## Runtime and data flow

1. The popup selects English or Japanese, prepares models and starts/stops capture for its original tab.
2. The service worker coordinates session state and action-granted tab access. It owns the control channel, not inference.
3. An offscreen document keeps tab capture, audible playback and inference alive after the popup closes.
4. `packages/media-web` and the audio worklet provide ordered PCM with capture-relative timing. Tab capture includes iframe and Web Audio output; it does not isolate one video or capture microphones/system audio.
5. `packages/engines-browser` normalizes input, recognizes speech, translates text to Korean and independently estimates speakers. Source and translation revisions share session, epoch and utterance identity.
6. `packages/core` reconciles revisions and schedules presentation. The page content script renders subtitles through `packages/presentation-web`; a separate window shows original/translation history.

Navigation, target loss and Stop invalidate the session and release resources. Stale worker replies or acknowledgements must not revive captions. Model preparation persists independently of the popup; cancellation and disposal must release workers and pending jobs.

## Caption and speaker invariants

- Never pair a translation with a different source revision or epoch.
- Preserve the previous translation while its correction is pending.
- Do not discard unread captions or replay a retired sentence when final recognition arrives in a burst.
- Keep visible reading progress separate from transcript storage. Only visible text counts toward reading time.
- Completed caption parts remain for 4–6 seconds, followed by the existing 250 ms fade. Queued captions do not fade the entire cue to blank.
- Speaker inference runs independently of text presentation. Stable session-local IDs select background colors; no “speaker 1” labels are rendered.
- Very short or uncertain speech can remain unassigned. Speaker numbers are anonymous clusters, not personal identity.

## Models

| Task | Runtime/model | Conditions |
| --- | --- | --- |
| Recognition | Chrome SODA, local SpeechRecognition | Preferred when the required local API and language packs are available |
| Recognition fallback | Whisper large-v3-turbo FP16 through Transformers.js/ONNX | WebGPU-capable device; larger first download |
| Voice activity for fallback | Silero VAD | Bundled ONNX runtime; pinned artifact |
| Translation | Chrome TranslateKit | Local Translator API and English/Japanese → Korean packs |
| Speaker embeddings | WeSpeaker VoxCeleb ResNet34-LM q8 | Local WASM worker; ~6.7 MB first download |

The complete pinned artifact inventory, sizes and hashes lives in `packages/engines-browser/model.ts`. Preparation/testing candidates are not all user-selectable product modes. Model downloads use the manifest's allowed Hugging Face endpoints; inference does not send audio or embeddings to a server. Chrome manages its own language packs. Availability is device/browser dependent; first downloads need internet.

WeSpeaker weights are CC-BY-4.0; see [attribution](../verification/captions/conversation-speakers.md). The upstream [Whisper weights](https://huggingface.co/openai/whisper-large-v3-turbo) and [Silero VAD](https://github.com/snakers4/silero-vad) are MIT-licensed. Model licenses remain separate from the application license. Consult each registered upstream model card before redistributing weights.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/chrome` | Popup, background service worker, offscreen host, capture adapter and overlay transport |
| `packages/contracts` | Typed media, session, revision and presentation messages |
| `packages/core` | Platform-independent session/revision/presentation policies |
| `packages/engines-browser` | Browser model preparation, workers, ASR, VAD, translation and speaker tracking |
| `packages/media-web` | Web media acquisition, PCM worklet and selected-video adapter |
| `packages/presentation-web` | Caption display and history views |
| `tests` | Unit, fixture and real browser/model verification |

The selected-video adapter and its tests remain internal groundwork, not a shipping Safari implementation. Retain internal `interpreter` cache keys and protocol selectors where compatibility matters. Public names and GitHub links use Jamak.
