import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  computeTargetKey,
  createChild,
  createServices,
  FakeAnswerGrader,
  lessonObjectiveProgress,
  nextTask,
  startSession,
  submitAttempt,
} from "@learning/server";
import type { TaskDto } from "@learning/contracts";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

/**
 * Etap 2: ocena dwuwymiarowa odpowiedzi otwartej szkoły na prawdziwej ścieżce
 * prób (fake grader): wiedza steruje wynikiem, precyzja ląduje w szczegółach
 * oceny i w raporcie rodzica; werdykt zapisuje się do cache `lesson_verdicts`
 * z wersją `fake-school-grader-v1`.
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

const OBJECTIVE_ID = "school.ddeck000.fotosynteza";
const MATERIAL =
  "Fotosynteza to proces, w którym roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry.";

async function seedSchoolDeck(childId: string): Promise<{ deckId: string }> {
  const deckId = randomUUID();
  const versionId = randomUUID();
  const context = {
    subjectId: "school",
    topicId: "dynamic",
    topicVersion: 1,
    objectiveIds: [OBJECTIVE_ID],
    poolSize: 20,
    examples: {},
    material: MATERIAL,
    subjectTitlePl: "Przyroda",
    dynamicTopic: {
      titlePl: "Rośliny",
      objectives: [{
        id: OBJECTIVE_ID,
        titlePl: "Fotosynteza",
        descriptionEn: "Photosynthesis: plant produces sugars from water, carbon dioxide and light.",
        cards: [
          { title: "Co to jest?", body: "Roślina wytwarza cukry z wody i dwutlenku węgla przy świetle." },
          { title: "Po co?", body: "Cukry są pokarmem rośliny." },
        ],
      }],
    },
  };
  await pool.query("insert into learning_app.decks (id, title, kind) values ($1, 'Przyroda: Rośliny', 'lesson')", [deckId]);
  await pool.query(
    `insert into learning_app.deck_versions (id, deck_id, version_number, edit_number, state, title, lesson_context)
     values ($1, $2, 1, 1, 'draft', 'Przyroda: Rośliny', $3::jsonb)`,
    [versionId, deckId, JSON.stringify(context)],
  );
  const exercises: Record<string, unknown>[] = [
    {
      exerciseType: "lesson_choice", objectiveId: OBJECTIVE_ID, instructionPl: "Wybierz.",
      stem: "Co roślina wytwarza w fotosyntezie?", answer: "cukry", acceptedAnswers: [], focus: ["cukry"],
      options: [{ id: "a", text: "cukry" }, { id: "b", text: "tlen" }], correctOption: "a",
      sourceRefs: [{ quote: "wytwarza cukry" }],
    },
    {
      // Drugie ćwiczenie prowadzone: awans etapu wymaga 2 sukcesów (advanceAfterCorrect).
      exerciseType: "lesson_choice", objectiveId: OBJECTIVE_ID, instructionPl: "Wybierz.",
      stem: "Co roślina wykorzystuje ze słońca?", answer: "światło", acceptedAnswers: [], focus: ["światło"],
      options: [{ id: "a", text: "światło" }, { id: "b", text: "cień" }], correctOption: "a",
      sourceRefs: [{ quote: "przy udziale światła" }],
    },
    {
      exerciseType: "lesson_gap", objectiveId: OBJECTIVE_ID, instructionPl: "Uzupełnij.",
      stem: "W fotosyntezie roślina wytwarza ___.", answer: "cukry", acceptedAnswers: [], focus: ["cukry"],
      sourceRefs: [{ quote: "wytwarza cukry" }],
    },
    {
      exerciseType: "lesson_gap", objectiveId: OBJECTIVE_ID, instructionPl: "Uzupełnij.",
      stem: "Roślina wytwarza cukry z wody i ___.", answer: "dwutlenku węgla", acceptedAnswers: [], focus: ["dwutlenku"],
      sourceRefs: [{ quote: "z wody i dwutlenku węgla" }],
    },
    {
      exerciseType: "lesson_open_answer", objectiveId: OBJECTIVE_ID, instructionPl: "Odpowiedz własnymi słowami.",
      prompt: "Co to jest fotosynteza?",
      answer: "Roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry.",
      acceptedAnswers: [], focus: ["wytwarza cukry"],
      questionType: "definition", expectedForm: "explanation",
      requiredElements: [
        { id: "e1", text: "Roślina wytwarza cukry" },
        { id: "e2", text: "roślina wykorzystuje światło" },
      ],
      supplementaryElements: [], commonErrors: [],
      sourceRefs: [{ quote: "przy udziale światła, wytwarza cukry" }],
    },
  ];
  let position = 0;
  for (const payload of exercises) {
    const itemId = randomUUID();
    const revisionId = randomUUID();
    const skillVersionId = randomUUID();
    await pool.query("insert into learning_app.learning_items (id, deck_id, kind) values ($1, $2, 'lesson_exercise')", [itemId, deckId]);
    await pool.query(
      `insert into learning_app.item_revisions (id, item_id, deck_id, deck_version_id, position, payload_version, payload, target_key)
       values ($1, $2, $3, $4, $5, 3, $6::jsonb, $7)`,
      [revisionId, itemId, deckId, versionId, position++, JSON.stringify(payload), computeTargetKey(String(payload.answer), "pl-PL")],
    );
    await pool.query(
      `insert into learning_app.skill_versions (id, item_id, skill, revision_number, criteria, criteria_hash)
       values ($1, $2, 'objective', 1, $3::jsonb, $4)`,
      [skillVersionId, itemId, JSON.stringify({ objectiveId: OBJECTIVE_ID }), `oc-${skillVersionId}`],
    );
    await pool.query(
      "insert into learning_app.item_revision_skills (item_revision_id, item_id, skill, skill_version_id) values ($1, $2, 'objective', $3)",
      [revisionId, itemId, skillVersionId],
    );
  }
  await pool.query("update learning_app.deck_versions set state = 'published', published_at = now() where id = $1", [versionId]);
  await pool.query("update learning_app.decks set published_version_id = $1 where id = $2", [versionId, deckId]);
  await pool.query(
    "insert into learning_app.assignments (id, child_id, deck_id, test_date, test_goals) values ($1, $2, $3, CURRENT_DATE + 7, ARRAY['lesson'])",
    [randomUUID(), childId, deckId],
  );
  return { deckId };
}

type AnyServices = ReturnType<typeof createServices>;

function makeServices(grader?: FakeAnswerGrader): AnyServices {
  const { services: base, clock } = buildTestServices();
  return createServices({
    db: (base as unknown as { db: Parameters<typeof createServices>[0]["db"] }).db,
    clock,
    ...(grader ? { grader: { provider: grader, maxCallsPerSession: 20, timeoutMs: 8000 } } : {}),
  });
}

/**
 * Dochodzi do zadania otwartego, awansując poprawnie przez wcześniejsze etapy
 * (klucz z bazy, jak w lesson-grader.test). Plan sesji jest zamrażany na starcie,
 * więc nowy cel przechodzi etapy w kolejnych sesjach — helper startuje następne
 * sesje aż do wydania zadania otwartego.
 */
async function reachOpenTask(services: AnyServices, childId: string, deckId: string): Promise<TaskDto> {
  // Zadanie otwarte (etap independent) plan wydaje jako należne sprawdzenie:
  // seedujemy postęp z przeszłym terminem powtórki.
  await pool.query(
    `insert into learning_app.child_objective_progress
       (child_id, subject_id, objective_id, topic_id, status, streak, next_review_at, projection_version)
     values ($1, 'school', $2, 'dynamic', 'needs_confirmation', 3, '2000-01-01T00:00:00Z', 'proj-1')
     on conflict do nothing`,
    [childId, OBJECTIVE_ID],
  );
  for (let s = 0; s < 5; s++) {
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    for (let i = 0; i < 40; i++) {
      const task = await nextTask(services, session.sessionId);
      if (task === null) break;
      if (task.exerciseType === "lesson_open_answer") return task;
      if (task.exerciseType === "lesson_card") {
        await completePresentation(services, { taskId: task.taskId });
        continue;
      }
      const rows = await pool.query<{ answerKey: Record<string, unknown> }>(
        `select answer_key as "answerKey" from learning_app.session_tasks where id = $1`,
        [task.taskId],
      );
      const key = rows.rows[0]!.answerKey;
      if (task.exerciseType === "lesson_choice") {
        await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
      } else {
        await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.answer as string });
      }
    }
  }
  throw new Error("open task not reached");
}

describe("ocena szkolna dwuwymiarowa (integracja)", () => {
  it("parafraza ze wszystkimi elementami: wiedza correct, precyzja w details i raporcie; werdykt v2 w cache", async () => {
    const grader = new FakeAnswerGrader();
    const { services: base, clock } = buildTestServices();
    const services = createServices({
      db: (base as unknown as { db: Parameters<typeof createServices>[0]["db"] }).db,
      clock,
      grader: { provider: grader, maxCallsPerSession: 20, timeoutMs: 8000 },
    });
    const child = await createChild(services, { displayName: "Szkolny", avatarKey: "owl" });
    const { deckId } = await seedSchoolDeck(child.id);

    const session = await startSession(services, { childId: child.id, deckId, microphoneEnabled: false, mode: "mock_test" });
    let openTask: TaskDto | null = null;
    for (let i = 0; i < 10 && !openTask; i++) {
      const task = await nextTask(services, session.sessionId);
      if (task === null) break;
      if (task.exerciseType === "lesson_open_answer") openTask = task;
      else if (task.exerciseType === "lesson_card") await completePresentation(services, { taskId: task.taskId });
      else await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    }
    expect(openTask).not.toBeNull();

    // Parafraza (nie dokładny wzorzec): dopasowanie deterministyczne nie trafia,
    // więc ocenia fake grader po elementach wymaganych.
    const result = await submitAttempt(services, {
      taskId: openTask!.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: "Roślina wytwarza cukry, bo wykorzystuje światło.",
    });
    // Kartkówka nie pokazuje feedbacku w trakcie — ocena jest w bazie i raporcie.
    expect(result.feedback).toBeNull();
    expect(grader.requests.some((r) => r.school !== undefined)).toBe(true);
    expect(grader.requests.find((r) => r.school)?.school?.requiredElements).toHaveLength(2);

    const verdicts = await pool.query<{ prompt_version: string; precision: string | null; verdict: string }>(
      "select prompt_version, precision, verdict from learning_app.lesson_verdicts",
    );
    expect(verdicts.rows).toHaveLength(1);
    expect(verdicts.rows[0]!.prompt_version).toBe("fake-school-grader-v1");
    expect(verdicts.rows[0]!.precision).toBe("concise");
    expect(verdicts.rows[0]!.verdict).toBe("correct");

    const assessments = await pool.query<{ outcome: string; details: { knowledge?: string; precision?: string } }>(
      "select outcome, details from learning_app.assessments where child_id = $1 and details ? 'knowledge'",
      [child.id],
    );
    expect(assessments.rows).toHaveLength(1);
    expect(assessments.rows[0]!.outcome).toBe("correct");
    expect(assessments.rows[0]!.details.knowledge).toBe("correct");

    const progress = await lessonObjectiveProgress(services, deckId, child.id);
    expect(progress[0]!.school?.knowledge.correct).toBe(1);
    expect(progress[0]!.school?.precision.concise).toBe(1);
    expect(progress[0]!.school?.recentAnswers[0]?.text).toContain("wytwarza cukry");
  });

  it("zwykła sesja: odpowiedź częściowa NIE ujawnia wzorca — podpowiedź z szablonu, errorCategory w details (K2/W9)", async () => {
    const grader = new FakeAnswerGrader();
    const { services: base, clock } = buildTestServices();
    const services = createServices({
      db: (base as unknown as { db: Parameters<typeof createServices>[0]["db"] }).db,
      clock,
      grader: { provider: grader, maxCallsPerSession: 20, timeoutMs: 8000 },
    });
    const child = await createChild(services, { displayName: "Częściowy", avatarKey: "fox" });
    const { deckId } = await seedSchoolDeck(child.id);

    const openTask = await reachOpenTask(services, child.id, deckId);

    // Tylko element e1 (brak światła) → partial u fake gradera.
    const result = await submitAttempt(services, {
      taskId: openTask!.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: "Roślina wytwarza cukry z wody.",
    });
    expect(result.feedback).not.toBeNull();
    expect(result.feedback!.kind).toBe("lesson_hint");
    // K2: feedback nie niesie odpowiedzi wzorcowej ani jej fragmentów.
    expect(result.feedback!.correctText).toBeUndefined();
    expect(result.feedback!.hintPl).toContain("Dobra część odpowiedzi");
    expect(result.feedback!.hintPl).not.toContain("dwutlenku");

    const assessments = await pool.query<{ outcome: string; details: { knowledge?: string; errorCategory?: string; missingElementIds?: string[] } }>(
      "select outcome, details from learning_app.assessments where child_id = $1 and details ? 'knowledge'",
      [child.id],
    );
    expect(assessments.rows).toHaveLength(1);
    expect(assessments.rows[0]!.outcome).toBe("incorrect");
    expect(assessments.rows[0]!.details.knowledge).toBe("partial");
    expect(assessments.rows[0]!.details.errorCategory).toBe("missing_element");
    expect(assessments.rows[0]!.details.missingElementIds).toEqual(["e2"]);
  });

  it("rozwlekła, lecz poprawna odpowiedź zalicza wiedzę (precyzja nie obniża wiedzy)", async () => {
    const services = makeServices(new FakeAnswerGrader());
    const child = await createChild(services, { displayName: "Rozwlekły", avatarKey: "cat" });
    const { deckId } = await seedSchoolDeck(child.id);
    const openTask = await reachOpenTask(services, child.id, deckId);

    // >200 znaków dygresji → fake daje precyzję verbose, ale oba elementy są trafione.
    const verboseAnswer =
      "Roślina wytwarza cukry, bo wykorzystuje światło. " +
      "W ogóle rośliny są bardzo ciekawe i rosną w ogrodzie mojej babci, a wczoraj padał deszcz " +
      "i widziałem tęczę, a potem grałem w piłkę z kolegami na podwórku aż do wieczora i było super.";
    const result = await submitAttempt(services, {
      taskId: openTask.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: verboseAnswer,
    });
    expect(result.feedback!.kind).toBe("great");

    const assessments = await pool.query<{ outcome: string; details: { knowledge?: string; precision?: string } }>(
      "select outcome, details from learning_app.assessments where child_id = $1 and details ? 'knowledge'",
      [child.id],
    );
    expect(assessments.rows).toHaveLength(1);
    expect(assessments.rows[0]!.outcome).toBe("correct");
    expect(assessments.rows[0]!.details.knowledge).toBe("correct");
    expect(assessments.rows[0]!.details.precision).toBe("verbose");
  });

  it("bez skonfigurowanego gradera odpowiedź otwarta jest nieoceniona, bez kary", async () => {
    const services = makeServices(undefined);
    const child = await createChild(services, { displayName: "BezGradera", avatarKey: "dog" });
    const { deckId } = await seedSchoolDeck(child.id);
    const openTask = await reachOpenTask(services, child.id, deckId);

    const result = await submitAttempt(services, {
      taskId: openTask.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: "Roślina robi cukry ze światła i wody.",
    });
    expect(result.feedback!.kind).toBe("not_assessed");

    const assessments = await pool.query<{ outcome: string }>(
      "select outcome from learning_app.assessments where child_id = $1 and details->>'objectiveId' = $2",
      [child.id, OBJECTIVE_ID],
    );
    expect(assessments.rows.length).toBeGreaterThan(0);
    expect(assessments.rows.every((r) => r.outcome !== "incorrect")).toBe(true);
    const verdicts = await pool.query("select count(*)::int as n from learning_app.lesson_verdicts");
    expect((verdicts.rows[0] as { n: number }).n).toBe(0);
  });
});
