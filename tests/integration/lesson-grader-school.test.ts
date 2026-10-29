import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  computeTargetKey,
  createChild,
  createServices,
  endSession,
  FakeAnswerGrader,
  getLessonMockTestReport,
  lessonObjectiveProgress,
  nextTask,
  readLessonMockTestSummary,
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
const SECOND_OBJECTIVE_ID = "school.ddeck000.korzenie";
const MATERIAL =
  "Fotosynteza to proces, w którym roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry.";

async function seedSchoolDeck(
  childId: string,
  options: { expectedForm?: string; openAcceptedAnswers?: string[]; secondObjective?: boolean; precisionTrainer?: boolean } = {},
): Promise<{ deckId: string }> {
  const deckId = randomUUID();
  const versionId = randomUUID();
  const context = {
    subjectId: "school",
    topicId: "dynamic",
    topicVersion: 1,
    objectiveIds: options.secondObjective ? [OBJECTIVE_ID, SECOND_OBJECTIVE_ID] : [OBJECTIVE_ID],
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
      }, ...(options.secondObjective ? [{
        id: SECOND_OBJECTIVE_ID,
        titlePl: "Korzenie",
        descriptionEn: "Roots take water from the soil.",
        cards: [{ title: "Korzenie", body: "Korzenie pobierają wodę z gleby." }],
      }] : [])],
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
      acceptedAnswers: options.openAcceptedAnswers ?? [], focus: ["wytwarza cukry"],
      questionType: "definition", expectedForm: options.expectedForm ?? "explanation",
      requiredElements: [
        { id: "e1", text: "Roślina wytwarza cukry" },
        { id: "e2", text: "roślina wykorzystuje światło" },
      ],
      supplementaryElements: [], commonErrors: ["Fotosynteza to oddychanie rośliny."],
      sourceRefs: [{ quote: "przy udziale światła, wytwarza cukry" }],
      ...(options.precisionTrainer ? { familyId: "def" } : {}),
    },
  ];
  if (options.precisionTrainer) {
    // Trener precyzji: druga rodzina pytań (inne pytanie i odpowiedź) i słowa
    // kluczowe rodziny „def” — para wybór pojęć → odpowiedź otwarta.
    exercises.push({
      exerciseType: "lesson_open_answer", objectiveId: OBJECTIVE_ID, instructionPl: "Odpowiedz własnymi słowami.",
      prompt: "Czego roślina potrzebuje do fotosyntezy?",
      answer: "Roślina potrzebuje wody, dwutlenku węgla i światła.",
      acceptedAnswers: [], focus: ["światła"], questionType: "enumeration", expectedForm: "explanation", familyId: "potrzeby",
      requiredElements: [{ id: "p1", text: "roślina potrzebuje wody" }, { id: "p2", text: "roślina potrzebuje światła" }],
      supplementaryElements: [], commonErrors: [],
      sourceRefs: [{ quote: "z wody i dwutlenku węgla" }],
    }, {
      exerciseType: "lesson_keywords", objectiveId: OBJECTIVE_ID, familyId: "def",
      keywordOptions: [{ id: "k1", text: "światło" }, { id: "k2", text: "cukry" }, { id: "k3", text: "korzenie" }, { id: "k4", text: "tlen" }],
      keyOptionIds: ["k1", "k2"], answer: "światło, cukry", acceptedAnswers: [], focus: [],
      sourceRefs: [{ quote: "wytwarza cukry" }],
    });
  }
  if (options.secondObjective) {
    // Drugie zagadnienie wydłuża plan sesji (wprowadzenie nowego celu), żeby
    // odpowiedź otwarta pierwszego celu nie trafiała w fazę „Jeszcze 3 i koniec!”.
    for (const stem of ["Co pobierają korzenie?", "Skąd korzenie biorą wodę?", "Czym są korzenie dla rośliny?"]) {
      exercises.push({
        exerciseType: "lesson_choice", objectiveId: SECOND_OBJECTIVE_ID, instructionPl: "Wybierz.",
        stem, answer: "wodę", acceptedAnswers: [], focus: ["wodę"],
        options: [{ id: "a", text: "wodę" }, { id: "b", text: "cukier" }], correctOption: "a",
        sourceRefs: [{ quote: "wytwarza cukry" }],
      });
    }
  }
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
      [skillVersionId, itemId, JSON.stringify({ objectiveId: payload.objectiveId }), `oc-${skillVersionId}`],
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
    // Typowe błędy zatwierdzone przez rodzica dochodzą do modelu (prywatny klucz zadania).
    expect(grader.requests.at(-1)?.school?.commonErrors).toEqual(["Fotosynteza to oddychanie rośliny."]);
    // „Topic” to tytuł tematu, nie celu (ten sam wariant promptu dla wpisów cache).
    expect(grader.requests.at(-1)?.topicTitle).toBe("Rośliny");
    // Nic nie zostało ujawnione, więc odpowiedź celu nie jest oznaczona jako wyeksponowana.
    const exposed = await pool.query(`select count(*)::int as count from learning_app.event_exposures x
      join learning_app.learning_events e on e.id = x.event_id where e.task_id = $1 and e.kind = 'feedback_issued'`, [openTask!.taskId]);
    expect(exposed.rows[0]!.count).toBe(0);

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

  it("forma one_sentence ogranicza precyzję tej próby, ale cache trzyma precyzję modelu", async () => {
    const services = makeServices(new FakeAnswerGrader());
    const child = await createChild(services, { displayName: "Dwuzdaniowy", avatarKey: "owl" });
    const { deckId } = await seedSchoolDeck(child.id, { expectedForm: "one_sentence" });
    const openTask = await reachOpenTask(services, child.id, deckId);

    // Oba elementy trafione, krótko (fake: concise), ale w dwóch zdaniach.
    const result = await submitAttempt(services, {
      taskId: openTask.taskId, clientAttemptId: randomUUID(), modality: "text",
      text: "Roślina wytwarza cukry. Roślina wykorzystuje światło.",
    });
    expect(result.feedback!.kind).toBe("great");
    const assessment = await pool.query<{ details: { knowledge?: string; precision?: string; formOk?: boolean } }>(
      "select details from learning_app.assessments where child_id = $1 and details ? 'knowledge'", [child.id]);
    expect(assessment.rows[0]!.details).toMatchObject({ knowledge: "correct", precision: "verbose", formOk: false });
    // Inny zapis tej samej odpowiedzi (jedno zdanie) może trafić w ten sam wpis cache — nie może dziedziczyć klamry.
    const cached = await pool.query<{ precision: string }>("select precision from learning_app.lesson_verdicts");
    expect(cached.rows.map((row) => row.precision)).toEqual(["concise"]);
  });

  it("forma one_sentence ogranicza precyzję także przy dokładnym dopasowaniu wariantu", async () => {
    const services = makeServices(new FakeAnswerGrader());
    const child = await createChild(services, { displayName: "Dokładny", avatarKey: "owl" });
    const twoSentences = "Roślina wytwarza cukry. Roślina wykorzystuje światło.";
    const { deckId } = await seedSchoolDeck(child.id, { expectedForm: "one_sentence", openAcceptedAnswers: [twoSentences] });
    const openTask = await reachOpenTask(services, child.id, deckId);

    const result = await submitAttempt(services, {
      taskId: openTask.taskId, clientAttemptId: randomUUID(), modality: "text", text: twoSentences,
    });
    expect(result.feedback!.kind).toBe("great");
    const assessment = await pool.query<{ outcome: string; details: Record<string, unknown> }>(
      "select outcome, details from learning_app.assessments where child_id = $1 and details ? 'knowledge'", [child.id]);
    expect(assessment.rows[0]!.outcome).toBe("correct");
    expect(assessment.rows[0]!.details).toMatchObject({
      verdict: "exact", knowledge: "correct", precision: "verbose", formOk: false, expectedForm: "one_sentence",
    });
    // Dokładne dopasowanie nie woła modelu, więc nie ma wpisu cache.
    const verdicts = await pool.query<{ n: number }>("select count(*)::int as n from learning_app.lesson_verdicts");
    expect(verdicts.rows[0]!.n).toBe(0);
  });

  it("kategoria błędu w cache jest ta sama co w ocenie (incorrect bez błędnych stwierdzeń = incomplete)", async () => {
    const services = makeServices(new FakeAnswerGrader());
    const child = await createChild(services, { displayName: "Niepełny", avatarKey: "cat" });
    const { deckId } = await seedSchoolDeck(child.id);
    const openTask = await reachOpenTask(services, child.id, deckId);
    await submitAttempt(services, { taskId: openTask.taskId, clientAttemptId: randomUUID(), modality: "text", text: "Nie wiem, coś o liściach." });
    const assessment = await pool.query<{ details: { knowledge?: string; errorCategory?: string } }>(
      "select details from learning_app.assessments where child_id = $1 and details ? 'knowledge'", [child.id]);
    expect(assessment.rows[0]!.details).toMatchObject({ knowledge: "incorrect", errorCategory: "incomplete" });
    const cached = await pool.query<{ error_category: string }>("select error_category from learning_app.lesson_verdicts");
    expect(cached.rows.map((row) => row.error_category)).toEqual(["incomplete"]);
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

describe("trener precyzji: „Skróć odpowiedź” (integracja)", () => {
  // Oba elementy trafione, ale z dygresją >200 znaków: fake daje precyzję verbose
  // i zbędne zdania bez słów elementów wymaganych.
  const verboseAnswer =
    "Roślina wytwarza cukry, bo wykorzystuje światło. " +
    "W ogóle rośliny są bardzo ciekawe i rosną w ogrodzie mojej babci, a wczoraj padał deszcz. " +
    "Potem grałem w piłkę z kolegami na podwórku aż do wieczora i było super, naprawdę bardzo fajnie.";
  const shortened = "Roślina wytwarza cukry, bo wykorzystuje światło.";

  async function answerVerbosely(services: AnyServices, childId: string, deckId: string) {
    const openTask = await reachOpenTask(services, childId, deckId);
    const result = await submitAttempt(services, { taskId: openTask.taskId, clientAttemptId: randomUUID(), modality: "text", text: verboseAnswer });
    return { openTask, result };
  }

  it("proponuje skrócenie, wydaje zadanie następcze poza budżetem i zapisuje poprawkę jako wspomaganą", async () => {
    const services = makeServices(new FakeAnswerGrader());
    const child = await createChild(services, { displayName: "Gaduła", avatarKey: "owl" });
    const { deckId } = await seedSchoolDeck(child.id, { secondObjective: true });
    const { openTask, result } = await answerVerbosely(services, child.id, deckId);
    expect(result.feedback).toMatchObject({ kind: "lesson_precision_hint" });
    expect(result.taskState).toBe("answered");

    const followUp = await nextTask(services, openTask.sessionId);
    expect(followUp).not.toBeNull();
    expect(followUp!.exerciseType).toBe("lesson_open_answer");
    // Poprawka pokazuje licznik oryginału: obietnica „Jeszcze N” nie przesuwa się o zadanie.
    expect(followUp!.remainingAssessed).toBe(openTask.remainingAssessed);
    expect(followUp!.prompt).toMatchObject({ kind: "lesson_shorten", prompt: "Co to jest fotosynteza?", originalAnswer: verboseAnswer });
    const prompt = followUp!.prompt as { answerSegments: { text: string; state: string }[] };
    expect(prompt.answerSegments.some((segment) => segment.state === "pill")).toBe(true);
    expect(JSON.stringify(followUp!.prompt)).not.toContain("przy udziale");

    const revision = await submitAttempt(services, { taskId: followUp!.taskId, clientAttemptId: randomUUID(), modality: "text", text: shortened });
    expect(revision.feedback!.kind).toBe("great");
    const rows = await pool.query<{ outcome: string; independent: boolean; confirmation_eligible: boolean; details: Record<string, unknown> }>(
      `select a.outcome, a.independent, a.confirmation_eligible, a.details from learning_app.assessments a
         join learning_app.attempts t on t.id = a.attempt_id where t.task_id = $1`, [followUp!.taskId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ outcome: "correct", independent: false, confirmation_eligible: false });
    expect(rows.rows[0]!.details).toMatchObject({ lostElementIds: [], shorter: true, revisionOf: { taskId: openTask.taskId } });

    // Po poprawce plan sesji toczy się dalej; zadanie następcze nie zjadło budżetu.
    const after = await nextTask(services, openTask.sessionId);
    expect(after).not.toBeNull();
    expect(after!.remainingAssessed).toBe(openTask.remainingAssessed - 1);

    // Raport rodzica: para oryginał → poprawka osobno; poprawka nie zawyża liczników wiedzy.
    const report = (await lessonObjectiveProgress(services, deckId, child.id)).find((row) => row.objectiveId === OBJECTIVE_ID)!;
    expect(report.school?.shortening).toEqual({
      offered: 1, attempted: 1, successful: 1,
      recent: [{ original: verboseAnswer, revision: shortened, lostElements: [], successful: true }],
    });
    expect(report.school?.knowledge.correct).toBe(1);
    expect(report.school?.recentAnswers.map((answer) => answer.text)).not.toContain(shortened);

    // Podsumowanie sesji dla dziecka: oryginał i poprawka to jedno ćwiczenie celu.
    const summary = await endSession(services, openTask.sessionId);
    expect(summary.objectives?.find((objective) => objective.objectiveId === OBJECTIVE_ID)).toMatchObject({ practiced: 1, correct: 1 });
  });

  it("wykrywa utratę elementu wymaganego w poprawce, bez treści elementu w feedbacku", async () => {
    const services = makeServices(new FakeAnswerGrader());
    const child = await createChild(services, { displayName: "Skracacz", avatarKey: "cat" });
    const { deckId } = await seedSchoolDeck(child.id, { secondObjective: true });
    const { openTask } = await answerVerbosely(services, child.id, deckId);
    const progressOf = async () => (await pool.query<{ status: string; streak: number }>(
      "select status, streak from learning_app.child_objective_progress where child_id = $1 and objective_id = $2", [child.id, OBJECTIVE_ID])).rows[0];
    const beforeRevision = await progressOf();
    const followUp = (await nextTask(services, openTask.sessionId))!;
    const revision = await submitAttempt(services, { taskId: followUp.taskId, clientAttemptId: randomUUID(), modality: "text", text: "Roślina wytwarza cukry." });
    expect(revision.feedback).toMatchObject({ kind: "lesson_hint" });
    expect(JSON.stringify(revision.feedback)).not.toContain("światło");
    const rows = await pool.query<{ outcome: string; independent: boolean; details: { lostElementIds?: string[] } }>(
      `select a.outcome, a.independent, a.details from learning_app.assessments a
         join learning_app.attempts t on t.id = a.attempt_id where t.task_id = $1`, [followUp.taskId]);
    expect(rows.rows[0]).toMatchObject({ outcome: "incorrect", independent: false });
    expect(rows.rows[0]!.details.lostElementIds).toEqual(["e2"]);
    // Poprawka jest wspomagana: nie zmienia serii ani statusu celu.
    expect(await progressOf()).toEqual(beforeRevision);
    // Rodzic widzi utracony element; poprawka nie jest błędem wiedzy w raporcie.
    const report = (await lessonObjectiveProgress(services, deckId, child.id)).find((row) => row.objectiveId === OBJECTIVE_ID)!;
    expect(report.school?.shortening?.recent[0]).toMatchObject({ lostElements: ["roślina wykorzystuje światło"], successful: false });
    expect(report.school?.knowledge).toMatchObject({ partial: 0, incorrect: 0 });
    expect(report.topErrors).toEqual([]);
  });

  it("poprawka identyczna z oryginałem nie jest oceniana i czeka na krótszą wersję", async () => {
    const grader = new FakeAnswerGrader();
    const services = makeServices(grader);
    const child = await createChild(services, { displayName: "Uparty", avatarKey: "dog" });
    const { deckId } = await seedSchoolDeck(child.id, { secondObjective: true });
    const { openTask } = await answerVerbosely(services, child.id, deckId);
    const followUp = (await nextTask(services, openTask.sessionId))!;
    const callsBefore = grader.callCount;
    const same = await submitAttempt(services, { taskId: followUp.taskId, clientAttemptId: randomUUID(), modality: "text", text: `  ${verboseAnswer.toUpperCase()} ` });
    expect(same.feedback).toMatchObject({ kind: "lesson_hint" });
    expect(same.taskState).toBe("issued");
    expect(grader.callCount).toBe(callsBefore);
    // „Nie pamiętam” przy własnej odpowiedzi na ekranie jest odrzucane (bez ujawnienia wzorca).
    await expect(submitAttempt(services, { taskId: followUp.taskId, clientAttemptId: randomUUID(), modality: "dont_remember" }))
      .rejects.toMatchObject({ code: "validation" });
    const skipped = await submitAttempt(services, { taskId: followUp.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    expect(skipped.taskState).toBe("skipped");
    // „Dalej” bez skracania: sesja wraca do kolejnego zadania planu z niezmienionym budżetem.
    const next = await nextTask(services, openTask.sessionId);
    expect(next).not.toBeNull();
    expect(next!.taskId).not.toBe(followUp.taskId);
    expect(next!.remainingAssessed).toBe(openTask.remainingAssessed - 1);
    // Raport: poprawka bez zmian nie jest próbą skrócenia.
    const report = (await lessonObjectiveProgress(services, deckId, child.id)).find((row) => row.objectiveId === OBJECTIVE_ID)!;
    expect(report.school?.shortening).toEqual({ offered: 1, attempted: 0, successful: 0, recent: [] });
  });

  it("zwięzła poprawna odpowiedź nie dostaje zadania następczego", async () => {
    const services = makeServices(new FakeAnswerGrader());
    const child = await createChild(services, { displayName: "Zwięzły", avatarKey: "owl" });
    const { deckId } = await seedSchoolDeck(child.id);
    const openTask = await reachOpenTask(services, child.id, deckId);
    const result = await submitAttempt(services, { taskId: openTask.taskId, clientAttemptId: randomUUID(), modality: "text", text: shortened });
    expect(result.feedback!.kind).toBe("great");
    const rows = await pool.query("select count(*)::int as n from learning_app.session_tasks where context ? 'followUpOf'");
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("trener precyzji: „Najpierw słowa kluczowe” (integracja)", () => {
  it("po niepełnej odpowiedzi kolejna sesja wydaje wybór pojęć, a potem wspomaganą odpowiedź tej rodziny", async () => {
    const grader = new FakeAnswerGrader();
    const partialAnswer = "Roślina coś robi ze słońcem.";
    grader.onAnswer(partialAnswer, {
      raw: {
        knowledge: "partial", precision: "concise", matchedElementIds: ["e2"], missingElementIds: ["e1"],
        incorrectStatements: [], redundantFragments: [], note: "brak cukrów",
      },
    });
    const services = makeServices(grader);
    const child = await createChild(services, { displayName: "Pojęcia", avatarKey: "owl" });
    const { deckId } = await seedSchoolDeck(child.id, { precisionTrainer: true, secondObjective: true });
    const openTask = await reachOpenTask(services, child.id, deckId);
    expect(openTask.prompt).toMatchObject({ prompt: "Co to jest fotosynteza?" });
    await submitAttempt(services, { taskId: openTask.taskId, clientAttemptId: randomUUID(), modality: "text", text: partialAnswer });
    await endSession(services, openTask.sessionId);

    const session = await startSession(services, { childId: child.id, deckId, microphoneEnabled: false });
    let keywordsTask: TaskDto | null = null;
    for (let i = 0; i < 40 && keywordsTask === null; i++) {
      const task = await nextTask(services, session.sessionId);
      if (task === null) break;
      if (task.exerciseType === "lesson_keywords") { keywordsTask = task; break; }
      if (task.exerciseType === "lesson_card") { await completePresentation(services, { taskId: task.taskId }); continue; }
      await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    }
    expect(keywordsTask).not.toBeNull();
    expect(keywordsTask!.prompt).toMatchObject({ kind: "lesson_keywords", prompt: "Co to jest fotosynteza?", minSelected: 2, maxSelected: 2 });
    expect(JSON.stringify(keywordsTask!.prompt)).not.toContain("keyOptionIds");

    const key = (await pool.query<{ answerKey: { correctOptionIds: string[] } }>(
      `select answer_key as "answerKey" from learning_app.session_tasks where id = $1`, [keywordsTask!.taskId])).rows[0]!.answerKey;
    const chosen = await submitAttempt(services, { taskId: keywordsTask!.taskId, clientAttemptId: randomUUID(), modality: "selection", itemIds: key.correctOptionIds });
    expect(chosen.feedback!.kind).toBe("great");

    const paired = (await nextTask(services, session.sessionId))!;
    expect(paired.exerciseType).toBe("lesson_open_answer");
    expect(paired.prompt).toMatchObject({ prompt: "Co to jest fotosynteza?" });
    await submitAttempt(services, { taskId: paired.taskId, clientAttemptId: randomUUID(), modality: "text", text: "Roślina wytwarza cukry, wykorzystuje światło." });
    const rows = await pool.query<{ task_id: string; independent: boolean; outcome: string }>(
      `select t.task_id, a.independent, a.outcome from learning_app.assessments a
         join learning_app.attempts t on t.id = a.attempt_id where t.task_id = any($1::uuid[])`,
      [[keywordsTask!.taskId, paired.taskId]]);
    expect(rows.rows.find((row) => row.task_id === keywordsTask!.taskId)?.independent).toBe(false);
    expect(rows.rows.find((row) => row.task_id === paired.taskId)?.independent).toBe(false);
    expect(rows.rows.find((row) => row.task_id === paired.taskId)?.outcome).toBe("correct");
  });
});

describe("kartkówka szkolna z wymiarem precyzji (Etap 5, integracja)", () => {
  const verbose =
    "Roślina wytwarza cukry, bo wykorzystuje światło. " +
    "W ogóle rośliny są bardzo ciekawe i rosną w ogrodzie mojej babci, a wczoraj padał deszcz. " +
    "Potem grałem w piłkę z kolegami na podwórku aż do wieczora i było super, naprawdę bardzo fajnie.";
  const partial = "Roślina potrzebuje wody.";

  it("raport rodzica liczy wiedzę i precyzję, omówienie dziecka daje wskazówki i listę do powtórki", async () => {
    const grader = new FakeAnswerGrader();
    grader.onAnswer(partial, {
      raw: {
        knowledge: "partial", precision: "concise", matchedElementIds: ["p1"], missingElementIds: ["p2"],
        incorrectStatements: [], redundantFragments: [], note: "brak światła",
      },
    });
    const services = makeServices(grader);
    const child = await createChild(services, { displayName: "Kartkówka", avatarKey: "owl" });
    const { deckId } = await seedSchoolDeck(child.id, { precisionTrainer: true });
    const session = await startSession(services, { childId: child.id, deckId, microphoneEnabled: false, mode: "mock_test" });
    const openPrompts: string[] = [];
    for (let i = 0; i < 20; i++) {
      const task = await nextTask(services, session.sessionId);
      if (task === null) break;
      expect(task.exerciseType).not.toBe("lesson_keywords");
      if (task.exerciseType === "lesson_card") { await completePresentation(services, { taskId: task.taskId }); continue; }
      if (task.exerciseType !== "lesson_open_answer") {
        await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
        continue;
      }
      const prompt = (task.prompt as { prompt: string }).prompt;
      openPrompts.push(prompt);
      const text = prompt === "Co to jest fotosynteza?" ? verbose : partial;
      const result = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text });
      expect(result.feedback).toBeNull();
    }
    expect(openPrompts.sort()).toEqual(["Co to jest fotosynteza?", "Czego roślina potrzebuje do fotosyntezy?"]);
    // Kartkówka nie proponuje skracania.
    const followUps = await pool.query("select count(*)::int as n from learning_app.session_tasks where context ? 'followUpOf'");
    expect((followUps.rows[0] as { n: number }).n).toBe(0);

    const report = await getLessonMockTestReport(services, session.sessionId);
    const objective = report.objectives.find((row) => row.objectiveId === OBJECTIVE_ID)!;
    expect(objective.school).toEqual({
      knowledge: { correct: 1, partial: 1, incorrect: 0 },
      precision: { concise: 1, verbose: 1, unfocused: 0 },
      formViolations: 0,
      missingElements: [{ text: "roślina potrzebuje światła", count: 1 }],
    });

    const summary = await readLessonMockTestSummary(services, session.sessionId);
    const hints = Object.fromEntries(summary.solutions.filter((s) => s.exerciseType === "lesson_open_answer").map((s) => [s.prompt, s.hintPl]));
    expect(hints).toEqual({
      "Co to jest fotosynteza?": "Dobrze! Następnym razem spróbuj krócej.",
      "Czego roślina potrzebuje do fotosyntezy?": "Zabrakło ważnej informacji. Porównaj z poprawną odpowiedzią.",
    });
    expect(summary.reviewObjectives).toEqual([{ objectiveId: OBJECTIVE_ID, titlePl: "Fotosynteza" }]);
    // Wskazówka nie ujawnia treści brakującego elementu.
    expect(JSON.stringify(summary)).not.toContain("roślina potrzebuje światła");
  });
});
