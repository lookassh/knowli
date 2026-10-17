const MPEG1_BITRATES: Record<number, number[]> = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
};
const MPEG2_BITRATES: Record<number, number[]> = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

/** Reads trusted duration from MPEG audio frame headers; null means unsupported/corrupt. */
export function mp3DurationMs(bytes: Uint8Array): number | null {
  let offset = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const tagSize = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    offset = 10 + tagSize + ((bytes[5]! & 0x10) ? 10 : 0);
  }
  let duration = 0;
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    const header = ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
    const version = (header >>> 19) & 0b11;
    const layer = (header >>> 17) & 0b11;
    const bitrateIndex = (header >>> 12) & 0b1111;
    const sampleIndex = (header >>> 10) & 0b11;
    if ((header >>> 21) !== 0x7ff || version === 1 || layer === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) {
      offset += 1;
      continue;
    }
    const layerNumber = 4 - layer;
    const bitrate = (version === 3 ? MPEG1_BITRATES : MPEG2_BITRATES)[layerNumber]?.[bitrateIndex];
    const baseRate = [44100, 48000, 32000][sampleIndex]!;
    const sampleRate = version === 3 ? baseRate : version === 2 ? baseRate / 2 : baseRate / 4;
    if (!bitrate || sampleRate <= 0) { offset += 1; continue; }
    const samples = layerNumber === 1 ? 384 : layerNumber === 3 && version !== 3 ? 576 : 1152;
    const padding = (header >>> 9) & 1;
    const frameBytes = layerNumber === 1
      ? Math.floor((12 * bitrate * 1000) / sampleRate + padding) * 4
      : Math.floor(((layerNumber === 3 && version !== 3 ? 72 : 144) * bitrate * 1000) / sampleRate + padding);
    if (frameBytes < 4 || offset + frameBytes > bytes.length) break;
    duration += (samples * 1000) / sampleRate;
    frames += 1;
    offset += frameBytes;
  }
  return frames > 0 ? Math.round(duration) : null;
}
