import type { LessonExerciseDraft } from "../../types";
import { normalizeTokens } from "../../normalize";
import {
  baseOfIngForm,
  COLLOCATION_ING_FORMS,
  ingFormOf,
  ingRuleOf,
  isCollocationIngForm,
  isIngFormInTable,
  stateVerbIn,
  type IngRule,
} from "../english/ing-forms";
import {
  BE_ADVERBS,
  BE_AFTER_SKIP,
  BE_CONTRACTED_TOKENS,
  BE_FORM_BY_SUBJECT,
  BE_FORMS,
  BE_WH_WORDS,
  beAnswerPronounAllowed,
  bePronounNearGap,
  beStemContext,
  beSubjectTokensBefore,
  checkBePolarity,
  expectedBeFormNearGap,
  looksPlural,
  TRANSFORM_POLARITY,
  type BePolarity,
} from "./be-agreement";
import { validateErrorFix, validateListenChoiceOptions, validateNotice } from "./present-continuous-exercise-rules";
import {
  CLAUSE_CONJUNCTIONS,
  ingBaseOf,
  isGapQuestion,
  isNowUsuallyChoice,
  SENTENCE_BOUNDARY,
  TENSE_CHOICE_OBJECTIVES,
  TENSE_NAMES,
  tenseChoiceMarkerGroup,
  tenseChoiceShapeErrors,
  tenseSentences,
  tenseTokens,
  validatePresentSimpleFormAnswer,
  validatePresentSimpleGroup,
  validateTenseOfGroups,
  verbGroupsIn,
  type PresentSimpleContext,
  type TenseSentence,
} from "./present-continuous-tense-choice";
import { scanTimeMarkers, type MarkerGroup } from "./time-markers";

/**
 * Reguły tematu Present Continuous (design „Present Continuous” §4–§6).
 * Czysta funkcja nad szkicem ćwiczenia: bez bazy, sieci i zegara. Każdy
 * komunikat zaczyna się stałym prefiksem (`pc-marker:`, `pc-ing:`, `pc-be:`,
 * `pc-state:`, `pc-error-fix:`, `pc-notice:`, `pc-shape:`) — sonda liczy po nim
 * odrzucenia (§8), dalej tekst po polsku dla rodzica.
 */

/** Klasy pisowni -ing dozwolone w sprawdzanym miejscu celu (§4). */
export const PC_ALLOWED_ING_RULES: Readonly<Record<string, readonly IngRule[]>> = {
  affirmative: ["plain"],
  now_or_usually: ["plain"],
  negative: ["plain"],
  questions: ["plain"],
  ing_spelling: ["drop_e", "double", "ie_to_y"],
  now_or_usually_more: ["plain", "drop_e", "double", "ie_to_y"],
};

/** Biegunowość formy be wymagana przez cel; przekształcenie ma pierwszeństwo (§6.2). */
export const PC_POLARITY: Readonly<Record<string, BePolarity>> = {
  affirmative: "affirmative",
  now_or_usually: "affirmative",
  negative: "negative",
  questions: "any",
  ing_spelling: "affirmative",
  now_or_usually_more: "any",
};

/** Cele z luką na samą formę be („___ she reading?”, §6.2). */
const BE_GAP_OBJECTIVES: ReadonlySet<string> = new Set(["affirmative", "negative", "questions"]);

/** Cele, w których nawias luki z czasownikiem musi zawierać „not” (§6.2); w pozostałych „not” jest zakazane. */
const NEGATED_VERB_GAP_OBJECTIVES: ReadonlySet<string> = new Set(["negative", "now_or_usually_more"]);

/** Cele, w których odpowiedź luki z czasownikiem to am/is/are [not] + -ing (cele porównania — `validateTenseChoice`). */
const BE_ING_GAP_OBJECTIVES: ReadonlySet<string> = new Set(["affirmative", "negative", "questions", "ing_spelling"]);

/**
 * Nawias z czasownikiem tuż po luce. Silnik ma własną kopię wzorca
 * (`feedback-sentence-text.ts`, design §6.7), bo `domain/lessons` nie importuje
 * przedmiotów — zmieniaj oba miejsca razem.
 */
const GAP_VERB = /_{2,}\s*\(([^)]*)\)/;

const LEADING_APOSTROPHE = /^['’‘ʼ´`]/;

// Bliźniak: `withoutGapVerb` w `domain/lessons/feedback-sentence-text.ts` (domena lekcji nie importuje przedmiotów).
/**
 * Usuwa „(verb)” / „(not verb)” stojące tuż po luce. Zwraca bodziec z samą
 * luką, czasownik z nawiasu (małe litery, bez „not”) i flagę przeczenia.
 * Nawias w innym miejscu zdania zostaje w bodźcu.
 */
export function stripGapVerb(stem: string): { stem: string; verb?: string; negative: boolean } {
  const match = GAP_VERB.exec(stem);
  if (match === null) return { stem, negative: false };
  const tokens = normalizeTokens(match[1] ?? "");
  const negative = tokens[0] === "not";
  const verbTokens = negative ? tokens.slice(1) : tokens;
  const stripped = `${stem.slice(0, match.index)}___${stem.slice(match.index + match[0].length)}`;
  return verbTokens.length === 0 ? { stem: stripped, negative } : { stem: stripped, verb: verbTokens.join(" "), negative };
}

function objectiveOf(ex: LessonExerciseDraft): string {
  return ex.objectiveId.split(".").at(-1) ?? "";
}

function polarityOf(ex: LessonExerciseDraft, objective: string): BePolarity {
  if (ex.transformId !== undefined && Object.hasOwn(TRANSFORM_POLARITY, ex.transformId)) return TRANSFORM_POLARITY[ex.transformId]!;
  return Object.hasOwn(PC_POLARITY, objective) ? PC_POLARITY[objective]! : "any";
}

function answersOf(ex: LessonExerciseDraft): { field: string; text: string }[] {
  return [
    { field: "answer", text: ex.answer },
    ...ex.acceptedAnswers.map((text) => ({ field: "acceptedAnswers", text })),
  ];
}

interface ScannedField {
  readonly field: string;
  readonly text: string;
  readonly lang: "en" | "pl";
}

/**
 * Pola skanowane na wskaźniki czasu (§5.2): angielskie teksty ćwiczenia,
 * polskie polecenie i prompt (dla tłumaczenia — polskie zdanie). Pomijane:
 * `explanationPl`, `hint`, karty.
 */
function scannedFields(ex: LessonExerciseDraft): ScannedField[] {
  const fields: ScannedField[] = [];
  const add = (field: string, text: string | undefined, lang: "en" | "pl"): void => {
    if (text !== undefined && text.trim() !== "") fields.push({ field, text, lang });
  };
  add("stem", ex.stem, "en");
  add("statement", ex.statement, "en");
  for (const { field, text } of answersOf(ex)) add(field, text, "en");
  for (const option of ex.options ?? []) add("options", option.text, "en");
  for (const segments of ex.noticeSegments ?? []) add("noticeSegments", segments.join(" "), "en");
  add("instructionPl", ex.instructionPl, "pl");
  add("prompt", ex.prompt, ex.exerciseType === "lesson_open_answer" ? "pl" : "en");
  return fields;
}

/** Bodziec z luką wypełnioną odpowiedzią (bez nawiasu z czasownikiem) albo sama odpowiedź. */
function answerSentence(ex: LessonExerciseDraft, answer: string): string {
  const gapTypes = ex.exerciseType === "lesson_gap" || ex.exerciseType === "lesson_choice" || ex.exerciseType === "lesson_listen_choice";
  if (!gapTypes || ex.stem === undefined || !ex.stem.includes("___")) return answer;
  return stripGapVerb(ex.stem).stem.replace("___", answer);
}

/** Luka bez podpowiedzi (§6.2): checker agenta i kartkówka nie widzą `hint`, więc czasownik stoi w nawiasie. */
function validateGapHint(ex: LessonExerciseDraft, errors: string[]): void {
  if ((ex.hint?.trim() ?? "") !== "") {
    errors.push("pc-shape: hint musi być pusty — czasownik stoi w nawiasie tuż po luce");
  }
}

/** Wskaźniki zakazane (przyszłość, dwuznaczność, §5.1) w każdym skanowanym polu. */
function validateForbiddenMarkers(ex: LessonExerciseDraft, errors: string[]): void {
  for (const { field, text, lang } of scannedFields(ex)) {
    const { forbidden } = scanTimeMarkers(text, lang);
    if (forbidden.length > 0) {
      errors.push(`pc-marker: ${field}: wskaźnik czasu „${forbidden.join("”, „")}” jest zakazany w temacie (przyszłość albo dwuznaczność)`);
    }
  }
}

/**
 * Nawias dopuszczalny tylko tuż po luce `lesson_gap` (§6.2) — lektor czyta
 * bodziec wyboru i „posłuchaj i wybierz” razem z nawiasem.
 */
function validateBrackets(ex: LessonExerciseDraft, errors: string[]): void {
  const texts: { field: string; text: string | undefined }[] = [
    { field: "stem", text: ex.stem !== undefined && ex.exerciseType === "lesson_gap" ? stripGapVerb(ex.stem).stem : ex.stem },
    { field: "statement", text: ex.statement },
    ...answersOf(ex),
    ...(ex.options ?? []).map((option) => ({ field: "options", text: option.text })),
    ...(ex.noticeSegments ?? []).map((segments) => ({ field: "noticeSegments", text: segments.join(" ") })),
  ];
  for (const { field, text } of texts) {
    if (text !== undefined && /[()]/.test(text)) {
      errors.push(`pc-shape: ${field}: nawias jest dozwolony tylko tuż po luce w „Uzupełnij lukę” (He ___ (play) now.)`);
    }
  }
}

/** Czasownik stanu w formie -ing (także „being”) w zdaniu z odpowiedzią (§5.3). */
function stateVerbInAnswer(ex: LessonExerciseDraft, answer: string): string | undefined {
  return stateVerbIn(answerSentence(ex, answer), "ing_form");
}

/**
 * Czasowniki stanu (§5.3): w celach 1, 3, 4, 5 bez formy -ing w zdaniu
 * z odpowiedzią; w celach porównania w dowolnej formie w każdym skanowanym
 * polu angielskim (odpowiedzi i opcje wstawione w bodziec, żeby „has” miało
 * kontekst kolokacji „has lunch”).
 */
function validateStateVerbs(ex: LessonExerciseDraft, objective: string, errors: string[]): void {
  const tenseChoice = TENSE_CHOICE_OBJECTIVES.has(objective);
  const report = (field: string, verb: string | undefined): void => {
    if (verb === "be") {
      errors.push(`pc-state: ${field}: forma „being” (He is being silly) nie występuje w tym temacie`);
    } else if (verb !== undefined) {
      errors.push(tenseChoice
        ? `pc-state: ${field}: czasownik „${verb}” opisuje stan — w wyborze teraz/zwykle nie występuje w żadnej formie`
        : `pc-state: ${field}: czasownik „${verb}” opisuje stan i nie występuje z -ing w tym temacie`);
    }
  };
  if (!tenseChoice) {
    for (const { field, text } of answersOf(ex)) report(field, stateVerbInAnswer(ex, text));
    return;
  }
  const answer = normalizeTokens(ex.answer).join(" ");
  const texts = [
    { field: "stem", text: ex.stem },
    { field: "statement", text: ex.statement },
    { field: "prompt", text: ex.exerciseType === "lesson_open_answer" ? undefined : ex.prompt },
    ...answersOf(ex).map(({ field, text }) => ({ field, text: answerSentence(ex, text) })),
    ...(ex.options ?? [])
      .filter((option) => normalizeTokens(option.text).join(" ") !== answer)
      .map((option) => ({ field: "options", text: answerSentence(ex, option.text) })),
  ];
  for (const { field, text } of texts) {
    if (text !== undefined) report(field, stateVerbIn(text, "any_form"));
  }
}

/** Tokeny odpowiedzi po rozwinięciu skrótów isn't / aren't. */
function expandedTokens(answer: string): string[] {
  return normalizeTokens(answer).flatMap((token) => BE_CONTRACTED_TOKENS[token] ?? [token]);
}

/** Odpowiedź luki na samą formę be: am / is / are [not]; null = to nie jest sama forma be. */
function parseBeOnly(answer: string): { form: string; negative: boolean } | null {
  const [form, ...rest] = expandedTokens(answer);
  if (form === undefined || !BE_FORMS.has(form)) return null;
  if (rest.length === 0) return { form, negative: false };
  if (rest.length === 1 && rest[0] === "not") return { form, negative: true };
  return null;
}

/**
 * Podmiot po luce w pytaniu z inwersją („___ Ola reading?”, „What ___ the
 * dogs doing?”): tokeny po luce do formy -ing / „not”, bez określników.
 * undefined, gdy przed luką stoi coś innego niż sam pytajnik albo po luce nie
 * ma formy -ing.
 */
function invertedSubjectAfterGap(stem: string): string[] | undefined {
  const before = beSubjectTokensBefore(stem);
  if (before.length > 1 || (before.length === 1 && !BE_WH_WORDS.has(before[0]!))) return undefined;
  const after = normalizeTokens(stem.split("___", 2)[1] ?? "");
  const end = after.findIndex((token) => token === "not" || token.endsWith("ing"));
  if (end < 0) return undefined;
  const subject = after.slice(0, end).filter((token) => !BE_AFTER_SKIP.has(token));
  return subject.length === 0 ? undefined : subject;
}

/**
 * Podmiot przed luką: tokeny od początku zdania (po „Look!” i innych zdaniach)
 * do luki, bez przysłówków; po wcześniejszej formie be albo orzeczeniu
 * w Present Simple — od spójnika, który otwiera kolejne zdanie składowe („Mum
 * is cooking and Dad ___”, „Mum cooks dinner and Dad ___” → „dad”, nie
 * podmiot złożony).
 */
function subjectSpanBeforeGap(stem: string): string[] {
  const sentence = (stem.split("___", 2)[0] ?? "").split(SENTENCE_BOUNDARY).at(-1) ?? "";
  const tokens = expandedTokens(sentence).filter((token) => !BE_ADVERBS.has(token));
  const lastSimple = verbGroupsIn(tokens).findLast((group) => group.tense === "simple")?.verbIndex ?? -1;
  const boundary = Math.max(tokens.findLastIndex((token) => BE_FORMS.has(token)), lastSimple);
  if (boundary < 0) return tokens;
  const conjunction = tokens.findIndex((token, i) => i > boundary && CLAUSE_CONJUNCTIONS.has(token));
  return tokens.slice(conjunction >= 0 ? conjunction + 1 : boundary + 1);
}

/**
 * Forma be wymagana przez podmiot przy luce (stem bez nawiasu); undefined = nie
 * da się ustalić. Heurystyki działają na samym zdaniu składowym z luką.
 * Podmiot złożony przed luką („The cat and the dog ___”, „Tom and his sister
 * ___”) → are — wspólna heurystyka widzi „and” tylko dwa tokeny przed luką.
 * Pytanie z inwersją i podmiotem złożonym („___ the boy and the girl
 * playing?”) → are, zanim wspólna heurystyka weźmie pierwszy rzeczownik; imię
 * albo rzeczownik po luce, którego wspólna heurystyka nie rozpoznaje („___ Ola
 * reading?”) → liczba z `looksPlural`.
 */
function expectedBeForm(fullStem: string): string | undefined {
  const span = subjectSpanBeforeGap(fullStem);
  if (span.indexOf("and") > 0 && span.at(-1) !== "and") return "are";
  const stem = `${span.join(" ")} ___ ${fullStem.split("___", 2)[1] ?? ""}`;
  const inverted = invertedSubjectAfterGap(stem);
  if (inverted?.includes("and")) return "are";
  const fromSubject = expectedBeFormNearGap(stem);
  if (fromSubject !== undefined) return fromSubject;
  const near = bePronounNearGap(stem);
  if (near !== undefined && !near.fromQuestion) return BE_FORM_BY_SUBJECT[near.pronoun];
  if (inverted === undefined) return undefined;
  return looksPlural(inverted.at(-1)!) ? "are" : "is";
}

/** Ostatnie „Yes” / „No” przed luką („Is she reading? No, she ___.”). */
function yesNoBeforeGap(stem: string): string | undefined {
  return normalizeTokens(stem.split("___", 2)[0] ?? "").findLast((token) => token === "yes" || token === "no");
}

function validateBeForm(form: string, stem: string, field: string, errors: string[]): void {
  const expected = expectedBeForm(stem);
  if (expected !== undefined && expected !== form) {
    errors.push(`pc-be: ${field}: forma „${form}” nie pasuje do podmiotu (poprawnie: ${expected})`);
  }
}

/**
 * Luka na samą formę be (cele 1, 3, 4): forma zgodna z podmiotem, biegunowość
 * z celu i Yes/No. Przeczenie w odpowiedzi tylko w celu 3 albo po „No” i bez
 * „not” po luce — inaczej twierdzenie pasuje tak samo („___ she reading?” →
 * Is / Isn't) albo powstaje podwójne przeczenie („She isn't not sleeping”).
 */
function validateBeOnlyGapAnswer(
  ex: LessonExerciseDraft,
  stem: string,
  parsed: { form: string; negative: boolean },
  field: string,
  errors: string[],
): void {
  validateBeForm(parsed.form, stem, field, errors);
  const objective = objectiveOf(ex);
  const marker = yesNoBeforeGap(stem);
  if (parsed.negative) {
    if (expandedTokens(stem.split("___", 2)[1] ?? "").includes("not")) {
      errors.push(`pc-be: ${field}: po luce stoi już „not” — odpowiedź z przeczeniem daje podwójne przeczenie`);
      return;
    }
    if (objective !== "negative" && marker !== "no") {
      errors.push(`pc-be: ${field}: przeczenie w luce na formę be tylko w celu przeczeń albo po „No” — inaczej twierdzenie też pasuje`);
      return;
    }
  }
  const negative = parsed.negative || beStemContext(stem).negative;
  checkBePolarity(polarityOf(ex, objective), negative, marker, `pc-be: ${field}`, errors);
}

/** Forma -ing czasownika z nawiasu: z tabeli i dozwolonej klasy albo kolokacja „having/looking” (nie w celu 5). */
function validateIngForm(ex: LessonExerciseDraft, objective: string, verb: string, ing: string, answer: string, field: string, errors: string[]): void {
  const expected = ingFormOf(verb);
  if (expected === undefined) {
    const sentenceTokens = normalizeTokens(answerSentence(ex, answer));
    const collocation = objective !== "ing_spelling" &&
      Object.hasOwn(COLLOCATION_ING_FORMS, verb) && COLLOCATION_ING_FORMS[verb] === ing &&
      isCollocationIngForm(sentenceTokens, sentenceTokens.indexOf(ing));
    if (!collocation) {
      errors.push(`pc-ing: ${field}: czasownik „${verb}” jest spoza tabeli form -ing`);
    }
    return;
  }
  if (ing !== expected) {
    errors.push(`pc-ing: ${field}: „${ing}” nie jest formą -ing czasownika „${verb}” (poprawnie: ${expected})`);
    return;
  }
  const allowed = Object.hasOwn(PC_ALLOWED_ING_RULES, objective) ? PC_ALLOWED_ING_RULES[objective]! : [];
  const rule = ingRuleOf(verb)!;
  if (!allowed.includes(rule)) {
    errors.push(`pc-ing: ${field}: czasownik „${verb}” (pisownia ${rule}) nie pasuje do celu (dozwolone: ${allowed.join(", ")})`);
  }
}

/** Luka z czasownikiem w celach 1, 3, 4, 5: am / is / are [not] + forma -ing czasownika z nawiasu. */
function validateBeIngGapAnswer(
  ex: LessonExerciseDraft,
  objective: string,
  gap: { stem: string; verb: string; negative: boolean },
  answer: string,
  field: string,
  errors: string[],
): void {
  const [form, ...rest] = expandedTokens(answer);
  if (form === undefined || !BE_FORMS.has(form)) {
    errors.push(`pc-be: ${field}: odpowiedź „${answer}” musi zaczynać się od am, is albo are`);
    return;
  }
  validateBeForm(form, gap.stem, field, errors);
  const negative = rest[0] === "not";
  checkBePolarity(polarityOf(ex, objective), negative, undefined, `pc-be: ${field}`, errors);
  if (negative !== gap.negative) {
    errors.push(gap.negative
      ? `pc-be: ${field}: nawias ma „not”, więc odpowiedź musi być przeczeniem`
      : `pc-be: ${field}: przeczenie w odpowiedzi wymaga „not” w nawiasie (She ___ (not watch) TV now.)`);
  }
  const tail = negative ? rest.slice(1) : rest;
  if (tail.length !== 1) {
    errors.push(`pc-ing: ${field}: po am/is/are${negative ? " not" : ""} potrzebna jest jedna forma -ing czasownika „${gap.verb}”`);
    return;
  }
  // Czasownik stanu zgłasza reguła wspólna (przed tabelą form -ing) — bez drugiego komunikatu.
  if (stateVerbInAnswer(ex, answer) !== undefined) return;
  validateIngForm(ex, objective, gap.verb, tail[0]!, answer, field, errors);
}

/**
 * Zdanie składowe z luką: tokeny przed luką od ostatniej granicy zdania albo od
 * spójnika otwierającego zdanie po wcześniejszym orzeczeniu („Mum is cooking
 * and Dad ___” → „dad”; ten sam podział co w `subjectSpanBeforeGap`).
 */
function clauseTokensBeforeGap(stem: string): string[] {
  const sentence = (stem.split("___", 2)[0] ?? "").split(SENTENCE_BOUNDARY).at(-1) ?? "";
  const tokens = tenseTokens(sentence);
  let start = 0;
  for (const group of verbGroupsIn(tokens)) {
    const conjunction = tokens.findIndex((token, i) => i > group.verbIndex && CLAUSE_CONJUNCTIONS.has(token));
    if (conjunction < 0) break;
    start = conjunction + 1;
  }
  return tokens.slice(start);
}

/**
 * Luka z czasownikiem (§6.2) obejmuje całą formę (am/is/are [not] + -ing albo
 * Present Simple), więc przed luką w tym samym zdaniu składowym nie ma już
 * formy be ani do/does — inaczej po wstawieniu powstaje „Is she is reading?”.
 */
function validateVerbGapOwnsWholeForm(stem: string, errors: string[]): void {
  const present = clauseTokensBeforeGap(stem).find((token) => BE_FORMS.has(token) || token === "do" || token === "does");
  if (present !== undefined) {
    errors.push(`pc-shape: stem: luka z czasownikiem obejmuje całą formę — w zdaniu przed luką jest już „${present}” (He ___ (play) now.)`);
  }
}

/** Luka (`lesson_gap`, §6.2): kształt luki, nawias z czasownikiem, forma be i -ing. */
function validateGap(ex: LessonExerciseDraft, objective: string, errors: string[]): void {
  if (ex.stem === undefined) return;
  const gap = stripGapVerb(ex.stem);
  const { verb } = gap;
  if (verb !== undefined) {
    validateVerbGapOwnsWholeForm(gap.stem, errors);
    if (gap.negative && !NEGATED_VERB_GAP_OBJECTIVES.has(objective)) {
      errors.push("pc-shape: stem: nawias z „not” jest dozwolony tylko w celach przeczeń");
    }
    if (!gap.negative && NEGATED_VERB_GAP_OBJECTIVES.has(objective)) {
      errors.push("pc-shape: stem: w tym celu luka z czasownikiem wymaga „not” w nawiasie (She ___ (not watch) TV now.)");
    }
  }
  for (const { field, text } of answersOf(ex)) {
    if (LEADING_APOSTROPHE.test(text.trim())) {
      errors.push(`pc-shape: ${field}: odpowiedź luki nie może zaczynać się apostrofem („${text}”) — zapisz pełną formę am/is/are`);
      continue;
    }
    if (verb === undefined) {
      const parsed = parseBeOnly(text);
      if (parsed === null) {
        errors.push(`pc-shape: ${field}: luka z czasownikiem wymaga formy podstawowej w nawiasie tuż po luce (He ___ (play) now.)`);
      } else if (!BE_GAP_OBJECTIVES.has(objective)) {
        errors.push(`pc-shape: ${field}: luka na samą formę am/is/are jest tylko w celach twierdzeń, przeczeń i pytań`);
      } else {
        validateBeOnlyGapAnswer(ex, gap.stem, parsed, field, errors);
      }
    } else if (BE_ING_GAP_OBJECTIVES.has(objective)) {
      validateBeIngGapAnswer(ex, objective, { stem: gap.stem, verb, negative: gap.negative }, text, field, errors);
    }
  }
}

/**
 * Typy z całym zdaniem w odpowiedzi (§6.3; „Posłuchaj i wybierz” — luka na
 * formę be jak w wyborze). `error_fix`, `notice` i opcje „Posłuchaj i wybierz”
 * mają dodatkowe reguły w `present-continuous-exercise-rules.ts`.
 */
const WHOLE_SENTENCE_TYPES: ReadonlySet<string> = new Set([
  "lesson_choice",
  "lesson_listen_choice",
  "lesson_error_fix",
  "lesson_order",
  "lesson_short_answer",
  "lesson_transform",
  "lesson_open_answer",
]);

/** Cele, w których każde zdanie odpowiedzi jest w Present Continuous (cele porównania — `validateTenseChoice`). */
const PC_SENTENCE_OBJECTIVES: ReadonlySet<string> = new Set(["affirmative", "negative", "questions", "ing_spelling"]);

/**
 * Skróty z „'s” zakazane w kluczach (§6.3): normalizator rozwija je do „is”
 * albo „has”, więc klucz „He's running.” zaliczyłby „He has running.”.
 */
const S_CONTRACTIONS: ReadonlySet<string> = new Set(["he's", "she's", "it's", "what's", "that's", "there's", "where's", "who's"]);

/** Pytajniki na początku zdania; dozwolony jest tylko wzorzec „What + am/is/are + podmiot + doing?”. */
const QUESTION_WORDS: ReadonlySet<string> = new Set([...BE_WH_WORDS, "which"]);

/** Przysłówki między formą be a formą -ing („She is always playing”). */
const BE_ADVERBS_IN_PC: ReadonlySet<string> = new Set(["always", "still", "just", "really"]);

/** Tokeny zdań tekstu (po rozwinięciu isn't / aren't i skrótów zaimków), bez pustych. */
function sentenceTokens(text: string): string[][] {
  return text.split(SENTENCE_BOUNDARY).map(expandedTokens).filter((tokens) => tokens.length > 0);
}

/** Klucze ćwiczenia z całym zdaniem: odpowiedź, warianty i tekst poprawnej opcji, gdy różni się od odpowiedzi. */
function sentenceAnswersOf(ex: LessonExerciseDraft): { field: string; text: string }[] {
  const answers = answersOf(ex);
  const correct = ex.options?.find((option) => option.id === ex.correctOption)?.text;
  if (correct !== undefined && normalizeTokens(correct).join(" ") !== normalizeTokens(ex.answer).join(" ")) {
    answers.push({ field: "options", text: correct });
  }
  return answers;
}

/** Bodziec krótkiej odpowiedzi (pytanie) — `prompt` albo `stem`. */
function shortAnswerQuestion(ex: LessonExerciseDraft): { field: string; text: string } | undefined {
  if (ex.exerciseType !== "lesson_short_answer") return undefined;
  if (ex.prompt !== undefined) return { field: "prompt", text: ex.prompt };
  return ex.stem === undefined ? undefined : { field: "stem", text: ex.stem };
}

/** Pełne zdanie odpowiedzi: bodziec z luką wypełnioną kluczem (wybór, krótka odpowiedź z luką) albo sam klucz. */
function wholeSentenceOf(ex: LessonExerciseDraft, answer: string): string {
  const question = shortAnswerQuestion(ex);
  if (question !== undefined && question.text.includes("___")) return question.text.replace("___", answer);
  return answerSentence(ex, answer);
}

/** Pytajnik na początku zdania poza wzorcem „What + am/is/are + podmiot + doing?” (§6.3). */
function validateQuestionWords(tokens: readonly string[], field: string, errors: string[]): void {
  const first = tokens[0];
  if (first === undefined || !QUESTION_WORDS.has(first)) return;
  const whatDoing = first === "what" && BE_FORMS.has(tokens[1] ?? "") && tokens.slice(2).includes("doing");
  if (!whatDoing) {
    errors.push(`pc-shape: ${field}: pytanie szczegółowe tylko we wzorcu „What + am/is/are + podmiot + doing?” (What is he doing?)`);
  }
}

/** Czy forma be na pozycji `index` otwiera pytanie z inwersją („Is she…”, „What are they…”). */
function isInvertedBe(tokens: readonly string[], start: number, index: number): boolean {
  return index === start || (index === start + 1 && BE_WH_WORDS.has(tokens[start]!));
}

/**
 * Forma be wymagana przez podmiot formy na pozycji `index`. Zdanie składowe
 * zaczyna się po spójniku za poprzednią formą be („… and Dad ___ reading”);
 * w pytaniu z inwersją „not” po formie be jest pomijane („Aren't they” →
 * „___ they”), żeby podmiot stał tuż po luce.
 */
function expectedBeAt(tokens: readonly string[], start: number, index: number): string | undefined {
  const after = tokens.slice(index + 1);
  if (isInvertedBe(tokens, start, index) && after[0] === "not") after.shift();
  return expectedBeForm([...tokens.slice(start, index), "___", ...after].join(" "));
}

/** Pozycja formy -ing po formie be albo undefined (krótka odpowiedź „Yes, she is.”). */
function verbIndexAfterBe(tokens: readonly string[], index: number, inverted: boolean): number | undefined {
  let next = index + 1;
  // Podwójne „not” („isn't not”) zgłasza reguła biegunowości — tu je pomijamy.
  while (tokens[next] === "not") next++;
  if (!inverted) {
    while (next < tokens.length && BE_ADVERBS_IN_PC.has(tokens[next]!)) next++;
    return next < tokens.length ? next : undefined;
  }
  // Pytanie z inwersją: forma -ing stoi po podmiocie („Is the king reading?” — „king” to nie forma -ing).
  const isVerb = (token: string, i: number): boolean => isIngFormInTable(token) || isCollocationIngForm(tokens, i);
  const found = tokens.findIndex((token, i) => i > next && isVerb(token, i));
  if (found >= 0) return found;
  const outOfTable = tokens.findIndex((token, i) => i > next && token.endsWith("ing"));
  return outOfTable >= 0 ? outOfTable : tokens.length;
}

/**
 * Forma -ing po formie be: z tabeli i dozwolonej klasy albo kolokacja
 * „having/looking” (nie w celu 5). Tabelę i klasę sprawdzamy tylko dla formy
 * z klucza (§4, „w sprawdzanym miejscu”) — w wyborze „The dogs ___ running.”
 * forma -ing stoi w bodźcu, a sprawdzana jest forma be.
 */
function validateIngAfterBe(
  ex: LessonExerciseDraft,
  objective: string,
  tokens: readonly string[],
  index: number,
  keyTokens: ReadonlySet<string>,
  field: string,
  errors: string[],
): void {
  const token = tokens[index];
  if (token === undefined) {
    errors.push(`pc-ing: ${field}: po am/is/are brak formy -ing czasownika`);
    return;
  }
  const fromKey = keyTokens.has(token);
  if (isIngFormInTable(token)) {
    if (!fromKey) return;
    const verb = baseOfIngForm(token)!;
    const rule = ingRuleOf(verb)!;
    // Cel 5: forma `plain` dopuszczona w wyborze jako kontrast (§4).
    const allowed = objective === "ing_spelling" && ex.exerciseType === "lesson_choice"
      ? [...PC_ALLOWED_ING_RULES[objective]!, "plain"]
      : PC_ALLOWED_ING_RULES[objective] ?? [];
    if (!allowed.includes(rule)) {
      errors.push(`pc-ing: ${field}: czasownik „${verb}” (pisownia ${rule}) nie pasuje do celu (dozwolone: ${allowed.join(", ")})`);
    }
    return;
  }
  if (isCollocationIngForm(tokens, index)) {
    if (fromKey && objective === "ing_spelling") {
      errors.push(`pc-ing: ${field}: kolokacja „${token}” nie ćwiczy pisowni z tabeli — nie w celu pisowni -ing`);
    }
    return;
  }
  if (!token.endsWith("ing")) {
    errors.push(`pc-ing: ${field}: po am/is/are potrzebna jest forma -ing, a stoi „${token}” (She is playing, nie She is plays)`);
  } else if (fromKey) {
    errors.push(`pc-ing: ${field}: „${token}” jest spoza tabeli form -ing`);
  }
}

/**
 * Formy be jednego zdania: zgodność z podmiotem i forma -ing po każdej
 * z nich (`keyTokens` undefined = bez sprawdzania formy -ing). Zwraca, czy
 * w zdaniu jest forma be.
 */
function validateSentenceBeForms(
  ex: LessonExerciseDraft,
  objective: string,
  tokens: readonly string[],
  keyTokens: ReadonlySet<string> | undefined,
  field: string,
  errors: string[],
): boolean {
  let start = 0;
  let previousBe: number | undefined;
  let hasBe = false;
  for (const [index, form] of tokens.entries()) {
    if (!BE_FORMS.has(form)) continue;
    if (previousBe !== undefined) {
      const conjunction = tokens.findIndex((token, i) => i > previousBe! && i < index && CLAUSE_CONJUNCTIONS.has(token));
      start = conjunction >= 0 ? conjunction + 1 : previousBe + 1;
    }
    previousBe = index;
    hasBe = true;
    const expected = expectedBeAt(tokens, start, index);
    if (expected !== undefined && expected !== form) {
      errors.push(`pc-be: ${field}: forma „${form}” nie pasuje do podmiotu (poprawnie: ${expected})`);
    }
    if (keyTokens === undefined) continue;
    const verbIndex = verbIndexAfterBe(tokens, index, isInvertedBe(tokens, start, index));
    if (verbIndex !== undefined) validateIngAfterBe(ex, objective, tokens, verbIndex, keyTokens, field, errors);
  }
  return hasBe;
}

/** Zaimek podmiotu pytania „Is she…?” / „What are you…?”; undefined dla imienia, rzeczownika i luki. */
function questionPronoun(question: string): string | undefined {
  const [tokens] = sentenceTokens(question);
  if (tokens === undefined || question.includes("___")) return undefined;
  const beIndex = tokens[0] === "what" ? 1 : 0;
  if (!BE_FORMS.has(tokens[beIndex] ?? "")) return undefined;
  const subject = tokens[beIndex + 1] === "not" ? tokens[beIndex + 2] : tokens[beIndex + 1];
  return subject !== undefined && Object.hasOwn(BE_FORM_BY_SUBJECT, subject) ? subject : undefined;
}

/** Osoba krótkiej odpowiedzi zgodna z pytaniem („Is she reading?” → „Yes, she is.”, „Are you…?” → „I am”). */
function validateShortAnswerPerson(ex: LessonExerciseDraft, answer: string, field: string, errors: string[]): void {
  const question = shortAnswerQuestion(ex);
  const pronoun = question === undefined ? undefined : questionPronoun(question.text);
  if (pronoun === undefined) return;
  const tokens = expandedTokens(answer);
  const index = tokens.findIndex((token, i) => Object.hasOwn(BE_FORM_BY_SUBJECT, token) && BE_FORMS.has(tokens[i + 1] ?? ""));
  if (index >= 0 && !beAnswerPronounAllowed(tokens[index]!, { pronoun, fromQuestion: true })) {
    errors.push(`pc-be: ${field}: osoba „${tokens[index]}” w odpowiedzi nie pasuje do podmiotu pytania „${pronoun}”`);
  }
}

/**
 * Klucz z całym zdaniem w celach 1, 3, 4, 5 (§6.3): pytajnik tylko „What …
 * doing?”, każda forma be zgodna z podmiotem i z formą -ing po niej, zdanie
 * z formą be, biegunowość z celu albo przekształcenia (`checkPolarity` false —
 * biegunowość sprawdziła reguła luki na formę be), osoba krótkiej odpowiedzi.
 */
function validateSentenceAnswer(
  ex: LessonExerciseDraft,
  objective: string,
  answer: string,
  field: string,
  checkPolarity: boolean,
  errors: string[],
): void {
  const sentence = wholeSentenceOf(ex, answer);
  const sentences = sentenceTokens(sentence);
  for (const tokens of sentences) validateQuestionWords(tokens, field, errors);
  // Czasownik stanu zgłasza reguła wspólna — bez drugiego komunikatu o formie -ing.
  const keyTokens = stateVerbIn(sentence, "ing_form") === undefined ? new Set(expandedTokens(answer)) : undefined;
  let hasBe = false;
  for (const tokens of sentences) {
    if (validateSentenceBeForms(ex, objective, tokens, keyTokens, field, errors)) hasBe = true;
  }
  if (!hasBe) {
    errors.push(`pc-be: ${field}: zdanie w Present Continuous potrzebuje formy am/is/are`);
    return;
  }
  if (checkPolarity) {
    const marker = sentences.map((tokens) => tokens[0]).findLast((token) => token === "yes" || token === "no");
    const negative = sentences.some((tokens) => tokens.includes("not"));
    checkBePolarity(polarityOf(ex, objective), negative, marker, `pc-be: ${field}`, errors);
  }
  validateShortAnswerPerson(ex, answer, field, errors);
}

/** Bodziec z luką na formę be w wyborze, „Posłuchaj i wybierz” albo krótkiej odpowiedzi (ten sam kształt co luka, §6.2). */
function beChoiceGapStem(ex: LessonExerciseDraft): string | undefined {
  const choice = ex.exerciseType === "lesson_choice" || ex.exerciseType === "lesson_listen_choice";
  const stem = choice ? ex.stem : shortAnswerQuestion(ex)?.text;
  return stem?.includes("___") ? stem : undefined;
}

/**
 * Dystraktor równy kluczowi z dodanym albo usuniętym „not” („Is” / „Isn't”)
 * bez „Yes” / „No” przed luką i bez „not” po niej: oba zdania są poprawne.
 */
function validateBeChoiceDistractors(ex: LessonExerciseDraft, stem: string, errors: string[]): void {
  const key = ex.options?.find((option) => option.id === ex.correctOption);
  const parsedKey = key === undefined ? null : parseBeOnly(key.text);
  if (parsedKey === null || yesNoBeforeGap(stem) !== undefined) return;
  if (expandedTokens(stem.split("___", 2)[1] ?? "").includes("not")) return;
  for (const option of ex.options ?? []) {
    if (option.id === key!.id) continue;
    const parsed = parseBeOnly(option.text);
    if (parsed !== null && parsed.form === parsedKey.form && parsed.negative !== parsedKey.negative) {
      errors.push(`pc-be: options: „${option.text}” i „${key!.text}” dają dwa poprawne zdania — dystraktor musi być błędny`);
    }
  }
}

/** Całe zdania (choice, order, short_answer, transform, open_answer; §6.3, §5.4). */
function validateSentences(ex: LessonExerciseDraft, objective: string, errors: string[]): void {
  const pcObjective = PC_SENTENCE_OBJECTIVES.has(objective);
  const gapStem = beChoiceGapStem(ex);
  for (const { field, text } of sentenceAnswersOf(ex)) {
    const contraction = normalizeTokens(text).find((token) => S_CONTRACTIONS.has(token));
    if (contraction !== undefined) {
      errors.push(`pc-shape: ${field}: skrót „${contraction}” jest zakazany w kluczu — zapisz pełne „is” (He is playing)`);
      continue;
    }
    if (!pcObjective) continue;
    const parsed = gapStem === undefined ? null : parseBeOnly(text);
    if (parsed !== null) validateBeOnlyGapAnswer(ex, gapStem!, parsed, field, errors);
    validateSentenceAnswer(ex, objective, text, field, parsed === null, errors);
  }
  if (!pcObjective) return;
  if (gapStem !== undefined) validateBeChoiceDistractors(ex, gapStem, errors);
  const question = shortAnswerQuestion(ex);
  if (question !== undefined) {
    for (const tokens of sentenceTokens(question.text)) validateQuestionWords(tokens, question.field, errors);
  }
  // Tłumaczenie (§5.4): „Mama gotuje” bez kontekstu ma dwa poprawne tłumaczenia.
  if (ex.exerciseType === "lesson_open_answer" && ex.prompt !== undefined) {
    const { groups } = scanTimeMarkers(ex.prompt, "pl");
    if (groups.size !== 1 || !groups.has("now")) {
      errors.push("pc-marker: prompt: zdanie do tłumaczenia potrzebuje wskaźnika „teraz” (teraz, w tej chwili, Patrz!) i żadnego „zwykle”");
    }
  }
}

/** Osoba podmiotu (heurystyka formy be) i klasy pisowni celu dla reguł Present Simple. */
function presentSimpleContext(objective: string): PresentSimpleContext {
  return { expectedBeForm, allowedRules: PC_ALLOWED_ING_RULES[objective] ?? [] };
}

/**
 * Luka z czasownikiem w nawiasie albo wybór formy do luki w celach porównania
 * (§6.2): Present Continuous jak w celach 1–5, Present Simple z
 * `presentSimpleFormFor` (osoba z bodźca, przeczenie z nawiasu).
 */
function validateTenseFormAnswer(
  ex: LessonExerciseDraft,
  objective: string,
  gap: { stem: string; verb?: string; negative?: boolean },
  answer: string,
  field: string,
  errors: string[],
): void {
  const tokens = tenseTokens(answer);
  if (BE_FORMS.has(tokens[0] ?? "")) {
    const verb = gap.verb ?? ingBaseOf(tokens.at(-1)!);
    if (verb === undefined) {
      errors.push(`pc-ing: ${field}: „${tokens.at(-1)}” jest spoza tabeli form -ing`);
      return;
    }
    validateBeIngGapAnswer(ex, objective, { stem: gap.stem, verb, negative: gap.negative ?? tokens.includes("not") }, answer, field, errors);
    return;
  }
  validatePresentSimpleFormAnswer(answer, gap, presentSimpleContext(objective), field, errors);
}

/** Całe zdanie w celach porównania (§6.3): orzeczenia w Present Simple zgodne z osobą, w Present Continuous jak w celach 1–5. */
function validateTenseSentenceAnswer(
  ex: LessonExerciseDraft,
  objective: string,
  answer: string,
  sentences: readonly TenseSentence[],
  field: string,
  errors: string[],
): void {
  if (sentences.every(({ groups }) => groups.length === 0)) {
    errors.push(sentences.some(({ tokens }) => tokens.some((token) => ingBaseOf(token) !== undefined))
      ? `pc-be: ${field}: przed formą -ing brak am/is/are`
      : `pc-shape: ${field}: brak czasownika z tabeli w Present Simple albo Present Continuous`);
    return;
  }
  for (const { tokens, groups } of sentences) {
    for (const group of groups) {
      if (group.tense === "simple") validatePresentSimpleGroup(tokens, group, presentSimpleContext(objective), field, errors);
    }
  }
  if (sentences.some(({ groups }) => groups.some((group) => group.tense === "continuous"))) {
    validateSentenceAnswer(ex, objective, answer, field, true, errors);
  } else {
    for (const { tokens } of sentences) validateQuestionWords(tokens, field, errors);
  }
}

/**
 * Klucz albo opcja w celu porównania: czas każdego orzeczenia zgodny z grupą
 * wskaźników (także w drugim zdaniu składowym: „Mum cooks dinner and Dad is
 * reading now.”), potem forma — w luce i wyborze formy względem bodźca,
 * w pozostałych typach w całym zdaniu.
 */
function validateTenseAnswer(
  ex: LessonExerciseDraft,
  objective: string,
  gap: { stem: string; verb?: string; negative?: boolean } | undefined,
  answer: string,
  field: string,
  group: MarkerGroup | undefined,
  errors: string[],
): void {
  const sentences = tenseSentences(gap === undefined ? wholeSentenceOf(ex, answer) : answerSentence(ex, answer));
  validateTenseOfGroups(sentences, group, field, errors);
  if (gap === undefined) {
    validateTenseSentenceAnswer(ex, objective, answer, sentences, field, errors);
  } else {
    validateTenseFormAnswer(ex, objective, gap, answer, field, errors);
  }
}

/**
 * Wybór „now / usually” (§5.5, cel 2): bodziec to jedno zdanie twierdzące
 * w Present Simple albo Present Continuous bez wskaźnika, klucz wynika z czasu
 * zdania. Polecenie nie może zdradzać odpowiedzi scenką jednej grupy
 * („Teraz czy zwykle?” ma obie grupy i niczego nie zdradza).
 */
function validateNowUsuallyChoice(ex: LessonExerciseDraft, objective: string, errors: string[]): void {
  const stem = ex.stem ?? "";
  if (scanTimeMarkers(stem, "en").groups.size > 0) {
    errors.push("pc-marker: stem: zdanie w wyborze „now / usually” nie może mieć wskaźnika czasu — czas wynika z formy");
  }
  if (ex.instructionPl !== undefined && scanTimeMarkers(ex.instructionPl, "pl").groups.size === 1) {
    errors.push("pc-marker: instructionPl: polecenie wyboru „now / usually” zdradza odpowiedź wskaźnikiem albo scenką");
  }
  const sentences = tenseSentences(stem);
  const groups = sentences.flatMap((sentence) => sentence.groups);
  const verbGroup = groups[0];
  const shapeOk = groups.length === 1 && !stem.includes("___") && !stem.includes("?") && !tenseTokens(stem).includes("not");
  if (verbGroup === undefined || !shapeOk) {
    errors.push("pc-shape: stem: w wyborze „now / usually” bodziec to jedno zdanie twierdzące w Present Simple albo Present Continuous");
    return;
  }
  const key = normalizeTokens(ex.options?.find((option) => option.id === ex.correctOption)?.text ?? "").join(" ");
  const expectedKey = verbGroup.tense === "continuous" ? "now" : "usually";
  if (key !== expectedKey) {
    errors.push(`pc-marker: correctOption: zdanie w ${TENSE_NAMES[verbGroup.tense]} wymaga odpowiedzi „${expectedKey}”`);
  }
  if (verbGroup.tense === "continuous") {
    validateSentenceAnswer(ex, objective, stem, "stem", true, errors);
  } else {
    const sentence = sentences.find((candidate) => candidate.groups.length > 0)!;
    validatePresentSimpleGroup(sentence.tokens, verbGroup, presentSimpleContext(objective), "stem", errors);
  }
}

/**
 * Cele porównania (2, 6; §5.2, §5.5, §6.2, §6.3): wskaźniki jednej grupy,
 * czas klucza i wariantów zgodny z grupą, forma zgodna z osobą, kształt zdań;
 * w wyborze żaden dystraktor nie może spełniać tych samych reguł co klucz.
 */
function validateTenseChoice(ex: LessonExerciseDraft, objective: string, errors: string[]): void {
  if (objective === "now_or_usually" && isNowUsuallyChoice(ex)) {
    validateNowUsuallyChoice(ex, objective, errors);
    return;
  }
  // §3.1: pytania tylko całymi zdaniami — w luce forma po podmiocie zdradza czas
  // („___ you play…?” → Do, „___ you playing…?” → Are); jeden komunikat zamiast mylących reguł formy.
  const choice = ex.exerciseType === "lesson_choice" || ex.exerciseType === "lesson_listen_choice";
  if (choice && ex.stem !== undefined && isGapQuestion(ex.stem)) {
    errors.push("pc-shape: stem: pytanie w wyborze czasu tylko całymi zdaniami w opcjach (Do you play…? / Are you playing…?) — w luce forma po podmiocie zdradza odpowiedź");
    return;
  }
  const group = tenseChoiceMarkerGroup(scannedFields(ex), errors);
  errors.push(...tenseChoiceShapeErrors(ex, objective));
  let gap: { stem: string; verb?: string; negative?: boolean } | undefined;
  if (ex.exerciseType === "lesson_gap") {
    // Kształt luki bez nawiasu (luka na formę be, brak czasownika) zgłasza `validateGap`.
    const stripped = ex.stem === undefined ? undefined : stripGapVerb(ex.stem);
    if (stripped?.verb === undefined) return;
    gap = { stem: stripped.stem, verb: stripped.verb, negative: stripped.negative };
  } else if (ex.exerciseType === "lesson_choice" && ex.stem?.includes("___") === true) {
    gap = { stem: ex.stem };
  }
  const answers = ex.exerciseType === "lesson_gap" ? answersOf(ex) : sentenceAnswersOf(ex);
  for (const { field, text } of answers) {
    if (!LEADING_APOSTROPHE.test(text.trim())) validateTenseAnswer(ex, objective, gap, text, field, group, errors);
  }
  if (ex.exerciseType !== "lesson_choice" || group === undefined) return;
  for (const option of ex.options ?? []) {
    if (option.id === ex.correctOption) continue;
    const optionErrors: string[] = [];
    validateTenseAnswer(ex, objective, gap, option.text, "options", group, optionErrors);
    if (optionErrors.length === 0) {
      errors.push(`pc-marker: options: „${option.text}” też pasuje do wskaźnika i podmiotu — dystraktor musi być błędny`);
    }
  }
}

/**
 * Walidator ćwiczenia tematu Present Continuous; cel z ostatniego segmentu
 * `objectiveId`. Zwraca komunikaty z prefiksami `pc-…:` (pusta lista = poprawne).
 */
export function validatePresentContinuousExercise(ex: LessonExerciseDraft): string[] {
  if (ex.exerciseType === "lesson_card") return [];
  const objective = objectiveOf(ex);
  const errors: string[] = [];
  validateForbiddenMarkers(ex, errors);
  validateBrackets(ex, errors);
  validateStateVerbs(ex, objective, errors);
  if (TENSE_CHOICE_OBJECTIVES.has(objective)) validateTenseChoice(ex, objective, errors);
  if (ex.exerciseType === "lesson_gap") {
    validateGapHint(ex, errors);
    validateGap(ex, objective, errors);
  } else if (WHOLE_SENTENCE_TYPES.has(ex.exerciseType)) {
    validateSentences(ex, objective, errors);
  }
  if (ex.exerciseType === "lesson_error_fix") validateErrorFix(ex, objective, errors);
  if (ex.exerciseType === "lesson_notice") validateNotice(ex, errors);
  if (ex.exerciseType === "lesson_listen_choice") validateListenChoiceOptions(ex, errors);
  // Reguła luki na formę be i reguła zdania mogą zgłosić tę samą niezgodność formy z podmiotem.
  return [...new Set(errors)];
}
