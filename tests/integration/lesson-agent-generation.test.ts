import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimQueuedRun,
  createLesson,
  createLessonFromMaterial,
  createSchoolLesson,
  createServices,
  createSubjectRegistry,
  editLessonDraft,
  englishGrammarSubject,
  executeLessonGeneration,
  historyLikeSubject,
  retryGeneration,
  type GenerationDeps,
  type LessonAgentDeps,
  type Services,
} from "@learning/server";
import { lessonAgentDepsFromEnv } from "@learning/server/lesson-agent";
import type { LessonCommand } from "@learning/contracts";
import { testDatabase } from "./helpers";
import { ManualClock } from "./helpers";
import { fakeGeneration, type FakeGeneration } from "./fakes";
import type { LessonReviewReport } from "../../packages/server/src/domain/lessons/review-report";
import { GenerationProviderError } from "../../packages/server/src/ports/generation-error";
import { FakeLessonReviewer } from "../../packages/server/src/providers/fake";
import { FakeExerciseChecker, FakeLessonPoolAgent, type FakeLessonPoolAgentOptions } from "../../packages/server/src/providers/fake-lesson-agent";

import type { LessonExerciseDraft } from "../../packages/server/src/domain/lessons/types";
import { supersedeLessonRuns } from "../../packages/server/src/modules/materials/generation-runs";
import {
  emptyLessonAgentProgress,
  LessonAgentCheckpointLostError,
  parseLessonAgentProgress,
  saveLessonAgentCheckpoint,
  type LessonAgentProgress,
} from "../../packages/server/src/modules/materials/lessons/lesson-agent-checkpoint";
import { markLessonRun, type LessonRunIdentity } from "../../packages/server/src/modules/materials/lessons/lesson-drafts";

const { pool } = testDatabase();

const OBJECTIVE = "english_grammar.present_simple.third_person_s";

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

function lessonServices(fakes: FakeGeneration, clock = new ManualClock()): Services {
  const { db } = testDatabase();
  return createServices({
    db,
    clock,
    media: fakes.settings,
    generation: fakes.deps,
    subjects: createSubjectRegistry([englishGrammarSubject, historyLikeSubject]),
  });
}

function command(overrides: Partial<LessonCommand> = {}): LessonCommand {
  return {
    subjectId: "english_grammar",
    topicId: "present_simple",
    objectiveIds: [OBJECTIVE],
    material: "He plays football. She watches TV. They study English every day.",
    instruction: "Ćwicz -s w 3. osobie.",
    clientRequestId: randomUUID(),
    ...overrides,
  };
}

const exercise: LessonExerciseDraft = {
  exerciseType: "lesson_choice",
  objectiveId: OBJECTIVE,
  stem: "He ___ football.",
  answer: "plays",
  acceptedAnswers: ["plays"],
  focus: ["-s"],
  options: [{ id: "a", text: "plays" }, { id: "b", text: "play" }],
  correctOption: "a",
};

function progress(overrides: Partial<LessonAgentProgress> = {}): LessonAgentProgress {
  return {
    ...emptyLessonAgentProgress(),
    objectives: { [OBJECTIVE]: { status: "complete", exercises: [exercise], examples: ["He plays."] } },
    budgetSpentUsd: 0.4,
    totalSpentUsd: 0.7,
    rejectionCodes: { solver_mismatch: 1 },
    ...overrides,
  };
}

interface RunRow {
  state: string;
  attempts: number;
  expected_edit_number: number;
  deck_version_id: string;
  agent_checkpoint: unknown;
}

async function runRow(runId: string): Promise<RunRow> {
  const [row] = await query<RunRow>(
    "select state, attempts, expected_edit_number, deck_version_id, agent_checkpoint from learning_app.generation_runs where id = $1",
    [runId],
  );
  return row!;
}

/** Tożsamość bieżącej próby runu, tak jak widzi ją ścieżka wykonania po claimie. */
async function identityOf(runId: string): Promise<LessonRunIdentity> {
  const row = await runRow(runId);
  return { runId, attempts: row.attempts, expectedEditNumber: row.expected_edit_number, deckVersionId: row.deck_version_id };
}

/** Lekcja z runem puli przejętym przez worker (`running`, próba 1). */
async function runningLesson(services: Services): Promise<{ runId: string; deckVersionId: string; run: LessonRunIdentity }> {
  const { runId } = await createLesson(services, command());
  expect(await claimQueuedRun(services.db, runId)).toBe(1);
  const run = await identityOf(runId);
  return { runId, deckVersionId: run.deckVersionId, run };
}

describe("agent puli lekcji (integracja)", () => {
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

  async function setup(): Promise<Services> {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    return lessonServices(fakes);
  }

  describe("punkt kontrolny", () => {
    it("zapis przechodzi dla bieżącej próby", async () => {
      const services = await setup();
      const { runId, run } = await runningLesson(services);
      await saveLessonAgentCheckpoint(services.db, run, progress());
      expect(parseLessonAgentProgress((await runRow(runId)).agent_checkpoint, runId)).toEqual(progress());
      // cała wartość zastępuje poprzednią
      await saveLessonAgentCheckpoint(services.db, run, progress({ budgetSpentUsd: 0.5, totalSpentUsd: 0.8 }));
      expect((await runRow(runId)).agent_checkpoint).toMatchObject({ budgetSpentUsd: 0.5, totalSpentUsd: 0.8 });
    });

    it("odrzucony po edycji rodzica (superseded)", async () => {
      const services = await setup();
      const { runId, deckVersionId, run } = await runningLesson(services);
      await saveLessonAgentCheckpoint(services.db, run, progress());
      await editLessonDraft(services, deckVersionId, { expectedEditNumber: run.expectedEditNumber, examples: {} });
      expect((await runRow(runId)).state).toBe("superseded");
      await expect(saveLessonAgentCheckpoint(services.db, run, progress())).rejects.toBeInstanceOf(LessonAgentCheckpointLostError);
      expect((await runRow(runId)).agent_checkpoint).toBeNull();
    });

    it("odrzucony po podbiciu editNumber bez anulowania runów", async () => {
      const services = await setup();
      const { runId, deckVersionId, run } = await runningLesson(services);
      // nie każda zmiana szkicu anuluje runy (nadzór rodzica) — straż patrzy na numer edycji wersji
      await pool.query("update learning_app.deck_versions set edit_number = edit_number + 1 where id = $1", [deckVersionId]);
      await expect(saveLessonAgentCheckpoint(services.db, run, progress())).rejects.toBeInstanceOf(LessonAgentCheckpointLostError);
      const row = await runRow(runId);
      expect(row.state).toBe("running");
      expect(row.agent_checkpoint).toBeNull();
    });

    it("odrzucony dla starej próby (inne attempts)", async () => {
      const services = await setup();
      const { runId, run: first } = await runningLesson(services);
      await markLessonRun(services.db, services.clock, first, "queued", "provider");
      expect(await claimQueuedRun(services.db, runId)).toBe(2);
      await expect(saveLessonAgentCheckpoint(services.db, first, progress())).rejects.toBeInstanceOf(LessonAgentCheckpointLostError);
      expect((await runRow(runId)).agent_checkpoint).toBeNull();
      await saveLessonAgentCheckpoint(services.db, await identityOf(runId), progress());
      expect((await runRow(runId)).agent_checkpoint).not.toBeNull();
    });

    it("supersedeLessonRuns zeruje kolumnę", async () => {
      const services = await setup();
      const { runId, deckVersionId, run } = await runningLesson(services);
      await saveLessonAgentCheckpoint(services.db, run, progress());
      await supersedeLessonRuns(services.db, deckVersionId, services.clock.now());
      const row = await runRow(runId);
      expect(row.state).toBe("superseded");
      expect(row.agent_checkpoint).toBeNull();
    });

    it("markLessonRun superseded zeruje kolumnę", async () => {
      const services = await setup();
      const { runId, run } = await runningLesson(services);
      await saveLessonAgentCheckpoint(services.db, run, progress());
      await markLessonRun(services.db, services.clock, run, "superseded", null);
      const row = await runRow(runId);
      expect(row.state).toBe("superseded");
      expect(row.agent_checkpoint).toBeNull();
    });

    it("markLessonRun failed zostawia postęp do „Ponów”", async () => {
      const services = await setup();
      const { runId, run } = await runningLesson(services);
      await saveLessonAgentCheckpoint(services.db, run, progress());
      await markLessonRun(services.db, services.clock, run, "failed", "provider");
      expect(parseLessonAgentProgress((await runRow(runId)).agent_checkpoint, runId)).toEqual(progress());
    });

    it("Ponów: porażka, running i odroczone queued — postęp zostaje, budżet 0, totalSpentUsd bez zmian", async () => {
      const services = await setup();
      const expected = progress({ budgetSpentUsd: 0 });

      // porażka
      const failed = await runningLesson(services);
      await saveLessonAgentCheckpoint(services.db, failed.run, progress());
      await markLessonRun(services.db, services.clock, failed.run, "failed", "provider");
      await retryGeneration(services, failed.runId);
      expect((await runRow(failed.runId)).state).toBe("queued");
      expect(parseLessonAgentProgress((await runRow(failed.runId)).agent_checkpoint, failed.runId)).toEqual(expected);

      // running po awarii workera
      const running = await runningLesson(services);
      await saveLessonAgentCheckpoint(services.db, running.run, progress());
      await retryGeneration(services, running.runId);
      expect((await runRow(running.runId)).state).toBe("queued");
      expect(parseLessonAgentProgress((await runRow(running.runId)).agent_checkpoint, running.runId)).toEqual(expected);
      // spóźniony worker starej próby nie nadpisze punktu kontrolnego
      await expect(saveLessonAgentCheckpoint(services.db, running.run, progress())).rejects.toBeInstanceOf(LessonAgentCheckpointLostError);

      // odroczone queued (automatyczne ponowienie z opóźnieniem)
      const deferred = await runningLesson(services);
      await saveLessonAgentCheckpoint(services.db, deferred.run, progress());
      await markLessonRun(services.db, services.clock, deferred.run, "queued", "provider", new Date(services.clock.now().getTime() + 60_000));
      await retryGeneration(services, deferred.runId);
      const deferredRow = await runRow(deferred.runId);
      expect(deferredRow.state).toBe("queued");
      expect(deferredRow.attempts).toBe(0);
      expect(parseLessonAgentProgress(deferredRow.agent_checkpoint, deferred.runId)).toEqual(expected);
    });

    it("Ponów: run bez punktu kontrolnego zostaje bez niego", async () => {
      const services = await setup();
      const { runId, run } = await runningLesson(services);
      await markLessonRun(services.db, services.clock, run, "failed", "provider");
      await retryGeneration(services, runId);
      const row = await runRow(runId);
      expect(row.state).toBe("queued");
      expect(row.agent_checkpoint).toBeNull();
    });
  });

  describe("ścieżka agenta w executeLessonGeneration", () => {
    const NEGATIVE = "english_grammar.present_simple.negative";
    const CHAPTER_MATERIAL = [
      "Słowa:",
      "coat — płaszcz",
      "boots — buty",
      "scarf — szalik",
      "gloves — rękawiczki",
      "Zwroty:",
      "I am wearing …",
      "Put on your …",
    ].join("\n");
    const SCHOOL_MATERIAL = [
      "Zagadnienie 1: Rzeki Polski",
      "Wisła jest najdłuższą rzeką Polski. Odra płynie na zachodzie kraju.",
      "Zagadnienie 2: Góry Polski",
      "Tatry są najwyższymi górami Polski. Sudety leżą na południowym zachodzie.",
    ].join("\n");
    const PRESET_REVIEW: LessonReviewReport = {
      status: "reviewed",
      model: "fake-reviewer-1",
      objectives: [],
      changed: [],
      dropped: [],
      notes: [],
      toppedUp: [],
      machine: [],
    };

    interface AgentWorld {
      fakes: FakeGeneration;
      services: Services;
      agent: FakeLessonPoolAgent;
      reviewer: FakeLessonReviewer;
      clock: ManualClock;
    }

    function servicesWith(fakes: FakeGeneration, generation: GenerationDeps, clock: ManualClock): Services {
      return createServices({ db: testDatabase().db, clock, media: fakes.settings, generation });
    }

    /** Produkcyjny rejestr, fake LLM, fake agenta (domyślnie „jak LLM”), checker niedostępny, gotowy krytyk. */
    async function agentWorld(subjects: string[], agentOptions: Omit<FakeLessonPoolAgentOptions, "fromLlm"> = {}): Promise<AgentWorld> {
      const fakes = await fakeGeneration();
      disposers.push(fakes.dispose);
      const agent = new FakeLessonPoolAgent({ fromLlm: fakes.llm, ...agentOptions });
      const lessonAgent: LessonAgentDeps = {
        subjects: new Set(subjects),
        agent,
        checker: new FakeExerciseChecker({ unavailable: true }),
        policy: {},
      };
      const reviewer = new FakeLessonReviewer();
      fakes.deps.reviewer = {
        state: "ready",
        provider: reviewer,
        policy: { timeoutMs: 60_000, concurrency: 3, maxCallsPerRun: 12, phaseBudgetMs: 240_000 },
      };
      fakes.deps.lessonAgent = lessonAgent;
      const clock = new ManualClock();
      return { fakes, services: servicesWith(fakes, fakes.deps, clock), agent, reviewer, clock };
    }

    interface VersionRow {
      id: string;
      edit_number: number;
      state: string;
      lesson_context: Record<string, unknown>;
    }

    interface FullRunRow extends RunRow {
      error_code: string | null;
      next_attempt_at: Date | null;
    }

    async function fullRun(runId: string): Promise<FullRunRow> {
      const [row] = await query<FullRunRow>(
        "select state, attempts, expected_edit_number, deck_version_id, agent_checkpoint, error_code, next_attempt_at from learning_app.generation_runs where id = $1",
        [runId],
      );
      return row!;
    }

    async function versionOf(runId: string): Promise<VersionRow> {
      const [row] = await query<VersionRow>(
        `select v.id, v.edit_number, v.state, v.lesson_context from learning_app.deck_versions v
         join learning_app.generation_runs r on r.deck_version_id = v.id where r.id = $1`,
        [runId],
      );
      return row!;
    }

    async function exerciseCount(versionId: string): Promise<number> {
      const [row] = await query<{ count: string }>("select count(*) from learning_app.item_revisions where deck_version_id = $1", [versionId]);
      return Number(row!.count);
    }

    async function setCheckpoint(runId: string, value: unknown): Promise<void> {
      await pool.query("update learning_app.generation_runs set agent_checkpoint = $1::jsonb where id = $2", [JSON.stringify(value), runId]);
    }

    async function setContextField(versionId: string, field: string, value: unknown): Promise<void> {
      await pool.query(
        "update learning_app.deck_versions set lesson_context = jsonb_set(lesson_context, $1::text[], $2::jsonb) where id = $3",
        [[field], JSON.stringify(value), versionId],
      );
    }

    async function storyRunStates(versionId: string): Promise<string[]> {
      const rows = await query<{ state: string }>(
        "select state from learning_app.generation_runs where deck_version_id = $1 and input->>'purpose' = 'story'",
        [versionId],
      );
      return rows.map((row) => row.state);
    }

    function expectSummaryWithoutContent(checkpoint: unknown, attempts: number): void {
      const summary = checkpoint as { kind: string; objectives: Record<string, Record<string, unknown>>; attempts: number };
      expect(summary.kind).toBe("summary");
      expect(summary.attempts).toBe(attempts);
      expect(Object.keys(summary).sort()).toEqual(["attempts", "kind", "objectives", "rejectionCodes", "totalSpentUsd", "version"]);
      for (const entry of Object.values(summary.objectives)) {
        for (const key of Object.keys(entry)) expect(["status", "accepted", "failureCode"]).toContain(key);
      }
    }

    it("rozdział: planer → szkic, dynamicTopic, przykłady, editNumber+1, podsumowanie bez treści, krytyk nie wołany i jego raport bez zmian", async () => {
      const { fakes, services, agent, reviewer } = await agentWorld(["english_chapter"]);
      const { runId, deckId } = await createLessonFromMaterial(services, {
        subjectId: "english_chapter",
        topicTitlePl: "Unit 1",
        material: CHAPTER_MATERIAL,
        poolSize: 40,
        clientRequestId: randomUUID(),
      });
      const before = await versionOf(runId);
      await setContextField(before.id, "review", PRESET_REVIEW);

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("succeeded");
      expect(agent.planCalls).toHaveLength(1);
      expect(fakes.llm.lessonRequests.length).toBeGreaterThan(0);
      const after = await versionOf(runId);
      expect(after.edit_number).toBe(before.edit_number + 1);
      expect(after.state).toBe("review");
      expect(await exerciseCount(after.id)).toBeGreaterThan(0);
      const context = after.lesson_context as {
        dynamicTopic: { objectives: { id: string; kind?: string }[] };
        objectiveIds: string[];
        examples: Record<string, string[]>;
        review: unknown;
      };
      const objectiveIds = context.dynamicTopic.objectives.map((objective) => objective.id);
      expect(objectiveIds).toEqual([1, 2, 3].map((n) => `english_chapter.d${deckId}.part_${n}`));
      expect(context.dynamicTopic.objectives.map((objective) => objective.kind)).toEqual(["words", "words", "frame"]);
      expect(context.objectiveIds).toEqual(objectiveIds);
      for (const id of objectiveIds) expect(context.examples[id]!.length).toBeGreaterThan(0);
      // Krytyk nie jest wołany na ścieżce agenta, a raport w kontekście zostaje bez zmian.
      expect(reviewer.inputs).toEqual([]);
      expect(context.review).toEqual(PRESET_REVIEW);
      expectSummaryWithoutContent(row.agent_checkpoint, 1);
      // Rozdział nie ma historyjki — kolejkę historyjki sprawdza test gramatyki (przedmiot z `lessonStory`).
      expect(await storyRunStates(after.id)).toEqual([]);
    });

    it("gramatyka (katalog) i szkoła (etap zagadnień z fake LLM)", async () => {
      const { fakes, services, agent } = await agentWorld(["english_grammar", "school"]);

      const grammar = await createLesson(services, command());
      await executeLessonGeneration(services, grammar.runId);
      const grammarRow = await fullRun(grammar.runId);
      expect(grammarRow.state).toBe("succeeded");
      // Temat katalogu zawężony do zagadnień lekcji: tylko wybrane zagadnienie, nie cały temat.
      expect(agent.calls.map((call) => call.objectiveId)).toEqual([OBJECTIVE]);
      const grammarVersion = await versionOf(grammar.runId);
      const objectiveRows = await query<{ objective_id: string }>(
        "select payload->>'objectiveId' as objective_id from learning_app.item_revisions where deck_version_id = $1",
        [grammarVersion.id],
      );
      expect(objectiveRows.length).toBeGreaterThan(0);
      expect(new Set(objectiveRows.map((item) => item.objective_id))).toEqual(new Set([OBJECTIVE]));
      expectSummaryWithoutContent(grammarRow.agent_checkpoint, 1);
      // Nowa pula przedmiotu z historyjką zleca run historyjki (wspólny zapis).
      expect(await storyRunStates(grammarVersion.id)).toEqual(["queued"]);

      const school = await createSchoolLesson(services, {
        subjectTitlePl: "Geografia",
        topicTitlePl: "Polska",
        material: SCHOOL_MATERIAL,
        poolSize: 40,
        clientRequestId: randomUUID(),
      });
      await executeLessonGeneration(services, school.runId);
      const schoolRow = await fullRun(school.runId);
      expect(schoolRow.state).toBe("succeeded");
      expect(fakes.llm.objectiveRequests).toHaveLength(1);
      const schoolVersion = await versionOf(school.runId);
      const schoolContext = schoolVersion.lesson_context as { dynamicTopic: { objectives: { id: string }[] }; objectiveIds: string[] };
      expect(schoolContext.dynamicTopic.objectives).toHaveLength(2);
      for (const id of schoolContext.objectiveIds) expect(id.startsWith(`school.d${school.deckId}.`)).toBe(true);
      expect(await exerciseCount(schoolVersion.id)).toBeGreaterThan(0);
      expectSummaryWithoutContent(schoolRow.agent_checkpoint, 1);
    });

    it("zero przyjętych → failed validation, liczniki w kontekście", async () => {
      const { services } = await agentWorld(["english_grammar"], { objectives: { third_person_s: [] } });
      const { runId } = await createLesson(services, command());
      const before = await versionOf(runId);
      // Wcześniejsza próba usunęła 2 ćwiczenia po przyjęciu (bezpiecznik); ta nic nie przyjmuje.
      await setCheckpoint(runId, { ...emptyLessonAgentProgress(), removedAfterAcceptance: 2, budgetSpentUsd: 0.1, totalSpentUsd: 0.1 });

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("failed");
      expect(row.error_code).toBe("validation");
      const after = await versionOf(runId);
      expect(after.edit_number).toBe(before.edit_number);
      expect(await exerciseCount(after.id)).toBe(0);
      expect((after.lesson_context as { rejectedCount: number }).rejectedCount).toBe(
        ((before.lesson_context as { rejectedCount?: number }).rejectedCount ?? 0) + 2,
      );
      // Postęp zostaje do „Ponów” (z wpisem zagadnienia tej próby).
      const progressAfter = parseLessonAgentProgress(row.agent_checkpoint, runId);
      expect(progressAfter?.objectives[OBJECTIVE]?.status).toBe("incomplete");
      expect(progressAfter?.removedAfterAcceptance).toBe(2);
    });

    it("wszystkie zagadnienia provider_configuration → failed provider_configuration bez ponowienia", async () => {
      const refused = () => [{ throw: new GenerationProviderError("configuration", { status: 401 }) }];
      const { services, agent } = await agentWorld(["english_grammar"], { objectives: { third_person_s: refused(), negative: refused() } });
      const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("failed");
      expect(row.error_code).toBe("provider_configuration");
      expect(row.attempts).toBe(1);
      expect(row.next_attempt_at).toBeNull();
      expect(agent.calls).toHaveLength(2);
      expect(Object.values(parseLessonAgentProgress(row.agent_checkpoint, runId)!.objectives).map((entry) => entry.failureCode)).toEqual([
        "provider_configuration",
        "provider_configuration",
      ]);
    });

    it("uszkodzony punkt kontrolny → start od zera", async () => {
      const { services, agent } = await agentWorld(["english_grammar", "english_chapter"]);
      // Zła obwiednia.
      const grammar = await createLesson(services, command());
      await setCheckpoint(grammar.runId, { version: 1, kind: "progress", objectives: "x" });
      await executeLessonGeneration(services, grammar.runId);
      expect((await fullRun(grammar.runId)).state).toBe("succeeded");
      expect(agent.calls.map((call) => call.objectiveId)).toEqual([OBJECTIVE]);

      // Dobra obwiednia, temat łamiący reguły katalogu → planer od zera.
      const chapter = await createLessonFromMaterial(services, {
        subjectId: "english_chapter",
        topicTitlePl: "Unit 1",
        material: CHAPTER_MATERIAL,
        poolSize: 40,
        clientRequestId: randomUUID(),
      });
      await setCheckpoint(chapter.runId, { ...emptyLessonAgentProgress(), dynamicTopic: { titlePl: "", objectives: [] } });
      await executeLessonGeneration(services, chapter.runId);
      expect((await fullRun(chapter.runId)).state).toBe("succeeded");
      expect(agent.planCalls).toHaveLength(1);
    });

    it("przełączenie przedmiotu na potok między próbami → potok ignoruje postęp, pełny zapis usuwa generationGaps", async () => {
      const transient = { calls: [[{ throw: new GenerationProviderError("transient") }]] };
      const { fakes, services, agent, clock } = await agentWorld(["english_grammar"], { objectives: { third_person_s: transient } });
      const { runId } = await createLesson(services, command());

      await executeLessonGeneration(services, runId);
      const requeued = await fullRun(runId);
      expect(requeued.state).toBe("queued");
      expect(requeued.error_code).toBe("provider");
      expect(requeued.next_attempt_at).not.toBeNull();
      const saved = parseLessonAgentProgress(requeued.agent_checkpoint, runId);
      expect(saved?.objectives[OBJECTIVE]?.status).toBe("failed");
      expect(fakes.llm.lessonRequests).toHaveLength(0);

      const version = await versionOf(runId);
      await setContextField(version.id, "generationGaps", [{ objectiveId: OBJECTIVE, reason: "failed" }]);
      // Konfiguracja bez agenta: kolejna próba idzie potokiem.
      const pipelineServices = servicesWith(fakes, { ...fakes.deps, lessonAgent: undefined }, clock);
      clock.advanceMs(10 * 60_000);
      await executeLessonGeneration(pipelineServices, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("succeeded");
      expect(row.attempts).toBe(2);
      expect(agent.calls).toHaveLength(1);
      expect(fakes.llm.lessonRequests.length).toBeGreaterThan(0);
      // Potok nie czyta ani nie zapisuje punktu kontrolnego.
      expect(parseLessonAgentProgress(row.agent_checkpoint, runId)).toEqual(saved);
      const after = await versionOf(runId);
      expect(after.lesson_context).not.toHaveProperty("generationGaps");
      expect(await exerciseCount(after.id)).toBeGreaterThan(0);
    });

    it("przedmiot spoza listy → potok bez zmian (fake LLM wołany, agent nie)", async () => {
      const { fakes, services, agent } = await agentWorld(["english_chapter"]);
      const { runId } = await createLesson(services, command());

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("succeeded");
      expect(row.agent_checkpoint).toBeNull();
      expect(agent.calls).toEqual([]);
      expect(agent.planCalls).toEqual([]);
      expect(fakes.llm.lessonRequests.length).toBeGreaterThan(0);
    });

    it("potok: attempts > MAX przy złożonym agencie i przedmiocie spoza listy → attempts_exhausted bez wywołań", async () => {
      const { fakes, services, agent } = await agentWorld(["english_chapter"]);
      const { runId } = await createLesson(services, command());
      await pool.query("update learning_app.generation_runs set attempts = 3 where id = $1", [runId]);

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("failed");
      expect(row.error_code).toBe("attempts_exhausted");
      expect(row.attempts).toBe(4);
      expect(fakes.llm.lessonRequests).toEqual([]);
      expect(agent.calls).toEqual([]);
    });

    it("składanie z env: lessonAgentDepsFromEnv(UMIEM_FAKE_PROVIDERS=1 + lista) → pełna generacja ścieżką agenta", async () => {
      const fakes = await fakeGeneration();
      disposers.push(fakes.dispose);
      const registry = createSubjectRegistry([englishGrammarSubject, historyLikeSubject]);
      const lessonAgent = lessonAgentDepsFromEnv(
        { UMIEM_FAKE_PROVIDERS: "1", UMIEM_LESSON_AGENT_SUBJECTS: "english_grammar" },
        registry,
        undefined,
        fakes.llm,
      );
      expect(lessonAgent?.subjects).toEqual(new Set(["english_grammar"]));
      const services = createServices({
        db: testDatabase().db,
        clock: new ManualClock(),
        media: fakes.settings,
        generation: { ...fakes.deps, lessonAgent },
        subjects: registry,
      });
      const { runId } = await createLesson(services, command());

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("succeeded");
      // Podsumowanie punktu kontrolnego zapisuje tylko ścieżka agenta.
      expectSummaryWithoutContent(row.agent_checkpoint, 1);
      expect(fakes.llm.lessonRequests.length).toBeGreaterThan(0);
      expect(await exerciseCount((await versionOf(runId)).id)).toBeGreaterThan(0);
    });

    it("rejectedCount = usunięcia po przyjęciu, nie odrzucenia w pętli", async () => {
      // Zagadnienie B: w próbie 1 błąd przejściowy, w próbie 2 tylko ćwiczenie o złym kształcie (odrzucenie w pętli).
      const malformed = [{ submit: { exercises: [{ exerciseType: "lesson_choice", objectiveId: NEGATIVE }] } }];
      const negative = { calls: [[{ throw: new GenerationProviderError("transient") }], malformed] };
      const { services, clock } = await agentWorld(["english_grammar"], { objectives: { negative } });
      const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
      const before = await versionOf(runId);
      await executeLessonGeneration(services, runId);
      const first = await fullRun(runId);
      expect(first.state).toBe("queued");
      const firstProgress = parseLessonAgentProgress(first.agent_checkpoint, runId)!;
      const own = firstProgress.objectives[OBJECTIVE]!;
      expect(own.exercises.length).toBeGreaterThan(0);
      // Punkt kontrolny jak po migawce sprzed bezpiecznika: zagadnienie A gotowe z duplikatem ćwiczenia
      // i 2 usunięcia bezpiecznika kierownika we wcześniejszych próbach.
      await setCheckpoint(runId, {
        ...firstProgress,
        objectives: { [OBJECTIVE]: { ...own, status: "complete", exercises: [...own.exercises, own.exercises[0]] } },
        removedAfterAcceptance: 2,
      });
      clock.advanceMs(10 * 60_000);

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("succeeded");
      const after = await versionOf(runId);
      expect(await exerciseCount(after.id)).toBe(own.exercises.length);
      const context = after.lesson_context as { rejectedCount: number; generationGaps?: unknown };
      // 2 (bezpiecznik) + 1 (kontrola końcowa: duplikat); odrzucenie w pętli się nie liczy.
      expect(context.rejectedCount).toBe(((before.lesson_context as { rejectedCount?: number }).rejectedCount ?? 0) + 3);
      expect(context.generationGaps).toEqual([{ objectiveId: NEGATIVE, reason: "incomplete" }]);
      const summary = row.agent_checkpoint as { rejectionCodes: Record<string, number> };
      expect(Object.values(summary.rejectionCodes).reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(1);
    });

    it("podsumowanie punktu kontrolnego wycofane razem z nieudanym zapisem końcowym", async () => {
      const { services } = await agentWorld(["english_grammar"]);
      const { runId } = await createLesson(services, command());
      const before = await versionOf(runId);
      // Awaria transakcji końcowej PO zapisie podsumowania (podbicie numeru edycji).
      await pool.query(`create or replace function learning_app.test_fail_edit_number() returns trigger language plpgsql as $$
        begin raise exception 'test: final write failed'; end $$`);
      await pool.query(`create trigger test_fail_edit_number before update of edit_number on learning_app.deck_versions
        for each row execute function learning_app.test_fail_edit_number()`);
      try {
        await executeLessonGeneration(services, runId);
      } finally {
        await pool.query("drop trigger if exists test_fail_edit_number on learning_app.deck_versions");
        await pool.query("drop function if exists learning_app.test_fail_edit_number()");
      }

      const row = await fullRun(runId);
      expect(row.state).toBe("queued");
      // Podsumowanie wycofane: zostaje postęp (z ćwiczeniami) do kolejnej próby.
      const progressAfter = parseLessonAgentProgress(row.agent_checkpoint, runId);
      expect(progressAfter?.objectives[OBJECTIVE]?.exercises.length).toBeGreaterThan(0);
      const after = await versionOf(runId);
      expect(after.edit_number).toBe(before.edit_number);
      expect(await exerciseCount(after.id)).toBe(0);
      expect(after.lesson_context).toEqual(before.lesson_context);
    });
  });
});
