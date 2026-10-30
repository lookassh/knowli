const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;

export interface PcmFormat {
  sampleRate: number;
  channels: number;
}

/**
 * 16-bitowe PCM little-endian (np. Gemini TTS przez OpenRouter) → plik WAV
 * odtwarzany natywnie przez przeglądarki. Niepełna ramka próbek to uszkodzona
 * odpowiedź providera, nie plik do zapisania.
 */
export function pcmToWav(pcm: Uint8Array, format: PcmFormat): Uint8Array {
  const blockAlign = format.channels * (BITS_PER_SAMPLE / 8);
  if (pcm.length % blockAlign !== 0) throw new Error("provider_truncated_pcm");
  const wav = new Uint8Array(HEADER_BYTES + pcm.length);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) wav[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, HEADER_BYTES);
  return wav;
}

/** Długość WAV PCM z nagłówka zapisanego przez {@link pcmToWav}; null dla innych bajtów. */
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data") return null;
  const byteRate = view.getUint32(28, true);
  const dataBytes = view.getUint32(40, true);
  if (byteRate === 0 || dataBytes === 0 || HEADER_BYTES + dataBytes > bytes.length) return null;
  return Math.round((dataBytes * 1000) / byteRate);
}
