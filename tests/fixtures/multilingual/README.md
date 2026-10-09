# Synthetic multilingual meeting

`meeting.wav` contains six sequential turns: English → Japanese → Korean → English → Japanese → Korean, with 350 ms silence between turns. Three installed macOS voices (Samantha, Kyoko, Yuna) read `script.json`; it contains no user recording. `manifest.json` records the reference text, ranges and WAV SHA-256.

Regenerate on macOS with the voices installed:

```sh
python3 tests/fixtures/multilingual/generate.py
```

Run `npm run test:auto-language:live` for real production-extension language switching, native Korean translation and overlay checks. Serve this folder with a local HTTP server and open `/meeting.wav` for manual testing. This fixture does not establish general recognition accuracy, microphone capture, simultaneous speech handling or a latency guarantee.
