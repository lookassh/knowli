import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AttemptInput } from "@learning/contracts";
import type { Tx } from "../../db/client";
import { learningEvents, sessionTasks } from "../../db/schema";
import { writeSealedEvent } from "./events";

/**
 * Pomocniki przyjęcia odpowiedzi wspólne dla ścieżki słówek (`attempts.ts`) i
 * ścieżki lekcji (`lessons/lesson-attempts.ts`). Wydzielone, nie skopiowane:
 * jedno `requestHashOf` zna wszystkie modalności (w tym `sequence` lekcji),
 * a `discloseFeedbackEvent` to generyczny zapis zapieczętowanego `feedback_issued`
 * z ekspozycją ustaloną przez wywołującego. Zachowanie słówek bez zmian: ścieżka
 * słówek nigdy nie wysyła `sequence`, więc rozszerzenie hasza jej nie dotyka.
 */

type TaskRow = typeof sessionTasks.$inferSelect;

/**
 * Deterministyczny hasz treści próby dla idempotencji `clientAttemptId`
 * (arch §10): ta sama treść → ten sam hasz; inna treść pod tym samym kluczem
 * → 409. Obejmuje `optionId` (choice), `text` (text) i `itemIds` (sequence);
 * pozostałe modalności nie niosą treści.
 */
export function requestHashOf(input: AttemptInput): string {
  const payload =
    input.modality === "choice"
      ? { optionId: input.optionId }
      : input.modality === "text"
        ? { text: input.text }
        : input.modality === "sequence"
          ? { itemIds: input.itemIds }
          : {};
  return createHash("sha256")
    .update(JSON.stringify({ taskId: input.taskId, modality: input.modality, ...payload }))
    .digest("hex");
}

/**
 * Zapisuje zapieczętowane zdarzenie `feedback_issued` z podaną listą ekspozycji
 * PRZED odpowiedzią HTTP (arch §9.2). `stepId` liczony z liczby wcześniejszych
 * zdarzeń feedbacku tego zadania — kolejne odczyty/retry dokładają nowy krok,
 * tak jak dla słówek. Zwraca `stepId`.
 */
export async function discloseFeedbackEvent(
  tx: Tx,
  args: { task: TaskRow; childId: string; itemId: string; exposures: readonly string[]; now: Date },
): Promise<string> {
  const prior = await tx
    .select({ id: learningEvents.id })
    .from(learningEvents)
    .where(and(eq(learningEvents.taskId, args.task.id), eq(learningEvents.kind, "feedback_issued")));
  const stepId = `${args.task.id}:f${prior.length + 1}`;
  await writeSealedEvent(tx, {
    childId: args.childId,
    taskId: args.task.id,
    itemId: args.itemId,
    kind: "feedback_issued",
    stepId,
    occurredAt: args.now,
    exposures: args.exposures,
  });
  return stepId;
}
