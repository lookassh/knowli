import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  computeTargetKey,
  createChild,
  createLessonFromMaterial,
  createSchoolLesson,
  createServices,
  editLessonDraft,
  endSession,
  executeLessonGeneration,
  nextTask,
  publishLessonDraft,
  readGeneration,
  readLessonDeck,
  startSession,
  submitAttempt,
  type Services,
} from "@learning/server";
import { LessonExerciseInputSchema, type LessonDraftDto, type TaskDto } from "@learning/contracts";
import { stageOf } from "../../packages/server/src/domain/lessons/stages";
import { fakeGeneration, FakeLlmProvider, type FakeGeneration } from "./fakes";
import { ManualClock, testDatabase } from "./helpers";

/**
 * Lekcja „Angielski — rozdział” na PostgreSQL z fałszywym generatorem (design
 * 2026-10-30, §4 i §8): zagadnienia z rodzajem, pula bez cytatów, walidacja
 * słownikowa tylko przy generacji, edycja rodzica poza słownikiem, ekspozycja
 * rozwiązanego zdania w samodzielności, języki w Kid DTO i kartkówka.
 */

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

/** Rozdział w trzech zagadnieniach: słowa, słowa, rama zdaniowa. */
const CHAPTER_MATERIAL = [
  "Zagadnienie 1: Ubrania",
  "coat, boots, dress, skirt, t-shirt",
  "Zagadnienie 2: Pogoda",
  "It's raining. It's snowing. What's the weather like?",
  "Zagadnienie 3: Co mam na sobie",
  "I'm wearing a coat. I'm wearing boots.",
].join("\n");

/** Jedno zagadnienie bez nagłówków — pula sterowana w testach samodzielności. */
const WEAR_MATERIAL = "I wear a coat. I wear boots. She wears a dress. We wear a skirt.";

describe("lekcja Angielski — rozdział (integracja)", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await pool.query(
      `truncate learning_app.child_profiles, learning_app.parent_sessions, learning_app.parent_credentials,
              learning_app.integration_tokens, learning_app.generation_runs, learning_app.child_objective_progress,
              learning_app.lesson_verdicts, learning_app.revision_assets, learning_app.media_assets,
              learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
              learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  });

  afterAll(() => pool.end());

  /** Usługi z produkcyjnym rejestrem przedmiotów i fałszywymi providerami. */
  async function chapterWorld(): Promise<{ fakes: FakeGeneration; services: Services; clock: ManualClock }> {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const clock = new ManualClock();
    const services = createServices({ db: testDatabase().db, clock, media: fakes.settings, generation: fakes.deps });
    return { fakes, services, clock };
  }

  async function generateChapter(services: Services, material = CHAPTER_MATERIAL, topicTitlePl = "Unit 1") {
    const { runId, deckId } = await createLessonFromMaterial(services, {
      subjectId: "english_chapter",
      topicTitlePl,
      material,
      poolSize: 40,
      clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");
    const deck = await readLessonDeck(services, deckId);
    return { runId, deckId, draft: deck.draft! };
  }

  /** Ćwiczenie szkicu jako wejście edycji (bez identyfikatora rewizji). */
  function editInputs(exercises: LessonDraftDto["exercises"]) {
    return exercises.map(({ revisionId: _revisionId, ...input }) => LessonExerciseInputSchema.parse(input));
  }

  function stageCounts(draft: LessonDraftDto, objectiveId: string) {
    const counts = { guided: 0, productive: 0, independent: 0 };
    for (const exercise of draft.exercises.filter((item) => item.objectiveId === objectiveId)) {
      const stage = stageOf(exercise.exerciseType);
      if (stage === "guided" || stage === "productive" || stage === "independent") counts[stage] += 1;
    }
    return counts;
  }

  it("generacja: zagadnienia z rodzajem, pula bez cytatów w payloadzie v2 i szkic gotowy do publikacji", async () => {
    const { services } = await chapterWorld();
    const { deckId, draft } = await generateChapter(services);

    const objectives = draft.dynamicTopic!.objectives;
    expect(objectives.map((objective) => objective.kind)).toEqual(["words", "frame", "frame"]);
    for (const objective of objectives) expect(objective.id.startsWith(`english_chapter.d${deckId}.`)).toBe(true);
    expect(draft.objectiveIds).toEqual(objectives.map((objective) => objective.id));

    // Rodzaj zagadnienia jest zapisany w kontekście wersji, nie tylko w widoku rodzica.
    const [version] = await query<{ lesson_context: { dynamicTopic: { objectives: { id: string; kind?: string }[] } } }>(
      "select lesson_context from learning_app.deck_versions where id = $1", [draft.id],
    );
    expect(version!.lesson_context.dynamicTopic.objectives.map((objective) => objective.kind)).toEqual(["words", "frame", "frame"]);

    const revisions = await query<{ payload_version: number; payload: Record<string, unknown>; target_key: string }>(
      "select payload_version, payload, target_key from learning_app.item_revisions where deck_version_id = $1 order by position", [draft.id],
    );
    expect(revisions.length).toBe(draft.exercises.length);
    for (const revision of revisions) {
      expect(revision.payload_version).toBe(2);
      expect(revision.payload).not.toHaveProperty("sourceRefs");
      expect(revision.payload).not.toHaveProperty("hint");
      expect(["lesson_choice", "lesson_gap", "lesson_open_answer"]).toContain(revision.payload.exerciseType);
    }
    // Klucz ekspozycji luki to rozwiązane zdanie, a nie samo słowo.
    const gap = draft.exercises.find((exercise) => exercise.exerciseType === "lesson_gap")!;
    const [gapRevision] = revisions.filter((revision) => revision.payload.stem === gap.stem && revision.payload.answer === gap.answer);
    expect(gapRevision!.target_key).toBe(computeTargetKey(gap.stem!.replace(/_{2,}/u, gap.answer).replace(/[.!?…\s]+$/u, ""), "en-GB"));
    expect(gapRevision!.target_key).not.toBe(computeTargetKey(gap.answer, "en-GB"));

    expect(draft.rejectedCount).toBe(0);
    expect(draft.rejectedReasons).toBeUndefined();
    expect(draft.coverage).toEqual([]);
    for (const objective of objectives) {
      const counts = stageCounts(draft, objective.id);
      expect(counts.guided).toBeGreaterThanOrEqual(3);
      expect(counts.productive).toBeGreaterThanOrEqual(3);
      expect(counts.independent).toBeGreaterThanOrEqual(2);
    }

    await expect(publishLessonDraft(services, draft.id, draft.editNumber)).resolves.toEqual({ deckVersionId: draft.id });
    expect((await readLessonDeck(services, deckId)).published).not.toBeNull();
  });

  it("odrzucenie: słowo spoza materiału usuwa ćwiczenie z powodem dla rodzica, wariant spoza materiału znika, ćwiczenie zostaje", async () => {
    const { fakes, services } = await chapterWorld();
    const VARIANT_GAP = "Mam na sobie płaszcz. Wpisz brakujące słowo.";
    const VARIANT_PROMPT = "Mam płaszcz.";
    fakes.deps.llm.generateLessonPool = async (input) => {
      const objectiveId = input.objectives[0]!.id;
      const regular = await new FakeLlmProvider().generateLessonPool(input);
      return {
        ...regular,
        exercises: [
          ...regular.exercises,
          // opcja spoza materiału → odrzucenie całego ćwiczenia
          {
            exerciseType: "lesson_choice", objectiveId, instructionPl: "Pada deszcz. Wybierz słowo.", stem: "I have a ___.",
            options: [{ id: "a", text: "coat" }, { id: "b", text: "umbrella" }], correctOption: "a",
            answer: "coat", acceptedAnswers: [], focus: [],
          },
          // odpowiedź złożona wyłącznie ze słów funkcyjnych → brak słowa treści
          {
            exerciseType: "lesson_gap", objectiveId, instructionPl: "Mam to coś. Wpisz brakujące słowo.", stem: "I have ___ coat.",
            answer: "the", acceptedAnswers: [], focus: ["the"],
          },
          // wariant luki spoza materiału → usunięty, ćwiczenie zostaje
          {
            exerciseType: "lesson_gap", objectiveId, instructionPl: VARIANT_GAP, stem: "She has a ___.",
            answer: "coat", acceptedAnswers: ["jacket"], focus: ["coat"],
          },
          // wariant tłumaczenia spoza materiału → usunięty, wariant z materiału zostaje
          {
            exerciseType: "lesson_open_answer", objectiveId, instructionPl: "Przetłumacz na angielski.", prompt: VARIANT_PROMPT,
            answer: "We have the coat", acceptedAnswers: ["We own a coat", "We have a coat"], focus: ["coat"],
          },
        ],
      };
    };

    const { draft } = await generateChapter(services, CHAPTER_MATERIAL.split("Zagadnienie 3")[0]!);
    const objectiveCount = draft.dynamicTopic!.objectives.length;
    expect(objectiveCount).toBe(2);

    // Każda partia dostała te same cztery wadliwe ćwiczenia: dwa odrzucone na zagadnienie.
    expect(draft.rejectedCount).toBe(2 * objectiveCount);
    expect(draft.rejectedReasons).toEqual({
      "słowo spoza materiału: umbrella": objectiveCount,
      "brak słowa treści: the": objectiveCount,
    });
    expect(draft.exercises.some((exercise) => exercise.options?.some((option) => option.text === "umbrella"))).toBe(false);
    expect(draft.exercises.some((exercise) => exercise.exerciseType === "lesson_gap" && exercise.answer === "the")).toBe(false);

    const variantGaps = draft.exercises.filter((exercise) => exercise.instructionPl === VARIANT_GAP);
    expect(variantGaps).toHaveLength(objectiveCount);
    for (const exercise of variantGaps) expect(exercise.acceptedAnswers).toEqual([]);
    const variantTranslations = draft.exercises.filter((exercise) => exercise.prompt === VARIANT_PROMPT);
    expect(variantTranslations).toHaveLength(objectiveCount);
    for (const exercise of variantTranslations) expect(exercise.acceptedAnswers).toEqual(["We have a coat"]);

    // Powody są też w kontekście wersji (źródło dla panelu rodzica).
    const [version] = await query<{ lesson_context: { rejectedReasons: Record<string, number> } }>(
      "select lesson_context from learning_app.deck_versions where id = $1", [draft.id],
    );
    expect(version!.lesson_context.rejectedReasons).toEqual(draft.rejectedReasons);
  });

  it("rodzic: wariant luki spoza materiału przechodzi edycję i publikację", async () => {
    const { services } = await chapterWorld();
    const { deckId, draft } = await generateChapter(services);
    const gap = draft.exercises.find((exercise) => exercise.exerciseType === "lesson_gap")!;

    const edited = await editLessonDraft(services, draft.id, {
      expectedEditNumber: draft.editNumber,
      exercises: editInputs(draft.exercises.map((exercise) =>
        exercise.id === gap.id ? { ...exercise, acceptedAnswers: ["umbrella"] } : exercise)),
    });
    expect(edited.exercises.find((exercise) => exercise.id === gap.id)!.acceptedAnswers).toEqual(["umbrella"]);

    await expect(publishLessonDraft(services, edited.id, edited.editNumber)).resolves.toEqual({ deckVersionId: edited.id });
    const published = (await readLessonDeck(services, deckId)).published!;
    expect(published.exercises.find((exercise) => exercise.stem === gap.stem && exercise.answer === gap.answer)!.acceptedAnswers).toEqual(["umbrella"]);
  });

  it("rodzic: patch zagadnień zachowuje rodzaj, także po usunięciu zagadnienia", async () => {
    const { services } = await chapterWorld();
    const { draft } = await generateChapter(services);
    const original = draft.dynamicTopic!.objectives;
    expect(original.map((objective) => objective.kind)).toEqual(["words", "frame", "frame"]);

    const renamed = await editLessonDraft(services, draft.id, {
      expectedEditNumber: draft.editNumber,
      dynamicTopic: { objectives: original.map((objective) => ({ id: objective.id, titlePl: `${objective.titlePl} (po zmianie)`, cards: objective.cards })) },
    });
    expect(renamed.dynamicTopic!.objectives.map((objective) => objective.titlePl)).toEqual(original.map((objective) => `${objective.titlePl} (po zmianie)`));
    expect(renamed.dynamicTopic!.objectives.map((objective) => objective.kind)).toEqual(["words", "frame", "frame"]);

    // Usunięcie pierwszego zagadnienia nie przesuwa rodzajów pozostałych.
    const kept = renamed.dynamicTopic!.objectives.slice(1);
    const trimmed = await editLessonDraft(services, renamed.id, {
      expectedEditNumber: renamed.editNumber,
      dynamicTopic: { objectives: kept.map((objective) => ({ id: objective.id, titlePl: objective.titlePl, cards: objective.cards })) },
    });
    expect(trimmed.dynamicTopic!.objectives.map((objective) => objective.kind)).toEqual(["frame", "frame"]);
    const [version] = await query<{ lesson_context: { dynamicTopic: { objectives: { kind?: string }[] } } }>(
      "select lesson_context from learning_app.deck_versions where id = $1", [draft.id],
    );
    expect(version!.lesson_context.dynamicTopic.objectives.map((objective) => objective.kind)).toEqual(["frame", "frame"]);
  });

  it("regresja szkoły: createSchoolLesson dalej tworzy cele school.d… z cytatami źródłowymi", async () => {
    const { services } = await chapterWorld();
    const { runId, deckId } = await createSchoolLesson(services, {
      subjectTitlePl: "Przyroda",
      topicTitlePl: "Materiał",
      material: [
        "Zagadnienie 1: Fotosynteza",
        "Wyjaśnienie: Fotosynteza to proces, w którym roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry. Cukry są pokarmem rośliny.",
        "Zagadnienie 2: Chrzest Polski",
        "Wyjaśnienie: Mieszko I przyjął chrzest w 966 roku. Chrzest włączył państwo do chrześcijańskiej Europy i wzmocnił władzę księcia.",
      ].join("\n"),
      poolSize: 40,
      clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, runId);
    const draft = (await readLessonDeck(services, deckId)).draft!;

    expect(draft.objectiveIds.length).toBe(2);
    for (const id of draft.objectiveIds) expect(id.startsWith(`school.d${deckId}.`)).toBe(true);
    // Szkoła nie dostaje rodzaju zagadnienia — to opcja przedmiotu rozdziału.
    for (const objective of draft.dynamicTopic!.objectives) expect(objective.kind).toBeUndefined();
    const revisions = await query<{ payload_version: number; payload: { sourceRefs?: unknown } }>(
      "select payload_version, payload from learning_app.item_revisions where deck_version_id = $1", [draft.id],
    );
    expect(revisions.length).toBeGreaterThan(0);
    for (const revision of revisions) {
      expect(revision.payload_version).toBe(3);
      expect(Array.isArray(revision.payload.sourceRefs)).toBe(true);
    }
  });

  describe("sesje dziecka na opublikowanej lekcji rozdziału", () => {
    /** Pula sterowana: wspólne zdania wyboru i luki oraz luka w innym zdaniu z tym samym słowem. */
    function controlledPool(objectiveId: string) {
      const choice = (instruction: string, stem: string, correct: string, wrong: string) => ({
        exerciseType: "lesson_choice", objectiveId, instructionPl: instruction, stem,
        options: [{ id: "a", text: correct }, { id: "b", text: wrong }], correctOption: "a",
        answer: correct, acceptedAnswers: [], focus: [],
      });
      const gap = (instruction: string, stem: string, answer: string) => ({
        exerciseType: "lesson_gap", objectiveId, instructionPl: instruction, stem,
        answer, acceptedAnswers: [], focus: [answer],
      });
      const translation = (prompt: string, answer: string, focus: string) => ({
        exerciseType: "lesson_open_answer", objectiveId, instructionPl: "Przetłumacz na angielski.", prompt,
        answer, acceptedAnswers: [], focus: [focus],
      });
      return [
        choice("Mam na sobie płaszcz. Wybierz słowo.", "I wear a ___.", "coat", "dress"),
        choice("Mam na sobie buty. Wybierz słowo.", "I wear ___.", "boots", "skirt"),
        choice("Ona ma sukienkę. Wybierz słowo.", "She wears a ___.", "dress", "skirt"),
        // To samo rozwiązane zdanie co w wyborze: „I wear a coat” i „I wear boots”.
        gap("Mam na sobie płaszcz. Wpisz brakujące słowo.", "I wear a ___.", "coat"),
        gap("Mam na sobie buty. Wpisz brakujące słowo.", "I wear ___.", "boots"),
        // Inne zdanie z tym samym słowem „coat” co w pierwszym wyborze.
        gap("Zimą noszę płaszcz. Wpisz brakujące słowo.", "We wear a ___ in winter.", "coat"),
        translation("Mam płaszcz.", "We have the coat", "coat"),
        translation("Ona ma sukienkę.", "She has a dress", "dress"),
      ];
    }

    async function publishedChapter() {
      const { fakes, services, clock } = await chapterWorld();
      fakes.deps.llm.generateLessonPool = async (input) => ({
        exercises: controlledPool(input.objectives[0]!.id),
        examples: {},
      });
      const { deckId, draft } = await generateChapter(services, WEAR_MATERIAL, "Ubrania");
      expect(draft.objectiveIds).toHaveLength(1);
      expect(draft.rejectedCount).toBe(0);
      await publishLessonDraft(services, draft.id, draft.editNumber);
      return { services, clock, deckId, draft };
    }

    async function assign(childId: string, deckId: string, mockTest = false) {
      await pool.query(
        mockTest
          ? "insert into learning_app.assignments (id, child_id, deck_id, test_date, test_goals) values ($1, $2, $3, '2026-10-20', ARRAY['lesson'])"
          : "insert into learning_app.assignments (id, child_id, deck_id, test_date, test_goals) values ($1, $2, $3, null, null)",
        [randomUUID(), childId, deckId],
      );
    }

    async function answerKey(taskId: string): Promise<Record<string, unknown>> {
      return (await query<{ answer_key: Record<string, unknown> }>("select answer_key from learning_app.session_tasks where id = $1", [taskId]))[0]!.answer_key;
    }

    async function answerCorrectly(services: Services, task: TaskDto) {
      const key = await answerKey(task.taskId);
      if (task.exerciseType === "lesson_choice") {
        return submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
      }
      return submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.answer as string });
    }

    /** Zadanie rozwiązane przez dziecko wraz z zamrożonym kontekstem kwalifikacji jego próby. */
    interface PlayedTask {
      task: TaskDto;
      key: Record<string, unknown>;
      answerPreviouslyExposed: boolean;
      independent: boolean;
    }

    /**
     * Gra kolejne sesje (co godzinę) i odpowiada poprawnie. Plan sesji powstaje
     * z góry, więc nowy cel dostaje w pierwszej sesji tylko etap prowadzony;
     * luki pojawiają się dopiero w kolejnych sesjach.
     */
    async function playSessions(services: Services, clock: ManualClock, childId: string, deckId: string, sessions: number): Promise<PlayedTask[]> {
      const played: PlayedTask[] = [];
      for (let index = 0; index < sessions; index++) {
        const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
        for (let step = 0; step < 30; step++) {
          const task = await nextTask(services, session.sessionId);
          if (task === null) break;
          if (task.exerciseType === "lesson_card") {
            await completePresentation(services, { taskId: task.taskId });
            continue;
          }
          const key = await answerKey(task.taskId);
          const attempt = await answerCorrectly(services, task);
          expect(attempt.feedback?.kind).toBe("great");
          const [row] = await query<{ context: { answerPreviouslyExposed: boolean }; independent: boolean }>(
            `select at.context, a.independent from learning_app.attempts at
               join learning_app.assessments a on a.attempt_id = at.id
              where at.task_id = $1`, [task.taskId],
          );
          played.push({ task, key, answerPreviouslyExposed: row!.context.answerPreviouslyExposed, independent: row!.independent });
        }
        await endSession(services, session.sessionId);
        clock.advanceHours(1);
      }
      return played;
    }

    /** Rozwiązane zdanie jak w kluczu ekspozycji: bez końcowej interpunkcji, małe litery. */
    function solved(stem: string, word: string): string {
      return stem.replace(/_{2,}/u, word).replace(/[.!?…\s]+$/u, "").toLowerCase();
    }

    /** Kartkówka: wszystkie sloty planu, odpowiedzi poprawne (wynik i omówienie dopiero po zamknięciu). */
    async function playMockTest(services: Services, childId: string, deckId: string): Promise<{ task: TaskDto; key: Record<string, unknown> }[]> {
      const session = await startSession(services, { childId, deckId, microphoneEnabled: false, mode: "mock_test" });
      const played: { task: TaskDto; key: Record<string, unknown> }[] = [];
      for (let step = 0; step < 20; step++) {
        const task = await nextTask(services, session.sessionId);
        if (task === null) break;
        played.push({ task, key: await answerKey(task.taskId) });
        await answerCorrectly(services, task);
      }
      return played;
    }

    it("samodzielność: luka w zdaniu rozwiązanym wcześniej w wyborze jest niesamodzielna, w innym zdaniu z tym samym słowem — samodzielna", async () => {
      const { services, clock, deckId } = await publishedChapter();
      const child = await createChild(services, { displayName: "Rozdział", avatarKey: "owl" });
      await assign(child.id, deckId);
      const played = await playSessions(services, clock, child.id, deckId, 3);

      // Sygnał silnika porównujemy z tym, co dziecko wcześniej widziało rozwiązane jako zdanie
      // (wybór i luka kończą się feedbackiem z rozwiązaniem poprawnej odpowiedzi).
      const solvedSentences = new Set<string>();
      const gaps: { stem: string; word: string; exposedBefore: boolean; played: PlayedTask }[] = [];
      for (const entry of played) {
        if (entry.task.exerciseType === "lesson_choice") {
          const { stem } = entry.task.prompt as { stem: string };
          solvedSentences.add(solved(stem, (entry.key.optionValues as Record<string, string>)[entry.key.correctOptionId as string]!));
        } else if (entry.task.exerciseType === "lesson_gap") {
          const { stemWithGap } = entry.task.prompt as { stemWithGap: string };
          const word = entry.key.answer as string;
          const sentence = solved(stemWithGap, word);
          gaps.push({ stem: stemWithGap, word, exposedBefore: solvedSentences.has(sentence), played: entry });
          solvedSentences.add(sentence);
        }
      }
      expect(gaps.length).toBeGreaterThanOrEqual(3);
      for (const gap of gaps) {
        expect(gap.played.answerPreviouslyExposed).toBe(gap.exposedBefore);
        expect(gap.played.independent).toBe(!gap.exposedBefore);
      }

      // Pierwsze podejścia do luk: to samo zdanie co w wyborze nie jest samodzielne, a luka z tym samym słowem
      // w innym zdaniu jest.
      const first = (stem: string) => gaps.find((gap) => gap.stem === stem)!;
      expect(first("I wear a ___.")).toMatchObject({ word: "coat", exposedBefore: true });
      expect(first("I wear a ___.").played).toMatchObject({ answerPreviouslyExposed: true, independent: false });
      expect(first("I wear ___.")).toMatchObject({ word: "boots", exposedBefore: true });
      expect(first("I wear ___.").played).toMatchObject({ answerPreviouslyExposed: true, independent: false });
      expect(first("We wear a ___ in winter.")).toMatchObject({ word: "coat", exposedBefore: false });
      expect(first("We wear a ___ in winter.").played).toMatchObject({ answerPreviouslyExposed: false, independent: true });
    });

    it("Kid DTO: wybór niesie język treści, a w kartkówce także luka i tłumaczenie (język pytania i odpowiedzi)", async () => {
      const { services, clock, deckId } = await publishedChapter();
      const child = await createChild(services, { displayName: "Języki", avatarKey: "owl" });
      await assign(child.id, deckId, true);

      const [firstTask] = await playSessions(services, clock, child.id, deckId, 1);
      expect(firstTask!.task.prompt).toMatchObject({ kind: "lesson_choice", contentLocale: "en-GB" });

      const mock = await playMockTest(services, child.id, deckId);
      const promptOf = (type: string) => mock.find((entry) => entry.task.exerciseType === type)?.task.prompt;
      expect(promptOf("lesson_choice")).toMatchObject({ contentLocale: "en-GB" });
      expect(promptOf("lesson_gap")).toMatchObject({ contentLocale: "en-GB" });
      expect(promptOf("lesson_open_answer")).toMatchObject({ promptLocale: "pl-PL", answerLocale: "en-GB" });
    });

    it("kartkówka: luka zachowuje polskie zdanie-bodziec w poleceniu, bez podpowiedzi", async () => {
      const { services, deckId } = await publishedChapter();
      const child = await createChild(services, { displayName: "Kartkówka", avatarKey: "owl" });
      await assign(child.id, deckId, true);
      const mock = await playMockTest(services, child.id, deckId);

      const gaps = mock.filter((entry) => entry.task.exerciseType === "lesson_gap").map((entry) => entry.task.prompt as {
        instructionPl: string; stemWithGap: string; hint?: string;
      });
      expect(gaps.map((prompt) => [prompt.stemWithGap, prompt.instructionPl]).sort()).toEqual([
        ["I wear ___.", "Mam na sobie buty. Wpisz brakujące słowo."],
        ["I wear a ___.", "Mam na sobie płaszcz. Wpisz brakujące słowo."],
        ["We wear a ___ in winter.", "Zimą noszę płaszcz. Wpisz brakujące słowo."],
      ]);
      for (const prompt of gaps) expect(prompt).not.toHaveProperty("hint");
    });
  });
});
