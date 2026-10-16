import { describe, expect, it } from "vitest";
import { mp3DurationMs } from "./mp3-duration";

describe("mp3DurationMs", () => {
  it("sums frame duration and skips an ID3v2 tag", () => {
    // MPEG-1 Layer III, 128 kbps, 44.1 kHz, unpadded frame: 417 bytes, 1152 samples.
    const frame = new Uint8Array(417);
    frame.set([0xff, 0xfb, 0x90, 0x64]);
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 3, 1, 2, 3]);
    const bytes = new Uint8Array(id3.length + frame.length * 2);
    bytes.set(id3);
    bytes.set(frame, id3.length);
    bytes.set(frame, id3.length + frame.length);
    expect(mp3DurationMs(bytes)).toBeCloseTo(52, 0);
  });

  it("returns null when there are no complete MPEG audio frames", () => {
    expect(mp3DurationMs(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
