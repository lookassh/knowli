import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getLearningOverview,
  getProgress,
  issueIntegrationToken,
  listKidDecks,
  rebuildProgress,
  startSession,
  submitAttempt,
  type AppError,
} from "@learning/server";
import { ProgressDtoSchema } from "@learning/contracts";
import { lessonWorld } from "../fixtures/lesson-world";
import { mockTestDeck } from "./mock-test-helpers";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

/**
 * Zadanie 9: lekcja (`decks.kind='lesson'`) przypisana dziecku nie może wyciec
 * do logiki słówek — learning-overview, raport postępu, lista zestawów dziecka,
 * start sesji / próba / kartkówka, odbudowa postępu. Operacja słówkowa na lekcji
 * kończy się `deck_kind_mismatch`.
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

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await promise.then(
    () => {
      throw new Error(`Oczekiwano błędu ${code}, otrzymano sukces`);
    },
    (error: unknown) => {
      expect((error as AppError).code).toBe(code);
    },
  );
}

function freshToken(): string {
  return `umiem_${randomUUID()}_${randomBytes(32).toString("base64url")}`;
}

describe("izolacja lekcji od ścieżek słówek", () => {
  it("learning-overview identyczny z lekcją i bez niej", async () => {
    const { services } = buildTestServices("2026-10-11T17:00:00.000Z");
    const vocab = await mockTestDeck(services, 2, true);
    const token = freshToken();
    await issueIntegrationToken(services, "test isolation", token);

    const before = await getLearningOverview(services, { days: 3, upcomingTestDays: 14 }, token);
    await lessonWorld(pool, { childId: vocab.childId, testDate: "2026-10-20", now: new Date("2026-10-11T17:00:00.000Z") });
    const after = await getLearningOverview(services, { days: 3, upcomingTestDays: 14 }, token);

    expect(after).toEqual(before);
  });

  it("raport postępu słówek bez zmian; postęp dla lekcji → deck_kind_mismatch", async () => {
    const { services } = buildTestServices();
    const vocab = await mockTestDeck(services, 2, true);
    const vocabBefore = await getProgress(services, vocab.childId, vocab.deckId);
    const lesson = await lessonWorld(pool, { childId: vocab.childId });
    const vocabAfter = await getProgress(services, vocab.childId, vocab.deckId);
    expect(ProgressDtoSchema.parse(vocabAfter)).toEqual(vocabBefore);

    await expectAppError(getProgress(services, vocab.childId, lesson.deckId), "deck_kind_mismatch");
  });

  it("lista zestawów dziecka: lekcja z kind=lesson i tytułem przedmiotu, słówka z kind=vocabulary", async () => {
    const { services } = buildTestServices();
    const vocab = await mockTestDeck(services, 2, true);
    const lesson = await lessonWorld(pool, { childId: vocab.childId });

    const decks = await listKidDecks(services, vocab.childId);
    const lessonDeck = decks.find((d) => d.deckId === lesson.deckId)!;
    const vocabDeck = decks.find((d) => d.deckId === vocab.deckId)!;

    expect(lessonDeck.kind).toBe("lesson");
    expect(lessonDeck.subjectTitle).toBe("Angielski — gramatyka");
    expect(lessonDeck).toMatchObject({ independentlyRecalledCount: 0, recommended: false, mockTestAvailable: false });
    expect(vocabDeck.kind).toBe("vocabulary");
    expect(vocabDeck.subjectTitle ?? null).toBeNull();
  });

  it("start sesji / próba / kartkówka dla lekcji → deck_kind_mismatch", async () => {
    const { services } = buildTestServices();
    const vocab = await mockTestDeck(services, 2, true);
    const lesson = await lessonWorld(pool, { childId: vocab.childId });

    await expectAppError(
      startSession(services, { childId: vocab.childId, deckId: lesson.deckId, microphoneEnabled: false }),
      "deck_kind_mismatch",
    );
    await expectAppError(
      startSession(services, { childId: vocab.childId, deckId: lesson.deckId, microphoneEnabled: false, mode: "mock_test" }),
      "deck_kind_mismatch",
    );
    await expectAppError(
      submitAttempt(services, { taskId: randomUUID(), clientAttemptId: randomUUID(), modality: "text", text: "plays" }),
      "not_found",
    );
  });

  it("odbudowa postępu słówek nie zmienia nic przy ocenach celów (objective)", async () => {
    const { services } = buildTestServices();
    const vocab = await mockTestDeck(services, 2, true);
    await lessonWorld(pool, { childId: vocab.childId, withObjectiveAssessment: true, now: new Date() });

    const report = await rebuildProgress(services, { childId: vocab.childId, apply: true });
    // Umiejętność celu nie jest umiejętnością słówek: nie wstawia/aktualizuje/usuwa
    // projekcji child_skill_progress.
    expect(report.inserted).toBe(0);
    expect(report.updated).toBe(0);
    expect(report.deleted).toBe(0);
    // child_skill_progress nie zyskuje wiersza objective
    const vocabProjections = await pool.query<{ count: number }>(
      `select count(*)::int as count from learning_app.child_skill_progress csp
         join learning_app.skill_versions sv on sv.id = csp.skill_version_id
        where csp.child_id = $1 and sv.skill = 'objective'`,
      [vocab.childId],
    );
    expect(vocabProjections.rows[0]!.count).toBe(0);
    // ocena celu nadal istnieje (nie została ruszona)
    const objective = await pool.query<{ count: number }>(
      "select count(*)::int as count from learning_app.assessments where child_id = $1 and skill = 'objective'",
      [vocab.childId],
    );
    expect(objective.rows[0]!.count).toBe(1);
  });
});
