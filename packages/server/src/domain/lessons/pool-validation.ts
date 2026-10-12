/**
 * Walidacja puli ćwiczeń lekcji (design „Generowanie puli (worker)”). Czysta
 * domena: subject-agnostyczna — reguły ogólne żyją tu, reguły specyficzne dla
 * przedmiotu dokłada `subject.validateExercise`. Bez bazy, sieci i zegara.
 *
 * Walidacja działa jednakowo przy generowaniu puli (worker) i przy edycji
 * ćwiczenia przez rodzica. Komunikaty po polsku (parent-facing), z nazwą pola,
 * spójne stylistycznie z `catalog-validation.ts`. Limity są nazwanymi,
 * eksportowanymi stałymi — żadnych rozsianych literałów.
 */

import { ASSESSED_STAGES, stageOf } from "./stages";
import type {
  AnswerNormalizer,
  LearningObjective,
  LessonExerciseDraft,
  LessonExerciseType,
  LessonStage,
  LessonTopic,
  SubjectModule,
} from "./types";
import type { PoolMinimums } from "./lesson-policy";

/** Znacznik luki w `stem` ćwiczenia `lesson_gap`. */
export const GAP_MARKER = "___";

/** Maksymalna długość pojedynczego pola tekstowego ćwiczenia (znaki). */
export const MAX_TEXT_LENGTH = 120;

/** Maksymalna liczba wariantów `acceptedAnswers`. */
export const MAX_ACCEPTED_ANSWERS = 40;

/** Zakres liczby elementów w `lesson_order`. */
export const MIN_ORDER_ITEMS = 3;
export const MAX_ORDER_ITEMS = 10;

/** Zakres liczby opcji w typach z zamkniętym wyborem. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

/** Maksymalna liczba tokenów odpowiedzi dla `lesson_gap`. */
export const MAX_GAP_ANSWER_TOKENS = 3;

/** Typy tekstowe (wolna odpowiedź dziecka) — wymagają niepustego `focus`. */
const TEXT_TYPES: ReadonlySet<LessonExerciseType> = new Set<LessonExerciseType>([
  "lesson_gap",
  "lesson_error_fix",
  "lesson_transform",
  "lesson_open_answer",
]);

/** Typy z zamkniętym zbiorem opcji. */
const OPTION_TYPES: ReadonlySet<LessonExerciseType> = new Set<LessonExerciseType>([
  "lesson_choice",
  "lesson_short_answer",
  "lesson_notice",
]);

/** Pola tekstowe podlegające limitowi długości (payload „Data Models”). */
const TEXT_FIELDS = ["instructionPl", "stem", "statement", "prompt", "hint"] as const;

/** Klucz wariantu normalizacji (sekwencja tokenów) do porównań zbiorowych. */
function sequenceKey(tokens: readonly string[]): string {
  return tokens.join("\u0000");
}

/** Zbiór kluczy wariantów normalizacji tekstu (dowolny wspólny = równoważność). */
function variantKeys(text: string, normalizer: AnswerNormalizer): Set<string> {
  const keys = new Set<string>();
  for (const sequence of normalizer.normalize(text)) {
    keys.add(sequenceKey(sequence));
  }
  return keys;
}

/** Czy dwa teksty mają wspólny wariant normalizacji (równoważne odpowiedzi). */
function answersEquivalent(a: string, b: string, normalizer: AnswerNormalizer): boolean {
  const keysB = variantKeys(b, normalizer);
  for (const key of variantKeys(a, normalizer)) {
    if (keysB.has(key)) {
      return true;
    }
  }
  return false;
}

/** Czy `needle` jest ciągłą podsekwencją `haystack`. */
function isContiguousSubsequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    let matched = true;
    for (let k = 0; k < needle.length; k++) {
      if (haystack[start + k] !== needle[k]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

/**
 * Czy `focus` jest ciągłą podsekwencją tokenów odpowiedzi kanonicznej w DOWOLNYM
 * wariancie normalizacji — dla któregokolwiek wariantu `focus` i odpowiedzi.
 */
function focusCoversAnswer(
  focus: readonly string[],
  answer: string,
  normalizer: AnswerNormalizer,
): boolean {
  const focusVariants = normalizer.normalize(focus.join(" ")).filter((seq) => seq.length > 0);
  const answerVariants = normalizer.normalize(answer).filter((seq) => seq.length > 0);
  for (const answerSeq of answerVariants) {
    for (const focusSeq of focusVariants) {
      if (isContiguousSubsequence(answerSeq, focusSeq)) {
        return true;
      }
    }
  }
  return false;
}

/** Pierwszy wariant tokenizacji (dla reguł liczących tokeny bez rozwijania). */
function anyTokens(text: string, normalizer: AnswerNormalizer): readonly string[] {
  const variants = normalizer.normalize(text);
  return variants[0] ?? [];
}

/** Liczba wystąpień `GAP_MARKER` w tekście. */
function countGapMarkers(stem: string): number {
  return stem.split(GAP_MARKER).length - 1;
}

/**
 * Reguły ogólne dla ćwiczenia (design „Generowanie puli”), a następnie
 * delegacja do `subject.validateExercise`. Zwraca listę błędów po polsku;
 * pusta lista = ćwiczenie poprawne. Nie rzuca — zbiera wszystkie naruszenia.
 */
export function validateLessonExercise(
  ex: LessonExerciseDraft,
  subject: SubjectModule,
  topic: LessonTopic,
): string[] {
  const errors: string[] = [];
  const normalizer = subject.normalizer;

  // Karta pochodzi z katalogu, nie z puli ćwiczeń.
  if (ex.exerciseType === "lesson_card") {
    errors.push("exerciseType: „lesson_card” nie jest ćwiczeniem puli (karty pochodzą z katalogu)");
  }

  // Cel istnieje w temacie.
  const objective = topic.objectives.find((o) => o.id === ex.objectiveId);
  if (objective === undefined) {
    errors.push(`objectiveId: cel „${ex.objectiveId}” nie istnieje w temacie „${topic.id}”`);
  }

  // Typ dozwolony dla przedmiotu i dla celu.
  if (!subject.exerciseTypes.includes(ex.exerciseType)) {
    errors.push(`exerciseType: typ „${ex.exerciseType}” nie jest wspierany przez przedmiot`);
  }
  if (objective !== undefined && !objective.exerciseTypes.includes(ex.exerciseType)) {
    errors.push(`exerciseType: typ „${ex.exerciseType}” nie jest dozwolony dla celu „${objective.id}”`);
  }

  validateTextFieldLengths(ex, errors);
  validateFocus(ex, normalizer, errors);
  validateByType(ex, topic, objective, normalizer, errors);
  validateAcceptedAnswers(ex, normalizer, errors);

  // Reguły specyficzne dla przedmiotu.
  for (const error of subject.validateExercise(ex, topic)) {
    errors.push(error);
  }

  return errors;
}

function validateTextFieldLengths(ex: LessonExerciseDraft, errors: string[]): void {
  for (const field of TEXT_FIELDS) {
    const value = ex[field];
    if (typeof value === "string" && [...value].length > MAX_TEXT_LENGTH) {
      errors.push(`${field}: przekracza ${MAX_TEXT_LENGTH} znaków`);
    }
  }
}

function validateFocus(
  ex: LessonExerciseDraft,
  normalizer: AnswerNormalizer,
  errors: string[],
): void {
  if (!TEXT_TYPES.has(ex.exerciseType)) {
    return;
  }
  if (ex.focus.length === 0) {
    errors.push("focus: musi być niepusty dla typu tekstowego");
    return;
  }
  if (!focusCoversAnswer(ex.focus, ex.answer, normalizer)) {
    errors.push("focus: nie jest ciągłą podsekwencją tokenów odpowiedzi kanonicznej");
  }
}

function validateByType(
  ex: LessonExerciseDraft,
  topic: LessonTopic,
  objective: LearningObjective | undefined,
  normalizer: AnswerNormalizer,
  errors: string[],
): void {
  switch (ex.exerciseType) {
    case "lesson_order":
      validateOrder(ex, normalizer, errors);
      break;
    case "lesson_choice":
    case "lesson_short_answer":
    case "lesson_notice":
      validateOptions(ex, normalizer, errors);
      break;
    case "lesson_gap":
      validateGap(ex, normalizer, errors);
      break;
    case "lesson_error_fix":
      validateErrorFix(ex, normalizer, errors);
      break;
    case "lesson_transform":
      validateTransform(ex, topic, errors);
      break;
    default:
      break;
  }
  void objective;
}

function validateOrder(
  ex: LessonExerciseDraft,
  normalizer: AnswerNormalizer,
  errors: string[],
): void {
  const items = ex.items ?? [];
  if (items.length < MIN_ORDER_ITEMS || items.length > MAX_ORDER_ITEMS) {
    errors.push(`items: liczba elementów (${items.length}) poza zakresem ${MIN_ORDER_ITEMS}–${MAX_ORDER_ITEMS}`);
  }
  if (items.length > 0) {
    const joined = items.map((item) => item.text).join(" ");
    if (!answersEquivalent(joined, ex.answer, normalizer)) {
      errors.push("items: złączone elementy nie dają odpowiedzi kanonicznej po normalizacji");
    }
  }
}

function validateOptions(
  ex: LessonExerciseDraft,
  normalizer: AnswerNormalizer,
  errors: string[],
): void {
  const options = ex.options ?? [];
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    errors.push(`options: liczba opcji (${options.length}) poza zakresem ${MIN_OPTIONS}–${MAX_OPTIONS}`);
  }
  // Unikalność po normalizacji (dowolny wspólny wariant = duplikat).
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      if (answersEquivalent(options[i]!.text, options[j]!.text, normalizer)) {
        errors.push(`options: opcja „${options[j]!.text}” powiela „${options[i]!.text}” po normalizacji`);
      }
    }
  }
  if (ex.correctOption === undefined || !options.some((option) => option.id === ex.correctOption)) {
    errors.push("correctOption: poprawna opcja nie jest jedną z opcji");
  }
}

function validateGap(
  ex: LessonExerciseDraft,
  normalizer: AnswerNormalizer,
  errors: string[],
): void {
  const markers = ex.stem === undefined ? 0 : countGapMarkers(ex.stem);
  if (markers !== 1) {
    errors.push(`stem: „lesson_gap” wymaga dokładnie jednego znacznika luki „${GAP_MARKER}” (znaleziono ${markers})`);
  }
  const answerTokens = anyTokens(ex.answer, normalizer);
  if (answerTokens.length > MAX_GAP_ANSWER_TOKENS) {
    errors.push(`answer: odpowiedź luki ma więcej niż ${MAX_GAP_ANSWER_TOKENS} tokeny`);
  }
  // Element sprawdzany pokrywa odpowiedź luki: tokeny odpowiedzi ⊆ focus
  // lub odwrotnie (w dowolnym wariancie normalizacji).
  if (ex.focus.length > 0 && !gapFocusCoversAnswer(ex.focus, ex.answer, normalizer)) {
    errors.push("focus: nie pokrywa odpowiedzi luki (ani odpowiedź nie pokrywa focus)");
  }
}

/** Zbiór tokenów we wszystkich wariantach normalizacji tekstu. */
function tokenSet(text: string, normalizer: AnswerNormalizer): Set<string> {
  const set = new Set<string>();
  for (const sequence of normalizer.normalize(text)) {
    for (const token of sequence) {
      set.add(token);
    }
  }
  return set;
}

/** `lesson_gap`: tokeny odpowiedzi ⊆ tokeny focus lub odwrotnie. */
function gapFocusCoversAnswer(
  focus: readonly string[],
  answer: string,
  normalizer: AnswerNormalizer,
): boolean {
  const focusSet = tokenSet(focus.join(" "), normalizer);
  const answerSet = tokenSet(answer, normalizer);
  if (answerSet.size === 0 || focusSet.size === 0) {
    return false;
  }
  const answerSubsetOfFocus = [...answerSet].every((token) => focusSet.has(token));
  const focusSubsetOfAnswer = [...focusSet].every((token) => answerSet.has(token));
  return answerSubsetOfFocus || focusSubsetOfAnswer;
}

function validateErrorFix(
  ex: LessonExerciseDraft,
  normalizer: AnswerNormalizer,
  errors: string[],
): void {
  if (ex.statement === undefined) {
    errors.push("statement: wymagany dla „lesson_error_fix”");
    return;
  }
  if (answersEquivalent(ex.statement, ex.answer, normalizer)) {
    errors.push("statement: zdanie z błędem jest identyczne z odpowiedzią po normalizacji");
  }
}

function validateTransform(ex: LessonExerciseDraft, topic: LessonTopic, errors: string[]): void {
  if (ex.transformId === undefined || !topic.transforms.some((t) => t.id === ex.transformId)) {
    errors.push(`transformId: przekształcenie „${ex.transformId ?? ""}” nie istnieje w temacie „${topic.id}”`);
  }
}

function validateAcceptedAnswers(
  ex: LessonExerciseDraft,
  normalizer: AnswerNormalizer,
  errors: string[],
): void {
  if (ex.acceptedAnswers.length > MAX_ACCEPTED_ANSWERS) {
    errors.push(`acceptedAnswers: więcej niż ${MAX_ACCEPTED_ANSWERS} wariantów`);
  }
  for (const variant of ex.acceptedAnswers) {
    if (variant.trim() === "") {
      errors.push("acceptedAnswers: pusty wariant");
      continue;
    }
    if (answersEquivalent(variant, ex.answer, normalizer)) {
      errors.push(`acceptedAnswers: wariant „${variant}” duplikuje odpowiedź kanoniczną po normalizacji`);
    }
  }
}

/**
 * Grupy ćwiczeń o wspólnym wariancie znormalizowanej odpowiedzi kanonicznej.
 * Każda grupa to lista odpowiedzi (surowych) uznanych za duplikaty; grupa ma
 * ≥ 2 elementy. Relacja „wspólny wariant” nie jest przechodnia, więc grupujemy
 * zachłannie: pierwszy niezgrupowany element zakłada grupę, kolejne równoważne
 * mu dołączają. Deterministyczne (kolejność wejścia).
 */
export function findDuplicateAnswers(
  exercises: readonly LessonExerciseDraft[],
  subject: SubjectModule,
): string[][] {
  const normalizer = subject.normalizer;
  const grouped = new Array<boolean>(exercises.length).fill(false);
  const groups: string[][] = [];

  for (let i = 0; i < exercises.length; i++) {
    if (grouped[i]) {
      continue;
    }
    const group: string[] = [exercises[i]!.answer];
    for (let j = i + 1; j < exercises.length; j++) {
      if (grouped[j]) {
        continue;
      }
      if (answersEquivalent(exercises[i]!.answer, exercises[j]!.answer, normalizer)) {
        grouped[j] = true;
        group.push(exercises[j]!.answer);
      }
    }
    if (group.length > 1) {
      grouped[i] = true;
      groups.push(group);
    }
  }
  return groups;
}

/** Wynik walidacji puli: ćwiczenia poprawne i odrzucone z powodami. */
export interface PoolValidationResult {
  readonly valid: LessonExerciseDraft[];
  readonly rejected: { exercise: LessonExerciseDraft; errors: string[] }[];
}

/**
 * Waliduje całą pulę. Najpierw reguły pojedynczego ćwiczenia; następnie
 * duplikaty znormalizowanych odpowiedzi — przy duplikacie zachowuje PIERWSZE
 * poprawne wystąpienie, kolejne odrzuca. Deterministyczne (kolejność wejścia).
 */
export function validatePool(
  exercises: readonly LessonExerciseDraft[],
  subject: SubjectModule,
  topic: LessonTopic,
): PoolValidationResult {
  const valid: LessonExerciseDraft[] = [];
  const rejected: { exercise: LessonExerciseDraft; errors: string[] }[] = [];
  const normalizer = subject.normalizer;

  for (const exercise of exercises) {
    const errors = validateLessonExercise(exercise, subject, topic);
    if (errors.length > 0) {
      rejected.push({ exercise, errors });
      continue;
    }
    const duplicateOf = valid.find((kept) =>
      answersEquivalent(kept.answer, exercise.answer, normalizer),
    );
    if (duplicateOf !== undefined) {
      rejected.push({
        exercise,
        errors: [`answer: duplikat odpowiedzi „${duplicateOf.answer}” już obecnej w puli`],
      });
      continue;
    }
    valid.push(exercise);
  }

  return { valid, rejected };
}

/** Brak pokrycia: ile ćwiczeń ocenianego etapu brakuje dla danego celu. */
export interface CoverageGap {
  readonly objectiveId: string;
  readonly stage: LessonStage;
  readonly required: number;
  readonly actual: number;
}

/**
 * Pokrycie publikacyjne: dla każdego celu i każdego etapu ocenianego liczy
 * ćwiczenia tego etapu i porównuje z minimum. Zwraca TYLKO braki (pusta tablica
 * = pokrycie spełnione). `lesson_notice` (intro) nie liczy się do żadnego etapu
 * ocenianego. Deterministyczne: kolejność `objectiveIds` × `ASSESSED_STAGES`.
 */
export function poolCoverage(
  exercises: readonly LessonExerciseDraft[],
  objectiveIds: readonly string[],
  minimums: PoolMinimums,
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const objectiveId of objectiveIds) {
    const forObjective = exercises.filter((ex) => ex.objectiveId === objectiveId);
    for (const stage of ASSESSED_STAGES) {
      const required = minimums[stage as keyof PoolMinimums];
      const actual = forObjective.filter(
        (ex) => ex.exerciseType !== "lesson_card" && stageOf(ex.exerciseType) === stage,
      ).length;
      if (actual < required) {
        gaps.push({ objectiveId, stage, required, actual });
      }
    }
  }
  return gaps;
}
