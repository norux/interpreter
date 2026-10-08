import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { retimeSpeechVideo } from "./fixtures/video-speech/retime.mjs";

function block(track, timestamp, payload) {
  const header = Buffer.from([0xa3, 0x80 | (payload.length + 4), 0x80 | track, 0, 0, 0x80]);
  header.writeInt16BE(timestamp, 3);
  return Buffer.concat([header, payload]);
}
function cluster(clock, blocks) {
  const body = Buffer.concat([Buffer.from([0xe7, 0x82, clock >> 8, clock & 255]), ...blocks]);
  return Buffer.concat([Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x80 | body.length]), body]);
}
function video(first, second, last = -39) {
  const audio = Buffer.from([255, 3, 12, 34, 56]);
  return Buffer.concat([Buffer.from([0x18, 0x53, 0x80, 0x67, 0xff]),
    cluster(0, [block(2, first, audio), block(1, 70, Buffer.from([56])), block(2, first + 60, audio), block(2, second, audio)]),
    cluster(300, [block(2, last, audio)])]);
}

test("speech fixture retiming changes only audio timestamps, including cluster boundaries", () => {
  const input = video(69, 187);
  const snapshot = Buffer.from(input);
  const expected = video(69, 189, -51);
  const output = retimeSpeechVideo(input);
  assert.deepEqual(output, expected);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(retimeSpeechVideo(output), output);
});

test("committed speech fixtures retain a continuous encoded Opus sample clock", () => {
  for (const language of ["ja", "en"]) {
    const input = readFileSync(`tests/fixtures/video-speech/${language}.webm`);
    assert.ok(retimeSpeechVideo(input).equals(input), `${language}: packet timestamps must match encoded durations`);
  }
});
