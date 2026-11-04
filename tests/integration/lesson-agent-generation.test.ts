import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimQueuedRun,
  createLesson,
  createServices,
  createSubjectRegistry,
  editLessonDraft,
  englishGrammarSubject,
  historyLikeSubject,
  retryGeneration,
  type Services,
} from "@learning/server";
import type { LessonCommand } from "@learning/contracts";
import { testDatabase } from "./helpers";
import { ManualClock } from "./helpers";
import { fakeGeneration, type FakeGeneration } from "./fakes";

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
});
