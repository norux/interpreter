<p align="center"><img src="apps/chrome/public/icons/jamak.svg" width="112" alt="Jamak subtitle bubble"></p>
<h1 align="center">Jamak</h1>
<p align="center">Live subtitles, right in your browser.</p>

**Jamak** (자막, /dʒɑːmɑːk/) means “subtitles” in Korean. It is a Chrome extension that turns tab audio into live Korean captions using on-device speech recognition and translation.

## Features

- English and Japanese audio → Korean subtitles.
- Captures the selected tab's audio, including videos, iframes and Web Audio. Playback remains audible.
- Updates captions as speech arrives and corrects them as recognition completes.
- Distinguishes speakers with background colors, without speaker labels.
- Keeps completed captions readable for 4–6 seconds per displayed part, then fades out.
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
3. Open a page with audio, click Jamak, and select English or Japanese.
4. Prepare the models once, then click **번역 시작**. Click **중지** to stop.

The first preparation downloads language packs and model files; internet access is required for downloads. Prepared models run locally. Restricted Chrome pages cannot show the overlay. Microphone and system-wide audio capture are not supported.

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
npm run test:conversation # Serve the ~58-second two-speaker audio fixture
```

The conversation player opens at `http://127.0.0.1:8790`. Real model and tab-capture checks are documented in [Testing](docs/testing.md).

See [Architecture](docs/architecture/media-framework.md), [Coding conventions](docs/coding-conventions.md), and [AGENTS.md](AGENTS.md) before contributing. Feature changes must keep code and these documents consistent.

## Models and limitations

Chrome SODA and TranslateKit provide local recognition and translation when available. The fallback uses Whisper large-v3-turbo with Silero VAD. WeSpeaker provides session-local speaker embeddings. Short responses may have no speaker assignment; overlapping speech, noise and similar voices can reduce accuracy.

Model weights have their own licenses. See [model attribution and speaker verification](docs/verification/captions/conversation-speakers.md) and the [architecture model inventory](docs/architecture/media-framework.md#models).
