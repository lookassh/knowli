import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  UiAudioCatalogDtoSchema,
  UiAudioKeySchema,
  type UiAudioCatalogDto,
  type UiAudioKey,
} from "@learning/contracts";
import { ttsVoiceFor, type Services } from "../../config";
import { generationRuns, mediaAssets } from "../../db/schema";
import { AppError } from "../../errors";
import { ttsFingerprint } from "../../domain/media-fingerprint";
import { isUiAudioAssetMetadata, UI_AUDIO_STYLES, UI_AUDIO_TEXTS } from "../../domain/ui-audio-catalog";
import { ttsRequestInstructions } from "../../providers/tts-style-profile";

function settingsOf(services: Services) {
  if (!services.media) throw new AppError("internal", { message: "media settings not configured" });
  return services.media.tts;
}

function requestOf(services: Services, key: UiAudioKey) {
  const settings = settingsOf(services);
  const text = UI_AUDIO_TEXTS[key];
  const voice = ttsVoiceFor(settings, "pl-PL");
  const instructions = ttsRequestInstructions(settings, "pl-PL", UI_AUDIO_STYLES[key]);
  return {
    text,
    fingerprint: ttsFingerprint({
      text,
      locale: "pl-PL",
      provider: settings.provider,
      model: settings.model,
      voice,
      format: settings.format,
      instructions,
    }),
    metadata: {
      purpose: "kid_ui_guidance",
      uiAudioKey: key,
      text,
      locale: "pl-PL",
      voice,
      format: settings.format,
      ...(instructions === undefined ? {} : { instructions }),
    },
  };
}

type UiAudioRequest = ReturnType<typeof requestOf>;
type UiAudioTx = Parameters<Parameters<Services["db"]["transaction"]>[0]>[0];

/**
 * Wspólne zlecanie nagrania komunikatu: pod blokadą fingerprintu wstawia nowy wiersz pending i uruchomienie
 * w kolejce. Oczekująca generacja zawsze wstrzymuje zlecenie (jedna pending na fingerprint); gotowa wstrzymuje je
 * tylko bez `force` (ponowne nagranie celowo tworzy kolejną generację). Zwraca, czy zlecono.
 */
async function enqueueUiAudioTx(
  tx: UiAudioTx,
  services: Services,
  request: UiAudioRequest,
  options: { force: boolean },
): Promise<boolean> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${request.fingerprint}))`);
  const assets = await tx.select().from(mediaAssets)
    .where(eq(mediaAssets.fingerprint, request.fingerprint))
    .orderBy(desc(mediaAssets.generationNumber));
  if (!options.force && assets.some((asset) => asset.state === "ready"
    && isUiAudioAssetMetadata(asset.metadata)
    && asset.metadata.text === request.text)) return false;
  if (assets.some((asset) => asset.state === "pending"
    && isUiAudioAssetMetadata(asset.metadata)
    && asset.metadata.text === request.text)) return false;

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
  return true;
}

/** Zleca brakujące stałe pliki audio przez kolejkę media_assets. Idempotentne i bez wywołania TTS. */
export async function prepareUiAudio(services: Services): Promise<void> {
  const keys = UiAudioKeySchema.options;
  const byFingerprint = new Map<string, UiAudioRequest>();
  for (const key of keys) {
    const request = requestOf(services, key);
    if (!byFingerprint.has(request.fingerprint)) byFingerprint.set(request.fingerprint, request);
  }

  for (const request of byFingerprint.values()) {
    await services.db.transaction((tx) => enqueueUiAudioTx(tx, services, request, { force: false }));
  }
}

/**
 * Polecenie serwisowe (spec tonu TTS §2.4, §3.5): zleca NOWĄ generację nagrania komunikatu (ten sam bieżący
 * fingerprint, kolejny `generationNumber`). Odczyt do czasu jej wykonania zwraca poprzednie gotowe nagranie.
 * Klucze współdzielące fingerprint są zlecane raz; klucz z już oczekującą generacją trafia do `skipped`.
 */
export async function regenerateUiAudio(
  services: Services,
  keys: readonly UiAudioKey[],
): Promise<{ queued: UiAudioKey[]; skipped: UiAudioKey[] }> {
  if (keys.length === 0) throw new Error("At least one UI audio key is required");
  const requests = new Map<string, { request: UiAudioRequest; keys: UiAudioKey[] }>();
  for (const key of new Set(keys)) {
    const request = requestOf(services, key);
    const entry = requests.get(request.fingerprint);
    if (entry) entry.keys.push(key);
    else requests.set(request.fingerprint, { request, keys: [key] });
  }

  const queued: UiAudioKey[] = [];
  const skipped: UiAudioKey[] = [];
  for (const { request, keys: sharing } of requests.values()) {
    const enqueued = await services.db.transaction((tx) => enqueueUiAudioTx(tx, services, request, { force: true }));
    (enqueued ? queued : skipped).push(...sharing);
  }
  return { queued, skipped };
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
  // Odczyt zapasowy (spec tonu TTS §3.4): dopóki nagranie o bieżącym fingerprincie nie jest gotowe (zmiana stylu,
  // głosu lub instrukcji), dziecko słyszy ostatnie gotowe nagranie tego samego komunikatu i tego samego tekstu.
  // Nagranie o bieżącym fingerprincie zawsze wygrywa; zasób pozostaje niezmienny, a zapytanie nic nie zleca.
  for (const key of UiAudioKeySchema.options) {
    if (assets[key]) continue;
    const candidates = await services.db.select().from(mediaAssets)
      .where(and(
        eq(mediaAssets.kind, "tts"),
        eq(mediaAssets.state, "ready"),
        sql`${mediaAssets.metadata}->>'purpose' = 'kid_ui_guidance'`,
        sql`${mediaAssets.metadata}->>'uiAudioKey' = ${key}`,
        sql`${mediaAssets.metadata}->>'text' = ${UI_AUDIO_TEXTS[key]}`,
      ))
      .orderBy(desc(mediaAssets.createdAt));
    const fallback = candidates.find((candidate) => isUiAudioAssetMetadata(candidate.metadata));
    if (fallback) assets[key] = fallback.id;
  }
  return UiAudioCatalogDtoSchema.parse({
    ready: Object.keys(assets).length === UiAudioKeySchema.options.length,
    assets,
  });
}
