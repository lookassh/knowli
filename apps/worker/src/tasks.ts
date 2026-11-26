import { cleanupExpiredActivityReports, cleanupExpiredParentSessions, runDueGenerationWork, type Services } from "@learning/server";

/**
 * Powiązanie zleconej pracy z przypadkami użycia serwera. Kolejka jest trwała
 * w tabelach generation_runs/media_assets (idempotencja aplikacji), więc ten
 * przelot jest bezpieczny do przerwania i powtórzenia po restarcie.
 */

/** Retencję raportów aktywności i wygasłe sesje rodzica czyścimy co najwyżej raz na godzinę. */
const CLEANUP_INTERVAL_MS = 60 * 60_000;
let lastCleanupAt = 0;

export async function processDueWork(services: Services, signal?: AbortSignal, onProgress?: () => void): Promise<{ processed: number }> {
  const result = await runDueGenerationWork(services, {}, { signal, onProgress });
  if (result.processed > 0) {
    console.log(`[worker] przetworzono zadań w przelocie: ${result.processed}`);
  }
  const now = Date.now();
  if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
    lastCleanupAt = now;
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
    try {
      const removed = await cleanupExpiredParentSessions(services);
      if (removed > 0) {
        console.log(`[worker] usunięto wygasłych sesji rodzica: ${removed}`);
      }
    } catch (error) {
      console.error("[worker] nie udało się usunąć wygasłych sesji rodzica", error);
    }
  }
  return result;
}
