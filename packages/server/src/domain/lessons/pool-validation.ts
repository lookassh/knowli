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

import {
  LessonExerciseInputSchema,
  MAX_KEY_OPTIONS,
  MAX_KEYWORD_OPTIONS,
  MIN_KEY_OPTIONS,
  MIN_KEYWORD_OPTIONS,
} from "@learning/contracts";
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
import { lessonExerciseIdentity } from "./exercise-identity";
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

/** `lesson_notice`: zakres liczby zdań i segmentów-słów na zdanie. */
export const MIN_NOTICE_SENTENCES = 2;
export const MAX_NOTICE_SENTENCES = 3;
export const MIN_NOTICE_SEGMENTS = 1;
export const MAX_NOTICE_SEGMENTS = 15;

/** Maksymalna liczba tokenów odpowiedzi dla `lesson_gap`. */
export const MAX_GAP_ANSWER_TOKENS = 3;

/** Typy tekstowe (wolna odpowiedź dziecka) — wymagają niepustego `focus`. */
const TEXT_TYPES: ReadonlySet<LessonExerciseType> = new Set<LessonExerciseType>([
  "lesson_gap",
  "lesson_error_fix",
  "lesson_transform",
  "lesson_open_answer",
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

/**
 * Czy dwa teksty mają wspólny wariant normalizacji (równoważne odpowiedzi).
 * Eksportowane, by materializacja (`modules/lessons/lesson-materialize.ts`)
 * dopasowywała `correctOption` segmentu `lesson_notice` DOKŁADNIE tak samo jak
 * walidator (`validateNotice`) — jedna semantyka równoważności, bez duplikatu.
 */
export function answersEquivalent(a: string, b: string, normalizer: AnswerNormalizer): boolean {
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
/** Piktogram bodźca (`visualSubject`) jest dozwolony tylko przy wyborze z listy. */
function validateVisualSubject(ex: LessonExerciseDraft, errors: string[]): void {
  if (ex.visualSubject !== undefined && ex.exerciseType !== "lesson_choice") {
    errors.push("visualSubject: piktogram jest dozwolony tylko dla „lesson_choice”");
  }
}

/** Pola v3 obecne w szkicu (nazwy do komunikatu walidacji). */
function v3FieldsPresent(ex: LessonExerciseDraft): string[] {
  const fields: string[] = [];
  if (ex.questionType !== undefined) fields.push("questionType");
  if (ex.requiredElements !== undefined) fields.push("requiredElements");
  if (ex.supplementaryElements !== undefined) fields.push("supplementaryElements");
  if (ex.commonErrors !== undefined) fields.push("commonErrors");
  if (ex.expectedForm !== undefined) fields.push("expectedForm");
  if (ex.familyId !== undefined) fields.push("familyId");
  if (ex.sourceRefs !== undefined) fields.push("sourceRefs");
  if (ex.calculation !== undefined) fields.push("calculation");
  return fields;
}
export function validateLessonExercise(
  ex: LessonExerciseDraft,
  subject: SubjectModule,
  topic: LessonTopic,
): string[] {
  const errors: string[] = [];
  const normalizer = subject.normalizer;
  const shape = LessonExerciseInputSchema.safeParse(ex);
  if (!shape.success) {
    return shape.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code === "too_big" ? `przekracza limit ${issue.maximum}` : issue.code === "too_small" ? `wymagane minimum ${issue.minimum}` : "nieprawidłowy typ lub wartość"}`);
  }

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

  // Payload v3 i dłuższy limit odpowiedzi tylko dla przedmiotów, które je deklarują
  // (gramatyka zachowuje kontrakt v2: odpowiedź i warianty ≤ 120 znaków).
  if (subject.usesV3Payload !== true) {
    for (const field of v3FieldsPresent(ex)) {
      errors.push(`${field}: pole v3 niedozwolone dla przedmiotu „${subject.id}”`);
    }
    if ([...ex.answer].length > MAX_TEXT_LENGTH) {
      errors.push(`answer: przekracza ${MAX_TEXT_LENGTH} znaków`);
    }
    if (ex.acceptedAnswers.some((a) => [...a].length > MAX_TEXT_LENGTH)) {
      errors.push(`acceptedAnswers: przekracza ${MAX_TEXT_LENGTH} znaków`);
    }
  }

  validateVisualSubject(ex, errors);
  if (ex.calculation !== undefined && ex.exerciseType !== "lesson_calculation") {
    errors.push("calculation: parametry są dozwolone tylko dla „lesson_calculation”");
  }
  if ((ex.keywordOptions !== undefined || ex.keyOptionIds !== undefined) && ex.exerciseType !== "lesson_keywords") {
    errors.push("keywordOptions: pojęcia do wyboru są dozwolone tylko dla „lesson_keywords”");
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
      if (!ex.stem?.trim()) errors.push("stem: wymagane zdanie dla „lesson_choice”");
      validateOptions(ex, normalizer, errors);
      break;
    case "lesson_short_answer":
      if (!(ex.prompt ?? ex.stem)?.trim()) errors.push("prompt: wymagane pytanie dla „lesson_short_answer”");
      validateOptions(ex, normalizer, errors);
      break;
    case "lesson_notice":
      validateNotice(ex, normalizer, errors);
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
    case "lesson_open_answer":
      if (!ex.prompt?.trim()) errors.push("prompt: wymagane pytanie dla „lesson_open_answer”");
      break;
    case "lesson_keywords":
      validateKeywords(ex, normalizer, errors);
      break;
    default:
      break;
  }
  void objective;
}

/**
 * `lesson_keywords`: 4–6 unikalnych pojęć, 2–3 kluczowe spośród nich, a
 * `answer` to pojęcia kluczowe złączone „, ” w kolejności `keyOptionIds`
 * (źródło `targetKey`; ocena porównuje wyłącznie identyfikatory).
 */
function validateKeywords(
  ex: LessonExerciseDraft,
  normalizer: AnswerNormalizer,
  errors: string[],
): void {
  const options = ex.keywordOptions ?? [];
  const keyIds = ex.keyOptionIds ?? [];
  if (options.length < MIN_KEYWORD_OPTIONS || options.length > MAX_KEYWORD_OPTIONS) {
    errors.push(`keywordOptions: liczba pojęć (${options.length}) poza zakresem ${MIN_KEYWORD_OPTIONS}–${MAX_KEYWORD_OPTIONS}`);
  }
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    errors.push("keywordOptions: identyfikatory pojęć muszą być unikalne");
  }
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      if (answersEquivalent(options[i]!.text, options[j]!.text, normalizer)) {
        errors.push(`keywordOptions: pojęcie „${options[j]!.text}” powiela „${options[i]!.text}” po normalizacji`);
      }
    }
  }
  if (keyIds.length < MIN_KEY_OPTIONS || keyIds.length > MAX_KEY_OPTIONS) {
    errors.push(`keyOptionIds: liczba pojęć kluczowych (${keyIds.length}) poza zakresem ${MIN_KEY_OPTIONS}–${MAX_KEY_OPTIONS}`);
  }
  if (new Set(keyIds).size !== keyIds.length) {
    errors.push("keyOptionIds: pojęcia kluczowe nie mogą się powtarzać");
  }
  const textById = new Map(options.map((option) => [option.id, option.text] as const));
  if (keyIds.some((id) => !textById.has(id))) {
    errors.push("keyOptionIds: każde pojęcie kluczowe musi być jednym z pojęć do wyboru");
  } else if (keyIds.length > 0 && ex.answer !== keywordsAnswer(ex)) {
    errors.push("answer: musi być listą pojęć kluczowych złączonych „, ”");
  }
  if (keyIds.length >= options.length && options.length > 0) {
    errors.push("keywordOptions: wśród pojęć musi być co najmniej jeden dystraktor");
  }
}

/** Kanoniczna odpowiedź `lesson_keywords`: pojęcia kluczowe złączone „, ”. */
export function keywordsAnswer(ex: Pick<LessonExerciseDraft, "keywordOptions" | "keyOptionIds">): string {
  const textById = new Map((ex.keywordOptions ?? []).map((option) => [option.id, option.text] as const));
  return (ex.keyOptionIds ?? []).map((id) => textById.get(id) ?? "").join(", ");
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

/**
 * `lesson_notice` (design „Typy ćwiczeń i etapy”): payload `noticeSegments`
 * (2–3 zdania, każde 1–15 niepustych segmentów-słów ≤ limitu długości) oraz
 * `correctOption` = słowo do wskazania, równe (po normalizatorze, dowolny
 * wariant) któremuś segmentowi w którymś zdaniu. `options` jest zabronione —
 * wskazanie, nie wybór z listy opcji.
 */
function validateNotice(
  ex: LessonExerciseDraft,
  normalizer: AnswerNormalizer,
  errors: string[],
): void {
  if (ex.options !== undefined) {
    errors.push("options: „lesson_notice” nie używa opcji (wskazanie, nie wybór z listy)");
  }

  const sentences = ex.noticeSegments;
  if (sentences === undefined) {
    errors.push("noticeSegments: wymagane dla „lesson_notice”");
    return;
  }
  if (sentences.length < MIN_NOTICE_SENTENCES || sentences.length > MAX_NOTICE_SENTENCES) {
    errors.push(
      `noticeSegments: liczba zdań (${sentences.length}) poza zakresem ${MIN_NOTICE_SENTENCES}–${MAX_NOTICE_SENTENCES}`,
    );
  }
  for (const sentence of sentences) {
    if (sentence.length < MIN_NOTICE_SEGMENTS || sentence.length > MAX_NOTICE_SEGMENTS) {
      errors.push(
        `noticeSegments: liczba segmentów w zdaniu (${sentence.length}) poza zakresem ${MIN_NOTICE_SEGMENTS}–${MAX_NOTICE_SEGMENTS}`,
      );
    }
    for (const segment of sentence) {
      if (segment.trim() === "") {
        errors.push("noticeSegments: pusty segment");
      } else if ([...segment].length > MAX_TEXT_LENGTH) {
        errors.push(`noticeSegments: segment przekracza ${MAX_TEXT_LENGTH} znaków`);
      }
    }
  }

  if (ex.correctOption === undefined || ex.correctOption.trim() === "") {
    errors.push("correctOption: wymagane dla „lesson_notice” (słowo do wskazania)");
    return;
  }
  const matchesSegment = sentences.some((sentence) =>
    sentence.some((segment) => answersEquivalent(segment, ex.correctOption!, normalizer)),
  );
  if (!matchesSegment) {
    errors.push("correctOption: nie jest równe (po normalizacji) żadnemu segmentowi zdań");
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
  if (!ex.statement?.trim()) {
    errors.push("statement: wymagany dla „lesson_error_fix”");
    return;
  }
  if (answersEquivalent(ex.statement, ex.answer, normalizer)) {
    errors.push("statement: zdanie z błędem jest identyczne z odpowiedzią po normalizacji");
  }
}

function validateTransform(ex: LessonExerciseDraft, topic: LessonTopic, errors: string[]): void {
  if (!ex.statement?.trim()) errors.push("statement: wymagany dla „lesson_transform”");
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
 * Kopia ćwiczenia bez wariantów `acceptedAnswers` redundantnych wobec odpowiedzi
 * kanonicznej (równoważnych po normalizatorze przedmiotu — dokładnie ta sama
 * relacja co reguła `validateAcceptedAnswers`). Generacja porzuca takie warianty
 * przy przyjęciu puli zamiast tracić CAŁE ćwiczenie: odpowiedź kanoniczna jest
 * akceptowana automatycznie, więc wariant równoważny nie zmienia werdyktu
 * deterministycznego. Uwaga: przy skrócie dwuznacznym („She's” → is|has) wariant
 * dzielący JEDNĄ sekwencję z odpowiedzią niesie też dodatkowe sekwencje — taki
 * wpis i tak nigdy nie mógł zostać zapisany (reguła walidacji odrzucałaby całe
 * ćwiczenie), więc porzucenie go jest ściśle lepsze od utraty ćwiczenia
 * (incydent prod 2026-10-26: przeczenia „to be” traciły wszystkie ćwiczenia
 * samodzielne, bo model konsekwentnie podawał wariant skrótowy — „They're not…”
 * przy odpowiedzi „They aren't…”). Walidacja pozostaje egzekwatorem przy edycji
 * i publikacji. Ćwiczenie bez wariantów redundantnych zwracane bez kopii.
 */
export function withoutRedundantAcceptedVariants(
  ex: LessonExerciseDraft,
  normalizer: AnswerNormalizer,
): LessonExerciseDraft {
  if (ex.acceptedAnswers.length === 0) return ex;
  const kept = ex.acceptedAnswers.filter((variant) => !answersEquivalent(variant, ex.answer, normalizer));
  return kept.length === ex.acceptedAnswers.length ? ex : { ...ex, acceptedAnswers: kept };
}

/**
 * Grupuje INDEKSY odpowiedzi mających wspólny wariant znormalizowanej odpowiedzi
 * kanonicznej. Pierwszy element każdej grupy to pierwsze wystąpienie, kolejne —
 * duplikaty. Relacja „wspólny wariant” nie jest przechodnia, więc grupujemy
 * zachłannie: pierwszy niezgrupowany element zakłada grupę, kolejne równoważne
 * mu dołączają. Deterministyczne (kolejność wejścia). Jedna implementacja
 * wykrywania duplikatów — używana przez `findDuplicateAnswers` i `validatePool`.
 */
function groupEquivalentAnswers(
  answers: readonly string[],
  normalizer: AnswerNormalizer,
): number[][] {
  const grouped = new Array<boolean>(answers.length).fill(false);
  const groups: number[][] = [];

  for (let i = 0; i < answers.length; i++) {
    if (grouped[i]) {
      continue;
    }
    const group: number[] = [i];
    for (let j = i + 1; j < answers.length; j++) {
      if (grouped[j]) {
        continue;
      }
      if (answersEquivalent(answers[i]!, answers[j]!, normalizer)) {
        grouped[j] = true;
        group.push(j);
      }
    }
    if (group.length > 1) {
      grouped[i] = true;
      groups.push(group);
    }
  }
  return groups;
}

/**
 * Grupy ćwiczeń o wspólnym wariancie znormalizowanej odpowiedzi kanonicznej.
 * Każda grupa to lista odpowiedzi (surowych) uznanych za duplikaty; grupa ma
 * ≥ 2 elementy. Deterministyczne (kolejność wejścia).
 */
export function findDuplicateAnswers(
  exercises: readonly LessonExerciseDraft[],
  subject: SubjectModule,
): string[][] {
  const answers = exercises.map((ex) => ex.answer);
  return groupEquivalentAnswers(answers, subject.normalizer).map((group) =>
    group.map((index) => answers[index]!),
  );
}

/** Wynik walidacji puli: ćwiczenia poprawne i odrzucone z powodami. */
export interface PoolValidationResult {
  readonly valid: LessonExerciseDraft[];
  readonly rejected: { exercise: LessonExerciseDraft; errors: string[] }[];
}

/**
 * Waliduje całą pulę. Najpierw reguły pojedynczego ćwiczenia; następnie
 * duplikaty znormalizowanych odpowiedzi (ta sama implementacja co
 * `findDuplicateAnswers`, przez `groupEquivalentAnswers`) — przy duplikacie
 * zachowuje PIERWSZE poprawne wystąpienie, kolejne odrzuca. Deterministyczne
 * (kolejność wejścia).
 */
export function validatePool(
  exercises: readonly LessonExerciseDraft[],
  subject: SubjectModule,
  topic: LessonTopic,
): PoolValidationResult {
  const rejected: { exercise: LessonExerciseDraft; errors: string[] }[] = [];

  // Faza 1: reguły pojedynczego ćwiczenia. Zachowujemy pozycje w `exercises`,
  // by faza 2 mogła wskazać PIERWSZE poprawne wystąpienie każdej odpowiedzi.
  const singleValid: { exercise: LessonExerciseDraft; index: number }[] = [];
  exercises.forEach((exercise, index) => {
    const errors = validateLessonExercise(exercise, subject, topic);
    if (errors.length > 0) {
      rejected.push({ exercise, errors });
    } else {
      singleValid.push({ exercise, index });
    }
  });

  // Różne przedmioty mogą potrzebować tożsamości zadania zamiast odpowiedzi.
  // To nie zmienia target_key ani kwalifikacji ujawnienia odpowiedzi.
  if (subject.poolDeduplication === "exercise") {
    const seen = new Set<string>();
    const valid: LessonExerciseDraft[] = [];
    for (const { exercise } of singleValid) {
      const identity = lessonExerciseIdentity(exercise);
      if (seen.has(identity)) {
        rejected.push({ exercise, errors: ["stimulus: zduplikowany bodziec ćwiczenia w tej samej regule"] });
      } else {
        seen.add(identity);
        valid.push(exercise);
      }
    }
    return { valid, rejected };
  }

  // Domyślna polityka: niejęzykowe przedmioty zachowują unikalność odpowiedzi.
  const answers = singleValid.map((entry) => entry.exercise.answer);
  const duplicateLaterPositions = new Set<number>();
  for (const group of groupEquivalentAnswers(answers, subject.normalizer)) {
    for (let k = 1; k < group.length; k++) {
      duplicateLaterPositions.add(group[k]!);
    }
  }

  const valid: LessonExerciseDraft[] = [];
  singleValid.forEach((entry, position) => {
    if (duplicateLaterPositions.has(position)) {
      const firstPosition = findFirstGroupPosition(answers, position, subject.normalizer);
      const keptAnswer = firstPosition === -1 ? entry.exercise.answer : answers[firstPosition]!;
      rejected.push({
        exercise: entry.exercise,
        errors: [`answer: duplikat odpowiedzi „${keptAnswer}” już obecnej w puli`],
      });
    } else {
      valid.push(entry.exercise);
    }
  });

  return { valid, rejected };
}

/** Pozycja pierwszego wystąpienia równoważnego `answers[position]` przed nią. */
function findFirstGroupPosition(
  answers: readonly string[],
  position: number,
  normalizer: AnswerNormalizer,
): number {
  for (let i = 0; i < position; i++) {
    if (answersEquivalent(answers[i]!, answers[position]!, normalizer)) {
      return i;
    }
  }
  return -1;
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
      // Słowa kluczowe są dodatkiem trenera precyzji, nie pokrywają minimum etapu.
      const actual = forObjective.filter((ex) => ex.exerciseType !== "lesson_keywords" && stageOf(ex.exerciseType) === stage).length;
      if (actual < required) {
        gaps.push({ objectiveId, stage, required, actual });
      }
    }
  }
  return gaps;
}
