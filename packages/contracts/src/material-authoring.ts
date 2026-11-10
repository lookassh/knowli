import { z } from "zod";
import { UuidSchema, VocabularyFormatSchema } from "./common";
import { DeckStateSchema, VocabularyItemInputSchema } from "./decks";
import { MAX_DECK_ITEMS } from "./limits";
import { SourceMaterialInputSchema, SourceMaterialSummaryDtoSchema } from "./source-materials";

/**
 * Materiały edukacyjne redagowane przez agenta (narzędzia MCP, `docs/integrations/lesson-authoring.md`):
 * lista materiałów, zestawy słówek, źródła i nagrania dla tokenu `materials:write` oraz publikacja
 * i archiwizacja dla tokenu `materials:publish`. Wyjścia to osobne DTO z listą dozwolonych pól:
 * bez dzieci, przypisań, postępów, kosztów i identyfikatorów rewizji.
 */

export const MaterialListInputSchema = z.object({
  /** Fragment tytułu (bez rozróżniania wielkości liter). */
  query: z.string().trim().min(1).max(100).optional(),
  kind: z.enum(["lesson", "vocabulary"]).optional(),
  includeArchived: z.boolean().optional(),
}).strict();
export type MaterialListInput = z.infer<typeof MaterialListInputSchema>;

export const MaterialListResultSchema = z.object({
  materials: z.array(z.object({
    deckId: UuidSchema,
    title: z.string(),
    kind: z.enum(["lesson", "vocabulary"]),
    state: DeckStateSchema,
    /** Liczba pozycji wersji opublikowanej, a bez niej szkicu. */
    itemCount: z.number().int().nonnegative(),
    /** Numer edycji szkicu (`expectedEditNumber` publikacji); `null` = brak szkicu. */
    draftEditNumber: z.number().int().positive().nullable(),
    published: z.boolean(),
  }).strict()),
}).strict();
export type MaterialListResult = z.infer<typeof MaterialListResultSchema>;

export const DeckGetInputSchema = z.object({ deckId: UuidSchema }).strict();

/** Pozycja zestawu słówek z `id` elementu (historia dziecka trzyma się tego `id`). */
const VocabularyDeckItemSchema = VocabularyItemInputSchema.safeExtend({ id: UuidSchema });

/** Stan zestawu słówek: szkic, a bez szkicu wersja opublikowana (`status: published`). */
export const VocabularyDeckDtoSchema = z.object({
  deckId: UuidSchema,
  draftId: UuidSchema,
  status: z.enum(["draft", "review", "published"]),
  editNumber: z.number().int().positive(),
  title: z.string(),
  vocabularyFormat: VocabularyFormatSchema,
  items: z.array(VocabularyDeckItemSchema),
  /** Nagrania i ilustracje pozycji: `failed` można zlecić ponownie przez `recording_regenerate`. */
  recordings: z.array(z.object({
    itemId: UuidSchema,
    role: z.enum(["target_audio", "example_audio", "illustration"]),
    state: z.enum(["pending", "approved", "failed", "omitted"]),
  }).strict()),
}).strict();
export type VocabularyDeckDto = z.infer<typeof VocabularyDeckDtoSchema>;

/** Nowy pusty zestaw słówek (pl-PL → en-GB); `clientRequestId` staje się `deckId`, powtórka zwraca ten sam zestaw. */
export const DeckDraftCreateInputSchema = z.object({
  clientRequestId: UuidSchema,
  title: z.string().trim().min(1).max(200).optional(),
}).strict();

/**
 * Edycja zestawu słówek bez odsyłania całości: pozycja z `id` zastępuje zapisaną (wszystkie pola),
 * pozycja bez `id` jest nowa i trafia na koniec, `remove` usuwa pozycje, reszta zostaje bez zmian.
 * Bez szkicu `expectedEditNumber` dotyczy wersji opublikowanej, a szkic powstaje w tej samej transakcji.
 */
export const DeckDraftEditInputSchema = z.object({
  deckId: UuidSchema,
  expectedEditNumber: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  items: z.array(VocabularyItemInputSchema).min(1).max(MAX_DECK_ITEMS).optional(),
  remove: z.array(UuidSchema).min(1).max(MAX_DECK_ITEMS).optional(),
}).strict();
export type DeckDraftEditInput = z.infer<typeof DeckDraftEditInputSchema>;

export const DeckDraftWriteResultSchema = z.object({
  deckId: UuidSchema,
  draftId: UuidSchema,
  editNumber: z.number().int().positive(),
  /** `id` pozycji z `items` w kolejności wejścia (nowe pozycje dostają nowe `id`). */
  itemIds: z.array(UuidSchema),
}).strict();
export type DeckDraftWriteResult = z.infer<typeof DeckDraftWriteResultSchema>;

export const SourceListInputSchema = z.object({}).strict();
export const SourceListResultSchema = z.object({ sources: z.array(SourceMaterialSummaryDtoSchema) }).strict();
export const SourceGetInputSchema = z.object({ sourceId: UuidSchema }).strict();
export const SourceCreateInputSchema = SourceMaterialInputSchema;
export const SourceCreateResultSchema = z.object({ sourceId: UuidSchema, created: z.boolean() }).strict();
/** Edycja źródła: `expectedRevision` = `revision` z odczytu; co najmniej jedno z `title` / `body`. */
export const SourceUpdateInputSchema = z.object({
  sourceId: UuidSchema,
  expectedRevision: z.number().int().min(1),
  title: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).optional(),
}).strict();

/** Ponowne nagranie (albo ilustracja) w szkicu: pozycja zestawu lub zadanie lekcji, karta zagadnienia, historyjka. */
export const RecordingRegenerateInputSchema = z.object({
  deckId: UuidSchema,
  target: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("item"),
      /** `id` pozycji zestawu słówek albo zadania lekcji. */
      itemId: UuidSchema,
      role: z.enum(["target_audio", "example_audio", "illustration", "prompt_audio", "explanation_audio"]),
    }).strict(),
    z.object({ kind: z.literal("card"), objectiveId: z.string().min(1).max(200), cardIndex: z.number().int().nonnegative() }).strict(),
    z.object({ kind: z.literal("story") }).strict(),
  ]),
}).strict();
export type RecordingRegenerateInput = z.infer<typeof RecordingRegenerateInputSchema>;
export const RecordingRegenerateResultSchema = z.object({ assetId: UuidSchema }).strict();

/** Rezygnacja z ilustracji pozycji zestawu słówek w szkicu. */
export const IllustrationOmitInputSchema = z.object({ deckId: UuidSchema, itemId: UuidSchema }).strict();
export const IllustrationOmitResultSchema = z.object({ deckId: UuidSchema, itemId: UuidSchema }).strict();

/** Publikacja szkicu (token `materials:publish`); `expectedEditNumber` = `draftEditNumber` z listy materiałów. */
export const MaterialPublishInputSchema = z.object({
  deckId: UuidSchema,
  expectedEditNumber: z.number().int().positive(),
}).strict();
export const MaterialPublishResultSchema = z.object({ deckId: UuidSchema, deckVersionId: UuidSchema }).strict();

export const MaterialArchiveInputSchema = z.object({ deckId: UuidSchema }).strict();
export const MaterialArchiveResultSchema = z.object({ deckId: UuidSchema }).strict();
