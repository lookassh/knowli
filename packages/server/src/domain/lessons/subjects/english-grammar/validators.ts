import type { LessonExerciseDraft, LessonTopic } from "../../types";
import { normalizeTokens } from "../../normalize";
import { listenChoiceSibilantErrors } from "../english/listen-audibility";
import { englishNormalizer } from "../english/normalizer";
import {
  BE_ADVERBS,
  BE_AFFIRMATIVE_CONTRACTIONS,
  BE_CONTRACTED_TOKENS,
  BE_FORM_BY_SUBJECT,
  BE_FORMS,
  beAnswerPronounAllowed,
  bePronounNearGap,
  beStemContext,
  checkBePolarity,
  expectedBeFormNearGap,
  parseBeGapAnswer,
} from "./be-agreement";
import { isAcceptablePresentSimpleAnswer, presentSimpleForms } from "./present-simple-forms";

/**
 * Reguły walidacji specyficzne dla przedmiotu `english_grammar`
 * (design „Generowanie puli” → `subject.validateExercise`). Czysta funkcja:
 * bez bazy, sieci i zegara. Komunikaty po polsku, jak w `catalog-validation.ts`.
 *
 * Zakres (YAGNI): dla `lesson_gap` z podpowiedzią będącą bezokolicznikiem
 * odpowiedź luki musi być dopuszczalną formą tego czasownika w Present Simple.
 * Dla innych typów brak dodatkowych reguł. NIE implementujemy ogólnej
 * morfologii angielskiej — tylko reguły Present Simple z deklaratywną tabelą
 * wyjątków.
 */

function equivalentText(a: string, b: string): boolean {
  const keys = new Set(englishNormalizer.normalize(a).map((tokens) => tokens.join("\u0000")));
  return englishNormalizer.normalize(b).some((tokens) => keys.has(tokens.join("\u0000")));
}

function operatorAnswer(answer: string): { operator: "do" | "does"; negative: boolean } | null {
  const tokens = normalizeTokens(answer);
  if (tokens.length === 1 && (tokens[0] === "do" || tokens[0] === "does")) {
    return { operator: tokens[0], negative: false };
  }
  if (tokens.length === 1 && (tokens[0] === "don't" || tokens[0] === "doesn't")) {
    return { operator: tokens[0] === "don't" ? "do" : "does", negative: true };
  }
  if (tokens.length === 2 && (tokens[0] === "do" || tokens[0] === "does") && tokens[1] === "not") {
    return { operator: tokens[0], negative: true };
  }
  return null;
}

function objectiveAllowsOperator(objectiveId: string, negative: boolean): boolean {
  const objective = objectiveId.split(".").at(-1);
  if (objective === "question") return !negative;
  if (objective === "negative") return negative;
  return objective === "short_answers" || objective === "base_form_after_does";
}

function operatorMatchesSubject(stem: string, operator: "do" | "does"): boolean {
  const [before = "", after = ""] = stem.split("___", 2);
  const nearby = [...normalizeTokens(before).reverse(), ...normalizeTokens(after)];
  const pronoun = nearby.find((token) => ["i", "you", "we", "they", "he", "she", "it"].includes(token));
  if (!pronoun) return true;
  return ["he", "she", "it"].includes(pronoun) ? operator === "does" : operator === "do";
}

function hasBaseVerbAfterGap(stem: string, hint?: string): boolean {
  const after = normalizeTokens(stem.split("___", 2)[1] ?? "");
  if (["i", "you", "we", "they", "he", "she", "it"].includes(after[0] ?? "")) after.shift();
  const verb = after[0];
  if (!verb) return false;
  if (hint?.toLowerCase() === "do") {
    const candidates = verb.endsWith("ies") ? [`${verb.slice(0, -3)}y`]
      : verb.endsWith("es") ? [verb.slice(0, -2)]
        : verb.endsWith("s") ? [verb.slice(0, -1)] : [];
    return !candidates.some((candidate) => candidate !== verb && presentSimpleForms(candidate).has(verb));
  }
  if (hint) return verb === hint.toLowerCase();
  const candidates = verb.endsWith("ies") ? [`${verb.slice(0, -3)}y`]
    : verb.endsWith("es") ? [verb.slice(0, -2)]
      : verb.endsWith("s") ? [verb.slice(0, -1)] : [];
  return !candidates.some((candidate) => candidate !== verb && presentSimpleForms(candidate).has(verb));
}

/**
 * Walidator ćwiczeń przedmiotu. Zwraca listę błędów po polsku (pusta = poprawne).
 */

/**
 * Reguła luki tematu „to be”: odpowiedź (i każdy wariant) musi być formą
 * am/is/are zgodną z podmiotem przy luce i biegunowością celu. Samo „not”
 * jest poprawne tylko dla celu przeczeń (forma stoi już w zdaniu).
 */
function validateBeGapAnswer(ex: LessonExerciseDraft, answer: string, field: string, errors: string[]): void {
  const objective = ex.objectiveId.split(".").at(-1) ?? "";
  const stemCtx = beStemContext(ex.stem);
  if (normalizeTokens(answer).join(" ") === "not") {
    if (objective !== "negative_forms") {
      errors.push(`${field}: odpowiedź „${answer}” nie jest formą czasownika „be” w temacie „to be”`);
    }
    return;
  }
  const lastBeforeGap = ex.stem === undefined
    ? undefined
    : normalizeTokens(ex.stem.split("___", 2)[0] ?? "").at(-1);
  if (lastBeforeGap !== undefined && BE_ADVERBS.has(lastBeforeGap)) {
    errors.push(`${field}: przysłówek „${lastBeforeGap}” stoi po am/is/are (She is always happy), nie przed luką`);
  }
  const parsed = parseBeGapAnswer(answer);
  if (parsed === null) {
    errors.push(`${field}: odpowiedź „${answer}” nie jest formą czasownika „be” (am, is, are)`);
    return;
  }
  if (parsed.pronoun !== undefined && BE_FORM_BY_SUBJECT[parsed.pronoun] !== parsed.form) {
    errors.push(`${field}: forma „${parsed.form}” nie pasuje do osoby „${parsed.pronoun}” ze skrótu`);
  }
  if (objective === "short_answers" && !parsed.negative) {
    const rawLast = normalizeTokens(answer).at(-1);
    if (rawLast !== undefined && BE_AFFIRMATIVE_CONTRACTIONS.has(rawLast)) {
      errors.push(`${field}: krótka odpowiedź twierdząca nie może kończyć się skrótem „${rawLast}” — zapisz pełną formę (Yes, I am)`);
    }
  }
  const stemPronoun = ex.stem === undefined ? undefined : bePronounNearGap(ex.stem);
  if (parsed.pronoun !== undefined && stemPronoun !== undefined && !beAnswerPronounAllowed(parsed.pronoun, stemPronoun)) {
    errors.push(`${field}: osoba „${parsed.pronoun}” w odpowiedzi nie pasuje do podmiotu „${stemPronoun.pronoun}”`);
  }
  const expected = ex.stem === undefined ? undefined : expectedBeFormNearGap(ex.stem);
  if (expected !== undefined && expected !== parsed.form) {
    errors.push(`${field}: forma „${parsed.form}” nie pasuje do podmiotu (poprawnie: ${expected})`);
  }
  checkBePolarity(objective, parsed.negative || stemCtx.negative, parsed.marker ?? stemCtx.marker, field, errors);
}

/**
 * Reguła odpowiedzi tekstowych tematu „to be” poza luką: zgodność osoby z
 * formą w pełnym zdaniu (z podmiotami złożonymi), brak do/does oraz
 * biegunowość celu — przy przekształceniu biegunowość celu wyznacza
 * przekształcenie (to_negative/to_affirmative), nie reguła ćwiczenia.
 * Forma będąca odpowiedzią na bodziec z luką (wybór odpowiedzi) jest
 * sprawdzana względem podmiotu w bodźcu.
 */
function validateBeAnswerText(ex: LessonExerciseDraft, answer: string, field: string, errors: string[]): void {
  const objective = ex.objectiveId.split(".").at(-1) ?? "";
  const tokens = normalizeTokens(answer).flatMap((token) => BE_CONTRACTED_TOKENS[token] ?? [token]);
  if (tokens.includes("do") || tokens.includes("does")) {
    errors.push(`${field}: zdanie z „to be” nie używa „do/does”`);
    return;
  }
  if (objective === "short_answers") {
    // Twierdząca krótka odpowiedź nie może kończyć się samym skrótem (Yes, I'm. jest błędem);
    // przeczenie No, I'm not. jest poprawne, bo po skrócie stoi „not”.
    const rawLast = normalizeTokens(answer).at(-1);
    if (rawLast !== undefined && BE_AFFIRMATIVE_CONTRACTIONS.has(rawLast)) {
      errors.push(`${field}: krótka odpowiedź twierdząca nie może kończyć się skrótem „${rawLast}” — zapisz pełną formę (Yes, I am)`);
      return;
    }
    // Na pytanie o „you” odpowiada się o sobie („I”), nie z perspektywy pytającego.
    const questionTokens = normalizeTokens(ex.prompt ?? ex.stem ?? "");
    const asksAboutYou = BE_FORMS.has(questionTokens[0] ?? "") && questionTokens[1] === "you";
    if (asksAboutYou && tokens.includes("you")) {
      errors.push(`${field}: po pytaniu o „you” odpowiedź musi używać osoby „I” (Yes, I am)`);
      return;
    }
  }
  const gapContext = ex.stem ?? ex.prompt ?? ex.statement;
  if (gapContext !== undefined && gapContext.includes("___")) {
    // Odpowiedź na bodziec z luką (wybór, krótka odpowiedź) może być wielotokenowa
    // (isn't, am not) — sprawdzamy ją tym samym parserem co odpowiedź luki.
    const parsed = parseBeGapAnswer(answer);
    if (parsed !== null) {
      if (parsed.pronoun !== undefined && BE_FORM_BY_SUBJECT[parsed.pronoun] !== parsed.form) {
        errors.push(`${field}: forma „${parsed.form}” nie pasuje do osoby „${parsed.pronoun}” ze skrótu`);
      }
      const stemPronoun = bePronounNearGap(gapContext);
      if (parsed.pronoun !== undefined && stemPronoun !== undefined && !beAnswerPronounAllowed(parsed.pronoun, stemPronoun)) {
        errors.push(`${field}: osoba „${parsed.pronoun}” w odpowiedzi nie pasuje do podmiotu „${stemPronoun.pronoun}”`);
      }
      const expected = expectedBeFormNearGap(gapContext);
      if (expected !== undefined && expected !== parsed.form) {
        errors.push(`${field}: forma „${parsed.form}” nie pasuje do podmiotu (poprawnie: ${expected})`);
      }
      const stemCtx = beStemContext(gapContext);
      checkBePolarity(objective, parsed.negative || stemCtx.negative, parsed.marker ?? stemCtx.marker, field, errors);
      return;
    }
  }
  const firstBeIndex = tokens.findIndex((token) => BE_FORMS.has(token));
  let hasBe = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const next = tokens[i + 1];
    if (next === undefined) continue;
    if (Object.hasOwn(BE_FORM_BY_SUBJECT, token) && BE_FORMS.has(next)) {
      hasBe = true;
      // Podmiot złożony przed pierwszym orzeczeniem: „Tom and I are” — forma to are.
      const compoundSubject = tokens[i - 1] === "and" && firstBeIndex === i + 1;
      const expected = compoundSubject ? "are" : BE_FORM_BY_SUBJECT[token];
      if (expected !== next) {
        errors.push(`${field}: forma „${next}” nie pasuje do osoby „${token}” (poprawnie: ${expected})`);
      }
    }
    if (BE_FORMS.has(token) && Object.hasOwn(BE_FORM_BY_SUBJECT, next)) {
      hasBe = true;
      // Podmiot złożony po inwersji: „Are he and Tom” — forma też musi być are.
      const compoundSubject = tokens[i + 2] === "and";
      const expected = compoundSubject ? "are" : BE_FORM_BY_SUBJECT[next];
      if (expected !== token) {
        errors.push(`${field}: forma „${token}” nie pasuje do osoby „${next}” (poprawnie: ${expected})`);
      }
    }
  }
  if (!hasBe) return;
  const marker = tokens[0] === "yes" || tokens[0] === "no" ? tokens[0] : undefined;
  const polarityObjective = ex.transformId === "to_affirmative"
    ? "affirmative_forms"
    : ex.transformId === "to_negative"
      ? "negative_forms"
      : ex.transformId === "to_question"
        ? ""
        : objective;
  checkBePolarity(polarityObjective, tokens.includes("not"), marker, field, errors);
}

/** Zaimek wymagany przez piktogram bodźca obrazkowego (kto jest na obrazku). */
const VISUAL_SUBJECT_PRONOUN: Readonly<Record<string, string>> = {
  boy: "he",
  girl: "she",
  man: "he",
  woman: "she",
  group: "they",
  dog: "it",
};

/**
 * Ćwiczenie z piktogramem: odpowiedź musi zaczynać się zaimkiem osoby z
 * obrazka, a forma „to be” w bodźcu musi zgadzać się z tą osobą.
 */
function validateVisualPronoun(ex: LessonExerciseDraft, errors: string[]): void {
  if (ex.visualSubject === undefined || !Object.hasOwn(VISUAL_SUBJECT_PRONOUN, ex.visualSubject)) return;
  const pronoun = VISUAL_SUBJECT_PRONOUN[ex.visualSubject]!;
  const answerPronoun = normalizeTokens(ex.answer)[0];
  if (answerPronoun !== undefined && Object.hasOwn(BE_FORM_BY_SUBJECT, answerPronoun) && answerPronoun !== pronoun) {
    errors.push(`visualSubject: odpowiedź zaczyna się od „${answerPronoun}”, a obrazek wymaga „${pronoun}”`);
  }
  // Opcja oznaczona jako poprawna musi nieść ten sam zaimek co odpowiedź kanoniczna.
  const correctText = ex.options?.find((option) => option.id === ex.correctOption)?.text;
  const correctPronoun = correctText === undefined ? undefined : normalizeTokens(correctText)[0];
  if (correctPronoun !== undefined && Object.hasOwn(BE_FORM_BY_SUBJECT, correctPronoun) && correctPronoun !== pronoun) {
    errors.push(`visualSubject: opcja poprawna zaczyna się od „${correctPronoun}”, a obrazek wymaga „${pronoun}”`);
  }
  const stemTokens = normalizeTokens(ex.stem ?? "");
  stemTokens.forEach((token, index) => {
    // Podmiotem jest zaimek sąsiadujący z formą „to be” (przed nią albo po niej
    // w pytaniu z inwersją) — zaimki w dopełnieniu („see you”) nie liczą się.
    const next = stemTokens[index + 1];
    const prev = stemTokens[index - 1];
    const isSubject = (next !== undefined && BE_FORMS.has(next)) || (prev !== undefined && BE_FORMS.has(prev));
    if (Object.hasOwn(BE_FORM_BY_SUBJECT, token) && token !== pronoun && isSubject) {
      errors.push(`visualSubject: zaimek „${token}” w bodźcu nie pasuje do obrazka (poprawnie: ${pronoun})`);
    }
  });
  // Zaimek tuż przed luką (tylko gdy luka istnieje; marker ___ znika w tokenizacji).
  const stemRaw = ex.stem ?? "";
  const gapIndex = stemRaw.indexOf("___");
  const beforeGapLast = gapIndex < 0 ? undefined : normalizeTokens(stemRaw.slice(0, gapIndex)).at(-1);
  if (beforeGapLast !== undefined && Object.hasOwn(BE_FORM_BY_SUBJECT, beforeGapLast) && beforeGapLast !== pronoun) {
    errors.push(`visualSubject: zaimek „${beforeGapLast}” w bodźcu nie pasuje do obrazka (poprawnie: ${pronoun})`);
  }
  const expectedForm = BE_FORM_BY_SUBJECT[pronoun]!;
  for (const form of normalizeTokens(ex.stem ?? "").filter((token) => BE_FORMS.has(token))) {
    if (form !== expectedForm) {
      errors.push(`visualSubject: forma „${form}” w bodźcu nie pasuje do osoby z obrazka (poprawnie: ${expectedForm})`);
    }
  }
}

export function validateEnglishGrammarExercise(
  ex: LessonExerciseDraft,
  topic: LessonTopic,
): string[] {
  const errors: string[] = [];

  validateVisualPronoun(ex, errors);
  errors.push(...listenChoiceSibilantErrors(ex));

  if (ex.exerciseType === "lesson_open_answer" && ex.prompt !== undefined) {
    if ([ex.answer, ...ex.acceptedAnswers].some((answer) => equivalentText(ex.prompt!, answer))) {
      errors.push("prompt: bodziec tłumaczenia nie może być równy odpowiedzi ani jej wariantowi");
    }
  }

  if (topic.id === "to_be" && ex.exerciseType === "lesson_gap") {
    const beHint = ex.hint?.trim().toLowerCase() ?? "";
    if (beHint !== "" && beHint !== "be") {
      errors.push("lesson_gap: hint dla tematu „to be” musi mieć wartość „be” albo być pusty");
    }
    validateBeGapAnswer(ex, ex.answer, "lesson_gap", errors);
    for (const variant of ex.acceptedAnswers) validateBeGapAnswer(ex, variant, "acceptedAnswers", errors);
  } else if (topic.id === "to_be" && ex.exerciseType !== "lesson_card" && ex.exerciseType !== "lesson_notice") {
    validateBeAnswerText(ex, ex.answer, "answer", errors);
    for (const variant of ex.acceptedAnswers) validateBeAnswerText(ex, variant, "acceptedAnswers", errors);
  } else if (ex.exerciseType === "lesson_gap") {
    const hint = ex.hint?.trim() ?? "";
    const infinitive = hint ? normalizeTokens(hint)[0] : undefined;
    const operator = operatorAnswer(ex.answer);
    const objective = ex.objectiveId.split(".").at(-1);
    const hasAuxiliaryRules = objective === "question" || objective === "negative" || objective === "short_answers" || objective === "base_form_after_does";
    const operatorOnlyIsValid = operator !== null && ex.stem !== undefined &&
      objectiveAllowsOperator(ex.objectiveId, operator.negative) &&
      operatorMatchesSubject(ex.stem, operator.operator) &&
      (objective === "short_answers" || hasBaseVerbAfterGap(ex.stem, infinitive));
    if (operator !== null && hasAuxiliaryRules && !operatorOnlyIsValid) {
      errors.push("lesson_gap: operator nie pasuje do celu, podmiotu lub formy czasownika");
    } else if (infinitive !== undefined && !operatorOnlyIsValid && !isAcceptablePresentSimpleAnswer(infinitive, ex.answer)) {
      errors.push(
        `lesson_gap: odpowiedź „${ex.answer}” nie jest formą czasownika „${infinitive}” w Present Simple`,
      );
    }
  }

  return errors;
}
