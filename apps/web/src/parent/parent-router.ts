import { AppError, type Services } from "@learning/server";

/**
 * Resztka routera Parent API pod /api/v1/parent/* (arch §12) po dokończeniu
 * migracji oRPC v2 (zadania 11–12): wszystkie grupy kontraktu, w tym auth
 * (login/setup/logout), serwuje `../orpc/parent-router` w catch-all.
 * Ten fallback pozostaje wywoływany tylko dla ścieżek spoza kontraktu —
 * semantyka 1:1 z końcówką starego dispatchu: `not_found` dla zewnętrznej
 * granicy `withApi` (dekomisja fallbacku: zadanie 13).
 */
export async function handleParentApi(
  _request: Request,
  _services: Services,
  _segments: string[],
): Promise<Response> {
  throw new AppError("not_found");
}
