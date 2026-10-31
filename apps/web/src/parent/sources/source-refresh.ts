import { isSourceChangedError } from "../api";
import { isDefinitiveGenerationRejection } from "../generation-request";
import { httpStatusOf } from "../query-client";

/**
 * Wspólne reguły formularzy tworzenia ze źródła (lekcja, zestaw słówek): jak
 * rozumieć odrzucenie polecenia i wynik ponownego odczytu źródła po konflikcie
 * rewizji treści.
 */

/**
 * Wynik polecenia tworzenia, które nie skończyło się przyjęciem:
 * `source-missing` — źródło usunięto w innym oknie (404), `source-changed` —
 * tekst źródła zmieniono po wyświetleniu podglądu (409 z
 * `LessonSourceChangedDetails`), `rejected` — inne ostateczne odrzucenie,
 * `uncertain` — wynik nieznany (ponowienie tym samym poleceniem). Pierwsze dwa
 * są rozpoznawane tylko w trybie źródła; w żadnym z trzech ostatecznych zestaw
 * nie powstał, bo serwer sprawdza wcześniejsze polecenie z tym kluczem przed
 * odczytem źródła.
 */
export type CreateFailure = "source-missing" | "source-changed" | "rejected" | "uncertain";

export function classifyCreateFailure(cause: unknown, fromSource: boolean): CreateFailure {
  if (fromSource && httpStatusOf(cause) === 404) return "source-missing";
  if (fromSource && isSourceChangedError(cause)) return "source-changed";
  if (isDefinitiveGenerationRejection(cause)) return "rejected";
  return "uncertain";
}

/**
 * Wynik ponownego odczytu źródła po konflikcie rewizji (`onSourceChanged`):
 * `refreshed` — bieżące źródło z jego rewizją treści, `missing` — źródło
 * usunięto w innym oknie (404), `failed` — odczyt się nie udał, podgląd
 * pozostaje nieaktualny. Formularz wraca do tworzenia dopiero po `refreshed`
 * z rewizją inną niż odrzucona przez serwer (`isFreshSourceRefresh`).
 */
export type SourceRefreshOutcome =
  | { status: "refreshed"; bodyRevision: number }
  | { status: "missing" }
  | { status: "failed" };

/**
 * Wynik `refetch()` odczytu źródła jako `SourceRefreshOutcome`. `refetch()` nie
 * odrzuca obietnicy przy błędzie, a dane poprzedniego odczytu zostają — o
 * wyniku decyduje błąd tego odczytu, nie obecność danych.
 */
export function sourceRefreshOutcome(result: { isError: boolean; error: unknown; data: { bodyRevision: number } | undefined }): SourceRefreshOutcome {
  if (result.isError) return httpStatusOf(result.error) === 404 ? { status: "missing" } : { status: "failed" };
  return result.data !== undefined ? { status: "refreshed", bodyRevision: result.data.bodyRevision } : { status: "failed" };
}

/**
 * Odczyt przyniósł tekst nowszy niż odrzucony (`stale` — rewizja z polecenia,
 * które serwer odrzucił 409). Odczyt z tą samą rewizją to wciąż nieaktualny
 * podgląd (np. odpowiedź z pamięci podręcznej), więc liczy się jak nieudany.
 */
export function isFreshSourceRefresh(outcome: SourceRefreshOutcome, stale: number | null): boolean {
  return outcome.status === "refreshed" && outcome.bodyRevision !== stale;
}
