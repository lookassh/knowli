import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  GenerationCommandSchema,
  type GenerationCommand,
  type GenerationDto,
  type VocabularyItemInput,
  isVisualDataValid,
} from "@learning/contracts";
import type { Clock, GenerationDeps, Services } from "../config";
import type { Database, Executor, Tx } from "../db/client";
import { deckVersions, decks, generationRuns, mediaAssets } from "../db/schema";
import { AppError } from "../errors";
import { applyItems } from "./decks";
import { validateItems } from "./item-payload";
import { reconcileDraftAssetsTx } from "./media-reconciliation";
import { executeLessonGeneration } from "./lessons/lesson-drafts";

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
  items: z.array(GeneratedItemSchema).min(1).max(50),
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

export async function executeGeneration(services: Services, runId: string): Promise<void> {
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
    await executeMediaAsset(services, run.assetId!);
    return;
  }
  if (run.state !== "queued") {
    return;
  }

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
  };
  let generated: z.infer<typeof GeneratedDeckSchema>;
  try {
    const result = await deps.llm.generateDeck({
      prompt: runInput.prompt,
      sourceLocale: runInput.locales.source,
      targetLocale: runInput.locales.target,
      maxItems: runInput.maxItems,
    });
    generated = GeneratedDeckSchema.parse(result);
  } catch (error) {
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

/**
 * Wykonanie zadania zasobu: claim lease CAS, wywołanie providera, zapis
 * content-addressed i finalizeacja CAS w jednej transakcji. Finalizacja
 * aktualizuje wyłącznie globalny asset/run — powiązań szkicu nie rusza.
 */
export async function executeMediaAsset(services: Services, assetId: string): Promise<void> {
  const deps = requireGeneration(services);
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

  const leaseToken = randomUUID();
  const now = services.clock.now();
  const claimed = await services.db
    .update(mediaAssets)
    .set({ leaseToken, leaseUntil: new Date(now.getTime() + MEDIA_LEASE_MS) })
    .where(
      and(
        eq(mediaAssets.id, assetId),
        ne(mediaAssets.state, "ready"),
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
          })
        : await deps.image.generate({
            prompt: metadata.prompt!,
            // Starsze zasoby sprzed parametryzacji quality/format: odtwarzamy
            // żądanie zgodne z ich fingerprintem (gpt-image-1, high, png).
            model: metadata.model ?? deps.image.model,
            size: metadata.size!,
            quality: metadata.quality ?? "high",
            format: metadata.format ?? "png",
          });
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
    // Przyczyna trafia do logów (bez promptu i sekretów) — inaczej failed asset
    // w bazie jest jedynym śladem po stronie operacyjnej.
    console.warn(
      `[generation] ${asset.kind} nie udało się (próba ${attempts ?? "?"}/${MAX_AUTOMATIC_ATTEMPTS}, asset ${assetId}): ${error instanceof Error ? error.message : String(error)}`,
    );
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
): Promise<{ processed: number }> {
  requireGeneration(services);
  const maxDeck = limits.deck ?? 2;
  const maxLesson = limits.lesson ?? 2;
  const maxTts = limits.tts ?? 2;
  const maxImages = limits.images ?? 1;
  const now = services.clock.now();
  let processed = 0;

  const deckRuns = await services.db
    .select({ id: generationRuns.id })
    .from(generationRuns)
    .where(and(eq(generationRuns.kind, "deck"), eq(generationRuns.state, "queued")))
    .orderBy(asc(generationRuns.createdAt))
    .limit(maxDeck);
  for (const run of deckRuns) {
    await executeGeneration(services, run.id);
    processed += 1;
  }

  const lessonRuns = await services.db
    .select({ id: generationRuns.id })
    .from(generationRuns)
      .where(and(
        eq(generationRuns.kind, "lesson"),
        eq(generationRuns.state, "queued"),
        or(isNull(generationRuns.nextAttemptAt), lte(generationRuns.nextAttemptAt, services.clock.now())),
      ))
    .orderBy(asc(generationRuns.createdAt))
    .limit(maxLesson);
  for (const run of lessonRuns) {
    await executeLessonGeneration(services, run.id);
    processed += 1;
  }

  const dueMedia = await services.db
    .select({ assetId: generationRuns.assetId, kind: generationRuns.kind })
    .from(generationRuns)
    .innerJoin(mediaAssets, eq(mediaAssets.id, generationRuns.assetId))
    .where(
      and(
        inArray(generationRuns.kind, ["tts", "illustration"]),
        inArray(generationRuns.state, ["queued", "running"]),
        eq(mediaAssets.state, "pending"),
        or(isNull(mediaAssets.leaseToken), sql`${mediaAssets.leaseUntil} < ${now}`),
      ),
    )
    .orderBy(asc(generationRuns.createdAt));
  for (const run of dueMedia.filter((r) => r.kind === "tts").slice(0, maxTts)) {
    await executeMediaAsset(services, run.assetId!);
    processed += 1;
  }
  for (const run of dueMedia.filter((r) => r.kind === "illustration").slice(0, maxImages)) {
    await executeMediaAsset(services, run.assetId!);
    processed += 1;
  }
  return { processed };
}
