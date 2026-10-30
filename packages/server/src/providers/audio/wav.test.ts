import { describe, expect, it } from "vitest";
import { normalizeWav, pcmToWav, wavDurationMs } from "./wav";

/** WAV z dowolnymi fragmentami: `fmt ` PCM, opcjonalny `LIST`, `data` z zadeklarowanym rozmiarem. */
function riff(options: { pcm: Uint8Array; dataSize?: number; riffSize?: number; list?: boolean; audioFormat?: number; bits?: number }): Uint8Array {
  const chunks: Array<[string, Uint8Array, number?]> = [];
  const fmt = new Uint8Array(16);
  const fv = new DataView(fmt.buffer);
  fv.setUint16(0, options.audioFormat ?? 1, true);
  fv.setUint16(2, 1, true);
  fv.setUint32(4, 24000, true);
  fv.setUint32(8, 48000, true);
  fv.setUint16(12, 2, true);
  fv.setUint16(14, options.bits ?? 16, true);
  chunks.push(["fmt ", fmt]);
  if (options.list) chunks.push(["LIST", new Uint8Array([1, 2, 3, 4, 5, 6])]);
  chunks.push(["data", options.pcm, options.dataSize]);
  const body = chunks.reduce((n, [, b]) => n + 8 + b.length, 4);
  const out = new Uint8Array(8 + body);
  const v = new DataView(out.buffer);
  const ascii = (o: number, t: string) => { for (let i = 0; i < 4; i += 1) out[o + i] = t.charCodeAt(i); };
  ascii(0, "RIFF"); v.setUint32(4, options.riffSize ?? body, true); ascii(8, "WAVE");
  let o = 12;
  for (const [id, b, size] of chunks) { ascii(o, id); v.setUint32(o + 4, size ?? b.length, true); out.set(b, o + 8); o += 8 + b.length; }
  return out;
}

describe("normalizeWav", () => {
  const pcm = new Uint8Array(480).map((_, i) => i % 251);

  it("strumieniowy WAV z rozmiarami 0xFFFFFFFF dostaje nagłówek z prawdziwymi długościami", () => {
    const wav = normalizeWav(riff({ pcm, dataSize: 0xffffffff, riffSize: 0xffffffff }));
    expect(wav).not.toBeNull();
    expect([...wav!.subarray(44)]).toEqual([...pcm]);
    expect(wavDurationMs(wav!)).toBe(10);
  });

  it("pomija dodatkowe fragmenty (LIST) przed danymi", () => {
    const wav = normalizeWav(riff({ pcm, list: true }));
    expect(wav && [...wav.subarray(44)]).toEqual([...pcm]);
  });

  it("odrzuca ucięty plik, puste dane i format inny niż PCM 16-bit", () => {
    expect(normalizeWav(riff({ pcm, dataSize: pcm.length + 100 }))).toBeNull();
    // strumień urwany w połowie próbki: rozmiar 0xFFFFFFFF i nieparzysta liczba bajtów
    expect(normalizeWav(riff({ pcm: new Uint8Array(481), dataSize: 0xffffffff, riffSize: 0xffffffff }))).toBeNull();
    expect(normalizeWav(riff({ pcm: new Uint8Array(0) }))).toBeNull();
    expect(normalizeWav(riff({ pcm, audioFormat: 3 }))).toBeNull();
    expect(normalizeWav(riff({ pcm, bits: 8 }))).toBeNull();
    expect(normalizeWav(riff({ pcm }).subarray(0, 30))).toBeNull();
    expect(normalizeWav(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

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
