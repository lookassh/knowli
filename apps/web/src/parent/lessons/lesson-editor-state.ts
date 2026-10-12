import type {
  LessonDraftDto,
  LessonExerciseInput,
  LessonExerciseTypeDto,
} from "@learning/contracts";

/**
 * Czysta logika stanu edytora lekcji (bez Reacta, bez API). Migawka formularza,
 * serializacja do PATCH (`toLessonDraftPatch`), porównanie zmian i grupowanie
 * ćwiczeń po celu i etapie dla przeglądu. Odpowiednik `deck-editor-state.ts`
 * dla słówek — testowany jednostkowo, reużywany przez `LessonEditor`.
 *
 * Mapa typ→etap jest powtórzona tutaj świadomie: pochodzi z domeny
 * (`domain/lessons/stages.ts`), ale panel web nie importuje z serwera. To
 * wyłącznie etykietowanie przeglądu — walidacja i pokrycie liczone są po
 * stronie API (zadanie 11).
 */

export type LessonStage = "intro" | "guided" | "productive" | "independent";

/** Etapy przeglądu w kolejności nauki (intro = prezentacja, reszta oceniana). */
export const LESSON_STAGES: readonly LessonStage[] = ["intro", "guided", "productive", "independent"];

const STAGE_BY_TYPE: Readonly<Record<LessonExerciseTypeDto, LessonStage>> = {
  lesson_card: "intro",
  lesson_notice: "intro",
  lesson_choice: "guided",
  lesson_order: "guided",
  lesson_short_answer: "guided",
  lesson_gap: "productive",
  lesson_error_fix: "productive",
  lesson_transform: "productive",
  lesson_open_answer: "independent",
};

/** Etap ćwiczenia danego typu (prezentacja przeglądu). */
export function stageOfExerciseType(type: LessonExerciseTypeDto): LessonStage {
  return STAGE_BY_TYPE[type];
}

type ExerciseOption = { id: string; text: string };
type ExerciseItem = { id: string; text: string };

/**
 * Edytowalne ćwiczenie: pola payloadu + `acceptedText`/`focusText` jako
 * stringi z przecinkami (jak słówka), by rodzic edytował je w jednym polu.
 * `clientKey` jest stabilny: id istniejącego ćwiczenia albo `local:<klucz>`.
 */
export interface EditableLessonExercise {
  clientKey: string;
  id?: string;
  exerciseType: LessonExerciseTypeDto;
  objectiveId: string;
  instructionPl: string;
  stem: string;
  statement: string;
  prompt: string;
  hint: string;
  transformId: string;
  answer: string;
  acceptedText: string;
  focusText: string;
  options: ExerciseOption[] | null;
  correctOption: string;
  items: ExerciseItem[] | null;
  noticeSegments: string[][] | null;
}

export interface EditableLessonForm {
  title: string;
  exercises: EditableLessonExercise[];
}

export interface LessonEditorSnapshot {
  versionId: string;
  editNumber: number;
  form: EditableLessonForm;
}

/** Patch wysyłany do `PATCH /lesson-drafts/:versionId` (kształt z zadania 11). */
export interface LessonDraftPatch {
  expectedEditNumber: number;
  title?: string;
  exercises?: LessonExerciseInput[];
  examples?: Record<string, string[]>;
}

function commaSplit(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function editableFromExercise(
  exercise: LessonDraftDto["exercises"][number],
  newKey: () => string,
): EditableLessonExercise {
  return {
    clientKey: exercise.id ?? `local:${newKey()}`,
    ...(exercise.id ? { id: exercise.id } : {}),
    exerciseType: exercise.exerciseType,
    objectiveId: exercise.objectiveId,
    instructionPl: exercise.instructionPl ?? "",
    stem: exercise.stem ?? "",
    statement: exercise.statement ?? "",
    prompt: exercise.prompt ?? "",
    hint: exercise.hint ?? "",
    transformId: exercise.transformId ?? "",
    answer: exercise.answer,
    acceptedText: exercise.acceptedAnswers.join(", "),
    focusText: exercise.focus.join(", "),
    options: exercise.options ? exercise.options.map((o) => ({ ...o })) : null,
    correctOption: exercise.correctOption ?? "",
    items: exercise.items ? exercise.items.map((o) => ({ ...o })) : null,
    noticeSegments: exercise.noticeSegments ? exercise.noticeSegments.map((s) => [...s]) : null,
  };
}

/** Migawka formularza z `LessonDraftDto` (szkic lub opublikowana do wglądu). */
export function createLessonSnapshot(
  draft: LessonDraftDto,
  newKey: () => string,
): LessonEditorSnapshot {
  return {
    versionId: draft.id,
    editNumber: draft.editNumber,
    form: {
      title: draft.title,
      exercises: draft.exercises.map((exercise) => editableFromExercise(exercise, newKey)),
    },
  };
}

/**
 * Typy, dla których dane pole payloadu jest znaczące. Serializacja wysyła pole
 * tylko dla jego typów — pusty string nie wycieka do payloadu i nie wywraca
 * `.strict()` kontraktu `LessonExerciseInputSchema`.
 */
const STEM_TYPES: ReadonlySet<LessonExerciseTypeDto> = new Set(["lesson_choice", "lesson_short_answer", "lesson_gap"]);
const STATEMENT_TYPES: ReadonlySet<LessonExerciseTypeDto> = new Set(["lesson_error_fix"]);
const PROMPT_TYPES: ReadonlySet<LessonExerciseTypeDto> = new Set(["lesson_transform", "lesson_open_answer"]);
const OPTION_TYPES: ReadonlySet<LessonExerciseTypeDto> = new Set(["lesson_choice", "lesson_short_answer"]);
const ITEM_TYPES: ReadonlySet<LessonExerciseTypeDto> = new Set(["lesson_order"]);
const NOTICE_TYPES: ReadonlySet<LessonExerciseTypeDto> = new Set(["lesson_notice"]);

function exerciseToInput(exercise: EditableLessonExercise): LessonExerciseInput {
  const type = exercise.exerciseType;
  const trimmedInstruction = exercise.instructionPl.trim();
  const input: LessonExerciseInput = {
    ...(exercise.id ? { id: exercise.id } : {}),
    exerciseType: type,
    objectiveId: exercise.objectiveId,
    answer: exercise.answer,
    acceptedAnswers: commaSplit(exercise.acceptedText),
    focus: commaSplit(exercise.focusText),
  };
  if (trimmedInstruction.length > 0) {
    input.instructionPl = trimmedInstruction;
  }
  if (STEM_TYPES.has(type) && exercise.stem.length > 0) {
    input.stem = exercise.stem;
  }
  if (STATEMENT_TYPES.has(type) && exercise.statement.length > 0) {
    input.statement = exercise.statement;
  }
  if (PROMPT_TYPES.has(type) && exercise.prompt.length > 0) {
    input.prompt = exercise.prompt;
  }
  if (type === "lesson_gap" && exercise.hint.length > 0) {
    input.hint = exercise.hint;
  }
  if (type === "lesson_transform" && exercise.transformId.length > 0) {
    input.transformId = exercise.transformId;
  }
  if (OPTION_TYPES.has(type) && exercise.options) {
    input.options = exercise.options.map((o) => ({ ...o }));
    if (exercise.correctOption.length > 0) {
      input.correctOption = exercise.correctOption;
    }
  }
  if (ITEM_TYPES.has(type) && exercise.items) {
    input.items = exercise.items.map((o) => ({ ...o }));
  }
  if (NOTICE_TYPES.has(type)) {
    if (exercise.noticeSegments) {
      input.noticeSegments = exercise.noticeSegments.map((s) => [...s]);
    }
    if (exercise.correctOption.length > 0) {
      input.correctOption = exercise.correctOption;
    }
  }
  return input;
}

/**
 * Serializuje migawkę do PATCH: `expectedEditNumber` z MIGAWKI (nie z aktualnej
 * zdalnej wersji — optimistic locking), tytuł zawsze, i pełna lista ćwiczeń
 * (serwer nadpisuje całość). Istniejące ćwiczenia zachowują `id`; nowe mają go
 * pominięty, więc serwer tworzy learning_item.
 */
export function toLessonDraftPatch(snapshot: LessonEditorSnapshot): LessonDraftPatch {
  return {
    expectedEditNumber: snapshot.editNumber,
    title: snapshot.form.title.trim(),
    exercises: snapshot.form.exercises.map(exerciseToInput),
  };
}

/** Czy edytowalne ćwiczenie różni się od swojej wersji bazowej (dowolne pole). */
export function lessonExerciseChanged(
  current: EditableLessonExercise,
  base: EditableLessonExercise,
): boolean {
  return JSON.stringify(exerciseToInput(current)) !== JSON.stringify(exerciseToInput(base));
}

export interface StageGroup {
  stage: LessonStage;
  exercises: EditableLessonExercise[];
}

export interface ObjectiveGroup {
  objectiveId: string;
  stages: StageGroup[];
}

/**
 * Grupuje ćwiczenia po celu (w kolejności `objectiveIds`) i po etapie (kolejność
 * `LESSON_STAGES`). Każdy etap jest obecny (także pusty), by przegląd pokazał
 * brakujące etapy. Ćwiczenia celu spoza listy trafiają na koniec pod własnym
 * nagłówkiem (nie powinno się zdarzyć, ale nie gubimy ich po cichu).
 */
export function groupExercisesByObjectiveAndStage(
  exercises: readonly EditableLessonExercise[],
  objectiveIds: readonly string[],
): ObjectiveGroup[] {
  const known = new Set(objectiveIds);
  const extra = exercises
    .map((ex) => ex.objectiveId)
    .filter((id) => !known.has(id));
  const order = [...objectiveIds, ...[...new Set(extra)]];
  return order.map((objectiveId) => ({
    objectiveId,
    stages: LESSON_STAGES.map((stage) => ({
      stage,
      exercises: exercises.filter(
        (ex) => ex.objectiveId === objectiveId && stageOfExerciseType(ex.exerciseType) === stage,
      ),
    })),
  }));
}
