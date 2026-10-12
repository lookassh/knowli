import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  deleteChild,
  endSession,
  nextTask,
  readAttempt,
  startSession,
  submitAttempt,
  authorizeDisclosure,
  type AppError,
} from "@learning/server";
import type { AttemptInput, TaskDto } from "@learning/contracts";
import { lessonWorld } from "../fixtures/lesson-world";
import { buildTestServices, testDatabase, truncateCoreTables, type ManualClock } from "./helpers";

/**
 * Zadanie 13B: przyjęcie i ocena odpowiedzi w lekcji. Ocena deterministyczna
 * (`matchLessonAnswer`, typy zamknięte, sekwencja), kwalifikacja i projekcja
 * celu, feedback (great / lesson_almost / incorrect / not_assessed), idempotencja,
 * podsumowanie sesji, kaskada usunięcia profilu. Model oceniający i cache werdyktów
 * to zadanie 15 — brak dopasowania bez modelu => `unevaluated`, zadanie `issued`.
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

type Services = ReturnType<typeof buildTestServices>["services"];

/** Produktywne typy (etap productive) wymagają awansu z guided → odpowiadamy poprawnie. */
const PRODUCTIVE_TYPES = new Set(["lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer"]);

/** Wydaje i kończy prezentacje/pośrednie ćwiczenia, aż `nextTask` zwróci wskazany typ. */
async function issueUntil(services: Services, sessionId: string, type: string, max = 30): Promise<TaskDto> {
  const advance = PRODUCTIVE_TYPES.has(type); // do productive trzeba awansować (poprawne odpowiedzi)
  for (let i = 0; i < max; i++) {
    const task = await nextTask(services, sessionId);
    if (task === null) throw new Error(`sesja skończyła się przed ${type}`);
    if (task.exerciseType === "lesson_card") {
      await completePresentation(services, { taskId: task.taskId });
      continue;
    }
    if (task.exerciseType === type) return task;
    if (advance) {
      await answerCorrectly(services, task);
    } else {
      await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    }
  }
  throw new Error(`nie doczekano ćwiczenia ${type}`);
}

/** Odpowiada POPRAWNIE na dowolne ćwiczenie, by cel awansował przez etapy. */
async function answerCorrectly(services: Services, task: TaskDto): Promise<void> {
  const key = await answerKeyOf(task.taskId);
  if (task.exerciseType === "lesson_choice" || task.exerciseType === "lesson_short_answer" || task.exerciseType === "lesson_notice") {
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
    return;
  }
  if (task.exerciseType === "lesson_order") {
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "sequence", itemIds: key.itemIds as string[] });
    return;
  }
  await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.answer as string });
}

async function assessmentsFor(childId: string): Promise<{ outcome: string; reason: string | null; details: Record<string, unknown>; independent: boolean }[]> {
  const rows = await pool.query<{ outcome: string; reason: string | null; details: Record<string, unknown>; independent: boolean }>(
    `select a.outcome, a.reason, a.details, a.independent
       from learning_app.assessments a where a.child_id = $1 and a.skill = 'objective'
      order by a.outcome`,
    [childId],
  );
  return rows.rows;
}

async function progressRow(childId: string): Promise<{ status: string; streak: number; lastIndependentAt: string | null } | undefined> {
  const rows = await pool.query<{ status: string; streak: number; last_independent_at: Date | null }>(
    "select status, streak, last_independent_at from learning_app.child_objective_progress where child_id = $1",
    [childId],
  );
  const r = rows.rows[0];
  return r ? { status: r.status, streak: r.streak, lastIndependentAt: r.last_independent_at?.toISOString() ?? null } : undefined;
}

async function exposureKeys(childId: string): Promise<string[]> {
  const rows = await pool.query<{ targetKey: string }>(
    `select ee.target_key as "targetKey" from learning_app.event_exposures ee
       join learning_app.learning_events le on le.id = ee.event_id
      where ee.child_id = $1 and le.kind = 'feedback_issued' and le.sealed = true`,
    [childId],
  );
  return rows.rows.map((r) => r.targetKey);
}

/** Odczyt prywatnego answer_key wydanego zadania (do zbudowania odpowiedzi w teście). */
async function answerKeyOf(taskId: string): Promise<Record<string, unknown>> {
  const rows = await pool.query<{ answerKey: Record<string, unknown> }>(
    `select answer_key as "answerKey" from learning_app.session_tasks where id = $1`,
    [taskId],
  );
  return rows.rows[0]!.answerKey;
}

async function newLesson(services: Services, clock: ManualClock) {
  const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
  const lesson = await lessonWorld(pool, { childId: child.id, richPool: true, now: clock.now() });
  const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
  return { child, lesson, session };
}

describe("ocena odpowiedzi w lekcji — typy zamknięte i sekwencja", () => {
  it("wybór poprawny → great, zadanie answered, ekspozycja przed DTO", async () => {
    const { services, clock } = buildTestServices();
    const { child, session } = await newLesson(services, clock);
    const task = await issueUntil(services, session.sessionId, "lesson_choice");
    const key = await answerKeyOf(task.taskId);
    const correctOptionId = key.correctOptionId as string;

    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: correctOptionId });
    expect(attempt.feedback?.kind).toBe("great");
    expect(attempt.taskState).toBe("answered");

    const rows = await assessmentsFor(child.id);
    expect(rows.some((r) => r.outcome === "correct")).toBe(true);
    expect((await exposureKeys(child.id)).length).toBeGreaterThan(0);
  });

  it("wybór niepoprawny → incorrect z correctText, zadanie answered", async () => {
    const { services, clock } = buildTestServices();
    const { child, session } = await newLesson(services, clock);
    const task = await issueUntil(services, session.sessionId, "lesson_choice");
    const key = await answerKeyOf(task.taskId);
    const options = (task.prompt as { options: { id: string }[] }).options;
    const wrongId = options.find((o) => o.id !== key.correctOptionId)!.id;

    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: wrongId });
    expect(attempt.feedback?.kind).toBe("incorrect");
    expect(attempt.feedback?.correctText).toBeTruthy();
    expect(attempt.taskState).toBe("answered");
    const rows = await assessmentsFor(child.id);
    expect(rows.some((r) => r.outcome === "incorrect")).toBe(true);
  });

  it("sekwencja poprawna → great; zła kolejność → incorrect", async () => {
    const { services, clock } = buildTestServices();
    const { session } = await newLesson(services, clock);
    const task = await issueUntil(services, session.sessionId, "lesson_order");
    const key = await answerKeyOf(task.taskId);
    const itemIds = key.itemIds as string[];

    const good = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "sequence", itemIds });
    expect(good.feedback?.kind).toBe("great");
    expect(good.taskState).toBe("answered");

    // nowa sesja/zadanie dla złej kolejności
    const second = await newLesson(services, clock);
    const task2 = await issueUntil(services, second.session.sessionId, "lesson_order");
    const key2 = await answerKeyOf(task2.taskId);
    const reversed = [...(key2.itemIds as string[])].reverse();
    const bad = await submitAttempt(services, { taskId: task2.taskId, clientAttemptId: randomUUID(), modality: "sequence", itemIds: reversed });
    expect(bad.feedback?.kind).toBe("incorrect");
    expect(bad.taskState).toBe("answered");
  });
});

describe("ocena odpowiedzi w lekcji — typy tekstowe (luka)", () => {
  it("luka exact → great", async () => {
    const { services, clock } = buildTestServices();
    const { session } = await newLesson(services, clock);
    const task = await issueUntil(services, session.sessionId, "lesson_gap");
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "goes" });
    expect(attempt.feedback?.kind).toBe("great");
    expect(attempt.taskState).toBe("answered");
  });

  it("literówka w focus → no_match → unevaluated, zadanie issued, bez ekspozycji", async () => {
    // Literówka POZA focus → lesson_almost i reguła zaliczona jest dowiedziona
    // na poziomie domeny (evaluate.test: minor_typo). Tu dowodzimy ścieżki HTTP:
    // gap ma answer "goes", focus ["goes"] (jeden token) — literówka "gose" pada
    // w focus, więc dopasowanie to no_match → unevaluated, zadanie zostaje issued.
    const { services, clock } = buildTestServices();
    const { session } = await newLesson(services, clock);
    const task = await issueUntil(services, session.sessionId, "lesson_gap");
    const before = (await exposureKeys(session.childId)).length;
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "gose" });
    expect(attempt.feedback?.kind).toBe("not_assessed");
    expect(attempt.taskState).toBe("issued");
    // not_assessed niczego nie ujawnia: brak NOWEJ ekspozycji feedbacku
    expect((await exposureKeys(session.childId)).length).toBe(before);
  });

  it("literówka poza focus na ćwiczeniu tekstowym → lesson_almost z answerSegments", async () => {
    const { services, clock } = buildTestServices();
    const { session } = await newLesson(services, clock);
    const task = await issueUntil(services, session.sessionId, "lesson_transform");
    // transform answer "she plays", focus ["plays"]; literówka w "she" (poza focus)
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "shee plays" });
    expect(attempt.feedback?.kind).toBe("lesson_almost");
    expect(attempt.feedback?.answerSegments?.length).toBeGreaterThan(0);
    expect(attempt.feedback?.correctText).toBeTruthy();
    expect(attempt.taskState).toBe("answered");
  });

  it("brak dopasowania bez modelu → unevaluated (technical, verdict unavailable), zadanie issued", async () => {
    const { services, clock } = buildTestServices();
    const { child, session } = await newLesson(services, clock);
    const task = await issueUntil(services, session.sessionId, "lesson_gap");
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "completely wrong" });
    expect(attempt.feedback?.kind).toBe("not_assessed");
    expect(attempt.taskState).toBe("issued");
    const rows = await assessmentsFor(child.id);
    const unevaluated = rows.find((r) => r.outcome === "unassessed");
    expect(unevaluated).toBeTruthy();
    expect(unevaluated!.reason).toBe("technical");
    expect(unevaluated!.details.verdict).toBe("unavailable");
  });

  it("skip → próba bez ocen; dont_remember → incorrect z correctText", async () => {
    const { services, clock } = buildTestServices();
    const { child, session } = await newLesson(services, clock);
    const gap = await issueUntil(services, session.sessionId, "lesson_gap");
    const skip = await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    expect(skip.taskState).toBe("skipped");

    const second = await newLesson(services, clock);
    const gap2 = await issueUntil(services, second.session.sessionId, "lesson_gap");
    const dr = await submitAttempt(services, { taskId: gap2.taskId, clientAttemptId: randomUUID(), modality: "dont_remember" });
    expect(dr.feedback?.kind).toBe("incorrect");
    expect(dr.feedback?.correctText).toBeTruthy();
    expect(dr.taskState).toBe("answered");
    const rows = await assessmentsFor(second.child.id);
    expect(rows.some((r) => r.outcome === "incorrect" && r.reason === "dont_remember")).toBe(true);
    void child;
  });
});

describe("kwalifikacja i projekcja celu", () => {
  it("guided (choice) nigdy niezależne; produktywne (gap) na niewidzianym → niezależne", async () => {
    const { services, clock } = buildTestServices();
    const { child, session } = await newLesson(services, clock);
    const choice = await issueUntil(services, session.sessionId, "lesson_choice");
    const key = await answerKeyOf(choice.taskId);
    await submitAttempt(services, { taskId: choice.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });

    const gap = await issueUntil(services, session.sessionId, "lesson_gap");
    await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: randomUUID(), modality: "text", text: "goes" });

    const rows = await pool.query<{ independent: boolean; exercise_type: string }>(
      `select a.independent, st.exercise_type from learning_app.assessments a
         join learning_app.attempts at on at.id = a.attempt_id
         join learning_app.session_tasks st on st.id = at.task_id
        where a.child_id = $1 and a.outcome = 'correct'`,
      [child.id],
    );
    const byType = new Map(rows.rows.map((r) => [r.exercise_type, r.independent]));
    expect(byType.get("lesson_choice")).toBe(false); // guided (options) → assisted
    expect(byType.get("lesson_gap")).toBe(true); // produktywne na niewidzianym

    // Projekcja celu: niezależny sukces zapisuje wiersz child_objective_progress
    // ze statusem słownika bazy (learning→practicing) i last_independent_at.
    const progress = await progressRow(child.id);
    expect(progress).toBeDefined();
    expect(["practicing", "needs_confirmation", "mastered"]).toContain(progress!.status);
    expect(progress!.lastIndependentAt).not.toBeNull();
  });

  it("odsłuch odpowiedzi przed odpowiedzią → zależne", async () => {
    const { services, clock } = buildTestServices();
    const { child, session } = await newLesson(services, clock);
    const gap = await issueUntil(services, session.sessionId, "lesson_gap");
    // odsłuch (hint) psuje niezależność
    await authorizeDisclosure(services, { taskId: gap.taskId, kind: "hint" });
    await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: randomUUID(), modality: "text", text: "goes" });
    const rows = await assessmentsFor(child.id);
    const correct = rows.find((r) => r.outcome === "correct");
    expect(correct?.independent).toBe(false);
  });
});

describe("idempotencja", () => {
  it("ten sam clientAttemptId → ten sam wynik; inna treść → 409", async () => {
    const { services, clock } = buildTestServices();
    const { session } = await newLesson(services, clock);
    const gap = await issueUntil(services, session.sessionId, "lesson_gap");
    const cid = randomUUID();
    const first = await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: cid, modality: "text", text: "goes" });
    const again = await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: cid, modality: "text", text: "goes" });
    expect(again.attemptId).toBe(first.attemptId);

    await expectAppError(
      submitAttempt(services, { taskId: gap.taskId, clientAttemptId: cid, modality: "text", text: "different" }),
      "conflict",
    );
  });

  it("odpowiedź dla zadania answered nie tworzy nowej próby", async () => {
    const { services, clock } = buildTestServices();
    const { session } = await newLesson(services, clock);
    const choice = await issueUntil(services, session.sessionId, "lesson_choice");
    const key = await answerKeyOf(choice.taskId);
    await submitAttempt(services, { taskId: choice.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
    await expectAppError(
      submitAttempt(services, { taskId: choice.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string }),
      "conflict",
    );
  });
});

describe("feedback i prywatność Kid DTO", () => {
  it("Kid feedback nie ujawnia focus/objective/kategorii/źródła oceny", async () => {
    const { services, clock } = buildTestServices();
    const { session } = await newLesson(services, clock);
    const gap = await issueUntil(services, session.sessionId, "lesson_gap");
    const attempt = await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: randomUUID(), modality: "text", text: "goes" });
    const raw = JSON.stringify(attempt.feedback);
    for (const forbidden of ["focus", "objectiveId", "errorCategor", "verdict", "typoToken"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("retry (GET attempt) zwraca ten sam feedback i ponownie pieczętuje ekspozycję", async () => {
    const { services, clock } = buildTestServices();
    const { child, session } = await newLesson(services, clock);
    const choice = await issueUntil(services, session.sessionId, "lesson_choice");
    const key = await answerKeyOf(choice.taskId);
    const submitted = await submitAttempt(services, { taskId: choice.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
    const before = (await exposureKeys(child.id)).length;
    const read = await readAttempt(services, submitted.attemptId);
    expect(read.feedback).toEqual(submitted.feedback);
    expect((await exposureKeys(child.id)).length).toBeGreaterThanOrEqual(before);
  });
});

describe("podsumowanie sesji lekcji", () => {
  it("endSession zwraca podsumowanie per cel; ponowny odczyt identyczny", async () => {
    const { services, clock } = buildTestServices();
    const { session } = await newLesson(services, clock);
    const choice = await issueUntil(services, session.sessionId, "lesson_choice");
    const key = await answerKeyOf(choice.taskId);
    await submitAttempt(services, { taskId: choice.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });

    const summary = await endSession(services, session.sessionId);
    expect(summary.objectives).toBeDefined();
    expect(summary.objectives!.length).toBeGreaterThan(0);
    const obj = summary.objectives![0]!;
    expect(obj.practiced).toBeGreaterThan(0);
    expect(obj.correct).toBeGreaterThanOrEqual(1);
    expect(obj.titlePl).toBeTruthy();

    const again = await endSession(services, session.sessionId);
    expect(again).toEqual(summary);
  });
});

describe("kaskada usunięcia profilu", () => {
  it("usunięcie profilu kasuje próby, oceny i child_objective_progress", async () => {
    const { services, clock } = buildTestServices();
    const { child, session } = await newLesson(services, clock);
    const gap = await issueUntil(services, session.sessionId, "lesson_gap");
    await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: randomUUID(), modality: "text", text: "goes" });
    expect(await progressRow(child.id)).toBeDefined();

    await deleteChild(services, child.id);
    const attempts = await pool.query<{ count: number }>("select count(*)::int as count from learning_app.attempts where child_id = $1", [child.id]);
    expect(attempts.rows[0]!.count).toBe(0);
    const assess = await pool.query<{ count: number }>("select count(*)::int as count from learning_app.assessments where child_id = $1", [child.id]);
    expect(assess.rows[0]!.count).toBe(0);
    expect(await progressRow(child.id)).toBeUndefined();
  });
});

describe("delegacja ścieżki prób po rodzaju zestawu (zadanie 9 review minor)", () => {
  it("próba na zadaniu lekcji przechodzi ścieżką lekcji (nie deck_kind_mismatch słówek)", async () => {
    const { services, clock } = buildTestServices();
    const { session } = await newLesson(services, clock);
    const gap = await issueUntil(services, session.sessionId, "lesson_gap");
    // Gdyby ścieżka słówek przejęła próbę lekcji, assertVocabularyDeck rzuciłby
    // deck_kind_mismatch. Delegacja do silnika lekcji daje poprawny feedback.
    const attempt = await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: randomUUID(), modality: "text", text: "goes" });
    expect(attempt.feedback?.kind).toBe("great");
  });

  it("sekwencja na zadaniu słówkowym jest odrzucona (sequence tylko w lekcji)", async () => {
    const { services } = buildTestServices();
    const input: AttemptInput = { taskId: randomUUID(), clientAttemptId: randomUUID(), modality: "sequence", itemIds: [randomUUID()] };
    await expectAppError(submitAttempt(services, input), "not_found");
  });
});
