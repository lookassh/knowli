import { z } from "zod";
import { UuidSchema } from "./common";
import { CoverageGapDtoSchema, LessonExerciseInputSchema, LessonExerciseTypeSchema, LessonStorySchema } from "./lessons";

/**
 * Lekcje pisane przez agenta (narzędzia MCP z zakresem `lessons:write`): wejścia i wyjścia
 * narzędzi `lesson_catalog`, `lesson_validate`, `lesson_draft_create`, `lesson_draft_get`,
 * `lesson_draft_replace` i `lesson_draft_append`. Wyjścia to osobne DTO z listą dozwolonych pól: bez danych dzieci,
 * tematów zdań (`interests`), przypisań, kosztów, kodów runów i modelu oceniającego.
 */

/** Najwięcej zadań w jednym zapisie: każdy zapis zleca płatne nagrania TTS. */
export const LESSON_AUTHORING_MAX_EXERCISES = 150;
/** Limit ciała żądania MCP tokenu `lessons:write`. */
export const LESSON_AUTHORING_MAX_REQUEST_BYTES = 512 * 1024;
/** Zapisy (`lesson_draft_create`, `lesson_draft_replace`, `lesson_draft_append`) na token na godzinę. */
export const LESSON_AUTHORING_WRITES_PER_HOUR = 10;
export const LESSON_AUTHORING_MAX_TITLE_LENGTH = 120;

const ObjectiveIdsSchema = z.array(z.string().min(1)).min(1).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: "objectiveIds must be unique" },
);
/** Przykłady kart: zagadnienie → zdania wstawiane w miejsce `{{examples}}` karty. */
const ExamplesSchema = z.record(z.string().min(1), z.array(z.string().min(1).max(200)).max(20));
const ExercisesSchema = z.array(LessonExerciseInputSchema).min(1).max(LESSON_AUTHORING_MAX_EXERCISES);
/** Nowe zadania bez `id`. */
const NewExercisesSchema = z.array(LessonExerciseInputSchema.omit({ id: true }).strict()).min(1).max(LESSON_AUTHORING_MAX_EXERCISES);
const TitleSchema = z.string().trim().min(1).max(LESSON_AUTHORING_MAX_TITLE_LENGTH);

/**
 * Temat katalogowy (`subjectId` + `topicId`) albo istniejąca lekcja (`deckId`): wtedy zasady tematu
 * przypiętego w lekcji, także złożonego z materiału rodzica, zawężone do jej zagadnień.
 */
export const LessonCatalogInputSchema = z.object({
  subjectId: z.string().min(1).optional(),
  topicId: z.string().min(1).optional(),
  deckId: UuidSchema.optional(),
  /** Tylko te zagadnienia w odpowiedzi (księga reguł jest per zagadnienie i bywa duża); brak = wszystkie. */
  objectiveIds: ObjectiveIdsSchema.optional(),
}).strict();
export type LessonCatalogInput = z.infer<typeof LessonCatalogInputSchema>;

/** Utworzenie szkicu bez generatora; `clientRequestId` staje się `deckId` (powtórka zwraca ten sam zestaw). */
export const LessonDraftCreateInputSchema = z.object({
  clientRequestId: UuidSchema,
  subjectId: z.string().min(1),
  topicId: z.string().min(1),
  /** Kolejność = kolejność wprowadzania zagadnień w sesjach. */
  objectiveIds: ObjectiveIdsSchema,
  material: z.string().trim().min(1).max(8000),
  title: TitleSchema.optional(),
  examples: ExamplesSchema,
  story: LessonStorySchema.optional(),
  exercises: NewExercisesSchema,
}).strict();
export type LessonDraftCreateInput = z.infer<typeof LessonDraftCreateInputSchema>;

/**
 * Walidacja na sucho. Bez `deckId` wymaga `subjectId`, `topicId`, `objectiveIds` i `examples`
 * (jak utworzenie). Z `deckId` temat, zagadnienia, materiał, przykłady i historyjka pochodzą
 * z zestawu (szkic albo wersja opublikowana), a podane `examples`/`story` je zastępują jak w poprawce.
 * `title` jest przyjmowany i pomijany (wejście może być kopią utworzenia albo poprawki); `story: null`
 * = walidacja bez historyjki. `append: true` (tylko z `deckId`): `exercises` to nowe zadania bez `id`
 * dopisywane na koniec zapisanej puli, a indeksy wyniku dotyczą całej puli po dopisaniu (`firstNewIndex`).
 */
export const LessonValidateInputSchema = z.object({
  deckId: UuidSchema.optional(),
  subjectId: z.string().min(1).optional(),
  topicId: z.string().min(1).optional(),
  objectiveIds: ObjectiveIdsSchema.optional(),
  material: z.string().trim().min(1).max(8000).optional(),
  examples: ExamplesSchema.optional(),
  story: LessonStorySchema.nullable().optional(),
  title: TitleSchema.optional(),
  append: z.boolean().optional(),
  exercises: ExercisesSchema,
}).strict();
export type LessonValidateInput = z.infer<typeof LessonValidateInputSchema>;

export const LessonDraftGetInputSchema = z.object({ deckId: UuidSchema }).strict();
export type LessonDraftGetInput = z.infer<typeof LessonDraftGetInputSchema>;

/**
 * Poprawka: pełna lista zadań. Istniejące zadanie niesie `id` z `lesson_draft_get`; zadanie bez `id`
 * to nowy element bez historii dziecka. Bez szkicu `expectedEditNumber` dotyczy wersji opublikowanej.
 */
export const LessonDraftReplaceInputSchema = z.object({
  deckId: UuidSchema,
  expectedEditNumber: z.number().int().positive(),
  exercises: ExercisesSchema,
  examples: ExamplesSchema.optional(),
  /** Obiekt zastępuje historyjkę, `null` ją usuwa, brak pola jej nie zmienia. */
  story: LessonStorySchema.nullable().optional(),
  title: TitleSchema.optional(),
}).strict();
export type LessonDraftReplaceInput = z.infer<typeof LessonDraftReplaceInputSchema>;

/**
 * Dopisanie nowych zadań (bez `id`) na koniec puli bez odsyłania reszty; zapisane zadania zachowują `id`
 * i historię. Walidowana jest cała pula po dopisaniu. Bez szkicu `expectedEditNumber` dotyczy wersji opublikowanej.
 */
export const LessonDraftAppendInputSchema = z.object({
  deckId: UuidSchema,
  expectedEditNumber: z.number().int().positive(),
  exercises: NewExercisesSchema,
}).strict();
export type LessonDraftAppendInput = z.infer<typeof LessonDraftAppendInputSchema>;

/** Złamana reguła zadania (z `LessonRuleIssue`): id reguły, pole, co znaleziono (po angielsku), komunikat rodzica. */
export const AuthoringIssueSchema = z.object({
  rule: z.string().min(1),
  field: z.string(),
  found: z.string().optional(),
  pl: z.string(),
}).strict();
export type AuthoringIssue = z.infer<typeof AuthoringIssueSchema>;

/** Błędy zadania o indeksie `index` w przesłanej tablicy. */
export const AuthoringExerciseIssuesSchema = z.object({
  index: z.number().int().nonnegative(),
  issues: z.array(AuthoringIssueSchema).min(1),
}).strict();
export type AuthoringExerciseIssues = z.infer<typeof AuthoringExerciseIssuesSchema>;

/** Ujawnione rozwiązanie zadania samodzielnego (indeksy w tablicy zadań). */
export const AuthoringExposureLeakSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.enum(["hard", "soft"]),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("card_example"), objectiveId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("exercise"), index: z.number().int().nonnegative() }).strict(),
  ]),
}).strict();
export type AuthoringExposureLeak = z.infer<typeof AuthoringExposureLeakSchema>;

export const LessonValidateResultSchema = z.object({
  /** Utworzenie albo poprawka z tym wejściem przeszłyby walidację (braki pokrycia blokują dopiero publikację). */
  ok: z.boolean(),
  exercises: z.array(AuthoringExerciseIssuesSchema),
  coverage: z.array(CoverageGapDtoSchema),
  exposureLeaks: z.array(AuthoringExposureLeakSchema),
  /** Błędy historyjki (po polsku); pusta lista = poprawna albo brak historyjki. */
  story: z.array(z.string()),
  /** Tylko przy `append: true`: indeks pierwszego nowego zadania w puli po dopisaniu. */
  firstNewIndex: z.number().int().nonnegative().optional(),
}).strict();
export type LessonValidateResult = z.infer<typeof LessonValidateResultSchema>;

export const LessonDraftWriteResultSchema = z.object({
  deckId: UuidSchema,
  draftId: UuidSchema,
  editNumber: z.number().int().positive(),
  coverage: z.array(CoverageGapDtoSchema),
  exposureLeaks: z.array(AuthoringExposureLeakSchema),
}).strict();
export type LessonDraftWriteResult = z.infer<typeof LessonDraftWriteResultSchema>;

/** Wynik dopisania: `exerciseIds` to `id` nowych zadań w kolejności wejścia. */
export const LessonDraftAppendResultSchema = LessonDraftWriteResultSchema.extend({
  exerciseIds: z.array(UuidSchema).min(1),
}).strict();
export type LessonDraftAppendResult = z.infer<typeof LessonDraftAppendResultSchema>;

/** Stan zestawu: szkic, a bez szkicu wersja opublikowana (`status: published`). */
export const LessonAuthoringDraftDtoSchema = z.object({
  deckId: UuidSchema,
  /** Id wersji (szkicu albo opublikowanej). */
  draftId: UuidSchema,
  status: z.enum(["draft", "review", "published"]),
  editNumber: z.number().int().positive(),
  title: z.string(),
  subjectId: z.string().min(1),
  topicId: z.string().min(1),
  topicVersion: z.number().int().positive(),
  objectiveIds: z.array(z.string().min(1)),
  /** Nazwa przedmiotu nadana przez rodzica (lekcje z materiału). */
  subjectTitlePl: z.string().optional(),
  /** Zagadnienia lekcji w kolejności `objectiveIds`: nazwy, karty widoczne dla dziecka i typy zadań dozwolone w zagadnieniu. */
  objectives: z.array(z.object({
    id: z.string().min(1),
    titlePl: z.string(),
    cards: z.array(z.object({ title: z.string(), body: z.string() }).strict()),
    exerciseTypes: z.array(LessonExerciseTypeSchema),
  }).strict()),
  /** Materiał lekcji (tekst rodzica albo materiał podany przy utworzeniu): źródło cytatów `sourceRefs`. */
  material: z.string(),
  examples: z.record(z.string(), z.array(z.string())),
  story: LessonStorySchema.optional(),
  exercises: z.array(LessonExerciseInputSchema.extend({ id: UuidSchema }).strict()),
  coverage: z.array(CoverageGapDtoSchema),
  exposureLeaks: z.array(AuthoringExposureLeakSchema),
}).strict();
export type LessonAuthoringDraftDto = z.infer<typeof LessonAuthoringDraftDtoSchema>;

const RuleLineSchema = z.object({ id: z.string(), text: z.string(), brief: z.literal(true).optional() }).strict();
const RuleBookSchema = z.object({
  general: z.array(RuleLineSchema),
  types: z.array(z.object({
    type: LessonExerciseTypeSchema,
    summary: z.string(),
    example: z.string().optional(),
    subjectRule: z.string().optional(),
    rules: z.array(RuleLineSchema),
  }).strict()),
}).strict();

/** Zasady pisania lekcji tematu — te same, które dostaje generator paczek. */
export const LessonCatalogDtoSchema = z.object({
  subjectId: z.string(),
  subjectTitlePl: z.string(),
  answerLocale: z.string(),
  promptLocale: z.string(),
  topicId: z.string(),
  topicVersion: z.number().int().positive(),
  topicTitlePl: z.string(),
  generationRole: z.string(),
  fieldRules: z.string().optional(),
  typeRules: z.record(z.string(), z.string()).optional(),
  story: z.object({
    enabled: z.boolean(),
    rules: z.string().optional(),
    limits: z.record(z.string(), z.number()),
  }).strict(),
  stageByType: z.record(z.string(), z.string()),
  outsideStagePath: z.array(LessonExerciseTypeSchema),
  advanceAfterCorrect: z.number().int().positive(),
  maxNewObjectivesPerSession: z.number().int().positive(),
  poolMinimums: z.object({ guided: z.number().int(), productive: z.number().int(), independent: z.number().int() }).strict(),
  transforms: z.array(z.object({ id: z.string(), instructionPl: z.string() }).strict()),
  orderingRules: z.array(z.string()),
  limits: z.object({
    maxExercises: z.number().int().positive(),
    maxRequestBytes: z.number().int().positive(),
    writesPerHour: z.number().int().positive(),
  }).strict(),
  objectives: z.array(z.object({
    id: z.string(),
    titlePl: z.string(),
    descriptionEn: z.string(),
    generationNotesEn: z.string().optional(),
    /** Karty widoczne dla dziecka; `{{examples}}` w treści to miejsce na `examples[objectiveId]`. */
    cards: z.array(z.object({ title: z.string(), body: z.string() }).strict()),
    /** Karta ma `{{examples}}`: utworzenie wymaga niepustych `examples[objectiveId]`. */
    examplesRequired: z.boolean(),
    exerciseTypes: z.array(LessonExerciseTypeSchema),
    rules: RuleBookSchema,
  }).strict()),
}).strict();
export type LessonCatalogDto = z.infer<typeof LessonCatalogDtoSchema>;
