import {
  messages,
  MAX_SCHOOL_MATERIAL_LENGTH,
  MAX_SOURCE_TITLE_LENGTH,
  type SourceMaterialInput,
  type SourceMaterialPatch,
} from "@learning/contracts";
import { polishPlural } from "../deck-list-grouping";
import type { ParentRoute } from "../parent-routes";

/**
 * Czysta logika zakładki „Źródła” (design 2026-10-30 §3.4): walidacja pól,
 * patch tylko zmienionych pól, teksty z liczbami i adresy tworzenia lekcji.
 */

export const SOURCE_TITLE_MAX = MAX_SOURCE_TITLE_LENGTH;
export const SOURCE_BODY_MAX = MAX_SCHOOL_MATERIAL_LENGTH;

/** Przedmioty, z których przyciski strony źródła otwierają formularz nowej lekcji. */
export const CHAPTER_SUBJECT_ID = "english_chapter";
export const SCHOOL_SUBJECT_ID = "school";

export interface SourceFormValues {
  title: string;
  body: string;
}

/** Tytuł 1–120 i tekst 1–16000 znaków po obcięciu spacji (jak kontrakt i CHECK-i bazy). */
export function sourceValuesValid(values: SourceFormValues): boolean {
  const title = values.title.trim().length;
  const body = values.body.trim().length;
  return title > 0 && title <= SOURCE_TITLE_MAX && body > 0 && body <= SOURCE_BODY_MAX;
}

/**
 * Edycja źródła: tylko pola różne od zapisanych (po obcięciu spacji, jak na
 * serwerze). `null`, gdy nie ma czego wysłać — pusty zapis podbiłby rewizję
 * i oznaczył zestawy z tego źródła jako utworzone ze starszej wersji.
 */
export function sourcePatch(
  source: { title: string; body: string; revision: number },
  values: SourceFormValues,
): SourceMaterialPatch | null {
  const title = values.title.trim();
  const body = values.body.trim();
  const titleChanged = title !== source.title;
  const bodyChanged = body !== source.body;
  if (!titleChanged && !bodyChanged) return null;
  return {
    expectedRevision: source.revision,
    ...(titleChanged ? { title } : {}),
    ...(bodyChanged ? { body } : {}),
  };
}

/** Polecenie utworzenia źródła z nowym kluczem idempotencji (ponowienie wysyła to samo polecenie). */
export function newSourceCommand(values: SourceFormValues): SourceMaterialInput {
  return { clientRequestId: crypto.randomUUID(), title: values.title.trim(), body: values.body.trim() };
}

export function sourceCounter(length: number): string {
  return messages.sources.counter.replace("{n}", String(length));
}

export function deleteConfirmText(deckCount: number): string {
  return messages.sources.deleteConfirm.replace("{n}", String(deckCount));
}

export function deckCountLabel(count: number): string {
  return (messages.sources.deckCount[polishPlural(count)] ?? "{n}").replace("{n}", String(count));
}

const DATE_FORMAT = new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Data zmiany źródła (chwila z serwera) w strefie przeglądarki: DD.MM.RRRR. */
export function formatSourceDate(instant: string): string {
  return DATE_FORMAT.format(new Date(instant));
}

/** Formularz nowej lekcji z tekstem źródła i przedmiotem wybranym przyciskiem. */
export function newLessonFromSource(sourceId: string, kind: "chapter" | "school"): ParentRoute {
  return {
    section: "decks",
    newLesson: true,
    sourceId,
    subjectId: kind === "chapter" ? CHAPTER_SUBJECT_ID : SCHOOL_SUBJECT_ID,
  };
}

/**
 * Wynik polecenia jest niepewny bez odpowiedzi (sieć, limit czasu) albo przy
 * błędzie serwera (5xx) — wtedy ponowienie wysyła to samo polecenie. Odpowiedź
 * 4xx (sesja, walidacja, konflikt) jest ostateczna: polecenie nie zostało wykonane.
 */
export function isUncertainFailure(status: number | undefined): boolean {
  return status === undefined || status >= 500;
}
