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
/** Formy „to be” po podmiocie (osoba → jedyna poprawna forma). */
const BE_FORM_BY_SUBJECT: Readonly<Record<string, string>> = {
  i: "am",
  he: "is",
  she: "is",
  it: "is",
  you: "are",
  we: "are",
  they: "are",
};

const BE_CONTRACTED_TOKENS: Readonly<Record<string, readonly string[]>> = {
  "i'm": ["i", "am"],
  "you're": ["you", "are"],
  "we're": ["we", "are"],
  "they're": ["they", "are"],
  "he's": ["he", "is"],
  "she's": ["she", "is"],
  "it's": ["it", "is"],
  "isn't": ["is", "not"],
  "aren't": ["are", "not"],
  isnt: ["is", "not"],
  arent: ["are", "not"],
};

/** Rozkłada odpowiedź luki tematu „to be” na formę i biegunowość; null = to nie jest forma „to be”. */
function parseBeGapAnswer(answer: string): { form: string; negative: boolean; marker?: string; pronoun?: string } | null {
  let tokens = normalizeTokens(answer);
  let marker: string | undefined;
  if (tokens[0] === "yes" || tokens[0] === "no") {
    marker = tokens[0];
    tokens = tokens.slice(1);
  }
  const expanded = tokens.flatMap((token) => BE_CONTRACTED_TOKENS[token] ?? [token]);
  const pronoun = expanded[0] !== undefined && Object.hasOwn(BE_FORM_BY_SUBJECT, expanded[0])
    ? expanded[0]
    : undefined;
  const rest = pronoun === undefined ? expanded : expanded.slice(1);
  const [form, ...tail] = rest;
  if (form === undefined || !BE_FORMS.has(form)) {
    return null;
  }
  if (tail.length === 0) return { form, negative: false, marker, pronoun };
  if (tail.length === 1 && tail[0] === "not") return { form, negative: true, marker, pronoun };
  return null;
}

const BE_FORMS: ReadonlySet<string> = new Set(Object.values(BE_FORM_BY_SUBJECT));

const BE_DEMONSTRATIVE_FORM: Readonly<Record<string, string>> = {
  this: "is",
  that: "is",
  these: "are",
  those: "are",
};

const BE_IRREGULAR_PLURALS: ReadonlySet<string> = new Set(["children", "men", "women", "people", "feet", "teeth"]);

/** Czy rzeczownik przy luce wygląda na liczbę mnogą (prosta heurystyka dla materiału dziecięcego). */
function looksPlural(token: string): boolean {
  if (BE_IRREGULAR_PLURALS.has(token)) return true;
  return token.length > 1 && token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us") && !token.endsWith("is") && token !== "news";
}

const BE_DETERMINERS: ReadonlySet<string> = new Set(["the", "a", "an", "my", "his", "her", "its", "our", "your", "their"]);

const BE_WH_WORDS: ReadonlySet<string> = new Set(["what", "where", "when", "who", "whom", "whose", "why", "how"]);

/** Tokeny przed luką, które nie są podmiotem (pytajniki, „there”, spójnik). */
const BE_NON_SUBJECT_BEFORE: ReadonlySet<string> = new Set([...BE_WH_WORDS, "there", "and"]);

/** Tokeny po luce pomijane przy szukaniu podmiotu (określniki i liczebniki słowne). */
const BE_AFTER_SKIP: ReadonlySet<string> = new Set([
  ...BE_DETERMINERS,
  "this", "that", "these", "those",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
]);

/**
 * Zaimek osobowy bezpośrednio przy luce: ostatni token przed luką (zdanie)
 * albo pierwszy po niej (pytanie z inwersją). Tylko sąsiedztwo — zaimek
 * z innej części zdania (np. dopełnienie „for you”) nie jest podmiotem.
 */
function bePronounNearGap(stem: string): string | undefined {
  const [before = "", after = ""] = stem.split("___", 2);
  const prev = normalizeTokens(before).at(-1);
  if (prev !== undefined && Object.hasOwn(BE_FORM_BY_SUBJECT, prev)) return prev;
  const next = normalizeTokens(after)[0];
  if (next !== undefined && Object.hasOwn(BE_FORM_BY_SUBJECT, next)) return next;
  return undefined;
}

/**
 * Forma „to be” wymagana przez podmiot sąsiadujący z luką; undefined = nie
 * da się ustalić (np. po luce jest sam orzecznik „happy”). Kolejność reguł:
 * podmiot złożony z „and” tuż przed luką → are; zaimek/wskazujący przy luce;
 * rzeczownik przed luką w kontekście podmiotu (po określniku albo na
 * początku zdania, nie po pytajniku); rzeczownik po luce, gdy poprzedza go
 * określnik/liczebnik albo sam jest liczbą mnogą. Liczbę rzeczownika daje
 * prosta heurystyka (dog → is, dogs → are). Własności prototypu JS (np.
 * „constructor”) nie są podmiotami — stąd Object.hasOwn zamiast `in`.
 */
function expectedBeFormNearGap(stem: string): string | undefined {
  const [before = "", after = ""] = stem.split("___", 2);
  const beforeTokens = normalizeTokens(before);
  const afterTokens = normalizeTokens(after);
  const prev = beforeTokens.at(-1);
  const prev2 = beforeTokens.at(-2);
  const next = afterTokens[0];
  if (prev !== undefined && prev !== "and" && prev2 === "and") return "are";
  if (prev !== undefined && Object.hasOwn(BE_FORM_BY_SUBJECT, prev)) return BE_FORM_BY_SUBJECT[prev];
  if (prev !== undefined && Object.hasOwn(BE_DEMONSTRATIVE_FORM, prev)) return BE_DEMONSTRATIVE_FORM[prev];
  if (next !== undefined && Object.hasOwn(BE_FORM_BY_SUBJECT, next)) return BE_FORM_BY_SUBJECT[next];
  if (next !== undefined && Object.hasOwn(BE_DEMONSTRATIVE_FORM, next)) return BE_DEMONSTRATIVE_FORM[next];
  if (prev !== undefined && !BE_DETERMINERS.has(prev) && !BE_NON_SUBJECT_BEFORE.has(prev)) {
    const inSubjectContext = beforeTokens.length === 1 || (prev2 !== undefined && !BE_WH_WORDS.has(prev2));
    if (inSubjectContext) return looksPlural(prev) ? "are" : "is";
  }
  const afterSubjectIndex = afterTokens.findIndex((token) => !BE_AFTER_SKIP.has(token) && !/^\d+$/.test(token));
  if (afterSubjectIndex >= 0) {
    const nounAfter = afterTokens[afterSubjectIndex]!;
    if (afterSubjectIndex > 0 || looksPlural(nounAfter)) {
      return looksPlural(nounAfter) ? "are" : "is";
    }
  }
  return undefined;
}

/** Czy zdanie-otoczenie luki samo niesie przeczenie albo znacznik Yes/No. */
function beStemContext(stem: string | undefined): { negative: boolean; marker?: string } {
  if (stem === undefined) return { negative: false };
  const tokens = normalizeTokens(stem).flatMap((token) => BE_CONTRACTED_TOKENS[token] ?? [token]);
  return {
    negative: tokens.includes("not"),
    marker: tokens[0] === "yes" || tokens[0] === "no" ? tokens[0] : undefined,
  };
}

function checkBePolarity(
  objective: string,
  effectiveNegative: boolean,
  marker: string | undefined,
  field: string,
  errors: string[],
): void {
  if (marker === "yes" && effectiveNegative) {
    errors.push(`${field}: odpowiedź po „Yes” nie może być przeczeniem`);
  }
  if (marker === "no" && !effectiveNegative) {
    errors.push(`${field}: odpowiedź po „No” musi być przeczeniem`);
  }
  if ((objective === "affirmative_forms" || objective === "contractions") && effectiveNegative) {
    errors.push(`${field}: forma przecząca nie pasuje do celu twierdzącego`);
  }
  if (objective === "negative_forms" && !effectiveNegative) {
    errors.push(`${field}: brak przeczenia (not) wymaganego przez cel`);
  }
}

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
  const parsed = parseBeGapAnswer(answer);
  if (parsed === null) {
    errors.push(`${field}: odpowiedź „${answer}” nie jest formą czasownika „be” (am, is, are)`);
    return;
  }
  if (parsed.pronoun !== undefined && BE_FORM_BY_SUBJECT[parsed.pronoun] !== parsed.form) {
    errors.push(`${field}: forma „${parsed.form}” nie pasuje do osoby „${parsed.pronoun}” ze skrótu`);
  }
  const stemPronoun = ex.stem === undefined ? undefined : bePronounNearGap(ex.stem);
  if (parsed.pronoun !== undefined && stemPronoun !== undefined && parsed.pronoun !== stemPronoun) {
    errors.push(`${field}: osoba „${parsed.pronoun}” w odpowiedzi nie pasuje do podmiotu „${stemPronoun}”`);
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
 * Pojedyncza forma (wybór odpowiedzi) jest sprawdzana względem podmiotu
 * w bodźcu.
 */
function validateBeAnswerText(ex: LessonExerciseDraft, answer: string, field: string, errors: string[]): void {
  const objective = ex.objectiveId.split(".").at(-1) ?? "";
  const tokens = normalizeTokens(answer).flatMap((token) => BE_CONTRACTED_TOKENS[token] ?? [token]);
  if (tokens.includes("do") || tokens.includes("does")) {
    errors.push(`${field}: zdanie z „to be” nie używa „do/does”`);
    return;
  }
  if (tokens.length === 1 && BE_FORMS.has(tokens[0]!)) {
    const context = ex.stem ?? ex.prompt ?? ex.statement;
    if (context !== undefined && context.includes("___")) {
      const expected = expectedBeFormNearGap(context);
      if (expected !== undefined && expected !== tokens[0]) {
        errors.push(`${field}: forma „${tokens[0]}” nie pasuje do podmiotu (poprawnie: ${expected})`);
      }
    }
    return;
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

export function validateEnglishGrammarExercise(
  ex: LessonExerciseDraft,
  topic: LessonTopic,
): string[] {
  const errors: string[] = [];

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
