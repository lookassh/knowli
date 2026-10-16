import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  deleteChild,
  endSession,
  listKidDecks,
  nextTask,
  startSession,
  submitAttempt,
  type AppError,
} from "@learning/server";
import type { TaskDto } from "@learning/contracts";
import { lessonWorld } from "../fixtures/lesson-world";
import { readDailyRoundPool } from "../../packages/server/src/modules/daily-round";
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
    await expect(listKidDecks(services, child.id)).resolves.toMatchObject([
      { deckId: lesson.deckId, activeSession: { sessionId: session.sessionId }, kind: "lesson" },
    ]);

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

  it("kartkówka lekcji startuje w trybie mock_test (zadanie 17)", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true, testDate: "2026-10-20" });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false, mode: "mock_test" });
    expect(session.mode).toBe("mock_test");
    expect(session.taskBudget).toBeGreaterThan(0);
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
    const key = await pool.query<{ answer_key: { correctOptionId: string } }>(
      "select answer_key from learning_app.session_tasks where id=$1", [third!.taskId]);
    await submitAttempt(services, { taskId: third!.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.rows[0]!.answer_key.correctOptionId });
    const guided = await nextTask(services, session.sessionId);
    expect(["lesson_choice", "lesson_order", "lesson_short_answer"]).toContain(guided?.exerciseType);
    const stored = await pool.query<{ context: { initialObjectiveProgress?: Record<string, unknown> } }>(
      "select context from learning_app.learning_sessions where id=$1", [session.sessionId]);
    expect(stored.rows[0]!.context.initialObjectiveProgress).toEqual({});
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

  it("runda lekcji przyjmuje odpowiedź bez oceny i zmiany postępu, w limicie trzech wydań", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Runda", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true });
    const training = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    for (let i = 0; i < 3; i++) {
      const contact = await nextIssuedExercise(services, training.sessionId);
      const [key] = (await pool.query<{ answer_key: { answer?: string; correctOptionId?: string; itemIds?: string[] } }>(
        "select answer_key from learning_app.session_tasks where id=$1", [contact.taskId],
      )).rows;
      if (key?.answer_key.correctOptionId && "options" in contact.prompt) {
        await submitAttempt(services, { taskId: contact.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.answer_key.correctOptionId });
      } else if (key?.answer_key.correctOptionId && contact.prompt.kind === "lesson_notice") {
        await submitAttempt(services, { taskId: contact.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.answer_key.correctOptionId });
      } else if (key?.answer_key.itemIds && contact.prompt.kind === "lesson_order") {
        await submitAttempt(services, { taskId: contact.taskId, clientAttemptId: randomUUID(), modality: "sequence", itemIds: key.answer_key.itemIds });
      } else if (key?.answer_key.answer && contact.prompt.kind === "lesson_open_answer") {
        await submitAttempt(services, { taskId: contact.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.answer_key.answer });
      } else {
        await submitAttempt(services, { taskId: contact.taskId, clientAttemptId: randomUUID(), modality: "skip" });
      }
    }
    await endSession(services, training.sessionId);
    await pool.query(`insert into learning_app.child_objective_progress
      (child_id, subject_id, objective_id, topic_id, status, streak, projection_version)
      values ($1, $2, $3, $4, 'mastered', 3, 'test-daily-round')
      on conflict (child_id, subject_id, objective_id) do update set status='mastered', streak=3`,
    [child.id, lesson.subjectId, lesson.objectiveId, lesson.topicId]);

    const round = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false, mode: "daily_round" });
    expect(round.taskBudget).toBe(3);
    const before = await pool.query<{ assessments: number; progress: number }>(`select
      (select count(*)::int from learning_app.assessments where child_id=$1) as assessments,
      (select count(*)::int from learning_app.child_objective_progress where child_id=$1) as progress`, [child.id]);
    const objectiveProgressBefore = await pool.query<{ subject_id: string; objective_id: string; status: string; streak: number }>(
      "select subject_id, objective_id, status, streak from learning_app.child_objective_progress where child_id=$1 order by subject_id, objective_id", [child.id],
    );
    const issued: TaskDto[] = [];
    let answeredRoundTask = false;
    for (let index = 0; index < 3; index++) {
      const task = await nextTask(services, round.sessionId);
      expect(task).not.toBeNull();
      issued.push(task!);
      if (index === 0) expect(task!.prompt.kind).toBe("lesson_choice");
      if (index === 1) {
        expect(task!.exerciseType).toBe("lesson_card");
        const supportCard = (await pool.query<{ context: Record<string, unknown> }>("select context from learning_app.session_tasks where id=$1", [task!.taskId])).rows[0]!;
        expect(supportCard.context).toMatchObject({ cardPurpose: "support" });
      }
      expect(task!.remainingAssessed).toBe(3 - index);
      if (task!.exerciseType === "lesson_card") await completePresentation(services, { taskId: task!.taskId });
      else {
        const [key] = (await pool.query<{ answer_key: { answer?: string; correctOptionId?: string; itemIds?: string[] } }>(
          "select answer_key from learning_app.session_tasks where id=$1", [task!.taskId],
        )).rows;
        if (task!.prompt.kind === "lesson_choice" || task!.prompt.kind === "lesson_short_answer") {
          if (index === 0) {
            const wrongOption = task!.prompt.options.find(option => option.id !== key!.answer_key.correctOptionId);
            expect(wrongOption).toBeDefined();
            const result = await submitAttempt(services, { taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: wrongOption!.id });
            expect(result.feedback?.kind).toBe("incorrect");
          } else {
            await submitAttempt(services, { taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: task!.prompt.options[0]!.id });
          }
          answeredRoundTask = true;
        } else if (task!.prompt.kind === "lesson_order") {
          await submitAttempt(services, { taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "sequence", itemIds: task!.prompt.items.map(item => item.id) });
          answeredRoundTask = true;
        } else if (task!.prompt.kind === "lesson_notice") {
          await submitAttempt(services, { taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key!.answer_key.correctOptionId! });
          answeredRoundTask = true;
        } else if (key?.answer_key.answer && "text" in task!.prompt) {
          await submitAttempt(services, { taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.answer_key.answer });
          answeredRoundTask = true;
        } else {
          await submitAttempt(services, { taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "skip" });
        }
      }
    }
    expect(answeredRoundTask, JSON.stringify(issued.map(task => ({ type: task.exerciseType, kind: task.prompt.kind })))).toBe(true);
    expect(await nextTask(services, round.sessionId)).toBeNull();
    const after = await pool.query<{ assessments: number; progress: number }>(`select
      (select count(*)::int from learning_app.assessments where child_id=$1) as assessments,
      (select count(*)::int from learning_app.child_objective_progress where child_id=$1) as progress`, [child.id]);
    expect(after.rows).toEqual(before.rows);
    expect(await pool.query<{ subject_id: string; objective_id: string; status: string; streak: number }>(
      "select subject_id, objective_id, status, streak from learning_app.child_objective_progress where child_id=$1 order by subject_id, objective_id", [child.id],
    )).toEqual(objectiveProgressBefore);
    const count = await pool.query<{ count: number }>("select count(*)::int as count from learning_app.session_tasks where session_id=$1", [round.sessionId]);
    expect(count.rows[0]!.count).toBe(3);
  });

  it("wycofuje start rundy lekcji z niepustą pulą, gdy brak schedulowalnego celu", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Pusta runda", avatarKey: "owl" });
    const roundDate = new Date("2026-10-07T16:00:00.000Z");
    const lesson = await lessonWorld(pool, { childId: child.id, now: roundDate, unschedulableDailyRound: true });
    const available = await readDailyRoundPool(testDatabase().db, child.id, lesson.deckId, roundDate);
    expect(available?.revisionIds).toContain(lesson.revisionId);

    await expect(startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false, mode: "daily_round" }))
      .rejects.toMatchObject({ code: "validation", details: { reason: "daily_round_unavailable" } });
    const rounds = await pool.query<{ count: number }>(
      "select count(*)::int as count from learning_app.learning_sessions where child_id=$1 and mode='daily_round'", [child.id],
    );
    expect(rounds.rows[0]!.count).toBe(0);
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
    const decksWithoutMicrophone = await listKidDecks(services, child.id, { microphoneEnabled: false });
    expect(decksWithoutMicrophone.find((deck) => deck.deckId === lesson.deckId)?.recommended).toBe(true);
    expect(lessonDeck.mockTestAvailable).toBe(false);
    expect(lessonDeck.subjectTitle).toBe("Angielski — gramatyka");
  });
});
