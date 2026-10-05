import math
import struct
from dataclasses import dataclass

HEADER = struct.Struct("<4sIIdIHH")
SAMPLE_RATE = 24_000
FRAME_SAMPLES = 480


@dataclass(frozen=True)
class AudioFrame:
    sequence: int
    timestamp_ms: float
    sample_rate: int
    pcm: bytes


def decode_frame(packet: bytes, expected_sequence: int) -> AudioFrame:
    if len(packet) != HEADER.size + FRAME_SAMPLES * 2:
        raise ValueError(
            "PCM frame must contain a 28-byte header and 480 PCM16 samples."
        )
    magic, rate, sequence, timestamp, count, version, channels = HEADER.unpack_from(
        packet
    )
    if magic != b"PCM1" or version != 1 or channels != 1:
        raise ValueError("Expected version 1 mono raw PCM16, not WAV/WebM.")
    if rate != SAMPLE_RATE or count != FRAME_SAMPLES:
        raise ValueError("Expected 24 kHz PCM16 in 20 ms frames.")
    if sequence != expected_sequence:
        raise ValueError("PCM sequence is missing, repeated, or out of order.")
    if not math.isfinite(timestamp) or abs(timestamp - sequence * 20) > 1e-6:
        raise ValueError("PCM timestamp does not match its sample position.")
    return AudioFrame(sequence, timestamp, rate, packet[HEADER.size :])
