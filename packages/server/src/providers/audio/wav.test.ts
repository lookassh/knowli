import { describe, expect, it } from "vitest";
import { pcmToWav, wavDurationMs } from "./wav";

describe("pcmToWav", () => {
  it("opakowuje 16-bitowe PCM nagłówkiem RIFF/WAVE z częstotliwością i liczbą kanałów", () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const wav = pcmToWav(pcm, { sampleRate: 24000, channels: 1 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const text = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
    expect(wav.length).toBe(44 + pcm.length);
    expect(text(0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + pcm.length);
    expect(text(8)).toBe("WAVE");
    expect(text(12)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(28, true)).toBe(48000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(pcm.length);
    expect([...wav.subarray(44)]).toEqual([...pcm]);
  });

  it("odrzuca niepełną próbkę zamiast zapisać uszkodzony plik", () => {
    expect(() => pcmToWav(new Uint8Array([1, 2, 3]), { sampleRate: 24000, channels: 1 })).toThrow(/pcm/);
  });
});

describe("wavDurationMs", () => {
  it("liczy długość z rozmiaru danych i byte rate", () => {
    const wav = pcmToWav(new Uint8Array(48000 * 1.5), { sampleRate: 24000, channels: 1 });
    expect(wavDurationMs(wav)).toBe(1500);
  });

  it("zwraca null dla bajtów, które nie są WAV PCM", () => {
    expect(wavDurationMs(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(wavDurationMs(new Uint8Array(44))).toBeNull();
  });
});
