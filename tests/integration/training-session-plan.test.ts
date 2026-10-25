import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { createChild, createDraft, publishDraft, upsertAssignment, startSession, nextTask, endSession, completePresentation, submitAttempt, createServices, executeMediaAsset, prepareUiAudio, reconcileDraftAssets, runDueGenerationWork } from "@learning/server";
import { randomUUID } from "node:crypto";
import { buildTestServices, ManualClock, openRestartedServices, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import { readTrainingSessionPlan } from "@learning/server";
import { issueNextVocabularyPlanTask } from "../../packages/server/src/modules/learning/vocabulary-plan-tasks";
import { childProfiles, itemRevisionSkills, learningSessions } from "../../packages/server/src/db/schema";
import type { TrainingSessionPlanSnapshot, TrainingSessionSlot } from "../../packages/server/src/domain/training-session-plan";
import { computeTargetKey } from "../../packages/server/src/domain/target-key";
import type { Tx } from "../../packages/server/src/db/client";
import { childSkillProgress, childTargetExposures, eventExposures, learningEvents, sessionTasks } from "../../packages/server/src/db/schema";

const { and, eq } = createRequire(new URL("../../packages/server/package.json", import.meta.url))("drizzle-orm") as typeof import("../../packages/server/node_modules/drizzle-orm");

const { pool } = testDatabase();
const pairs = Array.from({ length: 4 }, (_, index) => ({ source: `słowo ${index}`, target: `word${index}` }));

describe("stały plan treningu słówek", () => {
  let services: ReturnType<typeof buildTestServices>["services"];
  let childId: string;
  let deckId: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query("truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade");
    services = buildTestServices().services;
    childId = (await createChild(services, { displayName: "Ola", avatarKey: "fox" })).id;
    const draft = await createDraft(services, { title: "Stały plan", items: pairs.map(({ source, target }) => ({ source, target, acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "color" as const, visualData: { color: "#4169e1" } })) });
    const revisions = (await pool.query("select id from learning_app.item_revisions where deck_version_id=$1 order by position", [draft.id])).rows as {id:string}[];
    for (const [index, revision] of revisions.entries()) {
      const assetId = randomUUID(), fingerprint = `training-${assetId}`;
      await pool.query("insert into learning_app.media_assets (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model) values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',128,'fake','fake')", [assetId,fingerprint,`blob/${assetId}`,`sha-${assetId}`]);
      await pool.query("insert into learning_app.revision_assets (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'target_audio',$2,$3,'approved')", [revision.id,assetId,fingerprint]);
      await pool.query("insert into learning_app.revision_assets (item_revision_id,role,asset_id,expected_fingerprint,state) values ($1,'illustration',null,$2,'omitted')", [revision.id,`image-${index}-${assetId}`]);
    }
    await publishDraft(services, draft.id, 1);
    deckId = draft.deckId;
    await upsertAssignment(services, childId, deckId, null);
  });

  afterAll(async () => { await pool.end(); });

  async function runPlannedIssue(options: {
    exercises: Array<{ exerciseType: string; assessed?: boolean }>;
    taskBudget: number;
    canRead: boolean;
    microphoneEnabled?: boolean;
    disabledFirst?: boolean;
    throwAfterIssue?: boolean;
    nextOrdinal?: number;
    enrichFirst?: boolean;
    revealKeys?: readonly string[];
    keepsReservations?: readonly string[];
    prepareExistingFacts?: boolean;
    afterIssue?: (tx: Tx, result: Awaited<ReturnType<typeof issueNextVocabularyPlanTask>> | null, session: typeof learningSessions.$inferSelect) => Promise<void>;
  }) {
    const started = await startSession(services, { childId, deckId, microphoneEnabled: options.microphoneEnabled ?? false });
    const [stored] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [started.sessionId])).rows as { training_plan: TrainingSessionPlanSnapshot }[];
    const original = readTrainingSessionPlan(stored!.training_plan)!;
    const slots = options.exercises.map(({ exerciseType, assessed }, ordinal): TrainingSessionSlot => ({
      ...original.slots[ordinal]!, taskId: randomUUID(), ordinal, exerciseType,
      assessed: assessed ?? true, reason: "test-issue", revealsTargetKeys: options.revealKeys ?? [`target-${ordinal}`],
      keepsReservations: options.keepsReservations ?? [`reservation-${ordinal}`],
      ...(options.enrichFirst && ordinal === 0 ? {
        supportCycleId: randomUUID(), skillAtIssue: "recall", statusAtIssue: null,
        assessmentSkills: ["recall", "spelling"],
      } : {}),
    }));
    const plan = readTrainingSessionPlan({ version: 1, taskBudget: options.taskBudget, slots })!;
    const originalSnapshot = structuredClone(plan);
    const revisionId = plan.slots[0]!.itemRevisionId;
    if (options.prepareExistingFacts) {
      const issuedAt = services.clock.now();
      const earlier = new Date(issuedAt.getTime() - 60 * 60 * 1000);
      const later = new Date(issuedAt.getTime() + 60 * 60 * 1000);
      await pool.query(`insert into learning_app.child_skill_progress
        (child_id, skill_version_id, policy_id, status, independent_success_streak, first_issued_at, has_qualifying_assessment, projection_version, updated_at)
        select $1, skill_version_id, $2, 'unseen', 0, $4, false, 'proj-3', $3
        from learning_app.item_revision_skills where item_revision_id=$5 and skill in ('recall','spelling')
        on conflict (child_id,skill_version_id,policy_id) do update set first_issued_at=excluded.first_issued_at, updated_at=excluded.updated_at`, [childId, "learning-v2", earlier, later, revisionId]);
      await pool.query(`insert into learning_app.child_target_exposures (child_id,target_key,first_exposure_at,last_exposure_at)
        values ($1,$2,$4,$3),($1,$5,$4,$3)
        on conflict (child_id,target_key) do update set first_exposure_at=excluded.first_exposure_at,last_exposure_at=excluded.last_exposure_at`,
        [childId, options.revealKeys?.[0], earlier, new Date(issuedAt.getTime() - 2 * 60 * 60 * 1000), options.revealKeys?.[1]]);
    }
    const beforeProgress = options.prepareExistingFacts
      ? (await pool.query("select * from learning_app.child_skill_progress where child_id=$1 and policy_id='learning-v2' order by skill_version_id", [childId])).rows
      : [];
    const beforeExposures = options.prepareExistingFacts
      ? (await pool.query("select * from learning_app.child_target_exposures where child_id=$1 and target_key=any($2::text[]) order by target_key", [childId, options.revealKeys])).rows
      : [];
    const [beforeContext] = (await pool.query("select context from learning_app.learning_sessions where id=$1", [started.sessionId])).rows as { context: Record<string, unknown> }[];
    const run = services.db.transaction(async (tx) => {
      await tx.select({ id: childProfiles.id }).from(childProfiles).where(eq(childProfiles.id, childId)).for("key share");
      let session = (await tx.select().from(learningSessions).where(eq(learningSessions.id, started.sessionId)).for("update"))[0];
      if (!session) throw new Error("expected session");
      session = (await tx.update(learningSessions).set({
        microphoneEnabled: options.microphoneEnabled ?? false,
        context: {
          ...session.context, canRead: options.canRead,
          reservations: ["old-reservation"], microphoneDisabledTaskIds: options.disabledFirst ? [plan.slots[0]!.taskId] : [],
          timezone: "Europe/Warsaw", previousContact: { preserved: "yes" }, settledChecks: ["settled-before"],
        },
      }).where(eq(learningSessions.id, session.id)).returning())[0]!;
      const result = await issueNextVocabularyPlanTask(tx, session, plan, services.clock.now(), options.nextOrdinal ?? 0, 0);
      if (options.afterIssue) await options.afterIssue(tx, result, session);
      if (options.throwAfterIssue) throw new Error("abort-issued-slot");
      return result;
    });
    if (options.throwAfterIssue) await expect(run).rejects.toThrow("abort-issued-slot");
    const result = options.throwAfterIssue ? null : await run;
    expect(plan).toEqual(originalSnapshot);
    if (!options.throwAfterIssue) await endSession(services, started.sessionId);
    return { sessionId: started.sessionId, plan, result, beforeProgress, beforeExposures, beforeContext: beforeContext!.context };
  }

  it("pomija niedostępne zadania głosowe bez zapisu historii uczenia", async () => {
    const { sessionId, result } = await runPlannedIssue({
      exercises: [{ exerciseType: "speech" }, { exerciseType: "recall" }, { exerciseType: "listening" }], taskBudget: 3, canRead: false,
    });
    expect(result).toMatchObject({ slot: { ordinal: 2, exerciseType: "listening" }, assessedBefore: 2 });
    const tasks = (await pool.query("select id, ordinal, state from learning_app.session_tasks where session_id=$1 order by ordinal", [sessionId])).rows;
    expect(tasks.map((row: { state: string }) => row.state)).toEqual(["skipped", "skipped", "issued"]);
    const eventCount = (await pool.query("select count(*)::int as count from learning_app.learning_events e join learning_app.session_tasks t on t.id=e.task_id where t.session_id=$1", [sessionId])).rows[0].count;
    expect(eventCount).toBe(1);
    const evidenceCount = (await pool.query("select count(*)::int as count from learning_app.attempts a join learning_app.session_tasks t on t.id=a.task_id where t.session_id=$1", [sessionId])).rows[0].count;
    expect(evidenceCount).toBe(0);
    const assessmentCount = (await pool.query("select count(*)::int as count from learning_app.assessments a join learning_app.attempts p on p.id=a.attempt_id join learning_app.session_tasks t on t.id=p.task_id where t.session_id=$1", [sessionId])).rows[0].count;
    expect(assessmentCount).toBe(0);
    expect(Number((await pool.query("select count(*)::int as count from learning_app.child_skill_progress where child_id=$1", [childId])).rows[0].count)).toBe(0);
    const readable = await runPlannedIssue({
      exercises: [{ exerciseType: "speech" }, { exerciseType: "recall" }, { exerciseType: "listening" }], taskBudget: 3, canRead: true,
    });
    expect(readable.result).toMatchObject({ slot: { ordinal: 1, exerciseType: "recall" }, assessedBefore: 1 });
    expect((await pool.query("select state from learning_app.session_tasks where session_id=$1 order by ordinal", [readable.sessionId])).rows).toEqual([{ state: "skipped" }, { state: "issued" }]);
  });

  it("respects explicitly disabled slot IDs and leaves no exposure after skipped slots exhaust the budget", async () => {
    const explicitlyDisabled = await runPlannedIssue({
      exercises: [{ exerciseType: "speech" }, { exerciseType: "recall" }], taskBudget: 2, canRead: true, microphoneEnabled: true, disabledFirst: true,
    });
    expect(explicitlyDisabled.result).toMatchObject({ slot: { ordinal: 1, exerciseType: "recall" }, assessedBefore: 1 });
    const exhausted = await runPlannedIssue({
      exercises: [{ exerciseType: "speech" }, { exerciseType: "recall" }, { exerciseType: "exposure", assessed: false }], taskBudget: 2, canRead: false,
    });
    expect(exhausted.result).toBeNull();
    expect((await pool.query("select state from learning_app.session_tasks where session_id=$1 order by ordinal", [exhausted.sessionId])).rows).toEqual([{ state: "skipped" }, { state: "skipped" }]);
    expect((await pool.query("select count(*)::int as count from learning_app.learning_events e join learning_app.session_tasks t on t.id=e.task_id where t.session_id=$1", [exhausted.sessionId])).rows[0].count).toBe(0);
    const noSlots = await runPlannedIssue({ exercises: [{ exerciseType: "recall" }], taskBudget: 1, canRead: true, nextOrdinal: 1 });
    expect(noSlots.result).toBeNull();
    expect((await pool.query("select count(*)::int as count from learning_app.session_tasks where session_id=$1", [noSlots.sessionId])).rows[0].count).toBe(0);
  });

  it("omits absent support metadata and leaves an unchanged reservation context intact", async () => {
    const issued = await runPlannedIssue({
      exercises: [{ exerciseType: "recall" }], taskBudget: 1, canRead: true,
      keepsReservations: ["old-reservation"],
      afterIssue: async (tx, result, session) => {
        const [task] = await tx.select().from(sessionTasks).where(eq(sessionTasks.id, result!.slot.taskId));
        expect(task?.context).toEqual({ reason: "test-issue" });
        const [after] = await tx.select().from(learningSessions).where(eq(learningSessions.id, session.id));
        expect(after?.context).toMatchObject({
          reservations: ["old-reservation"], canRead: true, timezone: "Europe/Warsaw",
          previousContact: { preserved: "yes" }, settledChecks: ["settled-before"],
        });
      },
    });
    expect(issued.result).toMatchObject({ slot: { ordinal: 0 }, assessedBefore: 0 });
  });

  it("zapisuje komplet slotu i wycofuje wszystkie fakty, gdy caller przerywa transakcję", async () => {
    const revealKeys = [
      computeTargetKey("word0", "en-GB"), computeTargetKey("word1", "en-GB"), computeTargetKey("word0", "en-GB"),
    ];
    const issued = await runPlannedIssue({
      exercises: [{ exerciseType: "recall" }], taskBudget: 1, canRead: true, enrichFirst: true,
      revealKeys, prepareExistingFacts: true,
      afterIssue: async (tx, result, currentSession) => {
        expect(result).not.toBeNull();
        const task = (await tx.select().from(sessionTasks).where(eq(sessionTasks.id, result!.slot.taskId)))[0]!;
        expect(task).toMatchObject({
          state: "issued", publicPrompt: result!.slot.prompt, answerKey: result!.slot.answerKey,
          context: { reason: "test-issue", supportCycleId: result!.slot.supportCycleId, skillAtIssue: "recall", statusAtIssue: null, assessmentSkills: ["recall", "spelling"] },
        });
        const [event] = await tx.select().from(learningEvents).where(eq(learningEvents.taskId, result!.slot.taskId));
        expect(event).toMatchObject({ kind: "prompt_issued", sealed: true, stepId: `${result!.slot.taskId}:prompt` });
        const exposures = await tx.select().from(eventExposures).where(eq(eventExposures.eventId, event!.id));
        expect(exposures.map(({ targetKey }) => targetKey).sort()).toEqual([...new Set(revealKeys)].sort());
        const links = await tx.select().from(itemRevisionSkills).where(eq(itemRevisionSkills.itemRevisionId, result!.slot.itemRevisionId));
        const expectedSkills = links.filter(({ skill }) => skill === "recall" || skill === "spelling");
        const actualSkills = await tx.select().from(childSkillProgress).where(and(
          eq(childSkillProgress.childId, childId), eq(childSkillProgress.policyId, currentSession.policyId),
        ));
        expect(actualSkills.map(({ skillVersionId, policyId, firstIssuedAt }) => ({ skillVersionId, policyId, firstIssuedAt })).sort((a, b) => a.skillVersionId.localeCompare(b.skillVersionId))).toEqual(
          expectedSkills.map(({ skillVersionId }) => ({ skillVersionId, policyId: currentSession.policyId, firstIssuedAt: services.clock.now() })).sort((a, b) => a.skillVersionId.localeCompare(b.skillVersionId)),
        );
        const projected = await tx.select().from(childTargetExposures).where(and(
          eq(childTargetExposures.childId, childId), eq(childTargetExposures.targetKey, revealKeys[0]!),
        ));
        expect(projected[0]?.lastExposureAt).toEqual(services.clock.now());
        const session = (await tx.select().from(learningSessions).where(eq(learningSessions.id, task.sessionId)))[0]!;
        expect(session.context).toMatchObject({ reservations: ["reservation-0"], canRead: true, timezone: "Europe/Warsaw", previousContact: { preserved: "yes" }, settledChecks: ["settled-before"] });
      },
    });
    expect(issued.result).toMatchObject({ slot: { ordinal: 0 }, assessedBefore: 0 });
    const task = (await pool.query("select public_prompt, answer_key, context from learning_app.session_tasks where id=$1", [issued.result!.slot.taskId])).rows[0];
    expect(task.public_prompt).toEqual(issued.result!.slot.prompt);
    expect(task.answer_key).toEqual(issued.result!.slot.answerKey);
    expect(task.context).toMatchObject({
      reason: "test-issue", supportCycleId: issued.result!.slot.supportCycleId,
      skillAtIssue: "recall", statusAtIssue: null, assessmentSkills: ["recall", "spelling"],
    });
    expect((await pool.query("select sealed from learning_app.learning_events where task_id=$1", [issued.result!.slot.taskId])).rows).toEqual([{ sealed: true }]);
    expect((await pool.query("select target_key from learning_app.event_exposures where event_id=(select id from learning_app.learning_events where task_id=$1) order by target_key", [issued.result!.slot.taskId])).rows.map(({ target_key }: { target_key: string }) => target_key)).toEqual([...new Set(revealKeys)].sort());
    expect((await pool.query("select context->'reservations' as reservations from learning_app.learning_sessions where id=$1", [issued.sessionId])).rows[0].reservations).toEqual(["reservation-0"]);

    const rollback = await runPlannedIssue({
      exercises: [{ exerciseType: "recall" }], taskBudget: 1, canRead: true, throwAfterIssue: true,
      revealKeys, prepareExistingFacts: true,
      afterIssue: async (tx, result, currentSession) => {
        expect(result).not.toBeNull();
        expect((await tx.select().from(sessionTasks).where(eq(sessionTasks.id, result!.slot.taskId)))).toHaveLength(1);
        const [event] = await tx.select().from(learningEvents).where(eq(learningEvents.taskId, result!.slot.taskId));
        expect(event?.sealed).toBe(true);
        expect(await tx.select().from(eventExposures).where(eq(eventExposures.eventId, event!.id))).toHaveLength(2);
        const progressRows = await tx.select().from(childSkillProgress).where(and(eq(childSkillProgress.childId, childId), eq(childSkillProgress.policyId, currentSession.policyId)));
        expect(progressRows.every(({ firstIssuedAt }) => firstIssuedAt?.getTime() === services.clock.now().getTime())).toBe(true);
        const [projection] = await tx.select().from(childTargetExposures).where(and(eq(childTargetExposures.childId, childId), eq(childTargetExposures.targetKey, revealKeys[0]!)));
        expect(projection?.lastExposureAt).toEqual(services.clock.now());
        const [updatedSession] = await tx.select().from(learningSessions).where(eq(learningSessions.id, currentSession.id));
        expect(updatedSession?.context).toMatchObject({ reservations: ["reservation-0"], canRead: true, timezone: "Europe/Warsaw", previousContact: { preserved: "yes" }, settledChecks: ["settled-before"] });
      },
    });
    expect((await pool.query("select count(*)::int as count from learning_app.session_tasks where session_id=$1", [rollback.sessionId])).rows[0].count).toBe(0);
    expect((await pool.query("select count(*)::int as count from learning_app.learning_events e join learning_app.session_tasks t on t.id=e.task_id where t.session_id=$1", [rollback.sessionId])).rows[0].count).toBe(0);
    expect((await pool.query("select count(*)::int as count from learning_app.event_exposures x join learning_app.learning_events e on e.id=x.event_id join learning_app.session_tasks t on t.id=e.task_id where t.session_id=$1", [rollback.sessionId])).rows[0].count).toBe(0);
    expect((await pool.query("select count(*)::int as count from learning_app.assessments a join learning_app.attempts p on p.id=a.attempt_id join learning_app.session_tasks t on t.id=p.task_id where t.session_id=$1", [rollback.sessionId])).rows[0].count).toBe(0);
    expect((await pool.query("select * from learning_app.child_skill_progress where child_id=$1 and policy_id='learning-v2' order by skill_version_id", [childId])).rows).toEqual(rollback.beforeProgress);
    expect((await pool.query("select * from learning_app.child_target_exposures where child_id=$1 and target_key=any($2::text[]) order by target_key", [childId, revealKeys])).rows).toEqual(rollback.beforeExposures);
    expect((await pool.query("select context from learning_app.learning_sessions where id=$1", [rollback.sessionId])).rows[0].context).toEqual(rollback.beforeContext);
  });

  it("tworzy prywatny, skończony plan atomowo przy starcie i wydaje jego pierwszy krok", async () => {
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan: {version:number; slots:Array<{taskId:string}>}}[];
    expect(row?.training_plan).toMatchObject({ version: 1 });
    expect(row?.training_plan.slots.length).toBeGreaterThan(0);
    expect(row?.training_plan.slots.length).toBeLessThanOrEqual(session.taskBudget * 2 + 4);
    expect((await pool.query("select count(*)::int as count from learning_app.learning_events where task_id in (select id from learning_app.session_tasks where session_id=$1)", [session.sessionId])).rows[0]?.count).toBe(0);
    await expect(pool.query("update learning_app.learning_sessions set training_plan=jsonb_set(training_plan,'{version}','2') where id=$1", [session.sessionId]))
      .rejects.toThrow(/Training session plan is immutable/);
    const task = await nextTask(services, session.sessionId);
    expect(task?.taskId).toBe(row?.training_plan.slots[0]?.taskId);
    expect(task).not.toHaveProperty("answerKey");
    expect(await nextTask(services, session.sessionId)).toMatchObject({ taskId: task?.taskId });
    const [unchanged] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as typeof row[];
    expect(unchanged?.training_plan).toEqual(row?.training_plan);
    await endSession(services, session.sessionId);
  });

  it("utrzymuje przypięte opcje i ekspozycję zadania przy równoległym next i restarcie", async () => {
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [before] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as { training_plan: { slots: Array<{ taskId: string; prompt: { options?: unknown[] } }> } }[];
    expect((await pool.query("select id from learning_app.session_tasks where session_id=$1", [session.sessionId])).rows).toHaveLength(0);
    expect((await pool.query("select e.id from learning_app.learning_events e join learning_app.session_tasks t on t.id=e.task_id where t.session_id=$1", [session.sessionId])).rows).toHaveLength(0);
    const choice = before!.training_plan.slots.find((slot) => (slot.prompt.options?.length ?? 0) >= 2);
    expect(choice).toBeDefined();

    let task: Awaited<ReturnType<typeof nextTask>> = null;
    for (let index = 0; index < before!.training_plan.slots.length; index += 1) {
      task = await nextTask(services, session.sessionId);
      if (!task) throw new Error("expected next task");
      if (task.taskId === choice!.taskId) break;
      if (task.exerciseType === "exposure") await completePresentation(services, { taskId: task.taskId });
      else await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
    }
    expect(task?.taskId).toBe(choice!.taskId);
    expect(task?.prompt).toHaveProperty("options");
    const [stored] = (await pool.query("select answer_key, public_prompt from learning_app.session_tasks where id=$1", [task!.taskId])).rows as { answer_key: Record<string, unknown>; public_prompt: unknown }[];
    const [event] = (await pool.query("select id, sealed from learning_app.learning_events where task_id=$1 and kind='prompt_issued'", [task!.taskId])).rows as { id: string; sealed: boolean }[];
    expect(event?.sealed).toBe(true);
    expect((await pool.query("select target_key from learning_app.event_exposures where event_id=$1", [event?.id])).rows.length).toBeGreaterThan(0);

    const concurrent = await Promise.all([nextTask(services, session.sessionId), nextTask(services, session.sessionId)]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(concurrent[0]).toMatchObject({ taskId: task!.taskId, prompt: stored!.public_prompt });
    const restarted = openRestartedServices();
    try {
      expect(await nextTask(restarted.services, session.sessionId)).toMatchObject({ taskId: task!.taskId, prompt: stored!.public_prompt });
    } finally {
      await restarted.dispose();
    }
    const [after] = (await pool.query("select answer_key from learning_app.session_tasks where id=$1", [task!.taskId])).rows as { answer_key: Record<string, unknown> }[];
    expect(after?.answer_key).toEqual(stored?.answer_key);
    expect((await pool.query("select id from learning_app.session_tasks where session_id=$1 and id=$2", [session.sessionId, task!.taskId])).rows).toHaveLength(1);
    if (!("options" in task!.prompt)) throw new Error("expected a choice prompt");
    const correctOptionId = String(stored!.answer_key.correctOptionId);
    expect(task!.prompt.options.some((option) => option.id === correctOptionId)).toBe(true);
    const assessment = await submitAttempt(services, {
      taskId: task!.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: correctOptionId,
    });
    expect(assessment.feedback?.kind).toBe("great");
    await endSession(services, session.sessionId);
  });

  it("akceptuje plan z dostępną prezentacją wsparcia i bez możliwego zadania ocenianego", async () => {
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan:{slots:Array<{exerciseType:string;ordinal:number}>;taskBudget:number;version:1}}[];
    const exposure = row!.training_plan.slots.find((slot) => slot.exerciseType === "exposure")!;
    expect(readTrainingSessionPlan({ ...row!.training_plan, taskBudget: 1, slots: [{ ...exposure, ordinal: 0 }] })).not.toBeNull();
    await endSession(services, session.sessionId);
  });

  it("nie planuje ponownie należnego sprawdzenia tego samego celu", async () => {
    await pool.query(`insert into learning_app.child_skill_progress
      (child_id, skill_version_id, policy_id, status, independent_success_streak, next_review_at, last_reviewed_at, first_issued_at, has_qualifying_assessment, projection_version)
      select $1, s.skill_version_id, coalesce(c.policy_id, 'learning-v2'), 'needs_confirmation', 2, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z', true, 'proj-3'
      from learning_app.item_revision_skills s join learning_app.item_revisions r on r.id=s.item_revision_id
      cross join learning_app.child_profiles c
      where r.deck_version_id=(select id from learning_app.deck_versions where deck_id=$2 and state='published' order by version_number desc limit 1)
        and c.id=$1 and s.skill in ('recall','spelling')`, [childId, deckId]);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan:{slots:Array<{reason:string;itemRevisionId:string}>}}[];
    const checks = row!.training_plan.slots.filter((slot) => slot.reason === "due-check");
    expect(new Set(checks.map((slot) => slot.itemRevisionId)).size).toBe(checks.length);
    expect(checks.length).toBeGreaterThan(1);
    await endSession(services, session.sessionId);
  });

  it("wprowadza dany etap przypominania najwyżej raz w jednym planie", async () => {
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    for (let step = 0; step < 100; step++) {
      const task = await nextTask(services, first.sessionId);
      if (!task) break;
      if (task.exerciseType === "exposure") { await completePresentation(services, { taskId: task.taskId }); continue; }
      const [row] = (await pool.query("select answer_key from learning_app.session_tasks where id=$1", [task.taskId])).rows as {answer_key:Record<string,unknown>}[];
      if (task.exerciseType === "recall" || task.exerciseType === "spelling" || task.exerciseType === "letter_completion") await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: String(row!.answer_key.canonicalAnswer) });
      else if (task.prompt.kind === "listening" || task.prompt.kind === "reading") await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: String(row!.answer_key.correctOptionId) });
      else break;
    }
    await endSession(services, first.sessionId);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan:{slots:Array<{reason:string;itemRevisionId:string;skillAtIssue?:string}>}}[];
    const introductions = row!.training_plan.slots.filter((slot) => slot.reason === "stage-introduction");
    expect(introductions.length).toBeGreaterThan(0);
    const keys = introductions.map((slot) => `${slot.itemRevisionId}:${slot.skillAtIssue}`);
    expect(new Set(keys).size).toBe(keys.length);
    await endSession(services, session.sessionId);
  });

  it("plan kolejnej sesji umieszcza wsparcie po dwóch rzeczywistych błędach", async () => {
    const first = await startSession(services, { childId, deckId, microphoneEnabled: false });
    let task = await nextTask(services, first.sessionId);
    while (task?.exerciseType === "exposure") {
      await completePresentation(services, { taskId: task.taskId });
      task = await nextTask(services, first.sessionId);
    }
    expect(task?.prompt.kind).toBe("listening");
    if (task?.prompt.kind !== "listening") throw new Error("expected a listening task");
    const [answer] = (await pool.query("select answer_key->>'correctOptionId' as id from learning_app.session_tasks where id=$1", [task.taskId])).rows as {id:string}[];
    const wrong = task.prompt.options.find((option) => option.id !== answer?.id)!;
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: wrong.id });
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: wrong.id });
    await endSession(services, first.sessionId);

    const next = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const [planned] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [next.sessionId])).rows as {training_plan: {slots:Array<{reason:string;exerciseType:string}>}}[];
    expect(planned?.training_plan.slots[0]).toMatchObject({ reason: "support", exerciseType: "exposure" });
    const slot = await nextTask(services, next.sessionId);
    expect(slot).toMatchObject({ exerciseType: "exposure" });
    await endSession(services, next.sessionId);
  });

  it.each([false, true])( "tworzy niezmienny plan obrazkowy także dla canRead=%s", async (canRead) => {
    const fakes = await fakeGeneration();
    try {
      const pictureServices = createServices({ db: testDatabase().db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps, mediaStore: fakes.store });
      await prepareUiAudio(pictureServices);
      for (let pass = 0; pass < 8; pass++) {
        const pending = (await pool.query("select id from learning_app.media_assets where state='pending'")).rows as {id:string}[];
        if (pending.length === 0) break;
        for (const asset of pending) await executeMediaAsset(pictureServices, asset.id);
      }
      const draft = await createDraft(pictureServices, {
        title: "Kolory planowane", vocabularyFormat: "picture",
        items: ["red", "blue", "green", "yellow"].map((target, index) => ({
          source: ["czerwony", "niebieski", "zielony", "żółty"][index]!, target,
          acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" },
          visualType: "color" as const, visualData: { color: ["#ff0000", "#0000ff", "#008000", "#ffff00"][index]! },
        })),
      });
      await reconcileDraftAssets(pictureServices, draft.id);
      for (let pass = 0; pass < 8; pass++) if ((await runDueGenerationWork(pictureServices)).processed === 0) break;
      await publishDraft(pictureServices, draft.id, 1);
      const pictureChild = await createChild(pictureServices, { displayName: "Ola", avatarKey: "fox", canRead });
      await upsertAssignment(pictureServices, pictureChild.id, draft.deckId, null);
      const session = await startSession(pictureServices, { childId: pictureChild.id, deckId: draft.deckId, microphoneEnabled: false, supportsPictureVocabulary: true });
      const [row] = (await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows as {training_plan: {slots:Array<{exerciseType:string; prompt:{kind:string}}>}}[];
      expect(row?.training_plan.slots.some((slot) => slot.prompt.kind === "picture_exposure")).toBe(true);
      expect(row?.training_plan.slots.some((slot) => slot.prompt.kind === "picture_listening")).toBe(true);
      const fixed = row!.training_plan;
      const first = await nextTask(pictureServices, session.sessionId);
      expect(first?.prompt.kind).toBe("picture_exposure");
      expect((await pool.query("select training_plan from learning_app.learning_sessions where id=$1", [session.sessionId])).rows[0].training_plan).toEqual(fixed);
      await endSession(pictureServices, session.sessionId);
    } finally {
      await fakes.dispose();
    }
  });
});
