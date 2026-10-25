import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  UiAudioCatalogDtoSchema,
  UiAudioKeySchema,
  type UiAudioCatalogDto,
  type UiAudioKey,
} from "@learning/contracts";
import type { Services } from "../../config";
import { generationRuns, mediaAssets } from "../../db/schema";
import { AppError } from "../../errors";
import { ttsFingerprint } from "../../domain/media-fingerprint";
import { isUiAudioAssetMetadata, UI_AUDIO_TEXTS } from "../../domain/ui-audio-catalog";

function settingsOf(services: Services) {
  if (!services.media) throw new AppError("internal", { message: "media settings not configured" });
  return services.media.tts;
}

function requestOf(services: Services, key: UiAudioKey) {
  const settings = settingsOf(services);
  const text = UI_AUDIO_TEXTS[key];
  return {
    text,
    fingerprint: ttsFingerprint({
      text,
      locale: "pl-PL",
      provider: settings.provider,
      model: settings.model,
      voice: settings.voice,
      format: settings.format,
    }),
    metadata: {
      purpose: "kid_ui_guidance",
      uiAudioKey: key,
      text,
      locale: "pl-PL",
      voice: settings.voice,
      format: settings.format,
    },
  };
}

/** Zleca brakujące stałe pliki audio przez kolejkę media_assets. Idempotentne i bez wywołania TTS. */
export async function prepareUiAudio(services: Services): Promise<void> {
  const keys = UiAudioKeySchema.options;
  const byFingerprint = new Map<string, ReturnType<typeof requestOf>>();
  for (const key of keys) {
    const request = requestOf(services, key);
    if (!byFingerprint.has(request.fingerprint)) byFingerprint.set(request.fingerprint, request);
  }

  for (const request of byFingerprint.values()) {
    await services.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${request.fingerprint}))`);
      const assets = await tx.select().from(mediaAssets)
        .where(eq(mediaAssets.fingerprint, request.fingerprint))
        .orderBy(desc(mediaAssets.generationNumber));
      if (assets.some((asset) => asset.state === "ready"
        && isUiAudioAssetMetadata(asset.metadata)
        && asset.metadata.text === request.text)) return;
      if (assets.some((asset) => asset.state === "pending"
        && isUiAudioAssetMetadata(asset.metadata)
        && asset.metadata.text === request.text)) return;

      const id = randomUUID();
      const generationNumber = (assets[0]?.generationNumber ?? 0) + 1;
      const settings = settingsOf(services);
      await tx.insert(mediaAssets).values({
        id,
        kind: "tts",
        fingerprint: request.fingerprint,
        generationNumber,
        state: "pending",
        provider: settings.provider,
        model: settings.model,
        metadata: request.metadata,
      });
      await tx.insert(generationRuns).values({
        id: randomUUID(),
        assetId: id,
        kind: "tts",
        dedupeKey: `asset:${id}`,
        state: "queued",
        input: request.metadata,
      });
    });
  }
}

/** Odczytuje gotowe immutable asset_id; nigdy nie zleca generacji. */
export async function readUiAudio(services: Services): Promise<UiAudioCatalogDto> {
  const assets: Partial<Record<UiAudioKey, string>> = {};
  const byFingerprint = new Map<string, UiAudioKey[]>();
  for (const key of UiAudioKeySchema.options) {
    const { fingerprint } = requestOf(services, key);
    byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), key]);
  }
  for (const [fingerprint, keys] of byFingerprint) {
    const ready = (await services.db.select().from(mediaAssets)
      .where(and(eq(mediaAssets.fingerprint, fingerprint), eq(mediaAssets.state, "ready")))
      .orderBy(desc(mediaAssets.generationNumber)));
    const asset = ready.find((candidate) => isUiAudioAssetMetadata(candidate.metadata));
    if (asset) for (const key of keys) assets[key] = asset.id;
  }
  return UiAudioCatalogDtoSchema.parse({
    ready: Object.keys(assets).length === UiAudioKeySchema.options.length,
    assets,
  });
}
