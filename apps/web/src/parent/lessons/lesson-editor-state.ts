import type {
  CalculationSpec,
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
  lesson_calculation: "independent",
  lesson_keywords: "guided",
  lesson_match: "guided",
  lesson_group: "guided",
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
  visualSubject: string;
  /** Pola v3 przedmiotów szkolnych (null = ćwiczenie ich nie niesie). */
  questionType: string;
  requiredElements: { id: string; text: string }[] | null;
  supplementaryElements: string[] | null;
  commonErrors: string[] | null;
  expectedForm: string;
  familyId: string;
  calculation?: CalculationSpec;
  sourceRefs: { quote: string; parentAdded?: boolean }[] | null;
  /** `lesson_keywords`: pojęcia do wyboru i identyfikatory kluczowych (null = inny typ). */
  keywordOptions?: { id: string; text: string }[] | null;
  keyOptionIds?: string[] | null;
}

export interface EditableDynamicObjective {
  id: string;
  titlePl: string;
  cards: { title: string; body: string }[];
}

export interface EditableLessonForm {
  title: string;
  exercises: EditableLessonExercise[];
  /** Zagadnienia tematu dynamicznego (null = lekcja katalogowa). */
  dynamicObjectives: EditableDynamicObjective[] | null;
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
  dynamicTopic?: { objectives: EditableDynamicObjective[] };
}

/** Następny wolny identyfikator elementu wymaganego (`e<n>`) — bez kolizji po usunięciach (W11). */
export function nextRequiredElementId(elements: readonly { id: string }[]): string {
  const used = new Set(elements.map((el) => el.id));
  let n = elements.reduce((max, el) => {
    const m = /^e(\d+)$/.exec(el.id);
    return m ? Math.max(max, Number.parseInt(m[1]!, 10)) : max;
  }, 0) + 1;
  while (used.has(`e${n}`)) n += 1;
  return `e${n}`;
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
    acceptedText: exercise.acceptedAnswers.join("\n"),
    focusText: exercise.focus.join(", "),
    options: exercise.options ? exercise.options.map((o) => ({ ...o })) : null,
    correctOption: exercise.correctOption ?? "",
    items: exercise.items ? exercise.items.map((o) => ({ ...o })) : null,
    noticeSegments: exercise.noticeSegments ? exercise.noticeSegments.map((s) => [...s]) : null,
    visualSubject: exercise.visualSubject ?? "",
    questionType: exercise.questionType ?? "",
    requiredElements: exercise.requiredElements ? exercise.requiredElements.map((el) => ({ ...el })) : null,
    supplementaryElements: exercise.supplementaryElements ? [...exercise.supplementaryElements] : null,
    commonErrors: exercise.commonErrors ? [...exercise.commonErrors] : null,
    expectedForm: exercise.expectedForm ?? "",
    familyId: exercise.familyId ?? "",
    ...(exercise.calculation ? { calculation: structuredClone(exercise.calculation) } : {}),
    sourceRefs: exercise.sourceRefs ? exercise.sourceRefs.map((ref) => ({ ...ref })) : null,
    ...(exercise.keywordOptions ? { keywordOptions: exercise.keywordOptions.map((o) => ({ ...o })) } : {}),
    ...(exercise.keyOptionIds ? { keyOptionIds: [...exercise.keyOptionIds] } : {}),
  };
}

/** Odpowiedź `lesson_keywords` liczona z zaznaczonych pojęć (jak w domenie serwera). */
export function keywordsAnswerOf(exercise: Pick<EditableLessonExercise, "keywordOptions" | "keyOptionIds">): string {
  const textById = new Map((exercise.keywordOptions ?? []).map((o) => [o.id, o.text] as const));
  return (exercise.keyOptionIds ?? []).map((id) => textById.get(id) ?? "").join(", ");
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
      dynamicObjectives: draft.dynamicTopic
        ? draft.dynamicTopic.objectives.map((o) => ({ id: o.id, titlePl: o.titlePl, cards: o.cards.map((c) => ({ ...c })) }))
        : null,
    },
  };
}

/**
 * Typy, dla których dane pole payloadu jest znaczące. Serializacja wysyła pole
 * tylko dla jego typów — pusty string nie wycieka do payloadu i nie wywraca
 * `.strict()` kontraktu `LessonExerciseInputSchema`.
 */
const STEM_TYPES: ReadonlySet<LessonExerciseTypeDto> = new Set(["lesson_choice", "lesson_short_answer", "lesson_gap"]);
// `lesson_transform` niesie zdanie do przekształcenia w `statement` (kanoniczne
// pole: kontrakt `kid.ts` lesson_transform ma `statement`, materialize czyta
// `payload.statement`). Serializacja musi wysyłać `statement`, nie `prompt`,
// inaczej PATCH gubi zdanie i materializacja daje pusty `statement`.
const STATEMENT_TYPES: ReadonlySet<LessonExerciseTypeDto> = new Set(["lesson_error_fix", "lesson_transform"]);
const PROMPT_TYPES: ReadonlySet<LessonExerciseTypeDto> = new Set(["lesson_open_answer", "lesson_short_answer", "lesson_calculation"]);
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
    acceptedAnswers: exercise.acceptedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    focus: commaSplit(exercise.focusText),
  };
  if (trimmedInstruction.length > 0) {
    input.instructionPl = trimmedInstruction;
  }
  // lesson_short_answer: edytor pokazuje jedno pole pytania (prompt z fallbackiem
  // na stem) — wysyłamy tylko jedno pole, żeby payload nie niósł dwóch wersji pytania (W13).
  const shortAnswerPromptWins = type === "lesson_short_answer" && exercise.prompt.length > 0;
  if (STEM_TYPES.has(type) && exercise.stem.length > 0 && !shortAnswerPromptWins) {
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
  if (type === "lesson_choice" && exercise.visualSubject.length > 0) {
    input.visualSubject = exercise.visualSubject as LessonExerciseInput["visualSubject"];
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
  if (exercise.questionType.length > 0) {
    input.questionType = exercise.questionType as LessonExerciseInput["questionType"];
  }
  if (exercise.requiredElements) {
    // Porzucony pusty wpis („Dodaj” bez wypełnienia) nie blokuje zapisu całości (W12).
    input.requiredElements = exercise.requiredElements.filter((el) => el.text.trim().length > 0).map((el) => ({ ...el }));
  }
  if (exercise.supplementaryElements) {
    input.supplementaryElements = [...exercise.supplementaryElements];
  }
  if (exercise.commonErrors) {
    input.commonErrors = [...exercise.commonErrors];
  }
  if (exercise.expectedForm.length > 0) {
    input.expectedForm = exercise.expectedForm as LessonExerciseInput["expectedForm"];
  }
  if (exercise.familyId.length > 0) {
    input.familyId = exercise.familyId;
  }
  if (exercise.sourceRefs) {
    input.sourceRefs = exercise.sourceRefs.filter((ref) => ref.quote.trim().length > 0).map((ref) => ({ ...ref }));
  }
  if (exercise.calculation) input.calculation = structuredClone(exercise.calculation);
  if (type === "lesson_keywords") {
    // Odpowiedź, warianty i focus wynikają z zaznaczonych pojęć — rodzic ich nie wpisuje.
    input.keywordOptions = (exercise.keywordOptions ?? []).map((o) => ({ ...o }));
    input.keyOptionIds = [...(exercise.keyOptionIds ?? [])];
    input.answer = keywordsAnswerOf(exercise);
    input.acceptedAnswers = [];
    input.focus = [];
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
    ...(snapshot.form.dynamicObjectives
      ? { dynamicTopic: { objectives: snapshot.form.dynamicObjectives.map((o) => ({ id: o.id, titlePl: o.titlePl, cards: o.cards.filter((c) => c.title.trim().length > 0 || c.body.trim().length > 0).map((c) => ({ ...c })) })) } }
      : {}),
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


/** Applies an API preview only while it still describes this variant. No arithmetic in the client. */
export function applyCalculationPreview(exercise: EditableLessonExercise, requested: CalculationSpec, preview: { prompt: string; answer: string }): EditableLessonExercise {
  return JSON.stringify(exercise.calculation) === JSON.stringify(requested)
    ? { ...exercise, prompt: preview.prompt, answer: preview.answer }
    : exercise;
}

/** Stable groups scoped by objective; ordinary exercises remain separate. */
export function groupCalculationFamilies(exercises: readonly EditableLessonExercise[]): { key: string; familyId: string | null; exercises: EditableLessonExercise[] }[] {
  const groups = new Map<string, { key: string; familyId: string | null; exercises: EditableLessonExercise[] }>();
  for (const exercise of exercises) {
    const familyId = exercise.calculation?.templateFamilyId ?? null;
    const key = familyId ? JSON.stringify([exercise.objectiveId, familyId]) : exercise.clientKey;
    const group = groups.get(key) ?? { key, familyId, exercises: [] };
    group.exercises.push(exercise);
    groups.set(key, group);
  }
  return [...groups.values()];
}
