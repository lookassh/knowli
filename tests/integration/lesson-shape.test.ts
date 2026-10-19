import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  englishGrammarSubject,
  nextTask,
  startSession,
  submitAttempt,
  validatePool,
} from "@learning/server";
import {
  LessonExerciseInputSchema,
  type LessonExerciseInput,
  type TaskDto,
} from "@learning/contracts";
import type { LessonExerciseDraft } from "@learning/server";
import { lessonWorld } from "../fixtures/lesson-world";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

/**
 * WSPÓLNY test kształtu payloadu (źródło luki P1-1): dla choice/short_answer
 * `correctOption` niesie ID OPCJI, zgodnie z `pool-validation` (`options.some(o
 * => o.id === correctOption)`). Dowodzimy, że ten sam kształt, który przechodzi
 * walidację semantyczną (`validatePool`), po materializacji i wydaniu zadania
 * jest OCENIANY poprawnie przez realny use-case dziecka (`submitAttempt`).
 *
 * Fixture `lesson-world.ts` wcześniej zapisywał `correctOption` jako TEKST, co
 * maskowało błąd (stara materializacja dopasowywała po tekście). Fixture jest
 * teraz zgodny z kontraktem (ID opcji), więc ten przepływ jest wiarygodnym
 * strażnikiem regresji.
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

type Services = ReturnType<typeof buildTestServices>["services"];

const SUBJECT = englishGrammarSubject;
const TOPIC = SUBJECT.topics[0]!;
const OBJECTIVE = "english_grammar.present_simple.third_person_s";

/** Wydaje prezentacje/pośrednie, aż `nextTask` zwróci wskazany typ. */
async function issueUntil(services: Services, sessionId: string, type: string, max = 30): Promise<TaskDto> {
  for (let i = 0; i < max; i++) {
    const task = await nextTask(services, sessionId);
    if (task === null) throw new Error(`sesja skończyła się przed ${type}`);
    if (task.exerciseType === "lesson_card") {
      await completePresentation(services, { taskId: task.taskId });
      continue;
    }
    if (task.exerciseType === type) return task;
    await submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "skip" });
  }
  throw new Error(`nie doczekano ćwiczenia ${type}`);
}

async function answerKeyOf(taskId: string): Promise<Record<string, unknown>> {
  const rows = await pool.query<{ answerKey: Record<string, unknown> }>(
    `select answer_key as "answerKey" from learning_app.session_tasks where id = $1`,
    [taskId],
  );
  return rows.rows[0]!.answerKey;
}

describe("kształt payloadu lekcji — correctOption po ID (P1-1)", () => {
  it("editorReady seeds a valid 3/4/2 pool and honors draft versus published state", async () => {
    const draft = await lessonWorld(pool, { editorReady: true, publish: false });
    const draftRows = await pool.query<{ payload: LessonExerciseDraft }>(
      "select payload from learning_app.item_revisions where deck_version_id=$1 and position > 0 order by position",
      [draft.versionId],
    );
    const draftValidation = validatePool(draftRows.rows.map((row) => row.payload), SUBJECT, TOPIC);
    expect(draftValidation.rejected).toEqual([]);
    expect(draftValidation.valid).toHaveLength(9);
    expect((await pool.query<{ state: string }>("select state from learning_app.deck_versions where id=$1", [draft.versionId])).rows[0]?.state).toBe("draft");

    const published = await lessonWorld(pool, { editorReady: true });
    expect((await pool.query<{ state: string }>("select state from learning_app.deck_versions where id=$1", [published.versionId])).rows[0]?.state).toBe("published");
  });

  it("rolls back all rows when fixture setup fails after seeding", async () => {
    const title = `rollback-${randomUUID()}`;
    await expect(lessonWorld(pool, { title, withObjectiveAssessment: true })).rejects.toThrow("wymaga childId");
    expect((await pool.query("select id from learning_app.decks where title=$1", [title])).rows).toHaveLength(0);
  });

  it("podstawowy fixture short_answer ma walidowalny payload wyboru", async () => {
    const lesson = await lessonWorld(pool);
    const row = await pool.query<{ payload: LessonExerciseDraft }>("select payload from learning_app.item_revisions where deck_version_id=$1 order by position limit 1", [lesson.versionId]);
    expect(validatePool([row.rows[0]!.payload], SUBJECT, TOPIC).rejected).toEqual([]);
  });
  it("choice z correctOption=ID przechodzi schemat kontraktu i walidację semantyczną", () => {
    const input: LessonExerciseInput = {
      exerciseType: "lesson_choice",
      objectiveId: OBJECTIVE,
      instructionPl: "Wybierz poprawną formę.",
      stem: "She ___ football.",
      options: [
        { id: "o-play", text: "play" },
        { id: "o-plays", text: "plays" },
      ],
      correctOption: "o-plays", // ID opcji — kontrakt pool-validation
      answer: "plays",
      acceptedAnswers: [],
      focus: ["plays"],
    };

    // 1) schemat kontraktu (strict) akceptuje kształt
    const parsed = LessonExerciseInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);

    // 2) walidacja semantyczna puli akceptuje ćwiczenie (correctOption = ID opcji)
    const draftEx = input as unknown as LessonExerciseDraft;
    const result = validatePool([draftEx], SUBJECT, TOPIC);
    expect(result.rejected).toEqual([]);
    expect(result.valid).toHaveLength(1);
  });

  it("choice z correctOption=TEKST jest ODRZUCONY semantycznie (dowód, że kontrakt to ID)", () => {
    const draftEx = {
      exerciseType: "lesson_choice",
      objectiveId: OBJECTIVE,
      instructionPl: "Wybierz poprawną formę.",
      stem: "She ___ football.",
      options: [
        { id: "o-play", text: "play" },
        { id: "o-plays", text: "plays" },
      ],
      correctOption: "plays", // TEKST — niezgodny z kontraktem
      answer: "plays",
      acceptedAnswers: [],
      focus: ["plays"],
    } as unknown as LessonExerciseDraft;

    const result = validatePool([draftEx], SUBJECT, TOPIC);
    expect(result.valid).toHaveLength(0);
    expect(result.rejected[0]?.errors.some((e) => e.includes("correctOption"))).toBe(true);
  });

  it("przepływ: payload zgodny z kontraktem → materializacja → wybór dziecka oceniony correct", async () => {
    const { services, clock } = buildTestServices();
    const child = await createChild(services, { displayName: "Shape", avatarKey: "owl" });
    const lesson = await lessonWorld(pool, { childId: child.id, richPool: true, now: clock.now() });
    const session = await startSession(services, { childId: child.id, deckId: lesson.deckId, microphoneEnabled: false });

    const task = await issueUntil(services, session.sessionId, "lesson_choice");
    const key = await answerKeyOf(task.taskId);

    // Dowód materializacji po poprawce: correctOptionId istnieje i wskazuje
    // opcję o tekście "plays" (odpowiedź kanoniczna) — nie undefined.
    expect(key.correctOptionId).toBeDefined();
    const options = (task.prompt as { options: { id: string; text: string }[] }).options;
    expect(options.find((o) => o.id === key.correctOptionId)?.text).toBe("plays");

    const attempt = await submitAttempt(services, {
      taskId: task.taskId,
      clientAttemptId: randomUUID(),
      modality: "choice",
      optionId: key.correctOptionId as string,
    });
    expect(attempt.feedback?.kind).toBe("great");
    expect(attempt.taskState).toBe("answered");
  });
});
