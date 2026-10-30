import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { LessonCardAudioDto, LessonPromptAudioDto } from "@learning/contracts";
import type { Services } from "../../../config";
import type { Executor, Tx } from "../../../db/client";
import { generationRuns, itemRevisions, lessonCardAssets, mediaAssets, revisionAssets } from "../../../db/schema";
import { AppError } from "../../../errors";
import { lockVersion } from "../version-ops";

/**
 * Nagrania pytań i kart lekcji w panelu rodzica (spec tonu TTS §2.4, §4.5):
 * stan nagrania w DTO szkicu i „Nagraj ponownie”. Nagranie nie jest decyzją
 * rodzica ani warunkiem publikacji; ponowne nagranie to nowa generacja tego
 * samego fingerprintu, którą odsłuch (najnowsza gotowa generacja) podejmuje we
 * wszystkich wersjach współdzielących tekst. Gotowe zasoby pozostają niezmienne.
 */

/** Stan najnowszej generacji o oczekiwanym fingerprincie; `assetId` tylko dla gotowej. */
function audioDto(newest: { id: string; state: string }): LessonPromptAudioDto {
  const state = newest.state === "ready" || newest.state === "failed" ? newest.state : "pending";
  return state === "ready" ? { state, assetId: newest.id } : { state };
}

/**
 * Stan nagrań wersji lekcji: pytania per rewizja i karty w kolejności zagadnień
 * tematu. Wiersz bez żadnej generacji swojego fingerprintu (albo brak wiersza)
 * nie daje wpisu. Jedno zapytanie na rodzaj nagrania dla całej wersji.
 */
export async function readLessonAudioStates(
  db: Executor,
  versionId: string,
  objectiveOrder: readonly string[],
): Promise<{ prompts: Map<string, LessonPromptAudioDto>; cards: LessonCardAudioDto[] }> {
  const promptRows = await db
    .select({ itemRevisionId: revisionAssets.itemRevisionId, id: mediaAssets.id, state: mediaAssets.state })
    .from(revisionAssets)
    .innerJoin(itemRevisions, eq(itemRevisions.id, revisionAssets.itemRevisionId))
    .innerJoin(mediaAssets, eq(mediaAssets.fingerprint, revisionAssets.expectedFingerprint))
    .where(and(eq(itemRevisions.deckVersionId, versionId), eq(revisionAssets.role, "prompt_audio"), eq(mediaAssets.kind, "tts")))
    .orderBy(desc(mediaAssets.generationNumber));
  const prompts = new Map<string, LessonPromptAudioDto>();
  for (const row of promptRows) {
    if (!prompts.has(row.itemRevisionId)) prompts.set(row.itemRevisionId, audioDto(row));
  }

  const cardRows = await db
    .select({ objectiveId: lessonCardAssets.objectiveId, cardIndex: lessonCardAssets.cardIndex, id: mediaAssets.id, state: mediaAssets.state })
    .from(lessonCardAssets)
    .innerJoin(mediaAssets, eq(mediaAssets.fingerprint, lessonCardAssets.expectedFingerprint))
    .where(and(eq(lessonCardAssets.deckVersionId, versionId), eq(mediaAssets.kind, "tts")))
    .orderBy(desc(mediaAssets.generationNumber));
  const cardsByKey = new Map<string, LessonCardAudioDto>();
  for (const row of cardRows) {
    const key = `${row.cardIndex}:${row.objectiveId}`;
    if (!cardsByKey.has(key)) cardsByKey.set(key, { objectiveId: row.objectiveId, cardIndex: row.cardIndex, audio: audioDto(row) });
  }
  const rank = (objectiveId: string) => {
    const index = objectiveOrder.indexOf(objectiveId);
    return index === -1 ? objectiveOrder.length : index;
  };
  const cards = [...cardsByKey.values()].sort((a, b) =>
    rank(a.objectiveId) - rank(b.objectiveId) || a.objectiveId.localeCompare(b.objectiveId) || a.cardIndex - b.cardIndex);
  return { prompts, cards };
}

/** Blokada wersji jak przy edycji szkicu; opublikowana wersja jest niezmienna. */
async function lockDraft(tx: Tx, versionId: string): Promise<void> {
  const version = await lockVersion(tx, versionId);
  if (version.state === "published") {
    throw new AppError("immutable");
  }
}

/**
 * Kolejna generacja fingerprintu (spec tonu TTS §2.4): fingerprint i żądanie
 * (rodzaj, provider, model, metadane) z najnowszego zasobu — bez przeliczania
 * z bieżącej konfiguracji, więc nowe ujęcie odpowiada dokładnie temu samemu
 * tekstowi i instrukcji. Trwająca generacja → jej `assetId` bez nowego wiersza.
 */
async function enqueueNextGenerationTx(tx: Tx, fingerprint: string): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fingerprint}))`);
  const generations = await tx
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.fingerprint, fingerprint))
    .orderBy(desc(mediaAssets.generationNumber));
  const newest = generations[0];
  if (!newest) {
    throw new AppError("not_found");
  }
  const pending = generations.find((generation) => generation.state === "pending");
  if (pending) {
    return pending.id;
  }
  const id = randomUUID();
  await tx.insert(mediaAssets).values({
    id,
    kind: newest.kind,
    fingerprint,
    generationNumber: newest.generationNumber + 1,
    state: "pending",
    provider: newest.provider,
    model: newest.model,
    metadata: newest.metadata,
  });
  await tx.insert(generationRuns).values({
    id: randomUUID(),
    assetId: id,
    kind: newest.kind,
    dedupeKey: `asset:${id}`,
    state: "queued",
    input: newest.metadata,
  });
  return id;
}

const PromptAudioInputSchema = z.object({
  lessonDraftId: z.uuid(),
  itemRevisionId: z.uuid(),
});

const CardAudioInputSchema = z.object({
  lessonDraftId: z.uuid(),
  objectiveId: z.string().min(1),
  cardIndex: z.number().int().nonnegative(),
});

/**
 * „Nagraj ponownie” pytania ćwiczenia w szkicu lekcji. Brak wersji, rewizji
 * w tej wersji, wiersza nagrania albo zasobu jego fingerprintu → `not_found`;
 * opublikowana wersja → `immutable`. Wiersz szkicu wskazuje nową generację.
 */
export async function regenerateLessonPromptAudio(
  services: Services,
  input: z.infer<typeof PromptAudioInputSchema>,
): Promise<{ assetId: string }> {
  const valid = PromptAudioInputSchema.parse(input);
  return services.db.transaction(async (tx) => {
    await lockDraft(tx, valid.lessonDraftId);
    const row = (
      await tx
        .select({ expectedFingerprint: revisionAssets.expectedFingerprint })
        .from(revisionAssets)
        .innerJoin(itemRevisions, eq(itemRevisions.id, revisionAssets.itemRevisionId))
        .where(and(
          eq(revisionAssets.itemRevisionId, valid.itemRevisionId),
          eq(itemRevisions.deckVersionId, valid.lessonDraftId),
          eq(revisionAssets.role, "prompt_audio"),
        ))
    )[0];
    if (!row) {
      throw new AppError("not_found");
    }
    const assetId = await enqueueNextGenerationTx(tx, row.expectedFingerprint);
    await tx
      .update(revisionAssets)
      .set({ assetId, state: "pending" })
      .where(and(eq(revisionAssets.itemRevisionId, valid.itemRevisionId), eq(revisionAssets.role, "prompt_audio")));
    return { assetId };
  });
}

/**
 * „Nagraj ponownie” karty zagadnienia w szkicu lekcji (miejsce karty w temacie).
 * Brak wersji, wiersza nagrania karty albo zasobu jego fingerprintu →
 * `not_found`; opublikowana wersja → `immutable`.
 */
export async function regenerateLessonCardAudio(
  services: Services,
  input: z.infer<typeof CardAudioInputSchema>,
): Promise<{ assetId: string }> {
  const valid = CardAudioInputSchema.parse(input);
  return services.db.transaction(async (tx) => {
    await lockDraft(tx, valid.lessonDraftId);
    const where = and(
      eq(lessonCardAssets.deckVersionId, valid.lessonDraftId),
      eq(lessonCardAssets.objectiveId, valid.objectiveId),
      eq(lessonCardAssets.cardIndex, valid.cardIndex),
    );
    const row = (await tx.select({ expectedFingerprint: lessonCardAssets.expectedFingerprint }).from(lessonCardAssets).where(where))[0];
    if (!row) {
      throw new AppError("not_found");
    }
    const assetId = await enqueueNextGenerationTx(tx, row.expectedFingerprint);
    await tx.update(lessonCardAssets).set({ assetId }).where(where);
    return { assetId };
  });
}
