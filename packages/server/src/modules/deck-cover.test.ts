import { describe, expect, it, vi } from "vitest";
import { setDeckCover, generateDeckCover } from "./deck-cover";
import type { Services } from "../config";
import sharp from "sharp";

function services(store: { putImmutable: ReturnType<typeof vi.fn> }): Services {
  return { db: {} as Services["db"], clock: { now: () => new Date() }, subjects: {} as Services["subjects"], mediaStore: store as never };
}

describe("deck cover upload validation", () => {
  it("rejects malformed, unsupported and oversized input before storing or replacing anything", async () => {
    const store = { putImmutable: vi.fn() };
    const deps = services(store);
    const truncatedPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const oversizedPng = await sharp({ create: { width: 4500, height: 4500, channels: 4, background: "white" } }).png().toBuffer();
    await expect(setDeckCover(deps, "10000000-0000-4000-8000-000000000001", { bytes: truncatedPng, declaredMimeType: "image/png" })).rejects.toMatchObject({ code: "validation" });
    await expect(setDeckCover(deps, "10000000-0000-4000-8000-000000000001", { bytes: oversizedPng, declaredMimeType: "image/png" })).rejects.toMatchObject({ code: "validation" });
    await expect(setDeckCover(deps, "10000000-0000-4000-8000-000000000001", { bytes: new Uint8Array(5 * 1024 * 1024 + 1), declaredMimeType: "image/png" })).rejects.toMatchObject({ code: "validation" });
    await expect(setDeckCover(deps, "10000000-0000-4000-8000-000000000001", { bytes: new Uint8Array([0xff, 0xd8, 0xff]), declaredMimeType: "image/svg+xml" })).rejects.toMatchObject({ code: "validation" });
    expect(store.putImmutable).not.toHaveBeenCalled();
  });
});

describe("deck cover generation preview", () => {
  it("fails clearly when the image provider is not configured", async () => {
    await expect(generateDeckCover(services({ putImmutable: vi.fn() }), "10000000-0000-4000-8000-000000000001"))
      .rejects.toMatchObject({ code: "conflict" });
  });
});
