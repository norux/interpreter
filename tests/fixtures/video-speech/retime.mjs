// Only the canvas/Opus WebM format emitted by this fixture generator is supported.
export function retimeSpeechVideo(input) {
  const bytes = Buffer.from(input);
  let firstTimestamp;
  let packets = 0;
  function integer(offset, id = false) {
    const first = bytes[offset];
    const width = Math.clz32(first) - 23;
    if (width > 8) throw new Error("Invalid fixture WebM integer");
    let value = id ? first : first & (2 ** (8 - width) - 1);
    let unknown = !id && value === 2 ** (8 - width) - 1;
    for (let i = 1; i < width; i++) {
      value = value * 256 + bytes[offset + i];
      unknown &&= bytes[offset + i] === 255;
    }
    return { value, next: offset + width, unknown };
  }
  function walk(start, end, clock = 0) {
    for (let position = start; position < end;) {
      const id = integer(position, true);
      const size = integer(id.next);
      const stop = size.unknown ? end : size.next + size.value;
      if (stop > end) throw new Error("Truncated fixture WebM element");
      if ([0x18538067, 0x1549a966, 0x1f43b675, 0xa0].includes(id.value)) walk(size.next, stop, clock);
      else if (id.value === 0xe7) clock = bytes.readUIntBE(size.next, stop - size.next);
      else if (id.value === 0x2ad7b1 && bytes.readUIntBE(size.next, stop - size.next) !== 1000000) {
        throw new Error("Fixture timestamps must use millisecond units");
      } else if (id.value === 0xa3 || id.value === 0xa1) {
        const track = integer(size.next);
        if (track.value === 2) {
          // RFC 6716: ff03 is stereo CELT, three 20 ms frames (60 ms total).
          if ((bytes[track.next + 2] & 6) || bytes[track.next + 3] !== 255 || bytes[track.next + 4] !== 3) {
            throw new Error("Fixture requires unlaced 60 ms Opus packets");
          }
          firstTimestamp ??= clock + bytes.readInt16BE(track.next);
          const relative = firstTimestamp + packets * 60 - clock;
          bytes.writeInt16BE(relative, track.next);
          packets++;
        }
      }
      position = stop;
    }
  }
  walk(0, bytes.length);
  if (!packets) throw new Error("Fixture has no Opus audio packets");
  return bytes;
}
