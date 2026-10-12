/**
 * Ocena odpowiedzi lekcji (design „Ocena”, „Model oceniający”). Czysta domena:
 * subject-agnostyczna — działa z dowolnym `AnswerNormalizer` (angielski,
 * fixture historyczny). Silnik nie importuje `subjects/`; test (`evaluate.test`)
 * może importować `englishNormalizer`, bo jest wykluczony z testu architektury.
 *
 * Ścieżka deterministyczna: `matchLessonAnswer` (exact → minor_typo → no_match)
 * i typy zamknięte. Ścieżka modelu: `validateVerdict` (Zod) + `gradeFromVerdict`.
 * Odległość liter reużywa `alignCodePoints`/`editDistance` z `../text-distance`.
 */
import { z } from "zod";
import type { OutcomeReason, SkillOutcome } from "../types";
import { editDistance } from "../text-distance";
import type { AnswerNormalizer, LessonExerciseType } from "./types";

/** Klucz odpowiedzi ćwiczenia (design „Ocena”, `LessonAnswerKey`). */
export interface LessonAnswerKey {
  readonly exerciseType: LessonExerciseType;
  readonly objectiveId: string;
  readonly answer: string;
  readonly acceptedAnswers: readonly string[];
  /** Tokeny elementu sprawdzanego w odpowiedzi kanonicznej (surowy zapis). */
  readonly focus: readonly string[];
  readonly correctOptionId?: string;
  readonly itemIds?: readonly string[];
}

/** Wynik dopasowania deterministycznego. */
export type MatchResult =
  | { kind: "exact"; variant: string }
  | { kind: "minor_typo"; variant: string; typoToken: string }
  | { kind: "no_match" };

/**
 * Progi tolerancji drobnej literówki (design 6.3). Nazwane stałe zamiast
 * rozsianych literałów: token ≤ `shortTokenMaxLength` punktów kodowych znosi
 * OSA ≤ `shortMaxDistance`, dłuższy OSA ≤ `longMaxDistance`.
 */
export const TYPO_TOLERANCE = {
  shortTokenMaxLength: 6,
  shortMaxDistance: 1,
  longMaxDistance: 2,
} as const;

/** Werdykt modelu oceniającego (design „Model oceniający”, `GraderVerdict`). */
export interface GraderVerdict {
  readonly verdict: "correct" | "almost" | "incorrect";
  readonly errorCategory: string | null;
  readonly fragments: readonly string[];
  readonly note: string;
}

/** Kontekst walidacji werdyktu: kategorie celu i surowa odpowiedź dziecka. */
export interface VerdictContext {
  readonly allowedCategories: readonly string[];
  readonly childAnswer: string;
}

/** Ocena celu po dopasowaniu lub werdykcie (design: tabela mapowania). */
export interface ObjectiveGrade {
  readonly outcome: SkillOutcome;
  readonly reason?: OutcomeReason;
  readonly verdict:
    | "exact"
    | "minor_typo"
    | "model_correct"
    | "model_almost"
    | "model_incorrect"
    | "model_other"
    | "unavailable"
    | "closed_correct"
    | "closed_incorrect"
    | "no_match";
  readonly errorCategory?: string;
}

/** Maksymalny rozmiar tablic/napisów werdyktu (design „Model oceniający”). */
const MAX_FRAGMENTS = 4;
const MAX_NOTE_LENGTH = 300;

/** Czy `toLowerCase` zachowuje liczbę punktów kodowych (jak w `compareSpelling`). */
function casefoldStable(text: string): boolean {
  return [...text.toLowerCase()].length === [...text].length;
}

/** Pierwsze dopasowanie w zbiorze sekwencji po obu stronach → exact. */
function sequencesEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

/**
 * Zbiór tokenów „w focus”: każdy token z każdego wariantu znormalizowanego
 * `focus`. Token odpowiedzi jest „w focus”, jeśli należy do tego zbioru.
 */
function focusTokenSet(focus: readonly string[], normalizer: AnswerNormalizer): Set<string> {
  const set = new Set<string>();
  for (const variant of normalizer.normalize(focus.join(" "))) {
    for (const token of variant) {
      set.add(token);
    }
  }
  return set;
}

/** Maksymalny dozwolony OSA dla danego tokenu wg jego długości (punkty kodowe). */
function typoThresholdFor(token: string): number {
  return [...token].length <= TYPO_TOLERANCE.shortTokenMaxLength
    ? TYPO_TOLERANCE.shortMaxDistance
    : TYPO_TOLERANCE.longMaxDistance;
}

/**
 * Dopasowanie odpowiedzi do klucza (design „Ocena”):
 * 1. normalizacja odpowiedzi i wszystkich wariantów normalizatorem przedmiotu,
 * 2. równość dowolnych dwóch sekwencji → exact,
 * 3. sekwencja wariantu tej samej długości różniąca się DOKŁADNIE jednym
 *    tokenem spoza focus, z OSA w progu → minor_typo (token = zapis dziecka),
 * 4. w przeciwnym razie no_match.
 * Pusty focus wyłącza tolerancję literówki (brak informacji o elemencie
 * sprawdzanym — bezpieczny domyślny wybór).
 */
export function matchLessonAnswer(
  answer: string,
  key: LessonAnswerKey,
  normalizer: AnswerNormalizer,
): MatchResult {
  const answerVariants = normalizer.normalize(answer).filter((seq) => seq.length > 0);
  if (answerVariants.length === 0) {
    return { kind: "no_match" };
  }
  const variants = [key.answer, ...key.acceptedAnswers];
  const normalizedVariants = variants.map((variant) => ({
    original: variant,
    sequences: normalizer.normalize(variant),
  }));

  // (2) exact
  for (const variant of normalizedVariants) {
    for (const vSeq of variant.sequences) {
      if (answerVariants.some((aSeq) => sequencesEqual(aSeq, vSeq))) {
        return { kind: "exact", variant: variant.original };
      }
    }
  }

  // (3) minor_typo — wyłączone dla pustego focus
  if (key.focus.length > 0) {
    const focusSet = focusTokenSet(key.focus, normalizer);
    for (const variant of normalizedVariants) {
      for (const vSeq of variant.sequences) {
        for (const aSeq of answerVariants) {
          const typo = singleTypoToken(aSeq, vSeq, focusSet);
          if (typo !== null) {
            return { kind: "minor_typo", variant: variant.original, typoToken: typo };
          }
        }
      }
    }
  }

  return { kind: "no_match" };
}

/**
 * Jeśli sekwencje mają tę samą długość i różnią się dokładnie jednym tokenem,
 * ten token nie jest „w focus” i jego OSA mieści się w progu — zwraca token
 * odpowiedzi dziecka. Inaczej `null`.
 */
function singleTypoToken(
  answerSeq: readonly string[],
  variantSeq: readonly string[],
  focusSet: ReadonlySet<string>,
): string | null {
  if (answerSeq.length !== variantSeq.length) {
    return null;
  }
  let diffIndex = -1;
  for (let i = 0; i < answerSeq.length; i++) {
    if (answerSeq[i] !== variantSeq[i]) {
      if (diffIndex !== -1) {
        return null; // więcej niż jeden różniący się token
      }
      diffIndex = i;
    }
  }
  if (diffIndex === -1) {
    return null; // identyczne — to byłby exact, nie typo
  }
  const answerToken = answerSeq[diffIndex];
  const variantToken = variantSeq[diffIndex];
  // Literówka nie może dotyczyć elementu sprawdzanego (ani po stronie wariantu,
  // ani odpowiedzi — oba warianty rozwinięcia focus są chronione).
  if (focusSet.has(variantToken) || focusSet.has(answerToken)) {
    return null;
  }
  if (editDistance(answerToken, variantToken) <= typoThresholdFor(variantToken)) {
    return answerToken;
  }
  return null;
}

/** Ocena typu zamkniętego po id poprawnej opcji. */
export function evaluateChoice(optionId: string, key: LessonAnswerKey): boolean {
  return key.correctOptionId !== undefined && optionId === key.correctOptionId;
}

/** Ocena układania z klocków: ta sama długość i kolejność co `key.itemIds`. */
export function evaluateSequence(itemIds: readonly string[], key: LessonAnswerKey): boolean {
  const expected = key.itemIds;
  if (expected === undefined || expected.length !== itemIds.length) {
    return false;
  }
  return expected.every((id, i) => id === itemIds[i]);
}

/** Schemat werdyktu modelu — nadmiarowe pola odcięte (`.strip` domyślny w zod). */
const verdictSchema = z.object({
  verdict: z.enum(["correct", "almost", "incorrect"]),
  errorCategory: z.string().nullable(),
  fragments: z.array(z.string().min(1)).max(MAX_FRAGMENTS),
  note: z.string().max(MAX_NOTE_LENGTH),
});

/**
 * Walidacja werdyktu modelu (design „Model oceniający”, wymagania 6.7).
 * Zwraca `GraderVerdict` tylko gdy: schemat się zgadza; kategoria ∈
 * `allowedCategories` ∪ {other} albo null; `correct` ⇒ kategoria null i brak
 * fragmentów; `incorrect` ⇒ kategoria niepusta; każdy fragment jest dokładnym
 * (z rozróżnieniem wielkości liter), niepustym podciągiem `childAnswer` po NFC.
 * Naruszenie → `null`. Nadmiarowe pola są odcięte, nie przekazywane dalej.
 */
export function validateVerdict(raw: unknown, ctx: VerdictContext): GraderVerdict | null {
  const parsed = verdictSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const { verdict, errorCategory, fragments, note } = parsed.data;

  if (errorCategory !== null) {
    const allowed = errorCategory === "other" || ctx.allowedCategories.includes(errorCategory);
    if (!allowed) {
      return null;
    }
  }

  if (verdict === "correct" && (errorCategory !== null || fragments.length > 0)) {
    return null;
  }
  if (verdict === "incorrect" && errorCategory === null) {
    return null;
  }

  const childAnswerNfc = ctx.childAnswer.normalize("NFC");
  for (const fragment of fragments) {
    if (!childAnswerNfc.includes(fragment.normalize("NFC"))) {
      return null;
    }
  }

  return { verdict, errorCategory, fragments, note };
}

/**
 * Mapowanie dopasowania deterministycznego na ocenę celu (design: tabela).
 * `no_match` NIE jest oceną — zwracamy `null`, żeby wywołujący musiał
 * eskalować do zapisanego werdyktu / modelu. `null` nigdy nie zostanie
 * pomylone z `ObjectiveGrade` (brak pola `outcome`), więc kształt jest
 * jednoznaczny (decyzja opisana w raporcie).
 */
export function gradeFromMatch(match: MatchResult): ObjectiveGrade | null {
  switch (match.kind) {
    case "exact":
      return { outcome: "correct", verdict: "exact" };
    case "minor_typo":
      return { outcome: "correct", verdict: "minor_typo" };
    case "no_match":
      return null;
  }
}

/**
 * Mapowanie werdyktu modelu (lub jego braku) na ocenę celu (design: tabela).
 * `null` (model niedostępny / timeout / odrzucony wynik) → nieocenione,
 * powód techniczny, bez kary.
 */
export function gradeFromVerdict(verdict: GraderVerdict | null): ObjectiveGrade {
  if (verdict === null) {
    return { outcome: "unevaluated", reason: "technical", verdict: "unavailable" };
  }
  switch (verdict.verdict) {
    case "correct":
      return { outcome: "correct", verdict: "model_correct" };
    case "almost":
      return { outcome: "correct", verdict: "model_almost" };
    case "incorrect":
      if (verdict.errorCategory !== null && verdict.errorCategory !== "other") {
        return { outcome: "incorrect", verdict: "model_incorrect", errorCategory: verdict.errorCategory };
      }
      // kategoria `other`: błąd poza celem → nieoceniane (design)
      return { outcome: "unevaluated", verdict: "model_other" };
  }
}

/** Suma OSA po tokenach przy wyrównaniu — tylko dla sekwencji tej samej długości. */
function tokenDistance(a: readonly string[], b: readonly string[]): number {
  if (a.length !== b.length) {
    // Różna długość: brak wyrównania tokenów. Kara proporcjonalna do różnicy
    // długości plus niezgodnych tokenów, by nadal wybrać „najbliższy”.
    const shared = Math.min(a.length, b.length);
    let distance = Math.abs(a.length - b.length);
    for (let i = 0; i < shared; i++) {
      distance += editDistance(a[i], b[i]);
    }
    return distance;
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    distance += editDistance(a[i], b[i]);
  }
  return distance;
}

/**
 * Najbliższy zatwierdzony wariant (najmniejsza odległość tokenowa; przy równej
 * odległości pierwszy w kolejności `answer, ...acceptedAnswers`). Zwraca
 * ORYGINALNY zapis wariantu (nie znormalizowany) — to on jest pokazywany
 * dziecku jako „poprawna odpowiedź”. Odległość liczona po najbliższej parze
 * sekwencji (odpowiedź × wariant) z normalizatora.
 */
export function closestApprovedVariant(
  answer: string,
  key: LessonAnswerKey,
  normalizer: AnswerNormalizer,
): string {
  const answerSequences = normalizer.normalize(answer);
  const variants = [key.answer, ...key.acceptedAnswers];
  let best = variants[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const variant of variants) {
    const variantSequences = normalizer.normalize(variant);
    let variantBest = Number.POSITIVE_INFINITY;
    for (const aSeq of answerSequences) {
      for (const vSeq of variantSequences) {
        variantBest = Math.min(variantBest, tokenDistance(aSeq, vSeq));
      }
    }
    if (variantBest < bestDistance) {
      bestDistance = variantBest;
      best = variant;
    }
  }
  return best;
}

/** Segment feedbacku: `pill` = fragment do wyróżnienia. */
export interface AnswerSegment {
  readonly text: string;
  readonly state: "plain" | "pill";
}

/**
 * Buduje segmenty `plain`/`pill` z odpowiedzi dziecka i listy fragmentów
 * (design „Ocena”, feedback). Fragmenty szukane po PIERWSZYM wystąpieniu, po
 * punktach kodowych; nakładające się fragmenty scalone; sąsiednie segmenty
 * tego samego stanu scalone; segmenty składają się dokładnie na `childAnswer`
 * i zachowują oryginalne znaki dziecka.
 *
 * Dopasowanie fragmentu jest bez rozróżniania wielkości liter (model/typo może
 * zwrócić token znormalizowany, a odpowiedź dziecka mieć wielkie litery), ale
 * TYLKO przy stabilnym `casefold` (jak `compareSpelling`); gdy casefold zmienia
 * liczbę punktów kodowych, indeksy by się rozjechały → zwracamy `null`.
 */
export function buildAnswerSegments(
  childAnswer: string,
  fragments: readonly string[],
): AnswerSegment[] | null {
  const chars = [...childAnswer];
  const n = chars.length;

  if (!casefoldStable(childAnswer) || fragments.some((fragment) => !casefoldStable(fragment))) {
    return null;
  }

  const lowerChars = chars.map((char) => char.toLowerCase());
  const pill = new Array<boolean>(n).fill(false);

  for (const fragment of fragments) {
    const fragChars = [...fragment].map((char) => char.toLowerCase());
    if (fragChars.length === 0) {
      continue;
    }
    // pierwsze wystąpienie
    for (let start = 0; start + fragChars.length <= n; start++) {
      let matched = true;
      for (let k = 0; k < fragChars.length; k++) {
        if (lowerChars[start + k] !== fragChars[k]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        for (let k = 0; k < fragChars.length; k++) {
          pill[start + k] = true; // nakładające się fragmenty naturalnie scalone
        }
        break;
      }
    }
  }

  const segments: AnswerSegment[] = [];
  for (let i = 0; i < n; i++) {
    const state: "plain" | "pill" = pill[i] ? "pill" : "plain";
    const last = segments[segments.length - 1];
    if (last !== undefined && last.state === state) {
      segments[segments.length - 1] = { text: last.text + chars[i], state };
    } else {
      segments.push({ text: chars[i], state });
    }
  }
  return segments.length > 0 ? segments : [{ text: "", state: "plain" }];
}
