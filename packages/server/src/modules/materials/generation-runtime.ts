import { z } from "zod";
import type { GenerationDeps, Services } from "../../config";
import { AppError } from "../../errors";
import { classifyLessonGenerationFailure, lessonRetryDelayMs } from "./lessons/lesson-generation-errors";

/** Maksymalnie trzy automatyczne próby; dalsze tylko po ręcznym ponowieniu. */
export const MAX_AUTOMATIC_ATTEMPTS = 3;

/** Termin ponowienia zestawu i mediów: ten sam backoff co w lekcjach, z `Retry-After` providera (#300). */
export function retryAt(services: Services, attempts: number, error: unknown): Date {
  const delay = lessonRetryDelayMs(attempts, classifyLessonGenerationFailure(error).retryAfterMs, Math.random);
  return new Date(services.clock.now().getTime() + delay);
}

export function requireGeneration(services: Services): GenerationDeps {
  if (!services.generation) {
    throw new AppError("internal", { message: "generation dependencies not configured" });
  }
  return services.generation;
}

/** Kody systemowe zapisu na wolumenie mediów: awaria dysku/uprawnień, nie providera (#385). */
const MEDIA_STORAGE_CODES = new Set(["ENOSPC", "EACCES", "EROFS"]);

/** Szuka kodu systemowego w błędzie i jego łańcuchu `cause` (błędy fs bywają opakowane). */
function hasMediaStorageCode(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && MEDIA_STORAGE_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Walidacja wyniku AI i błąd zapisu mediów to porażki terminalne; pozostałe
 * błędy są powtarzalne. `media_storage` nie może wracać do kolejki, bo każda
 * kolejna próba płaciłaby providerowi za generację, której nie da się zapisać.
 */
export function errorCodeOf(error: unknown): string {
  if (hasMediaStorageCode(error)) {
    return "media_storage";
  }
  if (error instanceof z.ZodError) {
    return "validation";
  }
  if (error instanceof AppError && error.code === "validation") {
    return "validation";
  }
  return "provider";
}
