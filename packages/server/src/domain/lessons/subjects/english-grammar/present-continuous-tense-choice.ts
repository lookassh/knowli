import type { LessonExerciseDraft } from "../../types";
import { normalizeTokens } from "../../normalize";
import { baseOfIngForm, COLLOCATION_ING_FORMS, ingFormOf, ingRuleOf, STATE_VERBS, type IngRule } from "../english/ing-forms";
import { BE_CONTRACTED_TOKENS, BE_DETERMINERS, BE_FORMS, BE_WH_WORDS } from "./be-agreement";
import { presentSimpleForms } from "./present-simple-forms";
import { scanTimeMarkers, type MarkerGroup } from "./time-markers";

/**
 * Czyste funkcje celów porównania tematu Present Continuous (cele 2 i 6,
 * design „Present Continuous” §5.2, §5.5, §6.2, §6.3): formy Present Simple,
 * rozpoznanie czasu zdania (grupy czasownika) i kształt zdań. Walidator tematu
 * (`present-continuous-validation.ts`) składa z nich reguły; ten plik nie
 * importuje walidatora tematu (bez cyklu).
 */

/** Cele porównania: wybór Present Simple albo Present Continuous ze wskaźnika albo scenki. */
export const TENSE_CHOICE_OBJECTIVES: ReadonlySet<string> = new Set(["now_or_usually", "now_or_usually_more"]);

export type Tense = "simple" | "continuous";

/** Czas wymagany przez grupę wskaźników (§5.2): „teraz” → Present Continuous, „zwykle” → Present Simple. */
const TENSE_OF_MARKER_GROUP: Readonly<Record<MarkerGroup, Tense>> = { now: "continuous", usually: "simple" };

export const TENSE_NAMES: Readonly<Record<Tense, string>> = { simple: "Present Simple", continuous: "Present Continuous" };

/** Spójniki rozpoczynające kolejne zdanie składowe („Mum is cooking and Dad is reading”). */
export const CLAUSE_CONJUNCTIONS: ReadonlySet<string> = new Set(["and", "but", "while", "so", "because", "or"]);

/** Granice zdań w tekście; przecinek nie jest granicą („Look, Mum is cooking”). */
export const SENTENCE_BOUNDARY = /[.!?;:]+/;

const DO_CONTRACTED_TOKENS: Readonly<Record<string, readonly string[]>> = {
  "don't": ["do", "not"],
  "doesn't": ["does", "not"],
  dont: ["do", "not"],
  doesnt: ["does", "not"],
};

/** Tokeny tekstu po rozwinięciu skrótów be (isn't, she's) i do (doesn't, don't). */
export function tenseTokens(text: string): string[] {
  return normalizeTokens(text).flatMap((token) => BE_CONTRACTED_TOKENS[token] ?? DO_CONTRACTED_TOKENS[token] ?? [token]);
}

/**
 * Dopuszczalne formy Present Simple czasownika (§5.2): 3. osoba liczby
 * pojedynczej → forma z -s albo „doesn't X” / „does not X”; pozostałe osoby →
 * forma podstawowa albo „don't X” / „do not X”.
 */
export function presentSimpleFormFor(base: string, thirdPersonSingular: boolean, negative: boolean): readonly string[] {
  if (negative) return thirdPersonSingular ? [`doesn't ${base}`, `does not ${base}`] : [`don't ${base}`, `do not ${base}`];
  if (!thirdPersonSingular) return [base];
  return [...presentSimpleForms(base)].filter((form) => form !== base);
}

/** Czasownik znany tematowi: z tabeli form -ing, z kolokacji („have”, „look”) albo czasownik stanu. */
function isKnownVerb(base: string): boolean {
  return ingFormOf(base) !== undefined || Object.hasOwn(COLLOCATION_ING_FORMS, base) || STATE_VERBS.has(base);
}

/** Forma podstawowa czasownika, którego formą Present Simple jest token (reads → read, watches → watch, has → have). */
export function presentSimpleBaseOf(token: string): string | undefined {
  const candidates = token === "has" ? ["have"] : [token, token.slice(0, -1), token.slice(0, -2), `${token.slice(0, -3)}y`];
  return candidates.find((base) => isKnownVerb(base) && presentSimpleForms(base).has(token));
}

/** Forma podstawowa formy -ing: z tabeli albo z kolokacji („having” → have). */
export function ingBaseOf(token: string): string | undefined {
  return baseOfIngForm(token) ?? Object.keys(COLLOCATION_ING_FORMS).find((base) => COLLOCATION_ING_FORMS[base] === token);
}

/**
 * Słowa, po których forma czasownika jest rzeczownikiem albo bezokolicznikiem
 * („the cook”, „a walk”, „in the rain”, „to play”, „after work”), a nie
 * orzeczeniem zdania.
 */
const NOT_BEFORE_FINITE_VERB: ReadonlySet<string> = new Set([
  ...BE_DETERMINERS,
  "this", "that", "these", "those",
  "to", "of", "at", "in", "on", "after", "before", "from", "for", "with", "by", "about",
]);

/** Orzeczenie zdania składowego: forma be (Present Continuous) albo forma Present Simple z operatorem lub bez. */
export interface VerbGroup {
  readonly tense: Tense;
  /** Pozycja formy be, operatora do/does albo formy Present Simple. */
  readonly index: number;
  /** Pozycja czasownika głównego w Present Simple (dla be — pozycja formy be). */
  readonly verbIndex: number;
  /** Forma podstawowa czasownika w Present Simple. */
  readonly base?: string;
  readonly operator?: "do" | "does";
  /** Tokeny podmiotu (Present Simple): przed orzeczeniem albo między operatorem a czasownikiem w pytaniu. */
  readonly subject: readonly string[];
}

/** Czy pozycja otwiera pytanie z inwersją: początek zdania albo tuż po pytajniku. */
function opensQuestion(tokens: readonly string[], index: number): boolean {
  return index === 0 || (index === 1 && BE_WH_WORDS.has(tokens[0]!));
}

function verbGroupAt(tokens: readonly string[], start: number, index: number): VerbGroup | undefined {
  const token = tokens[index]!;
  if (BE_FORMS.has(token)) return { tense: "continuous", index, verbIndex: index, subject: tokens.slice(start, index) };
  if (token === "do" || token === "does") {
    const afterNot = tokens[index + 1] === "not" ? index + 2 : index + 1;
    // Pytanie („Does Ola play…?”): podmiot między operatorem a czasownikiem; przeczenie: czasownik tuż po „not”.
    const verbIndex = opensQuestion(tokens, index)
      ? tokens.findIndex((candidate, i) => i > afterNot && presentSimpleBaseOf(candidate) !== undefined)
      : afterNot < tokens.length && presentSimpleBaseOf(tokens[afterNot]!) !== undefined ? afterNot : -1;
    if (verbIndex >= 0) {
      const subject = opensQuestion(tokens, index) ? tokens.slice(afterNot, verbIndex) : tokens.slice(start, index);
      return { tense: "simple", index, verbIndex, base: presentSimpleBaseOf(tokens[verbIndex]!), operator: token, subject };
    }
  }
  // Forma bez operatora potrzebuje podmiotu przed sobą — „Listen, …” na początku zdania to wykrzyknienie.
  if (index === start || NOT_BEFORE_FINITE_VERB.has(tokens[index - 1]!)) return undefined;
  const base = presentSimpleBaseOf(token);
  return base === undefined ? undefined : { tense: "simple", index, verbIndex: index, base, subject: tokens.slice(start, index) };
}

/**
 * Orzeczenia jednego zdania (tokeny z `tenseTokens`), po jednym na zdanie
 * składowe: po znalezionym orzeczeniu szukanie przeskakuje do spójnika
 * otwierającego kolejne zdanie składowe, więc rzeczownik w dopełnieniu
 * („wearing a watch”) nie liczy się jako drugi czasownik.
 */
export function verbGroupsIn(tokens: readonly string[]): VerbGroup[] {
  const groups: VerbGroup[] = [];
  let start = 0;
  for (let index = 0; index < tokens.length; index++) {
    const group = verbGroupAt(tokens, start, index);
    if (group === undefined) continue;
    groups.push(group);
    const conjunction = tokens.findIndex((token, i) => i > group.verbIndex && CLAUSE_CONJUNCTIONS.has(token));
    if (conjunction < 0) break;
    start = conjunction + 1;
    index = conjunction;
  }
  return groups;
}

/** Wybór „now / usually” (§5.5): wybór z opcjami dokładnie „now” i „usually”. */
export function isNowUsuallyChoice(ex: LessonExerciseDraft): boolean {
  if (ex.exerciseType !== "lesson_choice" || ex.options?.length !== 2) return false;
  const texts = ex.options.map((option) => normalizeTokens(option.text).join(" ")).sort();
  return texts[0] === "now" && texts[1] === "usually";
}

/**
 * Czy bodziec z luką jest pytaniem: znak zapytania, luka na początku zdania
 * albo tuż po pytajniku („___ you play…”, „What ___ you doing”), albo
 * operator / forma be na początku („Does Ola ___ …”).
 */
export function isGapQuestion(stem: string): boolean {
  if (!stem.includes("___")) return false;
  if (stem.includes("?")) return true;
  const before = normalizeTokens(stem.split("___", 2)[0] ?? "");
  const first = tenseTokens(stem)[0];
  return before.length === 0 || (before.length === 1 && BE_WH_WORDS.has(before[0]!)) ||
    (first !== undefined && (BE_FORMS.has(first) || first === "do" || first === "does"));
}

/** Typy, w których cel 6 dopuszcza pytania (§3.1: w luce forma po podmiocie zdradza odpowiedź). */
const QUESTION_TYPES_MORE: ReadonlySet<string> = new Set(["lesson_choice", "lesson_open_answer"]);

/**
 * Kształt zdań celów porównania (§6.3): cel 2 — tylko zdania twierdzące (bez
 * pytajnika i bez „not” / „n't” w odpowiedziach); cel 6 — pytania tylko
 * w wyborze i tłumaczeniu.
 */
export function tenseChoiceShapeErrors(ex: LessonExerciseDraft, objective: string): string[] {
  const correct = ex.options?.find((option) => option.id === ex.correctOption)?.text;
  const answers = [ex.answer, ...ex.acceptedAnswers, ...(correct === undefined ? [] : [correct])];
  const texts = [ex.stem, ex.statement, ...answers, ...(ex.options ?? []).map((option) => option.text)];
  const question = texts.some((text) => text?.includes("?") === true);
  const errors: string[] = [];
  if (objective === "now_or_usually") {
    if (question) errors.push("pc-shape: w celu „Teraz czy zwykle?” są tylko zdania twierdzące — pytania należą do celu 6");
    if (answers.some((text) => tenseTokens(text).includes("not"))) {
      errors.push("pc-shape: w celu „Teraz czy zwykle?” są tylko zdania twierdzące — przeczenia należą do celu 6");
    }
  } else if (objective === "now_or_usually_more" && question && !QUESTION_TYPES_MORE.has(ex.exerciseType)) {
    errors.push("pc-shape: pytania w tym celu tylko w wyborze i tłumaczeniu (w luce forma po podmiocie zdradza odpowiedź)");
  }
  return errors;
}

/**
 * Grupa wskaźników ćwiczenia celu porównania (§5.2) ze skanowanych pól:
 * co najmniej jeden wskaźnik i wszystkie z jednej grupy. undefined (z
 * komunikatem) przy braku wskaźnika albo grupach mieszanych.
 */
export function tenseChoiceMarkerGroup(
  fields: readonly { readonly text: string; readonly lang: "en" | "pl" }[],
  errors: string[],
): MarkerGroup | undefined {
  const groups = new Set(fields.flatMap(({ text, lang }) => [...scanTimeMarkers(text, lang).groups]));
  if (groups.size === 0) {
    errors.push("pc-marker: ćwiczenie potrzebuje wskaźnika czasu (now, Look!, every day…) albo scenki w poleceniu (Cicho!, teraz, codziennie…)");
    return undefined;
  }
  if (groups.size > 1) {
    errors.push("pc-marker: wskaźniki „teraz” i „zwykle” naraz — czas odpowiedzi musi wynikać z jednej grupy");
    return undefined;
  }
  return [...groups][0];
}

export interface TenseSentence {
  readonly tokens: string[];
  readonly groups: VerbGroup[];
}

/** Zdania tekstu z orzeczeniami (tokeny po rozwinięciu skrótów be i do). */
export function tenseSentences(text: string): TenseSentence[] {
  return text.split(SENTENCE_BOUNDARY).map(tenseTokens).filter((tokens) => tokens.length > 0)
    .map((tokens) => ({ tokens, groups: verbGroupsIn(tokens) }));
}

/**
 * Czas każdego orzeczenia zgodny z grupą wskaźników (§5.2) — także w drugim
 * zdaniu składowym („Mum cooks dinner and Dad is reading now.”).
 */
export function validateTenseOfGroups(sentences: readonly TenseSentence[], group: MarkerGroup | undefined, field: string, errors: string[]): void {
  if (group === undefined) return;
  const expected = TENSE_OF_MARKER_GROUP[group];
  const wrong = sentences.flatMap(({ groups }) => groups).find((verbGroup) => verbGroup.tense !== expected);
  if (wrong !== undefined) {
    errors.push(`pc-marker: ${field}: zdanie ma ${TENSE_NAMES[wrong.tense]}, a wskaźnik „${group === "now" ? "teraz" : "zwykle"}” wymaga ${TENSE_NAMES[expected]}`);
  }
}

/** Reguły z walidatora tematu potrzebne regułom Present Simple: osoba podmiotu przy luce i klasy pisowni celu. */
export interface PresentSimpleContext {
  /** Forma be wymagana przez podmiot przy luce („Ola ___” → is); undefined = nie da się ustalić. */
  readonly expectedBeForm: (stemWithGap: string) => string | undefined;
  readonly allowedRules: readonly IngRule[];
}

/** Czasownik w Present Simple z tabeli i klasy pisowni celu (§4 — także przy odpowiedzi PS) albo kolokacja „have/look”. */
function validatePresentSimpleVerb(base: string, context: PresentSimpleContext, field: string, errors: string[]): void {
  const rule = ingRuleOf(base);
  if (rule === undefined) {
    // Czasownik stanu poza kolokacją zgłasza reguła stanu; „has lunch”, „looks at” są dozwolone.
    if (!Object.hasOwn(COLLOCATION_ING_FORMS, base) && !STATE_VERBS.has(base)) {
      errors.push(`pc-ing: ${field}: czasownik „${base}” jest spoza tabeli form -ing`);
    }
    return;
  }
  if (!context.allowedRules.includes(rule)) {
    errors.push(`pc-ing: ${field}: czasownik „${base}” (pisownia ${rule}) nie pasuje do celu (dozwolone: ${context.allowedRules.join(", ")})`);
  }
}

/**
 * Orzeczenie w Present Simple w całym zdaniu zgodne z osobą podmiotu (§5.2):
 * 3. osoba liczby pojedynczej → forma z -s / does, pozostałe → forma
 * podstawowa / do; po do/does forma podstawowa.
 */
export function validatePresentSimpleGroup(
  tokens: readonly string[],
  group: VerbGroup,
  context: PresentSimpleContext,
  field: string,
  errors: string[],
): void {
  const verb = tokens[group.verbIndex]!;
  const base = group.base!;
  const expected = context.expectedBeForm(`${group.subject.join(" ")} ___`);
  if (expected !== undefined) {
    const thirdPerson = expected === "is";
    const agrees = group.operator === undefined
      ? presentSimpleFormFor(base, thirdPerson, false).includes(verb)
      : group.operator === (thirdPerson ? "does" : "do");
    if (!agrees) errors.push(`pc-be: ${field}: forma „${group.operator ?? verb}” nie pasuje do podmiotu „${group.subject.join(" ")}”`);
  }
  if (group.operator !== undefined && verb !== base) {
    errors.push(`pc-shape: ${field}: po do/does stoi forma podstawowa „${base}”, nie „${verb}”`);
  }
  validatePresentSimpleVerb(base, context, field, errors);
}

/** Forma podstawowa z odpowiedzi w Present Simple: „reads” → read, „doesn't watch” → watch. */
function presentSimpleBaseOfAnswer(tokens: readonly string[]): string | undefined {
  const operatorForm = tokens.length > 1 && (tokens[0] === "do" || tokens[0] === "does");
  return tokens.length === 1 || operatorForm ? presentSimpleBaseOf(tokens.at(-1)!) : undefined;
}

/**
 * Odpowiedź luki albo opcja wyboru formy w Present Simple (§6.2): jedna
 * z `presentSimpleFormFor` dla osoby z bodźca, przeczenie zgodne z nawiasem,
 * czasownik z nawiasu (w wyborze — z samej odpowiedzi).
 */
export function validatePresentSimpleFormAnswer(
  answer: string,
  gap: { readonly stem: string; readonly verb?: string; readonly negative?: boolean },
  context: PresentSimpleContext,
  field: string,
  errors: string[],
): void {
  const tokens = tenseTokens(answer);
  const negative = tokens.includes("not");
  if (gap.negative !== undefined && negative !== gap.negative) {
    errors.push(gap.negative
      ? `pc-be: ${field}: nawias ma „not”, więc odpowiedź musi być przeczeniem`
      : `pc-be: ${field}: przeczenie w odpowiedzi wymaga „not” w nawiasie (She ___ (not watch) TV every morning.)`);
    return;
  }
  const verb = gap.verb ?? presentSimpleBaseOfAnswer(tokens);
  if (verb === undefined) {
    errors.push(`pc-shape: ${field}: „${answer}” nie jest formą Present Simple ani Present Continuous czasownika z tabeli`);
    return;
  }
  const accepts = (thirdPerson: boolean): boolean =>
    presentSimpleFormFor(verb, thirdPerson, negative).some((form) => tenseTokens(form).join(" ") === tokens.join(" "));
  const expected = context.expectedBeForm(gap.stem);
  const agrees = expected === undefined ? accepts(true) || accepts(false) : accepts(expected === "is");
  if (agrees) {
    validatePresentSimpleVerb(verb, context, field, errors);
  } else if (expected !== undefined && accepts(expected !== "is")) {
    errors.push(`pc-be: ${field}: forma „${answer}” nie pasuje do podmiotu (osoba jak przy „${expected}”)`);
  } else if (tokens.some((token) => ingBaseOf(token) !== undefined)) {
    errors.push(`pc-be: ${field}: przed formą -ing brak am/is/are („${answer}”)`);
  } else {
    errors.push(`pc-shape: ${field}: „${answer}” nie jest formą Present Simple ani Present Continuous czasownika „${verb}”`);
  }
}
