import assert from "node:assert/strict";
import { test } from "node:test";
import { createPCMEncoder, PCM_HEADER_BYTES } from "../extension/capture/pcm";

test("PCM16 stereo downmix, clipping, little-endian header, and 20 ms frame positions", () => {
  const packets: ArrayBuffer[] = [];
  const encode = createPCMEncoder(48000, (packet) => packets.push(packet));
  encode([new Float32Array(960).fill(0.75), new Float32Array(960).fill(0.25)]);
  encode([new Float32Array(960).fill(-2), new Float32Array(960).fill(-2)]);
  assert.equal(packets.length, 2);
  for (const [index, packet] of packets.entries()) {
    const view = new DataView(packet);
    assert.equal(packet.byteLength, 988);
    assert.equal(Buffer.from(packet, 0, 4).toString(), "PCM1");
    assert.equal(view.getUint32(4, true), 24000);
    assert.equal(view.getUint32(8, true), index);
    assert.equal(view.getFloat64(12, true), index * 20);
    assert.equal(view.getUint32(20, true), 480);
    assert.equal(view.getUint16(24, true), 1);
    assert.equal(view.getUint16(26, true), 1);
    for (let i = PCM_HEADER_BYTES; i < packet.byteLength; i += 2) {
      assert.equal(view.getInt16(i, true), index ? -32768 : 16384);
    }
  }
});

test("44.1 kHz fractional resampling is continuous across arbitrary worklet boundaries", () => {
  const input = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 44100));
  const whole: ArrayBuffer[] = [];
  const chunked: ArrayBuffer[] = [];
  createPCMEncoder(44100, (packet) => whole.push(packet))([input]);
  const encode = createPCMEncoder(44100, (packet) => chunked.push(packet));
  encode([]);
  for (let i = 0; i < input.length; i += 128) encode([input.slice(i, i + 128)]);
  assert.equal(chunked.length, 50);
  assert.deepEqual(chunked.map((packet) => Buffer.from(packet)), whole.map((packet) => Buffer.from(packet)));
  const samples = chunked.flatMap((packet) => [...new Int16Array(packet, PCM_HEADER_BYTES)]);
  const crossings = samples.filter((sample, i) => i > 0 && sample >= 0 && samples[i - 1] < 0).length;
  assert.ok(crossings >= 439 && crossings <= 440);
  const mse = samples.reduce((sum, sample, i) => sum + (sample / 32767 - Math.sin(2 * Math.PI * 440 * i / 24000)) ** 2, 0) / samples.length;
  assert.ok(mse < 0.003, `Tone distortion: ${mse}`);
});

test("silence is zero PCM and partial frames are not emitted", () => {
  const packets: ArrayBuffer[] = [];
  const encode = createPCMEncoder(48000, (packet) => packets.push(packet));
  encode([new Float32Array(959)]);
  assert.equal(packets.length, 0);
  encode([new Float32Array(1)]);
  assert.equal(packets.length, 1);
  assert.ok(new Int16Array(packets[0], PCM_HEADER_BYTES).every((sample) => sample === 0));
  assert.throws(() => createPCMEncoder(0, () => {}), /sample rate/);
});
