import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  MockTestReportDtoSchema,
  type MockTestReportDto,
  DisclosureInputSchema,
  EventInputSchema,
  SessionSummaryDtoSchema,
  type DisclosureDto,
  type DisclosureInput,
  type EventInput,
  type SessionSummaryDto,
} from "@learning/contracts";
import type { Services } from "../config";
import type { Tx } from "../db/client";
import {
  deckVersions,
  eventExposures,
  itemRevisions,
  learningEvents,
  learningSessions,
  sessionTasks,
} from "../db/schema";
import { AppError } from "../errors";
import { computeTargetKey } from "../domain/target-key";

export interface SessionContextShape {
  mockTestReport?: MockTestReportDto;
  timezone: string;
  /** Data sprawdzianu przypięta przy rozpoczęciu nowej sesji; brak w legacy. */
  testDate?: string | null;
  previousContact: Record<string, string>;
  /** Klucze celów objęte aktywną rezerwacją należnego sprawdzenia. */
  reservations: string[];
  /** Klucze sprawdzeń rozliczonych w tej sesji (odpowiedź/pominięcie/podpowiedź). */
  settledChecks: string[];
  /** Niezmienny wynik jawnego zakończenia, zachowany także przy spóźnionej finalizacji mowy. */
  summary?: SessionSummaryDto;
}

export function contextOf(session: { context: Record<string, unknown> }): SessionContextShape {
  const raw = session.context as Partial<SessionContextShape>;
  const summary = SessionSummaryDtoSchema.safeParse(raw.summary);
  const report = MockTestReportDtoSchema.safeParse(raw.mockTestReport);
  return {
    timezone: typeof raw.timezone === "string" ? raw.timezone : "Europe/Warsaw",
    ...(typeof raw.testDate === "string" || raw.testDate === null ? { testDate: raw.testDate } : {}),
    previousContact: raw.previousContact ?? {},
    reservations: raw.reservations ?? [],
    settledChecks: raw.settledChecks ?? [],
    ...(summary.success ? { summary: summary.data } : {}),
    ...(report.success ? { mockTestReport: report.data } : {}),
  };
}

/** Rodzaje zdarzeń pisanych wyłącznie przez serwer (arch §9.2). */
export type ServerEventKind =
  | "contact"
  | "prompt_issued"
  | "audio_issued"
  | "hint_issued"
  | "feedback_issued"
  | "presentation_completed";

export interface SealedEventInput {
  childId: string;
  taskId: string;
  itemId: string;
  kind: ServerEventKind;
  stepId: string;
  occurredAt: Date;
  clientEventId?: string;
  /** Klucze ujawnianych celów — komplet przed jakąkolwiek odpowiedzią HTTP. */
  exposures: readonly string[];
}

/**
 * Zapisuje zdarzenie z kompletem ekspozycji i pieczęcią w jednej transakcji:
 * insert (sealed=false) → event_exposures → update (sealed=true). Dopiero commit
 * zwalnia odpowiedź HTTP — utracona odpowiedź sieciowa nie usuwa ujawnienia.
 */
export async function writeSealedEvent(tx: Tx, input: SealedEventInput): Promise<string> {
  const eventId = randomUUID();
  await tx.insert(learningEvents).values({
    id: eventId,
    childId: input.childId,
    taskId: input.taskId,
    itemId: input.itemId,
    clientEventId: input.clientEventId ?? null,
    sealed: false,
    stepId: input.stepId,
    kind: input.kind,
    occurredAt: input.occurredAt,
    context: {},
  });
  const exposures = [...new Set(input.exposures)];
  if (exposures.length > 0) {
    await tx.insert(eventExposures).values(
      exposures.map((targetKey) => ({ childId: input.childId, eventId, targetKey })),
    );
  }
  await tx.update(learningEvents).set({ sealed: true }).where(eq(learningEvents.id, eventId));
  return eventId;
}

/** Zadanie + blokada wiersza jego sesji — wspólna kolejność dla wszystkich operacji. */
export async function lockTaskWithSession(tx: Tx, taskId: string) {
  const task = (await tx.select().from(sessionTasks).where(eq(sessionTasks.id, taskId)))[0];
  if (!task) {
    throw new AppError("not_found");
  }
  const session = (
    await tx.select().from(learningSessions).where(eq(learningSessions.id, task.sessionId)).for("update")
  )[0]!;
  const revision = (
    await tx.select({ itemId: itemRevisions.itemId }).from(itemRevisions).where(eq(itemRevisions.id, task.itemRevisionId))
  )[0]!;
  // Stan zadania mógł zmienić się podczas oczekiwania na wspólną blokadę.
  // Snapshot treści jest niezmienny, ale drugi klient musi zobaczyć terminalny stan.
  const freshTask = (await tx.select().from(sessionTasks).where(eq(sessionTasks.id, taskId)))[0]!;
  return { task: freshTask, session, itemId: revision.itemId };
}

/** Obserwacja klienta (display_confirmed/audio_played) — opcjonalna, idempotentna. */
export async function recordEvent(services: Services, input: EventInput): Promise<void> {
  const valid = EventInputSchema.parse(input);
  await services.db.transaction(async (tx) => {
    const task = (await tx.select().from(sessionTasks).where(eq(sessionTasks.id, valid.taskId)))[0];
    if (!task) {
      throw new AppError("not_found");
    }
    const revision = (
      await tx.select({ itemId: itemRevisions.itemId }).from(itemRevisions).where(eq(itemRevisions.id, task.itemRevisionId))
    )[0]!;
    await tx
      .insert(learningEvents)
      .values({
        id: randomUUID(),
        childId: task.childId,
        taskId: task.id,
        itemId: revision.itemId,
        clientEventId: valid.clientEventId,
        sealed: true,
        stepId: valid.stepId ?? `${task.id}:observation`,
        kind: valid.kind,
        occurredAt: services.clock.now(),
        context: {},
      })
      .onConflictDoNothing({ target: [learningEvents.childId, learningEvents.clientEventId] });
  });
}

/**
 * Wydaje podpowiedź albo autoryzuje odtworzenie wzorca (arch §9.2). Serwer
 * określa stepId i zapisuje ekspozycję celu przed zwroceniem zgody; przeglądarka
 * nie odtwarza wzorca z cache bez tego potwierdzenia. Ponowne wywołanie
 * (reload, retry) rejestruje nowy czas możliwej ekspozycji.
 */
export async function authorizeDisclosure(services: Services, input: DisclosureInput): Promise<DisclosureDto> {
  const valid = DisclosureInputSchema.parse(input);
  return services.db.transaction(async (tx) => {
    const { task, session, itemId } = await lockTaskWithSession(tx, valid.taskId);
    if (session.state !== "active") {
      throw new AppError("conflict", { message: "session is closed" });
    }
    if (task.state !== "issued") {
      throw new AppError("conflict", { message: "task is no longer issued" });
    }
    if (session.mode === "mock_test" && (valid.kind === "hint" || task.exerciseType !== "listening")) {
      throw new AppError("conflict", { message: "Odpowiedzi omówimy po zakończeniu kartkówki." });
    }

    const revision = (
      await tx
        .select({ payload: itemRevisions.payload, targetLocale: deckVersions.targetLocale })
        .from(itemRevisions)
        .innerJoin(deckVersions, eq(deckVersions.id, itemRevisions.deckVersionId))
        .where(eq(itemRevisions.id, task.itemRevisionId))
    )[0]!;
    const target = (revision.payload as { target: string }).target;
    const targetKey = computeTargetKey(target, revision.targetLocale);

    const prior = await tx
      .select({ id: learningEvents.id })
      .from(learningEvents)
      .where(
        and(
          eq(learningEvents.taskId, task.id),
          inArray(learningEvents.kind, ["audio_issued", "hint_issued"]),
        ),
      );
    const stepId = `${task.id}:d${prior.length + 1}`;
    const now = services.clock.now();

    await writeSealedEvent(tx, {
      childId: task.childId,
      taskId: task.id,
      itemId,
      kind: valid.kind === "audio" ? "audio_issued" : "hint_issued",
      stepId,
      occurredAt: now,
      exposures: [targetKey],
    });

    // Podpowiedź zawsze ujawnia rozwiązanie, a odsłuch wzorca psuje samodzielność
    // przypomnienia/pisowni — rezerwacja należnego sprawdzenia jest zwalniana,
    // żeby cel mógł wrócić jako dystraktor, a sprawdzenie nie było wydawane
    // ponownie w tej sesji (arch §9.3).
    const spoilsCheck =
      valid.kind === "hint" || ["recall", "spelling", "letter_completion"].includes(task.exerciseType);
    if (spoilsCheck) {
      const context = contextOf(session);
      const reservations = context.reservations.filter((k) => k !== targetKey);
      const settledChecks = [...new Set([...context.settledChecks, targetKey])];
      if (reservations.length !== context.reservations.length || settledChecks.length !== context.settledChecks.length) {
        await tx
          .update(learningSessions)
          .set({ context: { ...context, reservations, settledChecks } as unknown as Record<string, unknown> })
          .where(eq(learningSessions.id, session.id));
      }
    }

    return {
      taskId: task.id,
      stepId,
      kind: valid.kind,
      reveal: valid.kind === "hint" ? { target } : null,
    };
  });
}
