import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import type { Services } from "../config";
import { AppError } from "../errors";
import { decks, mediaAssets } from "../db/schema";
import { assertVocabularyDeck } from "./deck-kind";

export const MAX_DECK_COVER_BYTES = 5 * 1024 * 1024;
export const MAX_DECK_COVER_PIXELS = 20_000_000;

function detectImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Ustawia niezmienny zasób po walidacji bajtów; poprzednia okładka działa do commit-u. */
export async function setDeckCover(services: Services, deckId: string, input: { bytes: Uint8Array; declaredMimeType: string }): Promise<string> {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_DECK_COVER_BYTES) {
    throw new AppError("validation", { message: "Obraz musi mieć maksymalnie 5 MB." });
  }
  const mimeType = detectImage(input.bytes);
  if (!mimeType || mimeType !== input.declaredMimeType) {
    throw new AppError("validation", { message: "Wybierz prawidłowy obraz PNG, JPEG lub WebP." });
  }
  try {
    const image = sharp(input.bytes, { failOn: "error", limitInputPixels: MAX_DECK_COVER_PIXELS });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_DECK_COVER_PIXELS) throw new Error("Invalid image dimensions");
    await image.raw().toBuffer();
  } catch {
    throw new AppError("validation", { message: "Wybierz prawidłowy obraz PNG, JPEG lub WebP o maksymalnie 20 megapikselach." });
  }
  if (!services.mediaStore) throw new AppError("internal", { message: "Magazyn obrazów jest niedostępny." });
  const [deck] = await services.db.select({ id: decks.id, kind: decks.kind }).from(decks).where(eq(decks.id, deckId));
  if (!deck) throw new AppError("not_found");
  assertVocabularyDeck(deck.kind as "vocabulary" | "lesson");

  const digest = createHash("sha256").update(input.bytes).digest("hex");
  const [existing] = await services.db.select({ id: mediaAssets.id }).from(mediaAssets)
    .where(and(eq(mediaAssets.fingerprint, `deck-cover:${digest}`), eq(mediaAssets.kind, "deck_cover"), eq(mediaAssets.state, "ready")));
  let assetId = existing?.id;
  if (!assetId) {
    const stored = await services.mediaStore.putImmutable(input.bytes, mimeType);
    await services.db.insert(mediaAssets).values({
      id: randomUUID(), kind: "deck_cover", fingerprint: `deck-cover:${digest}`, generationNumber: 1,
      state: "ready", storageKey: stored.storageKey, contentSha256: stored.contentSha256,
      mimeType, byteCount: stored.byteCount, provider: "parent-upload", model: "uploaded",
      metadata: {}, createdAt: services.clock.now(),
    }).onConflictDoNothing();
    const [saved] = await services.db.select({ id: mediaAssets.id }).from(mediaAssets)
      .where(and(eq(mediaAssets.fingerprint, `deck-cover:${digest}`), eq(mediaAssets.kind, "deck_cover"), eq(mediaAssets.state, "ready")));
    if (!saved) throw new AppError("internal", { message: "Nie udało się zapisać obrazu okładkowego." });
    assetId = saved.id;
  }
  await services.db.update(decks).set({ coverAssetId: assetId }).where(eq(decks.id, deckId));
  return assetId;
}

/** Clear jest idempotentny i nie dotyka treści, wersji ani postępu. */
export async function clearDeckCover(services: Services, deckId: string): Promise<void> {
  const [deck] = await services.db.select({ id: decks.id, kind: decks.kind }).from(decks).where(eq(decks.id, deckId));
  if (!deck) throw new AppError("not_found");
  assertVocabularyDeck(deck.kind as "vocabulary" | "lesson");
  await services.db.update(decks).set({ coverAssetId: null }).where(eq(decks.id, deckId));
}
