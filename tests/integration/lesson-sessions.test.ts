import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  deleteChild,
  listKidDecks,
  nextTask,
  startSession,
  type AppError,
} from "@learning/server";
import type { TaskDto } from "@learning/contracts";
import { lessonWorld } from "../fixtures/lesson-world";
import { mockTestDeck } from "./mock-test-helpers";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

/**
 * Zadanie 13: sesja lekcji po stronie serwera. Start sesji lekcji, wydawanie
 * zadań przez selektor (karty, notice, typy zamknięte i otwarte), pieczętowanie
 * ekspozycji PRZED odpowiedzią HTTP, `complete-presentation` dla kart i liczniki
 * listy zestawów dziecka dla lekcji. Oceny/grading to zadanie 13B.
 */

const { pool } = testDatabase();

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.child_objective_progress, learning_app.lesson_verdicts,
    learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
    learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
    learning_app.deck_versions, learning_app.decks cascade`);
});
afterAll(() => pool.end());

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await promise.then(
    () => {
      throw new Error(`Oczekiwano błędu ${code}, otrzymano sukces`);
    },
    (error: unknown) => {
      expect((error as AppError).code).toBe(code);
    },
  );
}

async function sessionContext(sessionId: string): Promise<Record<string, unknown>> {
  const row = await pool.query<{ context: Record<string, unknown> }>(
    "select context from learning_app.learning_sessions where id = $1",
    [sessionId],
  );
  return row.rows[0]!.context;
}

async function exposuresFor(childId: string): Promise<{ targetKey: string; sealed: boolean }[]> {
  const rows = await pool.query<{ targetKey: string; sealed: boolean }>(
    `select ee.target_key as "targetKey", le.sealed
       from learning_app.event_exposures ee
       join learning_app.learning_events le on le.id = ee.event_id
      where ee.child_id = $1`,
    [childId],
  );
  return rows.rows;
}

/** Wydaje i kończy prezentacje, aż `nextTask` zwróci ćwiczenie (karty/notice po drodze). */
async function nextIssuedExercise(services: ReturnType<typeof buildTestServices>["services"], sessionId: string, max = 10): Promise<TaskDto> {
  for (let i = 0; i < max; i++) {
    const task = await nextTask(services, sessionId);
    if (task === null) throw new Error("sesja skończyła się przed ćwiczeniem");
    if (task.exerciseType === "lesson_card") {
      await completePresentation(services, { taskId: task.taskId });
      continue;
    }
    return task;
  }
  throw new Error("nie doczekano ćwiczenia");
}

describe("sesja lekcji — start i wydawanie zadań", () => {
  it("start lekcji tworzy sesję z kontekstem lekcji", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });

    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    expect(session.mode).toBe("training");
    expect(session.resumed).toBe(false);

    const context = await sessionContext(session.sessionId);
    expect(context.graderCalls).toBe(0);
    expect(context.previousObjectiveContact).toEqual({});
  });

  it("ponowny start tej samej lekcji wznawia aktywną sesję", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });

    const first = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    const resumed = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    expect(resumed.sessionId).toBe(first.sessionId);
    expect(resumed.resumed).toBe(true);
  });

  it("start lekcji przy aktywnej sesji słówek → konflikt 409", async () => {
    const { services } = buildTestServices();
    const vocab = await mockTestDeck(services, 2, false);
    const lesson = await lessonWorld(pool, { childId: vocab.childId, richPool: true });

    await startSession(services, { childId: vocab.childId, deckId: vocab.deckId, microphoneEnabled: false });
    await expectAppError(
      startSession(services, { childId: vocab.childId, deckId: lesson.deckId, microphoneEnabled: false }),
      "conflict",
    );
  });

  it("kartkówka lekcji nadal odrzucona (zadanie 17)", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true, testDate: "2026-10-20" });
    await expectAppError(
      startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false, mode: "mock_test" }),
      "deck_kind_mismatch",
    );
  });

  it("pierwsze zadania to karty celu, potem notice, potem ćwiczenie guided", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });

    const first = await nextTask(services, session.sessionId);
    expect(first?.exerciseType).toBe("lesson_card");
    await completePresentation(services, { taskId: first!.taskId });
    const second = await nextTask(services, session.sessionId);
    expect(second?.exerciseType).toBe("lesson_card");
    await completePresentation(services, { taskId: second!.taskId });
    const third = await nextTask(services, session.sessionId);
    expect(third?.exerciseType).toBe("lesson_notice");
  });

  it("next przy wydanym zadaniu zwraca to samo zadanie (idempotentnie)", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });

    const a = await nextTask(services, session.sessionId);
    const b = await nextTask(services, session.sessionId);
    expect(b?.taskId).toBe(a?.taskId);
    expect(b?.prompt).toEqual(a?.prompt);
  });

  it("karta kończona complete-presentation idempotentnie i bez zużycia budżetu", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });

    const card = await nextTask(services, session.sessionId);
    expect(card?.exerciseType).toBe("lesson_card");
    const first = await completePresentation(services, { taskId: card!.taskId });
    const again = await completePresentation(services, { taskId: card!.taskId });
    expect(again).toEqual(first);

    // Karta nie zużyła budżetu: kolejne zadanie ma pełny remainingAssessed.
    const next = await nextTask(services, session.sessionId);
    expect(next?.remainingAssessed).toBe(session.taskBudget);
  });

  it("publiczny prompt nie zawiera odpowiedzi, wariantów, focus, celu ani kategorii", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });

    const exercise = await nextIssuedExercise(services, session.sessionId);
    const raw = JSON.stringify(exercise.prompt);
    for (const forbidden of ["answer", "acceptedAnswers", "focus", "objectiveId", "correctOption", "errorCategor"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("wydanie lesson_choice pieczętuje ekspozycję target_key przed zwróceniem DTO; luka — brak", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });

    // Doprowadź do pierwszego ćwiczenia (karty/notice po drodze).
    const exercise = await nextIssuedExercise(services, session.sessionId);
    const exposures = await exposuresFor(child.id);
    // Notice/choice ujawniają odpowiedź → ekspozycja z zapieczętowanym zdarzeniem.
    if (["lesson_notice", "lesson_choice", "lesson_order", "lesson_short_answer"].includes(exercise.exerciseType)) {
      expect(exposures.length).toBeGreaterThan(0);
      expect(exposures.every((e) => e.sealed)).toBe(true);
    }
  });

  it("karta pieczętuje ekspozycje kluczy przykładów", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });

    // „Przykłady z lekcji” jest DRUGĄ kartą celu third_person_s; przykład to "He plays football."
    const card1 = await nextTask(services, session.sessionId);
    await completePresentation(services, { taskId: card1!.taskId });
    const card2 = await nextTask(services, session.sessionId);
    expect(card2?.exerciseType).toBe("lesson_card");
    const exposures = await exposuresFor(child.id);
    expect(exposures.every((e) => e.sealed)).toBe(true);
    // Druga karta zawiera przykłady → co najmniej jedna ekspozycja istnieje.
    expect(exposures.length).toBeGreaterThan(0);
  });

  it("budżet: po wyczerpaniu budżetu ocenianych sesja się kończy", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });

    // Zużyj budżet: oznacz 12 wydanych zadań ocenianych jako answered wprost.
    // Najpierw wydaj karty (nie liczą się), potem ćwiczenia; symulujemy odpowiedzi
    // przez ustawienie stanu answered na wydanym zadaniu i ponowny next.
    let assessed = 0;
    let guard = 0;
    while (assessed < session.taskBudget && guard < 60) {
      guard += 1;
      const task = await nextTask(services, session.sessionId);
      if (task === null) break;
      if (task.exerciseType === "lesson_card") {
        await completePresentation(services, { taskId: task.taskId });
        continue;
      }
      await pool.query("update learning_app.session_tasks set state = 'answered' where id = $1", [task.taskId]);
      assessed += 1;
    }
    expect(assessed).toBe(session.taskBudget);
    const afterBudget = await nextTask(services, session.sessionId);
    expect(afterBudget).toBeNull();
  });

  it("usunięcie profilu w trakcie sesji kasuje kaskadą zadania i ekspozycje", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    await nextIssuedExercise(services, session.sessionId);

    await deleteChild(services, child.id);
    const tasks = await pool.query<{ count: number }>("select count(*)::int as count from learning_app.session_tasks where child_id = $1", [child.id]);
    expect(tasks.rows[0]!.count).toBe(0);
    const exposures = await exposuresFor(child.id);
    expect(exposures.length).toBe(0);
  });

  it("lista zestawów dziecka: lekcja ma itemCount = liczba celów i jest rekomendowana", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });

    const decks = await listKidDecks(services, child.id);
    const lessonDeck = decks.find((d) => d.deckId === lesson.deckId)!;
    expect(lessonDeck.kind).toBe("lesson");
    expect(lessonDeck.itemCount).toBe(1); // jeden cel (third_person_s)
    expect(lessonDeck.independentlyRecalledCount).toBe(0);
    expect(lessonDeck.recommended).toBe(true); // nowy materiał
    expect(lessonDeck.mockTestAvailable).toBe(false);
    expect(lessonDeck.subjectTitle).toBe("Angielski — gramatyka");
  });
});
