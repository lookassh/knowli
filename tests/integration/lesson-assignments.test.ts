import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation, createChild, createServices, editLessonDraft, endSession, getLessonMockTestReport, nextTask,
  publishLessonDraft, readLessonDeck, readLessonMockTestSummary, startSession, submitAttempt,
} from "@learning/server";
import type { LessonExerciseInput, TaskDto } from "@learning/contracts";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";

/**
 * Etap 7 przedmiotów szkolnych (design §10): „Połącz w pary” i „Pogrupuj” na
 * PostgreSQL — edycja rodzica i publikacja, wydanie zadania bez klucza, ocena
 * przypisań bez modelu (poprawna, błędna, kształt niezgodny → 400 bez próby),
 * idempotencja niezależna od kolejności stukania i omówienie kartkówki.
 */

const { db, pool } = testDatabase();
const OBJECTIVE = "school.ddeck000.siatka";
const MATERIAL =
  "Równik dzieli Ziemię na półkulę północną i południową. Południki łączą bieguny. " +
  "Równoleżniki biegną równolegle do równika. Ssaki karmią młode mlekiem, a ptaki wysiadują jaja.";

function services() {
  return createServices({ db, clock: new ManualClock() });
}

const common = { objectiveId: OBJECTIVE, acceptedAnswers: [], sourceRefs: [{ quote: "Równik dzieli Ziemię na półkulę północną i południową." }] };

const MATCH: LessonExerciseInput = {
  ...common, exerciseType: "lesson_match", instructionPl: "Połącz pojęcie z opisem.", focus: [],
  pairs: [
    { left: "równik", right: "dzieli Ziemię na półkule" },
    { left: "południk", right: "łączy bieguny" },
    { left: "równoleżnik", right: "biegnie równolegle do równika" },
  ],
  extraRight: ["najwyższy szczyt"],
  answer: "równik, południk, równoleżnik",
};

const GROUP: LessonExerciseInput = {
  ...common, exerciseType: "lesson_group", instructionPl: "Pogrupuj zwierzęta.", focus: [],
  groups: [{ id: "g1", label: "ssaki" }, { id: "g2", label: "ptaki" }],
  groupItems: [
    { text: "pies", groupId: "g1" }, { text: "delfin", groupId: "g1" },
    { text: "wróbel", groupId: "g2" }, { text: "sowa", groupId: "g2" },
  ],
  answer: "ssaki / ptaki",
};

/** Pula spełniająca minima publikacji szkoły + pary i grupy na początku (pierwsze w kolejności puli). */
function pool7(): LessonExerciseInput[] {
  return [
    MATCH,
    GROUP,
    ...["półkule", "bieguny", "równika"].map((answer) => ({
      ...common, exerciseType: "lesson_choice" as const, instructionPl: "Wybierz.", stem: `Wybierz słowo: ${answer}.`, answer, focus: [answer],
      options: [{ id: "a", text: answer }, { id: "b", text: "innym" }], correctOption: "a",
    })),
    ...["bieguny", "półkule"].map((answer) => ({
      ...common, exerciseType: "lesson_gap" as const, instructionPl: "Uzupełnij.", stem: `Słowo ___ (${answer}).`, answer, focus: [answer],
    })),
    ...["Równik dzieli Ziemię na półkule.", "Południki łączą bieguny."].map((answer, i) => ({
      ...common, exerciseType: "lesson_open_answer" as const, instructionPl: "Wyjaśnij.", prompt: `Wyjaśnij zasadę ${i + 1}.`, answer, focus: [answer],
      questionType: "definition" as const, expectedForm: "explanation" as const, requiredElements: [{ id: "e1", text: answer }],
    })),
  ];
}

async function seedDraft() {
  const deckId = randomUUID();
  const versionId = randomUUID();
  await pool.query("insert into learning_app.decks (id,title,kind) values ($1,'Siatka','lesson')", [deckId]);
  const context = {
    subjectId: "school", topicId: "dynamic", topicVersion: 1, objectiveIds: [OBJECTIVE], poolSize: 20,
    examples: {}, material: MATERIAL, subjectTitlePl: "Geografia",
    dynamicTopic: { titlePl: "Siatka geograficzna", objectives: [{ id: OBJECTIVE, titlePl: "Siatka geograficzna", descriptionEn: "Equator, meridians, parallels.",
      cards: [{ title: "Równik", body: "Równik dzieli Ziemię na półkule." }, { title: "Południki", body: "Południki łączą bieguny." }] }] },
  };
  await pool.query(`insert into learning_app.deck_versions (id,deck_id,version_number,edit_number,state,title,lesson_context)
    values ($1,$2,1,1,'draft','Siatka',$3::jsonb)`, [versionId, deckId, JSON.stringify(context)]);
  return { deckId, versionId };
}

async function publishedWorld() {
  const active = services();
  const child = await createChild(active, { displayName: "Pary", avatarKey: "owl" });
  const { deckId, versionId } = await seedDraft();
  const draft = await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: pool7() });
  await publishLessonDraft(active, versionId, draft.editNumber);
  await pool.query("insert into learning_app.assignments (id,child_id,deck_id,test_date,test_goals) values ($1,$2,$3,CURRENT_DATE + 7,ARRAY['lesson'])", [randomUUID(), child.id, deckId]);
  return { active, child, deckId };
}

/** Dochodzi do zadania danego typu; inne ćwiczenia pomija, karty zamyka. */
async function reach(active: ReturnType<typeof services>, sessionId: string, type: TaskDto["exerciseType"]): Promise<TaskDto> {
  for (let i = 0; i < 30; i++) {
    const task = await nextTask(active, sessionId);
    if (!task) break;
    if (task.exerciseType === type) return task;
    if (task.exerciseType === "lesson_card") await completePresentation(active, { taskId: task.taskId });
    else await submitAttempt(active, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  }
  throw new Error(`${type} was not issued`);
}

async function keyOf(taskId: string): Promise<{ assignments: { itemId: string; targetId: string }[]; targetIds: string[] }> {
  return (await pool.query(`select answer_key as "answerKey" from learning_app.session_tasks where id=$1`, [taskId])).rows[0]!.answerKey;
}

/** Grupy z tekstu „etykieta: a, b; …” — elementy idą w kolejności pokazanej dziecku, więc porównujemy zbiory. */
function groupsOf(text: string): Record<string, string[]> {
  return Object.fromEntries(text.split("; ").map((part) => {
    const [label, items] = part.split(": ");
    return [label!, items!.split(", ").sort()];
  }));
}

const EXPECTED_GROUPS = { ssaki: ["delfin", "pies"], ptaki: ["sowa", "wróbel"] };

async function attemptsOf(taskId: string) {
  return (await pool.query("select * from learning_app.attempts where task_id=$1", [taskId])).rows;
}

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
    learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
    learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`);
});
afterAll(() => pool.end());

describe("pary i grupy: edycja rodzica i publikacja", () => {
  it("zapisuje pary i grupy w szkicu (payload v3) i odrzuca grupę z jednym elementem", async () => {
    const active = services();
    const { deckId, versionId } = await seedDraft();
    const draft = await editLessonDraft(active, versionId, { expectedEditNumber: 1, exercises: [MATCH, GROUP] });
    expect(draft.exercises.map((ex) => ex.exerciseType)).toEqual(["lesson_match", "lesson_group"]);
    expect(draft.exercises[0]!.pairs).toEqual(MATCH.pairs);
    expect(draft.exercises[0]!.extraRight).toEqual(["najwyższy szczyt"]);
    expect(draft.exercises[1]!.groupItems).toEqual(GROUP.groupItems);
    const read = await readLessonDeck(active, deckId);
    expect(read.draft!.exercises[1]!.groups).toEqual(GROUP.groups);
    const stored = (await pool.query("select payload, payload_version from learning_app.item_revisions where deck_version_id=$1 order by position", [versionId])).rows;
    expect(stored[0]!.payload_version).toBe(3);
    expect(stored[0]!.payload.pairs).toEqual(MATCH.pairs);

    const broken = { ...GROUP, groupItems: [{ text: "pies", groupId: "g1" }, { text: "delfin", groupId: "g1" }, { text: "kot", groupId: "g1" }, { text: "sowa", groupId: "g2" }] };
    await expect(editLessonDraft(active, versionId, { expectedEditNumber: draft.editNumber, exercises: [MATCH, broken] }))
      .rejects.toMatchObject({ code: "validation" });
  });
});

describe("pary i grupy: sesja treningowa", () => {
  it("„Połącz w pary”: prompt bez klucza, poprawne przypisania → great, wspomagane, bez modelu", async () => {
    const { active, child, deckId } = await publishedWorld();
    const session = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const task = await reach(active, session.sessionId, "lesson_match");
    const prompt = task.prompt as { kind: string; left: { id: string; text: string }[]; right: { id: string; text: string }[] };
    expect(prompt.kind).toBe("lesson_match");
    expect(prompt.right.map((item) => item.text).sort()).toEqual(["biegnie równolegle do równika", "dzieli Ziemię na półkule", "łączy bieguny", "najwyższy szczyt"].sort());
    expect(JSON.stringify(task.prompt)).not.toMatch(/assignments|targetIds|pairs/);

    const key = await keyOf(task.taskId);
    const result = await submitAttempt(active, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "assignment", assignments: [...key.assignments].reverse() });
    expect(result.feedback).toEqual({ kind: "great" });
    const rows = (await pool.query(`select a.independent, a.outcome, t.modality, t.answer from learning_app.assessments a
      join learning_app.attempts t on t.id = a.attempt_id where t.task_id = $1`, [task.taskId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ independent: false, outcome: "correct", modality: "assignment" });
    expect(rows[0]!.answer.assignments).toHaveLength(3);
  });

  it("„Pogrupuj”: błąd pokazuje poprawne grupy; zła kolejność stukania to ta sama treść (idempotencja)", async () => {
    const { active, child, deckId } = await publishedWorld();
    const session = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const task = await reach(active, session.sessionId, "lesson_group");
    const key = await keyOf(task.taskId);
    const [g1, g2] = key.targetIds;
    const wrong = key.assignments.map((entry) => ({ itemId: entry.itemId, targetId: entry.targetId === g1 ? g2! : g1! }));
    const clientAttemptId = randomUUID();
    const result = await submitAttempt(active, { taskId: task.taskId, clientAttemptId, modality: "assignment", assignments: wrong });
    expect(result.feedback!.kind).toBe("incorrect");
    const correctText = (result.feedback as { correctText: string }).correctText;
    expect(correctText.startsWith("ssaki: ")).toBe(true);
    expect(groupsOf(correctText)).toEqual(EXPECTED_GROUPS);
    const retry = await submitAttempt(active, { taskId: task.taskId, clientAttemptId, modality: "assignment", assignments: [...wrong].reverse() });
    expect(retry.attemptId).toBe(result.attemptId);
    expect(await attemptsOf(task.taskId)).toHaveLength(1);
  });

  it("przypisania niepasujące do zadania → 400 bez próby i oceny", async () => {
    const { active, child, deckId } = await publishedWorld();
    const session = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false });
    const task = await reach(active, session.sessionId, "lesson_match");
    const key = await keyOf(task.taskId);
    const missing = key.assignments.slice(0, 2).concat({ itemId: randomUUID(), targetId: key.assignments[2]!.targetId });
    await expect(submitAttempt(active, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "assignment", assignments: missing }))
      .rejects.toMatchObject({ code: "validation" });
    const twice = key.assignments.map((entry) => ({ itemId: entry.itemId, targetId: key.assignments[0]!.targetId }));
    await expect(submitAttempt(active, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "assignment", assignments: twice }))
      .rejects.toMatchObject({ code: "validation" });
    await expect(submitAttempt(active, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "sequence", itemIds: [key.assignments[0]!.itemId] }))
      .rejects.toMatchObject({ code: "validation" });
    expect(await attemptsOf(task.taskId)).toEqual([]);
  });
});

describe("pary i grupy: kartkówka", () => {
  it("omówienie pokazuje odpowiedź dziecka i poprawne pary oraz grupy tekstem", async () => {
    const { active, child, deckId } = await publishedWorld();
    const session = await startSession(active, { childId: child.id, deckId, microphoneEnabled: false, mode: "mock_test" });
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const task = await nextTask(active, session.sessionId);
      if (!task) break;
      if (task.exerciseType === "lesson_card") { await completePresentation(active, { taskId: task.taskId }); continue; }
      if (task.exerciseType === "lesson_match" || task.exerciseType === "lesson_group") {
        seen.push(task.exerciseType);
        const key = await keyOf(task.taskId);
        const result = await submitAttempt(active, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "assignment", assignments: key.assignments });
        expect(result.feedback).toBeNull();
        continue;
      }
      await submitAttempt(active, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    }
    expect(seen.sort()).toEqual(["lesson_group", "lesson_match"]);
    await endSession(active, session.sessionId);
    const summary = await readLessonMockTestSummary(active, session.sessionId);
    const match = summary.solutions.find((solution) => solution.exerciseType === "lesson_match")!;
    expect(match).toMatchObject({ prompt: "Połącz pojęcie z opisem.", outcome: "correct" });
    expect(match.correctAnswer).toBe(match.childAnswer);
    expect(match.correctAnswer.split("; ").sort()).toEqual([
      "południk → łączy bieguny", "równik → dzieli Ziemię na półkule", "równoleżnik → biegnie równolegle do równika",
    ]);
    const group = summary.solutions.find((solution) => solution.exerciseType === "lesson_group")!;
    expect(groupsOf(group.correctAnswer)).toEqual(EXPECTED_GROUPS);
    expect(groupsOf(group.childAnswer)).toEqual(EXPECTED_GROUPS);
    const report = await getLessonMockTestReport(active, session.sessionId);
    expect(report.objectives.find((row) => row.objectiveId === OBJECTIVE)!.correct).toBeGreaterThanOrEqual(2);
  });
});
