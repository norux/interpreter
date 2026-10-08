import assert from "node:assert/strict";

// Remux only the committed canvas/60 ms Opus fixtures. Encoded payloads stay
// identical; cluster clocks advance without video loops/seeks or new epochs.
export function repeatSpeechVideo(input, periods) {
  assert.ok(Number.isSafeInteger(periods) && periods > 0 && periods <= 30);
  function integer(offset, id = false) {
    const width = Math.clz32(input[offset]) - 23;
    assert.ok(width >= 1 && width <= 8);
    let value = id ? input[offset] : input[offset] & (2 ** (8 - width) - 1);
    let unknown = !id && value === 2 ** (8 - width) - 1;
    for (let i = 1; i < width; i++) { value = value * 256 + input[offset + i]; unknown &&= input[offset + i] === 255; }
    return { value, next: offset + width, unknown };
  }
  function elements(start, end) {
    const result = [];
    for (let position = start; position < end;) {
      const id = integer(position, true), size = integer(id.next);
      const stop = size.unknown ? end : size.next + size.value;
      assert.ok(stop <= end && stop > position);
      result.push({ id: id.value, start: position, body: size.next, end: stop }); position = stop;
    }
    return result;
  }
  const roots = elements(0, input.length);
  assert.deepEqual(roots.map(element => element.id), [0x1a45dfa3, 0x18538067]);
  const segment = elements(roots[1].body, roots[1].end);
  const info = segment.find(element => element.id === 0x1549a966);
  const tracks = segment.find(element => element.id === 0x1654ae6b);
  const clusters = segment.filter(element => element.id === 0x1f43b675);
  assert.ok(info && tracks && clusters.length);
  const scale = elements(info.body, info.end).find(element => element.id === 0x2ad7b1);
  assert.equal(input.readUIntBE(scale.body, scale.end - scale.body), 1000000);
  let packets = 0, first;
  for (const cluster of clusters) {
    const children = elements(cluster.body, cluster.end);
    const clock = children.find(element => element.id === 0xe7);
    const base = input.readUIntBE(clock.body, clock.end - clock.body);
    for (const block of children.filter(element => element.id === 0xa3)) {
      const track = integer(block.body);
      if (track.value !== 2) continue;
      assert.equal(input[track.next + 2] & 6, 0);
      assert.equal(input[track.next + 3], 255); assert.equal(input[track.next + 4], 3);
      const timestamp = base + input.readInt16BE(track.next);
      first ??= timestamp; assert.equal(timestamp, first + packets * 60); packets++;
    }
  }
  assert.ok(packets > 0);
  const periodMs = packets * 60;
  const extendedInfo = Buffer.from(input.subarray(info.start, info.end));
  const duration = elements(info.body, info.end).find(element => element.id === 0x4489);
  assert.equal(duration.end - duration.body, 4);
  extendedInfo.writeFloatBE(input.readFloatBE(duration.body) + (periods - 1) * periodMs, duration.body - info.start);
  const parts = [input.subarray(roots[0].start, roots[0].end),
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    extendedInfo, input.subarray(tracks.start, tracks.end)];
  for (let period = 0; period < periods; period++) for (const cluster of clusters) {
    const children = elements(cluster.body, cluster.end);
    const clock = children.find(element => element.id === 0xe7);
    const timestamp = input.readUIntBE(clock.body, clock.end - clock.body) + period * periodMs;
    const replacement = Buffer.from([0xe7, 0x84, 0, 0, 0, 0]); replacement.writeUInt32BE(timestamp, 2);
    parts.push(Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      input.subarray(cluster.body, clock.start), replacement, input.subarray(clock.end, cluster.end));
  }
  // Omit SeekHead/Cues whose byte offsets no longer describe this remux.
  return { bytes: Buffer.concat(parts), periodMs, packets: packets * periods };
}
