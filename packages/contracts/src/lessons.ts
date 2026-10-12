import { z } from "zod";
import { InstantSchema, UuidSchema } from "./common";
import { AssignmentDtoSchema, DeckStateSchema, RevisionAssetDtoSchema } from "./decks";
import { GenerationDtoSchema } from "./generation";

/**
 * Kontrakty lekcji (`@learning/contracts`) — publiczne DTO silnika lekcji
 * współdzielone przez web, kid-ui i serwer. Silnik jest subject-agnostyczny:
 * kontrakty znają kształt i limity, nie reguły przedmiotu. Walidacja
 * semantyczna (pokrycie focus, duplikaty, poprawność correctOption) zostaje
 * w domenie (`domain/lessons/pool-validation.ts`). Bez importów z serwera/SDK.
 *
 * Limity są zgodne z nazwanymi stałymi domeny (`pool-validation.ts`):
 * pole tekstowe ≤ 120, acceptedAnswers ≤ 40, opcje 2–4, elementy 3–10,
 * notice 2–3 zdania × 1–15 segmentów.
 */

/** Limity współdzielone z `domain/lessons/pool-validation.ts`. */
const MAX_TEXT_LENGTH = 120;
const MAX_ACCEPTED_ANSWERS = 40;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MIN_ORDER_ITEMS = 3;
const MAX_ORDER_ITEMS = 10;
const MIN_NOTICE_SENTENCES = 2;
const MAX_NOTICE_SENTENCES = 3;
const MIN_NOTICE_SEGMENTS = 1;
const MAX_NOTICE_SEGMENTS = 15;

/** 9 typów ćwiczeń lekcji (design „Typy ćwiczeń i etapy”). */
export const LESSON_EXERCISE_TYPES = [
  "lesson_card",
  "lesson_notice",
  "lesson_choice",
  "lesson_order",
  "lesson_short_answer",
  "lesson_gap",
  "lesson_error_fix",
  "lesson_transform",
  "lesson_open_answer",
] as const;
export type LessonExerciseTypeDto = (typeof LESSON_EXERCISE_TYPES)[number];
export const LessonExerciseTypeSchema = z.enum(LESSON_EXERCISE_TYPES);

const LessonStageSchema = z.enum(["intro", "guided", "productive", "independent"]);

/** Pole tekstowe ćwiczenia (payload „Data Models”): niepuste, ≤ 120 znaków. */
const text = z.string().min(1).max(MAX_TEXT_LENGTH);

/**
 * Katalog przedmiotów do formularza rodzica (design „Przedmiot i katalog”).
 * Tylko tytuły i identyfikatory — bez opisów dla modelu (`descriptionEn`),
 * kart ani puli ćwiczeń. `.strict()` broni przed wyciekiem pól modelowych.
 */
export const SubjectCatalogDtoSchema = z.object({
  subjects: z.array(z.object({
    id: z.string().min(1),
    titlePl: z.string().min(1),
    topics: z.array(z.object({
      id: z.string().min(1),
      version: z.number().int().positive(),
      titlePl: z.string().min(1),
      objectives: z.array(z.object({
        id: z.string().min(1),
        titlePl: z.string().min(1),
      }).strict()),
    }).strict()),
  }).strict()),
}).strict();
export type SubjectCatalogDto = z.infer<typeof SubjectCatalogDtoSchema>;

/**
 * Polecenie utworzenia lekcji (design „Data Models → Kontrakty”). `deckId`
 * opcjonalny dla idempotentnego tworzenia jak `CreateEmptyDeckCommand`;
 * `clientRequestId` jest kluczem idempotencji zlecenia (odwzorowanie wzorca
 * `GenerationCommand`). Limity: material 1–8000 (trim), instruction ≤ 500,
 * poolSize 20–120 (int). Co najmniej jeden unikalny cel.
 */
export const LessonCommandSchema = z.object({
  deckId: UuidSchema.optional(),
  subjectId: z.string().min(1),
  topicId: z.string().min(1),
  objectiveIds: z.array(z.string().min(1)).min(1).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: "objectiveIds must be unique" },
  ),
  material: z.string().trim().min(1).max(8000),
  instruction: z.string().max(500).optional(),
  poolSize: z.number().int().min(20).max(120).optional(),
  clientRequestId: UuidSchema,
}).strict();
export type LessonCommand = z.infer<typeof LessonCommandSchema>;

const ExerciseOptionSchema = z.object({
  id: z.string().min(1),
  text: text,
});

const ExerciseItemSchema = z.object({
  id: z.string().min(1),
  text: text,
});

/**
 * Edycja ćwiczenia przez rodzica (design „Data Models” → payload
 * `lesson_exercise`). Kontrakt sprawdza KSZTAŁT i LIMITY; walidacja semantyczna
 * (focus pokrywa odpowiedź, correctOption ∈ options, duplikaty) zostaje w
 * domenie. `id?` wskazuje istniejący element przy edycji. `.strict()` — żadnych
 * pól spoza payloadu. `noticeSegments`: 2–3 zdania po 1–15 segmentów;
 * `correctOption` dla notice = słowo do wskazania, bez `options`.
 */
export const LessonExerciseInputSchema = z.object({
  id: UuidSchema.optional(),
  exerciseType: LessonExerciseTypeSchema,
  objectiveId: z.string().min(1),
  instructionPl: text.optional(),
  stem: text.optional(),
  statement: text.optional(),
  prompt: text.optional(),
  hint: text.optional(),
  transformId: z.string().min(1).optional(),
  noticeSegments: z.array(
    z.array(text).min(MIN_NOTICE_SEGMENTS).max(MAX_NOTICE_SEGMENTS),
  ).min(MIN_NOTICE_SENTENCES).max(MAX_NOTICE_SENTENCES).optional(),
  answer: z.string().min(1).max(MAX_TEXT_LENGTH),
  acceptedAnswers: z.array(text).max(MAX_ACCEPTED_ANSWERS),
  focus: z.array(z.string().min(1).max(MAX_TEXT_LENGTH)),
  options: z.array(ExerciseOptionSchema).min(MIN_OPTIONS).max(MAX_OPTIONS).optional(),
  correctOption: z.string().min(1).optional(),
  items: z.array(ExerciseItemSchema).min(MIN_ORDER_ITEMS).max(MAX_ORDER_ITEMS).optional(),
}).strict();
export type LessonExerciseInput = z.infer<typeof LessonExerciseInputSchema>;

const LessonExerciseDraftDtoSchema = LessonExerciseInputSchema.extend({
  revisionId: UuidSchema,
});

/** Brak pokrycia publikacyjnego per cel i etap (design „Generowanie puli”). */
export const CoverageGapDtoSchema = z.object({
  objectiveId: z.string().min(1),
  stage: LessonStageSchema,
  required: z.number().int().nonnegative(),
  actual: z.number().int().nonnegative(),
});
export type CoverageGapDto = z.infer<typeof CoverageGapDtoSchema>;

/**
 * Widok szkicu lekcji dla panelu rodzica (design „Data Models → Kontrakty”).
 * `examples` to przykłady z lekcji per cel; `exercises` to zedytowane payloady
 * z `revisionId`; `coverage` wskazuje braki etapów do publikacji.
 */
export const LessonDraftDtoSchema = z.object({
  id: UuidSchema,
  deckId: UuidSchema,
  editNumber: z.number().int().positive(),
  status: z.enum(["draft", "review", "published"]),
  title: z.string(),
  subjectId: z.string().min(1),
  topicId: z.string().min(1),
  topicVersion: z.number().int().positive(),
  objectiveIds: z.array(z.string().min(1)),
  examples: z.record(z.string(), z.array(z.string())),
  exercises: z.array(LessonExerciseDraftDtoSchema),
  assets: z.array(RevisionAssetDtoSchema),
  rejectedCount: z.number().int().nonnegative(),
  coverage: z.array(CoverageGapDtoSchema),
});
export type LessonDraftDto = z.infer<typeof LessonDraftDtoSchema>;

/**
 * Pełny widok zestawu-lekcji dla panelu rodzica (`GET /parent/lessons/:deckId`):
 * edytowalny szkic (lub null), opublikowana wersja (lub null), najnowszy run
 * generacji szkicu i przypisania dzieci — odpowiednik `DeckDto` dla lekcji,
 * z `LessonDraftDto` zamiast `DraftDto`.
 */
export const LessonDeckDtoSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  state: DeckStateSchema,
  draft: LessonDraftDtoSchema.nullable(),
  published: LessonDraftDtoSchema.nullable(),
  generation: GenerationDtoSchema.nullable(),
  assignments: z.array(AssignmentDtoSchema),
});
export type LessonDeckDto = z.infer<typeof LessonDeckDtoSchema>;

/**
 * Szczegóły błędu publikacji przy brakującym pokryciu (409): lista braków per
 * cel i etap. Trafia do `ApiError.details.coverage` (wspólny format błędu §12).
 */
export const LessonCoverageErrorSchema = z.object({
  coverage: z.array(CoverageGapDtoSchema),
});
export type LessonCoverageError = z.infer<typeof LessonCoverageErrorSchema>;

/**
 * Szczegóły błędu edycji ćwiczeń (400): dla każdego niepoprawnego ćwiczenia
 * jego indeks na liście i lista komunikatów walidacji. Trafia do
 * `ApiError.details.exercises`.
 */
export const LessonExerciseErrorsSchema = z.object({
  exercises: z.array(z.object({
    index: z.number().int().nonnegative(),
    errors: z.array(z.string().min(1)),
  })),
});
export type LessonExerciseErrors = z.infer<typeof LessonExerciseErrorsSchema>;

const ObjectiveStatusSchema = z.enum([
  "not_assessed",
  "learning",
  "needs_confirmation",
  "needs_reconfirmation",
  "mastered",
]);

/** Postęp celu dla rodzica (design „Kwalifikacja i projekcja celów”). */
export const ObjectiveProgressDtoSchema = z.object({
  objectiveId: z.string().min(1),
  titlePl: z.string().min(1),
  status: ObjectiveStatusSchema,
  lastIndependentAt: InstantSchema.nullable(),
  nextReviewAt: InstantSchema.nullable(),
  topErrors: z.array(z.object({
    category: z.string().min(1),
    labelPl: z.string().min(1),
    count: z.number().int().nonnegative(),
    examples: z.array(z.string()).max(3),
  })),
});
export type ObjectiveProgressDto = z.infer<typeof ObjectiveProgressDtoSchema>;

/** Decyzja rodzica nad werdyktem modelu (design `lesson_verdicts`). */
export const LessonVerdictDecisionSchema = z.enum([
  "confirmed",
  "overridden_correct",
  "overridden_incorrect",
]);
export type LessonVerdictDecision = z.infer<typeof LessonVerdictDecisionSchema>;

/**
 * Werdykt oceny dowolnej odpowiedzi dla rodzica (design `lesson_verdicts`).
 * `childAnswer` to `normalized_answer` (materiał wspólny, bez kolumn dziecka).
 */
export const LessonVerdictDtoSchema = z.object({
  id: UuidSchema,
  exerciseRevisionId: UuidSchema,
  objectiveId: z.string().min(1),
  childAnswer: z.string(),
  verdict: z.enum(["correct", "almost", "incorrect"]),
  errorCategory: z.string().min(1).nullable(),
  note: z.string(),
  graderModel: z.string().min(1),
  parentDecision: LessonVerdictDecisionSchema.nullable(),
  createdAt: InstantSchema,
});
export type LessonVerdictDto = z.infer<typeof LessonVerdictDtoSchema>;

/** Raport próbnej kartkówki lekcji per cel (design „Testing”, requirements 9.4). */
export const LessonMockTestReportDtoSchema = z.object({
  objectives: z.array(z.object({
    objectiveId: z.string().min(1),
    titlePl: z.string().min(1),
    total: z.number().int().nonnegative(),
    correct: z.number().int().nonnegative(),
    incorrect: z.number().int().nonnegative(),
    unassessed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    modelGraded: z.number().int().nonnegative(),
    errorCategories: z.array(z.object({
      category: z.string().min(1),
      labelPl: z.string().min(1),
      count: z.number().int().nonnegative(),
    })),
  })),
  complete: z.boolean(),
  taskBudget: z.number().int().nonnegative(),
});
export type LessonMockTestReportDto = z.infer<typeof LessonMockTestReportDtoSchema>;
