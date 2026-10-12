import type { ErrorCategory, ErrorCategoryCode } from "./types";

/**
 * Kategorie błędów wspólne dla wszystkich przedmiotów (design: „Przedmiot
 * i katalog”). Dostępne każdemu celowi bez deklarowania ich w przedmiocie.
 * `other` to kategoria specjalna werdyktu modelu (błąd poza celem → nieoceniane).
 */
export const BASE_ERROR_CATEGORIES: readonly ErrorCategory[] = [
  { code: "other", labelPl: "Inny błąd" },
  { code: "incomplete", labelPl: "Niepełna odpowiedź" },
  { code: "wrong_order", labelPl: "Zła kolejność" },
];

/** Kody kategorii bazowych, do szybkiego sprawdzenia przynależności. */
export const BASE_ERROR_CATEGORY_CODES: ReadonlySet<ErrorCategoryCode> = new Set(
  BASE_ERROR_CATEGORIES.map((category) => category.code),
);
