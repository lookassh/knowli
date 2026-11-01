import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimQueuedRun,
  createLesson,
  createSchoolLesson,
  createServices,
  createSubjectRegistry,
  editLessonDraft,
  englishGrammarSubject,
  executeLessonGeneration,
  publishLessonDraft,
  readGeneration,
  readLessonDeck,
  regenerateLessonStory,
  regenerateObjective,
  retryGeneration,
  schoolSubject,
  type Services,
} from "@learning/server";
import type { LessonCommand } from "@learning/contracts";
import { ManualClock, testDatabase } from "./helpers";
import { fakeGeneration, type FakeGeneration } from "./fakes";

import { GenerationProviderError } from "../../packages/server/src/ports/generation-error";
import { solvedSentencesOf } from "../../packages/server/src/domain/lessons/story";
import { toExerciseDraft } from "../../packages/server/src/modules/materials/lessons/lesson-drafts";
import { latestLessonStoryRun } from "../../packages/server/src/modules/materials/lessons/lesson-story-generation";

const { pool, db } = testDatabase();
const OBJECTIVE = "english_grammar.present_simple.third_person_s";

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

function lessonServices(fakes: FakeGeneration, clock = new ManualClock()): Services {
  return createServices({
    db,
    clock,
    media: fakes.settings,
    generation: fakes.deps,
    subjects: createSubjectRegistry([englishGrammarSubject, schoolSubject]),
  });
}

function command(overrides: Partial<LessonCommand> = {}): LessonCommand {
  return {
    subjectId: "english_grammar",
    topicId: "present_simple",
    objectiveIds: [OBJECTIVE],
    material: "He plays football. She watches TV. They study English every day.",
    poolSize: 20,
    clientRequestId: randomUUID(),
    ...overrides,
  };
}

interface StoryRunRow {
  id: string;
  kind: string;
  state: string;
  dedupe_key: string;
  attempts: number;
  error_code: string | null;
  expected_edit_number: number;
  next_attempt_at: Date | null;
  input: Record<string, unknown>;
}

async function storyRuns(versionId: string): Promise<StoryRunRow[]> {
  return query<StoryRunRow>(
    `select id, kind, state, dedupe_key, attempts, error_code, expected_edit_number, next_attempt_at, input
       from learning_app.generation_runs
      where deck_version_id = $1 and input->>'purpose' = 'story'
      order by created_at`,
    [versionId],
  );
}

async function versionRow(versionId: string): Promise<{ edit_number: number; state: string; lesson_context: Record<string, unknown> }> {
  const [row] = await query<{ edit_number: number; state: string; lesson_context: Record<string, unknown> }>(
    "select edit_number, state, lesson_context from learning_app.deck_versions where id = $1",
    [versionId],
  );
  return row!;
}

const SCHOOL_MATERIAL = [
  "Zagadnienie 1: Fotosynteza",
  "Wyjaśnienie: Fotosynteza to proces, w którym roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry. Cukry są pokarmem rośliny.",
  "Zagadnienie 2: Chrzest Polski",
  "Wyjaśnienie: Mieszko I przyjął chrzest w 966 roku. Chrzest włączył państwo do chrześcijańskiej Europy i wzmocnił władzę księcia.",
].join("\n");

describe("run historyjki lekcji (integracja)", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
              learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
              learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function generatedGrammarLesson(clock = new ManualClock()) {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes, clock);
    const { runId, deckId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);
    const versionId = (await readGeneration(services, runId)).deckVersionId!;
    const [storyRun] = await storyRuns(versionId);
    return { fakes, services, clock, lessonRunId: runId, deckId, versionId, storyRunId: storyRun?.id };
  }

  async function generatedSchoolLesson() {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const { runId, deckId } = await createSchoolLesson(services, {
      subjectTitlePl: "Przyroda i historia",
      topicTitlePl: "Materiał pilotażowy",
      material: SCHOOL_MATERIAL,
      poolSize: 40,
      clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");
    const versionId = (await readGeneration(services, runId)).deckVersionId!;
    return { services, deckId, versionId };
  }

  it("full lesson run queues a story run for grammar", async () => {
    const { services, lessonRunId, deckId, versionId } = await generatedGrammarLesson();

    const runs = await storyRuns(versionId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      kind: "lesson",
      state: "queued",
      dedupe_key: `lesson-story:${lessonRunId}`,
      expected_edit_number: 2,
    });
    expect(runs[0]!.input).toMatchObject({ purpose: "story", deckId, deckVersionId: versionId, subjectId: "english_grammar" });

    // Panel: `generation` pokazuje run lekcji, nie run historyjki.
    expect((await readLessonDeck(services, deckId)).generation?.id).toBe(lessonRunId);
    expect((await latestLessonStoryRun(db, versionId))?.id).toBe(runs[0]!.id);
  });

  it("no story run for subject without lessonStory", async () => {
    const { versionId } = await generatedSchoolLesson();
    expect(await storyRuns(versionId)).toEqual([]);
  });

  it("regenerate objective run does not queue a story run", async () => {
    const { services, deckId, versionId, storyRunId } = await generatedGrammarLesson();
    await executeLessonGeneration(services, storyRunId!);

    const regen = await regenerateObjective(services, {
      deckId, objectiveId: OBJECTIVE, count: 4, expectedEditNumber: 2, clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, regen.runId);
    expect((await readGeneration(services, regen.runId)).state).toBe("succeeded");

    const runs = await storyRuns(versionId);
    expect(runs.map((run) => run.id)).toEqual([storyRunId]);
  });

  it("story run writes story without bumping editNumber", async () => {
    const { fakes, services, versionId, storyRunId } = await generatedGrammarLesson();

    await executeLessonGeneration(services, storyRunId!);

    const run = await readGeneration(services, storyRunId!);
    expect(run.state).toBe("succeeded");
    const version = await versionRow(versionId);
    expect(version.edit_number).toBe(2);
    expect(version.state).toBe("review");
    const story = version.lesson_context.story as {
      sentences: string[];
      questions: { id: string; question: string; options: { id: string; text: string }[]; correctOption: string }[];
    };
    expect(story.sentences).toHaveLength(4);
    expect(story.questions).toEqual([
      {
        id: "q1",
        question: "Jaki rower ma Sam?",
        options: [
          { id: "a", text: "czerwony" },
          { id: "b", text: "niebieski" },
          { id: "c", text: "zielony" },
        ],
        correctOption: "a",
      },
    ]);
    // Wejście modelu: temat i cele lekcji, rozwiązania puli do pominięcia.
    const request = fakes.llm.storyRequests[0]!;
    expect(request.objectives.map((objective) => objective.id)).toEqual([OBJECTIVE]);
    expect(request.answerLocale).toBe("en-GB");
    expect(request.storyRules.trim()).not.toBe("");
    expect(request.avoidSentences.length).toBeGreaterThan(0);
    expect(request.avoidSentences.length).toBeLessThanOrEqual(120);
  });

  it("story run survives exercise edit", async () => {
    const { services, versionId, storyRunId } = await generatedGrammarLesson();

    const edited = await editLessonDraft(services, versionId, { expectedEditNumber: 2, title: "Nowy tytuł rodzica" });
    expect(edited.editNumber).toBe(3);
    expect((await readGeneration(services, storyRunId!)).state).toBe("queued");

    await executeLessonGeneration(services, storyRunId!);

    expect((await readGeneration(services, storyRunId!)).state).toBe("succeeded");
    const version = await versionRow(versionId);
    expect(version.edit_number).toBe(3);
    expect((version.lesson_context.story as { sentences: string[] }).sentences).toHaveLength(4);
  });

  it.todo("story patch supersedes active story run");

  it("story run becomes superseded when version is published", async () => {
    const { fakes, services, deckId, versionId, storyRunId } = await generatedGrammarLesson();
    const draft = (await readLessonDeck(services, deckId)).draft!;
    await publishLessonDraft(services, versionId, draft.editNumber);

    await executeLessonGeneration(services, storyRunId!);

    expect((await readGeneration(services, storyRunId!)).state).toBe("superseded");
    expect(fakes.llm.storyRequests).toHaveLength(0);
    expect((await versionRow(versionId)).lesson_context.story).toBeUndefined();
  });

  it("invalid generated story fails with story_invalid and keeps previous story", async () => {
    const { fakes, services, versionId, storyRunId } = await generatedGrammarLesson();
    await executeLessonGeneration(services, storyRunId!);
    const previous = (await versionRow(versionId)).lesson_context.story;
    expect(previous).toBeDefined();

    const payloads = await query<{ payload: unknown }>("select payload from learning_app.item_revisions where deck_version_id = $1", [versionId]);
    const solved = solvedSentencesOf(payloads.map((row) => toExerciseDraft(row.payload)));
    expect(solved.length).toBeGreaterThan(0);
    fakes.llm.generateLessonStory = async () => ({
      story: {
        sentences: [solved[0]!, "Sam rides to the park.", "The park is big and green.", "Sam is very happy."],
        questions: [{ question: "Dokąd jedzie Sam?", options: ["do parku", "do szkoły", "do domu"], correctOptionIndex: 0 }],
      },
    });

    const { runId } = await regenerateLessonStory(services, { deckVersionId: versionId, expectedEditNumber: 2, clientRequestId: randomUUID() });
    await executeLessonGeneration(services, runId);

    const run = await readGeneration(services, runId);
    expect(run.state).toBe("failed");
    expect(run.errorCode).toBe("story_invalid");
    expect((await versionRow(versionId)).lesson_context.story).toEqual(previous);
  });

  it("malformed generated story fails with story_invalid", async () => {
    const { fakes, services, versionId, storyRunId } = await generatedGrammarLesson();
    fakes.llm.generateLessonStory = async () => ({
      story: { sentences: ["One.", "Two.", "Three.", "Four."], questions: [{ question: "?", options: ["a", "b", "c"], correctOptionIndex: 3 }] },
    });

    await executeLessonGeneration(services, storyRunId!);

    const run = await readGeneration(services, storyRunId!);
    expect(run.state).toBe("failed");
    expect(run.errorCode).toBe("story_invalid");
    expect((await versionRow(versionId)).lesson_context.story).toBeUndefined();
  });

  it("provider refusal fails story run without retry", async () => {
    const { fakes, services, storyRunId } = await generatedGrammarLesson();
    let calls = 0;
    fakes.llm.generateLessonStory = async () => {
      calls += 1;
      throw new GenerationProviderError("refusal");
    };

    await executeLessonGeneration(services, storyRunId!);
    await executeLessonGeneration(services, storyRunId!);

    const run = await readGeneration(services, storyRunId!);
    expect(run.state).toBe("failed");
    expect(run.errorCode).toBe("provider_refusal");
    expect(calls).toBe(1);
  });

  it("transient provider error requeues story run with nextAttemptAt", async () => {
    const { fakes, services, clock, versionId, storyRunId } = await generatedGrammarLesson();
    fakes.llm.generateLessonStory = async () => {
      throw new GenerationProviderError("transient");
    };

    await executeLessonGeneration(services, storyRunId!);

    const [run] = await storyRuns(versionId);
    expect(run!.state).toBe("queued");
    expect(run!.attempts).toBe(1);
    expect(run!.error_code).toBe("provider");
    expect(run!.next_attempt_at!.getTime()).toBeGreaterThan(clock.now().getTime());
  });

  describe("regenerateLessonStory", () => {
    it("published → immutable", async () => {
      const { services, deckId, versionId } = await generatedGrammarLesson();
      const draft = (await readLessonDeck(services, deckId)).draft!;
      await publishLessonDraft(services, versionId, draft.editNumber);
      await expect(regenerateLessonStory(services, {
        deckVersionId: versionId, expectedEditNumber: draft.editNumber, clientRequestId: randomUUID(),
      })).rejects.toMatchObject({ code: "immutable" });
    });

    it("wrong expectedEditNumber → conflict", async () => {
      const { services, versionId, storyRunId } = await generatedGrammarLesson();
      await executeLessonGeneration(services, storyRunId!);
      await expect(regenerateLessonStory(services, {
        deckVersionId: versionId, expectedEditNumber: 1, clientRequestId: randomUUID(),
      })).rejects.toMatchObject({ code: "conflict" });
    });

    it("active lesson run → conflict", async () => {
      const fakes = await fakeGeneration();
      disposers.push(fakes.dispose);
      const services = lessonServices(fakes);
      const { runId } = await createLesson(services, command());
      const versionId = (await readGeneration(services, runId)).deckVersionId!;
      await expect(regenerateLessonStory(services, {
        deckVersionId: versionId, expectedEditNumber: 1, clientRequestId: randomUUID(),
      })).rejects.toMatchObject({ code: "conflict" });
    });

    it("active story run → conflict", async () => {
      const { services, versionId } = await generatedGrammarLesson();
      await expect(regenerateLessonStory(services, {
        deckVersionId: versionId, expectedEditNumber: 2, clientRequestId: randomUUID(),
      })).rejects.toMatchObject({ code: "conflict" });
    });

    it("subject without lessonStory → validation", async () => {
      const { services, deckId, versionId } = await generatedSchoolLesson();
      const draft = (await readLessonDeck(services, deckId)).draft!;
      await expect(regenerateLessonStory(services, {
        deckVersionId: versionId, expectedEditNumber: draft.editNumber, clientRequestId: randomUUID(),
      })).rejects.toMatchObject({ code: "validation" });
    });

    it("same clientRequestId twice → same runId", async () => {
      const { services, deckId, versionId, storyRunId } = await generatedGrammarLesson();
      await executeLessonGeneration(services, storyRunId!);
      const clientRequestId = randomUUID();

      const first = await regenerateLessonStory(services, { deckVersionId: versionId, expectedEditNumber: 2, clientRequestId });
      const second = await regenerateLessonStory(services, { deckVersionId: versionId, expectedEditNumber: 2, clientRequestId });

      expect(second).toEqual(first);
      expect(first.deckId).toBe(deckId);
      const runs = await storyRuns(versionId);
      expect(runs.map((run) => run.id)).toEqual([storyRunId, first.runId]);
      expect(runs[1]).toMatchObject({ state: "queued", dedupe_key: `lesson-story:${clientRequestId}`, expected_edit_number: 2 });
      expect((await versionRow(versionId)).edit_number).toBe(2);
    });
  });

  it("retryGeneration of failed story run requeues without bumping editNumber", async () => {
    const { fakes, services, versionId, storyRunId } = await generatedGrammarLesson();
    const original = fakes.llm.generateLessonStory.bind(fakes.llm);
    fakes.llm.generateLessonStory = async () => {
      throw new GenerationProviderError("refusal");
    };
    await executeLessonGeneration(services, storyRunId!);
    expect((await readGeneration(services, storyRunId!)).state).toBe("failed");
    await editLessonDraft(services, versionId, { expectedEditNumber: 2, title: "Poprawka rodzica" });

    await retryGeneration(services, storyRunId!);

    const [run] = await storyRuns(versionId);
    expect(run).toMatchObject({ state: "queued", attempts: 0, error_code: null, next_attempt_at: null, expected_edit_number: 3 });
    expect((await versionRow(versionId)).edit_number).toBe(3);

    fakes.llm.generateLessonStory = original;
    await executeLessonGeneration(services, storyRunId!);
    expect((await readGeneration(services, storyRunId!)).state).toBe("succeeded");
    expect((await versionRow(versionId)).edit_number).toBe(3);
  });

  it("regenerateObjective is not blocked by a queued story run", async () => {
    const { services, deckId, versionId, storyRunId } = await generatedGrammarLesson();
    expect((await readGeneration(services, storyRunId!)).state).toBe("queued");

    const regen = await regenerateObjective(services, {
      deckId, objectiveId: OBJECTIVE, count: 4, expectedEditNumber: 2, clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, regen.runId);

    expect((await readGeneration(services, regen.runId)).state).toBe("succeeded");
    // Dogenerowanie nie anuluje runu historyjki.
    expect((await readGeneration(services, storyRunId!)).state).toBe("queued");
    expect((await versionRow(versionId)).edit_number).toBe(3);
  });
  /** Pełny run lekcji kończy się porażką (błąd konfiguracji providera): wersja bez ćwiczeń. */
  async function failedFullLesson() {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = lessonServices(fakes);
    const original = fakes.llm.generateLessonPool.bind(fakes.llm);
    fakes.llm.generateLessonPool = async () => {
      throw new GenerationProviderError("configuration", { status: 400 });
    };
    const { runId, deckId } = await createLesson(services, command());
    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("failed");
    fakes.llm.generateLessonPool = original;
    const versionId = (await readGeneration(services, runId)).deckVersionId!;
    return { fakes, services, lessonRunId: runId, deckId, versionId };
  }

  /** Run historyjki wstawiony wprost (stan, którego nie da się dziś osiągnąć przyciskiem bez puli). */
  async function insertQueuedStoryRun(versionId: string, deckId: string, editNumber: number): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into learning_app.generation_runs (id, deck_version_id, expected_edit_number, kind, dedupe_key, state, input)
       values ($1, $2, $3, 'lesson', $4, 'queued', $5::jsonb)`,
      [id, versionId, editNumber, `lesson-story:${randomUUID()}`, JSON.stringify({
        deckId, deckVersionId: versionId, subjectId: "english_grammar", topicId: "present_simple", topicVersion: 1,
        objectiveIds: [OBJECTIVE], poolSize: 20, material: "He plays football.", purpose: "story",
      })],
    );
    return id;
  }

  it("retrying a full run supersedes an active story run", async () => {
    const { services, lessonRunId, deckId, versionId } = await failedFullLesson();
    const staleStoryRunId = await insertQueuedStoryRun(versionId, deckId, 1);

    await retryGeneration(services, lessonRunId);

    expect((await readGeneration(services, staleStoryRunId)).state).toBe("superseded");
    await executeLessonGeneration(services, lessonRunId);
    expect((await readGeneration(services, lessonRunId)).state).toBe("succeeded");
    // Pełny run po ponowieniu zleca świeżą historyjkę do nowej puli.
    const active = (await storyRuns(versionId)).filter((run) => run.state === "queued");
    expect(active.map((run) => run.dedupe_key)).toEqual([`lesson-story:${lessonRunId}`]);
  });

  it("retrying a failed top-up run keeps the active story run", async () => {
    const { fakes, services, deckId, versionId, storyRunId } = await generatedGrammarLesson();
    const original = fakes.llm.generateLessonPool.bind(fakes.llm);
    fakes.llm.generateLessonPool = async () => {
      throw new GenerationProviderError("configuration", { status: 400 });
    };
    const regen = await regenerateObjective(services, {
      deckId, objectiveId: OBJECTIVE, count: 4, expectedEditNumber: 2, clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, regen.runId);
    expect((await readGeneration(services, regen.runId)).state).toBe("failed");
    fakes.llm.generateLessonPool = original;

    await retryGeneration(services, regen.runId);

    expect((await readGeneration(services, storyRunId!)).state).toBe("queued");
  });

  it("regenerateLessonStory rejects a version without exercises", async () => {
    const { services, versionId } = await failedFullLesson();
    await expect(regenerateLessonStory(services, {
      deckVersionId: versionId, expectedEditNumber: 1, clientRequestId: randomUUID(),
    })).rejects.toMatchObject({ code: "validation", message: expect.stringContaining("lesson has no exercises") });
    expect(await storyRuns(versionId)).toEqual([]);
  });

  it("retry of a running story run requeues without resetting attempts; the stale attempt cannot finalize", async () => {
    const { services, versionId, storyRunId } = await generatedGrammarLesson();
    // Worker przejął run i padł: run utknął w `running` z próbą 1.
    expect(await claimQueuedRun(db, storyRunId!)).toBe(1);
    await editLessonDraft(services, versionId, { expectedEditNumber: 2, title: "Poprawka rodzica" });

    await retryGeneration(services, storyRunId!);

    const [requeued] = await storyRuns(versionId);
    expect(requeued).toMatchObject({ state: "queued", attempts: 1, error_code: null, next_attempt_at: null, expected_edit_number: 3 });

    // Nowy claim podbija próby, więc CAS spóźnionego workera (próba 1) nic nie dopasuje.
    expect(await claimQueuedRun(db, storyRunId!)).toBe(2);
    const stale = await pool.query(
      "update learning_app.generation_runs set state = 'succeeded' where id = $1 and state = 'running' and attempts = 1",
      [storyRunId],
    );
    expect(stale.rowCount).toBe(0);

    await retryGeneration(services, storyRunId!);
    await executeLessonGeneration(services, storyRunId!);
    const [done] = await storyRuns(versionId);
    expect(done).toMatchObject({ state: "succeeded", attempts: 3 });
    expect((await versionRow(versionId)).lesson_context.story).toBeDefined();
  });

  it("retry of a deferred queued story run resets the attempt budget", async () => {
    const { fakes, services, versionId, storyRunId } = await generatedGrammarLesson();
    fakes.llm.generateLessonStory = async () => {
      throw new GenerationProviderError("transient");
    };
    await executeLessonGeneration(services, storyRunId!);
    const [deferred] = await storyRuns(versionId);
    expect(deferred).toMatchObject({ state: "queued", attempts: 1, error_code: "provider" });
    expect(deferred!.next_attempt_at).not.toBeNull();

    await retryGeneration(services, storyRunId!);

    const [reset] = await storyRuns(versionId);
    expect(reset).toMatchObject({ state: "queued", attempts: 0, error_code: null, next_attempt_at: null, expected_edit_number: 2 });
  });

  it("retry of a failed story run conflicts while another story run is active", async () => {
    const { fakes, services, versionId, storyRunId } = await generatedGrammarLesson();
    const original = fakes.llm.generateLessonStory.bind(fakes.llm);
    fakes.llm.generateLessonStory = async () => {
      throw new GenerationProviderError("refusal");
    };
    await executeLessonGeneration(services, storyRunId!);
    expect((await readGeneration(services, storyRunId!)).state).toBe("failed");
    fakes.llm.generateLessonStory = original;
    const { runId: activeRunId } = await regenerateLessonStory(services, {
      deckVersionId: versionId, expectedEditNumber: 2, clientRequestId: randomUUID(),
    });

    await expect(retryGeneration(services, storyRunId!)).rejects.toMatchObject({ code: "conflict" });
    expect((await readGeneration(services, storyRunId!)).state).toBe("failed");
    expect((await readGeneration(services, activeRunId)).state).toBe("queued");
  });
});
