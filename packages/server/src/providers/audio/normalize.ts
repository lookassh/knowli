import { AppError } from "../../errors";
import type { AudioInput } from "../../ports/ai";

/** Twarde limity nagrania po stronie serwera (arch §11). */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 15;
/** Zapas na pola formularza i boundary multipartu przy limicie strumienia. */
export const MULTIPART_OVERHEAD_BYTES = 96 * 1024;

/** Nagranie po normalizacji: te same bajty (bez konwersji) + zweryfikowany czas. */
export interface NormalizedAudio {
  bytes: Uint8Array;
  mimeType: string;
  durationSeconds: number;
}

function reject(message: string): never {
  throw new AppError("validation", { message });
}

const WEBM_MIME = /^audio\/webm\b/;
const WAV_MIME = /^audio\/(x-)?wa(v|ve)\b/;

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/** Czas trwania WAV z nagłówka PCM: dataSize / byteRate. */
function wavDuration(bytes: Uint8Array): number | null {
  if (bytes.length < 44 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "fmt " && chunkSize >= 16) {
      const byteRate = view.getUint32(offset + 16, true);
      if (byteRate === 0) return null;
      // pierwszy chunk data za fmt — czas z rzeczywistej liczby bajtów próbek
      const remaining = bytes.length - (offset + 8 + chunkSize);
      return remaining / byteRate;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

interface EbmlElement {
  id: number;
  contentStart: number;
  contentEnd: number;
}

/** Nagłówek elementu EBML: id i zakres zawartości wg długości vint. */
function readElement(bytes: Uint8Array, offset: number): EbmlElement | null {
  const first = bytes[offset];
  if (first === undefined) return null;
  let marker = 0x80;
  let idLength = 1;
  while (idLength <= 4 && (first & marker) === 0) {
    marker >>= 1;
    idLength += 1;
  }
  if (idLength > 4) return null;
  let id = first;
  for (let i = 1; i < idLength; i++) id = id * 256 + (bytes[offset + i] ?? -1);
  const sizeFirst = bytes[offset + idLength];
  if (sizeFirst === undefined) return null;
  let sizeMarker = 0x80;
  let sizeLength = 1;
  while (sizeLength <= 8 && (sizeFirst & sizeMarker) === 0) {
    sizeMarker >>= 1;
    sizeLength += 1;
  }
  if (sizeLength > 8) return null;
  let size = sizeFirst & (0xff >> sizeLength);
  for (let i = 1; i < sizeLength; i++) {
    const byte = bytes[offset + idLength + i];
    if (byte === undefined) return null;
    size = size * 256 + byte;
  }
  // wartości z samymi jedynkami to „nieznany rozmiar” — traktujemy jako koniec
  if (size === 2 ** (7 * sizeLength) - 1 && sizeLength > 1) return null;
  const contentStart = offset + idLength + sizeLength;
  const contentEnd = contentStart + size;
  if (contentEnd > bytes.length) return null;
  return { id, contentStart, contentEnd };
}

/** Wartość unsigned vint z zawartości elementu — z odjęciem bitów znacznika. */
function readVintValue(bytes: Uint8Array, start: number, end: number): number | null {
  const first = bytes[start];
  if (first === undefined || end <= start) return null;
  let marker = 0x80;
  let length = 1;
  while (length <= 8 && (first & marker) === 0) {
    marker >>= 1;
    length += 1;
  }
  if (length > 8 || start + length > end) return null;
  let value = first & (0xff >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + (bytes[start + i] ?? -1);
  }
  if (value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  return value;
}

/**
 * Czas trwania webm z Segment→Info: TimecodeScale (ns/jednostkę, domyślnie
 * 1 000 000) i Duration (float). Czytamy tylko metadane przed pierwszym
 * Clusterem — bez dekodowania zawartości.
 */
function webmDuration(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
    return null;
  }
  let offset = 0;
  let timecodeScale = 1_000_000;
  let duration: number | null = null;
  while (offset < bytes.length) {
    const element = readElement(bytes, offset);
    if (!element) return duration === null ? null : (duration * timecodeScale) / 1e9;
    if (element.id === 0x18538067) {
      // Segment — schodzimy do dzieci (Info z Durationem poprzedza Clustery)
      let child = element.contentStart;
      while (child < element.contentEnd) {
        const inner = readElement(bytes, child);
        if (!inner) break;
        if (inner.id === 0x1549a966) {
          let info = inner.contentStart;
          while (info < inner.contentEnd) {
            const field = readElement(bytes, info);
            if (!field) break;
            if (field.id === 0x2ad7b1) {
              const scale = readVintValue(bytes, field.contentStart, field.contentEnd);
              if (scale !== null && scale > 0) timecodeScale = scale;
            } else if (field.id === 0x4489) {
              const width = field.contentEnd - field.contentStart;
              const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
              if (width === 4) duration = view.getFloat32(field.contentStart);
              else if (width === 8) duration = view.getFloat64(field.contentStart);
            }
            info = field.contentEnd;
          }
        } else if (inner.id === 0x1f43b675) {
          break; // pierwszy Cluster — metadane się skończyły
        }
        child = inner.contentEnd;
      }
      return duration === null ? null : (duration * timecodeScale) / 1e9;
    }
    offset = element.contentEnd;
  }
  return null;
}

/**
 * Waliduje nagranie w pamięci (arch §11): rozmiar, kontener i czas trwania
 * odczytany z rzeczywistych metadanych, bez zapisu na dysk. Konwersja kodeka
 * jest decyzją fazy 0 — dopóki nie zostanie potwierdzona, bajty przechodzą
 * bez translacji, a wymagamy formatu z jawnym czasem trwania.
 */
export function normalizeAudioInput(audio: AudioInput, maxSeconds: number = MAX_AUDIO_SECONDS): NormalizedAudio {
  if (audio.bytes.byteLength === 0) {
    reject("empty audio recording");
  }
  if (audio.bytes.byteLength > MAX_AUDIO_BYTES) {
    reject("audio recording exceeds 2 MiB");
  }
  const mime = audio.mimeType.split(";")[0]!.trim();
  if (WEBM_MIME.test(audio.mimeType)) {
    const duration = webmDuration(audio.bytes);
    if (duration === null || duration <= 0) {
      reject("audio webm without duration metadata");
    }
    if (duration > maxSeconds + 0.5) {
      reject(`audio recording exceeds ${maxSeconds} seconds`);
    }
    return { bytes: audio.bytes, mimeType: audio.mimeType, durationSeconds: duration };
  }
  if (WAV_MIME.test(audio.mimeType)) {
    const duration = wavDuration(audio.bytes);
    if (duration === null || duration <= 0) {
      reject("audio wav without duration metadata");
    }
    if (duration > maxSeconds + 0.5) {
      reject(`audio recording exceeds ${maxSeconds} seconds`);
    }
    return { bytes: audio.bytes, mimeType: mime, durationSeconds: duration };
  }
  reject("unsupported audio format");
}
