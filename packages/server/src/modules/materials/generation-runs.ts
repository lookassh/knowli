import { and, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Clock } from "../../config";
import type { Database, Executor, Tx } from "../../db/client";
import { generationRuns } from "../../db/schema";

/**
 * Współdzielony cykl życia wierszy `generationRuns` dla wykonawców słówek,
 * lekcji i mediów: idempotentne zlecanie, atomowe przejęcie (claim CAS),
 * oznaczanie stanu i unieważnianie runów lekcji. Wykonawcy treści zależą od
 * tego pliku; on nie zna żadnego z nich ani koordynatora workera, więc
 * moduł lekcji nie musi importować wykonawcy słówek (`generation.ts`).
 */

/**
 * Idempotentne zlecenie runu generacji szkicu pod kluczem `dedupeKey`
 * (`deck:<id>` / `lesson:<id>`). Wspólny szkielet dla słówek i lekcji: jeśli run
 * o tym kluczu istnieje i zna swój `deckId`, zwraca go; inaczej otwiera własną
 * transakcję i woła `create(tx)` (wstawia deck/wersję/run). Przy równoległym
 * duplikacie klucza (`23505`) transakcja przegranego wycofuje się, a zwycięzcę
 * odczytujemy świeżym zapytaniem POZA wycofaną transakcją (w aborted tx nie da
 * się już nic odczytać). Jedna obsługa wyścigu idempotencji — moduł lekcji jej
 * używa zamiast kopiować. `create` zwraca `{ runId, deckId }`.
 */
export async function enqueueGenerationRun(
  db: Database,
  dedupeKey: string,
  create: (tx: Tx) => Promise<{ runId: string; deckId: string }>,
): Promise<{ runId: string; deckId: string }> {
  const found = await findEnqueuedRun(db, dedupeKey);
  if (found) {
    return found;
  }
  try {
    return await db.transaction(async (tx) => create(tx));
  } catch (error) {
    // równoległy duplikat klucza idempotencji: transakcja już wycofana, więc
    // zwycięzcę czytamy świeżym zapytaniem na połączeniu bazowym. Drizzle
    // opakowuje błąd pg, więc kod bywa na error.cause (jak w upsertAssignment).
    const pgCode =
      (error as { code?: string }).code ??
      (error as { cause?: { code?: string } }).cause?.code;
    if (pgCode === "23505") {
      const winner = await findEnqueuedRun(db, dedupeKey);
      if (winner) {
        return winner;
      }
    }
    throw error;
  }
}

/**
 * Odczyt istniejącego runu po kluczu idempotencji, jeśli zna swój `deckId`.
 * Poza `enqueueGenerationRun` korzysta z niego tworzenie lekcji ze źródła
 * (ponowienie po równoległym usunięciu źródła, `createMaterialLesson`).
 */
export async function findEnqueuedRun(
  db: Executor,
  dedupeKey: string,
): Promise<{ runId: string; deckId: string } | null> {
  const existing = (
    await db.select().from(generationRuns).where(eq(generationRuns.dedupeKey, dedupeKey))
  )[0];
  const deckId = (existing?.input as { deckId?: string } | undefined)?.deckId;
  if (existing && deckId) {
    return { runId: existing.id, deckId };
  }
  return null;
}

export async function markRun(
  db: Executor,
  clock: Clock,
  runId: string,
  state: "succeeded" | "failed" | "superseded" | "queued",
  errorCode: string | null,
): Promise<void> {
  await db
    .update(generationRuns)
    .set({
      state,
      errorCode,
      nextAttemptAt: null,
      finishedAt: state === "queued" ? null : clock.now(),
    })
    .where(eq(generationRuns.id, runId));
}

/**
 * Called only while the owning deck version is locked. A parent edit or a
 * successful generation makes outstanding runs for that edit stale before
 * they can publish their result.
 */
export async function supersedeLessonRuns(
  db: Executor,
  deckVersionId: string,
  finishedAt: Date,
  exceptRunId?: string,
): Promise<void> {
  await db.update(generationRuns)
    .set({ state: "superseded", errorCode: null, finishedAt })
    .where(and(
      eq(generationRuns.kind, "lesson"),
      eq(generationRuns.deckVersionId, deckVersionId),
      inArray(generationRuns.state, ["queued", "running"]),
      exceptRunId ? ne(generationRuns.id, exceptRunId) : undefined,
    ));
}

/**
 * Claim CAS runu generacji szkicu (deck/lesson): `queued → running` + inkrement
 * prób. Zwraca liczbę prób po claimie, albo `null`, gdy run nie był `queued`
 * (inny worker już go zabrał). Współdzielone przez ścieżkę słówek i lekcji —
 * jedna implementacja atomowego przejęcia zamiast kopii w module lekcji.
 */
export async function claimQueuedRun(db: Executor, runId: string, expectedEditNumber?: number, now?: Date): Promise<number | null> {
  const claimed = await db
    .update(generationRuns)
    .set({ state: "running", attempts: sql`${generationRuns.attempts} + 1` })
    .where(and(
      eq(generationRuns.id, runId),
      eq(generationRuns.state, "queued"),
      expectedEditNumber === undefined ? undefined : eq(generationRuns.expectedEditNumber, expectedEditNumber),
      now === undefined ? undefined : or(isNull(generationRuns.nextAttemptAt), lte(generationRuns.nextAttemptAt, now)),
    ))
    .returning({ attempts: generationRuns.attempts });
  return claimed[0]?.attempts ?? null;
}
