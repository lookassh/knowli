import { AppError, type Services } from "@learning/server";

/**
 * Resztka routera Parent API pod /api/v1/parent/* (arch §12) po dokończeniu
 * migracji oRPC v2 (zadanie 11): wszystkie grupy kontraktu (children, decks,
 * drafts, mock-tests, work-card, lesson-catalog, lessons, lesson-verdicts,
 * lesson-drafts, generation, assignments, progress) serwuje
 * `../orpc/parent-router` w catch-all z priorytetem. Ten fallback pozostaje
 * wywoływany tylko dla ścieżek spoza kontraktu — semantyka 1:1 z końcówką
 * starego dispatchu: `not_found` dla zewnętrznej granicy `withApi`
 * (dekomisja fallbacku: zadanie 13; logowanie/setup/logout to trasy
 * statyczne poza catch-all, migruje je zadanie 12).
 */
export async function handleParentApi(
  _request: Request,
  _services: Services,
  _segments: string[],
): Promise<Response> {
  throw new AppError("not_found");
}
