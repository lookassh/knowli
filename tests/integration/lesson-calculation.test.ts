import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completePresentation, createChild, createLessonDraftFromPublished, createServices,
  editLessonDraft, endSession, readLessonMockTestSummary, fakeSessionActivityDeps, FakeSessionActivityReviewer, reviewSessionActivity, loginParent, nextTask, publishLessonDraft, readLessonDeck, setupParent, startSession, submitAttempt,
} from "@learning/server";
import { LessonExerciseInputSchema, type CalculationSpec, type LessonExerciseInput } from "@learning/contracts";
import { writeSealedEvent } from "../../packages/server/src/modules/learning/events";
import { renderCalculationPrompt } from "../../packages/server/src/domain/lessons/calculation";
import { handleParentApi, ManualClock, testDatabase, truncateCoreTables } from "./helpers";

const { db, pool } = testDatabase();
const services = createServices({ db, clock: new ManualClock() });
const OBJECTIVE = "school.ddeck000.scale";
const MATERIAL = "Skala mapy określa stosunek odległości na mapie do odległości w terenie. Odległość w terenie obliczamy, mnożąc odległość na mapie przez mianownik skali.";
const calculation: CalculationSpec = {
  kind: "scale_distance", params: { scaleDenominator: 25000, mapDistanceCm: 3 }, unit: "m", templateFamilyId: "scale",
};

function calculationExercise(spec = calculation): LessonExerciseInput {
  return {
    exerciseType: "lesson_calculation", objectiveId: OBJECTIVE, instructionPl: "Oblicz.",
    prompt: renderCalculationPrompt(spec), answer: "750 m", acceptedAnswers: [], focus: [], calculation: spec,
    sourceRefs: [{ quote: MATERIAL }],
  };
}

function publishablePool(): LessonExerciseInput[] {
  const common = { objectiveId: OBJECTIVE, acceptedAnswers: [], sourceRefs: [{ quote: MATERIAL }] };
  return [
    ...["mapie", "terenie", "skali"].map((answer) => ({
      ...common, exerciseType: "lesson_choice" as const, instructionPl: "Wybierz.", stem: `Wybierz słowo: ${answer}.`, answer, focus: [answer],
      options: [{ id: "a", text: answer }, { id: "b", text: "innym" }], correctOption: "a",
    })),
    ...["mapie", "terenie"].map((answer) => ({
      ...common, exerciseType: "lesson_gap" as const, instructionPl: "Uzupełnij.", stem: `Odległość na ___ (${answer}).`, answer, focus: [answer],
    })),
    ...["Skala określa stosunek odległości.", "Odległość mnożymy przez mianownik skali."].map((answer, i) => ({
      ...common, exerciseType: "lesson_open_answer" as const, instructionPl: "Wyjaśnij.", prompt: `Wyjaśnij zasadę ${i + 1}.`, answer, focus: [answer],
      questionType: "definition" as const, expectedForm: "explanation" as const, requiredElements: [{ id: "e1", text: answer }],
    })),
    calculationExercise(),
  ];
}

async function seedDraft() {
  const deckId = randomUUID();
  const versionId = randomUUID();
  await pool.query("insert into learning_app.decks (id,title,kind) values ($1,'Skala','lesson')", [deckId]);
  const context = {
    subjectId: "school", topicId: "dynamic", topicVersion: 1, objectiveIds: [OBJECTIVE], poolSize: 20,
    examples: {}, material: MATERIAL, subjectTitlePl: "Geografia",
    dynamicTopic: { titlePl: "Skala", objectives: [{ id: OBJECTIVE, titlePl: "Skala mapy", descriptionEn: "Map scale and distances.",
      cards: [{ title: "Skala", body: "Skala określa stosunek odległości na mapie do odległości w terenie." },
        { title: "Obliczanie", body: "Odległość na mapie mnożymy przez mianownik skali." }] }] },
  };
  await pool.query(`insert into learning_app.deck_versions (id,deck_id,version_number,edit_number,state,title,lesson_context)
    values ($1,$2,1,1,'draft','Skala',$3::jsonb)`, [versionId, deckId, JSON.stringify(context)]);
  return { deckId, versionId };
}

async function skillOf(revisionId: string) {
  return (await pool.query(`select sv.id, sv.criteria_hash, sv.criteria, sv.predecessor_id from learning_app.skill_versions sv
    join learning_app.item_revision_skills irs on irs.skill_version_id=sv.id where irs.item_revision_id=$1`, [revisionId])).rows[0]!;
}

function editInputs(exercises: readonly Record<string, unknown>[]): LessonExerciseInput[] {
  return exercises.map(({ revisionId: _revisionId, ...input }) => LessonExerciseInputSchema.parse(input));
}

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
    learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
    learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`);
});
afterAll(() => pool.end());

describe("calculation draft persistence and publication on PostgreSQL", () => {
  it("round-trips calculation in parent DTO, JSONB v3 and target key", async () => {
    const { deckId, versionId } = await seedDraft();
    const edited = await editLessonDraft(services, versionId, { expectedEditNumber: 1, exercises: [calculationExercise()] });
    expect(edited.exercises[0]!.calculation).toEqual(calculation);
    const read = await readLessonDeck(services, deckId);
    expect(read.draft!.exercises[0]!.calculation).toEqual(calculation);
    await setupParent(services, "calculation-pin");
    const { token } = await loginParent(services, "calculation-pin");
    const response = await handleParentApi(new Request(`http://localhost:3000/api/v1/parent/lessons/${deckId}`, {
      headers: { cookie: `parent_session=${token}` },
    }), services);
    expect(response.status).toBe(200);
    expect((await response.json()).draft.exercises[0].calculation).toEqual(calculation);
    const stored = (await pool.query("select payload,payload_version,target_key from learning_app.item_revisions where deck_version_id=$1", [versionId])).rows[0]!;
    expect(stored.payload.calculation).toEqual(calculation);
    expect(stored.payload_version).toBe(3);
    expect(stored.target_key).toBeTruthy();
  });

  it("versions changed parameters even when the canonical answer and target key stay identical", async () => {
    const { versionId } = await seedDraft();
    let draft = await editLessonDraft(services, versionId, { expectedEditNumber: 1, exercises: [calculationExercise()] });
    const revisionId = draft.exercises[0]!.revisionId;
    const originalSkill = await skillOf(revisionId);
    const originalKey = (await pool.query("select target_key from learning_app.item_revisions where id=$1", [revisionId])).rows[0]!.target_key;
    const changedSpec: CalculationSpec = { ...calculation, params: { scaleDenominator: 75000, mapDistanceCm: 1 } };
    draft = await editLessonDraft(services, versionId, { expectedEditNumber: draft.editNumber,
      exercises: [{ ...calculationExercise(changedSpec), id: draft.exercises[0]!.id }] });
    expect(draft.exercises[0]!.answer).toBe("750 m");
    const nextSkill = await skillOf(revisionId);
    expect(nextSkill.predecessor_id).toBe(originalSkill.id);
    expect(nextSkill.criteria_hash).not.toBe(originalSkill.criteria_hash);
    expect((await pool.query("select target_key from learning_app.item_revisions where id=$1", [revisionId])).rows[0]!.target_key).toBe(originalKey);
  });

  it.each(["answer", "prompt"])("rejects inconsistent %s atomically without repairing the submitted value", async (field) => {
    const { deckId, versionId } = await seedDraft();
    const original = await editLessonDraft(services, versionId, { expectedEditNumber: 1, exercises: [calculationExercise()] });
    await expect(editLessonDraft(services, versionId, { expectedEditNumber: original.editNumber, title: "Must roll back",
      exercises: editInputs([{ ...original.exercises[0], [field]: "sprzeczna treść" }]) })).rejects.toMatchObject({ code: "validation" });
    expect((await readLessonDeck(services, deckId)).draft).toEqual(original);
  });

  it("rejects publication without a source quote even for a persisted calculation", async () => {
    const { versionId } = await seedDraft();
    const draft = await editLessonDraft(services, versionId, { expectedEditNumber: 1, exercises: [calculationExercise()] });
    await pool.query("update learning_app.item_revisions set payload=payload - 'sourceRefs' where deck_version_id=$1", [versionId]);
    await expect(publishLessonDraft(services, versionId, draft.editNumber)).rejects.toMatchObject({ code: "validation" });
    expect((await pool.query("select state from learning_app.deck_versions where id=$1", [versionId])).rows[0]!.state).toBe("draft");
  });

  it("versions grading changes, preserves family-only edits and keeps published revisions and assessments", async () => {
    const { deckId, versionId } = await seedDraft();
    let draft = await editLessonDraft(services, versionId, { expectedEditNumber: 1, exercises: publishablePool() });
    const originalCalculation = draft.exercises.find((ex) => ex.exerciseType === "lesson_calculation")!;
    const firstSkill = await skillOf(originalCalculation.revisionId);
    draft = await editLessonDraft(services, versionId, { expectedEditNumber: draft.editNumber, exercises: editInputs(draft.exercises.map((ex) =>
      ex.id === originalCalculation.id ? { ...ex, calculation: { ...calculation, templateFamilyId: "renamed", tolerance: 0 } } : ex)) });
    expect((await skillOf(originalCalculation.revisionId)).id).toBe(firstSkill.id);
    await publishLessonDraft(services, versionId, draft.editNumber);
    await expect(editLessonDraft(services, versionId, { expectedEditNumber: draft.editNumber, title: "Changed" })).rejects.toMatchObject({ code: "immutable" });
    await expect(pool.query("update learning_app.item_revisions set payload=payload || '{\"answer\":\"0 m\"}'::jsonb where id=$1", [originalCalculation.revisionId])).rejects.toThrow();

    const child = await createChild(services, { displayName: "Uczeń", avatarKey: "owl" });
    await pool.query("insert into learning_app.assignments (id,child_id,deck_id) values ($1,$2,$3)", [randomUUID(), child.id, deckId]);
    const task = await reachCalculation(services, child.id, deckId);
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "750" });
    const assessments = (await pool.query("select * from learning_app.assessments where child_id=$1", [child.id])).rows;
    expect(assessments).toHaveLength(1);
    const publishedRows = (await pool.query("select * from learning_app.item_revisions where deck_version_id=$1 order by position", [versionId])).rows;

    draft = await createLessonDraftFromPublished(services, deckId);
    const clonedCalculation = draft.exercises.find((ex) => ex.id === originalCalculation.id)!;
    expect(clonedCalculation.calculation).toEqual({ ...calculation, templateFamilyId: "renamed", tolerance: 0 });
    draft = await editLessonDraft(services, draft.id, { expectedEditNumber: draft.editNumber, exercises: editInputs(draft.exercises.map((ex) =>
      ex.id === originalCalculation.id ? { ...ex, calculation: { ...ex.calculation!, tolerance: 1 } } : ex)) });
    const nextSkill = await skillOf(clonedCalculation.revisionId);
    expect(nextSkill.id).not.toBe(firstSkill.id);
    expect(nextSkill.predecessor_id).toBe(firstSkill.id);
    expect(nextSkill.criteria_hash).not.toBe(firstSkill.criteria_hash);
    await publishLessonDraft(services, draft.id, draft.editNumber);
    expect((await pool.query("select * from learning_app.item_revisions where deck_version_id=$1 order by position", [versionId])).rows).toEqual(publishedRows);
    expect((await pool.query("select * from learning_app.assessments where child_id=$1", [child.id])).rows).toEqual(assessments);
  });
});


async function reachCalculation(activeServices: typeof services, childId: string, deckId: string) {
  await pool.query(`insert into learning_app.child_objective_progress
    (child_id,subject_id,objective_id,topic_id,status,streak,next_review_at,projection_version)
    values ($1,'school',$2,'dynamic','needs_confirmation',3,'2000-01-01T00:00:00Z','proj-1') on conflict do nothing`, [childId, OBJECTIVE]);
  const session = await startSession(activeServices, { childId, deckId, microphoneEnabled: false });
  for (let i = 0; i < 15; i++) {
    const task = await nextTask(activeServices, session.sessionId);
    if (!task) break;
    if (task.exerciseType === "lesson_calculation") return task;
    if (task.exerciseType === "lesson_card") await completePresentation(activeServices, { taskId: task.taskId });
    else await submitAttempt(activeServices, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  }
  throw new Error("calculation was not issued");
}

async function calculationWorld(withGrader = true) {
  const grade = vi.fn(async () => { throw new Error("calculation must never invoke the grader"); });
  const activeServices = createServices({ db, clock: new ManualClock(), ...(withGrader ? { grader: { provider: { name: "throwing", model: "throwing", promptVersion: "calculation-test-v1", grade }, maxCallsPerSession: 20, timeoutMs: 1000 } } : {}) });
  const child = await createChild(activeServices, { displayName: "Rachunki", avatarKey: "owl" });
  const { deckId, versionId } = await seedDraft();
  const draft = await editLessonDraft(activeServices, versionId, { expectedEditNumber: 1, exercises: [calculationExercise(), ...publishablePool().filter((ex) => ex.exerciseType !== "lesson_calculation")] });
  await publishLessonDraft(activeServices, versionId, draft.editNumber);
  await pool.query("insert into learning_app.assignments (id,child_id,deck_id,test_date,test_goals) values ($1,$2,$3,'2026-11-01',ARRAY['lesson'])", [randomUUID(), child.id, deckId]);
  const task = await reachCalculation(activeServices, child.id, deckId);
  return { activeServices, grade, child, deckId, task };
}

async function assessmentOf(taskId: string) {
  return (await pool.query(`select a.* from learning_app.assessments a join learning_app.attempts t on t.id=a.attempt_id where t.task_id=$1`, [taskId])).rows;
}

async function progressOf(childId: string) {
  return (await pool.query("select * from learning_app.child_objective_progress where child_id=$1", [childId])).rows;
}

describe("calculation grading on PostgreSQL", () => {
  it.each([
    ["750", "correct", "closed_correct", "great"],
    ["749 m", "incorrect", "closed_incorrect", "lesson_hint"],
    ["nie wiem jak", "unevaluated", "unavailable", "not_assessed"],
    ["750.0", "unevaluated", "unavailable", "not_assessed"],
  ])("grades %s deterministically even with an incompatible cached verdict", async (text, outcome, verdict, feedbackKind) => {
    const { activeServices, grade, child, task } = await calculationWorld();
    const revisionId = (await pool.query("select item_revision_id from learning_app.session_tasks where id=$1", [task.taskId])).rows[0]!.item_revision_id;
    await pool.query(`insert into learning_app.lesson_verdicts (id,item_revision_id,normalized_answer,prompt_version,grader_model,verdict)
      values ($1,$2,$3,'calculation-test-v1','old-model',$4)`, [randomUUID(), revisionId, text, outcome === "correct" ? "incorrect" : "correct"]);
    const before = await progressOf(child.id);
    const result = await submitAttempt(activeServices, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text });
    expect(result.feedback?.kind).toBe(feedbackKind);
    expect(result.feedback).not.toHaveProperty("correctText");
    const assessments = await assessmentOf(task.taskId);
    expect(assessments).toHaveLength(1);
    expect(assessments[0]).toMatchObject({ outcome: outcome === "unevaluated" ? "unassessed" : outcome, details: { verdict } });
    expect(assessments[0]!.details).not.toHaveProperty("precision");
    expect(grade).not.toHaveBeenCalled();
    expect((await pool.query("select count(*)::int as count from learning_app.lesson_verdicts")).rows[0]!.count).toBe(1);
    if (outcome === "unevaluated") {
      expect(await progressOf(child.id)).toEqual(before);
      expect(result.taskState).toBe("issued");
    }
  });

  it("issues and grades an independent due calculation with no grader configured", async () => {
    const { activeServices, task } = await calculationWorld(false);
    const result = await submitAttempt(activeServices, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "0,75 km" });
    expect(result.feedback).toEqual({ kind: "great" });
    expect((await assessmentOf(task.taskId))[0]).toMatchObject({ outcome: "correct", independent: true });
  });

  it("serializes identical concurrent submissions, replays the result and conflicts on changed content", async () => {
    const { activeServices, task, child } = await calculationWorld();
    const input = { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text" as const, text: "750" };
    const [a, b] = await Promise.all([submitAttempt(activeServices, input), submitAttempt(activeServices, input)]);
    const { stepId: stepA, ...resultA } = a;
    const { stepId: stepB, ...resultB } = b;
    expect(resultA).toEqual(resultB);
    expect(new Set([stepA, stepB])).toEqual(new Set([task.taskId + ":f1", task.taskId + ":f2"]));
    const { stepId: replayStep, ...replay } = await submitAttempt(activeServices, input);
    expect(replay).toEqual(resultA);
    expect(replayStep).toBe(task.taskId + ":f3");
    expect(await assessmentOf(task.taskId)).toHaveLength(1);
    expect((await pool.query("select * from learning_app.attempts where task_id=$1", [task.taskId])).rows).toHaveLength(1);
    expect(await progressOf(child.id)).toHaveLength(1);
    expect((await pool.query("select * from learning_app.learning_events where task_id=$1 and kind='feedback_issued'", [task.taskId])).rows).toHaveLength(3);
    await expect(submitAttempt(activeServices, { ...input, text: "751" })).rejects.toMatchObject({ code: "conflict" });
  });

  it.each(["skip", "dont_remember"] as const)("preserves %s semantics", async (modality) => {
    const { activeServices, task } = await calculationWorld();
    const result = await submitAttempt(activeServices, { taskId: task.taskId, clientAttemptId: randomUUID(), modality });
    const assessments = await assessmentOf(task.taskId);
    if (modality === "skip") { expect(assessments).toEqual([]); expect(result.taskState).toBe("skipped"); }
    else { expect(assessments[0]).toMatchObject({ outcome: "incorrect", reason: "dont_remember" }); expect(result.feedback).toMatchObject({ correctText: "750 m" }); }
  });

  it("rolls back assessment, attempt, projection and disclosure when the final feedback write fails", async () => {
    const { activeServices, task, child } = await calculationWorld();
    const before = await progressOf(child.id);
    await pool.query(`create function learning_app.reject_calculation_feedback() returns trigger language plpgsql as $$ begin if NEW.kind='feedback_issued' then raise exception 'injected feedback failure'; end if; return NEW; end $$`);
    await pool.query("create trigger reject_calculation_feedback before insert on learning_app.learning_events for each row execute function learning_app.reject_calculation_feedback()");
    try {
      await expect(submitAttempt(activeServices, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "750" })).rejects.toThrow();
      expect(await assessmentOf(task.taskId)).toEqual([]);
      expect((await pool.query("select * from learning_app.attempts where task_id=$1", [task.taskId])).rows).toEqual([]);
      expect(await progressOf(child.id)).toEqual(before);
      expect((await pool.query("select state from learning_app.session_tasks where id=$1", [task.taskId])).rows[0]!.state).toBe("issued");
      expect((await pool.query("select * from learning_app.learning_events where task_id=$1 and kind='feedback_issued'", [task.taskId])).rows).toEqual([]);
    } finally {
      await pool.query("drop trigger reject_calculation_feedback on learning_app.learning_events");
      await pool.query("drop function learning_app.reject_calculation_feedback()");
    }
  });

  it("suppresses calculation feedback until the mock-test summary and renders the actual question", async () => {
    const { activeServices, child, deckId } = await calculationWorld(false);
    // Close the training session before starting a separate mock test.
    const active = (await pool.query("select id from learning_app.learning_sessions where child_id=$1 and state='active'", [child.id])).rows[0]!;
    await endSession(activeServices, active.id);
    const session = await startSession(activeServices, { childId: child.id, deckId, microphoneEnabled: false, mode: "mock_test" });
    const task = await nextTask(activeServices, session.sessionId);
    expect(task?.exerciseType).toBe("lesson_calculation");
    const result = await submitAttempt(activeServices, { taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "text", text: "749" });
    expect(result.feedback).toBeNull();
    expect((await pool.query("select * from learning_app.learning_events where task_id=$1 and kind='feedback_issued'", [task!.taskId])).rows).toEqual([]);
    await endSession(activeServices, session.sessionId);
    const summary = await readLessonMockTestSummary(activeServices, session.sessionId);
    expect(summary.solutions.find((solution) => solution.taskId === task!.taskId)).toMatchObject({ prompt: "Na mapie w skali 1:25 000 odcinek ma 3 cm. Oblicz odległość w terenie w m.", childAnswer: "749", correctAnswer: "750 m", outcome: "incorrect" });
  });
});


it.each(["text", "dont_remember"] as const)("rejects a corrupt private calculation key for %s without any knowledge assessment", async (modality) => {
  const { activeServices, task, grade, child } = await calculationWorld();
  const before = await progressOf(child.id);
  // Seed a malformed legacy snapshot as a fresh task; issued snapshots remain immutable.
  await pool.query("update learning_app.session_tasks set state='skipped' where id=$1", [task.taskId]);
  const badTaskId = randomUUID();
  await pool.query(`insert into learning_app.session_tasks
    (id,session_id,child_id,deck_version_id,item_revision_id,ordinal,exercise_type,state,public_prompt,answer_key,context,issued_at)
    select $1,session_id,child_id,deck_version_id,item_revision_id,ordinal+1000,exercise_type,'issued',public_prompt,
    answer_key || '{"calculation":{"kind":"unknown"}}'::jsonb,context,issued_at from learning_app.session_tasks where id=$2`, [badTaskId,task.taskId]);
  task.taskId = badTaskId;
  const input = modality === "text" ? { modality, text: "750" } : { modality };
  await expect(submitAttempt(activeServices, { taskId: task.taskId, clientAttemptId: randomUUID(), ...input })).rejects.toMatchObject({ code: "internal" });
  expect(await assessmentOf(task.taskId)).toEqual([]);
  expect(await progressOf(child.id)).toEqual(before);
  expect(grade).not.toHaveBeenCalled();
});

it("includes the actual calculation and submitted answer in the session activity report", async () => {
  const { activeServices, task } = await calculationWorld(false);
  const reviewer = new FakeSessionActivityReviewer();
  const activityServices = createServices({ db, clock: activeServices.clock, subjects: activeServices.subjects, sessionActivity: fakeSessionActivityDeps({ provider: reviewer }) });
  const result = await submitAttempt(activityServices, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "750" });
  const sessionId = (await pool.query("select session_id from learning_app.session_tasks where id=$1", [task.taskId])).rows[0]!.session_id;
  (activeServices.clock as ManualClock).advanceMs(60000);
  const summary = await endSession(activityServices, sessionId);
  expect(summary.objectives).toEqual([{ objectiveId: OBJECTIVE, titlePl: "Skala mapy", practiced: 1, correct: 1 }]);
  expect(await endSession(activityServices, sessionId)).toEqual(summary);
  const review = await reviewSessionActivity(activityServices, sessionId, { version: 1, elapsedMs: 60000, activeMs: 60000, compacted: false,
    tasks: [{ taskId: task.taskId, exerciseType: "lesson_calculation", shownFromMs: 0, shownToMs: 60000, activeIntervals: [[0,60000]], editCount: 1, editWindows: [{ atMs: 1000, count: 1 }], submittedAttempts: [result.attemptId], playbacks: [], pauses: [] }] });
  expect(review.status).toBe("evaluated");
  expect(reviewer.requests[0]!.tasks[0]).toMatchObject({ instruction: "Oblicz.", stimulus: "Na mapie w skali 1:25 000 odcinek ma 3 cm. Oblicz odległość w terenie w m.", acceptedAnswers: ["750 m"], submittedAnswers: [{ text: "750", modality: "text" }] });
});


it("an earlier disclosure of the same numeric target prevents independent qualification", async () => {
  const { activeServices, task, child } = await calculationWorld(false);
  const priorTaskId = randomUUID();
  const priorAt = new Date(activeServices.clock.now().getTime() - 600000);
  await pool.query(`insert into learning_app.session_tasks
    (id,session_id,child_id,deck_version_id,item_revision_id,ordinal,exercise_type,state,public_prompt,answer_key,context,issued_at)
    select $1,session_id,child_id,deck_version_id,item_revision_id,ordinal+1000,exercise_type,'skipped',public_prompt,answer_key,context,$3
    from learning_app.session_tasks where id=$2`, [priorTaskId,task.taskId,priorAt]);
  const row = (await pool.query(`select r.item_id,t.answer_key from learning_app.session_tasks t
    join learning_app.item_revisions r on r.id=t.item_revision_id where t.id=$1`, [task.taskId])).rows[0]!;
  await activeServices.db.transaction((tx) => writeSealedEvent(tx, { childId: child.id, taskId: priorTaskId, itemId: row.item_id,
    kind: "feedback_issued", stepId: priorTaskId + ":f1", occurredAt: priorAt, exposures: [row.answer_key.targetKey] }));
  await submitAttempt(activeServices, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "750" });
  expect((await assessmentOf(task.taskId))[0]).toMatchObject({ outcome: "correct", independent: false, confirmation_eligible: false });
});
