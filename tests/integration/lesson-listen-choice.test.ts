import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation, createChild, createLesson, createServices, endSession, executeLessonGeneration, FakeAnswerGrader, fakeGraderDeps,
  nextTask, publishLessonDraft, readLessonDeck, startSession, submitAttempt,
} from "@learning/server";
import type { LessonDraftDto, TaskDto } from "@learning/contracts";
import { writeSealedEvent } from "../../packages/server/src/modules/learning/events";
import { lessonWorld, type LessonWorldListen, type LessonWorldOptions } from "../fixtures/lesson-world";
import { buildTestServices, ManualClock, startLegacyTrainingSession, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import { markTtsReady } from "./school-lesson-audio-helpers";

/**
 * Ćwiczenie „Posłuchaj i wybierz” (`lesson_listen_choice`): rodzic widzi stan
 * nagrania zdania (`sentenceAudio`) wyłącznie przy ćwiczeniach słuchowych;
 * nagranie nie jest zasobem do decyzji rodzica (`assets` go pomija).
 */

const { db, pool } = testDatabase();
const OBJECTIVE = "english_grammar.present_simple.third_person_s";
const cleanup: Array<() => Promise<void>> = [];

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.child_objective_progress, learning_app.lesson_verdicts,
    learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
    learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
    learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`);
});
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
afterAll(() => pool.end());

async function generatedGrammarDraft() {
  const fakes = await fakeGeneration();
  cleanup.push(fakes.dispose);
  const services = createServices({ db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps });
  const run = await createLesson(services, {
    subjectId: "english_grammar", topicId: "present_simple", objectiveIds: [OBJECTIVE],
    material: "He plays football. She reads books. She watches TV.", poolSize: 20, clientRequestId: randomUUID(),
  });
  await executeLessonGeneration(services, run.runId);
  const draft = (await readLessonDeck(services, run.deckId)).draft!;
  return { services, run, draft };
}

const listenOf = (draft: LessonDraftDto) => draft.exercises.filter((exercise) => exercise.exerciseType === "lesson_listen_choice");

/** Zasób zdania (`feedback_audio`) ćwiczenia o danej rewizji. */
async function sentenceAssetId(revisionId: string): Promise<string> {
  return (await pool.query<{ asset_id: string }>(
    "select asset_id from learning_app.revision_assets where item_revision_id = $1 and role = 'feedback_audio'",
    [revisionId],
  )).rows[0]!.asset_id;
}

describe("lekcja gramatyki — stan nagrania zdania ćwiczenia słuchowego w DTO rodzica", () => {
  it("ćwiczenie słuchowe ma sentenceAudio, a inne ćwiczenia nie mają pola", async () => {
    const { draft } = await generatedGrammarDraft();
    const listen = listenOf(draft);
    expect(listen.length).toBeGreaterThan(0);
    for (const exercise of listen) expect(exercise.sentenceAudio).toEqual({ state: "pending" });
    const others = draft.exercises.filter((exercise) => exercise.exerciseType !== "lesson_listen_choice");
    expect(others.some((exercise) => exercise.exerciseType === "lesson_choice")).toBe(true);
    for (const exercise of others) expect(exercise).not.toHaveProperty("sentenceAudio");
  });

  it("gotowy zasób daje ready z assetId, nieudany failed, a feedback_audio nie trafia do assets", async () => {
    const { services, run, draft } = await generatedGrammarDraft();
    const [first, second] = listenOf(draft);
    const readyAsset = await sentenceAssetId(first!.revisionId);
    const failedAsset = await sentenceAssetId(second!.revisionId);
    await markTtsReady(readyAsset);
    await pool.query("update learning_app.media_assets set state = 'failed', lease_token = null where id = $1", [failedAsset]);

    const after = (await readLessonDeck(services, run.deckId)).draft!;
    const byRevision = new Map(listenOf(after).map((exercise) => [exercise.revisionId, exercise]));
    expect(byRevision.get(first!.revisionId)!.sentenceAudio).toEqual({ state: "ready", assetId: readyAsset });
    expect(byRevision.get(second!.revisionId)!.sentenceAudio).toEqual({ state: "failed" });
    expect(JSON.stringify(after.assets)).not.toContain("feedback_audio");
    expect(after.assets).toEqual([]);
  });
});

type Services = ReturnType<typeof createServices>;

/** Services z fake graderem (selektor wydaje wtedy także przekształcenia i odpowiedzi otwarte). */
function graderServices(): Services {
  const { clock } = buildTestServices();
  return createServices({
    db, clock, generation: {} as Parameters<typeof createServices>[0]["generation"],
    grader: fakeGraderDeps({ provider: new FakeAnswerGrader() }),
  });
}

interface PlanSlot { exerciseType: string; reason: string; itemRevisionId: string; revealsTargetKeys: string[] }

async function planSlots(sessionId: string): Promise<PlanSlot[]> {
  const row = (await pool.query<{ plan: { slots: PlanSlot[] } | null }>(
    "select training_plan as plan from learning_app.learning_sessions where id = $1", [sessionId],
  )).rows[0]!;
  return row.plan?.slots ?? [];
}

async function answerKeyOf(taskId: string): Promise<Record<string, unknown>> {
  return (await pool.query<{ answerKey: Record<string, unknown> }>(
    `select answer_key as "answerKey" from learning_app.session_tasks where id = $1`, [taskId],
  )).rows[0]!.answerKey;
}

async function taskRow(taskId: string): Promise<{ state: string; context: Record<string, unknown> }> {
  return (await pool.query<{ state: string; context: Record<string, unknown> }>(
    "select state, context from learning_app.session_tasks where id = $1", [taskId],
  )).rows[0]!;
}

async function assessmentOf(attemptId: string) {
  return (await pool.query<{ outcome: string; independent: boolean; details: Record<string, unknown> }>(
    "select outcome, independent, details from learning_app.assessments where attempt_id = $1 and skill = 'objective'", [attemptId],
  )).rows[0];
}

async function attemptContextOf(attemptId: string): Promise<{ assistance: string[]; answerPreviouslyExposed: boolean }> {
  return (await pool.query<{ context: { assistance: string[]; answerPreviouslyExposed: boolean } }>(
    "select context from learning_app.attempts where id = $1", [attemptId],
  )).rows[0]!.context;
}

/** Ekspozycje zapieczętowanego `prompt_issued` zadania. */
async function promptExposures(taskId: string): Promise<string[]> {
  return (await pool.query<{ targetKey: string }>(
    `select ee.target_key as "targetKey" from learning_app.event_exposures ee
       join learning_app.learning_events le on le.id = ee.event_id
      where le.task_id = $1 and le.kind = 'prompt_issued' and le.sealed`, [taskId],
  )).rows.map((row) => row.targetKey).sort();
}

async function sessionSupportObjectives(sessionId: string): Promise<string[]> {
  return (await pool.query<{ context: { supportObjectives?: string[] } }>(
    "select context from learning_app.learning_sessions where id = $1", [sessionId],
  )).rows[0]!.context.supportObjectives ?? [];
}

/** Dziecko z lekcją (bogata pula celu + ćwiczenie słuchowe w danym stanie nagrania). */
async function listenWorld(services: Services, listenChoice: NonNullable<LessonWorldOptions["listenChoice"]>, extra: Partial<LessonWorldOptions> = {}) {
  const child = await createChild(services, { displayName: "Słuchacz", avatarKey: "owl" });
  const lesson = await lessonWorld(pool, { childId: child.id, richPool: true, now: services.clock.now(), listenChoice, ...extra });
  return { child, lesson, listen: lesson.listen! };
}

/**
 * Wydaje zadania sesji: karty kończy prezentacją, zadanie typu `stopAt` zwraca,
 * a pozostałe pomija („Pomiń” — bez oceny i ekspozycji feedbacku). `null` = koniec sesji.
 */
async function skipUntil(services: Services, sessionId: string, stopAt: string, max = 40): Promise<TaskDto | null> {
  for (let i = 0; i < max; i++) {
    const task = await nextTask(services, sessionId);
    if (task === null) return null;
    if (task.exerciseType === "lesson_card") {
      await completePresentation(services, { taskId: task.taskId });
      continue;
    }
    if (task.exerciseType === stopAt) return task;
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  }
  throw new Error(`nie doczekano ${stopAt}`);
}

/** Autoryzacja odsłuchu (Task 9) zastąpiona zapisem zapieczętowanego `audio_issued` jak w serwerze. */
async function sealListenAudio(services: Services, childId: string, task: TaskDto, listen: LessonWorldListen): Promise<void> {
  await db.transaction((tx) => writeSealedEvent(tx, {
    childId, taskId: task.taskId, itemId: listen.itemId, kind: "audio_issued",
    stepId: `${task.taskId}:listen:${randomUUID()}`, occurredAt: services.clock.now(),
    exposures: [listen.targetKey, listen.sentenceTargetKey],
  }));
  (services.clock as ManualClock).advanceMs(1000);
}

function wrongOptionOf(task: TaskDto, key: Record<string, unknown>): string {
  return (task.prompt as { options: { id: string }[] }).options.find((option) => option.id !== key.correctOptionId)!.id;
}

const countListenSlots = async (sessionId: string) =>
  (await planSlots(sessionId)).filter((slot) => slot.exerciseType === "lesson_listen_choice").length;

describe("sesja — gotowość nagrania zdania ćwiczenia słuchowego", () => {
  it("wygenerowana lekcja z gotowymi nagraniami: plan zawiera zadanie słuchowe (listen_practice), które da się wydać", async () => {
    const { services, run, draft } = await generatedGrammarDraft();
    for (const exercise of listenOf(draft)) await markTtsReady(await sentenceAssetId(exercise.revisionId));
    await publishLessonDraft(services, draft.id, draft.editNumber);
    const child = await createChild(services, { displayName: "Słuchacz", avatarKey: "owl" });
    await pool.query("insert into learning_app.assignments (id, child_id, deck_id) values ($1, $2, $3)", [randomUUID(), child.id, run.deckId]);

    const session = await startSession(services, { childId: child.id, deckId: run.deckId, microphoneEnabled: false });
    const listenSlots = (await planSlots(session.sessionId)).filter((slot) => slot.exerciseType === "lesson_listen_choice");
    expect(listenSlots).toHaveLength(1);
    expect(listenSlots[0]!.reason).toBe("listen_practice");

    const task = await skipUntil(services, session.sessionId, "lesson_listen_choice");
    expect(task?.prompt.kind).toBe("lesson_listen_choice");
  });

  it("bez gotowego nagrania plan nie ma zadania słuchowego, a sesja startuje", async () => {
    const services = buildTestServices().services;
    const { child, lesson } = await listenWorld(services, { audio: "pending" });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    expect((await planSlots(session.sessionId)).length).toBeGreaterThan(0);
    expect(await countListenSlots(session.sessionId)).toBe(0);
  });

  it("z gotowym nagraniem plan ma jedno zadanie słuchowe z powodem listen_practice", async () => {
    const services = buildTestServices().services;
    const { child, lesson, listen } = await listenWorld(services, { audio: "ready" });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    const listenSlots = (await planSlots(session.sessionId)).filter((slot) => slot.exerciseType === "lesson_listen_choice");
    expect(listenSlots).toHaveLength(1);
    expect(listenSlots[0]).toMatchObject({ reason: "listen_practice", itemRevisionId: listen.revisionId });
  });

  it("nagranie gotowe tylko jako generacja innego szkicu (ten sam fingerprint) „ożywia” ćwiczenie", async () => {
    const services = buildTestServices().services;
    const failedOnly = await listenWorld(services, { audio: "failed" });
    const failedSession = await startSession(services, { childId: failedOnly.child.id, deckId: failedOnly.lesson.deckId, microphoneEnabled: false });
    expect(await countListenSlots(failedSession.sessionId)).toBe(0);

    const revived = await listenWorld(services, { audio: "failed" });
    const assetId = randomUUID();
    await pool.query(
      `insert into learning_app.media_assets
         (id, kind, fingerprint, generation_number, state, storage_key, content_sha256, mime_type, byte_count, provider, model, metadata)
       values ($1, 'tts', $2, 2, 'ready', $3, $4, 'audio/mpeg', 1024, 'fake', 'fake-tts', '{}'::jsonb)`,
      [assetId, revived.listen.fingerprint, `blob/${assetId}`, `sha-${assetId}`],
    );
    const session = await startSession(services, { childId: revived.child.id, deckId: revived.lesson.deckId, microphoneEnabled: false });
    expect(await countListenSlots(session.sessionId)).toBe(1);
    const task = (await skipUntil(services, session.sessionId, "lesson_listen_choice"))!;
    expect((await answerKeyOf(task.taskId)).feedbackAudioAssetId).toBe(assetId);
  });

  it("sesja dynamiczna (bez planu) też wydaje zadanie słuchowe z gotowym nagraniem", async () => {
    const services = buildTestServices().services;
    const { child, lesson } = await listenWorld(services, { audio: "ready" });
    const session = await startLegacyTrainingSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    const task = await skipUntil(services, session.sessionId, "lesson_listen_choice");
    expect(task?.prompt.kind).toBe("lesson_listen_choice");
    expect((await taskRow(task!.taskId)).context.reason).toBe("listen_practice");
  });
});

describe("sesja — wydanie i ocena zadania słuchowego", () => {
  it("Kid DTO bez id nagrania i klucza; przy wydaniu ekspozycje celu i pełnego zdania", async () => {
    const services = buildTestServices().services;
    const { child, lesson, listen } = await listenWorld(services, { audio: "ready" });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    const task = (await skipUntil(services, session.sessionId, "lesson_listen_choice"))!;

    expect(task.prompt).toEqual({ kind: "lesson_listen_choice", stem: "She ___ football.", options: expect.any(Array), contentLocale: "en-GB" });
    const options = (task.prompt as { options: { id: string; text: string }[] }).options;
    expect(options.map((option) => option.text).sort()).toEqual(["play", "plays"]);
    expect(options.some((option) => option.id === "o-plays" || option.id === "o-play")).toBe(false);
    const json = JSON.stringify(task);
    expect(json).not.toContain(listen.assetId!);
    expect(json).not.toContain("correctOption");
    expect(json).not.toContain("instructionPl");

    const key = await answerKeyOf(task.taskId);
    expect(key).toMatchObject({
      exerciseType: "lesson_listen_choice", feedbackAudioAssetId: listen.assetId,
      targetKey: listen.targetKey, sentenceTargetKey: listen.sentenceTargetKey,
    });
    expect((key.optionValues as Record<string, string>)[key.correctOptionId as string]).toBe("plays");
    expect(listen.sentenceTargetKey).not.toBe(listen.targetKey);
    expect(await promptExposures(task.taskId)).toEqual([listen.targetKey, listen.sentenceTargetKey].sort());
  });

  it("odpowiedź bez autoryzacji odsłuchu → not_assessed, zadanie issued, bez oceny celu", async () => {
    const services = buildTestServices().services;
    const { child, lesson } = await listenWorld(services, { audio: "ready" });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    const task = (await skipUntil(services, session.sessionId, "lesson_listen_choice"))!;
    const key = await answerKeyOf(task.taskId);

    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
    expect(attempt.feedback).toEqual({ kind: "not_assessed" });
    expect(attempt.taskState).toBe("issued");
    expect((await taskRow(task.taskId)).state).toBe("issued");
    expect(await assessmentOf(attempt.attemptId)).toMatchObject({ outcome: "unassessed", details: { verdict: "no_stimulus" } });
    expect((await pool.query("select count(*)::int as count from learning_app.child_objective_progress where child_id = $1", [child.id])).rows[0].count).toBe(0);
  });

  it("poprawna odpowiedź po audio_issued: wsparcie options + model_audio, próba niesamodzielna, great z nagraniem zdania", async () => {
    const services = buildTestServices().services;
    const { child, lesson, listen } = await listenWorld(services, { audio: "ready" });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    const task = (await skipUntil(services, session.sessionId, "lesson_listen_choice"))!;
    const key = await answerKeyOf(task.taskId);
    await sealListenAudio(services, child.id, task, listen);

    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
    expect(attempt.feedback).toEqual({ kind: "great", correctAudioAssetId: listen.assetId });
    expect(attempt.taskState).toBe("answered");
    const context = await attemptContextOf(attempt.attemptId);
    expect(context.assistance).toEqual(expect.arrayContaining(["options", "model_audio"]));
    expect(await assessmentOf(attempt.attemptId)).toMatchObject({ outcome: "correct", independent: false });
  });

  it("błędna odpowiedź: bez karty wsparcia w tej sesji, a następna sesja nie ma celu we wsparciu", async () => {
    const services = buildTestServices().services;
    const { child, lesson, listen } = await listenWorld(services, { audio: "ready" });
    const session = await startLegacyTrainingSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    const task = (await skipUntil(services, session.sessionId, "lesson_listen_choice"))!;
    const key = await answerKeyOf(task.taskId);
    await sealListenAudio(services, child.id, task, listen);

    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: wrongOptionOf(task, key) });
    expect(attempt.feedback).toMatchObject({ kind: "incorrect", correctText: "plays", correctAudioAssetId: listen.assetId });
    expect(await assessmentOf(attempt.attemptId)).toMatchObject({ outcome: "incorrect", independent: false });

    // Sesja dynamiczna: kolejne zadanie po błędzie słuchowym nie jest kartą wsparcia.
    const next = await nextTask(services, session.sessionId);
    expect(next).not.toBeNull();
    expect((await taskRow(next!.taskId)).context.cardPurpose).not.toBe("support");
    await endSession(services, session.sessionId);
    (services.clock as ManualClock).advanceHours(1);

    const second = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    expect(await sessionSupportObjectives(second.sessionId)).toEqual([]);
  });

  it("poprawna odpowiedź słuchowa po prawdziwym błędzie luki nie kasuje wsparcia celu", async () => {
    const services = buildTestServices().services;
    // Wcześniejszy sukces celu: luka (etap produktywny) jest w planie pierwszej sesji.
    const { child, lesson, listen } = await listenWorld(services, { audio: "ready" }, { withObjectiveAssessment: true });
    const first = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    const gap = (await skipUntil(services, first.sessionId, "lesson_gap"))!;
    await submitAttempt(services, { taskId: gap.taskId, clientAttemptId: randomUUID(), modality: "dont_remember" });
    await endSession(services, first.sessionId);
    (services.clock as ManualClock).advanceHours(1);

    const second = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    expect(await sessionSupportObjectives(second.sessionId)).toEqual([lesson.objectiveId]);
    const task = (await skipUntil(services, second.sessionId, "lesson_listen_choice"))!;
    await sealListenAudio(services, child.id, task, listen);
    const key = await answerKeyOf(task.taskId);
    const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
    expect(attempt.feedback?.kind).toBe("great");
    await endSession(services, second.sessionId);
    (services.clock as ManualClock).advanceHours(1);

    const third = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
    expect(await sessionSupportObjectives(third.sessionId)).toEqual([lesson.objectiveId]);
  });

  it("kartkówka nie wydaje zadania słuchowego", async () => {
    const services = buildTestServices().services;
    const { child, lesson } = await listenWorld(services, { audio: "ready" }, { testDate: "2026-10-20" });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false, mode: "mock_test" });
    let issued = 0;
    for (let i = 0; i < 30; i++) {
      const task = await nextTask(services, session.sessionId);
      if (!task) break;
      if (task.exerciseType === "lesson_card") {
        await completePresentation(services, { taskId: task.taskId });
        continue;
      }
      expect(task.exerciseType).not.toBe("lesson_listen_choice");
      await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "dont_remember" });
      issued += 1;
    }
    expect(issued).toBeGreaterThan(0);
  });
});

describe("ekspozycja pełnego zdania zadania słuchowego", () => {
  /**
   * Zdanie słuchowe „she plays” = odpowiedź przekształcenia bogatej puli. Pierwsza
   * odpowiedź na przekształcenie po wydaniu zadania słuchowego ma
   * `answerPreviouslyExposed`; bez zadania słuchowego (nagranie niegotowe) — nie.
   */
  async function firstTransformAttemptExposed(audio: "ready" | "pending"): Promise<{ exposed: boolean; listenIssued: boolean }> {
    const services = graderServices();
    const { child, lesson } = await listenWorld(services, { audio, stem: "she ___" }, { withObjectiveAssessment: true });
    let listenIssued = false;
    for (let round = 0; round < 4; round++) {
      const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
      for (let i = 0; i < 40; i++) {
        const task = await nextTask(services, session.sessionId);
        if (task === null) break;
        if (task.exerciseType === "lesson_card") {
          await completePresentation(services, { taskId: task.taskId });
          continue;
        }
        if (task.exerciseType === "lesson_listen_choice") listenIssued = true;
        if (task.exerciseType === "lesson_transform" && (listenIssued || audio === "pending")) {
          const attempt = await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: "she plays" });
          return { exposed: (await attemptContextOf(attempt.attemptId)).answerPreviouslyExposed, listenIssued };
        }
        // Postęp po etapach: inne ćwiczenia poprawnie (ich odpowiedzi ≠ „she plays”);
        // przekształcenie przed zadaniem słuchowym i samo zadanie słuchowe — „Pomiń”.
        const key = await answerKeyOf(task.taskId);
        const answer = task.exerciseType === "lesson_listen_choice" || task.exerciseType === "lesson_transform"
          ? { modality: "skip" as const }
          : typeof key.correctOptionId === "string"
            ? { modality: "choice" as const, optionId: key.correctOptionId }
            : task.exerciseType === "lesson_order"
              ? { modality: "sequence" as const, itemIds: key.itemIds as string[] }
              : { modality: "text" as const, text: key.answer as string };
        await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), ...answer });
      }
      await endSession(services, session.sessionId);
      (services.clock as ManualClock).advanceHours(13);
    }
    throw new Error("nie doczekano przekształcenia");
  }

  it("ćwiczenie samodzielne z odpowiedzią równą zdaniu słuchowemu po zadaniu słuchowym ma answerPreviouslyExposed", async () => {
    expect(await firstTransformAttemptExposed("ready")).toEqual({ exposed: true, listenIssued: true });
  });

  it("bez zadania słuchowego ta sama odpowiedź nie była ujawniona", async () => {
    expect(await firstTransformAttemptExposed("pending")).toEqual({ exposed: false, listenIssued: false });
  });
});
