import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptVerdictAsVariant,
  claimQueuedRun,
  createDrizzleUsageRecorder,
  createLesson,
  createLessonFromMaterial,
  createSchoolLesson,
  createServices,
  createProductionSubjectRegistry,
  createSubjectRegistry,
  editLessonDraft,
  englishGrammarSubject,
  executeLessonGeneration,
  historyLikeSubject,
  isLessonAgentAvailable,
  publishLessonDraft,
  readLessonDeck,
  regenerateObjective,
  retryGeneration,
  runDueGenerationWork,
  type GenerationDeps,
  type LessonAgentDeps,
  type Services,
} from "@learning/server";
import { lessonAgentDepsFromEnv } from "@learning/server/lesson-agent";
import type { LessonCommand, LessonDraftDto } from "@learning/contracts";
import { testDatabase } from "./helpers";
import { ManualClock } from "./helpers";
import { everyPacket, fakeGeneration, gate, type FakeGeneration, type Gate } from "./fakes";
import { messages } from "@learning/contracts";
import { fakePacketExercises } from "../../packages/server/src/providers/fake-lesson-pool";
import { GenerationProviderError } from "../../packages/server/src/ports/generation-error";
import {
  FakeExerciseChecker,
  FakeLessonPoolAgent,
  type FakeLessonPoolAgentOptions,
  type FakePacketStep,
} from "../../packages/server/src/providers/fake-lesson-agent";
import type { ClosedCheckInput, LessonPacketInput, RunCostSink } from "../../packages/server/src/ports/ai";
import {
  DEFAULT_LESSON_GENERATION_POLICY,
  type LessonGenerationPolicy,
} from "../../packages/server/src/modules/materials/lessons/lesson-generation-policy";

import type { LessonExerciseDraft } from "../../packages/server/src/domain/lessons/types";
import { packetPlan, packetPlanForTargets, PACKET_RESERVE } from "../../packages/server/src/domain/lessons/packet-plan";
import { stageOf } from "../../packages/server/src/domain/lessons/stages";
import { solvedSentencesOf } from "../../packages/server/src/domain/lessons/story";
import { supersedeLessonRuns } from "../../packages/server/src/modules/materials/generation-runs";
import {
  emptyLessonAgentProgress,
  LessonAgentCheckpointLostError,
  parseLessonAgentProgress,
  saveLessonAgentCheckpoint,
  type LessonAgentProgress,
} from "../../packages/server/src/modules/materials/lessons/lesson-agent-checkpoint";
import { lessonCatalogTopic } from "../../packages/server/src/modules/materials/lessons/lesson-agent-outcome";
import {
  listenChoiceAllowance,
  markLessonRun,
  objectiveBatchCounts,
  orderedDraftExercises,
  poolStageCounts,
  type LessonRunIdentity,
} from "../../packages/server/src/modules/materials/lessons/lesson-drafts";

const { pool } = testDatabase();

const OBJECTIVE = "english_grammar.present_simple.third_person_s";

/** Przedmioty produkcyjne (wszystkie na przebiegu bazowym) i przedmiot testowy historii. */
const subjectRegistry = () => createSubjectRegistry([...createProductionSubjectRegistry().listSubjects(), historyLikeSubject]);

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
    subjects: subjectRegistry(),
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

describe("pula lekcji na ścieżce workera (integracja)", () => {
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

  describe("przebieg bazowy w executeLessonGeneration", () => {
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

    interface AgentWorld {
      fakes: FakeGeneration;
      services: Services;
      agent: FakeLessonPoolAgent;
      clock: ManualClock;
    }

    function servicesWith(fakes: FakeGeneration, generation: GenerationDeps, clock: ManualClock): Services {
      return createServices({ subjects: subjectRegistry(), db: testDatabase().db, clock, media: fakes.settings, generation });
    }

    /** Scenariusze paczek fake'a per slug zagadnienia; paczki bez kroku zwracają wynik generatora fake'a. */
    type Packets = NonNullable<FakeLessonPoolAgentOptions["packets"]>;

    interface WorldOptions {
      readonly policy?: LessonAgentDeps["policy"];
      readonly finalizationReserveMs?: number;
      readonly execution?: Partial<LessonGenerationPolicy>;
      /** Kontrola zamkniętych zamiast domyślnej (klucz fake'a z widoku). */
      readonly checker?: FakeExerciseChecker;
    }

    /**
     * Produkcyjny rejestr (wszystkie przedmioty na przebiegu bazowym), fake paczek (domyślnie generator fake'a),
     * kontrola zamkniętych fake'a. Kontroler sprawdza bieżącość próby co 20 ms (edycja i „Ponów” w trakcie
     * przerywają próbę od razu).
     */
    async function agentWorld(agentOptions: FakeLessonPoolAgentOptions = {}, world: WorldOptions = {}): Promise<AgentWorld> {
      const fakes = await fakeGeneration({ agent: agentOptions });
      disposers.push(fakes.dispose);
      const { agent } = fakes;
      const lessonAgent: LessonAgentDeps = {
        agent,
        checker: world.checker ?? new FakeExerciseChecker(),
        policy: world.policy ?? {},
        ...(world.finalizationReserveMs === undefined ? {} : { finalizationReserveMs: world.finalizationReserveMs }),
      };
      fakes.deps.lessonExecution = { ...DEFAULT_LESSON_GENERATION_POLICY, cancelPollMs: 20, ...world.execution };
      fakes.deps.lessonAgent = lessonAgent;
      const clock = new ManualClock();
      return { fakes, services: servicesWith(fakes, fakes.deps, clock), agent, clock };
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

    /** Przejściowy błąd dostawcy (ponawialny, kod `provider`). */
    const transient = (): FakePacketStep => ({ throw: new GenerationProviderError("transient") });

    /** Paczka, w której model nie zwrócił żadnego ćwiczenia. */
    const EMPTY: FakePacketStep = { build: () => ({ exercises: [] }) };

    /** Wywołanie „w locie”, które kończy tylko przerwanie sygnału. */
    const never = (): FakePacketStep => ({ gate: new Promise<void>(() => undefined) });

    /** Wywołania paczek zagadnienia o slugu `slug` od startu świata. */
    const packetCallsOf = (agent: FakeLessonPoolAgent, slug: string) => agent.packetCalls.filter((call) => slugOf(call.objective.id) === slug);

    /** Kroki od następnego wywołania paczek slugu: wcześniejsze wywołania zużyły już swoje indeksy kroków. */
    function fromNextCall(agent: FakeLessonPoolAgent, slug: string, steps: readonly FakePacketStep[]): FakePacketStep[] {
      const used = packetCallsOf(agent, slug).length;
      const next: FakePacketStep[] = [];
      steps.forEach((step, index) => {
        next[used + index] = step;
      });
      return next;
    }

    /** Pasma numeracji kroków `generatorStep` (fake numeruje swoje paczki od 0 co 1000 — bez kolizji odpowiedzi). */
    let band = 500_000;

    /**
     * Paczka z wynikiem generatora fake'a w osobnym paśmie numeracji (`count` razy `scale`), przekształconym
     * przez `edit` (np. wybór po typie paczki).
     */
    function generatorStep(
      edit: (exercises: Record<string, unknown>[], input: LessonPacketInput) => unknown[] = (exercises) => exercises,
      scale = 1,
    ): FakePacketStep {
      return {
        build: (input) => {
          band += 1000;
          const result = fakePacketExercises({ ...input, count: input.count * scale }, band);
          return { exercises: edit(result.exercises, input), ...(result.examples === undefined ? {} : { examples: result.examples }) };
        },
      };
    }

    /**
     * Liczba paczek zagadnień pełnej generacji gramatyki (plan przebiegu bazowego dla zagadnień i puli runu);
     * każda paczka to jedno wywołanie generatora, ponowienie błędu technicznego — drugie.
     */
    async function plannedPackets(runId: string): Promise<Record<string, number>> {
      const [row] = await query<{ input: { objectiveIds: string[]; poolSize: number } }>(
        "select input from learning_app.generation_runs where id = $1",
        [runId],
      );
      const subject = englishGrammarSubject;
      const topic = lessonCatalogTopic(subject.topics.find((item) => item.id === "present_simple")!, row!.input.objectiveIds);
      const counts = objectiveBatchCounts(row!.input.poolSize, topic.objectives.length, subject);
      return Object.fromEntries(
        topic.objectives.map((objective, index) => [
          objective.id,
          packetPlan(subject, objective, poolStageCounts(subject, objective.exerciseTypes, counts[index]!), listenChoiceAllowance(subject, objective, [])).packets.length,
        ]),
      );
    }

    /**
     * Kontrola zamkniętych fake'a, której jedno wywołanie po `hold(gate)` czeka na bramkę — wywołanie „w locie”
     * po wygenerowaniu paczek (paczka z własnym wynikiem nie ma kroku `gate`).
     */
    class HeldChecker extends FakeExerciseChecker {
      private held: Gate | undefined;

      hold(held: Gate): void {
        this.held = held;
      }

      override async checkClosed(input: ClosedCheckInput, cost: RunCostSink, signal: AbortSignal): Promise<{ results: unknown[] }> {
        const held = this.held;
        this.held = undefined;
        if (held !== undefined && "gate" in held.step) {
          held.step.onReached?.();
          await held.step.gate;
        }
        return super.checkClosed(input, cost, signal);
      }
    }

    /** Ponowienie z opóźnieniem wymagalne od razu (kolejne przejęcie bez czekania na zegar). */
    async function dueNow(runId: string): Promise<void> {
      await pool.query("update learning_app.generation_runs set next_attempt_at = null where id = $1", [runId]);
    }

    /** Wyzwalacz `before <on>` z ciałem plpgsql `body` na czas `work`, sprzątany po nim. */
    async function withFailingUpdate(on: string, body: string, work: () => Promise<unknown>): Promise<void> {
      await pool.query(`create or replace function learning_app.test_fail_update() returns trigger language plpgsql as $$
        begin ${body} return new; end $$`);
      await pool.query(`create trigger test_fail_update before ${on} for each row execute function learning_app.test_fail_update()`);
      try {
        await work();
      } finally {
        await pool.query(`drop trigger if exists test_fail_update on ${on.split(" on ")[1]}`);
        await pool.query("drop function if exists learning_app.test_fail_update()");
      }
    }

    /**
     * Ostatnia automatyczna próba przerwana zamknięciem procesu (przebieg bazowy rozlicza zagadnienia dopiero po
     * walidacji puli, więc rozliczone A pochodzi z wcześniejszej próby): próba 1 — A gotowe, B błąd przejściowy;
     * ostatnia próba — paczka B „w locie”, gdy przychodzi zamknięcie.
     */
    async function shutdownInLastAttempt(world: AgentWorld, packets: Packets, runId: string): Promise<void> {
      packets.negative = everyPacket(transient);
      await executeLessonGeneration(world.services, runId);
      expect((await fullRun(runId)).state).toBe("queued");
      const held = gate();
      packets.negative = fromNextCall(world.agent, "negative", [held.step]);
      await pool.query("update learning_app.generation_runs set attempts = 2, next_attempt_at = null where id = $1", [runId]);
      const shutdown = new AbortController();
      const running = executeLessonGeneration(world.services, runId, { signal: shutdown.signal });
      await held.reached;
      shutdown.abort();
      await running;
    }

    async function progressOf(runId: string): Promise<LessonAgentProgress | undefined> {
      return parseLessonAgentProgress((await fullRun(runId)).agent_checkpoint, runId);
    }

    /** Zagadnienia ćwiczeń szkicu (bez powtórzeń, w kolejności pozycji). */
    async function draftObjectives(versionId: string): Promise<string[]> {
      const rows = await query<{ objective_id: string }>(
        `select payload->>'objectiveId' as objective_id from learning_app.item_revisions
          where deck_version_id = $1 order by position`,
        [versionId],
      );
      return [...new Set(rows.map((row) => row.objective_id))];
    }

    const slugOf = (objectiveId: string) => objectiveId.split(".").at(-1)!;

    interface DraftContext {
      rejectedCount?: number;
      droppedObjectiveCount?: number;
      generationGaps?: unknown;
      cleanupCounts?: Record<string, number>;
    }

    const contextOf = (version: VersionRow) => version.lesson_context as DraftContext;
    const summaryOf = (row: FullRunRow) =>
      row.agent_checkpoint as { totalSpentUsd: number; objectives: Record<string, { status: string; accepted: number }> };

    it("rozdział: etap zagadnień i przebieg bazowy → szkic, dynamicTopic, przykłady, editNumber+1, podsumowanie bez treści", async () => {
      const { services, agent } = await agentWorld();
      const { runId, deckId } = await createLessonFromMaterial(services, {
        subjectId: "english_chapter",
        topicTitlePl: "Unit 1",
        material: CHAPTER_MATERIAL,
        poolSize: 40,
        clientRequestId: randomUUID(),
      });
      const before = await versionOf(runId);

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("succeeded");
      // Od etapu 5a (#362) rozdział idzie paczkami przebiegu bazowego.
      expect(agent.packetCalls.length).toBeGreaterThan(0);
      const after = await versionOf(runId);
      expect(after.edit_number).toBe(before.edit_number + 1);
      expect(after.state).toBe("review");
      expect(await exerciseCount(after.id)).toBeGreaterThan(0);
      const context = after.lesson_context as {
        dynamicTopic: { objectives: { id: string; kind?: string }[] };
        objectiveIds: string[];
        examples: Record<string, string[]>;
      };
      const objectiveIds = context.dynamicTopic.objectives.map((objective) => objective.id);
      // Zagadnienia z sekcji materiału „Słowa:” i „Zwroty:” (slug fake'a etapu zagadnień: „ł” → „_”).
      expect(objectiveIds).toEqual(["s_owa", "zwroty"].map((slug) => `english_chapter.d${deckId}.${slug}`));
      expect(context.dynamicTopic.objectives.map((objective) => objective.kind)).toEqual(["words", "frame"]);
      expect(context.objectiveIds).toEqual(objectiveIds);
      for (const id of objectiveIds) expect(context.examples[id]!.length).toBeGreaterThan(0);
      expectSummaryWithoutContent(row.agent_checkpoint, 1);
      // Rozdział nie ma historyjki — kolejkę historyjki sprawdza test gramatyki (przedmiot z `lessonStory`).
      expect(await storyRunStates(after.id)).toEqual([]);
    });

    it("gramatyka (katalog) i szkoła (etap zagadnień z fake LLM)", async () => {
      const { fakes, services, agent } = await agentWorld();

      const grammar = await createLesson(services, command());
      await executeLessonGeneration(services, grammar.runId);
      const grammarRow = await fullRun(grammar.runId);
      expect(grammarRow.state).toBe("succeeded");
      // Temat katalogu zawężony do zagadnień lekcji: tylko wybrane zagadnienie, nie cały temat.
      expect(new Set(agent.packetCalls.map((call) => call.objective.id))).toEqual(new Set([OBJECTIVE]));
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
      const { services } = await agentWorld({ packets: { third_person_s: everyPacket(EMPTY) } });
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
      // Postęp zostaje do „Ponów” (z wpisem zagadnienia tej próby); liczniki już są w kontekście.
      const progressAfter = parseLessonAgentProgress(row.agent_checkpoint, runId);
      expect(progressAfter?.objectives[OBJECTIVE]?.status).toBe("incomplete");
      expect(progressAfter?.removedAfterAcceptance).toBe(0);
    });

    describe("powody odrzuceń w szkicu (decyzja właściciela 2026-11-05)", () => {
      const labels = messages.lessons.agentRejectionReasons;
      const reasonsOf = (version: VersionRow) => (version.lesson_context as { rejectedReasons?: Record<string, number> }).rejectedReasons;
      const malformed = { notAnExercise: true, secret: "treść-rekordu" };
      /** `rejectedReasons` szkicu: wyłącznie etykiety kodów odrzuceń z `messages.ts`, bez treści. */
      const expectOnlyCodeLabels = (reasons: Record<string, number> | undefined): void => {
        const known = new Set(Object.values(labels));
        for (const key of Object.keys(reasons ?? {})) expect(known.has(key), key).toBe(true);
      };

      it("pełne odrzucenie → failed validation, szkic ma etykietę; „Ponów” sumuje kody obu prób bez podwojenia", async () => {
        // Próba 1: każda paczka zwraca jeden zły rekord; próba po „Ponów” — dwa.
        let batch: unknown[] = [malformed];
        const { services } = await agentWorld({ packets: { third_person_s: everyPacket({ build: () => ({ exercises: batch }) }) } });
        const { runId } = await createLesson(services, command());
        const packets = (await plannedPackets(runId))[OBJECTIVE]!;

        await executeLessonGeneration(services, runId);

        const failed = await fullRun(runId);
        expect(failed.state).toBe("failed");
        expect(failed.error_code).toBe("validation");
        const label = labels.shape_malformed!;
        expect(reasonsOf(await versionOf(runId))).toEqual({ [label]: packets });
        // Pełny postęp zostaje (asercje „bez odrzuceń” czytają kody), z oznaczeniem kodów już zapisanych w szkicu.
        const saved = parseLessonAgentProgress(failed.agent_checkpoint, runId)!;
        expect(saved.rejectionCodes).toEqual({ shape_malformed: packets });
        expect(saved.rejectionCodesWritten).toEqual({ shape_malformed: packets });
        // Szkic ma tylko etykiety, a kolumna agent_checkpoint — żadnej treści odrzuconych rekordów.
        expectOnlyCodeLabels(reasonsOf(await versionOf(runId)));
        expect(JSON.stringify(failed.agent_checkpoint)).not.toContain("treść-rekordu");

        batch = [malformed, malformed];
        await retryGeneration(services, runId);
        await executeLessonGeneration(services, runId);

        const again = await fullRun(runId);
        expect(again.state).toBe("failed");
        expect(reasonsOf(await versionOf(runId))).toEqual({ [label]: 3 * packets });
        expect(parseLessonAgentProgress(again.agent_checkpoint, runId)!.rejectionCodes).toEqual({ shape_malformed: 3 * packets });
      });
    });

    it("wszystkie zagadnienia provider_configuration → failed provider_configuration bez ponowienia", async () => {
      // Pierwsza paczka każdego zagadnienia odrzucona kluczem (401); reszta paczek przechodzi, ale porażka paczki oblewa zagadnienie.
      const refused = () => [{ throw: new GenerationProviderError("configuration", { status: 401 }) }];
      const { services, agent } = await agentWorld({ packets: { third_person_s: refused(), negative: refused() } });
      const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
      const planned = await plannedPackets(runId);

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("failed");
      expect(row.error_code).toBe("provider_configuration");
      expect(row.attempts).toBe(1);
      expect(row.next_attempt_at).toBeNull();
      // Błąd konfiguracji bez ponowienia paczki: jedno wywołanie na paczkę planu.
      expect(agent.packetCalls).toHaveLength(planned[OBJECTIVE]! + planned[NEGATIVE]!);
      expect(Object.values(parseLessonAgentProgress(row.agent_checkpoint, runId)!.objectives).map((entry) => entry.failureCode)).toEqual([
        "provider_configuration",
        "provider_configuration",
      ]);
    });

    it("uszkodzony punkt kontrolny → start od zera z zachowanym wydatkiem", async () => {
      const { fakes, services, agent } = await agentWorld();
      // Zła obwiednia; wydatek wcześniejszych prób zostaje (ta próba tylko go powiększa).
      const grammar = await createLesson(services, command());
      await setCheckpoint(grammar.runId, { version: 1, kind: "progress", objectives: "x", budgetSpentUsd: 0.3, totalSpentUsd: 0.5 });
      await executeLessonGeneration(services, grammar.runId);
      const grammarRow = await fullRun(grammar.runId);
      expect(grammarRow.state).toBe("succeeded");
      expect(new Set(agent.packetCalls.map((call) => call.objective.id))).toEqual(new Set([OBJECTIVE]));
      expect(summaryOf(grammarRow).totalSpentUsd).toBeGreaterThanOrEqual(0.5);

      // Dobra obwiednia, temat łamiący reguły katalogu → etap zagadnień od zera.
      const chapter = await createLessonFromMaterial(services, {
        subjectId: "english_chapter",
        topicTitlePl: "Unit 1",
        material: CHAPTER_MATERIAL,
        poolSize: 40,
        clientRequestId: randomUUID(),
      });
      await setCheckpoint(chapter.runId, {
        ...emptyLessonAgentProgress(),
        dynamicTopic: { titlePl: "", objectives: [] },
        budgetSpentUsd: 0.2,
        totalSpentUsd: 0.2,
      });
      await executeLessonGeneration(services, chapter.runId);
      const chapterRow = await fullRun(chapter.runId);
      expect(chapterRow.state).toBe("succeeded");
      expect(fakes.llm.objectiveRequests).toHaveLength(1);
      expect(summaryOf(chapterRow).totalSpentUsd).toBeGreaterThanOrEqual(0.2);
    });

    it("nowy szkic bez klucza review", async () => {
      const { services, agent } = await agentWorld();
      const { runId } = await createLesson(services, command());

      await executeLessonGeneration(services, runId);

      expect((await fullRun(runId)).state).toBe("succeeded");
      expect(agent.packetCalls.length).toBeGreaterThan(0);
      expect((await versionOf(runId)).lesson_context).not.toHaveProperty("review");
    });

    it("stary klucz review w szkicu — run succeeded, klucz zostaje, DTO go nie ma", async () => {
      const { services, agent } = await agentWorld();
      const { runId, deckId } = await createLesson(services, command());
      const before = await versionOf(runId);
      // Dane sprzed usunięcia krytyka: klucz zostaje w szkicu, ale nikt go nie czyta ani nie pokazuje.
      await setContextField(before.id, "review", { status: "reviewed", objectives: [] });

      await executeLessonGeneration(services, runId);

      expect((await fullRun(runId)).state).toBe("succeeded");
      expect(agent.packetCalls.length).toBeGreaterThan(0);
      const after = await versionOf(runId);
      expect(after.lesson_context).toHaveProperty("review");
      expect((await readLessonDeck(services, deckId)).draft).not.toHaveProperty("review");
    });

    it("attempts > MAX → attempts_exhausted bez wywołań", async () => {
      const { services, agent } = await agentWorld();
      const { runId } = await createLesson(services, command());
      await pool.query("update learning_app.generation_runs set attempts = 3 where id = $1", [runId]);

      await executeLessonGeneration(services, runId);

      const row = await fullRun(runId);
      expect(row.state).toBe("failed");
      expect(row.error_code).toBe("attempts_exhausted");
      expect(row.attempts).toBe(4);
      expect(agent.packetCalls).toEqual([]);
    });

    describe("tryb fake z env (spec etapu 3 §5.2): publikowalna pula bez luk i bez odrzuceń ujawnień", () => {
      /** Kopia `CHAPTER_BODY` z `tests/e2e/parent-sources.spec.ts` (materiał bez sekcji „Słowa:”/„Zwroty:”). */
      const CHAPTER_BODY = [
        "Zagadnienie 1: Ubrania",
        "coat, boots, dress, skirt, t-shirt",
        "Zagadnienie 2: Pogoda",
        "It's raining. It's snowing. What's the weather like?",
        "Zagadnienie 3: Co mam na sobie",
        "I'm wearing a coat. I'm wearing boots.",
      ].join("\n");
      const GRAMMAR_OBJECTIVES = [OBJECTIVE, NEGATIVE, "english_grammar.present_simple.question"];

      /** Usługi z produkcyjnym rejestrem i agentem złożonym jak w workerze trybu fake (albo jego bliźniakiem z historią). */
      async function envWorld(agent?: FakeLessonPoolAgent): Promise<Services> {
        const fakes = await fakeGeneration();
        disposers.push(fakes.dispose);
        const fromEnv = lessonAgentDepsFromEnv({ UMIEM_FAKE_PROVIDERS: "1" });
        if (!isLessonAgentAvailable(fromEnv)) throw new Error("tryb fake bez agenta");
        const lessonAgent = agent === undefined ? fromEnv : { ...fromEnv, agent };
        return servicesWith(fakes, { ...fakes.deps, lessonAgent }, new ManualClock());
      }

      async function grammarLesson(services: Services) {
        return createLesson(services, command({ objectiveIds: GRAMMAR_OBJECTIVES, poolSize: 60 }));
      }

      async function schoolLesson(services: Services) {
        return createSchoolLesson(services, {
          subjectTitlePl: "Geografia", topicTitlePl: "Polska", material: SCHOOL_MATERIAL, poolSize: 40, clientRequestId: randomUUID(),
        });
      }

      async function chapterLesson(services: Services, material: string) {
        return createLessonFromMaterial(services, {
          subjectId: "english_chapter", topicTitlePl: "Unit 1", material, poolSize: 40, clientRequestId: randomUUID(),
        });
      }

      /**
       * Run zakończony sukcesem bez `generationGaps`, z każdym zagadnieniem `complete` w podsumowaniu punktu
       * kontrolnego (`objectiveIds` — oczekiwany zbiór; brak = zagadnienia szkicu), bez żadnego odrzucenia
       * (`rejectionCodes` puste — duplikaty to `lesson_pool`, ujawnienia `leak_*`) i bez kosztu (fake z env:
       * `stepCostUsd: 0`). Zwraca szkic.
       */
      async function expectCleanRun(services: Services, runId: string, deckId: string, objectiveIds?: readonly string[]): Promise<LessonDraftDto> {
        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        const draft = (await readLessonDeck(services, deckId)).draft!;
        expect(draft.generationGaps).toBeUndefined();
        expect(contextOf(await versionOf(runId)).generationGaps).toBeUndefined();
        const summary = row.agent_checkpoint as {
          kind: string; objectives: Record<string, { status: string; accepted: number }>; rejectionCodes: Record<string, number>; totalSpentUsd: number;
        };
        expect(summary.kind).toBe("summary");
        expect(Object.keys(summary.objectives).sort()).toEqual([...(objectiveIds ?? draft.objectiveIds)].sort());
        for (const [objectiveId, entry] of Object.entries(summary.objectives)) expect(entry.status, objectiveId).toBe("complete");
        expect(summary.rejectionCodes).toEqual({});
        expect(summary.totalSpentUsd).toBe(0);
        return draft;
      }

      async function expectPublishable(services: Services, draft: LessonDraftDto): Promise<void> {
        await expect(publishLessonDraft(services, draft.id, draft.editNumber)).resolves.toEqual({ deckVersionId: draft.id });
      }

      it("(a) gramatyka present_simple: trzy zagadnienia, pula 60", async () => {
        const services = await envWorld();
        const { runId, deckId } = await grammarLesson(services);
        await executeLessonGeneration(services, runId);
        const draft = await expectCleanRun(services, runId, deckId, GRAMMAR_OBJECTIVES);
        expect(draft.objectiveIds).toEqual(GRAMMAR_OBJECTIVES);
        await expectPublishable(services, draft);
      });

      it("(b) rozdział na materiale „Zagadnienie N:” (CHAPTER_BODY z E2E), pula 40", async () => {
        const services = await envWorld();
        const { runId, deckId } = await chapterLesson(services, CHAPTER_BODY);
        await executeLessonGeneration(services, runId);
        const draft = await expectCleanRun(services, runId, deckId);
        expect(draft.objectiveIds.length).toBeGreaterThan(0);
        await expectPublishable(services, draft);
      });

      it("(c) szkoła na materiale z zagadnieniami, pula 40", async () => {
        const services = await envWorld();
        const { runId, deckId } = await schoolLesson(services);
        await executeLessonGeneration(services, runId);
        const draft = await expectCleanRun(services, runId, deckId);
        expect(draft.objectiveIds.length).toBeGreaterThan(0);
        await expectPublishable(services, draft);
      });

      it("(d) „+6” na pierwszym zagadnieniu gramatyki dopisuje co najmniej 6 ćwiczeń", async () => {
        const services = await envWorld();
        const { runId, deckId } = await grammarLesson(services);
        await executeLessonGeneration(services, runId);
        const before = await expectCleanRun(services, runId, deckId, GRAMMAR_OBJECTIVES);
        const own = (draft: LessonDraftDto) => draft.exercises.filter((exercise) => exercise.objectiveId === OBJECTIVE).length;

        const topUp = await regenerateObjective(services, {
          deckId, objectiveId: OBJECTIVE, count: 6, expectedEditNumber: before.editNumber, clientRequestId: randomUUID(),
        });
        await executeLessonGeneration(services, topUp.runId);

        const after = await expectCleanRun(services, topUp.runId, deckId, [OBJECTIVE]);
        expect(own(after)).toBeGreaterThanOrEqual(own(before) + 6);
        await expectPublishable(services, after);
      });

      it("(e) rozdział z sekcjami „Słowa:”/„Zwroty:” → rodzaje words, frame", async () => {
        const services = await envWorld();
        const { runId, deckId } = await chapterLesson(services, CHAPTER_MATERIAL);
        await executeLessonGeneration(services, runId);
        const draft = await expectCleanRun(services, runId, deckId);
        expect(draft.dynamicTopic!.objectives.map((objective) => objective.kind)).toEqual(["words", "frame"]);
        await expectPublishable(services, draft);
      });

      it("bliźniak z historią wywołań: gramatyka i szkoła kończą każde zagadnienie jednym przebiegiem paczek (bez ponowień)", async () => {
        for (const create of [grammarLesson, schoolLesson]) {
          // Jak fake z env (`stepCostUsd: 0`), ale z historią wywołań.
          const agent = new FakeLessonPoolAgent({ generate: {}, stepCostUsd: 0 });
          const services = await envWorld(agent);
          const { runId, deckId } = await create(services);
          await executeLessonGeneration(services, runId);
          await expectCleanRun(services, runId, deckId);
          expect(agent.packetCalls.length).toBeGreaterThan(0);
          // Paczka = zagadnienie × typ: każda wywołana raz.
          const packets = agent.packetCalls.map((call) => `${call.objective.id}/${call.type}`);
          expect(new Set(packets).size).toBe(packets.length);
        }
      });
    });

    /** Paczka B z jednym ćwiczeniem o złym kształcie (odrzucenie w walidacji paczki). */
    const MALFORMED_NEGATIVE: FakePacketStep = { build: () => ({ exercises: [{ exerciseType: "lesson_choice", objectiveId: NEGATIVE }] }) };

    it("rejectedCount = usunięcia po przyjęciu, nie odrzucenia w walidacji paczek", async () => {
      // Zagadnienie B: w próbie 1 błąd przejściowy każdej paczki, w próbie 2 tylko ćwiczenia o złym kształcie.
      const packets: Packets = { negative: everyPacket(transient) };
      const { services, clock, agent } = await agentWorld({ packets });
      const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
      const before = await versionOf(runId);
      await executeLessonGeneration(services, runId);
      const first = await fullRun(runId);
      expect(first.state).toBe("queued");
      packets.negative = fromNextCall(agent, "negative", everyPacket(MALFORMED_NEGATIVE));
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
      // 2 (bezpiecznik) + 1 (kontrola końcowa: duplikat); odrzucenie w walidacji paczki się nie liczy.
      expect(context.rejectedCount).toBe(((before.lesson_context as { rejectedCount?: number }).rejectedCount ?? 0) + 3);
      // Zagadnienie A straciło w kontroli końcowej tylko duplikat — na zapisanej lekcji nadal jest kompletem.
      expect(context.generationGaps).toEqual([{ objectiveId: NEGATIVE, reason: "incomplete" }]);
      const summary = row.agent_checkpoint as { rejectionCodes: Record<string, number> };
      expect(Object.values(summary.rejectionCodes).reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(1);
    });

    it("pełna pula: zapis odrzuca ćwiczenia potrzebne do minimum etapu → luka incomplete mimo kompletu w walidacji puli", async () => {
      // Próba 1: A gotowe, B błąd przejściowy (punkt kontrolny z kompletem A); próba 2: B bez poprawnych ćwiczeń.
      const packets: Packets = { negative: everyPacket(transient) };
      const { services, clock, agent } = await agentWorld({ packets });
      const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
      await executeLessonGeneration(services, runId);
      const first = await fullRun(runId);
      expect(first.state).toBe("queued");
      packets.negative = fromNextCall(agent, "negative", everyPacket(MALFORMED_NEGATIVE));
      const own = parseLessonAgentProgress(first.agent_checkpoint, runId)!.objectives[OBJECTIVE]!;
      expect(own.status).toBe("complete");
      // Historyjka szkicu powtarza rozwiązania wszystkich ćwiczeń etapu samodzielnego A — zapis je odrzuca.
      const independent = own.exercises.filter((exercise) => stageOf(exercise.exerciseType) === "independent");
      expect(independent.length).toBeGreaterThan(0);
      const version = await versionOf(runId);
      await setContextField(version.id, "story", {
        sentences: solvedSentencesOf(independent),
        questions: [{ id: "q1", question: "Kto?", options: [{ id: "a", text: "Tom" }, { id: "b", text: "Ola" }], correctOption: "a" }],
      });
      clock.advanceMs(10 * 60_000);

      await executeLessonGeneration(services, runId);

      expect((await fullRun(runId)).state).toBe("succeeded");
      const after = await versionOf(runId);
      const written = await query<{ exercise_type: string }>(
        "select payload->>'exerciseType' as exercise_type from learning_app.item_revisions where deck_version_id = $1",
        [after.id],
      );
      expect(written.length).toBeGreaterThan(0);
      expect(written.filter((row) => stageOf(row.exercise_type as LessonExerciseDraft["exerciseType"]) === "independent")).toEqual([]);
      // Na zapisanej lekcji A nie spełnia minimum etapu samodzielnego: luka mimo kompletu z punktu kontrolnego.
      expect(contextOf(after).generationGaps).toEqual([
        { objectiveId: OBJECTIVE, reason: "incomplete" },
        { objectiveId: NEGATIVE, reason: "incomplete" },
      ]);
    });

    it("podsumowanie punktu kontrolnego wycofane razem z nieudanym zapisem końcowym", async () => {
      const { services } = await agentWorld();
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

    describe("wznawianie, próby, terminy, budżet, straże i „Ponów”", () => {
      const QUESTION = "english_grammar.present_simple.question";

      it("błąd przejściowy zagadnienia → queued; kolejna próba pomija gotowe i etap zagadnień rozdziału i szkoły, przenosi wydatek, kończy zapisem", async () => {
        // Każda paczka zagadnienia „zwroty” rozdziału i „gory_polski” szkoły w próbie 1 (z ponowieniem) kończy się
        // błędem przejściowym, w próbie 2 — wynik generatora. Paczka kosztuje 0,01 USD, kontrola zamkniętych 0.
        const packets: Packets = { zwroty: everyPacket(transient), gory_polski: everyPacket(transient) };
        const { fakes, services, agent } = await agentWorld({ stepCostUsd: 0.01, packets });
        const packetSlugs = () => agent.packetCalls.map((call) => slugOf(call.objective.id));
        const schoolCalls = () => agent.packetCalls.filter((call) => call.objective.id.startsWith("school.")).length;

        // Rozdział (etap zagadnień i przebieg bazowy).
        const chapter = await createLessonFromMaterial(services, {
          subjectId: "english_chapter",
          topicTitlePl: "Unit 1",
          material: CHAPTER_MATERIAL,
          poolSize: 40,
          clientRequestId: randomUUID(),
        });
        await executeLessonGeneration(services, chapter.runId);
        const requeued = await fullRun(chapter.runId);
        expect(requeued.state).toBe("queued");
        expect(requeued.error_code).toBe("provider");
        expect(requeued.next_attempt_at).not.toBeNull();
        const saved = parseLessonAgentProgress(requeued.agent_checkpoint, chapter.runId)!;
        expect(Object.fromEntries(Object.entries(saved.objectives).map(([id, entry]) => [slugOf(id), entry.status]))).toEqual({
          s_owa: "complete",
          zwroty: "failed",
        });
        expect(saved.dynamicTopic?.objectives).toHaveLength(2);
        expect(saved.budgetSpentUsd).toBeGreaterThan(0);
        const firstWords = packetSlugs().filter((slug) => slug === "s_owa").length;
        expect(firstWords).toBeGreaterThan(0);

        packets.zwroty = [];
        await dueNow(chapter.runId);
        await executeLessonGeneration(services, chapter.runId);
        const chapterRow = await fullRun(chapter.runId);
        expect(chapterRow.state).toBe("succeeded");
        expect(chapterRow.attempts).toBe(2);
        // Etap zagadnień pominięty (temat z punktu kontrolnego), gotowe zagadnienie bez nowych paczek.
        expect(fakes.llm.objectiveRequests).toHaveLength(1);
        expect(packetSlugs().filter((slug) => slug === "s_owa")).toHaveLength(firstWords);
        expectSummaryWithoutContent(chapterRow.agent_checkpoint, 2);
        // Wydatek przeniesiony: próba 1 i paczki „zwroty” próby 2.
        expect(summaryOf(chapterRow).totalSpentUsd).toBeGreaterThan(saved.totalSpentUsd);
        const chapterVersion = await versionOf(chapter.runId);
        const chapterContext = chapterVersion.lesson_context as { dynamicTopic: unknown };
        expect(chapterContext.dynamicTopic).toEqual(saved.dynamicTopic);
        expect(await draftObjectives(chapterVersion.id)).toEqual(saved.dynamicTopic!.objectives.map((objective) => objective.id));

        // Szkoła (etap zagadnień i przebieg bazowy).
        const school = await createSchoolLesson(services, {
          subjectTitlePl: "Geografia",
          topicTitlePl: "Polska",
          material: SCHOOL_MATERIAL,
          poolSize: 40,
          clientRequestId: randomUUID(),
        });
        await executeLessonGeneration(services, school.runId);
        const schoolRequeued = await fullRun(school.runId);
        expect(schoolRequeued.state).toBe("queued");
        const schoolSaved = parseLessonAgentProgress(schoolRequeued.agent_checkpoint, school.runId)!;
        expect(Object.fromEntries(Object.entries(schoolSaved.objectives).map(([id, entry]) => [slugOf(id), entry.status]))).toEqual({
          rzeki_polski: "complete",
          gory_polski: "failed",
        });
        // Koszt per wywołanie paczki (także ponowienie), bez kontroli zamkniętych (0 USD).
        const firstSchoolCalls = schoolCalls();
        const firstRivers = packetSlugs().filter((slug) => slug === "rzeki_polski").length;
        expect(firstRivers).toBeGreaterThan(0);
        expect(schoolSaved.budgetSpentUsd).toBeCloseTo(0.01 * firstSchoolCalls, 6);

        packets.gory_polski = [];
        await dueNow(school.runId);
        await executeLessonGeneration(services, school.runId);
        const schoolRow = await fullRun(school.runId);
        expect(schoolRow.state).toBe("succeeded");
        // Etap zagadnień rozdziału i jeden etap szkoły (pominięty przy wznowieniu).
        expect(fakes.llm.objectiveRequests).toHaveLength(2);
        // Gotowe „rzeki_polski” bez nowych paczek; „gory_polski” generowane od nowa.
        expect(packetSlugs().filter((slug) => slug === "rzeki_polski")).toHaveLength(firstRivers);
        expect(schoolCalls()).toBeGreaterThan(firstSchoolCalls);
        // Wydatek próby 1 przeniesiony i doliczony raz: łącznie = 0,01 USD × wszystkie paczki szkoły.
        expect(summaryOf(schoolRow).totalSpentUsd).toBeCloseTo(0.01 * schoolCalls(), 6);
        expect(await draftObjectives((await versionOf(school.runId)).id)).toEqual(schoolSaved.dynamicTopic!.objectives.map((objective) => objective.id));
      });

      it("wyczerpane próby → zapis części, generationGaps z zagadnieniem incomplete/failed", async () => {
        // A: wynik generatora; B: błąd przejściowy każdej paczki w każdej próbie; C: paczki bez ćwiczeń.
        // Koszt 0: szacunek nieznanego kosztu (0,02 USD na wywołanie) wyczerpałby budżet runu w próbie 3.
        const { services, agent } = await agentWorld({
          stepCostUsd: 0,
          packets: { negative: everyPacket(transient), question: everyPacket(EMPTY) },
        });
        const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE, QUESTION] }));
        const planned = await plannedPackets(runId);
        for (const attempt of [1, 2]) {
          await executeLessonGeneration(services, runId);
          expect((await fullRun(runId)).state, `próba ${attempt}`).toBe("queued");
          await dueNow(runId);
        }

        await executeLessonGeneration(services, runId);

        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        expect(row.attempts).toBe(3);
        expect(row.error_code).toBeNull();
        // Gotowe zagadnienie nie jest ponawiane; pozostałe startują od zera w każdej próbie
        // (B: każda paczka z jednym ponowieniem błędu technicznego).
        expect(packetCallsOf(agent, "third_person_s")).toHaveLength(planned[OBJECTIVE]!);
        expect(packetCallsOf(agent, "negative")).toHaveLength(3 * 2 * planned[NEGATIVE]!);
        expect(packetCallsOf(agent, "question")).toHaveLength(3 * planned[QUESTION]!);
        const version = await versionOf(runId);
        expect(contextOf(version).generationGaps).toEqual([
          { objectiveId: NEGATIVE, reason: "failed" },
          { objectiveId: QUESTION, reason: "incomplete" },
        ]);
        expect(await draftObjectives(version.id)).toEqual([OBJECTIVE]);
        expectSummaryWithoutContent(row.agent_checkpoint, 3);
        expect(summaryOf(row).objectives[NEGATIVE]).toMatchObject({ status: "failed", accepted: 0 });
      });

      it("shutdown w ostatniej próbie (gate + abort sygnału) → następne przejęcie zapisuje z punktu kontrolnego bez wywołań modelu; gap dla nierozliczonego zagadnienia", async () => {
        const packets: Packets = {};
        const world = await agentWorld({ packets });
        const { services, agent } = world;
        const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
        await shutdownInLastAttempt(world, packets, runId);

        const stopped = await fullRun(runId);
        expect(stopped.state).toBe("queued");
        expect(stopped.attempts).toBe(3);
        expect(stopped.next_attempt_at).toBeNull();
        const saved = parseLessonAgentProgress(stopped.agent_checkpoint, runId)!;
        expect(saved.objectives[OBJECTIVE]!.exercises.length).toBeGreaterThan(0);
        // B przerwane w ostatniej próbie: w punkcie kontrolnym zostaje wpis z próby 1.
        expect(saved.objectives[NEGATIVE]).toMatchObject({ status: "failed", exercises: [] });
        const calls = agent.packetCalls.length;

        await executeLessonGeneration(services, runId);

        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        expect(row.attempts).toBe(4);
        expect(agent.packetCalls).toHaveLength(calls);
        const version = await versionOf(runId);
        expect(await exerciseCount(version.id)).toBe(saved.objectives[OBJECTIVE]!.exercises.length);
        expect(contextOf(version).generationGaps).toEqual([{ objectiveId: NEGATIVE, reason: "failed" }]);
        expectSummaryWithoutContent(row.agent_checkpoint, 4);
      });

      it("shutdown w trakcie próby z kosztem → punkt kontrolny ma faktyczny wydatek, kolejna próba startuje od niego (#317)", async () => {
        // Paczka kosztuje 0,01 USD (zapis kosztu przed czekaniem); pierwsza paczka B „w locie”, pozostałe gotowe.
        const inFlight = gate();
        const { services, agent } = await agentWorld({ stepCostUsd: 0.01, packets: { negative: [inFlight.step] } });
        const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
        const planned = await plannedPackets(runId);
        const all = planned[OBJECTIVE]! + planned[NEGATIVE]!;
        // Paczka samodzielna B czeka na rozwiązania wcześniejszych paczek B (#373): przy wstrzymanej pierwszej paczce nie ma jeszcze jej wywołania ani kosztu.
        const paid = all - 1;
        const shutdown = new AbortController();
        const running = executeLessonGeneration(services, runId, { signal: shutdown.signal });
        await inFlight.reached;
        await vi.waitFor(() => expect(agent.packetCalls).toHaveLength(paid), { timeout: 10_000, interval: 10 });
        expect(agent.packetCalls.filter((call) => call.objective.id === NEGATIVE && call.type === "lesson_open_answer")).toHaveLength(0);
        shutdown.abort();
        await running;

        const stopped = await fullRun(runId);
        expect(stopped.state).toBe("queued");
        const saved = parseLessonAgentProgress(stopped.agent_checkpoint, runId)!;
        // Przebieg bazowy rozlicza zagadnienia dopiero po walidacji puli: przerwana próba nic nie rozliczyła…
        expect(saved.objectives).toEqual({});
        // …ale jej wydatek (wszystkie opłacone paczki, także B „w locie”) jest w punkcie kontrolnym.
        expect(saved.budgetSpentUsd).toBeCloseTo(0.01 * paid, 6);
        expect(saved.totalSpentUsd).toBeCloseTo(0.01 * paid, 6);

        await executeLessonGeneration(services, runId);

        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        // Wydatek przerwanej próby + paczki próby 2, bez podwójnego liczenia.
        expect(agent.packetCalls).toHaveLength(paid + all);
        expect(summaryOf(row).totalSpentUsd).toBeCloseTo(0.01 * (paid + all), 6);
      });

      it("błąd przejściowy bazy w ostatniej próbie przy przyjętym zagadnieniu → queued, następne przejęcie zapisuje część bez wywołań modelu (#319)", async () => {
        const { services, agent } = await agentWorld();
        const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
        // Ostatnia automatyczna próba.
        await pool.query("update learning_app.generation_runs set attempts = 2 where id = $1", [runId]);
        // Rozliczenie po walidacji puli zapisuje zagadnienia po kolei: zapis A przechodzi, zapis postępu
        // z zagadnieniem B pada na przejściowym błędzie Postgresa (serialization_failure).
        await withFailingUpdate(
          "update on learning_app.generation_runs",
          `if new.agent_checkpoint -> 'objectives' ? '${NEGATIVE}' then
            raise exception 'test: checkpoint write failed' using errcode = '40001';
          end if;`,
          () => executeLessonGeneration(services, runId),
        );

        const requeued = await fullRun(runId);
        expect(requeued.state).toBe("queued");
        expect(requeued.attempts).toBe(3);
        const saved = parseLessonAgentProgress(requeued.agent_checkpoint, runId)!;
        expect(saved.objectives[OBJECTIVE]!.exercises.length).toBeGreaterThan(0);
        expect(saved.objectives[NEGATIVE]).toBeUndefined();
        const calls = agent.packetCalls.length;

        await dueNow(runId);
        await executeLessonGeneration(services, runId);

        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        expect(row.attempts).toBe(4);
        expect(agent.packetCalls).toHaveLength(calls);
        const version = await versionOf(runId);
        expect(await draftObjectives(version.id)).toEqual([OBJECTIVE]);
        expect(contextOf(version).generationGaps).toEqual([{ objectiveId: NEGATIVE, reason: "incomplete" }]);
      });

      it("przejęcie po wyczerpaniu prób: przejściowa awaria zapisu części → failed attempts_exhausted, bez kolejnego ponowienia", async () => {
        const packets: Packets = {};
        const world = await agentWorld({ packets });
        const { services, agent } = world;
        const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
        await shutdownInLastAttempt(world, packets, runId);
        expect((await fullRun(runId)).state).toBe("queued");
        const calls = agent.packetCalls.length;

        await withFailingUpdate(
          "update of edit_number on learning_app.deck_versions",
          "raise exception 'test: final write failed' using errcode = '40001';",
          () => executeLessonGeneration(services, runId),
        );

        const row = await fullRun(runId);
        expect(row.state).toBe("failed");
        expect(row.error_code).toBe("attempts_exhausted");
        expect(row.attempts).toBe(4);
        expect(agent.packetCalls).toHaveLength(calls);
      });

      it("budżet wyczerpany przy błędzie przejściowym innego zagadnienia → zapis części bez ponowienia", async () => {
        // Paczka kosztuje 0,01 USD. Próba 1: A gotowe (nA paczek), każda paczka B z ponowieniem pada przejściowo
        // (2·nB wywołań) → ponowienie runu. Budżet = wydatek próby 1 + 0,005: w próbie 2 pierwsze wywołanie B
        // przekracza budżet (bez ponowienia paczki), pozostałe paczki nie startują — kolejna próba nic by nie wydała.
        // Jedno miejsce generatora: kolejność wywołań i sprawdzeń budżetu jest stała.
        const policy: { runBudgetUsd?: number; concurrency?: number } = { concurrency: 1 };
        const { services, agent } = await agentWorld({ stepCostUsd: 0.01, packets: { negative: everyPacket(transient) } }, { policy });
        const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
        const planned = await plannedPackets(runId);
        const firstSpent = 0.01 * (planned[OBJECTIVE]! + 2 * planned[NEGATIVE]!);
        // Polityka czytana przy każdym wykonaniu runu; budżet zależy od planu paczek.
        policy.runBudgetUsd = firstSpent + 0.005;
        await executeLessonGeneration(services, runId);
        const first = await fullRun(runId);
        expect(first.state).toBe("queued");
        expect(parseLessonAgentProgress(first.agent_checkpoint, runId)!.budgetSpentUsd).toBeCloseTo(firstSpent, 6);
        const firstNegative = packetCallsOf(agent, "negative").length;
        await dueNow(runId);

        await executeLessonGeneration(services, runId);

        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        expect(row.attempts).toBe(2);
        expect(row.next_attempt_at).toBeNull();
        // Próba 2: gotowe A bez paczek, B — jedno wywołanie.
        expect(packetCallsOf(agent, "third_person_s")).toHaveLength(planned[OBJECTIVE]!);
        expect(packetCallsOf(agent, "negative")).toHaveLength(firstNegative + 1);
        const version = await versionOf(runId);
        expect(await draftObjectives(version.id)).toEqual([OBJECTIVE]);
        expect(contextOf(version).generationGaps).toEqual([{ objectiveId: NEGATIVE, reason: "failed" }]);
        expect(summaryOf(row).totalSpentUsd).toBeCloseTo(firstSpent + 0.01, 6);
      });

      it("termin runu → succeeded z częścią", async () => {
        // Termin przebiegu bazowego = 6000 − 1000 ms rezerwy; paczki B nie kończą się same (termin przerywa je
        // bez porażki), A jest gotowe wcześniej. A ma 5 s z zapisem do bazy (wcześniej 2 s — za mało przy obciążonym procesorze).
        const { services } = await agentWorld(
          { packets: { negative: everyPacket(never) } },
          { finalizationReserveMs: 1000, execution: { requestTimeoutMs: 6000, runTimeoutMs: 6000 } },
        );
        const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));

        await executeLessonGeneration(services, runId);

        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        expect(row.error_code).toBeNull();
        const version = await versionOf(runId);
        expect(await draftObjectives(version.id)).toEqual([OBJECTIVE]);
        expect(contextOf(version).generationGaps).toEqual([{ objectiveId: NEGATIVE, reason: "incomplete" }]);
      }, 15_000);

      it("edycja rodzica w trakcie (gate) → superseded, szkic bez zmian, agent_checkpoint NULL", async () => {
        const inFlight = gate();
        const { services, agent } = await agentWorld({ packets: { third_person_s: [inFlight.step] } });
        const { runId } = await createLesson(services, command());
        const planned = await plannedPackets(runId);
        const before = await versionOf(runId);
        const running = executeLessonGeneration(services, runId);
        await inFlight.reached;
        await editLessonDraft(services, before.id, { expectedEditNumber: before.edit_number, examples: { [OBJECTIVE]: ["She reads."] } });
        const edited = await versionOf(runId);
        await running;

        const row = await fullRun(runId);
        expect(row.state).toBe("superseded");
        expect(row.agent_checkpoint).toBeNull();
        // Najwyżej paczki przerwanej próby, bez ponowień i kolejnej próby.
        expect(agent.packetCalls.length).toBeLessThanOrEqual(planned[OBJECTIVE]!);
        // Szkic tylko z edycją rodzica: bez ćwiczeń i zmian kontekstu z generowania.
        const after = await versionOf(runId);
        expect(after.edit_number).toBe(before.edit_number + 1);
        expect(after.lesson_context).toEqual(edited.lesson_context);
        expect(await exerciseCount(after.id)).toBe(0);
      });

      it("podbicie editNumber przez acceptVerdictAsVariant w trakcie → run superseded (nie running), agent_checkpoint NULL", async () => {
        const inFlight = gate();
        // Pula lekcji z generatora; pierwsza paczka dogenerowania „w locie”, w trakcie rodzic przyjmuje wariant.
        const packets: Packets = {};
        const { services, agent } = await agentWorld({ packets });
        const lesson = await createLesson(services, command());
        await executeLessonGeneration(services, lesson.runId);
        expect((await fullRun(lesson.runId)).state).toBe("succeeded");
        packets.third_person_s = fromNextCall(agent, "third_person_s", [inFlight.step]);
        const draft = await versionOf(lesson.runId);
        const exercisesBefore = await exerciseCount(draft.id);
        const [revision] = await query<{ id: string }>(
          "select id from learning_app.item_revisions where deck_version_id = $1 order by position limit 1",
          [draft.id],
        );
        const add = await regenerateObjective(services, {
          deckId: lesson.deckId,
          objectiveId: OBJECTIVE,
          count: 2,
          expectedEditNumber: draft.edit_number,
          clientRequestId: randomUUID(),
        });
        const running = executeLessonGeneration(services, add.runId);
        await inFlight.reached;
        const verdictId = randomUUID();
        await pool.query(
          `insert into learning_app.lesson_verdicts (id, item_revision_id, normalized_answer, prompt_version, grader_model, verdict)
           values ($1, $2, 'he does play it', 'pv-test', 'fake-grader', 'correct')`,
          [verdictId, revision!.id],
        );
        expect((await acceptVerdictAsVariant(services, verdictId)).added).toBe(true);
        expect((await versionOf(add.runId)).edit_number).toBe(draft.edit_number + 1);
        await running;

        const row = await fullRun(add.runId);
        expect(row.state).toBe("superseded");
        expect(row.agent_checkpoint).toBeNull();
        expect(await exerciseCount(draft.id)).toBe(exercisesBefore);
      });

      it("Ponów w trakcie próby (druga karta: retryGeneration przy gate) → spóźniony zapis starej próby odrzucony, nowa próba wznawia", async () => {
        const inFlight = gate();
        // Długi odstęp sprawdzania bieżącości: starą próbę kończy wyłącznie straż zapisu punktu kontrolnego.
        const { services, agent } = await agentWorld(
          { stepCostUsd: 0.01, packets: { negative: [inFlight.step] } },
          { execution: { cancelPollMs: 60_000 } },
        );
        const { runId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
        const planned = await plannedPackets(runId);
        const before = await fullRun(runId);
        const running = executeLessonGeneration(services, runId);
        await inFlight.reached;
        // Punkt kontrolny z początku próby (przebieg bazowy rozlicza zagadnienia dopiero po walidacji puli).
        const saved = (await progressOf(runId))!;

        await retryGeneration(services, runId);
        inFlight.open();
        await running;
        const oldCalls = agent.packetCalls.length;

        const retried = await fullRun(runId);
        expect(retried.state).toBe("queued");
        expect(retried.attempts).toBe(0);
        expect(retried.expected_edit_number).toBe(before.expected_edit_number + 1);
        // Rozliczenie starej próby (A i B) nie trafiło do punktu kontrolnego; „Ponów” wyzerował budżet.
        expect(parseLessonAgentProgress(retried.agent_checkpoint, runId)).toEqual({ ...saved, budgetSpentUsd: 0 });

        await executeLessonGeneration(services, runId);

        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        expect(row.attempts).toBe(1);
        // Nowa próba od zera: każda paczka planu raz.
        expect(agent.packetCalls.length - oldCalls).toBe(planned[OBJECTIVE]! + planned[NEGATIVE]!);
        expect(await draftObjectives((await versionOf(runId)).id)).toEqual([OBJECTIVE, NEGATIVE]);
        // Wydatek starej próby nie trafił do punktu kontrolnego (zapis odrzucony): łącznie = paczki nowej próby.
        expect(summaryOf(row).totalSpentUsd).toBeCloseTo(saved.totalSpentUsd + 0.01 * (planned[OBJECTIVE]! + planned[NEGATIVE]!), 6);
      });

      it("Ponów po częściowym runie → wznowienie bez zduplikowanych familyId", async () => {
        /**
         * Paczka z rodziną pytań o stałym slugu „pytanie-1” — model powtarza slug w każdej próbie, więc rozdzielić
         * rodziny musi zakres próby (`familyScope`). „Ponów” odroczonego runu zeruje `attempts` bez podbicia numeru
         * edycji: gotowe „rzeki_polski” z próby 1 i „gory_polski” z próby po „Ponów” mają ten sam numer próby.
         */
        const FIXED_FAMILY = "pytanie-1";
        const familyStep = generatorStep((exercises) =>
          exercises.map((exercise) => (exercise.familyId === undefined ? exercise : { ...exercise, familyId: FIXED_FAMILY })),
        );
        // Próba 1: „rzeki_polski” gotowe, każda paczka „gory_polski” pada przejściowo → ponowienie odroczone.
        const packets: Packets = { rzeki_polski: everyPacket(familyStep), gory_polski: everyPacket(transient) };
        const { services, agent } = await agentWorld({ packets });
        const school = await createSchoolLesson(services, {
          subjectTitlePl: "Geografia",
          topicTitlePl: "Polska",
          material: SCHOOL_MATERIAL,
          poolSize: 40,
          clientRequestId: randomUUID(),
        });
        await executeLessonGeneration(services, school.runId);
        const partial = await fullRun(school.runId);
        expect(partial.state).toBe("queued");
        const saved = parseLessonAgentProgress(partial.agent_checkpoint, school.runId)!;
        const [rivers] = Object.keys(saved.objectives).filter((id) => slugOf(id) === "rzeki_polski");
        expect(saved.objectives[rivers!]!.status).toBe("complete");
        const riversFamilies = new Set(saved.objectives[rivers!]!.exercises.flatMap((exercise) => exercise.familyId ?? []));
        expect(riversFamilies.size).toBeGreaterThan(0);
        const riversCalls = packetCallsOf(agent, "rzeki_polski").length;

        // „Ponów” odroczonego runu: nowy budżet prób bez podbicia numeru edycji.
        packets.gory_polski = fromNextCall(agent, "gory_polski", everyPacket(familyStep));
        await retryGeneration(services, school.runId);
        expect((await fullRun(school.runId)).attempts).toBe(0);
        await executeLessonGeneration(services, school.runId);

        const row = await fullRun(school.runId);
        expect(row.state).toBe("succeeded");
        expect(row.attempts).toBe(1);
        expect(packetCallsOf(agent, "rzeki_polski")).toHaveLength(riversCalls);
        const families = await query<{ objective_id: string; family_id: string }>(
          `select payload->>'objectiveId' as objective_id, payload->>'familyId' as family_id from learning_app.item_revisions
            where deck_version_id = $1 and payload->>'familyId' is not null`,
          [(await versionOf(school.runId)).id],
        );
        const familiesOf = (slug: string) => new Set(families.filter((family) => slugOf(family.objective_id) === slug).map((family) => family.family_id));
        // Rodziny gotowego zagadnienia zapisane bez zmian, a wznowienie nie dokleja się do nich mimo tego samego slugu.
        expect(familiesOf("rzeki_polski")).toEqual(riversFamilies);
        expect(familiesOf("gory_polski").size).toBeGreaterThan(0);
        for (const family of familiesOf("gory_polski")) expect(riversFamilies.has(family), family).toBe(false);
      });

      it("porażka walidacji, potem „Ponów” i sukces → liczniki usunięć w kontekście raz", async () => {
        // Próba 1 nic nie przyjmuje (porażka walidacji), próba po „Ponów” — wynik generatora.
        const packets: Packets = { third_person_s: everyPacket(EMPTY) };
        const { services } = await agentWorld({ packets });
        const { runId, deckId } = await createLesson(services, command());
        const before = contextOf(await versionOf(runId));
        // Wcześniejsza próba: 2 usunięcia bezpiecznika i 1 zagadnienie odrzucone przy budowie tematu.
        // Oraz oczyszczenia przy przyjmowaniu (#286): 3 podpowiedzi i 5 wariantów.
        await setCheckpoint(runId, {
          ...emptyLessonAgentProgress(),
          removedAfterAcceptance: 2,
          droppedObjectiveCount: 1,
          cleanupCounts: { hintsRemoved: 3, variantsRemoved: 5 },
        });
        await executeLessonGeneration(services, runId);
        expect((await fullRun(runId)).error_code).toBe("validation");
        const failedContext = contextOf(await versionOf(runId));
        expect(failedContext.rejectedCount).toBe((before.rejectedCount ?? 0) + 2);
        expect(failedContext.droppedObjectiveCount).toBe((before.droppedObjectiveCount ?? 0) + 1);
        expect(failedContext.cleanupCounts).toEqual({ hintsRemoved: 3, variantsRemoved: 5 });

        packets.third_person_s = [];
        await retryGeneration(services, runId);
        await executeLessonGeneration(services, runId);

        expect((await fullRun(runId)).state).toBe("succeeded");
        const context = contextOf(await versionOf(runId));
        expect(context.rejectedCount).toBe((before.rejectedCount ?? 0) + 2);
        expect(context.droppedObjectiveCount).toBe((before.droppedObjectiveCount ?? 0) + 1);
        expect(context.cleanupCounts).toEqual({ hintsRemoved: 3, variantsRemoved: 5 });
        expect((await readLessonDeck(services, deckId)).draft!.cleanupCounts)
          .toEqual({ hintsRemoved: 3, variantsRemoved: 5, quotesSnapped: 0 });
      });

      it("awaria transakcji porażki walidacji → liczniki zostają w punkcie kontrolnym (kontekst wycofany)", async () => {
        const { services } = await agentWorld({ packets: { third_person_s: everyPacket(EMPTY) } });
        const { runId } = await createLesson(services, command());
        const before = await versionOf(runId);
        await setCheckpoint(runId, { ...emptyLessonAgentProgress(), removedAfterAcceptance: 2, droppedObjectiveCount: 1 });
        // Zapis liczników do kontekstu szkicu rzuca błąd spoza straży — transakcja porażki wycofana.
        await pool.query(`create or replace function learning_app.test_fail_lesson_context() returns trigger language plpgsql as $$
          begin raise exception 'test: validation failure write failed'; end $$`);
        await pool.query(`create trigger test_fail_lesson_context before update of lesson_context on learning_app.deck_versions
          for each row execute function learning_app.test_fail_lesson_context()`);
        try {
          await executeLessonGeneration(services, runId);
        } finally {
          await pool.query("drop trigger if exists test_fail_lesson_context on learning_app.deck_versions");
          await pool.query("drop function if exists learning_app.test_fail_lesson_context()");
        }

        const row = await fullRun(runId);
        expect(row.state).toBe("queued");
        expect((await versionOf(runId)).lesson_context).toEqual(before.lesson_context);
        // Zapis best-effort po błędzie nie zeruje liczników, których kontekst nie dostał.
        const saved = parseLessonAgentProgress(row.agent_checkpoint, runId)!;
        expect(saved.removedAfterAcceptance).toBe(2);
        expect(saved.droppedObjectiveCount).toBe(1);
      });

      it("brak czasu na przebieg bazowy: termin tylko dla „nic nie przyjęto”, budżet i kody dostawcy z punktu kontrolnego zostają", async () => {
        // Termin runu równy rezerwie: przebieg bazowy nie startuje, wynik z samego punktu kontrolnego.
        const { services, agent } = await agentWorld({}, {
          finalizationReserveMs: 1000,
          execution: { requestTimeoutMs: 1000, runTimeoutMs: 1000 },
        });
        const cases: { checkpoint: LessonAgentProgress; errorCode: string }[] = [
          { checkpoint: emptyLessonAgentProgress(), errorCode: "provider_timeout" },
          { checkpoint: { ...emptyLessonAgentProgress(), budgetSpentUsd: 1, totalSpentUsd: 1 }, errorCode: "validation" },
          {
            checkpoint: {
              ...emptyLessonAgentProgress(),
              objectives: { [OBJECTIVE]: { status: "failed", failureCode: "provider_configuration", exercises: [], examples: [] } },
            },
            errorCode: "provider_configuration",
          },
        ];
        for (const { checkpoint, errorCode } of cases) {
          const { runId } = await createLesson(services, command());
          await setCheckpoint(runId, checkpoint);
          await executeLessonGeneration(services, runId);
          const row = await fullRun(runId);
          expect(row.state, errorCode).toBe("failed");
          expect(row.error_code, errorCode).toBe(errorCode);
        }
        expect(agent.packetCalls).toEqual([]);
      });

      it("koszty: zdarzenia UsageRecorder (fake z usage) w zakresie runu, totalSpentUsd w podsumowaniu", async () => {
        await pool.query("truncate learning_app.provider_usage_events");
        const recorder = createDrizzleUsageRecorder({ db: testDatabase().db, clock: new ManualClock(), prices: {} });
        const { services } = await agentWorld({ stepCostUsd: 0.01, usage: recorder });
        const { runId, deckId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
        const planned = await plannedPackets(runId);

        // Zakres kosztów jak w workerze (`runDueGenerationWork`).
        await runDueGenerationWork(services, { total: 1, deck: 0, lesson: 1, tts: 0, images: 0 });
        await recorder.flush();

        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        const events = await query<Record<string, unknown>>(
          `select feature, operation, provider, scope_kind, generation_run_id, deck_id, cost_usd
             from learning_app.provider_usage_events where operation like 'packet_%' order by occurred_at, id`,
        );
        // Jedno zdarzenie na paczkę planu (kontrola zamkniętych fake'a nie pisze dziennika).
        const packets = planned[OBJECTIVE]! + planned[NEGATIVE]!;
        expect(events).toHaveLength(packets);
        for (const event of events) {
          expect(event).toMatchObject({
            feature: "lesson_generation",
            operation: "packet_generate",
            provider: "openrouter",
            scope_kind: "run",
            generation_run_id: runId,
            deck_id: deckId,
          });
        }
        const eventsUsd = events.reduce((sum, event) => sum + Number(event.cost_usd), 0);
        expect(eventsUsd).toBeCloseTo(0.01 * packets, 6);
        expect(summaryOf(row).totalSpentUsd).toBeCloseTo(eventsUsd, 6);
      });

      describe("punkt kontrolny runu agenta w toku po wdrożeniu etapu 5c", () => {
        /** Liczniki, które zapisywała pętla agenta (kontrole 2b i oczyszczenia przy przyjmowaniu). */
        const AGENT_COUNTERS = {
          checkCounters: { hintChecks: 4, openChecks: 2, graderCalls: 2, graderErrors: 1 },
          cleanupCounts: { hintsRemoved: 1, variantsRemoved: 2 },
        };

        async function payloadsOf(versionId: string, objectiveId: string): Promise<Record<string, unknown>[]> {
          const rows = await query<{ payload: Record<string, unknown> }>(
            "select payload from learning_app.item_revisions where deck_version_id = $1 and payload->>'objectiveId' = $2 order by position",
            [versionId, objectiveId],
          );
          return rows.map((row) => row.payload);
        }

        it("pula: liczniki agenta i zagadnienie incomplete z częścią ćwiczeń → przebieg bazowy kończy run, gotowe zagadnienie zostaje stałe", async () => {
          // Próba 1: A gotowe, B błąd przejściowy (prawdziwe ćwiczenia A w punkcie kontrolnym).
          const packets: Packets = { negative: everyPacket(transient) };
          const { services, agent } = await agentWorld({ packets });
          const { runId, deckId } = await createLesson(services, command({ objectiveIds: [OBJECTIVE, NEGATIVE] }));
          await executeLessonGeneration(services, runId);
          const first = await fullRun(runId);
          expect(first.state).toBe("queued");
          const own = parseLessonAgentProgress(first.agent_checkpoint, runId)!.objectives[OBJECTIVE]!;
          expect(own.status).toBe("complete");
          // Surowy JSON jak po próbie agenta przerwanej w trakcie B: liczniki 2b i oczyszczeń, B `incomplete` z częścią ćwiczeń.
          const partialB = own.exercises.slice(0, 2).map((exercise) => ({ ...exercise, objectiveId: NEGATIVE, stem: `${exercise.stem ?? ""} (B)` }));
          await setCheckpoint(runId, {
            ...(first.agent_checkpoint as Record<string, unknown>),
            ...AGENT_COUNTERS,
            objectives: { [OBJECTIVE]: own, [NEGATIVE]: { status: "incomplete", exercises: partialB, examples: [] } },
          });
          packets.negative = [];
          const ownCalls = packetCallsOf(agent, "third_person_s").length;
          await dueNow(runId);

          await executeLessonGeneration(services, runId);

          const row = await fullRun(runId);
          expect(row.state).toBe("succeeded");
          expect(row.error_code).toBeNull();
          // Podsumowanie bez treści (historyczne liczniki kontroli mogą w nim zostać).
          expect(row.agent_checkpoint).toMatchObject({ kind: "summary", attempts: 2 });
          for (const entry of Object.values(summaryOf(row).objectives)) {
            for (const key of Object.keys(entry)) expect(["status", "accepted", "failureCode"]).toContain(key);
          }
          // A stałe: bez nowych paczek, zapisane ćwiczenia z punktu kontrolnego.
          expect(packetCallsOf(agent, "third_person_s")).toHaveLength(ownCalls);
          const version = await versionOf(runId);
          expect((await payloadsOf(version.id, OBJECTIVE)).map((payload) => payload.stem).sort()).toEqual(own.exercises.map((exercise) => exercise.stem).sort());
          // B `incomplete` w puli generowane od nowa: część z punktu kontrolnego nie trafia do szkicu.
          const negativeStems = (await payloadsOf(version.id, NEGATIVE)).map((payload) => payload.stem);
          expect(negativeStems.length).toBeGreaterThan(0);
          for (const exercise of partialB) expect(negativeStems).not.toContain(exercise.stem);
          expect(contextOf(version).generationGaps).toBeUndefined();
          // Oczyszczenia agenta przeniesione do szkicu (DTO), liczniki kontroli nie.
          expect(contextOf(version).cleanupCounts).toEqual(AGENT_COUNTERS.cleanupCounts);
          expect((await readLessonDeck(services, deckId)).draft!.cleanupCounts).toEqual({ ...AGENT_COUNTERS.cleanupCounts, quotesSnapped: 0 });
          expect(version.lesson_context).not.toHaveProperty("checkCounters");
        });

        it("„+N”: zagadnienie incomplete z częścią nowych ćwiczeń → zostają stałe, przebieg bazowy dogenerowuje resztę", async () => {
          const { services } = await agentWorld();
          // Prawdziwe ćwiczenie zagadnienia spoza szkicu: z puli drugiej lekcji (inne pasmo numeracji fake'a).
          const other = await createLesson(services, command());
          await executeLessonGeneration(services, other.runId);
          const [partial] = (await orderedDraftExercises(services.db, (await versionOf(other.runId)).id))
            .filter((exercise) => exercise.exerciseType === "lesson_choice");
          expect(partial).toBeDefined();

          const lesson = await createLesson(services, command());
          await executeLessonGeneration(services, lesson.runId);
          const draft = await versionOf(lesson.runId);
          const ownBefore = (await payloadsOf(draft.id, OBJECTIVE)).length;
          const add = await regenerateObjective(services, {
            deckId: lesson.deckId,
            objectiveId: OBJECTIVE,
            count: 3,
            expectedEditNumber: draft.edit_number,
            clientRequestId: randomUUID(),
          });
          await setCheckpoint(add.runId, {
            ...emptyLessonAgentProgress(),
            ...AGENT_COUNTERS,
            objectives: { [OBJECTIVE]: { status: "incomplete", exercises: [partial], examples: [] } },
            budgetSpentUsd: 0.05,
            totalSpentUsd: 0.05,
          });

          await executeLessonGeneration(services, add.runId);

          const row = await fullRun(add.runId);
          expect(row.state).toBe("succeeded");
          const stems = (await payloadsOf(draft.id, OBJECTIVE)).map((payload) => payload.stem);
          // Część z punktu kontrolnego zapisana raz, razem z dogenerowaną resztą (+3 łącznie).
          expect(stems.filter((stem) => stem === partial!.stem)).toHaveLength(1);
          expect(stems.length).toBeGreaterThanOrEqual(ownBefore + 3);
          expect(contextOf(await versionOf(add.runId)).generationGaps).toBeUndefined();
          expect(summaryOf(row).totalSpentUsd).toBeGreaterThanOrEqual(0.05);
        });
      });
    });

    describe("dogenerowanie +N", () => {
      interface DraftRow {
        id: string;
        position: number;
        payload: Record<string, unknown>;
      }

      async function draftRows(versionId: string): Promise<DraftRow[]> {
        return query<DraftRow>(
          "select id, position, payload from learning_app.item_revisions where deck_version_id = $1 order by position",
          [versionId],
        );
      }

      interface AddWorld extends AgentWorld {
        readonly packets: Packets;
        readonly checker: HeldChecker;
      }

      /** Świat z mutowalnymi scenariuszami paczek i kontrolą zamkniętych, którą można zatrzymać na bramce. */
      async function addWorld(): Promise<AddWorld> {
        const packets: Packets = {};
        const checker = new HeldChecker();
        return { ...(await agentWorld({ packets }, { checker })), packets, checker };
      }

      /**
       * Lekcja gramatyki z pulą z generatora fake'a i run „Dogeneruj +N” zagadnienia w kolejce; `steps` — kroki
       * paczek dogenerowania (od następnego wywołania; brak = generator).
       */
      async function draftWithAdd(
        world: AddWorld,
        count: number,
        options: { steps?: readonly FakePacketStep[]; prepare?: (versionId: string) => Promise<void> } = {},
      ) {
        const { services } = world;
        const lesson = await createLesson(services, command());
        await executeLessonGeneration(services, lesson.runId);
        expect((await fullRun(lesson.runId)).state).toBe("succeeded");
        const draft = await versionOf(lesson.runId);
        await options.prepare?.(draft.id);
        if (options.steps !== undefined) world.packets.third_person_s = fromNextCall(world.agent, "third_person_s", options.steps);
        const add = await regenerateObjective(services, {
          deckId: lesson.deckId,
          objectiveId: OBJECTIVE,
          count,
          expectedEditNumber: draft.edit_number,
          clientRequestId: randomUUID(),
        });
        return { draft, add, deckId: lesson.deckId, before: await draftRows(draft.id), poolRunId: lesson.runId, callsBefore: world.agent.packetCalls.length };
      }

      const catalogObjective = englishGrammarSubject.topics.flatMap((topic) => topic.objectives).find((objective) => objective.id === OBJECTIVE)!;

      /** Wybór gramatyki zagadnienia, którego rozwiązane zdanie (`stem` z poprawną opcją) to `stem` z `answer`. */
      const choiceExercise = (stem: string, answer: string): LessonExerciseDraft => ({
        exerciseType: "lesson_choice",
        objectiveId: OBJECTIVE,
        instructionPl: "Wybierz.",
        stem,
        answer,
        acceptedAnswers: [],
        focus: [],
        // Dystraktor `<odpowiedź>x` jak w fake'u: kontrola zamkniętych fake'a wskazuje opcję-przedrostek.
        options: [{ id: "a", text: answer }, { id: "b", text: `${answer}x` }],
        correctOption: "a",
      });

      /** Luka gramatyki zagadnienia; rozwiązane zdanie = `stem` z `answer` w miejscu luki. */
      const gapExercise = (stem: string, answer: string): LessonExerciseDraft => ({
        exerciseType: "lesson_gap",
        objectiveId: OBJECTIVE,
        instructionPl: "Uzupełnij.",
        stem,
        answer,
        acceptedAnswers: [],
        focus: [answer],
      });

      const storyOf = (sentences: string[]) => ({
        sentences,
        questions: [
          {
            id: "q1",
            question: "Kto jest w historyjce?",
            options: [
              { id: "a", text: "Tom" },
              { id: "b", text: "Ola" },
              { id: "c", text: "Ewa" },
            ],
            correctOption: "a",
          },
        ],
      });

      /** Historyjka szkicu na starcie runu (zdania spoza puli fake: materiał to „He plays football…”). */
      const STORY_START = storyOf(["Tom has a small dog.", "The dog is brown and fast.", "Every morning they run in the park.", "Tom loves his dog."]);
      /** Historyjka zapisana w trakcie runu (run historyjki nie podbija numeru edycji). */
      const STORY_LATE = storyOf(["Sam rides his red bike.", "The bike is fast and shiny.", "They go to the park.", "Sam is very happy."]);

      /** Ćwiczenie, którego rozwiązanie powtarza zdanie `STORY_LATE` (kolizja wykrywana dopiero przy zapisie). */
      const lateCollision = () => choiceExercise("Sam ___ his red bike.", "rides");

      it("dogeneruj +2 → najwyżej 2+stageGap+listenLeft nowych, szkic nietknięty, generationGaps bez wpisu zagadnienia", async () => {
        // Każda paczka dogenerowania zwraca trzy razy więcej ćwiczeń, niż zamówiono.
        const world = await addWorld();
        const { draft, add, before, poolRunId, callsBefore } = await draftWithAdd(world, 2, {
          steps: everyPacket(() => generatorStep(undefined, 3)),
          // Luki z wcześniejszego generowania: wpis tego zagadnienia znika, wpis innego zostaje.
          prepare: (versionId) =>
            setContextField(versionId, "generationGaps", [
              { objectiveId: OBJECTIVE, reason: "incomplete" },
              { objectiveId: NEGATIVE, reason: "failed" },
            ]),
        });
        const contextBefore = contextOf(await versionOf(add.runId));

        await executeLessonGeneration(world.services, add.runId);

        const row = await fullRun(add.runId);
        expect(row.state).toBe("succeeded");
        const calls = world.agent.packetCalls.slice(callsBefore);
        expect(calls.every((call) => call.objective.id === OBJECTIVE && !call.withExamples)).toBe(true);
        // Oczekiwane liczby ze szkicu, niezależnie od zamówień paczek: pula pierwszego runu jest kompletem
        // (brak braków etapów → stageGap = 0), a reszta dodatku słuchowego = limit zagadnienia − ćwiczenia
        // słuchowe zagadnienia w szkicu.
        expect(summaryOf(await fullRun(poolRunId)).objectives[OBJECTIVE]!.status).toBe("complete");
        const stageGap = 0;
        const listenInDraft = before.filter((item) => item.payload.objectiveId === OBJECTIVE && item.payload.exerciseType === "lesson_listen_choice").length;
        const listenLeft = Math.max(0, listenChoiceAllowance(englishGrammarSubject, catalogObjective, []) - listenInDraft);
        // Paczki: udziały etapów = 2 + braki etapów (zamówienie = udział + zapas), słuchanie = reszta dodatku słuchowego.
        const stagePackets = calls.filter((call) => call.type !== "lesson_listen_choice");
        expect(stagePackets.reduce((sum, call) => sum + call.count - PACKET_RESERVE, 0)).toBe(2 + stageGap);
        expect(calls.filter((call) => call.type === "lesson_listen_choice").map((call) => call.count)).toEqual(listenLeft > 0 ? [listenLeft] : []);
        const after = await draftRows(draft.id);
        // Szkic nietknięty: wcześniejsze ćwiczenia bez zmian, nowe dopisane za nimi.
        expect(after.slice(0, before.length)).toEqual(before);
        const added = after.length - before.length;
        expect(added).toBeGreaterThanOrEqual(2);
        expect(added).toBeLessThanOrEqual(2 + stageGap + listenLeft);
        // Zapis nie usunął żadnego z przyjętych nowych ćwiczeń.
        expect(summaryOf(row).objectives[OBJECTIVE]).toMatchObject({ accepted: added });
        const version = await versionOf(add.runId);
        expect(version.edit_number).toBe(draft.edit_number + 1);
        expect(contextOf(version).rejectedCount).toBe(contextBefore.rejectedCount ?? 0);
        expect(contextOf(version).generationGaps).toEqual([{ objectiveId: NEGATIVE, reason: "failed" }]);
        expectSummaryWithoutContent(row.agent_checkpoint, 1);
      });

      it("dogeneruj ze zdaniem historyjki → paczki dostają je jako zdania do unikania; kolizja w zapisie odrzucona", async () => {
        // Paczka wyboru: ćwiczenie z rozwiązaniem ze zdania historyjki zapisanej w trakcie runu (przebieg bazowy jej
        // nie zna), paczka luki: jedno zwykłe ćwiczenie — walidacja puli przyjmuje oba, zapis odrzuca kolizję.
        // Kontrola zamkniętych paczki wyboru jest „w locie”, gdy run historyjki zapisuje nową historyjkę.
        const world = await addWorld();
        const step = generatorStep((exercises, input) => (input.type === "lesson_choice" ? [lateCollision()] : exercises.slice(0, 1)));
        const { draft, add, before, callsBefore } = await draftWithAdd(world, 2, {
          steps: everyPacket(step),
          prepare: (versionId) => setContextField(versionId, "story", STORY_START),
        });
        const contextBefore = contextOf(await versionOf(add.runId));
        const inFlight = gate();
        world.checker.hold(inFlight);

        const running = executeLessonGeneration(world.services, add.runId);
        await inFlight.reached;
        // Paczki dogenerowania wyboru i luki; zdania historyjki ze startu są w zdaniach do unikania każdej paczki.
        const calls = world.agent.packetCalls.slice(callsBefore);
        expect(calls.map((call) => call.type).sort()).toEqual(["lesson_choice", "lesson_gap"]);
        for (const call of calls) expect(call.pool.avoidSentences).toEqual(expect.arrayContaining(STORY_START.sentences));
        // Run historyjki zapisuje nową historyjkę w trakcie (bez podbicia numeru edycji).
        await setContextField(draft.id, "story", STORY_LATE);
        inFlight.open();
        await running;

        const row = await fullRun(add.runId);
        expect(row.state).toBe("succeeded");
        expect(summaryOf(row).objectives[OBJECTIVE]).toMatchObject({ accepted: 2 });
        const after = await draftRows(draft.id);
        expect(after).toHaveLength(before.length + 1);
        expect(after.map((item) => item.payload.stem)).not.toContain(lateCollision().stem);
        const version = await versionOf(add.runId);
        expect(contextOf(version).rejectedCount).toBe((contextBefore.rejectedCount ?? 0) + 1);
        // „Dodano k z N” liczy ćwiczenia zapisane, nie przyjęte w walidacji puli.
        expect(contextOf(version).generationGaps).toEqual([{ objectiveId: OBJECTIVE, reason: "add_short", added: 1, requested: 2 }]);
        expect((version.lesson_context as { story?: unknown }).story).toEqual(STORY_LATE);
      });

      it("pełna pula: kolizja z historyjką w zapisie, zapisana pula nadal pełna → bez luki", async () => {
        // Pula z generatora fake'a (komplet) i jedno dodatkowe ćwiczenie luki, którego rozwiązanie powtarza zdanie historyjki
        // szkicu — przebieg bazowy w trybie puli historyjki nie zna, przyjmuje je; zapis je odrzuca.
        const collision = gapExercise("Sam ___ his red bike.", "rides");
        const step = generatorStep((exercises, input) => (input.type === "lesson_gap" ? [collision, ...exercises] : exercises));
        const { services } = await agentWorld({ packets: { third_person_s: everyPacket(step) } });
        const { runId } = await createLesson(services, command());
        const before = await versionOf(runId);
        await setContextField(before.id, "story", STORY_LATE);

        await executeLessonGeneration(services, runId);

        const row = await fullRun(runId);
        expect(row.state).toBe("succeeded");
        // Walidacja puli uznała zagadnienie za komplet…
        expect(summaryOf(row).objectives[OBJECTIVE]!.status).toBe("complete");
        const version = await versionOf(runId);
        expect((await draftRows(version.id)).map((item) => item.payload.stem)).not.toContain(collision.stem);
        expect(contextOf(version).rejectedCount).toBe((contextOf(before).rejectedCount ?? 0) + 1);
        // …zapis odrzucił nadmiarowe ćwiczenie, a status liczony od nowa na zapisanej lekcji to nadal komplet.
        expect(contextOf(version).generationGaps).toBeUndefined();
      });

      it("dogeneruj z błędem przejściowym → requeue → łącznie ≤ limitu, bez duplikatów", async () => {
        // Próba 1: każda paczka dogenerowania z ponowieniem pada przejściowo (zagadnienie `failed`, bez ćwiczeń);
        // próba 2: generator fake'a w paczkach zamawiających trzy razy więcej, niż wolno przyjąć.
        const world = await addWorld();
        const { draft, add, before, callsBefore } = await draftWithAdd(world, 3, { steps: everyPacket(transient) });

        await executeLessonGeneration(world.services, add.runId);
        const requeued = await fullRun(add.runId);
        expect(requeued.state).toBe("queued");
        expect(requeued.error_code).toBe("provider");
        const firstAttempt = parseLessonAgentProgress(requeued.agent_checkpoint, add.runId)!.objectives[OBJECTIVE]!;
        expect(firstAttempt.status).toBe("failed");
        // Porażka paczki oblewa zagadnienie: nic z próby 1 nie przechodzi do punktu kontrolnego.
        expect(firstAttempt.exercises).toEqual([]);
        // Szkic bez zmian do zapisu końcowego.
        expect(await draftRows(draft.id)).toEqual(before);
        const firstCalls = world.agent.packetCalls.slice(callsBefore);
        world.packets.third_person_s = fromNextCall(world.agent, "third_person_s", everyPacket(() => generatorStep(undefined, 3)));
        await dueNow(add.runId);

        await executeLessonGeneration(world.services, add.runId);

        const row = await fullRun(add.runId);
        expect(row.state).toBe("succeeded");
        expect(row.attempts).toBe(2);
        // Ponowienie prosi o te same paczki (+3 od nowa): typy i zamówienia jak w próbie 1 (bez jej ponowień paczek).
        const packetsOf = (calls: readonly LessonPacketInput[]) => [...new Set(calls.map((call) => `${call.type}:${call.count}`))].sort();
        const secondCalls = world.agent.packetCalls.slice(callsBefore + firstCalls.length);
        expect(packetsOf(secondCalls)).toEqual(packetsOf(firstCalls));
        expect(secondCalls).toHaveLength(firstCalls.length / 2);
        const listenLeft = Math.max(
          0,
          listenChoiceAllowance(englishGrammarSubject, catalogObjective, [])
            - before.filter((item) => item.payload.objectiveId === OBJECTIVE && item.payload.exerciseType === "lesson_listen_choice").length,
        );
        const after = await draftRows(draft.id);
        expect(after.slice(0, before.length)).toEqual(before);
        const added = after.slice(before.length);
        expect(added.length).toBeGreaterThanOrEqual(3);
        expect(added.length).toBeLessThanOrEqual(3 + listenLeft);
        const answers = after.map((item) => String(item.payload.answer).toLowerCase());
        expect(new Set(answers).size).toBe(answers.length);
      });

      it("dogeneruj bez nowych → failed, editNumber bez zmian", async () => {
        const world = await addWorld();
        const { draft, add, before, callsBefore } = await draftWithAdd(world, 2, { steps: everyPacket(EMPTY) });

        await executeLessonGeneration(world.services, add.runId);

        const row = await fullRun(add.runId);
        expect(row.state).toBe("failed");
        expect(row.error_code).toBe("validation");
        expect(row.next_attempt_at).toBeNull();
        // Jedno wywołanie na paczkę planu „+2” (braki etapów 0, bez słuchania: dodatek słuchowy wykorzystany w puli).
        const plan = packetPlanForTargets(catalogObjective, poolStageCounts(englishGrammarSubject, catalogObjective.exerciseTypes, 2), false, 0);
        expect(world.agent.packetCalls.slice(callsBefore).map((call) => call.type)).toEqual(plan.packets.map((packet) => packet.type));
        const version = await versionOf(add.runId);
        expect(version.edit_number).toBe(draft.edit_number);
        expect(await draftRows(draft.id)).toEqual(before);
        expect(contextOf(version).generationGaps).toBeUndefined();
      });

      it("dogeneruj z niedoborem → add_short dodano k z N", async () => {
        // Model zwraca tylko jedno ćwiczenie wyboru; pozostałe paczki puste.
        const world = await addWorld();
        const step = generatorStep((exercises, input) => (input.type === "lesson_choice" ? exercises.slice(0, 1) : []));
        const { draft, add, before } = await draftWithAdd(world, 3, { steps: everyPacket(step) });

        await executeLessonGeneration(world.services, add.runId);

        const row = await fullRun(add.runId);
        expect(row.state).toBe("succeeded");
        expect(await draftRows(draft.id)).toHaveLength(before.length + 1);
        const version = await versionOf(add.runId);
        expect(version.edit_number).toBe(draft.edit_number + 1);
        expect(contextOf(version).generationGaps).toEqual([{ objectiveId: OBJECTIVE, reason: "add_short", added: 1, requested: 3 }]);
      });

      it("wszystkie nowe odpadły na kolizji z historyjką → failed validation; „Ponów” → sukces, liczniki usunięć w kontekście raz", async () => {
        // Jedyne ćwiczenie dogenerowania koliduje z historyjką zapisaną w trakcie (kontrola zamkniętych „w locie”);
        // po „Ponów” — generator fake'a.
        const world = await addWorld();
        const step = generatorStep((_exercises, input) => (input.type === "lesson_choice" ? [lateCollision()] : []));
        const { draft, add, before } = await draftWithAdd(world, 2, { steps: everyPacket(step) });
        const contextBefore = contextOf(await versionOf(add.runId));
        // Wcześniejsza próba: 2 usunięcia bezpiecznika kierownika.
        await setCheckpoint(add.runId, { ...emptyLessonAgentProgress(), removedAfterAcceptance: 2 });
        const inFlight = gate();
        world.checker.hold(inFlight);

        const running = executeLessonGeneration(world.services, add.runId);
        await inFlight.reached;
        await setContextField(draft.id, "story", STORY_LATE);
        inFlight.open();
        await running;

        const failed = await fullRun(add.runId);
        expect(failed.state).toBe("failed");
        expect(failed.error_code).toBe("validation");
        expect(await draftRows(draft.id)).toEqual(before);
        // 2 (bezpiecznik) + 1 (kolizja w zapisie).
        expect(contextOf(await versionOf(add.runId)).rejectedCount).toBe((contextBefore.rejectedCount ?? 0) + 3);
        // Punkt kontrolny bez policzonych już usunięć i bez odrzuconych ćwiczeń (inaczej „Ponów” liczyłby je znowu).
        const saved = parseLessonAgentProgress(failed.agent_checkpoint, add.runId)!;
        expect(saved.removedAfterAcceptance).toBe(0);
        expect(saved.objectives[OBJECTIVE]!.exercises).toEqual([]);

        world.packets.third_person_s = [];
        await retryGeneration(world.services, add.runId);
        await executeLessonGeneration(world.services, add.runId);

        expect((await fullRun(add.runId)).state).toBe("succeeded");
        const after = await draftRows(draft.id);
        expect(after.length).toBeGreaterThanOrEqual(before.length + 2);
        expect(after.map((item) => item.payload.stem)).not.toContain(lateCollision().stem);
        expect(contextOf(await versionOf(add.runId)).rejectedCount).toBe((contextBefore.rejectedCount ?? 0) + 3);
      });

      it("szkic z historycznymi cleanupCounts po „+N” zwraca te same cleanupCounts w DTO", async () => {
        // Oczyszczenia zapisywała pętla agenta przy przyjmowaniu; przebieg bazowy ich nie liczy, ale też nie gubi.
        const historical = { hintsRemoved: 3, variantsRemoved: 5 };
        const world = await addWorld();
        const { add, deckId } = await draftWithAdd(world, 2, { prepare: (versionId) => setContextField(versionId, "cleanupCounts", historical) });
        expect((await readLessonDeck(world.services, deckId)).draft!.cleanupCounts).toEqual({ ...historical, quotesSnapped: 0 });

        await executeLessonGeneration(world.services, add.runId);

        expect((await fullRun(add.runId)).state).toBe("succeeded");
        expect(contextOf(await versionOf(add.runId)).cleanupCounts).toEqual(historical);
        expect((await readLessonDeck(world.services, deckId)).draft!.cleanupCounts).toEqual({ ...historical, quotesSnapped: 0 });
      });
    });

    describe("brak agenta (#237 etap 3)", () => {
      /** Usługi tego samego świata (baza, fake'i, zegar) z workerem bez agenta puli. */
      function withoutAgent(world: AgentWorld, lessonAgent: GenerationDeps["lessonAgent"]): Services {
        const { lessonAgent: _agent, ...deps } = world.fakes.deps;
        return servicesWith(world.fakes, lessonAgent === undefined ? deps : { ...deps, lessonAgent }, world.clock);
      }

      /** Identyfikatory rewizji szkicu w kolejności lekcji. */
      async function revisionIds(versionId: string): Promise<string[]> {
        const rows = await query<{ id: string }>(
          "select id from learning_app.item_revisions where deck_version_id = $1 order by position, id",
          [versionId],
        );
        return rows.map((row) => row.id);
      }

      async function objectiveExerciseCount(versionId: string, objectiveId: string): Promise<number> {
        const [row] = await query<{ count: string }>(
          "select count(*) from learning_app.item_revisions where deck_version_id = $1 and payload->>'objectiveId' = $2",
          [versionId, objectiveId],
        );
        return Number(row!.count);
      }

      /** Tekst kolumny punktu kontrolnego (porównanie bajt w bajt). */
      async function checkpointText(runId: string): Promise<string | null> {
        const [row] = await query<{ checkpoint: string | null }>(
          "select agent_checkpoint::text as checkpoint from learning_app.generation_runs where id = $1",
          [runId],
        );
        return row!.checkpoint;
      }

      async function setRunInput(runId: string, patch: Record<string, unknown>): Promise<void> {
        await pool.query("update learning_app.generation_runs set input = input || $1::jsonb where id = $2", [JSON.stringify(patch), runId]);
      }

      function expectUnavailable(row: FullRunRow): void {
        expect(row.state).toBe("failed");
        expect(row.error_code).toBe("lesson_agent_unavailable");
        expect(row.attempts).toBe(1);
        expect(row.next_attempt_at).toBeNull();
      }

      const UNAVAILABLE: ReadonlyArray<[string, GenerationDeps["lessonAgent"]]> = [
        ["brak klucza OpenRouter", { unavailable: "no_openrouter_key" }],
        ["brak pola lessonAgent", undefined],
      ];

      describe.each(UNAVAILABLE)("%s", (_label, lessonAgent) => {
        it("pełna generacja gramatyki → failed lesson_agent_unavailable po claimie, bez modeli, punkt kontrolny nietknięty", async () => {
          const world = await agentWorld();
          const services = withoutAgent(world, lessonAgent);
          const { runId } = await createLesson(services, command());
          const before = await versionOf(runId);
          // Uszkodzony punkt kontrolny (np. po „Ponów” starej próby): brak agenta go nie czyta ani nie zmienia.
          await setCheckpoint(runId, { version: 99, objectives: "uszkodzony", budgetSpentUsd: "x" });
          const checkpointBefore = await checkpointText(runId);

          await executeLessonGeneration(services, runId);

          expectUnavailable(await fullRun(runId));
          expect(await checkpointText(runId)).toBe(checkpointBefore);
          expect(world.agent.packetCalls).toEqual([]);
          expect(world.fakes.llm.objectiveRequests).toEqual([]);
          expect(world.fakes.llm.storyRequests).toEqual([]);
          const after = await versionOf(runId);
          expect(after.edit_number).toBe(before.edit_number);
          expect(await exerciseCount(after.id)).toBe(0);
          expect(await storyRunStates(after.id)).toEqual([]);
        });

        it("szkoła: bez etapu zagadnień", async () => {
          const world = await agentWorld();
          const services = withoutAgent(world, lessonAgent);
          const school = await createSchoolLesson(services, {
            subjectTitlePl: "Geografia",
            topicTitlePl: "Polska",
            material: SCHOOL_MATERIAL,
            poolSize: 40,
            clientRequestId: randomUUID(),
          });

          await executeLessonGeneration(services, school.runId);

          expectUnavailable(await fullRun(school.runId));
          expect(world.fakes.llm.objectiveRequests).toEqual([]);
          expect(world.agent.packetCalls).toEqual([]);
          expect(await exerciseCount((await versionOf(school.runId)).id)).toBe(0);
        });

        it("„+N” → failed lesson_agent_unavailable, szkic i editNumber bez zmian", async () => {
          const world = await agentWorld();
          const lesson = await createLesson(world.services, command());
          await executeLessonGeneration(world.services, lesson.runId);
          expect((await fullRun(lesson.runId)).state).toBe("succeeded");
          const draft = await versionOf(lesson.runId);
          const revisionsBefore = await revisionIds(draft.id);
          const add = await regenerateObjective(world.services, {
            deckId: lesson.deckId,
            objectiveId: OBJECTIVE,
            count: 4,
            expectedEditNumber: draft.edit_number,
            clientRequestId: randomUUID(),
          });
          const callsBefore = world.agent.packetCalls.length;

          await executeLessonGeneration(withoutAgent(world, lessonAgent), add.runId);

          expectUnavailable(await fullRun(add.runId));
          expect(world.agent.packetCalls).toHaveLength(callsBefore);
          expect((await versionOf(add.runId)).edit_number).toBe(draft.edit_number);
          expect(await revisionIds(draft.id)).toEqual(revisionsBefore);
        });

        it("run historyjki z kolejki się wykonuje", async () => {
          const world = await agentWorld();
          const lesson = await createLesson(world.services, command());
          await executeLessonGeneration(world.services, lesson.runId);
          const draft = await versionOf(lesson.runId);
          const [story] = await query<{ id: string }>(
            "select id from learning_app.generation_runs where deck_version_id = $1 and input->>'purpose' = 'story'",
            [draft.id],
          );

          await executeLessonGeneration(withoutAgent(world, lessonAgent), story!.id);

          expect((await fullRun(story!.id)).state).toBe("succeeded");
          expect(world.fakes.llm.storyRequests).toHaveLength(1);
        });

        it("nieznany przedmiot → failed validation (przed sprawdzeniem agenta)", async () => {
          const world = await agentWorld();
          const services = withoutAgent(world, lessonAgent);
          const { runId } = await createLesson(services, command());
          await setRunInput(runId, { subjectId: "no_such_subject" });

          await executeLessonGeneration(services, runId);

          const row = await fullRun(runId);
          expect(row.state).toBe("failed");
          expect(row.error_code).toBe("validation");
        });

        it("„Ponów” po dodaniu klucza → succeeded przebiegiem bazowym", async () => {
          const world = await agentWorld();
          const { runId } = await createLesson(world.services, command());
          await executeLessonGeneration(withoutAgent(world, lessonAgent), runId);
          expect((await fullRun(runId)).error_code).toBe("lesson_agent_unavailable");

          await retryGeneration(world.services, runId);
          await executeLessonGeneration(world.services, runId);

          const row = await fullRun(runId);
          expect(row.state).toBe("succeeded");
          expect(new Set(world.agent.packetCalls.map((call) => call.objective.id))).toEqual(new Set([OBJECTIVE]));
          expect(await exerciseCount((await versionOf(runId)).id)).toBeGreaterThan(0);
        });
      });

      it("nieznany przedmiot przy dostępnym generatorze → failed validation bez wywołań", async () => {
        const { services, agent } = await agentWorld();
        const { runId } = await createLesson(services, command());
        await setRunInput(runId, { subjectId: "no_such_subject" });

        await executeLessonGeneration(services, runId);

        const row = await fullRun(runId);
        expect(row.state).toBe("failed");
        expect(row.error_code).toBe("validation");
        expect(agent.packetCalls).toEqual([]);
      });

      it("runy z kolejki sprzed wdrożenia z polami potoku (purpose, existingAnswers, existingExercises) wykonuje przebieg bazowy", async () => {
        const { services, agent } = await agentWorld();
        const lesson = await createLesson(services, command());
        await setRunInput(lesson.runId, { purpose: "pool" });
        await executeLessonGeneration(services, lesson.runId);
        expect((await fullRun(lesson.runId)).state).toBe("succeeded");
        const draft = await versionOf(lesson.runId);
        const revisionsBefore = await revisionIds(draft.id);
        const objectiveBefore = await objectiveExerciseCount(draft.id, OBJECTIVE);
        const add = await regenerateObjective(services, {
          deckId: lesson.deckId,
          objectiveId: OBJECTIVE,
          count: 4,
          expectedEditNumber: draft.edit_number,
          clientRequestId: randomUUID(),
        });
        await setRunInput(add.runId, {
          regenerate: {
            objectiveId: OBJECTIVE,
            count: 4,
            existingAnswers: ["x"],
            existingExercises: [{ objectiveId: OBJECTIVE, exerciseType: "lesson_choice", stimulus: "He ___ football." }],
          },
        });
        const callsBefore = agent.packetCalls.length;

        await executeLessonGeneration(services, add.runId);

        expect((await fullRun(add.runId)).state).toBe("succeeded");
        expect(agent.packetCalls[callsBefore]!.objective.id).toBe(OBJECTIVE);
        expect(await objectiveExerciseCount(draft.id, OBJECTIVE)).toBeGreaterThanOrEqual(objectiveBefore + 4);
        expect(await revisionIds(draft.id)).toEqual(expect.arrayContaining(revisionsBefore));
      });
    });
  });

  describe("gramatyka przebiegiem bazowym na ścieżce workera (etap 4 #358)", () => {
    const disposers: Array<() => Promise<void>> = [];
    const THIRD = "english_grammar.present_simple.third_person_s";
    const QUESTION = "english_grammar.present_simple.question";

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

    async function grammarWorld(agentOptions: FakeLessonPoolAgentOptions = {}) {
      const fakes = await fakeGeneration({ agent: { stepCostUsd: 0.01, ...agentOptions } });
      disposers.push(fakes.dispose);
      const services = createServices({
        db: testDatabase().db,
        clock: new ManualClock(),
        media: fakes.settings,
        generation: fakes.deps,
        subjects: createSubjectRegistry([englishGrammarSubject]),
      });
      return { services, agent: fakes.agent };
    }

    const both = (): LessonCommand => command({ objectiveIds: [THIRD, QUESTION], poolSize: 24 });
    const stateOf = async (runId: string) => (await query<{ state: string; attempts: number }>("select state, attempts from learning_app.generation_runs where id = $1", [runId]))[0]!;

    it("nowa lekcja: paczki, szkic bez luk", async () => {
      const { services, agent } = await grammarWorld();
      const { runId, deckId } = await createLesson(services, both());
      await executeLessonGeneration(services, runId);
      expect((await stateOf(runId)).state).toBe("succeeded");
      expect(agent.packetCalls.length).toBeGreaterThan(0);
      const draft = (await readLessonDeck(services, deckId)).draft!;
      expect(draft.generationGaps ?? []).toEqual([]);
      expect(new Set(draft.exercises.map((item) => item.objectiveId))).toEqual(new Set([THIRD, QUESTION]));
    });

    it("wznowienie: przejściowa porażka paczki → queued; druga próba nie generuje zagadnienia gotowego", async () => {
      // Każda paczka zagadnienia `question` i jej ponowienie w próbie 1 kończą się błędem przejściowym; potem generator.
      const packets: NonNullable<FakeLessonPoolAgentOptions["packets"]> = { question: everyPacket(() => ({ throw: new GenerationProviderError("transient") }), 40) };
      const { services, agent } = await grammarWorld({ packets });
      const { runId, deckId } = await createLesson(services, both());
      await executeLessonGeneration(services, runId);
      expect((await stateOf(runId)).state).toBe("queued");
      packets.question = [];
      const firstCalls = agent.packetCalls.filter((call) => call.objective.id === THIRD).length;
      await pool.query("update learning_app.generation_runs set next_attempt_at = null where id = $1", [runId]);
      await executeLessonGeneration(services, runId);
      expect(await stateOf(runId)).toMatchObject({ state: "succeeded", attempts: 2 });
      expect(agent.packetCalls.filter((call) => call.objective.id === THIRD)).toHaveLength(firstCalls);
      const draft = (await readLessonDeck(services, deckId)).draft!;
      expect(draft.exercises.some((item) => item.objectiveId === QUESTION)).toBe(true);
    });

    it("dogenerowanie zagadnienia szkicu idzie przebiegiem bazowym i dodaje zamówione", async () => {
      const { services, agent } = await grammarWorld();
      const { runId, deckId } = await createLesson(services, both());
      await executeLessonGeneration(services, runId);
      const before = (await readLessonDeck(services, deckId)).draft!;
      const topUp = await regenerateObjective(services, { deckId, objectiveId: THIRD, count: 3, expectedEditNumber: before.editNumber, clientRequestId: randomUUID() });
      const callsBefore = agent.packetCalls.length;
      await executeLessonGeneration(services, topUp.runId);
      expect((await stateOf(topUp.runId)).state).toBe("succeeded");
      const added = agent.packetCalls.slice(callsBefore);
      expect(added.length).toBeGreaterThan(0);
      expect(added.every((call) => call.objective.id === THIRD && !call.withExamples && call.type !== "lesson_notice")).toBe(true);
      const after = (await readLessonDeck(services, deckId)).draft!;
      expect(after.exercises.filter((item) => item.objectiveId === THIRD).length).toBe(before.exercises.filter((item) => item.objectiveId === THIRD).length + 3);
    });
  });
});
