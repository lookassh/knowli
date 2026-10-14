import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, ne, not, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  GenerationCommandSchema,
  type GenerationCommand,
  type GenerationDto,
  type VocabularyItemInput,
  type VocabularyFormat,
  isVisualDataValid,
} from "@learning/contracts";
import type { Clock, GenerationDeps, Services } from "../config";
import type { Database, Executor, Tx } from "../db/client";
import { deckVersions, decks, generationRuns, itemRevisions, mediaAssets, revisionAssets } from "../db/schema";
import { AppError } from "../errors";
import { applyItems } from "./decks";
import { validateItems } from "./item-payload";
import { validateVocabularyFormatItems } from "../domain/picture-vocabulary";
import { reconcileDraftAssetsTx } from "./media-reconciliation";
import { executeLessonGeneration } from "./lessons/lesson-drafts";
import { runWorkerSlots, selectFairWorkerWork, workerAttemptFromKey, workerAttemptKey, workerIdFromAttemptKey, type WorkKind } from "./worker-schedule";

/** Maksymalnie trzy automatyczne próby; dalsze tylko po ręcznym ponowieniu. */
export const MAX_AUTOMATIC_ATTEMPTS = 3;

/** Lease zasobu mediów; deck nie ma lease (CHECK generation_runs_deck_without_lease). */
const MEDIA_LEASE_MS = 5 * 60_000;

const GeneratedItemSchema = z.object({
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  acceptedAnswers: z.array(z.string().min(1).max(120)).max(20).default([]),
  example: z.string().min(1).max(300).optional(),
  visualType: z.enum(["image", "color", "number", "sequence", "none"]).default("none"),
  visualData: z.record(z.string(), z.unknown()).optional(),
}).refine((item) => isVisualDataValid(item.visualType, item.visualData, item.target), {
  path: ["visualData"],
  message: "visualData does not match visualType",
});
const GeneratedDeckSchema = z.object({
  items: z.array(GeneratedItemSchema).max(50),
});

export function requireGeneration(services: Services): GenerationDeps {
  if (!services.generation) {
    throw new AppError("internal", { message: "generation dependencies not configured" });
  }
  return services.generation;
}

/**
 * Idempotentne zlecenie runu generacji szkicu pod kluczem `dedupeKey`
 * (`deck:<id>` / `lesson:<id>`). Wspólny szkielet dla słówek i lekcji: jeśli run
 * o tym kluczu istnieje i zna swój `deckId`, zwraca go; inaczej otwiera własną
 * transakcję i woła `create(tx)` (wstawia deck/wersję/run). Przy równoległym
 * duplikacie klucza (`23505`) transakcja przegranego wycofuje się, a zwycięzcę
 * odczytujemy świeżym zapytaniem POZA wycofaną transakcją (w aborted tx nie da
 * się już nic odczytać). Jedna obsługa wyścigu idempotencji — moduł lekcji jej
 * używa zamiast kopiować. `create` zwraca `{ runId, deckId }`.
 */
export async function enqueueGenerationRun(
  db: Database,
  dedupeKey: string,
  create: (tx: Tx) => Promise<{ runId: string; deckId: string }>,
): Promise<{ runId: string; deckId: string }> {
  const found = await findEnqueuedRun(db, dedupeKey);
  if (found) {
    return found;
  }
  try {
    return await db.transaction(async (tx) => create(tx));
  } catch (error) {
    // równoległy duplikat klucza idempotencji: transakcja już wycofana, więc
    // zwycięzcę czytamy świeżym zapytaniem na połączeniu bazowym. Drizzle
    // opakowuje błąd pg, więc kod bywa na error.cause (jak w upsertAssignment).
    const pgCode =
      (error as { code?: string }).code ??
      (error as { cause?: { code?: string } }).cause?.code;
    if (pgCode === "23505") {
      const winner = await findEnqueuedRun(db, dedupeKey);
      if (winner) {
        return winner;
      }
    }
    throw error;
  }
}

/** Odczyt istniejącego runu po kluczu idempotencji, jeśli zna swój `deckId`. */
async function findEnqueuedRun(
  db: Executor,
  dedupeKey: string,
): Promise<{ runId: string; deckId: string } | null> {
  const existing = (
    await db.select().from(generationRuns).where(eq(generationRuns.dedupeKey, dedupeKey))
  )[0];
  const deckId = (existing?.input as { deckId?: string } | undefined)?.deckId;
  if (existing && deckId) {
    return { runId: existing.id, deckId };
  }
  return null;
}

/** Walidacja wyniku AI to porażka terminalna; pozostałe błędy są powtarzalne. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof z.ZodError) {
    return "validation";
  }
  if (error instanceof AppError && error.code === "validation") {
    return "validation";
  }
  return "provider";
}

export async function markRun(
  db: Executor,
  clock: Clock,
  runId: string,
  state: "succeeded" | "failed" | "superseded" | "queued",
  errorCode: string | null,
): Promise<void> {
  await db
    .update(generationRuns)
    .set({
      state,
      errorCode,
      nextAttemptAt: null,
      finishedAt: state === "queued" ? null : clock.now(),
    })
    .where(eq(generationRuns.id, runId));
}

/**
 * Called only while the owning deck version is locked. A parent edit or a
 * successful generation makes outstanding runs for that edit stale before
 * they can publish their result.
 */
export async function supersedeLessonRuns(
  db: Executor,
  deckVersionId: string,
  finishedAt: Date,
  exceptRunId?: string,
): Promise<void> {
  await db.update(generationRuns)
    .set({ state: "superseded", errorCode: null, finishedAt })
    .where(and(
      eq(generationRuns.kind, "lesson"),
      eq(generationRuns.deckVersionId, deckVersionId),
      inArray(generationRuns.state, ["queued", "running"]),
      exceptRunId ? ne(generationRuns.id, exceptRunId) : undefined,
    ));
}

/**
 * Claim CAS runu generacji szkicu (deck/lesson): `queued → running` + inkrement
 * prób. Zwraca liczbę prób po claimie, albo `null`, gdy run nie był `queued`
 * (inny worker już go zabrał). Współdzielone przez ścieżkę słówek i lekcji —
 * jedna implementacja atomowego przejęcia zamiast kopii w module lekcji.
 */
export async function claimQueuedRun(db: Executor, runId: string, expectedEditNumber?: number, now?: Date): Promise<number | null> {
  const claimed = await db
    .update(generationRuns)
    .set({ state: "running", attempts: sql`${generationRuns.attempts} + 1` })
    .where(and(
      eq(generationRuns.id, runId),
      eq(generationRuns.state, "queued"),
      expectedEditNumber === undefined ? undefined : eq(generationRuns.expectedEditNumber, expectedEditNumber),
      now === undefined ? undefined : or(isNull(generationRuns.nextAttemptAt), lte(generationRuns.nextAttemptAt, now)),
    ))
    .returning({ attempts: generationRuns.attempts });
  return claimed[0]?.attempts ?? null;
}

export async function enqueueDeckGeneration(
  services: Services,
  input: GenerationCommand,
): Promise<{ runId: string; deckId: string }> {
  const cmd = GenerationCommandSchema.parse(input);
  const locales = cmd.locales ?? { source: "pl-PL", target: "en-GB" };

  return enqueueGenerationRun(services.db, `deck:${cmd.idempotencyKey}`, async (tx) => {
    const deckId = randomUUID();
    const versionId = randomUUID();
    const title = cmd.title ?? cmd.prompt.slice(0, 60);
    const runId = randomUUID();
    await tx.insert(decks).values({ id: deckId, title });
    await tx.insert(deckVersions).values({
      id: versionId,
      deckId,
      versionNumber: 1,
      editNumber: 1,
      state: "draft",
      title,
      sourceLocale: locales.source,
      targetLocale: locales.target,
      vocabularyFormat: cmd.vocabularyFormat,
      generationPrompt: cmd.prompt,
    });
    await tx.insert(generationRuns).values({
      id: runId,
      deckVersionId: versionId,
      expectedEditNumber: 1,
      kind: "deck",
      dedupeKey: `deck:${cmd.idempotencyKey}`,
      state: "queued",
      input: {
        prompt: cmd.prompt,
        deckId,
        deckVersionId: versionId,
        locales,
        maxItems: cmd.maxItems ?? 50,
        vocabularyFormat: cmd.vocabularyFormat,
      },
    });
    return { runId, deckId };
  });
}

export async function readGeneration(services: Services, runId: string): Promise<GenerationDto> {
  const run = (await services.db.select().from(generationRuns).where(eq(generationRuns.id, runId)))[0];
  if (!run) {
    throw new AppError("not_found");
  }
  let deckId: string | null = null;
  if (run.deckVersionId) {
    deckId =
      (
        await services.db
          .select({ deckId: deckVersions.deckId })
          .from(deckVersions)
          .where(eq(deckVersions.id, run.deckVersionId))
      )[0]?.deckId ?? null;
  }
  return {
    id: run.id,
    deckId,
    deckVersionId: run.deckVersionId ?? null,
    state: run.state as GenerationDto["state"],
    attempts: run.attempts,
    errorCode: run.errorCode ?? null,
  };
}

/**
 * Ręczne ponowienie po porażce (lub odblokowanie runu utkwionego w running
 * po awarii workera). Resetuje budżet prób; nie rusza runów zakończonych.
 */
export async function retryGeneration(services: Services, runId: string): Promise<{ runId: string }> {
  const run = (await services.db.select().from(generationRuns).where(eq(generationRuns.id, runId)))[0];
  if (!run) {
    throw new AppError("not_found");
  }
  if (run.state === "succeeded" || run.state === "superseded") {
    throw new AppError("conflict");
  }
  await services.db.transaction(async (tx) => {
    if (run.kind === "lesson") {
      // Taka sama kolejność blokad jak finalizacja lekcji: wersja, potem run.
      const version = (await tx.select().from(deckVersions).where(eq(deckVersions.id, run.deckVersionId!)).for("update"))[0];
      const current = (await tx.select().from(generationRuns).where(eq(generationRuns.id, runId)).for("update"))[0];
      if (!version || !current || version.state === "published" || current.state === "succeeded" || current.state === "superseded") throw new AppError("conflict");
      if (current.state === "queued") {
        if (current.nextAttemptAt && current.nextAttemptAt > services.clock.now()) {
          await tx.update(generationRuns).set({ attempts: 0, errorCode: null, nextAttemptAt: null })
            .where(eq(generationRuns.id, runId));
        }
        return;
      }
      if (version.editNumber !== current.expectedEditNumber) throw new AppError("conflict");
      const editNumber = version.editNumber + 1;
      await tx.update(deckVersions).set({ editNumber }).where(eq(deckVersions.id, version.id));
      await supersedeLessonRuns(tx, version.id, services.clock.now(), runId);
      await tx.update(generationRuns).set({ state: "queued", attempts: 0, errorCode: null, finishedAt: null, nextAttemptAt: null, expectedEditNumber: editNumber }).where(eq(generationRuns.id, runId));
      return;
    }
    if (run.assetId) {
      const asset = (await tx.select().from(mediaAssets).where(eq(mediaAssets.id, run.assetId)))[0];
      if (asset?.state === "ready") {
        throw new AppError("conflict");
      }
      if (asset && asset.state === "failed") {
        await tx
          .update(mediaAssets)
          .set({ state: "pending", leaseToken: null, leaseUntil: null })
          .where(eq(mediaAssets.id, asset.id));
      }
    }
    await tx
      .update(generationRuns)
      .set({ state: "queued", attempts: 0, errorCode: null, finishedAt: null })
      .where(eq(generationRuns.id, runId));
  });
  return { runId };
}

export async function executeGeneration(services: Services, runId: string, signal?: AbortSignal): Promise<void> {
  const deps = requireGeneration(services);
  const run = (await services.db.select().from(generationRuns).where(eq(generationRuns.id, runId)))[0];
  if (!run) {
    throw new AppError("not_found");
  }
  if (run.kind !== "deck") {
    if (run.kind === "lesson") {
      // Runy lekcji wykonuje dedykowany moduł (modules/lessons/lesson-drafts.ts);
      // worker rozdziela je w runDueGenerationWork, więc tu nie powinny trafić.
      throw new AppError("internal", { message: "lesson run must be executed by lesson module" });
    }
    await executeMediaAsset(services, run.assetId!, signal);
    return;
  }
  if (run.state !== "queued") {
    return;
  }
  if (signal?.aborted) return;

  const attempts = await claimQueuedRun(services.db, runId);
  if (attempts === null) {
    return;
  }
  if (attempts > MAX_AUTOMATIC_ATTEMPTS) {
    await markRun(services.db, services.clock, runId, "failed", "attempts_exhausted");
    return;
  }

  const runInput = run.input as {
    prompt: string;
    locales: { source: string; target: string };
    maxItems: number;
    vocabularyFormat?: VocabularyFormat;
  };
  let generated: z.infer<typeof GeneratedDeckSchema>;
  try {
    const result = await deps.llm.generateDeck({
      prompt: runInput.prompt,
      sourceLocale: runInput.locales.source,
      targetLocale: runInput.locales.target,
      maxItems: runInput.maxItems,
      vocabularyFormat: runInput.vocabularyFormat ?? "standard",
    }, signal);
    generated = GeneratedDeckSchema.parse(result);
  } catch (error) {
    if (signal?.aborted) {
      await markRun(services.db, services.clock, runId, "queued", null);
      return;
    }
    const code = errorCodeOf(error);
    if (code === "validation") {
      await markRun(services.db, services.clock, runId, "failed", "validation");
    } else if (attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      await markRun(services.db, services.clock, runId, "failed", "attempts_exhausted");
    } else {
      await markRun(services.db, services.clock, runId, "queued", null);
    }
    return;
  }

  if (signal?.aborted) {
    await markRun(services.db, services.clock, runId, "queued", null);
    return;
  }

  const vocabularyFormat = runInput.vocabularyFormat ?? "standard";
  if (generated.items.length === 0) {
    await markRun(services.db, services.clock, runId, "failed", vocabularyFormat === "picture" ? "no_picture_material" : "validation");
    return;
  }

  const items: VocabularyItemInput[] = generated.items.map((item) => ({
    source: item.source,
    target: item.target,
    acceptedAnswers: item.acceptedAnswers,
    ...(item.example === undefined ? {} : { example: item.example }),
    visualType: item.visualType,
    ...(item.visualData === undefined ? {} : { visualData: item.visualData }),
    locales: runInput.locales,
  }));
  try {
    validateItems(items);
    validateVocabularyFormatItems(vocabularyFormat, items);
  } catch (error) {
    if (error instanceof AppError && error.code === "validation") {
      await markRun(services.db, services.clock, runId, "failed", "validation");
      return;
    }
    throw error;
  }

  await services.db.transaction(async (tx) => {
    const version = (
      await tx.select().from(deckVersions).where(eq(deckVersions.id, run.deckVersionId!)).for("update")
    )[0];
    if (!version) {
      await markRun(tx, services.clock, runId, "failed", "deck_version_gone");
      return;
    }
    // wynik zapisujemy tylko przy zgodnym numerze edycji szkicu
    if (version.state === "published" || version.editNumber !== run.expectedEditNumber) {
      await markRun(tx, services.clock, runId, "superseded", null);
      return;
    }
    await applyItems(tx, version.id, version.deckId, items);
    await reconcileDraftAssetsTx(tx, services, version);
    await tx.update(deckVersions).set({ state: "review" }).where(eq(deckVersions.id, version.id));
    await markRun(tx, services.clock, runId, "succeeded", null);
  });
}

/** Zwiększa licznik prób runu mediów; lease żyje na media_assets. */
async function claimMediaRun(db: Executor, assetId: string): Promise<number | null> {
  const claimed = await db
    .update(generationRuns)
    .set({ state: "running", attempts: sql`${generationRuns.attempts} + 1`, finishedAt: null })
    .where(
      and(
        eq(generationRuns.assetId, assetId),
        inArray(generationRuns.kind, ["tts", "illustration"]),
        inArray(generationRuns.state, ["queued", "running"]),
      ),
    )
    .returning({ attempts: generationRuns.attempts });
  return claimed[0]?.attempts ?? null;
}

async function failMediaAsset(
  services: Services,
  assetId: string,
  leaseToken: string,
  errorCode: string,
): Promise<void> {
  await services.db.transaction(async (tx) => {
    await tx
      .update(mediaAssets)
      .set({ state: "failed", leaseToken: null, leaseUntil: null })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.leaseToken, leaseToken)));
    await tx
      .update(generationRuns)
      .set({ state: "failed", errorCode, finishedAt: services.clock.now() })
      .where(
        and(eq(generationRuns.assetId, assetId), inArray(generationRuns.state, ["queued", "running"])),
      );
  });
}

/** Requeue cancellation only while this worker still owns the shared asset lease. */
async function requeueAbortedMediaAsset(services: Services, assetId: string, leaseToken: string): Promise<void> {
  await services.db.transaction(async (tx) => {
    const released = await tx.update(mediaAssets)
      .set({ leaseToken: null, leaseUntil: null })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.leaseToken, leaseToken)))
      .returning({ id: mediaAssets.id });
    if (released.length === 0) return;
    await tx.update(generationRuns)
      .set({ state: "queued", errorCode: null, finishedAt: null })
      .where(and(eq(generationRuns.assetId, assetId), eq(generationRuns.state, "running")));
  });
}

/**
 * Pending TTS używany wyłącznie przez lekcje z wyłączonym audio nie powinien
 * już wywoływać providera. Wspólny fingerprint zostaje aktywny, jeśli odwołują
 * się do niego słówka lub przedmiot z włączonym TTS.
 */
async function supersedeDisabledLessonTts(services: Services, asset: typeof mediaAssets.$inferSelect): Promise<boolean> {
  if (asset.kind !== "tts") return false;
  return services.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${asset.fingerprint}))`);
    const current = (await tx.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id)).for("update"))[0];
    if (current?.state !== "pending") return false;
    const references = await tx.select({ kind: decks.kind, lessonContext: deckVersions.lessonContext })
      .from(revisionAssets)
      .innerJoin(itemRevisions, eq(itemRevisions.id, revisionAssets.itemRevisionId))
      .innerJoin(deckVersions, eq(deckVersions.id, itemRevisions.deckVersionId))
      .innerJoin(decks, eq(decks.id, itemRevisions.deckId))
      .where(eq(revisionAssets.assetId, asset.id));
    if (references.length > 0 && !references.every(reference => {
      const subjectId = (reference.lessonContext as { subjectId?: string } | null)?.subjectId;
      return reference.kind === "lesson" && typeof subjectId === "string"
        && services.subjects.getSubject(subjectId)?.ttsForAnswers === false;
    })) return false;
    await tx.update(mediaAssets).set({ state: "failed", leaseToken: null, leaseUntil: null })
      .where(eq(mediaAssets.id, asset.id));
    await tx.update(generationRuns).set({ state: "superseded", errorCode: null, finishedAt: services.clock.now() })
      .where(and(eq(generationRuns.assetId, asset.id), inArray(generationRuns.state, ["queued", "running"])));
    return true;
  });
}

/**
 * Wykonanie zadania zasobu: claim lease CAS, wywołanie providera, zapis
 * content-addressed i finalizeacja CAS w jednej transakcji. Finalizacja
 * aktualizuje wyłącznie globalny asset/run — powiązań szkicu nie rusza.
 */
export async function executeMediaAsset(services: Services, assetId: string, signal?: AbortSignal): Promise<void> {
  const deps = requireGeneration(services);
  if (signal?.aborted) return;
  const asset = (await services.db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)))[0];
  if (!asset) {
    throw new AppError("not_found");
  }
  if (asset.state === "ready") {
    await services.db
      .update(generationRuns)
      .set({ state: "succeeded", finishedAt: services.clock.now() })
      .where(
        and(eq(generationRuns.assetId, assetId), inArray(generationRuns.state, ["queued", "running"])),
      );
    return;
  }
  if (asset.state === "failed") {
    return;
  }
  if (await supersedeDisabledLessonTts(services, asset)) return;

  const leaseToken = randomUUID();
  const now = services.clock.now();
  const claimed = await services.db
    .update(mediaAssets)
    .set({ leaseToken, leaseUntil: new Date(now.getTime() + MEDIA_LEASE_MS) })
    .where(
      and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.state, "pending"),
        or(isNull(mediaAssets.leaseToken), sql`${mediaAssets.leaseUntil} < ${now}`),
      ),
    )
    .returning({ kind: mediaAssets.kind, metadata: mediaAssets.metadata });
  if (claimed.length === 0) {
    return;
  }

  const attempts = await claimMediaRun(services.db, assetId);
  if (attempts !== null && attempts > MAX_AUTOMATIC_ATTEMPTS) {
    await failMediaAsset(services, assetId, leaseToken, "attempts_exhausted");
    return;
  }

  const metadata = claimed[0]!.metadata as {
    text?: string;
    locale?: string;
    voice?: string;
    prompt?: string;
    model?: string;
    size?: string;
    quality?: string;
    format?: string;
  };
  try {
    const result =
      asset.kind === "tts"
        ? await deps.tts.synthesize({
            text: metadata.text!,
            locale: metadata.locale!,
            voice: metadata.voice!,
            format: "mp3",
          }, signal)
        : await deps.image.generate({
            prompt: metadata.prompt!,
            // Starsze zasoby sprzed parametryzacji quality/format: odtwarzamy
            // żądanie zgodne z ich fingerprintem (gpt-image-1, high, png).
            model: metadata.model ?? deps.image.model,
            size: metadata.size!,
            quality: metadata.quality ?? "high",
            format: metadata.format ?? "png",
          }, signal);
    if (signal?.aborted) {
      await requeueAbortedMediaAsset(services, assetId, leaseToken);
      return;
    }
    const stored = await deps.mediaStore.putImmutable(result.bytes, result.mimeType);

    await services.db.transaction(async (tx) => {
      const finalized = await tx
        .update(mediaAssets)
        .set({
          state: "ready",
          storageKey: stored.storageKey,
          contentSha256: stored.contentSha256,
          mimeType: result.mimeType,
          byteCount: stored.byteCount,
          leaseToken: null,
          leaseUntil: null,
        })
        .where(
          and(
            eq(mediaAssets.id, assetId),
            eq(mediaAssets.leaseToken, leaseToken),
            ne(mediaAssets.state, "ready"),
          ),
        )
        .returning({ id: mediaAssets.id });

      const done = finalized.length > 0 || (await assetReady(tx, assetId));
      if (done) {
        await tx
          .update(generationRuns)
          .set({ state: "succeeded", finishedAt: services.clock.now() })
          .where(
            and(
              eq(generationRuns.assetId, assetId),
              inArray(generationRuns.state, ["queued", "running"]),
            ),
          );
      }
      // przegrany CAS przy niedokończonym zasobie: nasz blob zostaje osierocony
    });
  } catch (error) {
    // porażka providera wraca do kolejki; wyczerpany budżet zamyka zasób.
    // Do logów trafia wyłącznie kod klasyfikacji; komunikat providera może
    // zawierać treść odpowiedzi HTTP.
    console.warn(
      `[generation] ${asset.kind} nie udało się (próba ${attempts ?? "?"}/${MAX_AUTOMATIC_ATTEMPTS}, asset ${assetId}, kod=${errorCodeOf(error)})`,
    );
    if (signal?.aborted) {
      await requeueAbortedMediaAsset(services, assetId, leaseToken);
      return;
    }
    if (attempts !== null && attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      await failMediaAsset(services, assetId, leaseToken, "attempts_exhausted");
      return;
    }
    await services.db
      .update(mediaAssets)
      .set({ leaseToken: null, leaseUntil: null })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.leaseToken, leaseToken)));
    await services.db
      .update(generationRuns)
      .set({ state: "queued", errorCode: errorCodeOf(error), finishedAt: null })
      .where(and(eq(generationRuns.assetId, assetId), eq(generationRuns.state, "running")));
  }
}

async function assetReady(db: Executor, assetId: string): Promise<boolean> {
  const row = (
    await db.select({ state: mediaAssets.state }).from(mediaAssets).where(eq(mediaAssets.id, assetId))
  )[0];
  return row?.state === "ready";
}

export interface WorkerLimits {
  total?: number;
  deck?: number;
  lesson?: number;
  tts?: number;
  images?: number;
}

/**
 * Jedno przelotne przetworzenie zleconej pracy (poller workera; testy wołają
 * bezpośrednio). Kolejność: decki, lekcje, TTS, ilustracje — obrazów naraz
 * najwyżej jeden, łącznie nie więcej niż dwie równoległe zadania.
 */
export async function runDueGenerationWork(
  services: Services,
  limits: WorkerLimits = {},
  options: { signal?: AbortSignal; onProgress?: () => void } = {},
): Promise<{ processed: number }> {
  requireGeneration(services);
  const maxDeck = limits.deck ?? 2;
  const maxLesson = limits.lesson ?? 2;
  const maxTts = limits.tts ?? 2;
  const maxImages = limits.images ?? 1;
  const maxTotal = limits.total ?? 2;
  if (options.signal?.aborted) return { processed: 0 };
  const concurrencyLimits: Record<WorkKind, number> = { deck: maxDeck, lesson: maxLesson, tts: maxTts, illustration: maxImages };
  const processed = await runWorkerSlots<{ id: string; assetId?: string; attempts: number }>({
    concurrency: maxTotal,
    loadNext: async (active, seenKeys) => {
      if (options.signal?.aborted) return undefined;
      const activeCounts: Record<WorkKind, number> = { deck: 0, lesson: 0, tts: 0, illustration: 0 };
      const activeIds = [...new Set(active.map((item) => item.value.assetId ?? item.value.id))];
      const seenAttempts = [...seenKeys].map((key) => ({ id: workerIdFromAttemptKey(key), attempts: workerAttemptFromKey(key) }));
      const excludeSeenRunAttempts = seenAttempts.length > 0
        ? not(or(...seenAttempts.map(({ id, attempts }) => and(eq(generationRuns.id, id), eq(generationRuns.attempts, attempts))))!)
        : undefined;
      for (const item of active) activeCounts[item.kind] += 1;
      const remaining: Record<WorkKind, number> = {
        deck: Math.max(0, concurrencyLimits.deck - activeCounts.deck),
        lesson: Math.max(0, concurrencyLimits.lesson - activeCounts.lesson),
        tts: Math.max(0, concurrencyLimits.tts - activeCounts.tts),
        illustration: Math.max(0, concurrencyLimits.illustration - activeCounts.illustration),
      };
      const deckRuns = remaining.deck > 0 ? await services.db
        .select({ id: generationRuns.id, attempts: generationRuns.attempts })
        .from(generationRuns)
        .where(and(
          eq(generationRuns.kind, "deck"), eq(generationRuns.state, "queued"),
          ...(activeIds.length ? [notInArray(generationRuns.id, activeIds)] : []),
          ...(excludeSeenRunAttempts ? [excludeSeenRunAttempts] : []),
        ))
        .orderBy(asc(generationRuns.createdAt))
        .limit(remaining.deck) : [];
      const lessonRuns = remaining.lesson > 0 ? await services.db
        .select({ id: generationRuns.id, attempts: generationRuns.attempts })
        .from(generationRuns)
        .where(and(
          eq(generationRuns.kind, "lesson"),
          eq(generationRuns.state, "queued"),
          or(isNull(generationRuns.nextAttemptAt), lte(generationRuns.nextAttemptAt, services.clock.now())),
          ...(activeIds.length ? [notInArray(generationRuns.id, activeIds)] : []),
          ...(excludeSeenRunAttempts ? [excludeSeenRunAttempts] : []),
        ))
        .orderBy(asc(generationRuns.createdAt))
        .limit(remaining.lesson) : [];
      const dueMedia = remaining.tts > 0 || remaining.illustration > 0 ? await services.db
        .select({ assetId: generationRuns.assetId, kind: generationRuns.kind, attempts: generationRuns.attempts })
        .from(generationRuns)
        .innerJoin(mediaAssets, eq(mediaAssets.id, generationRuns.assetId))
        .where(and(
          inArray(generationRuns.kind, ["tts", "illustration"]),
          inArray(generationRuns.state, ["queued", "running"]),
          eq(mediaAssets.state, "pending"),
          or(isNull(mediaAssets.leaseToken), sql`${mediaAssets.leaseUntil} < ${services.clock.now()}`),
          ...(activeIds.length ? [notInArray(generationRuns.assetId, activeIds)] : []),
          ...(seenAttempts.length > 0
            ? [not(or(...seenAttempts.map(({ id, attempts }) => and(eq(generationRuns.assetId, id), eq(generationRuns.attempts, attempts))))!)]
            : []),
        ))
        .orderBy(asc(generationRuns.createdAt)) : [];
      const queues: Record<WorkKind, { id: string; assetId?: string; attempts: number }[]> = {
        deck: deckRuns.map((run) => ({ id: run.id, attempts: run.attempts })),
        lesson: lessonRuns.map((run) => ({ id: run.id, attempts: run.attempts })),
        tts: dueMedia.filter((run) => run.kind === "tts" && run.assetId).slice(0, remaining.tts).map((run) => ({ id: run.assetId!, assetId: run.assetId!, attempts: run.attempts })),
        illustration: dueMedia.filter((run) => run.kind === "illustration" && run.assetId).slice(0, remaining.illustration).map((run) => ({ id: run.assetId!, assetId: run.assetId!, attempts: run.attempts })),
      };
      const selected = selectFairWorkerWork(queues, remaining, 1, workerScheduleCursor);
      workerScheduleCursor = selected.nextCursor;
      const next = selected.work[0];
      return next ? { key: workerAttemptKey(next.value.id, next.value.attempts), kind: next.kind, value: next.value } : undefined;
    },
    execute: async ({ kind, value }) => {
      if (options.signal?.aborted) return;
      if (kind === "deck") await executeGeneration(services, value.id, options.signal);
      else if (kind === "lesson") await executeLessonGeneration(services, value.id, { signal: options.signal });
      else await executeMediaAsset(services, value.assetId!, options.signal);
    },
    onError: (error) => console.error(`[worker] zadanie workera zakończone wyjątkiem: kod=${errorCodeOf(error)}`),
    onProgress: options.onProgress,
  });
  return { processed };
}

let workerScheduleCursor = 0;
