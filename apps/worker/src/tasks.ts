import { cleanupExpiredActivityReports, runDueGenerationWork, type Services } from "@learning/server";

/**
 * Powiązanie zleconej pracy z przypadkami użycia serwera. Kolejka jest trwała
 * w tabelach generation_runs/media_assets (idempotencja aplikacji), więc ten
 * przelot jest bezpieczny do przerwania i powtórzenia po restarcie.
 */

/** Retencja szczegółów raportu aktywności czyścimy co najwyżej raz na godzinę. */
const ACTIVITY_CLEANUP_INTERVAL_MS = 60 * 60_000;
let lastActivityCleanupAt = 0;

export async function processDueWork(services: Services, signal?: AbortSignal, onProgress?: () => void): Promise<{ processed: number }> {
  const result = await runDueGenerationWork(services, {}, { signal, onProgress });
  if (result.processed > 0) {
    console.log(`[worker] przetworzono zadań w przelocie: ${result.processed}`);
  }
  const now = Date.now();
  if (now - lastActivityCleanupAt >= ACTIVITY_CLEANUP_INTERVAL_MS) {
    lastActivityCleanupAt = now;
    try {
      // Czyszczenie wygasłego JSONB raportu w ograniczonych partiach; sesja,
      // punkty i krótki wynik oceny zostają. Bez oceniania i bez modelu.
      const cleaned = await cleanupExpiredActivityReports(services);
      if (cleaned > 0) {
        console.log(`[worker] oczyszczono raportów aktywności: ${cleaned}`);
      }
    } catch (error) {
      // Czyszczenie jest odnawialne w kolejnym przelocie; nie blokuje generacji.
      console.error("[worker] nie udało się oczyścić raportów aktywności", error);
    }
  }
  return result;
}
