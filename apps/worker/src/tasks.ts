import { runDueGenerationWork, type Services } from "@learning/server";

/**
 * Powiązanie zleconej pracy z przypadkami użycia serwera. Kolejka jest trwała
 * w tabelach generation_runs/media_assets (idempotencja aplikacji), więc ten
 * przelot jest bezpieczny do przerwania i powtórzenia po restarcie.
 */
export async function processDueWork(services: Services, signal?: AbortSignal, onProgress?: () => void): Promise<{ processed: number }> {
  const result = await runDueGenerationWork(services, {}, { signal, onProgress });
  if (result.processed > 0) {
    console.log(`[worker] przetworzono zadań w przelocie: ${result.processed}`);
  }
  return result;
}
