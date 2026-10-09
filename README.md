<p align="center"><img src="apps/chrome/public/icons/jamak.svg" width="112" alt="Jamak subtitle bubble"></p>
<h1 align="center">Jamak</h1>
<p align="center">Live subtitles, right in your browser.</p>

**Jamak** (자막, /dʒɑːmɑːk/) means “subtitles” in Korean. It is a Chrome extension that turns tab audio into live Korean captions using on-device speech recognition and translation.

[Privacy policy / 개인정보처리방침](PRIVACY.md)

## Features

- Optionally detects English, Japanese and Korean per speech turn. English/Japanese → Korean subtitles; Korean speech keeps its original text.
- Select English, Japanese or Korean manually to disable automatic detection. Manual Japanese is the default.
- Captures the selected tab's audio, including videos, iframes and Web Audio. Playback remains audible.
- Updates captions as speech arrives and corrects them as recognition completes.
- Distinguishes speakers with background colors, without speaker labels.
- Shows ready captions immediately below earlier captions in a bounded toast-style stack. Visible captions read concurrently and leave oldest first; each completed part remains for 4–6 seconds, then fades out.
- Opens a separate original/translation history window.
- Runs speech recognition, translation and speaker analysis locally. No API key or companion app required.

## Install and use

Requires desktop Chrome **138+**, available on-device translation language packs, and either Chrome's local speech recognition support or a WebGPU-capable device for the Whisper fallback. API and model availability depend on your Chrome version, device and language.

```sh
git clone https://github.com/norux/jamak.git
cd jamak
npm ci
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
2. Select `apps/chrome/dist`.
3. Open a page with audio, click Jamak, and choose English, Japanese or Korean manually (Japanese by default), or enable the **자동 감지** checkbox for multilingual speech. Selecting a source language turns automatic detection off. Manual Korean uses Whisper and displays the original without translation.
4. Prepare the models once; the popup shows a progress bar for the current download/preparation stage, including when reopened. **모델 정보** opens a compact table of the selected recognition, translation, voice-activity and speaker models. Then click **번역 시작**. Click **중지** to stop.

Automatic mode requires WebGPU and prepares Whisper plus both English/Japanese → Korean translation pairs. The first preparation downloads language packs and model files; internet access is required for downloads. Japanese uses Whisper on WebGPU devices (about 1.6 GB for the speech model); English prefers Chrome local speech. Japanese can use Chrome local speech when WebGPU is absent. Prepared models run locally. Restricted Chrome pages cannot show the overlay. Microphone and system-wide audio capture are not supported.

## Platforms

| Platform | Status |
| --- | --- |
| Chrome extension · desktop | Supported |
| Safari extension · iPhone | Planned |
| macOS desktop app | Planned |

## Development

Node.js **22.12+** is required.

```sh
npm run dev       # Watch and rebuild the extension; reload it in Chrome
npm run verify    # Lint, types, build, unit tests and caption display checks
npm run test:conversation # Serve English (~58 s) and Japanese (~76 s) conversations
```

The conversation player opens at `http://127.0.0.1:8790`; select Japanese with the page link or `?language=ja`. Both fixtures contain eight distinct turns and two synthetic voices. Real model and tab-capture checks are documented in [Testing](docs/testing.md).

See [Architecture](docs/architecture/media-framework.md), [Coding conventions](docs/coding-conventions.md), and [AGENTS.md](AGENTS.md) before contributing. Feature changes must keep code and these documents consistent.

## Models and limitations

Chrome SODA and TranslateKit provide local recognition and translation when available. Automatic mode and the fallback use Whisper large-v3-turbo with Silero VAD. Automatic mode reuses one acoustic encoder pass for language detection and transcription, keeps the translation pairs ready, and uses recent language only to break uncertain ties. Speaker history does not determine language. WeSpeaker provides session-local speaker embeddings. Japanese Whisper retains unfinished phrases across recognition windows and handles conversational endings and question marks before translation. Recognition and translation can still misinterpret individual words or relationships. Short responses may have no speaker assignment; overlapping speech, noise and similar voices can reduce accuracy.

Automatic language switching currently follows speech pauses; simultaneous voices or language changes without a pause can share one recognition window. It is not instantaneous: inference and caption confirmation add delay, and short ambiguous speech can be misidentified.

Model weights have their own licenses. See [model attribution and speaker verification](docs/verification/captions/conversation-speakers.md) and the [architecture model inventory](docs/architecture/media-framework.md#models).

## License

[MIT](LICENSE). Model weights and dependencies retain their own licenses.
