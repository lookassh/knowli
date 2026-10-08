// Deterministyczne ikony PWA „Umiem!” bez zależności obrazowych: minimalny
// enkoder PNG (zlib + CRC32) rysuje niebieską płytkę z białym „U”.
// Uruchomienie: node scripts/generate-icons.mjs  (wynik w apps/web/public/icons)

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "apps/web/public/icons");

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c;
});

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePng(size, pixel) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filtr: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size, x, y);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // głębia bitowa
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BLUE = [59, 91, 219];
const WHITE = [255, 255, 255];

function inRoundedRect(u, v, radius) {
  const x = Math.abs(u - 0.5) * 2; // 0..1
  const y = Math.abs(v - 0.5) * 2;
  const dx = Math.max(x - (1 - radius * 2), 0);
  const dy = Math.max(y - (1 - radius * 2), 0);
  return dx * dx + dy * dy <= radius * radius * 4 || (x <= 1 - radius * 2 && y <= 1);
}

/** Litera „U” z prostokątów w współrzędnych jednostkowych. */
function inLetterU(u, v) {
  const bar = 0.085;
  const left = u >= 0.32 && u <= 0.32 + bar;
  const right = u >= 0.68 - bar && u <= 0.68;
  const stem = v >= 0.28 && v <= 0.6;
  const bottom = u >= 0.32 && u <= 0.68 && v >= 0.6 - bar && v <= 0.6;
  return (left || right) && stem ? true : bottom;
}

function iconPixel(fullBleed) {
  return (u, v) => {
    const onTile = fullBleed || inRoundedRect(u, v, 0.16);
    if (!onTile) {
      return [0, 0, 0, 0];
    }
    // maskable: treść w bezpiecznej strefie 80%, więc U skalujemy do 0.8
    const su = fullBleed ? (u - 0.5) / 0.8 + 0.5 : u;
    const sv = fullBleed ? (v - 0.5) / 0.8 + 0.5 : v;
    return inLetterU(su, sv) ? WHITE : BLUE;
  };
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon-192.png"), encodePng(192, iconPixel(false)));
writeFileSync(join(outDir, "icon-512.png"), encodePng(512, iconPixel(false)));
writeFileSync(join(outDir, "maskable-512.png"), encodePng(512, iconPixel(true)));
console.log(`Ikony zapisane w ${outDir}`);
