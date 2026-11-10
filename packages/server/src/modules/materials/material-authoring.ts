import { and, eq, inArray } from "drizzle-orm";
import {
  DeckDraftCreateInputSchema,
  DeckDraftEditInputSchema,
  DeckGetInputSchema,
  DraftPatchSchema,
  IllustrationOmitInputSchema,
  MaterialArchiveInputSchema,
  MaterialListInputSchema,
  MaterialPublishInputSchema,
  RecordingRegenerateInputSchema,
  SourceCreateInputSchema,
  SourceGetInputSchema,
  SourceListInputSchema,
  SourceUpdateInputSchema,
  type DeckDraftWriteResult,
  type DraftDto,
  type MaterialListResult,
  type SourceMaterialDto,
  type SourceMaterialSummaryDto,
  type VocabularyDeckDto,
  type VocabularyItemInput,
} from "@learning/contracts";
import type { Services } from "../../config";
import type { Executor } from "../../db/client";
import { deckVersions, decks, itemRevisions } from "../../db/schema";
import { AppError } from "../../errors";
import { MATERIALS_PUBLISH_SCOPE, MATERIALS_WRITE_SCOPE, requireIntegrationScope } from "../family";
import { archiveDeck, copyRevisionsSkillsAssets, createEmptyDeck, editDraftTx, listDecks, publishDraft, readDraftDto } from "./decks";
import { publishLessonDraft } from "./lessons/lesson-api";
import { regenerateLessonCardAudio, regenerateLessonPromptAudio, regenerateLessonStoryAudio } from "./lessons/lesson-prompt-audio";
import { omitRevisionAsset, regenerateRevisionAsset } from "./media-reconciliation";
import { createSourceMaterial, getSourceMaterial, listSourceMaterials, updateSourceMaterial } from "./source-materials";
import { createVersionFromPublished, lockVersion } from "./version-ops";

/**
 * Materiały redagowane przez agenta (narzędzia MCP, `docs/integrations/lesson-authoring.md`): lista
 * materiałów, zestawy słówek, źródła i nagrania dla tokenu `materials:write`, publikacja i archiwizacja
 * dla tokenu `materials:publish`. Każda operacja sprawdza token i woła przypadek użycia panelu rodzica;
 * własną transakcję ma tylko edycja zestawu słówek (scalenie zmian z zapisaną listą i kopia szkicu
 * z wersji opublikowanej muszą być atomowe z zapisem). Pozostałe operacje sprawdzają token tuż przed
 * wywołaniem przypadku użycia, który otwiera własną transakcję.
 */

function invalid(message: string): AppError {
  return new AppError("validation", { message });
}

async function activeDeck(db: Executor, deckId: string) {
  const deck = (await db.select().from(decks).where(eq(decks.id, deckId)))[0];
  if (!deck) throw new AppError("not_found");
  if (deck.archivedAt) throw invalid("deck is archived");
  return deck;
}

async function vocabularyDeck(db: Executor, deckId: string) {
  const deck = await activeDeck(db, deckId);
  if (deck.kind !== "vocabulary") throw invalid("deck is not a vocabulary deck; use the lesson tools");
  return deck;
}

async function editableVersion(db: Executor, deckId: string): Promise<{ id: string; editNumber: number } | undefined> {
  const [row] = await db.select({ id: deckVersions.id, editNumber: deckVersions.editNumber }).from(deckVersions)
    .where(and(eq(deckVersions.deckId, deckId), inArray(deckVersions.state, ["draft", "review"])));
  return row;
}

/** Szkic, bez którego nagrań i publikacji nie ma: opublikowana wersja jest niezmienna. */
async function requireDraft(db: Executor, deckId: string): Promise<{ id: string; editNumber: number }> {
  const draft = await editableVersion(db, deckId);
  if (!draft) throw new AppError("conflict", { message: "the deck has no draft; edit it first" });
  return draft;
}

function deckDto(dto: DraftDto): VocabularyDeckDto {
  const itemIdByRevision = new Map(dto.items.map((item) => [item.revisionId, item.id!]));
  return {
    deckId: dto.deckId,
    draftId: dto.id,
    status: dto.status,
    editNumber: dto.editNumber,
    title: dto.title,
    vocabularyFormat: dto.vocabularyFormat,
    items: dto.items.map(({ revisionId: _revisionId, ...item }) => ({ ...item, id: item.id! })),
    recordings: dto.assets.map((asset) => ({ itemId: itemIdByRevision.get(asset.itemRevisionId)!, role: asset.role, state: asset.state })),
  };
}

/** Lista lekcji i zestawów słówek rodziny: bez przypisań i dzieci. */
export async function listMaterials(services: Services, rawToken: string, input: unknown): Promise<MaterialListResult> {
  const { query, kind, includeArchived } = MaterialListInputSchema.parse(input);
  await requireIntegrationScope(services.db, rawToken, [MATERIALS_WRITE_SCOPE, MATERIALS_PUBLISH_SCOPE]);
  const needle = query?.toLocaleLowerCase("pl-PL");
  const rows = (await listDecks(services)).filter((row) =>
    (includeArchived === true || row.state !== "archived") &&
    (kind === undefined || (row.kind ?? "vocabulary") === kind) &&
    (needle === undefined || row.title.toLocaleLowerCase("pl-PL").includes(needle)));
  const draftIds = rows.flatMap((row) => (row.editableVersionId === null ? [] : [row.editableVersionId]));
  const editNumbers = new Map(draftIds.length === 0 ? [] : (await services.db
    .select({ id: deckVersions.id, editNumber: deckVersions.editNumber }).from(deckVersions).where(inArray(deckVersions.id, draftIds)))
    .map((row): [string, number] => [row.id, row.editNumber]));
  return {
    materials: rows.map((row) => ({
      deckId: row.deckId,
      title: row.title,
      kind: row.kind ?? "vocabulary",
      state: row.state,
      itemCount: row.itemCount ?? 0,
      draftEditNumber: row.editableVersionId === null ? null : editNumbers.get(row.editableVersionId) ?? null,
      published: row.publishedVersionId !== null,
    })),
  };
}

/** Stan zestawu słówek: szkic, a bez szkicu wersja opublikowana. */
export async function getVocabularyDeck(services: Services, rawToken: string, input: unknown): Promise<VocabularyDeckDto> {
  const { deckId } = DeckGetInputSchema.parse(input);
  return services.db.transaction(async (tx) => {
    await requireIntegrationScope(tx, rawToken, MATERIALS_WRITE_SCOPE);
    const deck = await vocabularyDeck(tx, deckId);
    const versionId = (await editableVersion(tx, deck.id))?.id ?? deck.publishedVersionId;
    if (!versionId) throw new AppError("not_found");
    return deckDto(await readDraftDto(tx, versionId));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Nowy pusty zestaw słówek; `deckId = clientRequestId`, powtórka zwraca ten sam zestaw. */
export async function createVocabularyDeck(services: Services, rawToken: string, input: unknown): Promise<DeckDraftWriteResult> {
  const { clientRequestId, title } = DeckDraftCreateInputSchema.parse(input);
  await requireIntegrationScope(services.db, rawToken, MATERIALS_WRITE_SCOPE);
  await createEmptyDeck(services, { deckId: clientRequestId, ...(title === undefined ? {} : { title }) });
  const deck = (await services.db.select().from(decks).where(eq(decks.id, clientRequestId)))[0];
  if (!deck || deck.kind !== "vocabulary") throw new AppError("conflict", { message: "clientRequestId belongs to another deck" });
  const version = (await editableVersion(services.db, deck.id)) ?? (deck.publishedVersionId
    ? (await services.db.select({ id: deckVersions.id, editNumber: deckVersions.editNumber }).from(deckVersions).where(eq(deckVersions.id, deck.publishedVersionId)))[0]
    : undefined);
  if (!version) throw new AppError("not_found");
  return { deckId: deck.id, draftId: version.id, editNumber: version.editNumber, itemIds: [] };
}

/**
 * Edycja zestawu słówek bez odsyłania całości: scala `items` (z `id` — zastąpienie, bez `id` — nowa
 * pozycja na końcu) i `remove` z zapisaną listą i zapisuje wynik rdzeniem edycji rodzica (`editDraftTx`:
 * klucze umiejętności tylko dla zmienionych kryteriów, uzgodnienie mediów). Bez szkicu `expectedEditNumber`
 * dotyczy wersji opublikowanej, a kopia szkicu i edycja dzieją się w tej transakcji (błąd → brak szkicu).
 */
export async function editVocabularyDeck(services: Services, rawToken: string, input: unknown): Promise<DeckDraftWriteResult> {
  const valid = DeckDraftEditInputSchema.parse(input);
  const changed = valid.items ?? [];
  const removed = new Set(valid.remove ?? []);
  if (valid.title === undefined && changed.length === 0 && removed.size === 0) throw invalid("the edit must change title, items or remove");
  return services.db.transaction(async (tx) => {
    await requireIntegrationScope(tx, rawToken, MATERIALS_WRITE_SCOPE);
    const deck = await vocabularyDeck(tx, valid.deckId);
    let versionId = (await editableVersion(tx, deck.id))?.id;
    let expectedEditNumber = valid.expectedEditNumber;
    if (versionId === undefined) {
      if (!deck.publishedVersionId) throw new AppError("conflict");
      if ((await lockVersion(tx, deck.publishedVersionId)).editNumber !== expectedEditNumber) throw new AppError("conflict");
      versionId = await createVersionFromPublished(tx, deck.id, (innerTx, { source, newVersionId }) =>
        copyRevisionsSkillsAssets(innerTx, { sourceVersionId: source.id, newVersionId, deckId: deck.id }),
      );
      expectedEditNumber = 1;
    } else if ((await lockVersion(tx, versionId)).editNumber !== expectedEditNumber) {
      throw new AppError("conflict");
    }
    const stored = (await readDraftDto(tx, versionId)).items.map(({ revisionId: _revisionId, ...item }): VocabularyItemInput => item);
    const storedIds = new Set(stored.map((item) => item.id!));
    const replacements = new Map(changed.flatMap((item) => (item.id === undefined ? [] : [[item.id, item] as const])));
    const referenced = [...replacements.keys(), ...removed];
    const unknown = referenced.filter((id) => !storedIds.has(id));
    if (unknown.length > 0 || new Set(referenced).size !== referenced.length || replacements.size !== changed.filter((item) => item.id !== undefined).length) {
      throw new AppError("validation", { message: "item ids must be unique ids from deck_get, each used once in items or remove", details: { unknownIds: unknown } });
    }
    const added = changed.filter((item) => item.id === undefined);
    const merged = [...stored.filter((item) => !removed.has(item.id!)).map((item) => replacements.get(item.id!) ?? item), ...added];
    const itemsChanged = changed.length > 0 || removed.size > 0;
    if (itemsChanged && merged.length === 0) throw invalid("a deck keeps at least one item");
    const dto = await editDraftTx(tx, services, versionId, DraftPatchSchema.parse({
      expectedEditNumber,
      ...(valid.title === undefined ? {} : { title: valid.title }),
      ...(itemsChanged ? { items: merged } : {}),
    }));
    // Nowe pozycje stoją na końcu listy w kolejności wejścia.
    const newIds = dto.items.slice(dto.items.length - added.length).map((item) => item.id!);
    return { deckId: dto.deckId, draftId: dto.id, editNumber: dto.editNumber, itemIds: changed.map((item) => item.id ?? newIds.shift()!) };
  });
}

export async function listSources(services: Services, rawToken: string, input: unknown): Promise<{ sources: SourceMaterialSummaryDto[] }> {
  SourceListInputSchema.parse(input ?? {});
  await requireIntegrationScope(services.db, rawToken, MATERIALS_WRITE_SCOPE);
  return { sources: await listSourceMaterials(services) };
}

export async function getSource(services: Services, rawToken: string, input: unknown): Promise<SourceMaterialDto> {
  const { sourceId } = SourceGetInputSchema.parse(input);
  await requireIntegrationScope(services.db, rawToken, MATERIALS_WRITE_SCOPE);
  return getSourceMaterial(services, sourceId);
}

export async function createSource(services: Services, rawToken: string, input: unknown): Promise<{ sourceId: string; created: boolean }> {
  const valid = SourceCreateInputSchema.parse(input);
  await requireIntegrationScope(services.db, rawToken, MATERIALS_WRITE_SCOPE);
  const { id, created } = await createSourceMaterial(services, valid);
  return { sourceId: id, created };
}

export async function updateSource(services: Services, rawToken: string, input: unknown): Promise<SourceMaterialDto> {
  const { sourceId, ...patch } = SourceUpdateInputSchema.parse(input);
  await requireIntegrationScope(services.db, rawToken, MATERIALS_WRITE_SCOPE);
  return updateSourceMaterial(services, sourceId, patch);
}

async function draftRevisionId(db: Executor, draftId: string, itemId: string): Promise<string> {
  const [row] = await db.select({ id: itemRevisions.id }).from(itemRevisions)
    .where(and(eq(itemRevisions.deckVersionId, draftId), eq(itemRevisions.itemId, itemId)));
  if (!row) throw new AppError("not_found");
  return row.id;
}

/** Ponowne nagranie albo ilustracja w szkicu: te same operacje co „Nagraj ponownie” w panelu. */
export async function regenerateRecording(services: Services, rawToken: string, input: unknown): Promise<{ assetId: string }> {
  const { deckId, target } = RecordingRegenerateInputSchema.parse(input);
  await requireIntegrationScope(services.db, rawToken, MATERIALS_WRITE_SCOPE);
  const deck = await activeDeck(services.db, deckId);
  const draft = await requireDraft(services.db, deck.id);
  const lessonTarget = target.kind !== "item" || target.role === "prompt_audio" || target.role === "explanation_audio";
  // Role słówek liczą nagranie z pól pozycji słówek (`requiredAssetsFor`), a nagrania lekcji mają własne ścieżki.
  if (lessonTarget !== (deck.kind === "lesson")) throw invalid(`this recording target does not exist in a ${deck.kind} deck`);
  if (target.kind === "card") return regenerateLessonCardAudio(services, { lessonDraftId: draft.id, objectiveId: target.objectiveId, cardIndex: target.cardIndex });
  if (target.kind === "story") return regenerateLessonStoryAudio(services, { lessonDraftId: draft.id });
  const itemRevisionId = await draftRevisionId(services.db, draft.id, target.itemId);
  return target.role === "prompt_audio" || target.role === "explanation_audio"
    ? regenerateLessonPromptAudio(services, { lessonDraftId: draft.id, itemRevisionId, role: target.role })
    : regenerateRevisionAsset(services, { draftId: draft.id, itemRevisionId, role: target.role });
}

/** Rezygnacja z ilustracji pozycji w szkicu zestawu słówek. */
export async function omitIllustration(services: Services, rawToken: string, input: unknown): Promise<{ deckId: string; itemId: string }> {
  const { deckId, itemId } = IllustrationOmitInputSchema.parse(input);
  await requireIntegrationScope(services.db, rawToken, MATERIALS_WRITE_SCOPE);
  const draft = await requireDraft(services.db, (await vocabularyDeck(services.db, deckId)).id);
  await omitRevisionAsset(services, { draftId: draft.id, itemRevisionId: await draftRevisionId(services.db, draft.id, itemId) });
  return { deckId, itemId };
}

/** Publikacja szkicu lekcji albo zestawu słówek tymi samymi regułami co w panelu (pokrycie, gotowe media). */
export async function publishMaterial(services: Services, rawToken: string, input: unknown): Promise<{ deckId: string; deckVersionId: string }> {
  const { deckId, expectedEditNumber } = MaterialPublishInputSchema.parse(input);
  await requireIntegrationScope(services.db, rawToken, MATERIALS_PUBLISH_SCOPE);
  const deck = await activeDeck(services.db, deckId);
  const draft = await requireDraft(services.db, deck.id);
  try {
    const { deckVersionId } = deck.kind === "lesson"
      ? await publishLessonDraft(services, draft.id, expectedEditNumber)
      : await publishDraft(services, draft.id, expectedEditNumber);
    return { deckId, deckVersionId };
  } catch (error) {
    // Token publikacji nie czyta treści: z błędów zadań zostają same indeksy, bez komunikatów cytujących zadania.
    const exercises = error instanceof AppError && error.code === "validation" ? (error.details as { exercises?: { index: number }[] } | undefined)?.exercises : undefined;
    if (exercises === undefined) throw error;
    throw new AppError("validation", { details: { exercises: exercises.map(({ index }) => ({ index })) } });
  }
}

/** Wycofanie materiału z nowych sesji; historia zostaje. Panel nie ma operacji odwrotnej. */
export async function archiveMaterial(services: Services, rawToken: string, input: unknown): Promise<{ deckId: string }> {
  const { deckId } = MaterialArchiveInputSchema.parse(input);
  await requireIntegrationScope(services.db, rawToken, MATERIALS_PUBLISH_SCOPE);
  await archiveDeck(services, deckId);
  return { deckId };
}
