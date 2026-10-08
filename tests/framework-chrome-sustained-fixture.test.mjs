import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { repeatSpeechVideo } from "./fixtures/video-speech/repeat.mjs";
import { retimeSpeechVideo } from "./fixtures/video-speech/retime.mjs";

test("ten-minute remux retains every encoded packet on a continuous Opus clock", () => {
  for (const language of ["ja", "en"]) {
    const input = readFileSync(`tests/fixtures/video-speech/${language}.webm`);
    const snapshot = Buffer.from(input);
    const { bytes, periodMs, packets } = repeatSpeechVideo(input, 26);
    assert.ok(periodMs * 26 >= 600000);
    assert.equal(packets * 60, periodMs * 26);
    assert.deepEqual(retimeSpeechVideo(bytes), bytes, "Audio timestamps must remain consecutive across all repeated clusters");
    assert.deepEqual(input, snapshot);
    assert.throws(() => repeatSpeechVideo(input, 0));
    const gap = Buffer.from(input);
    // Malformed EBML cannot silently become an accepted long fixture.
    gap[0] = 0;
    assert.throws(() => repeatSpeechVideo(gap, 26));
  }
});
