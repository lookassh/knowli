import type { LessonExerciseDraft } from "../../types";
import { normalizeTokens } from "../../normalize";
import {
  ingFormOf,
  ingRuleOf,
  isCollocationIngForm,
  stateVerbIn,
  type IngRule,
} from "../english/ing-forms";
import {
  BE_AFTER_SKIP,
  BE_CONTRACTED_TOKENS,
  BE_FORM_BY_SUBJECT,
  BE_FORMS,
  BE_WH_WORDS,
  bePronounNearGap,
  beStemContext,
  beSubjectTokensBefore,
  checkBePolarity,
  expectedBeFormNearGap,
  looksPlural,
  TRANSFORM_POLARITY,
  type BePolarity,
} from "./be-agreement";
import { scanTimeMarkers } from "./time-markers";

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

/** Cele, w których odpowiedź luki z czasownikiem to am/is/are [not] + -ing (cele porównania mają własne reguły). */
const BE_ING_GAP_OBJECTIVES: ReadonlySet<string> = new Set(["affirmative", "negative", "questions", "ing_spelling"]);

/** Czasowniki stanu z formą -ing dozwoloną w kolokacji (§4, wyjątek; poza celem 5). */
const COLLOCATION_ING_FORMS: Readonly<Record<string, string>> = { have: "having", look: "looking" };

/**
 * Nawias z czasownikiem tuż po luce. Silnik ma własną kopię wzorca
 * (`feedback-sentence-text.ts`, design §6.7), bo `domain/lessons` nie importuje
 * przedmiotów — zmieniaj oba miejsca razem.
 */
const GAP_VERB = /_{2,}\s*\(([^)]*)\)/;

const LEADING_APOSTROPHE = /^['’‘ʼ´`]/;

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

function validateStateVerbs(ex: LessonExerciseDraft, errors: string[]): void {
  for (const { field, text } of answersOf(ex)) {
    const verb = stateVerbInAnswer(ex, text);
    if (verb === "be") {
      errors.push(`pc-state: ${field}: forma „being” (He is being silly) nie występuje w tym temacie`);
    } else if (verb !== undefined) {
      errors.push(`pc-state: ${field}: czasownik „${verb}” opisuje stan i nie występuje z -ing w tym temacie`);
    }
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
 * Forma be wymagana przez podmiot przy luce (stem bez nawiasu); undefined = nie
 * da się ustalić. Pytanie z inwersją i podmiotem złożonym („___ the boy and
 * the girl playing?”) → are, zanim wspólna heurystyka weźmie pierwszy
 * rzeczownik; imię albo rzeczownik po luce, którego wspólna heurystyka nie
 * rozpoznaje („___ Ola reading?”) → liczba z `looksPlural`.
 */
function expectedBeForm(stem: string): string | undefined {
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

/** Luka na samą formę be (cele 1, 3, 4): forma zgodna z podmiotem, biegunowość z celu i Yes/No. */
function validateBeOnlyGapAnswer(
  ex: LessonExerciseDraft,
  stem: string,
  parsed: { form: string; negative: boolean },
  field: string,
  errors: string[],
): void {
  validateBeForm(parsed.form, stem, field, errors);
  const negative = parsed.negative || beStemContext(stem).negative;
  checkBePolarity(polarityOf(ex, objectiveOf(ex)), negative, yesNoBeforeGap(stem), `pc-be: ${field}`, errors);
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

/** Luka (`lesson_gap`, §6.2): kształt luki, nawias z czasownikiem, forma be i -ing. */
function validateGap(ex: LessonExerciseDraft, objective: string, errors: string[]): void {
  if (ex.stem === undefined) return;
  const gap = stripGapVerb(ex.stem);
  const { verb } = gap;
  if (verb !== undefined) {
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
 * Walidator ćwiczenia tematu Present Continuous; cel z ostatniego segmentu
 * `objectiveId`. Zwraca komunikaty z prefiksami `pc-…:` (pusta lista = poprawne).
 */
export function validatePresentContinuousExercise(ex: LessonExerciseDraft): string[] {
  if (ex.exerciseType === "lesson_card") return [];
  const objective = objectiveOf(ex);
  const errors: string[] = [];
  validateForbiddenMarkers(ex, errors);
  validateBrackets(ex, errors);
  validateStateVerbs(ex, errors);
  if (ex.exerciseType === "lesson_gap") {
    validateGapHint(ex, errors);
    validateGap(ex, objective, errors);
  }
  return errors;
}
