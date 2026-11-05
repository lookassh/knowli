import type { LessonExerciseDraft } from "../../types";
import { normalizeTokens } from "../../normalize";
import { editDistance } from "../../../text-distance";
import { baseOfIngForm, isCollocationIngForm, isIngFormInTable } from "../english/ing-forms";
import { englishNormalizer } from "../english/normalizer";
import { BE_FORMS } from "./be-agreement";
import { ingBaseOf, presentSimpleBaseOf } from "./present-continuous-tense-choice";
import { presentSimpleForms } from "./present-simple-forms";

/**
 * Reguły typów ćwiczeń tematu Present Continuous: poprawianie błędu (design
 * „Present Continuous” §6.3), „Wskaż słowo” (§6.5) i „Posłuchaj i wybierz”
 * (§6.6). Wydzielone z `present-continuous-validation.ts`, który je woła; ten
 * plik nie importuje walidatora tematu (bez cyklu). Komunikaty z prefiksami
 * `pc-error-fix:`, `pc-notice:`, `pc-shape:` (§8).
 */

/** Najwięcej tokenów po każdej stronie obszaru różnicy `error_fix` (§6.3). */
const MAX_ERROR_FIX_REGION_TOKENS = 3;

/** Najwięcej zmian liter między błędną a poprawną pisownią -ing (swiming → swimming, lieing → lying). */
const MAX_ING_SPELLING_EDITS = 2;

interface ErrorFixDiff {
  readonly wrong: readonly string[];
  readonly right: readonly string[];
  /** Tokeny odpowiedzi (wariant normalizacji, z którego pochodzi obszar) i początek obszaru w nich. */
  readonly answerTokens: readonly string[];
  readonly start: number;
}

function regionSize(diff: Pick<ErrorFixDiff, "wrong" | "right">): number {
  return Math.max(diff.wrong.length, diff.right.length);
}

/**
 * Obszar różnicy dla każdej pary wariantów normalizacji (skróty dwuznaczne
 * „He's” dają kilka sekwencji) — wygrywa najmniejszy. null, gdy któraś para
 * jest identyczna albo najmniejszy obszar ma więcej niż 3 tokeny po którejś stronie.
 */
function errorFixDiff(statement: string, answer: string): ErrorFixDiff | null {
  let best: ErrorFixDiff | undefined;
  for (const wrongTokens of englishNormalizer.normalize(statement)) {
    for (const answerTokens of englishNormalizer.normalize(answer)) {
      const shorter = Math.min(wrongTokens.length, answerTokens.length);
      let start = 0;
      while (start < shorter && wrongTokens[start] === answerTokens[start]) start++;
      let end = 0;
      while (end < shorter - start && wrongTokens.at(-1 - end) === answerTokens.at(-1 - end)) end++;
      const diff: ErrorFixDiff = {
        wrong: wrongTokens.slice(start, wrongTokens.length - end),
        right: answerTokens.slice(start, answerTokens.length - end),
        answerTokens,
        start,
      };
      if (regionSize(diff) === 0) return null;
      if (best === undefined || regionSize(diff) < regionSize(best)) best = diff;
    }
  }
  return best !== undefined && regionSize(best) <= MAX_ERROR_FIX_REGION_TOKENS ? best : null;
}

/**
 * Obszar różnicy zdania z błędem i odpowiedzi `error_fix` (§6.3): po
 * normalizacji z rozwinięciem skrótów (`englishNormalizer`) tokeny między
 * wspólnym prefiksem a wspólnym sufiksem. null, gdy zdania się nie różnią
 * albo obszar ma więcej niż 3 tokeny po którejś stronie.
 */
export function errorFixRegion(statement: string, answer: string): { readonly wrong: readonly string[]; readonly right: readonly string[] } | null {
  const diff = errorFixDiff(statement, answer);
  return diff === null ? null : { wrong: diff.wrong, right: diff.right };
}

type ErrorFixKind = "missing_be" | "missing_ing" | "wrong_be" | "do_for_be" | "ing_spelling" | "tense_swap";

const ERROR_FIX_KIND_LABELS: Readonly<Record<ErrorFixKind, string>> = {
  missing_be: "brak am/is/are",
  missing_ing: "brak -ing po am/is/are",
  wrong_be: "zła forma am/is/are",
  do_for_be: "do/does zamiast am/is/are",
  ing_spelling: "zła pisownia -ing",
  tense_swap: "Present Simple zamiast Present Continuous albo odwrotnie",
};

/**
 * Sprawdzany element celu w obszarze różnicy (§6.3). Zła forma be i do/does
 * zamiast be to kategorie błędów celów 1, 3, 4 (zgodność klucza z podmiotem
 * sprawdza reguła be); cele porównania (2, 6) ćwiczą zamianę PS ↔ PC.
 */
const ERROR_FIX_KINDS: Readonly<Record<string, readonly ErrorFixKind[]>> = {
  affirmative: ["missing_be", "missing_ing", "wrong_be"],
  now_or_usually: ["tense_swap"],
  negative: ["missing_be", "missing_ing", "wrong_be", "do_for_be"],
  questions: ["missing_be", "missing_ing", "wrong_be", "do_for_be"],
  ing_spelling: ["ing_spelling"],
  now_or_usually_more: ["tense_swap"],
};

/** Brak formy be: odpowiedź to zdanie z błędem z jedną dodaną formą am/is/are („He playing” → „He is playing”). */
function isMissingBe({ wrong, right }: ErrorFixDiff): boolean {
  if (right.length !== wrong.length + 1) return false;
  const wrongText = wrong.join(" ");
  return right.some((token, i) => BE_FORMS.has(token) && right.toSpliced(i, 1).join(" ") === wrongText);
}

/** Forma podstawowa formy -ing na pozycji `index`: z tabeli albo z kolokacji „having/looking”. */
function ingBaseAt(tokens: readonly string[], index: number): string | undefined {
  const token = tokens[index];
  if (token === undefined) return undefined;
  const fromTable = baseOfIngForm(token);
  if (fromTable !== undefined || !isCollocationIngForm(tokens, index)) return fromTable;
  return ingBaseOf(token);
}

/**
 * Brak -ing po be: forma podstawowa albo forma Present Simple zamiast formy
 * -ing tego samego czasownika, a przed nią w odpowiedzi stoi am/is/are
 * („She is play/plays” → „She is playing”, „Is she read?” → „Is she reading?”).
 */
function isMissingIng({ wrong, right, answerTokens, start }: ErrorFixDiff): boolean {
  if (wrong.length !== 1 || right.length !== 1) return false;
  const base = ingBaseAt(answerTokens, start);
  if (base === undefined || !presentSimpleForms(base).has(wrong[0]!)) return false;
  return answerTokens.slice(0, start).some((token) => BE_FORMS.has(token));
}

/** Zła forma be: po jednym tokenie z każdej strony, oba to am/is/are („He are playing” → „He is playing”). */
function isWrongBe({ wrong, right }: ErrorFixDiff): boolean {
  return wrong.length === 1 && right.length === 1 && BE_FORMS.has(wrong[0]!) && BE_FORMS.has(right[0]!);
}

/**
 * do/does zamiast formy be przed formą -ing (cele 3, 4): „He doesn't playing
 * now.” → „He isn't playing now.”, „Does she reading?” → „Is she reading?”.
 */
function isDoForBe({ wrong, right, answerTokens, start }: ErrorFixDiff): boolean {
  if (wrong.length !== 1 || right.length !== 1 || (wrong[0] !== "do" && wrong[0] !== "does") || !BE_FORMS.has(right[0]!)) return false;
  return answerTokens.some((token, i) => i > start && (isIngFormInTable(token) || isCollocationIngForm(answerTokens, i)));
}

/** Strona obszaru w Present Simple: forma czasownika albo do/does + not + forma podstawowa. */
function presentSimpleSide(tokens: readonly string[]): { base: string; negative: boolean } | undefined {
  if (tokens.length === 1) {
    const base = presentSimpleBaseOf(tokens[0]!);
    return base === undefined ? undefined : { base, negative: false };
  }
  const [operator, not, verb] = tokens;
  if (tokens.length !== 3 || (operator !== "do" && operator !== "does") || not !== "not") return undefined;
  return presentSimpleBaseOf(verb!) === verb ? { base: verb!, negative: true } : undefined;
}

/** Strona obszaru w Present Continuous: am/is/are [not] + forma -ing. */
function presentContinuousSide(tokens: readonly string[]): { base: string; negative: boolean } | undefined {
  const negative = tokens[1] === "not";
  if (tokens.length !== (negative ? 3 : 2) || !BE_FORMS.has(tokens[0]!)) return undefined;
  const base = ingBaseOf(tokens.at(-1)!);
  return base === undefined ? undefined : { base, negative };
}

/**
 * Zamiana PS ↔ PC (cele 2, 6): jedna strona to forma Present Simple
 * czasownika, druga be + jego forma -ing, z tą samą biegunowością („Look!
 * Ola reads.” → „Look! Ola is reading.”). Zgodność strony poprawnej z grupą
 * wskaźnika sprawdza reguła czasu odpowiedzi.
 */
function isTenseSwap({ wrong, right }: ErrorFixDiff): boolean {
  return [[wrong, right], [right, wrong]].some(([simpleTokens, continuousTokens]) => {
    const simple = presentSimpleSide(simpleTokens!);
    const continuous = presentContinuousSide(continuousTokens!);
    return simple !== undefined && continuous !== undefined && simple.base === continuous.base && simple.negative === continuous.negative;
  });
}

/** Zła pisownia -ing (cel 5): forma błędna spoza tabeli, poprawna z tabeli, różnica kilku liter. */
function isIngSpelling({ wrong, right }: ErrorFixDiff): boolean {
  if (wrong.length !== 1 || right.length !== 1) return false;
  return !isIngFormInTable(wrong[0]!) && isIngFormInTable(right[0]!) && editDistance(wrong[0]!, right[0]!) <= MAX_ING_SPELLING_EDITS;
}

const ERROR_FIX_MATCHERS: Readonly<Record<ErrorFixKind, (diff: ErrorFixDiff) => boolean>> = {
  missing_be: isMissingBe,
  missing_ing: isMissingIng,
  wrong_be: isWrongBe,
  do_for_be: isDoForBe,
  ing_spelling: isIngSpelling,
  tense_swap: isTenseSwap,
};

/**
 * `error_fix` (§6.3): zdanie z błędem i każdy klucz różnią się jednym spójnym
 * obszarem (najwyżej 3 tokeny po każdej stronie), a obszar to sprawdzany
 * element celu. Cele bez wpisu w `ERROR_FIX_KINDS` sprawdzają tylko obszar.
 */
export function validateErrorFix(ex: LessonExerciseDraft, objective: string, errors: string[]): void {
  const statement = ex.statement;
  // Brak zdania z błędem zgłasza walidacja ogólna typu.
  if (statement === undefined || statement.trim() === "") return;
  const kinds = Object.hasOwn(ERROR_FIX_KINDS, objective) ? ERROR_FIX_KINDS[objective]! : undefined;
  const keys = [{ field: "answer", text: ex.answer }, ...ex.acceptedAnswers.map((text) => ({ field: "acceptedAnswers", text }))];
  for (const { field, text } of keys) {
    const diff = errorFixDiff(statement, text);
    if (diff === null) {
      errors.push(`pc-error-fix: ${field}: zdanie z błędem i poprawne muszą różnić się jednym miejscem (najwyżej ${MAX_ERROR_FIX_REGION_TOKENS} słowa po każdej stronie)`);
      continue;
    }
    if (kinds === undefined || kinds.some((kind) => ERROR_FIX_MATCHERS[kind](diff))) continue;
    const shown = (tokens: readonly string[]): string => (tokens.length === 0 ? "(nic)" : tokens.join(" "));
    errors.push(
      `pc-error-fix: ${field}: różnica „${shown(diff.wrong)}” → „${shown(diff.right)}” nie jest błędem ćwiczonym w celu ` +
        `(${kinds.map((kind) => ERROR_FIX_KIND_LABELS[kind]).join(", ")})`,
    );
  }
}

/**
 * „Wskaż słowo” (§6.5): we wszystkich zdaniach dokładnie jeden token z formą
 * -ing (z tabeli albo z kolokacji „having lunch”, „looking at”) i jest nim
 * `correctOption` — inaczej dziecko wskazałoby inną poprawną formę i dostało
 * błąd (materializacja bierze pierwszy pasujący segment).
 */
export function validateNotice(ex: LessonExerciseDraft, errors: string[]): void {
  const ingForms = (ex.noticeSegments ?? []).flatMap((sentence) => {
    const tokens = sentence.flatMap(normalizeTokens);
    return tokens.filter((token, i) => isIngFormInTable(token) || isCollocationIngForm(tokens, i));
  });
  if (ingForms.length !== 1) {
    errors.push(`pc-notice: noticeSegments: liczba form -ing w zdaniach: ${ingForms.length} — potrzebna dokładnie jedna`);
    return;
  }
  const target = normalizeTokens(ex.correctOption ?? "");
  if (target.length !== 1 || target[0] !== ingForms[0]) {
    errors.push(`pc-notice: correctOption: słowem do wskazania musi być forma -ing „${ingForms[0]}”`);
  }
}

/** Pary opcji „Posłuchaj i wybierz” po normalizacji (Is / Are = is / are): różnica słyszalna i w sprawdzanym elemencie. */
const LISTEN_CHOICE_PAIRS: readonly (readonly string[])[] = [["is", "are"], ["isn't", "aren't"]];

/** „Posłuchaj i wybierz” (§6.6): opcje to para is / are, isn't / aren't albo Is / Are. */
export function validateListenChoiceOptions(ex: LessonExerciseDraft, errors: string[]): void {
  const options = (ex.options ?? []).map((option) => normalizeTokens(option.text).join(" "));
  const isPair = LISTEN_CHOICE_PAIRS.some((pair) => options.length === pair.length && pair.every((text) => options.includes(text)));
  if (!isPair) {
    errors.push("pc-shape: options: w „Posłuchaj i wybierz” opcje to para is / are, isn't / aren't albo Is / Are (nie „He's” / „He”)");
  }
}
