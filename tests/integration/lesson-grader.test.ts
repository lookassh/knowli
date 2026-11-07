import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptVerdictAsVariant,
  completePresentation,
  createChild,
  createServices,
  FakeAnswerGrader,
  nextTask,
  readAttempt,
  startSession,
  submitAttempt,
  type AppError,
} from "@learning/server";
import { FeedbackDtoSchema, type AttemptInput, type TaskDto } from "@learning/contracts";
import { lessonWorld } from "../fixtures/lesson-world";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

/**
 * Zadanie 15: ocena niedopasowanych odpowiedzi tekstowych przez model oceniający
 * (fake grader w `Services`), cache werdyktów (`lesson_verdicts`) z nadrzędnym
 * `parent_decision`, rezerwacja `processing` + budżet wywołań na sesję, retry przy
 * processing, leniwa finalizacja, limit, równoległe identyczne odpowiedzi.
 *
 * `lesson_transform` ma answer "she plays", focus ["plays"]; odpowiedź "she play"
 * (brak -s W focus) → `no_match` deterministyczny → ścieżka modelu.
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

type Services = ReturnType<typeof buildTestServices>["services"];
type Clock = ReturnType<typeof buildTestServices>["clock"];

/** Services z fake graderem (i obecnym `generation`, by selektor wydawał transform). */
function graderServices(
  grader: FakeAnswerGrader,
  opts: { startIso?: string; maxCallsPerSession?: number; timeoutMs?: number } = {},
): { services: Services; clock: Clock } {
  const { services, clock } = buildTestServices(opts.startIso);
  const withGrader = createServices({
    db: (services as unknown as { db: Parameters<typeof createServices>[0]["db"] }).db,
    clock,
    generation: {} as Parameters<typeof createServices>[0]["generation"],
    grader: { provider: grader, maxCallsPerSession: opts.maxCallsPerSession ?? 20, timeoutMs: opts.timeoutMs ?? 8000 },
  });
  return { services: withGrader, clock };
}

async function answerKeyOf(taskId: string): Promise<Record<string, unknown>> {
  const rows = await pool.query<{ answerKey: Record<string, unknown> }>(
    `select answer_key as "answerKey" from learning_app.session_tasks where id = $1`,
    [taskId],
  );
  return rows.rows[0]!.answerKey;
}

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

const PRODUCTIVE = new Set(["lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer"]);

/** Wydaje zadania (awansując poprawnie przez wcześniejsze typy) aż `type` wyjdzie. */
async function issueUntil(services: Services, sessionId: string, type: string, max = 40): Promise<TaskDto> {
  const advance = PRODUCTIVE.has(type);
  for (let i = 0; i < max; i++) {
    const task = await nextTask(services, sessionId);
    if (task === null) throw new Error(`sesja skończyła się przed ${type}`);
    if (task.exerciseType === "lesson_card") {
      await completePresentation(services, { taskId: task.taskId });
      continue;
    }
    if (task.exerciseType === type) return task;
    if (advance) await answerCorrectly(services, task);
    else await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  }
  throw new Error(`nie doczekano ćwiczenia ${type}`);
}

async function newLesson(services: Services, clock: Clock, withPriorSuccess = false) {
  const child = await createChild(services, { displayName: "Grader", avatarKey: "owl" });
  const lesson = await lessonWorld(pool, { childId: child.id, richPool: true, now: clock.now(), withObjectiveAssessment: withPriorSuccess });
  const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
  return { child, lesson, session };
}

async function seedPracticing(childId: string): Promise<void> {
  await pool.query(
    `insert into learning_app.child_objective_progress
       (child_id, subject_id, objective_id, topic_id, status, streak, projection_version)
     values ($1, 'english_grammar', 'english_grammar.present_simple.third_person_s', 'present_simple', 'practicing', 1, 'proj-1')`,
    [childId],
  );
}

async function verdictRows(): Promise<{ verdict: string; errorCategory: string | null; normalizedAnswer: string; parentDecision: string | null }[]> {
  const rows = await pool.query<{ verdict: string; error_category: string | null; normalized_answer: string; parent_decision: string | null }>(
    `select verdict, error_category, normalized_answer, parent_decision from learning_app.lesson_verdicts order by created_at`,
  );
  return rows.rows.map((r) => ({ verdict: r.verdict, errorCategory: r.error_category, normalizedAnswer: r.normalized_answer, parentDecision: r.parent_decision }));
}

async function graderCallsOf(sessionId: string): Promise<number> {
  const rows = await pool.query<{ context: { graderCalls?: number } }>(
    "select context from learning_app.learning_sessions where id = $1",
    [sessionId],
  );
  return rows.rows[0]!.context.graderCalls ?? 0;
}

async function reserveTransform(services: Services, sessionId: string): Promise<TaskDto> {
  return issueUntil(services, sessionId, "lesson_transform");
}

describe("model oceniający — mapowanie werdyktów", () => {
  it("verdict correct → great, zadanie answered, jedno wywołanie, wpis cache", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "correct", errorCategory: null, fragments: [], note: "ok", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { child, session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(attempt.feedback?.kind).toBe("great");
    expect(attempt.taskState).toBe("answered");
    expect(grader.callCount).toBe(1);
    expect((await verdictRows()).length).toBe(1);
    // Regresja gramatyki: „Topic” w promptcie to tytuł tematu katalogu, jak przed migawką celu.
    const catalogTopic = services.subjects.getTopic("english_grammar", "present_simple", 1);
    expect(grader.requests[0]?.topicTitle).toBe(catalogTopic?.titlePl);
  });

  it("verdict almost → lesson_almost z fragmentami i correctText", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "almost", errorCategory: null, fragments: ["she"], note: "typo", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(attempt.feedback?.kind).toBe("lesson_almost");
    expect(attempt.feedback?.answerSegments?.length).toBeGreaterThan(0);
    expect(attempt.feedback?.correctText).toBeTruthy();
    expect(attempt.taskState).toBe("answered");
  });

  it("verdict incorrect z kategorią celu → lesson_hint z hintPl i fragmentami", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: ["play"], note: "brak -s", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { child, session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(attempt.feedback?.kind).toBe("lesson_hint");
    expect(attempt.feedback?.hintPl).toBeTruthy();
    expect(attempt.feedback?.answerSegments?.length).toBeGreaterThan(0);
    expect(attempt.feedback?.correctText).toBeTruthy();
    // „play” → „plays”: słowo dziecka zaznaczone w całości, w poprawnej odpowiedzi brakujące „s”.
    expect(attempt.feedback?.answerSegments).toContainEqual({ text: "play", state: "pill" });
    expect(attempt.feedback?.correctSegments).toContainEqual({ text: "s", state: "pill" });
    expect(FeedbackDtoSchema.safeParse(attempt.feedback).success).toBe(true);
    expect(attempt.taskState).toBe("answered");
    const rows = await pool.query<{ outcome: string }>(
      "select outcome from learning_app.assessments where child_id = $1 and skill='objective'",
      [child.id],
    );
    expect(rows.rows.some((r) => r.outcome === "incorrect")).toBe(true);
  });

  it("verdict incorrect kategoria other → unevaluated (model_other), zadanie issued, correctText bez podpowiedzi celu", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "other", fragments: [], note: "off topic", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(attempt.feedback?.kind).toBe("incorrect");
    expect(attempt.feedback?.correctText).toBeTruthy();
    expect(attempt.taskState).toBe("issued");
  });

  it("invalid JSON (zły kształt) → unevaluated technical, bez wpisu cache, licznik zużyty", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { nope: true } });
    const { services, clock } = graderServices(grader);
    const { session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(attempt.feedback?.kind).toBe("not_assessed");
    expect(attempt.taskState).toBe("issued");
    expect((await verdictRows()).length).toBe(0);
    expect(await graderCallsOf(session.sessionId)).toBe(1);
  });

  it("kategoria spoza listy celu → odrzucona → unevaluated, bez cache", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "not_a_real_category", fragments: [], note: "x", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(attempt.feedback?.kind).toBe("not_assessed");
    expect((await verdictRows()).length).toBe(0);
  });

  it("wyjątek/timeout gradera → unevaluated technical, bez cache, licznik zużyty", async () => {
    const grader = new FakeAnswerGrader().onDefault({ error: "boom" });
    const { services, clock } = graderServices(grader);
    const { session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(attempt.feedback?.kind).toBe("not_assessed");
    expect((await verdictRows()).length).toBe(0);
    expect(await graderCallsOf(session.sessionId)).toBe(1);
  });
});

describe("cache werdyktów i parent_decision", () => {
  it("druga identyczna odpowiedź (inne dziecko) nie woła modelu — trafia w cache", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: ["play"], note: "x", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    // JEDNA lekcja (ten sam item_revision_id) dla dwojga dzieci — klucz cache to
    // (item_revision_id, normalized_answer, prompt_version), więc cache dzieli się
    // tylko w obrębie tego samego ćwiczenia.
    const childA = await createChild(services, { displayName: "A", avatarKey: "owl" });
    const childB = await createChild(services, { displayName: "B", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: childA.id, richPool: true, now: clock.now(), withObjectiveAssessment: true });
    await seedPracticing(childB.id);
    await pool.query(
      `insert into learning_app.assignments (id, child_id, deck_id) values (gen_random_uuid(), $1, $2)`,
      [childB.id, lesson.deckId],
    );
    const sA = await startSession(services, { childId: childA.id, deckId: lesson.deckId, microphoneEnabled: false });
    const t1 = await reserveTransform(services, sA.sessionId);
    await submitAttempt(services, { taskId: t1.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(grader.callCount).toBe(1);

    const sB = await startSession(services, { childId: childB.id, deckId: lesson.deckId, microphoneEnabled: false });
    const t2 = await reserveTransform(services, sB.sessionId);
    const second = await submitAttempt(services, { taskId: t2.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(grader.callCount).toBe(1); // cache hit, no second call
    expect(second.feedback?.kind).toBe("lesson_hint");
    expect((await verdictRows()).length).toBe(1);
  });

  it("parent_decision overridden_correct nadrzędne nad zapisanym incorrect", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: ["play"], note: "x", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const childA = await createChild(services, { displayName: "A", avatarKey: "owl" });
    const childB = await createChild(services, { displayName: "B", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: childA.id, richPool: true, now: clock.now(), withObjectiveAssessment: true });
    await seedPracticing(childB.id);
    await pool.query(
      `insert into learning_app.assignments (id, child_id, deck_id) values (gen_random_uuid(), $1, $2)`,
      [childB.id, lesson.deckId],
    );
    const sA = await startSession(services, { childId: childA.id, deckId: lesson.deckId, microphoneEnabled: false });
    const t1 = await reserveTransform(services, sA.sessionId);
    await submitAttempt(services, { taskId: t1.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    // rodzic nadpisuje werdykt
    await pool.query(
      "update learning_app.lesson_verdicts set parent_decision = 'overridden_correct', parent_decided_at = now()",
    );
    const sB = await startSession(services, { childId: childB.id, deckId: lesson.deckId, microphoneEnabled: false });
    const t2 = await reserveTransform(services, sB.sessionId);
    const second = await submitAttempt(services, { taskId: t2.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    expect(second.feedback?.kind).toBe("great");
    expect(second.taskState).toBe("answered");
    expect(grader.callCount).toBe(1);
  });
});

describe("etap 3 (#360): bez rozwijania skrótów i wynik „bez ćwiczonej formy”", () => {
  type WorldOptions = Parameters<typeof lessonWorld>[1];

  /** Jedna lekcja z bogatą pulą dla `count` dzieci (wspólne rewizje = wspólny cache werdyktów). */
  async function sharedLesson(services: Services, clock: Clock, count: number, options: WorldOptions = {}) {
    const children: { id: string }[] = [];
    for (let i = 0; i < count; i++) children.push(await createChild(services, { displayName: `D${i}`, avatarKey: "owl" }));
    const lesson = await lessonWorld(pool, { childId: children[0]!.id, richPool: true, now: clock.now(), withObjectiveAssessment: true, ...options });
    for (const child of children.slice(1)) {
      await seedPracticing(child.id);
      await pool.query(`insert into learning_app.assignments (id, child_id, deck_id) values (gen_random_uuid(), $1, $2)`, [child.id, lesson.deckId]);
    }
    const issueTransform = async (childIndex: number) => {
      const session = await startSession(services, { childId: children[childIndex]!.id, deckId: lesson.deckId, microphoneEnabled: false });
      return reserveTransform(services, session.sessionId);
    };
    const answer = (task: TaskDto, text: string) => submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text });
    const answerTransform = async (childIndex: number, text: string) => {
      const task = await issueTransform(childIndex);
      return { task, dto: await answer(task, text) };
    };
    return { lesson, children, issueTransform, answer, answerTransform };
  }

  const verdictOf = async (attemptId: string) =>
    (await pool.query<{ outcome: string; details: { verdict?: string } }>("select outcome, details from learning_app.assessments where attempt_id = $1", [attemptId])).rows[0]!;

  it("poprawna inną formą → zadanie zamknięte, nieocenione bez postępu, pochwała z formą ćwiczoną, ekspozycja i cache", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "correct", errorCategory: null, fragments: [], note: "inna forma", usesTargetForm: false } });
    const { services, clock } = graderServices(grader);
    const world = await sharedLesson(services, clock, 3);
    const progressOf = async () => (await pool.query("select status, streak from learning_app.child_objective_progress where child_id = $1", [world.children[0]!.id])).rows;
    const firstTask = await world.issueTransform(0);
    const progressBefore = await progressOf();
    const first = { task: firstTask, dto: await world.answer(firstTask, "she is playing") };
    expect(first.dto.taskState).toBe("answered");
    expect(first.dto.feedback).toEqual({ kind: "lesson_precision_hint", hintPl: "To też dobrze! W tej lekcji ćwiczymy tak: she plays" });
    expect(FeedbackDtoSchema.safeParse(first.dto.feedback).success).toBe(true);
    expect(await verdictOf(first.dto.attemptId)).toMatchObject({ outcome: "unassessed", details: { verdict: "model_off_target" } });
    expect(await progressOf()).toEqual(progressBefore);
    const targetKey = (await answerKeyOf(first.task.taskId)).targetKey as string;
    const exposed = await pool.query(
      `select 1 from learning_app.event_exposures ee join learning_app.learning_events le on le.id = ee.event_id
        where le.task_id = $1 and le.kind = 'feedback_issued' and le.sealed and ee.target_key = $2`,
      [first.task.taskId, targetKey],
    );
    expect(exposed.rowCount).toBe(1);
    expect((await pool.query("select uses_target_form from learning_app.lesson_verdicts")).rows).toEqual([{ uses_target_form: false }]);

    // Ta sama odpowiedź innego dziecka: wynik z cache, bez wywołania.
    const second = await world.answerTransform(1, "she is playing");
    expect(grader.callCount).toBe(1);
    expect(second.dto.taskState).toBe("answered");
    expect(second.dto.feedback?.kind).toBe("lesson_precision_hint");
    expect((await verdictOf(second.dto.attemptId)).details.verdict).toBe("model_off_target");

    // „Uznaj” rodzica ma pierwszeństwo przed „bez ćwiczonej formy”: sukces celu.
    await pool.query("update learning_app.lesson_verdicts set parent_decision = 'overridden_correct', parent_decided_at = now()");
    const third = await world.answerTransform(2, "she is playing");
    expect(grader.callCount).toBe(1);
    expect(third.dto.feedback?.kind).toBe("great");
    expect((await verdictOf(third.dto.attemptId)).outcome).toBe("correct");
  });

  it.each([
    ["she's playing", "she is playing"],
    ["she is playing", "she's playing"],
  ])("skrót i pełna forma (%s, potem %s) mają osobne werdykty w cache", async (firstText, secondText) => {
    const grader = new FakeAnswerGrader()
      .onAnswer("she's playing", { raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: ["playing"], note: "x", usesTargetForm: true } })
      .onAnswer("she is playing", { raw: { verdict: "correct", errorCategory: null, fragments: [], note: "x", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const world = await sharedLesson(services, clock, 2);
    const first = await world.answerTransform(0, firstText);
    const second = await world.answerTransform(1, secondText);
    expect(grader.callCount).toBe(2);
    expect((await verdictRows()).map((row) => row.normalizedAnswer).sort()).toEqual(["she is playing", "she's playing"]);
    const outcomeOf = (text: string) => (text === "she is playing" ? "correct" : "incorrect");
    expect((await verdictOf(first.dto.attemptId)).outcome).toBe(outcomeOf(firstText));
    expect((await verdictOf(second.dto.attemptId)).outcome).toBe(outcomeOf(secondText));
  });

  it("stara rewizja z focus w formie rozwiniętej: „She don't like tea.” idzie do modelu, nie jest literówką", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: ["don't"], note: "x", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const world = await sharedLesson(services, clock, 1, {
      transform: { answer: "She doesn't like tea.", focus: ["does", "not"], statement: "She likes tea.", instructionPl: "Zaprzecz." },
    });
    const { dto } = await world.answerTransform(0, "She don't like tea.");
    expect(grader.callCount).toBe(1);
    expect((await verdictOf(dto.attemptId)).outcome).toBe("incorrect");
  });

  it("wariant ze skrótem dopisany przez rodzica zalicza bez modelu", async () => {
    const grader = new FakeAnswerGrader();
    const { services, clock } = graderServices(grader);
    const world = await sharedLesson(services, clock, 1, {
      transform: { answer: "She is not at home.", focus: ["is", "not"], acceptedAnswers: ["She isn't at home."], statement: "She is at home.", instructionPl: "Zaprzecz." },
    });
    const { dto } = await world.answerTransform(0, "she isn't at home");
    expect(grader.callCount).toBe(0);
    expect(dto.feedback?.kind).toBe("great");
  });
});

describe("etap 3 (#360): rozsypanka przez model oceniający", () => {
  async function orderTask(services: Services, clock: Clock) {
    const { session } = await newLesson(services, clock);
    const task = await issueUntil(services, session.sessionId, "lesson_order");
    const key = await answerKeyOf(task.taskId);
    const ids = key.itemIds as string[];
    return { session, task, ids, other: [ids[2]!, ids[0]!, ids[1]!] };
  }
  const sequence = (services: Services, taskId: string, itemIds: string[], clientAttemptId = randomUUID()) =>
    submitAttempt(services, { taskId, clientAttemptId, modality: "sequence", itemIds });

  it("klucz zalicza bez modelu", async () => {
    const grader = new FakeAnswerGrader();
    const { services, clock } = graderServices(grader);
    const { task, ids } = await orderTask(services, clock);
    expect((await sequence(services, task.taskId, ids)).feedback?.kind).toBe("great");
    expect(grader.callCount).toBe(0);
  });

  it("inna kolejność → model: dostaje klocki dziecka, sam klucz jako wzorzec i kategorię wrong_order", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "correct", errorCategory: null, fragments: [], note: "ok", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { task, other } = await orderTask(services, clock);
    const dto = await sequence(services, task.taskId, other);
    expect(dto.feedback?.kind).toBe("great");
    expect(dto.taskState).toBe("answered");
    expect(dto.modality).toBe("sequence");
    expect(grader.callCount).toBe(1);
    const request = grader.requests[0]!;
    expect(request.blocks).toEqual(["football", "She", "plays"]);
    expect(request.childAnswer).toBe("football She plays");
    expect(request.acceptedAnswers).toEqual(["She plays football"]);
    expect(request.objective.errorCategories.map((c) => c.code)).toContain("wrong_order");
    const stored = await pool.query<{ answer: unknown; modality: string }>("select answer, modality from learning_app.attempts where id = $1", [dto.attemptId]);
    expect(stored.rows[0]).toEqual({ answer: { itemIds: other }, modality: "sequence" });
  });

  it("inna kolejność z usesTargetForm=false nadal zalicza (klocki nie zmieniają formy)", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "correct", errorCategory: null, fragments: [], note: "ok", usesTargetForm: false } });
    const { services, clock } = graderServices(grader);
    const { task, other } = await orderTask(services, clock);
    const dto = await sequence(services, task.taskId, other);
    expect(dto.feedback?.kind).toBe("great");
    expect((await pool.query("select outcome from learning_app.assessments where attempt_id = $1", [dto.attemptId])).rows[0]!.outcome).toBe("correct");
  });

  it("zła kolejność (wrong_order) → błąd z kluczem ułożonym z klocków; powtórka tej samej próby bez drugiego wywołania", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "wrong_order", fragments: [], note: "x", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { task, other } = await orderTask(services, clock);
    const cid = randomUUID();
    const dto = await sequence(services, task.taskId, other, cid);
    expect(dto.feedback).toMatchObject({ kind: "incorrect", correctText: "She plays football" });
    expect(dto.taskState).toBe("answered");
    const again = await sequence(services, task.taskId, other, cid);
    expect(again.attemptId).toBe(dto.attemptId);
    expect(grader.callCount).toBe(1);
  });

  it("klocki spoza zadania → błąd walidacji bez próby", async () => {
    const grader = new FakeAnswerGrader();
    const { services, clock } = graderServices(grader);
    const { task, ids } = await orderTask(services, clock);
    await expect(sequence(services, task.taskId, [ids[0]!, ids[1]!, randomUUID()])).rejects.toMatchObject({ code: "validation" });
    await expect(sequence(services, task.taskId, [...ids, randomUUID()])).rejects.toMatchObject({ code: "validation" });
    expect((await pool.query("select 1 from learning_app.attempts where task_id = $1", [task.taskId])).rowCount).toBe(0);
  });

  it("bez gradera i po limicie inna kolejność jest nieoceniona, zadanie do ponowienia", async () => {
    const noGrader = buildTestServices();
    const first = await orderTask(noGrader.services, noGrader.clock);
    const without = await sequence(noGrader.services, first.task.taskId, first.other);
    expect(without.feedback?.kind).toBe("not_assessed");
    expect(without.taskState).toBe("issued");

    await truncateCoreTables();
    const grader = new FakeAnswerGrader();
    const limited = graderServices(grader, { maxCallsPerSession: 1 });
    const second = await orderTask(limited.services, limited.clock);
    await pool.query("update learning_app.learning_sessions set context = context || '{\"graderCalls\":1}'::jsonb where id = $1", [second.session.sessionId]);
    const over = await sequence(limited.services, second.task.taskId, second.other);
    expect(over.feedback?.kind).toBe("not_assessed");
    expect(over.taskState).toBe("issued");
    expect(grader.callCount).toBe(0);
  });

  it("„uznaj jako wariant” na werdykcie rozsypanki → błąd walidacji", async () => {
    const grader = new FakeAnswerGrader();
    const { services, clock } = graderServices(grader);
    const { task, other } = await orderTask(services, clock);
    await sequence(services, task.taskId, other);
    const verdictId = (await pool.query<{ id: string }>("select id from learning_app.lesson_verdicts")).rows[0]!.id;
    await expect(acceptVerdictAsVariant(services, verdictId)).rejects.toMatchObject({ code: "validation" });
  });
});

describe("rezerwacja, budżet i leniwa finalizacja", () => {
  it("limit wywołań wyczerpany → unevaluated bez wywołania", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: [], note: "x", usesTargetForm: true } });
    const { services, clock } = graderServices(grader, { maxCallsPerSession: 0 });
    const { session } = await newLesson(services, clock, true);
    // gap jest wydawalny przy limicie 0 (nie jest typem zależnym od modelu w selekcji);
    // niedopasowana odpowiedź tekstowa i tak eskaluje do modelu PRZY OCENIE — ale
    // limit=0 blokuje wywołanie → unevaluated.
    const gap = await issueUntil(services, session.sessionId, "lesson_gap");
    const attempt = await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: randomUUID(), modality: "text", text: "completely wrong" });
    expect(attempt.feedback?.kind).toBe("not_assessed");
    expect(grader.callCount).toBe(0);
  });

  it("retry przy processing → ten sam wynik bez drugiego wywołania i bez inkrementu", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: ["play"], note: "x", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    const cid = randomUUID();
    const first = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: cid, modality: "text", text: "she play" });
    const again = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: cid, modality: "text", text: "she play" });
    expect(again.attemptId).toBe(first.attemptId);
    expect(grader.callCount).toBe(1);
    expect(await graderCallsOf(session.sessionId)).toBe(1);
  });

  it("równoległe identyczne odpowiedzi (dwoje dzieci, ta sama lekcja) → jeden wpis cache, ten sam werdykt", async () => {
    // Grader z opóźnieniem, by oba wywołania nałożyły się przed zapisem cache.
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: ["play"], note: "x", usesTargetForm: true }, delayMs: 150 });
    const { services, clock } = graderServices(grader);
    const childA = await createChild(services, { displayName: "A", avatarKey: "owl" });
    const childB = await createChild(services, { displayName: "B", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: childA.id, richPool: true, now: clock.now(), withObjectiveAssessment: true });
    await seedPracticing(childB.id);
    await pool.query(`insert into learning_app.assignments (id, child_id, deck_id) values (gen_random_uuid(), $1, $2)`, [childB.id, lesson.deckId]);
    const sA = await startSession(services, { childId: childA.id, deckId: lesson.deckId, microphoneEnabled: false });
    const sB = await startSession(services, { childId: childB.id, deckId: lesson.deckId, microphoneEnabled: false });
    const tA = await reserveTransform(services, sA.sessionId);
    const tB = await reserveTransform(services, sB.sessionId);
    const [rA, rB] = await Promise.all([
      submitAttempt(services, { taskId: tA.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" }),
      submitAttempt(services, { taskId: tB.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" }),
    ]);
    // Jeden wpis cache (ON CONFLICT DO NOTHING), ten sam werdykt w obu ocenach.
    expect((await verdictRows()).length).toBe(1);
    expect(rA.feedback?.kind).toBe("lesson_hint");
    expect(rB.feedback?.kind).toBe("lesson_hint");
  });

  it("proces padł w trakcie processing → leniwa finalizacja po 60 s → nieocenione, zadanie issued", async () => {
    // Rezerwujemy processing wprost (jak crash po inkremencie, przed finalizacją),
    // potem przesuwamy zegar o >60 s i próbujemy ponownie — leniwa finalizacja domyka.
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: [], note: "x", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    // Wstaw osieroconą próbę processing wprost (symulacja crashu po rezerwacji).
    const revisionId = (await pool.query<{ item_revision_id: string }>(
      "select item_revision_id from learning_app.session_tasks where id = $1", [task.taskId])).rows[0]!.item_revision_id;
    const policyId = (await pool.query<{ policy_id: string }>(
      "select policy_id from learning_app.learning_sessions where id = $1", [session.sessionId])).rows[0]!.policy_id;
    await pool.query(
      `insert into learning_app.attempts (id, child_id, task_id, item_revision_id, client_attempt_id, request_hash, attempt_number, modality, state, answer, context, policy_id, received_at)
       values (gen_random_uuid(), $1, $2, $3, $4, 'h', 1, 'text', 'processing', '{"text":"she play"}'::jsonb, '{}'::jsonb, $5, $6)`,
      [session.childId, task.taskId, revisionId, randomUUID(), policyId, clock.now()],
    );
    clock.advanceMs(61_000);
    // Nowa odpowiedź na to samo zadanie: wstęp leniwie finalizuje osieroconą próbę.
    const after = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    // Regresja: migawka prób sprzed leniwej finalizacji zwracała DTO osieroconej
    // próby (processing) zamiast przyjąć nową odpowiedź.
    expect(after.state).toBe("completed");
    expect(after.feedback?.kind).toBe("lesson_hint");
    const stale = await pool.query<{ state: string; feedback: { kind?: string } | null }>(
      "select state, feedback from learning_app.attempts where task_id = $1 order by received_at asc", [task.taskId]);
    expect(stale.rows[0]!.state).toBe("completed");
    expect(stale.rows[0]!.feedback?.kind).toBe("not_assessed");
  });
});

describe("brak modelu", () => {
  it("brak gradera w Services → niedopasowanie tekstowe = unevaluated, zadanie issued", async () => {
    // buildTestServices bez grader + bez generation: ale wtedy transform nie wyjdzie.
    // Używamy gap z odpowiedzią no_match: "completely wrong".
    const { services, clock } = buildTestServices();
    const child = await createChild(services, { displayName: "NoGrader", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true, now: clock.now(), withObjectiveAssessment: true });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    const gap = await issueUntil(services, session.sessionId, "lesson_gap");
    const attempt = await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: randomUUID(), modality: "text", text: "completely wrong" });
    expect(attempt.feedback?.kind).toBe("not_assessed");
    expect(attempt.taskState).toBe("issued");
    expect((await verdictRows()).length).toBe(0);
  });
});

describe("prywatność — note modelu i źródło oceny poza Kid DTO", () => {
  it("komentarz note modelu nie trafia do feedbacku dziecka", async () => {
    const grader = new FakeAnswerGrader().onDefault({ raw: { verdict: "incorrect", errorCategory: "missing_ending", fragments: ["play"], note: "SEKRETNY-KOMENTARZ-RODZICA", usesTargetForm: true } });
    const { services, clock } = graderServices(grader);
    const { session } = await newLesson(services, clock, true);
    const task = await reserveTransform(services, session.sessionId);
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she play" });
    const raw = JSON.stringify(attempt.feedback);
    expect(raw).not.toContain("SEKRETNY-KOMENTARZ-RODZICA");
    for (const forbidden of ["objectiveId", "errorCategor", "verdict", "model_"]) {
      expect(raw).not.toContain(forbidden);
    }
    const read = await readAttempt(services, attempt.attemptId);
    expect(JSON.stringify(read.feedback)).not.toContain("SEKRETNY-KOMENTARZ-RODZICA");
  });
});

void (null as unknown as AttemptInput);
void (null as unknown as AppError);
