import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  createLesson,
  createServices,
  executeMediaAsset,
  createSubjectRegistry,
  englishGrammarSubject,
  editLessonDraft,
  executeLessonGeneration,
  historyLikeSubject,
  readGeneration,
  regenerateObjective,
  runDueGenerationWork,
  retryGeneration,
  type Services,
} from "@learning/server";
import type { LessonCommand } from "@learning/contracts";
import { countRows, testDatabase, testDatabaseUrl } from "./helpers";
import { ManualClock } from "./helpers";
import { fakeGeneration, FakeLlmProvider, type FakeGeneration } from "./fakes";
import { claimQueuedRun } from "../../packages/server/src/modules/generation";
import { GenerationProviderError } from "../../packages/server/src/ports/generation-error";
import { lessonExerciseIdentity, lessonExerciseStimulusRecord } from "../../packages/server/src/domain/lessons/exercise-identity";
import type { LessonExerciseDraft } from "../../packages/server/src/domain/lessons/types";

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

/** Rejestr z przedmiotem produkcyjnym + fixture historii (dowód niezależności). */
function lessonRegistry() {
  return createSubjectRegistry([englishGrammarSubject, historyLikeSubject]);
}

function lessonServices(fakes: FakeGeneration, clock = new ManualClock()): Services {
  const { db } = testDatabase();
  return createServices({
    db,
    clock,
    media: fakes.settings,
    generation: fakes.deps,
    subjects: lessonRegistry(),
  });
}

function command(overrides: Partial<LessonCommand> = {}): LessonCommand {
  return {
    subjectId: "english_grammar",
    topicId: "present_simple",
    objectiveIds: ["english_grammar.present_simple.third_person_s"],
    material: "He plays football. She watches TV. They study English every day.",
    instruction: "Ćwicz -s w 3. osobie.",
    clientRequestId: randomUUID(),
    ...overrides,
  };
}

describe("generowanie puli lekcji (integracja)", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
              learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
              learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) {
      await dispose();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("createLesson tworzy deck lekcji, wersję draft i run w jednej transakcji; idempotentnie po clientRequestId", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const cmd = command();

    const first = await createLesson(services, cmd);
    const second = await createLesson(services, cmd);

    expect(second).toEqual(first);
    expect(await countRows("decks")).toBe(1);
    expect(await countRows("generation_runs")).toBe(1);

    const [deck] = await query<{ kind: string }>("select kind from learning_app.decks where id = $1", [first.deckId]);
    expect(deck!.kind).toBe("lesson");

    const [version] = await query<{ state: string; lesson_context: Record<string, unknown>; source_locale: string; target_locale: string }>(
      "select state, lesson_context, source_locale, target_locale from learning_app.deck_versions where deck_id = $1",
      [first.deckId],
    );
    expect(version!.state).toBe("draft");
    expect(version!.source_locale).toBe("pl-PL");
    expect(version!.target_locale).toBe("en-GB");
    expect(version!.lesson_context).toMatchObject({
      subjectId: "english_grammar",
      topicId: "present_simple",
      topicVersion: 1,
      objectiveIds: ["english_grammar.present_simple.third_person_s"],
      examples: {},
      rejectedCount: 0,
    });

    const run = await readGeneration(services, first.runId);
    expect(run.state).toBe("queued");
    expect(run.deckId).toBe(first.deckId);
  });

  it("równoległe createLesson z tym samym kluczem → jeden run i deck", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const cmd = command();

    const [a, b] = await Promise.all([createLesson(services, cmd), createLesson(services, cmd)]);
    expect(a).toEqual(b);
    expect(await countRows("decks")).toBe(1);
    expect(await countRows("generation_runs")).toBe(1);
  });

  it("nieznany przedmiot / temat / cel → 400 validation", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);

    await expect(createLesson(services, command({ subjectId: "nope", clientRequestId: randomUUID() }))).rejects.toMatchObject({ code: "validation" });
    await expect(createLesson(services, command({ topicId: "nope", clientRequestId: randomUUID() }))).rejects.toMatchObject({ code: "validation" });
    await expect(
      createLesson(services, command({ objectiveIds: ["english_grammar.present_simple.nope"], clientRequestId: randomUUID() })),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("wykonanie zapisuje poprawne ćwiczenia z payload_version 2, target_key i umiejętnością objective; wersja w review; examples uzupełnione", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);

    const { runId, deckId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);

    const run = await readGeneration(services, runId);
    expect(run.state).toBe("succeeded");

    // Profil promptu przedmiotu niesie reguły pól (semantyka hint) do adaptera LLM.
    const llmInput = fakes.llm.lessonRequests[0]!;
    expect(llmInput.promptProfile.fieldRules).toContain("BASE FORM");

    const versionId = run.deckVersionId!;
    const [version] = await query<{ state: string; lesson_context: { examples: Record<string, string[]> } }>(
      "select state, lesson_context from learning_app.deck_versions where id = $1",
      [versionId],
    );
    expect(version!.state).toBe("review");
    expect(Object.keys(version!.lesson_context.examples)).toContain("english_grammar.present_simple.third_person_s");

    const revisions = await query<{ payload_version: number; payload: Record<string, unknown>; target_key: string; item_id: string }>(
      "select payload_version, payload, target_key, item_id from learning_app.item_revisions where deck_version_id = $1 order by position",
      [versionId],
    );
    expect(revisions.length).toBeGreaterThan(0);
    for (const r of revisions) {
      expect(r.payload_version).toBe(2);
      expect(r.payload).toMatchObject({ answerLocale: "en-GB", promptLocale: "pl-PL" });
      expect(r.target_key).toMatch(/^[0-9a-f]{64}$/);
    }

    const items = await query<{ count: number }>(
      "select count(*)::int as count from learning_app.learning_items where deck_id = $1 and kind = 'lesson_exercise'",
      [deckId],
    );
    expect(items[0]!.count).toBe(revisions.length);

    // umiejętność objective per rewizja (jedna)
    const skills = await query<{ count: number }>(
      `select count(*)::int as count from learning_app.item_revision_skills irs
         join learning_app.item_revisions ir on ir.id = irs.item_revision_id
        where ir.deck_version_id = $1 and irs.skill = 'objective'`,
      [versionId],
    );
    expect(skills[0]!.count).toBe(revisions.length);

    // Gramatyka nie zleca TTS odpowiedzi ani nie przypina zasobów audio.
    const assets = await query<{ kind: string }>("select kind from learning_app.media_assets");
    expect(assets).toEqual([]);
    const roles = await query<{ role: string }>("select role from learning_app.revision_assets");
    expect(roles).toEqual([]);
  });

  it("pełna generacja wielocelowa przekazuje bodźce wcześniejszych partii do deduplikacji ćwiczeń", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);

    // Dwa cele, pula 20 → 2 partie po 10 ćwiczeń. Gramatyka deduplikuje
    // ćwiczenia po bodźcu, więc wcześniejszy kontekst zawiera ich tożsamości,
    // a nie zakaz odpowiedzi takich jak do/does.
    const { runId } = await createLesson(
      services,
      command({
        objectiveIds: [
          "english_grammar.present_simple.affirmative_base",
          "english_grammar.present_simple.third_person_s",
        ],
        poolSize: 20,
        clientRequestId: randomUUID(),
      }),
    );
    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");

    // Jedna partia na cel; druga zna bodźce z pierwszej partii.
    expect(fakes.llm.lessonRequests).toHaveLength(2);
    const [first, second] = fakes.llm.lessonRequests;
    expect(first!.existingAnswers ?? []).toEqual([]);
    expect(second!.existingAnswers ?? []).toEqual([]);
    expect(second!.existingExercises ?? []).toHaveLength(10);

    const run = await readGeneration(services, runId);
    const revisions = await query<{ payload: LessonExerciseDraft }>(
      "select payload from learning_app.item_revisions where deck_version_id = $1",
      [run.deckVersionId!],
    );
    expect(revisions.length).toBe(20);
    const firstObjectiveExercises = revisions
      .map((row) => row.payload)
      .filter((exercise) => exercise.objectiveId === "english_grammar.present_simple.affirmative_base");
    expect(firstObjectiveExercises).toHaveLength(10);
    expect(second!.existingExercises).toEqual(firstObjectiveExercises.map(lessonExerciseStimulusRecord));
    expect(new Set(revisions.map(({ payload }) => lessonExerciseIdentity(payload))).size).toBe(20);
  });

  it("częściowe odrzucenia: niepoprawne ćwiczenia odrzucone pojedynczo, licznik dostępny", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    fakes.llm.queueLesson({ invalid: true });

    const { runId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);

    const run = await readGeneration(services, runId);
    expect(run.state).toBe("succeeded");
    const versionId = run.deckVersionId!;
    const [version] = await query<{ lesson_context: { rejectedCount: number } }>(
      "select lesson_context from learning_app.deck_versions where id = $1",
      [versionId],
    );
    expect(version!.lesson_context.rejectedCount).toBeGreaterThan(0);
    const items = await query<{ count: number }>(
      "select count(*)::int as count from learning_app.item_revisions where deck_version_id = $1",
      [versionId],
    );
    expect(items[0]!.count).toBeGreaterThan(0);
  });

  it.each(["options", "acceptedAnswers", "focus"])("zły KSZTAŁT %s nie wywraca runu: poprawne zapisane, błędny odrzucony, run terminalny (P2-7)", async (malformedField) => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const objectiveId = "english_grammar.present_simple.third_person_s";
    // Jedno poprawne ćwiczenie + jedno o złym kształcie tablicy opcji (null w
    // środku). Walidacja kształtu musi odrzucić błędne, nie rzucać TypeError.
    fakes.llm.queueLesson({
      exercises: [
        {
          exerciseType: "lesson_choice",
          objectiveId,
          instructionPl: "Wybierz.",
          stem: "She ___ football.",
          answer: "plays",
          acceptedAnswers: [],
          focus: [],
          options: [
            { id: "a", text: "plays" },
            { id: "b", text: "play" },
          ],
          correctOption: "a",
        },
        {
          exerciseType: "lesson_choice",
          objectiveId,
          instructionPl: "Wybierz.",
          stem: "She ___ TV.",
          answer: "watches",
          acceptedAnswers: [],
          focus: [],
          // zły kształt: null w tablicy opcji
          options: [{ id: "a", text: "watches" }, { id: "b", text: "watch" }],
          correctOption: "b",
          [malformedField]: [null],
        },
      ],
    });

    const { runId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);

    const run = await readGeneration(services, runId);
    expect(run.state).toBe("succeeded"); // run terminalny, nie „running”
    const versionId = run.deckVersionId!;
    const [version] = await query<{ state: string; lesson_context: { rejectedCount: number } }>(
      "select state, lesson_context from learning_app.deck_versions where id = $1",
      [versionId],
    );
    expect(version!.state).toBe("review");
    expect(version!.lesson_context.rejectedCount).toBeGreaterThanOrEqual(1); // błędny kształt policzony
    const rows = await query<{ answer: string }>(
      "select payload->>'answer' as answer from learning_app.item_revisions where deck_version_id = $1",
      [versionId],
    );
    expect(rows.map((r) => r.answer)).toEqual(["plays"]); // tylko poprawne zapisane
  });

  it("nullExerciseDoesNotRetryWholeRun", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const objectiveId = "english_grammar.present_simple.third_person_s";
    fakes.llm.queueLesson({ exercises: [
      {
        exerciseType: "lesson_choice",
        objectiveId,
        instructionPl: "Wybierz.",
        stem: "She ___ football.",
        answer: "plays",
        acceptedAnswers: [],
        focus: [],
        options: [{ id: "a", text: "plays" }, { id: "b", text: "play" }],
        correctOption: "a",
      },
      null,
    ] });

    const { runId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);

    const run = await readGeneration(services, runId);
    expect(run.state).toBe("succeeded");
    expect(run.attempts).toBe(1);
    const [version] = await query<{ lesson_context: { rejectedCount: number } }>(
      "select lesson_context from learning_app.deck_versions where id = $1",
      [run.deckVersionId!],
    );
    expect(version!.lesson_context.rejectedCount).toBe(1);
    const rows = await query<{ count: number }>(
      "select count(*)::int as count from learning_app.item_revisions where deck_version_id = $1",
      [run.deckVersionId!],
    );
    expect(rows[0]!.count).toBe(1);
  });

  it("odrzuca wadliwe przykłady, zachowując prawidłowe przykłady i ćwiczenia", async () => {
    const fakes = await fakeGeneration(); disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const generate = fakes.llm.generateLessonPool.bind(fakes.llm);
    const objective = "english_grammar.present_simple.third_person_s";
    fakes.llm.generateLessonPool = async (...args) => ({ ...await generate(...args), examples: {
      [objective]: ["He plays.", null, " ", "x".repeat(121)], unknown: ["Wrong objective."],
    } as unknown as Record<string, string[]> });
    const { runId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);
    const run = await readGeneration(services, runId);
    expect(run.state).toBe("succeeded");
    const [row] = await query<{ lesson_context: { examples: Record<string, string[]> } }>("select lesson_context from learning_app.deck_versions where id=$1", [run.deckVersionId]);
    expect(row!.lesson_context.examples).toEqual({ [objective]: ["He plays."] });
  });

  it("wznawia run po przerwaniu workera już po claimie", async () => {
    const fakes = await fakeGeneration(); disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const { runId } = await createLesson(services, command());
    await claimQueuedRun(services.db, runId);
    expect((await readGeneration(services, runId)).state).toBe("running");
    const reopened = createDatabase(testDatabaseUrl());
    try {
      const restarted = createServices({ db: reopened.db, clock: services.clock, media: fakes.settings, generation: fakes.deps });
      const oldEdit = (await query<{ expected_edit_number: number }>("select expected_edit_number from learning_app.generation_runs where id=$1", [runId]))[0]!.expected_edit_number;
      await retryGeneration(restarted, runId);
      const edit = (await query<{ expected_edit_number: number }>("select expected_edit_number from learning_app.generation_runs where id=$1", [runId]))[0]!.expected_edit_number;
      expect(edit).toBe(oldEdit + 1);
      await runDueGenerationWork(restarted);
      expect((await readGeneration(restarted, runId)).state).toBe("succeeded");
    } finally { await reopened.pool.end(); }
  });

  it("ponowienie żywego runu odcina spóźniony zapis starego workera", async () => {
    const fakes = await fakeGeneration(); disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const generate = fakes.llm.generateLessonPool.bind(fakes.llm);
    let first = true;
    fakes.llm.generateLessonPool = async (...args) => {
      const result = await generate(...args);
      if (first) { first = false; enter(); await released; }
      return result;
    };
    const { runId } = await createLesson(services, command());
    const pending = executeLessonGeneration(services, runId);
    await entered;
    let before: unknown[] = [];
    try {
      await retryGeneration(services, runId);
      await executeLessonGeneration(services, runId);
      before = await query("select id, payload from learning_app.item_revisions order by id");
      expect((await readGeneration(services, runId)).state).toBe("succeeded");
    } finally { release(); await pending; }
    expect(await query("select id, payload from learning_app.item_revisions order by id")).toEqual(before);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");
  });

  it("stary SELECT przed claimem nie przejmuje nowego wykonania po retry", async () => {
    const fakes = await fakeGeneration(); disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const isolated = createDatabase(testDatabaseUrl());
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const original = isolated.pool.query.bind(isolated.pool);
    let paused = false;
    isolated.pool.query = (async (...args: unknown[]) => {
      const result = await (original as (...values: unknown[]) => Promise<unknown>)(...args);
      const sql = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text ?? "";
      if (!paused && /^select/i.test(sql) && sql.includes("generation_runs")) { paused = true; enter(); await released; }
      return result;
    }) as typeof isolated.pool.query;
    const staleServices = createServices({ db: isolated.db, clock: services.clock, media: fakes.settings, generation: fakes.deps });
    const { runId } = await createLesson(services, command());
    const stale = executeLessonGeneration(staleServices, runId);
    await entered;
    try {
      await claimQueuedRun(services.db, runId);
      await retryGeneration(services, runId);
      release();
      await stale;
      expect((await readGeneration(services, runId)).state).toBe("queued");
      await executeLessonGeneration(services, runId);
      expect((await readGeneration(services, runId)).state).toBe("succeeded");
    } finally { release(); await stale; await isolated.pool.end(); }
  });

  it("0 poprawnych → failed/validation; wersja nadal draft; brak elementów", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    fakes.llm.queueLesson({ exercises: [{ exerciseType: "lesson_gap", objectiveId: "english_grammar.present_simple.third_person_s", answer: "a b c d", acceptedAnswers: [], focus: [], stem: "no marker" }] });

    const { runId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);

    const run = await readGeneration(services, runId);
    expect(run.state).toBe("failed");
    expect(run.errorCode).toBe("validation");
    const [version] = await query<{ state: string }>("select state from learning_app.deck_versions where id = $1", [run.deckVersionId!]);
    expect(version!.state).toBe("draft");
    const items = await query<{ count: number }>("select count(*)::int as count from learning_app.item_revisions where deck_version_id = $1", [run.deckVersionId!]);
    expect(items[0]!.count).toBe(0);
  });

  it("loguje [lesson] podsumowanie walidacji z powodami odrzuceń i wynik terminalny", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    fakes.llm.queueLesson({
      exercises: [
        { exerciseType: "lesson_gap", objectiveId: "english_grammar.present_simple.third_person_s", answer: "plays", acceptedAnswers: ["plays"], focus: ["plays"], stem: "She ___ tennis." },
        { exerciseType: "lesson_choice", objectiveId: "english_grammar.present_simple.third_person_s", answer: "runs", acceptedAnswers: [], focus: ["runs"], stem: "He ___ fast.", options: [{ id: "a", text: "runs" }, { id: "b", text: "run" }, { id: "c", text: "running" }, { id: "d", text: "ran" }, { id: "e", text: "to run" }], correctOption: "a" },
      ],
    });

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    try {
      const { runId } = await createLesson(services, command());
      await executeLessonGeneration(services, runId);
      const run = await readGeneration(services, runId);
      expect(run.state).toBe("failed");
      expect(run.errorCode).toBe("validation");
    } finally {
      spy.mockRestore();
    }

    const lessonLogs = logs.filter((line) => line.includes("[lesson]")).join("\n");
    // Start runu z kontekstem (identyfikowalność w logach workera), łącznie
    // z modelem LLM (A/B generacji po logach, UMIEM_LLM_MODEL).
    expect(lessonLogs).toMatch(/generacja run=\S+ .*cel[ie]=.*model=\S+/);
    // Podsumowanie walidacji: tylko liczniki i kody reguł, bez treści ćwiczeń.
    expect(lessonLogs).toMatch(/walidacja puli: surowe=\d+ zły_kształt=\d+ obcy_cel=\d+ odrzucone=\d+ ważne=\d+/);
    expect(lessonLogs).toContain("acceptedAnswers×1");
    expect(lessonLogs).toContain("options×1");
    // Wynik terminalny runu.
    expect(lessonLogs).toMatch(/zakończony: state=failed kod=validation/);
  });

  it("loguje [lesson] błąd partii LLM i wynik attempts_exhausted", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const clock = new ManualClock();
    const services = lessonServices(fakes, clock);
    fakes.llm.queueLesson({ error: "llm timeout", retryable: true });

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    try {
      const { runId } = await createLesson(services, command());
      for (let i = 0; i < 3; i += 1) {
        await executeLessonGeneration(services, runId);
        if (i < 2) {
          const [scheduled] = await query<{ next_attempt_at: Date }>("select next_attempt_at from learning_app.generation_runs where id=$1", [runId]);
          clock.advanceMs(Math.max(0, scheduled!.next_attempt_at.getTime() - clock.now().getTime()));
        }
      }
      const run = await readGeneration(services, runId);
      expect(run.state).toBe("failed");
      expect(run.errorCode).toBe("attempts_exhausted");
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }

    const lessonLogs = logs.filter((line) => line.includes("[lesson]")).join("\n");
    expect(lessonLogs).toMatch(/błąd partii LLM: kod=provider/);
    expect(lessonLogs).not.toContain("llm timeout");
    expect(lessonLogs).toMatch(/zakończony: state=failed kod=attempts_exhausted/);
  });

  it("odpowiedź strict-schema (komplet pól z nullami) przechodzi przez strażnik kształtu do zapisu", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    // Strict mode zwraca WSZYSTKIE pola schematu; nie dotyczące typu mają null.
    fakes.llm.queueLesson({
      exercises: [
        {
          exerciseType: "lesson_gap",
          objectiveId: "english_grammar.present_simple.third_person_s",
          answer: "plays",
          acceptedAnswers: ["play"],
          focus: ["plays"],
          instructionPl: "Uzupełnij lukę.",
          stem: "She ___ tennis.",
          statement: null,
          prompt: null,
          hint: null,
          transformId: null,
          noticeSegments: null,
          options: null,
          correctOption: null,
          items: null,
        },
      ],
      examples: {},
    });

    const { runId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);

    const run = await readGeneration(services, runId);
    expect(run.state).toBe("succeeded");
    expect(run.errorCode).toBeNull();
    const items = await query<{ count: number }>("select count(*)::int as count from learning_app.item_revisions where deck_version_id = $1", [run.deckVersionId!]);
    expect(items[0]!.count).toBeGreaterThanOrEqual(1);
  });

  it("błąd providera → ponowienie do wyczerpania prób (attempts_exhausted)", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const clock = new ManualClock();
    const services = lessonServices(fakes, clock);
    fakes.llm.queueLesson({ error: "llm timeout", retryable: true });

    const { runId } = await createLesson(services, command());
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await executeLessonGeneration(services, runId);
      const dto = await readGeneration(services, runId);
      expect(dto.state).toBe("queued");
      expect(dto.attempts).toBe(attempt);
      const [scheduled] = await query<{ next_attempt_at: Date }>("select next_attempt_at from learning_app.generation_runs where id=$1", [runId]);
      clock.advanceMs(Math.max(0, scheduled!.next_attempt_at.getTime() - clock.now().getTime()));
    }
    await executeLessonGeneration(services, runId);
    const exhausted = await readGeneration(services, runId);
    expect(exhausted.state).toBe("failed");
    expect(exhausted.errorCode).toBe("attempts_exhausted");
  });

  it("błąd trwały kończy się po jednym żądaniu, a retry ręczny czyści odroczenie", async () => {
    const fakes = await fakeGeneration(); disposers.push(fakes.dispose);
    const clock = new ManualClock();
    const services = lessonServices(fakes, clock);
    const originalGenerate = fakes.llm.generateLessonPool.bind(fakes.llm);
    let providerCalls = 0;
    fakes.llm.generateLessonPool = async () => {
      providerCalls += 1;
      throw new GenerationProviderError("configuration", { status: 400 });
    };
    const { runId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).errorCode).toBe("provider_configuration");
    expect(providerCalls).toBe(1);
    await retryGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("queued");
    expect((await readGeneration(services, runId)).attempts).toBe(0);
    fakes.llm.generateLessonPool = originalGenerate;
  });

  it("odracza transient retry do nextAttemptAt; ręczne retry skraca odroczenie", async () => {
    const fakes = await fakeGeneration(); disposers.push(fakes.dispose);
    const clock = new ManualClock();
    const services = lessonServices(fakes, clock);
    fakes.llm.queueLesson({ error: "temporary", retryable: true });
    const { runId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);
    const [scheduled] = await query<{ next_attempt_at: Date; attempts: number }>("select next_attempt_at, attempts from learning_app.generation_runs where id=$1", [runId]);
    expect(scheduled!.next_attempt_at.getTime()).toBeGreaterThan(clock.now().getTime());
    expect(scheduled!.attempts).toBe(1);
    await executeLessonGeneration(services, runId);
    expect(fakes.llm.lessonRequests).toHaveLength(1);
    await retryGeneration(services, runId);
    const [cleared] = await query<{ next_attempt_at: Date | null; attempts: number }>("select next_attempt_at, attempts from learning_app.generation_runs where id=$1", [runId]);
    expect(cleared).toEqual({ next_attempt_at: null, attempts: 0 });
  });

  it("restart procesu workera wykonuje zlecony run lekcji", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);

    const { runId } = await createLesson(services, command());
    expect((await readGeneration(services, runId)).state).toBe("queued");

    const restarted = createDatabase(testDatabaseUrl());
    const restartedServices = createServices({
      db: restarted.db,
      clock: new ManualClock(),
      media: fakes.settings,
      generation: fakes.deps,
      subjects: lessonRegistry(),
    });
    try {
      await runDueGenerationWork(restartedServices);
    } finally {
      await restarted.pool.end();
    }

    const dto = await readGeneration(services, runId);
    expect(dto.state).toBe("succeeded");
    const [version] = await query<{ state: string }>("select state from learning_app.deck_versions where id = $1", [dto.deckVersionId!]);
    expect(version!.state).toBe("review");
  });

  it("regenerateObjective dopisuje nowe ćwiczenia bez powtórzenia bodźca", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);

    const { runId, deckId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);
    const versionId = (await readGeneration(services, runId)).deckVersionId!;
    const before = await query<{ payload: LessonExerciseDraft }>("select payload from learning_app.item_revisions where deck_version_id = $1", [versionId]);
    const beforeCount = before.length;

    const regen = await regenerateObjective(services, {
      deckId,
      objectiveId: "english_grammar.present_simple.third_person_s",
      count: 4,
      expectedEditNumber: 2,
      clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, regen.runId);

    const after = await query<{ payload: LessonExerciseDraft }>("select payload from learning_app.item_revisions where deck_version_id = $1", [versionId]);
    expect(after.length).toBeGreaterThan(beforeCount);
    const [version] = await query<{ edit_number: number }>("select edit_number from learning_app.deck_versions where id = $1", [versionId]);
    expect(version!.edit_number).toBe(3);
    await expect(editLessonDraft(services, versionId, { expectedEditNumber: 2, title: "stary formularz" })).rejects.toMatchObject({ code: "conflict" });
    // Każde ćwiczenie ma unikalny bodziec w swoim celu; odpowiedź sama w sobie
    // nie jest kluczem deduplikacji dla gramatyki.
    const identities = after.map(({ payload }) => lessonExerciseIdentity(payload));
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("rezerwuje tylko jeden aktywny top-up na szkic i zachowuje idempotencję tego samego żądania", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const { runId, deckId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);
    const expectedEditNumber = 2;
    const objectiveId = "english_grammar.present_simple.third_person_s";
    const firstKey = randomUUID();
    const secondKey = randomUUID();
    const [first, competing] = await Promise.allSettled([
      regenerateObjective(services, { deckId, objectiveId, count: 4, expectedEditNumber, clientRequestId: firstKey }),
      regenerateObjective(services, { deckId, objectiveId, count: 4, expectedEditNumber, clientRequestId: secondKey }),
    ]);
    const accepted = first.status === "fulfilled" ? first.value : competing.status === "fulfilled" ? competing.value : null;
    const rejected = first.status === "rejected" ? first.reason : competing.status === "rejected" ? competing.reason : null;
    expect(accepted).not.toBeNull();
    expect(rejected).toMatchObject({ code: "conflict" });
    const repeated = await regenerateObjective(services, {
      deckId, objectiveId, count: 4, expectedEditNumber, clientRequestId: first.status === "fulfilled" ? firstKey : secondKey,
    });
    expect(repeated.runId).toBe(accepted!.runId);
  });

  it("edycja rodzica unieważnia queued run przed wywołaniem providera", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const { runId } = await createLesson(services, command());
    const queued = await readGeneration(services, runId);
    await editLessonDraft(services, queued.deckVersionId!, { expectedEditNumber: 1, title: "Zmiana rodzica" });
    expect((await readGeneration(services, runId)).state).toBe("superseded");
    await executeLessonGeneration(services, runId);
    expect(fakes.llm.lessonRequests).toHaveLength(0);
    const [version] = await query<{ edit_number: number; title: string }>("select edit_number, title from learning_app.deck_versions where id = $1", [queued.deckVersionId]);
    expect(version).toMatchObject({ edit_number: 2, title: "Zmiana rodzica" });
  });

  it("edycja rodzica przerywa request w toku i nie zapisuje spóźnionego wyniku", async () => {
    const fakes = await fakeGeneration(); disposers.push(fakes.dispose);
    fakes.deps.lessonExecution = { requestTimeoutMs: 2_000, runTimeoutMs: 5_000, cancelPollMs: 10 };
    const services = lessonServices(fakes);
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    let requestSignal!: AbortSignal;
    fakes.deps.llm.generateLessonPool = async (_input, signal) => {
      requestSignal = signal!;
      enter();
      return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    };
    const { runId } = await createLesson(services, command());
    const run = await readGeneration(services, runId);
    const pending = executeLessonGeneration(services, runId);
    await entered;
    await editLessonDraft(services, run.deckVersionId!, { expectedEditNumber: 1, title: "Nowa treść rodzica" });
    await pending;
    expect(requestSignal.aborted).toBe(true);
    expect((await readGeneration(services, runId)).state).toBe("superseded");
    expect(await query("select id from learning_app.item_revisions where deck_version_id=$1", [run.deckVersionId])).toHaveLength(0);
  });

  it("shutdown oddaje aktualny run do kolejki bez cofania wykorzystanej próby", async () => {
    const fakes = await fakeGeneration(); disposers.push(fakes.dispose);
    fakes.deps.lessonExecution = { requestTimeoutMs: 2_000, runTimeoutMs: 5_000, cancelPollMs: 10 };
    const services = lessonServices(fakes);
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    let requestSignal!: AbortSignal;
    fakes.deps.llm.generateLessonPool = async (_input, signal) => {
      requestSignal = signal!;
      enter();
      return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    };
    const { runId } = await createLesson(services, command());
    const controller = new AbortController();
    const pending = executeLessonGeneration(services, runId, { signal: controller.signal });
    await entered;
    controller.abort();
    await pending;
    const result = await readGeneration(services, runId);
    expect(requestSignal.aborted).toBe(true);
    expect(result.state).toBe("queued");
    expect(result.attempts).toBe(1);
    expect(await query("select id from learning_app.item_revisions where deck_version_id=$1", [result.deckVersionId])).toHaveLength(0);
  });

  it("przedmiot fixture historii (ttsForAnswers=false) przechodzi cały przepływ bez audio", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);

    const { runId } = await createLesson(
      services,
      command({
        subjectId: "test_history",
        topicId: "piast_origins",
        objectiveIds: ["test_history.piast_origins.chrzest_966"],
        material: "Mieszko I przyjął chrzest w 966 roku. Chrzest Polski.",
        clientRequestId: randomUUID(),
      }),
    );
    await executeLessonGeneration(services, runId);

    const run = await readGeneration(services, runId);
    expect(run.state).toBe("succeeded");
    const [version] = await query<{ state: string }>("select state from learning_app.deck_versions where id = $1", [run.deckVersionId!]);
    expect(version!.state).toBe("review");
    const items = await query<{ count: number }>("select count(*)::int as count from learning_app.item_revisions where deck_version_id = $1", [run.deckVersionId!]);
    expect(items[0]!.count).toBeGreaterThan(0);
    // ttsForAnswers=false → brak zasobów audio
    expect(await countRows("media_assets")).toBe(0);
    expect(await countRows("revision_assets")).toBe(0);
  });

  it("TTS przypadkowo podpięte do lekcji z wyłączonym audio nadal kończy jako superseded", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const { runId } = await createLesson(services, command({
      subjectId: "test_history",
      topicId: "piast_origins",
      objectiveIds: ["test_history.piast_origins.chrzest_966"],
      material: "Mieszko I przyjął chrzest w 966 roku. Chrzest Polski.",
      clientRequestId: randomUUID(),
    }));
    await executeLessonGeneration(services, runId);
    const [revision] = await query<{ id: string }>(
      "select id from learning_app.item_revisions where deck_version_id = (select deck_version_id from learning_app.generation_runs where id = $1) limit 1",
      [runId],
    );
    const assetId = randomUUID();
    const fingerprint = `disabled-lesson-${randomUUID()}`;
    await pool.query(
      `insert into learning_app.media_assets(id, kind, fingerprint, generation_number, state, provider, model, metadata)
       values ($1, 'tts', $2, 1, 'pending', $3, $4, $5)`,
      [assetId, fingerprint, fakes.settings.tts.provider, fakes.settings.tts.model,
        { text: "test answer", locale: "en-GB", voice: fakes.settings.tts.voice, format: "mp3" }],
    );
    await pool.query(
      `insert into learning_app.revision_assets(item_revision_id, role, asset_id, expected_fingerprint, state)
       values ($1, 'target_audio', $2, $3, 'pending')`,
      [revision!.id, assetId, fingerprint],
    );
    await pool.query(
      `insert into learning_app.generation_runs(id, asset_id, kind, dedupe_key, state, input)
       values ($1, $2, 'tts', $3, 'queued', $4)`,
      [randomUUID(), assetId, `asset:${assetId}`, { text: "test answer" }],
    );

    await executeMediaAsset(services, assetId);
    const [asset] = await query<{ state: string }>("select state from learning_app.media_assets where id = $1", [assetId]);
    const [mediaRun] = await query<{ state: string }>("select state from learning_app.generation_runs where asset_id = $1", [assetId]);
    expect(asset?.state).toBe("failed");
    expect(mediaRun?.state).toBe("superseded");
    expect(fakes.tts.requests).toHaveLength(0);
  });
});

// Dowód, że fake LLM implementuje nowy port (bez sieci).
describe("FakeLlmProvider.generateLessonPool", () => {
  it.each(["lesson_gap", "lesson_transform"])("generuje %s i zachowuje kształt promptów oraz existingAnswers", async (productiveType) => {
    const llm = new FakeLlmProvider();
    const result = await llm.generateLessonPool({
      subjectId: "english_grammar",
      subjectTitle: "x",
      answerLocale: "en-GB",
      promptLocale: "pl-PL",
      promptProfile: { generationRole: "", gradingRole: "", almostDefinition: "" },
      exerciseTypes: ["lesson_choice", productiveType, "lesson_open_answer"] as ("lesson_choice" | "lesson_gap" | "lesson_transform" | "lesson_open_answer")[],
      transforms: [{ id: "to_negative", instructionPl: "Zamień na przeczenie" }],
      objectives: [
        {
          id: "english_grammar.present_simple.third_person_s",
          descriptionEn: "x",
          exerciseTypes: ["lesson_choice", productiveType, "lesson_open_answer"] as ("lesson_choice" | "lesson_gap" | "lesson_transform" | "lesson_open_answer")[],
          errorCategories: [],
        },
      ],
      material: "He plays football every day she watches tv",
      countPerObjective: 6,
      stageCounts: { guided: 2, productive: 3, independent: 1 },
      graderAvailable: true,
      existingAnswers: ["he"],
    });
    expect(result.exercises.length).toBeGreaterThan(0);
    const answers = result.exercises.map((e) => (e as { answer: string }).answer.toLowerCase());
    expect(answers).not.toContain("he");
    for (const raw of result.exercises) {
      const ex = raw as Record<string, unknown>;
      if (ex.exerciseType === "lesson_choice") expect(ex.stem).toEqual(expect.any(String));
      if (ex.exerciseType === "lesson_transform") expect(ex.statement).toEqual(expect.any(String));
    }
  });
});
