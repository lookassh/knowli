/**
 * Trener precyzji (design przedmiotów szkolnych, sekcja 6.3): czyste reguły
 * zadania następczego „Skróć swoją odpowiedź”. Bez bazy i zegara — moduł
 * silnika lekcji podaje jawnie stan sesji i szczegóły oceny.
 */

/** Ile ocenionych zadań zostaje, gdy klient obiecuje „Jeszcze N i koniec!”. */
export const SESSION_PROMISE_REMAINING = 3;

/** Szczegóły oceny odpowiedzi otwartej szkoły potrzebne regułom trenera. */
export interface SchoolAssessmentDetails {
  readonly knowledge?: unknown;
  readonly precision?: unknown;
  readonly redundantFragments?: unknown;
  /** Fragmenty niezwiązane z pytaniem (werdykt v3). */
  readonly offTopicFragments?: unknown;
  readonly formOk?: unknown;
  readonly matchedElementIds?: unknown;
  readonly missingElementIds?: unknown;
}

export interface ShortenOfferInput {
  readonly trainingSession: boolean;
  /** Ocena dotyczy zadania następczego — poprawka nie rodzi kolejnej poprawki. */
  readonly followUp: boolean;
  readonly details: SchoolAssessmentDetails;
  readonly graderCallsLeft: number;
  /**
   * Ocenione zadania planu do końca sesji łącznie z tym, na które dziecko
   * właśnie odpowiedziało (jak `remainingAssessed` zadania; bez zadań następczych).
   * Przy ≤ 3 klient pokazuje już „Jeszcze N i koniec!”.
   */
  readonly remainingWithThisTask: number;
}

/**
 * Czy po tej odpowiedzi zaproponować skrócenie: wiedza poprawna, precyzja
 * rozwlekła lub nie na temat, a do usunięcia jest co najmniej jeden fragment
 * zbędny lub niezwiązany z pytaniem albo naruszona forma jednego zdania.
 * Tylko w treningu, z wywołaniem gradera na poprawkę i poza fazą obietnicy
 * końca sesji.
 */
export function shouldOfferShorten(input: ShortenOfferInput): boolean {
  if (!input.trainingSession || input.followUp) return false;
  if (input.graderCallsLeft < 1 || input.remainingWithThisTask <= SESSION_PROMISE_REMAINING) return false;
  const { knowledge, precision } = input.details;
  if (knowledge !== "correct" || (precision !== "verbose" && precision !== "unfocused")) return false;
  return removableFragments(input.details).length > 0 || input.details.formOk === false;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Fragmenty do usunięcia w poprawce: zbędne i niezwiązane z pytaniem (design §9.2). */
export function removableFragments(details: SchoolAssessmentDetails): { redundant: string[]; offTopic: string[]; length: number } {
  const redundant = stringList(details.redundantFragments);
  const offTopic = stringList(details.offTopicFragments);
  return { redundant, offTopic, length: redundant.length + offTopic.length };
}

/** Porównanie poprawki z oryginałem: NFC, białe znaki, wielkość liter. */
function comparable(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pl-PL");
}

/** Poprawka identyczna z oryginałem nie jest próbą skrócenia (bez oceny i modelu). */
export function isUnchangedRevision(original: string, revision: string): boolean {
  return comparable(original) === comparable(revision);
}

export interface RevisionComparison {
  /** Elementy wymagane trafione w oryginale, a brakujące w poprawce (N07). */
  readonly lostElementIds: readonly string[];
  /** Czy poprawka jest krótsza od oryginału (w znakach, po przycięciu). */
  readonly shorter: boolean;
}

/** Porównuje ocenę poprawki z oceną oryginału. */
export function compareRevision(args: {
  readonly originalMatchedElementIds: readonly string[];
  readonly originalAnswer: string;
  readonly revisionAnswer: string;
  readonly revisionDetails: SchoolAssessmentDetails;
}): RevisionComparison {
  const missing = new Set(stringList(args.revisionDetails.missingElementIds));
  return {
    lostElementIds: args.originalMatchedElementIds.filter((id) => missing.has(id)),
    shorter: [...args.revisionAnswer.trim()].length < [...args.originalAnswer.trim()].length,
  };
}

/** Identyfikatory elementów trafionych w szczegółach oceny (odporne na stare wpisy). */
export function matchedElementIdsOf(details: SchoolAssessmentDetails): string[] {
  return stringList(details.matchedElementIds);
}
