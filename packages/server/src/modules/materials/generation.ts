import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  GenerationCommandSchema,
  MAX_DECK_ITEMS,
  type GenerationCommand,
  type GenerationDto,
  type VocabularyItemInput,
  type VocabularyFormat,
  isVisualDataValid,
} from "@learning/contracts";
import type { Services } from "../../config";
import type { Tx } from "../../db/client";
import { claimQueuedRun, enqueueGenerationRun, markRun, markRunSucceeded, supersedeLessonRuns } from "./generation-runs";
import { deckVersions, decks, generationRuns, mediaAssets } from "../../db/schema";
import { AppError } from "../../errors";
import { applyItems } from "./decks";
import { committedRetryAfterSourceChange, lockSourceMaterialForCopy } from "./source-materials";
import { validateItems } from "./item-payload";
import { validateVocabularyFormatItems } from "../../domain/picture-vocabulary";
import { reconcileDraftAssetsTx } from "./media-reconciliation";
import { executeMediaAsset } from "./media-generation";
import { errorCodeOf, MAX_AUTOMATIC_ATTEMPTS, requireGeneration } from "./generation-runtime";

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
  items: z.array(GeneratedItemSchema).max(MAX_DECK_ITEMS),
});

/** Domyślna para języków zestawu słówek; w trybie ze źródła jedyna dozwolona. */
const DEFAULT_DECK_LOCALES = { source: "pl-PL", target: "en-GB" } as const;
/** Domyślna maksymalna liczba pozycji, gdy polecenie jej nie podaje. */
const DEFAULT_GENERATION_MAX_ITEMS = 50;

/**
 * Niezmienny input runu `deck` (`generation_runs.input`). Tryb „z opisu” ma
 * `prompt` i nie ma `mode` (kształt sprzed Etapu 4). Tryb ze źródła
 * (design 2026-10-30 §6.2) ma `mode: "material"`, KOPIĘ tekstu źródła
 * w `material` i opcjonalne zawężenie `instruction` — bez `prompt`; worker nie
 * czyta już źródła, więc jego późniejsza edycja ani usunięcie nie zmienia runu.
 */
type DeckRunCommon = {
  deckId: string;
  deckVersionId: string;
  locales: { source: string; target: string };
  maxItems: number;
  vocabularyFormat: VocabularyFormat;
};
type DeckRunInput =
  | (DeckRunCommon & { prompt: string; mode?: undefined })
  | (DeckRunCommon & { mode: "material"; material: string; instruction?: string });

type ParsedGenerationCommand = z.output<typeof GenerationCommandSchema>;

/** Skąd słowa zestawu: opis rodzica albo zapisane źródło z rewizją treści z podglądu. */
type DeckWordSource =
  | { kind: "prompt"; prompt: string }
  | { kind: "source"; sourceMaterialId: string; expectedBodyRevision: number; instruction?: string };

/**
 * Tryb polecenia po walidacji schematu (dokładnie jedno z `prompt` /
 * `sourceMaterialId`, rewizja tylko przy źródle). Zawężenie jest przycinane;
 * same białe znaki znaczą brak zawężenia (schemat przyjmuje je jako niepusty tekst).
 */
function deckWordSourceOf(cmd: ParsedGenerationCommand): DeckWordSource {
  if (cmd.sourceMaterialId !== undefined && cmd.expectedSourceRevision !== undefined && cmd.prompt === undefined) {
    const instruction = cmd.instruction?.trim();
    return {
      kind: "source",
      sourceMaterialId: cmd.sourceMaterialId,
      expectedBodyRevision: cmd.expectedSourceRevision,
      ...(instruction ? { instruction } : {}),
    };
  }
  if (cmd.prompt !== undefined && cmd.sourceMaterialId === undefined) {
    return { kind: "prompt", prompt: cmd.prompt };
  }
  // Nieosiągalne po `GenerationCommandSchema.parse` — obrona przed rozjazdem z kontraktem.
  throw new AppError("validation", { message: "provide exactly one of prompt or sourceMaterialId" });
}

/**
 * Zleca generowanie nowego zestawu słówek (deck + szkic + run `deck`)
 * idempotentnie po `idempotencyKey` — ponowienie zwraca pierwszy run, także
 * z innym ciałem (bez skrótu żądania, jak dotąd).
 *
 * Z opisu (`prompt`): tytuł z początku opisu, para języków z polecenia albo
 * domyślna, `generation_prompt` = opis.
 *
 * Ze źródła (`sourceMaterialId`, design 2026-10-30 §6.2): pierwsze zapytanie
 * transakcji tworzenia blokuje źródło `FOR KEY SHARE` (`lockSourceMaterialForCopy`)
 * i kopiuje jego tekst do inputu runu, a `decks.source_material_id/_revision`
 * zapisują pochodzenie (rewizja TREŚCI). Tytuł = podany albo tytuł źródła z tej
 * samej wersji wiersza; para języków stała `pl-PL` → `en-GB`;
 * `generation_prompt` = null (opisu nie ma). Brak źródła → `not_found`; rewizja
 * treści inna niż `expectedSourceRevision` → `conflict` z
 * `LessonSourceChangedDetails`, bez zapisu. Ponowienie tego samego klucza po
 * edycji albo usunięciu źródła zwraca zestaw pierwszego żądania — zarówno gdy
 * run już był widoczny (`enqueueGenerationRun`), jak i gdy pierwsze żądanie
 * zatwierdziło go w trakcie naszego (`committedRetryAfterSourceChange`).
 */
export async function enqueueDeckGeneration(
  services: Services,
  input: GenerationCommand,
): Promise<{ runId: string; deckId: string }> {
  const cmd = GenerationCommandSchema.parse(input);
  const wordSource = deckWordSourceOf(cmd);
  const dedupeKey = `deck:${cmd.idempotencyKey}`;
  const maxItems = cmd.maxItems ?? DEFAULT_GENERATION_MAX_ITEMS;

  if (wordSource.kind === "source") {
    return enqueueGenerationRun(services.db, dedupeKey, async (tx) => {
      // Pierwsze zapytanie transakcji: blokada źródła poprzedza każdy zapis zestawu.
      const source = await lockSourceMaterialForCopy(tx, wordSource.sourceMaterialId, wordSource.expectedBodyRevision);
      const ids = { deckId: randomUUID(), versionId: randomUUID(), runId: randomUUID() };
      const locales = DEFAULT_DECK_LOCALES;
      await insertGenerationDraft(tx, {
        ...ids,
        title: cmd.title ?? source.title,
        origin: { sourceMaterialId: wordSource.sourceMaterialId, sourceMaterialRevision: source.bodyRevision },
        locales,
        vocabularyFormat: cmd.vocabularyFormat,
        generationPrompt: null,
        dedupeKey,
        input: {
          mode: "material",
          material: source.body,
          ...(wordSource.instruction === undefined ? {} : { instruction: wordSource.instruction }),
          deckId: ids.deckId,
          deckVersionId: ids.versionId,
          locales,
          maxItems,
          vocabularyFormat: cmd.vocabularyFormat,
        },
      });
      return { runId: ids.runId, deckId: ids.deckId };
    }).catch((error: unknown) => committedRetryAfterSourceChange(services.db, dedupeKey, error));
  }

  const { prompt } = wordSource;
  const locales = cmd.locales ?? DEFAULT_DECK_LOCALES;
  return enqueueGenerationRun(services.db, dedupeKey, async (tx) => {
    const ids = { deckId: randomUUID(), versionId: randomUUID(), runId: randomUUID() };
    await insertGenerationDraft(tx, {
      ...ids,
      title: cmd.title ?? prompt.slice(0, 60),
      origin: undefined,
      locales,
      vocabularyFormat: cmd.vocabularyFormat,
      generationPrompt: prompt,
      dedupeKey,
      input: {
        prompt,
        deckId: ids.deckId,
        deckVersionId: ids.versionId,
        locales,
        maxItems,
        vocabularyFormat: cmd.vocabularyFormat,
      },
    });
    return { runId: ids.runId, deckId: ids.deckId };
  });
}

/** Deck słówek + pierwszy szkic (edycja 1) + run `deck` w kolejce — wspólne dla obu trybów. */
async function insertGenerationDraft(
  tx: Tx,
  draft: {
    deckId: string;
    versionId: string;
    runId: string;
    title: string;
    origin: { sourceMaterialId: string; sourceMaterialRevision: number } | undefined;
    locales: { source: string; target: string };
    vocabularyFormat: VocabularyFormat;
    generationPrompt: string | null;
    dedupeKey: string;
    input: DeckRunInput;
  },
): Promise<void> {
  await tx.insert(decks).values({ id: draft.deckId, title: draft.title, ...draft.origin });
  await tx.insert(deckVersions).values({
    id: draft.versionId,
    deckId: draft.deckId,
    versionNumber: 1,
    editNumber: 1,
    state: "draft",
    title: draft.title,
    sourceLocale: draft.locales.source,
    targetLocale: draft.locales.target,
    vocabularyFormat: draft.vocabularyFormat,
    generationPrompt: draft.generationPrompt,
  });
  await tx.insert(generationRuns).values({
    id: draft.runId,
    deckVersionId: draft.versionId,
    expectedEditNumber: 1,
    kind: "deck",
    dedupeKey: draft.dedupeKey,
    state: "queued",
    input: draft.input,
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
    rejectedCount: run.rejectedCount ?? null,
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
      // generation-worker rozdziela je w runDueGenerationWork, więc tu nie powinny trafić.
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
    // tryb opisu: walidacja wszystko-albo-nic, więc bez liczby odrzuceń
    await markRunSucceeded(tx, services.clock, runId, null);
  });
}
