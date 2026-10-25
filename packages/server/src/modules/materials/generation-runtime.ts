import { z } from "zod";
import type { GenerationDeps, Services } from "../../config";
import { AppError } from "../../errors";

/** Maksymalnie trzy automatyczne próby; dalsze tylko po ręcznym ponowieniu. */
export const MAX_AUTOMATIC_ATTEMPTS = 3;

export function requireGeneration(services: Services): GenerationDeps {
  if (!services.generation) {
    throw new AppError("internal", { message: "generation dependencies not configured" });
  }
  return services.generation;
}

/** Walidacja wyniku AI to porażka terminalna; pozostałe błędy są powtarzalne. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof z.ZodError) {
    return "validation";
  }
  if (error instanceof AppError && error.code === "validation") {
    return "validation";
  }
  return "provider";
}