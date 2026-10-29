import { describe, expect, it } from "vitest";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, normalizeAudioInput } from "./normalize";
import type { AudioInput } from "../../ports/ai";

function wav(seconds: number): AudioInput {
  const sampleRate = 8000;
  const dataBytes = Math.round(seconds * sampleRate * 2); // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bits
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return { bytes: new Uint8Array(buffer), mimeType: "audio/wav", locale: "en-GB" };
}

/** Minimalny webm: EBML header + Segment{Info{TimecodeScale, Duration}}. */
function webm(durationSeconds: number, timecodeScale = 1_000_000): AudioInput {
  const vint = (value: number): number[] => {
    // najkrótsze kodowanie unsigned vint bez rezerwacji wartości „unknown”
    for (let length = 1; length <= 5; length++) {
      const maxValue = 2 ** (7 * length) - 2;
      if (value <= maxValue) {
        const marker = 0x80 >> (length - 1);
        const bytes = [marker | (value >>> (8 * (length - 1)))];
        for (let i = length - 2; i >= 0; i--) bytes.push((value >>> (8 * i)) & 0xff);
        return bytes;
      }
    }
    throw new Error("vint too large");
  };
  const element = (id: number[], payload: number[]): number[] => [...id, ...vint(payload.length), ...payload];
  const uintPayload = (value: number): number[] => vint(value);

  const timecodeScaleEl = element([0x2a, 0xd7, 0xb1], uintPayload(timecodeScale));
  // Duration jest wyrażona w jednostkach TimecodeScale (ns/jednostkę)
  const floatSeconds = new DataView(new ArrayBuffer(4));
  floatSeconds.setFloat32(0, (durationSeconds * 1e9) / timecodeScale);
  const durationEl = element([0x44, 0x89], [...new Uint8Array(floatSeconds.buffer)]);
  const info = element([0x15, 0x49, 0xa9, 0x66], [...timecodeScaleEl, ...durationEl]);
  const ebmlHeader = element([0x1a, 0x45, 0xdf, 0xa3], []);
  const segment = element([0x18, 0x53, 0x80, 0x67], info);
  return {
    bytes: new Uint8Array([...ebmlHeader, ...segment]),
    mimeType: "audio/webm;codecs=opus",
    locale: "en-GB",
  };
}

function audio(overrides: Partial<AudioInput> & { bytes: Uint8Array }): AudioInput {
  return { mimeType: "audio/webm", locale: "en-GB", ...overrides };
}

describe("normalizeAudioInput — limity i format bez zapisu na dysk (arch §11)", () => {
  it("przyjmuje krótkie WAV i wylicza czas trwania z nagłówka", () => {
    const normalized = normalizeAudioInput(wav(2));
    expect(normalized.durationSeconds).toBeCloseTo(2, 1);
    expect(normalized.mimeType).toBe("audio/wav");
  });

  it("przyjmuje webm i czyta czas trwania z kontenera EBML", () => {
    const normalized = normalizeAudioInput(webm(12));
    expect(normalized.durationSeconds).toBeCloseTo(12, 2);
  });

  it("honoruje TimecodeScale przy wyliczaniu czasu webm", () => {
    // te same 6 sekund zakodowane różnymi skalami jednostek czasu
    expect(normalizeAudioInput(webm(6, 1_000_000)).durationSeconds).toBeCloseTo(6, 2);
    expect(normalizeAudioInput(webm(6, 500_000)).durationSeconds).toBeCloseTo(6, 2);
  });

  it("odrzuca nagranie dłuższe niż limit 15 sekund", () => {
    expect(() => normalizeAudioInput(wav(16))).toThrowError(/audio/i);
    expect(() => normalizeAudioInput(webm(15.6))).toThrowError(/audio/i);
  });

  it("odrzuca payload powyżej 2 MiB zanim trafi do providera", () => {
    const big = new Uint8Array(MAX_AUDIO_BYTES + 1);
    expect(() => normalizeAudioInput(audio({ bytes: big }))).toThrowError(/audio/i);
  });

  it("odrzuca puste i pozbawione czasu trwania nagrania", () => {
    expect(() => normalizeAudioInput(audio({ bytes: new Uint8Array(0) }))).toThrowError(/audio/i);
    // webm bez Duration w Info — czas nieznany, nie zgadujemy
    const unknown = webm(5);
    const stripped = unknown.bytes.slice(0, unknown.bytes.length - 6);
    expect(() => normalizeAudioInput(audio({ bytes: stripped }))).toThrowError(/audio/i);
  });

  it("odrzuca niezgodność deklarowanego MIME z kontenerem", () => {
    expect(() => normalizeAudioInput(audio({ bytes: wav(1).bytes }))).toThrowError(/audio/i);
  });

  it("nagranie 15 sekund mieści się w limicie", () => {
    expect(() => normalizeAudioInput(webm(MAX_AUDIO_SECONDS))).not.toThrow();
  });

  it("limit czasu podaje wywołujący (dyktowanie lekcji: 45 s w limicie bajtów)", () => {
    const answer = wav(45);
    expect(answer.bytes.byteLength).toBeLessThan(MAX_AUDIO_BYTES);
    expect(normalizeAudioInput(answer, 45).durationSeconds).toBeCloseTo(45, 1);
    expect(() => normalizeAudioInput(wav(46), 45)).toThrowError(/45 seconds/);
    expect(() => normalizeAudioInput(answer)).toThrowError(/15 seconds/);
  });
});
