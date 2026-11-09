import type { LessonExposureSource } from "../../types";
import { trimTrailing } from "./text";

/**
 * Wspólne składowe tekstu ekspozycji przedmiotów angielskich (rozdział
 * i gramatyka): dziecko „widzi rozwiązane” całe zdanie, a nie pojedyncze
 * słowo. Normalizacja jest kontraktem utrwalonym w `target_key` rozdziału —
 * zmiana jej kształtu wymaga decyzji o migracji kluczy.
 */

/** Luka w zdaniu: ciąg 2+ podkreśleń (ta sama reguła co `cloze.ts` i Kid UI). */
const GAP = /_{2,}/u;
/** Końcowa interpunkcja ekspozycji; białe znaki są już zredukowane do spacji. */
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set([".", "!", "?", "…", " "]);
/** Typograficzne apostrofy i pojedyncze cudzysłowy → `'`. */
const SINGLE_QUOTES = /[‘’‚‛]/gu;
/** Typograficzne cudzysłowy (także polski „) → `"`. */
const DOUBLE_QUOTES = /[“”„‟]/gu;

/**
 * Normalizacja tekstu ekspozycji (`SubjectModule.normalizeExposureText`):
 * NFC, prosty apostrof i cudzysłów zamiast typograficznych, jedna spacja
 * zamiast białych znaków, bez zewnętrznych spacji i bez końcowej interpunkcji
 * `.!?…`. Ta sama funkcja obsługuje ćwiczenia i przykłady kart, więc przykład
 * „I’m wearing a pink coat.” i luka rozwiązana do „I'm wearing a pink coat”
 * mają jeden klucz. Idempotentna.
 */
export function normalizeEnglishExposureText(text: string): string {
  const collapsed = text
    .normalize("NFC")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/\s+/gu, " ")
    .trim();
  return trimTrailing(collapsed, TRAILING_PUNCTUATION);
}

/** Czy bodziec ma znacznik luki (`___`). */
export function hasGapMarker(stem: string | undefined): boolean {
  return stem !== undefined && GAP.test(stem);
}

/** Zdanie ze wstawionym słowem w miejsce luki; zdanie bez luki daje samo słowo. */
export function fillGapStem(stem: string | undefined, word: string): string {
  return hasGapMarker(stem) ? stem!.replace(GAP, () => word) : word;
}

/** Tekst poprawnej opcji wyboru; bez niej — odpowiedź kanoniczna. */
export function correctOptionText(draft: LessonExposureSource): string {
  return draft.options?.find((option) => option.id === draft.correctOption)?.text ?? draft.answer;
}
