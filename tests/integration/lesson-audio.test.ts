import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  nextTask,
  startSession,
  submitAttempt,
  authorizeDisclosure,
  createServices,
  createSubjectRegistry,
  englishGrammarSubject,
  type AppError,
} from "@learning/server";
import type { TaskDto } from "@learning/contracts";
import { lessonWorld } from "../fixtures/lesson-world";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

/**
 * A58: serwowanie audio lekcji z pieczętowaniem ekspozycji. `target_audio`
 * (TTS odpowiedzi kanonicznej) generowane przy publikacji jest teraz podawane
 * dziecku WYŁĄCZNIE w ćwiczeniach tekstowych (wym. 4.6, design.md „Odsłuch w
 * zadaniach tekstowych lekcji = wsparcie”): prompt niesie `audioAssetId`, odsłuch
 * idzie przez `authorizeDisclosure(audio)`, który pieczętuje ekspozycję PRZED
 * zwróceniem zgody, a próba po odsłuchu jest kwalifikowana jako wspomagana (NIE
 * samodzielna). Typy zamknięte nie oferują audio (zdradzałoby odpowiedź).
 */

const { pool } = testDatabase();
type Services = ReturnType<typeof buildTestServices>["services"];

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.child_objective_progress, learning_app.lesson_verdicts,
    learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
    learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
    learning_app.deck_versions, learning_app.decks cascade`);
});
afterAll(() => pool.end());

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await promise.then(
    () => { throw new Error(`Oczekiwano błędu ${code}, otrzymano sukces`); },
    (error: unknown) => { expect((error as AppError).code).toBe(code); },
  );
}

const PRODUCTIVE_TYPES = new Set(["lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer"]);

async function answerKeyOf(taskId: string): Promise<Record<string, unknown>> {
  const rows = await pool.query<{ answerKey: Record<string, unknown> }>(
    `select answer_key as "answerKey" from learning_app.session_tasks where id = $1`,
    [taskId],
  );
  return rows.rows[0]!.answerKey;
}

async function revisionOf(taskId: string): Promise<string> {
  const rows = await pool.query<{ itemRevisionId: string }>(
    `select item_revision_id as "itemRevisionId" from learning_app.session_tasks where id = $1`,
    [taskId],
  );
  return rows.rows[0]!.itemRevisionId;
}

/** Odpowiada poprawnie na dowolne ćwiczenie, by cel awansował przez etapy. */
async function answerCorrectly(services: Services, task: TaskDto): Promise<void> {
  const key = await answerKeyOf(task.taskId);
  if (task.exerciseType === "lesson_choice" || task.exerciseType === "lesson_short_answer" || task.exerciseType === "lesson_notice") {
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
    return;
  }
  if (task.exerciseType === "lesson_order") {
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "sequence", itemIds: key.itemIds as string[] });
    return;
  }
  await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.answer as string });
}

/** Wydaje aż do pierwszego ćwiczenia wskazanego typu (karty/pośrednie po drodze). */
async function issueUntil(services: Services, sessionId: string, type: string, max = 30): Promise<TaskDto> {
  const advance = PRODUCTIVE_TYPES.has(type);
  for (let i = 0; i < max; i++) {
    const task = await nextTask(services, sessionId);
    if (task === null) throw new Error(`sesja skończyła się przed ${type}`);
    if (task.exerciseType === "lesson_card") { await completePresentation(services, { taskId: task.taskId }); continue; }
    if (task.exerciseType === type) return task;
    if (advance) await answerCorrectly(services, task);
    else await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  }
  throw new Error(`nie doczekano ćwiczenia ${type}`);
}

interface SealedRow { targetKey: string; kind: string; sealed: boolean }
async function sealedEvents(childId: string, kind: string): Promise<SealedRow[]> {
  const rows = await pool.query<SealedRow>(
    `select ee.target_key as "targetKey", le.kind, le.sealed
       from learning_app.event_exposures ee
       join learning_app.learning_events le on le.id = ee.event_id
      where ee.child_id = $1 and le.kind = $2`,
    [childId, kind],
  );
  return rows.rows;
}

async function newAudioLesson(services: Services) {
  const child = await createChild(services, { displayName: "Lekcja", avatarKey: "owl" });
  // target_audio gotowe dla WSZYSTKICH typów (dosiane przed publikacją), by udowodnić,
  // że tylko tekstowe faktycznie je serwują.
  const lesson = await lessonWorld(pool, {
    childId: child.id,
    richPool: true,
    withTargetAudioFor: [
      "lesson_gap", "lesson_error_fix", "lesson_transform", "lesson_open_answer",
      "lesson_choice", "lesson_short_answer", "lesson_notice", "lesson_order",
    ],
  });
  const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });
  return { child, lesson, session };
}

/** Jawnie włączony przedmiot testowy zachowuje pokrycie opcjonalnej ścieżki audio. */
function audioServices(): Services {
  const { services } = buildTestServices();
  return createServices({ db: services.db, clock: services.clock,
    subjects: createSubjectRegistry([{ ...englishGrammarSubject, ttsForAnswers: true }]),
  });
}

describe("A58 — audio lekcji w ćwiczeniach tekstowych", () => {
  it("ćwiczenie tekstowe niesie audioAssetId; prompt pozostaje prywatny", async () => {
    const services = audioServices();
    const { session } = await newAudioLesson(services);
    const task = await issueUntil(services, session.sessionId, "lesson_gap");
    expect(task.prompt.kind).toBe("lesson_gap");
    const prompt = task.prompt as { audioAssetId?: string };
    expect(prompt.audioAssetId).toBeDefined();
    // Kid DTO nadal ściśle prywatny: żadnej odpowiedzi/wariantów/focus/celu.
    const raw = JSON.stringify(task.prompt);
    for (const forbidden of ["answer", "acceptedAnswers", "focus", "objectiveId", "correctOption", "errorCategor"]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("odsłuch pieczętuje ekspozycję target_key PRZED zwróceniem zgody", async () => {
    const services = audioServices();
    const { child, session } = await newAudioLesson(services);
    const task = await issueUntil(services, session.sessionId, "lesson_gap");
    const key = await answerKeyOf(task.taskId);
    const targetKey = key.targetKey as string;

    expect((await sealedEvents(child.id, "audio_issued")).length).toBe(0);

    const disclosure = await authorizeDisclosure(services, { taskId: task.taskId, kind: "audio" });
    expect(disclosure.kind).toBe("audio");
    // Audio nie ujawnia tekstu rozwiązania w DTO (to nie podpowiedź).
    expect(disclosure.reveal).toBeNull();

    const audio = await sealedEvents(child.id, "audio_issued");
    expect(audio.length).toBe(1);
    expect(audio[0]!.sealed).toBe(true);
    expect(audio[0]!.targetKey).toBe(targetKey);
  });

  it("próba po odsłuchu jest wspomagana (NIE samodzielna)", async () => {
    const services = audioServices();
    const { child, session } = await newAudioLesson(services);
    const task = await issueUntil(services, session.sessionId, "lesson_gap");
    const key = await answerKeyOf(task.taskId);
    const revisionId = await revisionOf(task.taskId);

    await authorizeDisclosure(services, { taskId: task.taskId, kind: "audio" });
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.answer as string });

    const rows = await pool.query<{ independent: boolean; outcome: string }>(
      `select a.independent, a.outcome from learning_app.assessments a
         where a.child_id = $1 and a.item_revision_id = $2 and a.skill = 'objective'`,
      [child.id, revisionId],
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0]!.outcome).toBe("correct");
    expect(rows.rows[0]!.independent).toBe(false);
  });

  it("typ zamknięty nie oferuje audio i odrzuca odsłuch", async () => {
    const services = audioServices();
    const { session } = await newAudioLesson(services);
    const choice = await issueUntil(services, session.sessionId, "lesson_choice");
    expect(choice.prompt.kind).toBe("lesson_choice");
    expect((choice.prompt as { audioAssetId?: string }).audioAssetId).toBeUndefined();
    await expectAppError(
      authorizeDisclosure(services, { taskId: choice.taskId, kind: "audio" }),
      "conflict",
    );
  });
});
