import type { LessonExerciseDraft, LessonTopic } from "../../types";
import { normalizeTokens } from "../../normalize";
import { englishNormalizer } from "./normalizer";

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

/** Deklaratywna tabela nieregularnych form 3. osoby / „be”. */
const IRREGULAR_THIRD_PERSON: Readonly<Record<string, readonly string[]>> = {
  have: ["has"],
  be: ["am", "is", "are"],
  do: ["does"],
  go: ["goes"],
};

/** Spółgłoski (do reguły y→ies: spółgłoska + y). */
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/**
 * Dopuszczalne formy czasownika w Present Simple dla danego bezokolicznika:
 * forma podstawowa, 3. osoba (+s / +es / y→ies) oraz wyjątki z tabeli.
 * Zwraca zbiór pojedynczych słów (bez operatora).
 */
function presentSimpleForms(infinitive: string): Set<string> {
  const base = infinitive.toLowerCase();
  const forms = new Set<string>([base]);

  const irregular = IRREGULAR_THIRD_PERSON[base];
  if (irregular) {
    for (const form of irregular) {
      forms.add(form);
    }
    // „be” nie ma regularnej formy +s; „have”/„do”/„go” też używają wyjątku.
    return forms;
  }

  // Regularna 3. osoba.
  const last = base.at(-1) ?? "";
  const prev = base.at(-2) ?? "";
  if (/[sxo]$/.test(base) || base.endsWith("sh") || base.endsWith("ch")) {
    forms.add(`${base}es`); // -s/-sh/-ch/-x/-o → +es
  } else if (last === "y" && !VOWELS.has(prev)) {
    forms.add(`${base.slice(0, -1)}ies`); // spółgłoska + y → +ies
  } else {
    forms.add(`${base}s`);
  }
  return forms;
}

/**
 * Czy odpowiedź luki jest dopuszczalną formą Present Simple podanego czasownika.
 * Akceptuje też formy z operatorem: `does not play`, `doesn't play`, `do not go`.
 */
function isAcceptablePresentSimpleAnswer(infinitive: string, answer: string): boolean {
  const tokens = normalizeTokens(answer);
  if (tokens.length === 0) {
    return false;
  }
  const base = infinitive.toLowerCase();
  const forms = presentSimpleForms(infinitive);

  // Forma prosta: jeden token będący dopuszczalną formą.
  if (tokens.length === 1) {
    return forms.has(tokens[0]!);
  }

  // Forma z operatorem: do/does [not] + forma podstawowa.
  // `doesn't` nie jest tu rozwinięty (normalizacja bazowa go nie rozwija),
  // więc akceptujemy warianty z apostrofem i rozdzielone.
  const operators = ["do", "does", "don't", "doesn't"];
  if (operators.includes(tokens[0]!)) {
    const rest = tokens.slice(1).filter((token) => token !== "not");
    return rest.length === 1 && rest[0] === base;
  }
  return false;
}

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
export function validateEnglishGrammarExercise(
  ex: LessonExerciseDraft,
  _topic: LessonTopic,
): string[] {
  const errors: string[] = [];

  if (ex.exerciseType === "lesson_open_answer" && ex.prompt !== undefined) {
    if ([ex.answer, ...ex.acceptedAnswers].some((answer) => equivalentText(ex.prompt!, answer))) {
      errors.push("prompt: bodziec tłumaczenia nie może być równy odpowiedzi ani jej wariantowi");
    }
  }

  if (ex.exerciseType === "lesson_gap") {
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
