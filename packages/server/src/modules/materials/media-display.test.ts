import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ILLUSTRATION_DISPLAY_MAX_PX, toDisplayIllustration } from "./media-reconciliation";

describe("toDisplayIllustration — wariant wyświetlania ilustracji", () => {
  it("skaluje 1024×1024 PNG do max 768 px WebP wielokrotnie mniejszego", async () => {
    const png = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: { r: 120, g: 160, b: 220 }, noise: { type: "gaussian", mean: 128, sigma: 40 } },
    }).png().toBuffer();
    const variant = await toDisplayIllustration(Uint8Array.from(png));
    expect(variant).not.toBeNull();
    expect(variant!.mimeType).toBe("image/webp");
    const metadata = await sharp(variant!.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(Math.max(metadata.width!, metadata.height!)).toBe(ILLUSTRATION_DISPLAY_MAX_PX);
    expect(variant!.bytes.byteLength).toBeLessThan(png.byteLength / 2);
  });

  it("obraca piksele wg EXIF orientation zamiast zgubić orientację", async () => {
    const jpeg = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 90, g: 60, b: 30 } },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const variant = await toDisplayIllustration(Uint8Array.from(jpeg));
    const metadata = await sharp(variant!.bytes).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(200);
    expect(metadata.orientation).toBeUndefined();
  });

  it("nie powiększa małego obrazu i degraduje do null przy śmieciach", async () => {
    const small = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).png().toBuffer();
    const variant = await toDisplayIllustration(Uint8Array.from(small));
    const metadata = await sharp(variant!.bytes).metadata();
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(100);
    await expect(toDisplayIllustration(Uint8Array.from(Buffer.from("not-an-image")))).resolves.toBeNull();
  });
});
