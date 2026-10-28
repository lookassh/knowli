import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation, createChild, createLessonDraftFromPublished, createServices,
  editLessonDraft, loginParent, nextTask, publishLessonDraft, readLessonDeck, setupParent, startSession, submitAttempt,
} from "@learning/server";
import { LessonExerciseInputSchema, type CalculationSpec, type LessonExerciseInput } from "@learning/contracts";
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
    const session = await startSession(services, { childId: child.id, deckId, microphoneEnabled: false });
    for (let i = 0; i < 8; i++) {
      const task = await nextTask(services, session.sessionId);
      if (!task) throw new Error("missing choice task");
      if (task.exerciseType === "lesson_card") { await completePresentation(services, { taskId: task.taskId }); continue; }
      expect(task.exerciseType).toBe("lesson_choice");
      const key = (await pool.query("select answer_key from learning_app.session_tasks where id=$1", [task.taskId])).rows[0]!.answer_key;
      await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId });
      break;
    }
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
