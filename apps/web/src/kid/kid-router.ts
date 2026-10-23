import { AppError, type Services } from "@learning/server";

/**
 * Resztka routera Kid API pod /api/v1/kid/* (arch §12) po dokończeniu
 * migracji oRPC v2: cały kontrakt (odczyty, sesje, zadania, próby z multipartem
 * nagrań) serwuje `../orpc/kid-router` w catch-all z priorytetem. Ten fallback
 * pozostaje wywoływany tylko dla ścieżek spoza kontraktu — semantyka 1:1 z
 * końcówką starego dispatchu: `not_found` dla zewnętrznej granicy `withApi`.
 */
export async function handleKidApi(
  _request: Request,
  _services: Services,
  _segments: string[],
): Promise<Response> {
  throw new AppError("not_found");
}
