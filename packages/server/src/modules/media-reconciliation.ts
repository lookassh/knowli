import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { MediaSettings, Services } from "../config";
import type { Executor, Tx } from "../db/client";
import {
  deckVersions,
  generationRuns,
  itemRevisions,
  mediaAssets,
  revisionAssets,
} from "../db/schema";
import { AppError } from "../errors";
import { imageFingerprint, illustrationPrompt, ttsFingerprint } from "../domain/media-fingerprint";
import { payloadToItem } from "./item-payload";

export type AssetRole = "target_audio" | "example_audio" | "illustration";

interface RequiredAsset {
  role: AssetRole;
  kind: "tts" | "illustration";
  fingerprint: string;
  metadata: Record<string, unknown>;
}

/**
 * Wymagane zasoby karty: audio celu zawsze, audio przykładu gdy istnieje,
 * ilustracja gdy visualType=image (kolory/liczby/sekwencje renderujemy
 * deterministycznie). Fingerprint pokrywa pełne żądanie generacji.
 */
export function requiredAssetsFor(
  item: ReturnType<typeof payloadToItem>,
  settings: MediaSettings,
): RequiredAsset[] {
  const required: RequiredAsset[] = [
    {
      role: "target_audio",
      kind: "tts",
      fingerprint: ttsFingerprint({
        text: item.target,
        locale: item.locales.target,
        provider: settings.tts.provider,
        model: settings.tts.model,
        voice: settings.tts.voice,
        format: settings.tts.format,
      }),
      metadata: {
        kind: "tts",
        text: item.target,
        locale: item.locales.target,
        voice: settings.tts.voice,
        format: settings.tts.format,
      },
    },
  ];
  if (item.example !== undefined) {
    required.push({
      role: "example_audio",
      kind: "tts",
      fingerprint: ttsFingerprint({
        text: item.example,
        locale: item.locales.target,
        provider: settings.tts.provider,
        model: settings.tts.model,
        voice: settings.tts.voice,
        format: settings.tts.format,
      }),
      metadata: {
        kind: "tts",
        text: item.example,
        locale: item.locales.target,
        voice: settings.tts.voice,
        format: settings.tts.format,
      },
    });
  }
  if (item.visualType === "image") {
    const prompt = illustrationPrompt(item);
    required.push({
      role: "illustration",
      kind: "illustration",
      fingerprint: imageFingerprint({
        prompt,
        provider: settings.image.provider,
        model: settings.image.model,
        size: settings.image.size,
      }),
      metadata: { kind: "illustration", prompt, size: settings.image.size },
    });
  }
  return required;
}

/**
 * Zwykłe żądanie używa zgodnego gotowego zasobu albo dołącza do trwającej
 * generacji; dopiero brak obu tworzy nowy zasób i run. Rezerwacja odbywa się
 * pod advisory lock na fingerprintcie, więc (fingerprint, generation_number)
 * jest jednoznaczne.
 */
async function findOrCreateAsset(
  tx: Tx,
  settings: MediaSettings,
  req: RequiredAsset,
): Promise<{ id: string; state: "pending" | "ready" }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${req.fingerprint}))`);

  const ready = (
    await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.fingerprint, req.fingerprint), eq(mediaAssets.state, "ready")))
      .orderBy(desc(mediaAssets.generationNumber))
      .limit(1)
  )[0];
  if (ready) {
    return { id: ready.id, state: "ready" };
  }

  const pending = (
    await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.fingerprint, req.fingerprint), eq(mediaAssets.state, "pending")))
      .orderBy(desc(mediaAssets.generationNumber))
      .limit(1)
  )[0];
  if (pending) {
    return { id: pending.id, state: "pending" };
  }

  const counted = (
    await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(mediaAssets)
      .where(eq(mediaAssets.fingerprint, req.fingerprint))
  )[0]!;
  const id = randomUUID();
  await tx.insert(mediaAssets).values({
    id,
    kind: req.kind,
    fingerprint: req.fingerprint,
    generationNumber: counted.count + 1,
    state: "pending",
    provider: req.kind === "tts" ? settings.tts.provider : settings.image.provider,
    model: req.kind === "tts" ? settings.tts.model : settings.image.model,
    metadata: req.metadata,
  });
  await tx.insert(generationRuns).values({
    id: randomUUID(),
    assetId: id,
    kind: req.kind,
    dedupeKey: `asset:${id}`,
    state: "queued",
    input: req.metadata,
  });
  return { id, state: "pending" };
}

/**
 * Uzgadnia powiązania zasobów szkicu w transakcji edycji: zachowuje zgodne,
 * odłącza niezgodne i zleca brakujące. Świadome pominięcie ilustracji trwa
 * przy niezmienionym znaczeniu wizualizacji (niezmienionym fingerprintcie).
 */
export async function reconcileDraftAssetsTx(
  tx: Tx,
  services: Services,
  version: { id: string; state: string },
): Promise<void> {
  const settings = services.media;
  if (!settings) {
    return;
  }
  if (version.state === "published") {
    throw new AppError("immutable");
  }
  const revisions = await tx
    .select({ id: itemRevisions.id, payload: itemRevisions.payload })
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, version.id))
    .orderBy(asc(itemRevisions.position));
  if (revisions.length === 0) {
    return;
  }
  const rows = await tx
    .select()
    .from(revisionAssets)
    .where(inArray(revisionAssets.itemRevisionId, revisions.map((r) => r.id)));
  const rowsByRevision = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const row of rows) {
    const mine = rowsByRevision.get(row.itemRevisionId) ?? new Map();
    mine.set(row.role, row);
    rowsByRevision.set(row.itemRevisionId, mine);
  }

  for (const revision of revisions) {
    const item = payloadToItem(revision.payload);
    const required = requiredAssetsFor(item, settings);
    const mine = rowsByRevision.get(revision.id) ?? new Map();

    // role, których karta już nie wymaga, znikają ze szkicu
    for (const row of mine.values()) {
      if (!required.some((r) => r.role === row.role)) {
        await tx
          .delete(revisionAssets)
          .where(
            and(
              eq(revisionAssets.itemRevisionId, revision.id),
              eq(revisionAssets.role, row.role),
            ),
          );
      }
    }

    for (const req of required) {
      const existing = mine.get(req.role);
      if (existing && existing.expectedFingerprint === req.fingerprint) {
        if (existing.state === "omitted") {
          continue;
        }
        if (existing.assetId !== null) {
          const asset = (
            await tx
              .select({ state: mediaAssets.state, fingerprint: mediaAssets.fingerprint })
              .from(mediaAssets)
              .where(eq(mediaAssets.id, existing.assetId))
          )[0];
          if (asset && asset.fingerprint === req.fingerprint && asset.state !== "failed") {
            const nextState = asset.state === "ready" ? "approved" : "pending";
            if (existing.state !== nextState) {
              await tx
                .update(revisionAssets)
                .set({ state: nextState })
                .where(
                  and(
                    eq(revisionAssets.itemRevisionId, revision.id),
                    eq(revisionAssets.role, req.role),
                  ),
                );
            }
            continue;
          }
        }
      }
      const asset = await findOrCreateAsset(tx, settings, req);
      const nextState = asset.state === "ready" ? "approved" : "pending";
      if (existing) {
        await tx
          .update(revisionAssets)
          .set({ expectedFingerprint: req.fingerprint, assetId: asset.id, state: nextState })
          .where(
            and(
              eq(revisionAssets.itemRevisionId, revision.id),
              eq(revisionAssets.role, req.role),
            ),
          );
      } else {
        await tx.insert(revisionAssets).values({
          itemRevisionId: revision.id,
          role: req.role,
          assetId: asset.id,
          expectedFingerprint: req.fingerprint,
          state: nextState,
        });
      }
    }
  }
}

/** Uzgodnienie poza edycją (np. po zapisie wyniku generacji przez rodzica). */
export async function reconcileDraftAssets(services: Services, draftId: string): Promise<void> {
  return services.db.transaction(async (tx) => {
    const version = (
      await tx.select().from(deckVersions).where(eq(deckVersions.id, draftId)).for("update")
    )[0];
    if (!version) {
      throw new AppError("not_found");
    }
    if (version.state === "published") {
      throw new AppError("immutable");
    }
    await reconcileDraftAssetsTx(tx, services, version);
  });
}

const RegenerateInputSchema = z.object({
  draftId: z.uuid(),
  itemRevisionId: z.uuid(),
  role: z.enum(["target_audio", "example_audio", "illustration"]),
});

/**
 * Świadoma regeneracja: nowy numer generacji i nowy asset_id także dla tych
 * samych ustawień. Zatwierdzone zasoby starej wersji pozostają nietknięte;
 * szkic przechodzi na pending do czasu gotowości nowego zasobu.
 */
export async function regenerateRevisionAsset(
  services: Services,
  input: z.infer<typeof RegenerateInputSchema>,
): Promise<{ assetId: string }> {
  const valid = RegenerateInputSchema.parse(input);
  const settings = services.media;
  if (!settings) {
    throw new AppError("internal", { message: "media settings not configured" });
  }
  return services.db.transaction(async (tx) => {
    const version = (
      await tx.select().from(deckVersions).where(eq(deckVersions.id, valid.draftId)).for("update")
    )[0];
    if (!version) {
      throw new AppError("not_found");
    }
    if (version.state === "published") {
      throw new AppError("immutable");
    }
    const revision = (
      await tx
        .select({ payload: itemRevisions.payload })
        .from(itemRevisions)
        .where(
          and(eq(itemRevisions.id, valid.itemRevisionId), eq(itemRevisions.deckVersionId, valid.draftId)),
        )
    )[0];
    if (!revision) {
      throw new AppError("not_found");
    }
    const req = requiredAssetsFor(payloadToItem(revision.payload), settings).find(
      (r) => r.role === valid.role,
    );
    if (!req) {
      throw new AppError("validation", { message: `role ${valid.role} not required by item` });
    }

    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${req.fingerprint}))`);
    const counted = (
      await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(mediaAssets)
        .where(eq(mediaAssets.fingerprint, req.fingerprint))
    )[0]!;
    const assetId = randomUUID();
    await tx.insert(mediaAssets).values({
      id: assetId,
      kind: req.kind,
      fingerprint: req.fingerprint,
      generationNumber: counted.count + 1,
      state: "pending",
      provider: req.kind === "tts" ? settings.tts.provider : settings.image.provider,
      model: req.kind === "tts" ? settings.tts.model : settings.image.model,
      metadata: req.metadata,
    });
    await tx.insert(generationRuns).values({
      id: randomUUID(),
      assetId,
      kind: req.kind,
      dedupeKey: `asset:${assetId}`,
      state: "queued",
      input: req.metadata,
    });
    await tx
      .insert(revisionAssets)
      .values({
        itemRevisionId: valid.itemRevisionId,
        role: req.role,
        assetId,
        expectedFingerprint: req.fingerprint,
        state: "pending",
      })
      .onConflictDoUpdate({
        target: [revisionAssets.itemRevisionId, revisionAssets.role],
        set: { assetId, expectedFingerprint: req.fingerprint, state: "pending" },
      });
    return { assetId };
  });
}

/** Publikacja sprawdza gotowość i zgodność fingerprintu powiązanego zasobu. */
export async function assertAssetPublishable(
  db: Executor,
  input: {
    itemRevisionId: string;
    role: AssetRole;
    assetId: string | null;
    expectedFingerprint: string;
  },
): Promise<void> {
  if (input.assetId === null) {
    throw new AppError("validation", {
      message: `${input.role} not linked for revision ${input.itemRevisionId}`,
    });
  }
  const asset = (
    await db
      .select({ state: mediaAssets.state, fingerprint: mediaAssets.fingerprint })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, input.assetId))
  )[0];
  if (!asset || asset.state !== "ready" || asset.fingerprint !== input.expectedFingerprint) {
    throw new AppError("validation", {
      message: `${input.role} not ready for revision ${input.itemRevisionId}`,
    });
  }
}
