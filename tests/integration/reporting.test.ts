import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  createDraft,
  createDraftFromPublished,
  createServices,
  deleteChild,
  editDraft,
  endSession,
  getProgress,
  nextTask,
  publishDraft,
  startSession,
  submitAttempt,
  submitSpeechAttempt,
  upsertAssignment,
  type AppError,
  type PronunciationProvider,
  type SttProvider,
} from "@learning/server";
import { ProgressDtoSchema, type TaskDto } from "@learning/contracts";
import { buildTestServices, testDatabase, truncateCoreTables, type ManualClock } from "./helpers";

/**
 * Panel postępów rodzica (zadanie 10, SPEC §25): getProgress raportuje liczbę
 * opanowanych elementów osobno per umiejętność, kierunkowe pomyłki, wyniki
 * wymowy konkretnej usługi i historię prób; zmiana znaczenia wymaga ponownego
 * sprawdzenia bez utraty historii; usunięcie profilu usuwa próby dziecka.
 */

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

afterAll(async () => {
  await pool.end();
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await promise.then(
    () => {
      throw new Error(`Oczekiwano błędu ${code}, otrzymano sukces`);
    },
    (error: unknown) => {
      expect(error).toMatchObject({ code });
    },
  );
}

const DAYS: { source: string; target: string }[] = [
  { source: "poniedziałek", target: "Monday" },
  { source: "wtorek", target: "Tuesday" },
  { source: "środa", target: "Wednesday" },
  { source: "czwartek", target: "Thursday" },
  { source: "piątek", target: "Friday" },
  { source: "sobota", target: "Saturday" },
  { source: "niedziela", target: "Sunday" },
];

function vocabItem(pair: { source: string; target: string }) {
  return {
    source: pair.source,
    target: pair.target,
    acceptedAnswers: [],
    locales: { source: "pl-PL", target: "en-GB" },
    visualType: "color" as const,
    visualData: { color: "#4169e1" },
  };
}

async function revisionAt(deckVersionId: string, itemIndex: number): Promise<{ id: string; item_id: string }> {
  return (
    await query<{ id: string; item_id: string }>(
      `select id, item_id from learning_app.item_revisions
        where deck_version_id = $1 order by position offset $2 limit 1`,
      [deckVersionId, itemIndex],
    )
  )[0]!;
}

async function publishDeckWithAssignment(
  services: ReturnType<typeof buildTestServices>["services"],
  childIds: string[],
  pairs: { source: string; target: string }[],
  testDate: string | null = null,
): Promise<{ deckId: string; versionId: string }> {
  const draft = await createDraft(services, { title: `Zestaw ${pairs[0]!.target}`, items: pairs.map(vocabItem) });
  for (const index of pairs.keys()) {
    const revision = await revisionAt(draft.id, index);
    const assetId = randomUUID();
    const fingerprint = `fp-${randomUUID()}`;
    await pool.query(
      `insert into learning_app.media_assets
         (id, kind, fingerprint, generation_number, state, storage_key, content_sha256,
          mime_type, byte_count, provider, model)
       values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',1024,'fake','fake-tts')`,
      [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`],
    );
    await pool.query(
      `insert into learning_app.revision_assets
         (item_revision_id, role, asset_id, expected_fingerprint, state)
       values ($1,'target_audio',$2,$3,'approved'), ($1,'illustration',null,$4,'omitted')`,
      [revision.id, assetId, fingerprint, `fp-ill-${randomUUID()}`],
    );
  }
  await publishDraft(services, draft.id, 1);
  for (const childId of childIds) {
    await upsertAssignment(services, childId, draft.deckId, childIds[0] === childId ? testDate : null);
  }
  return { deckId: draft.deckId, versionId: draft.id };
}

/** Fixture projekcji: element o zadanym indeksie ma status umiejętności. */
async function setItemStatus(
  childId: string,
  versionId: string,
  itemIndex: number,
  skill: string,
  status: string,
): Promise<void> {
  const revision = await revisionAt(versionId, itemIndex);
  const rows = await query<{ skill_version_id: string }>(
    `select skill_version_id from learning_app.item_revision_skills where item_revision_id = $1 and skill = $2`,
    [revision.id, skill],
  );
  for (const row of rows) {
    await pool.query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
       values ($1,$2,$3,3,'2026-10-01T00:00:00Z','test')
       on conflict (child_id, skill_version_id) do update
         set status = excluded.status, independent_success_streak = 3,
             next_review_at = '2026-10-01T00:00:00Z'`,
      [childId, row.skill_version_id, status],
    );
  }
}

async function answerKeyOf(taskId: string): Promise<{ target: string; correctOptionId: string | null }> {
  return (
    await query<{ target: string; correctOptionId: string | null }>(
      `select answer_key->>'target' as target, answer_key->>'correctOptionId' as "correctOptionId"
         from learning_app.session_tasks where id = $1`,
      [taskId],
    )
  )[0]!;
}

/** Krótki WAV 8 kHz mono 16-bit — poprawny kontener (jak w speech.test). */
function wavInput(seconds: number): { bytes: Uint8Array; mimeType: string; locale: string } {
  const dataBytes = Math.round(seconds * 8000 * 2);
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return { bytes: new Uint8Array(buffer), mimeType: "audio/wav", locale: "en-GB" };
}

function optionsOf(task: TaskDto): { id: string; text: string }[] {
  const prompt = task.prompt as { options?: { id: string; text: string }[] };
  return prompt.options ?? [];
}

/** Zamyka zadanie poprawną odpowiedzią (przypadkowe zadania po drodze). */
async function answerCorrectly(
  services: ReturnType<typeof buildTestServices>["services"],
  task: TaskDto,
): Promise<void> {
  const key = await answerKeyOf(task.taskId);
  const options = optionsOf(task);
  if (options.length > 0) {
    await submitAttempt(services, {
      taskId: task.taskId,
      clientAttemptId: randomUUID(),
      modality: "choice",
      optionId: key.correctOptionId!,
    });
    return;
  }
  await submitAttempt(services, {
    taskId: task.taskId,
    clientAttemptId: randomUUID(),
    modality: "text",
    text: key.target,
  });
}

/**
 * Prawdziwy przepływ rodzica po zmianie znaczenia elementu (SPEC §84, §90):
 * szkic v2 z opublikowanej wersji → edycja znaczenia (nowe klucze
 * listening/reading/recall z predecessorami, zachowane wymowa/pisownia) →
 * publikacja v2, która przekierowuje zestaw. Historia zostaje przy v1.
 */
async function publishSecondVersionWithMeaningChange(
  services: ReturnType<typeof buildTestServices>["services"],
  deckId: string,
  changedIndex: number,
  newSource: string,
): Promise<void> {
  const v2 = await createDraftFromPublished(services, deckId);
  const edited = await editDraft(services, v2.id, {
    items: v2.items.map((item, index) =>
      index === changedIndex ? { ...item, source: newSource } : item,
    ),
    expectedEditNumber: v2.editNumber,
  });
  await publishDraft(services, v2.id, edited.editNumber);
}

describe("panel postępów rodzica (integracja)", () => {
  let services: ReturnType<typeof buildTestServices>["services"];
  let childA: string;
  let childB: string;

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );
    const built = buildTestServices();
    services = built.services;
    childA = (await createChild(services, { displayName: "Krzysiek", avatarKey: "fox" })).id;
    childB = (await createChild(services, { displayName: "Ola", avatarKey: "owl" })).id;
  });

  it("liczy opanowane elementy per umiejętność tylko dla wybranego dziecka", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, [childA, childB], DAYS, "2026-10-20");

    for (const index of DAYS.keys()) {
      await setItemStatus(childA, versionId, index, "listening", "mastered");
      await setItemStatus(childA, versionId, index, "reading", "mastered");
      if (index < 5) {
        await setItemStatus(childA, versionId, index, "recall", "mastered");
      }
      if (index < 3) {
        await setItemStatus(childA, versionId, index, "spelling", "mastered");
      }
    }

    const progress = await getProgress(services, childA, deckId);
    expect(ProgressDtoSchema.safeParse(progress).success).toBe(true);
    expect(progress.childName).toBe("Krzysiek");
    expect(progress.deckTitle).toBe("Zestaw Monday");
    expect(progress.testDate).toBe("2026-10-20");
    expect(progress.totalItems).toBe(7);
    expect(progress.skills).toEqual([
      { skill: "listening", totalItems: 7, mastered: 7, needsConfirmation: 0, needsReconfirmation: 0, practicing: 0, notAssessed: 0 },
      { skill: "reading", totalItems: 7, mastered: 7, needsConfirmation: 0, needsReconfirmation: 0, practicing: 0, notAssessed: 0 },
      { skill: "recall", totalItems: 7, mastered: 5, needsConfirmation: 0, needsReconfirmation: 0, practicing: 0, notAssessed: 2 },
      { skill: "pronunciation", totalItems: 7, mastered: 0, needsConfirmation: 0, needsReconfirmation: 0, practicing: 0, notAssessed: 7 },
      { skill: "spelling", totalItems: 7, mastered: 3, needsConfirmation: 0, needsReconfirmation: 0, practicing: 0, notAssessed: 4 },
    ]);
    // wymowa bez danych: wyraźna informacja „nie sprawdzono”
    expect(progress.pronunciation.assessed).toBe(false);
    expect(progress.pronunciation.latestScores).toEqual([]);
    expect(progress.confusions).toEqual([]);
    expect(progress.history).toEqual([]);

    // dziecko B nie dziedziczy żadnych wyników
    const other = await getProgress(services, childB, deckId);
    expect(ProgressDtoSchema.safeParse(other).success).toBe(true);
    expect(other.testDate).toBeNull();
    for (const summary of other.skills) {
      expect(summary).toMatchObject({ totalItems: 7, mastered: 0, notAssessed: 7 });
    }
    expect(other.pronunciation.assessed).toBe(false);

    // walidacja wejścia: nieznane dziecko i nieopublikowany zestaw
    await expectAppError(getProgress(services, randomUUID(), deckId), "not_found");
    const draftOnly = await createDraft(services, { title: "Szkic", items: DAYS.slice(0, 2).map(vocabItem) });
    await expectAppError(getProgress(services, childA, draftOnly.deckId), "not_found");
  });

  it("pomyłka zachowuje kierunek: Thursday → Tuesday nie tworzy pary w drugą stronę", async () => {
    const pairs = [DAYS[3]!, DAYS[1]!, DAYS[2]!]; // czwartek/Thursday, wtorek/Tuesday, środa/Wednesday
    const { deckId } = await publishDeckWithAssignment(services, [childA], pairs);

    const session = await startSession(services, { childId: childA, deckId, microphoneEnabled: false });
    let confused: TaskDto | null = null;
    for (let step = 0; step < 40 && confused === null; step++) {
      const task = (await nextTask(services, session.sessionId))!;
      expect(task).not.toBeNull();
      if (task.exerciseType === "exposure") {
        await completePresentation(services, { taskId: task.taskId });
        continue;
      }
      const key = await answerKeyOf(task.taskId);
      const options = optionsOf(task);
      if (key.target === "Thursday" && options.some((o) => o.text === "Tuesday")) {
        confused = task;
        break;
      }
      await answerCorrectly(services, task);
    }
    expect(confused).not.toBeNull();
    const tuesday = optionsOf(confused!).find((o) => o.text === "Tuesday")!;
    await submitAttempt(services, {
      taskId: confused!.taskId,
      clientAttemptId: randomUUID(),
      modality: "choice",
      optionId: tuesday.id,
    });
    await submitAttempt(services, {
      taskId: confused!.taskId,
      clientAttemptId: randomUUID(),
      modality: "choice",
      optionId: tuesday.id,
    });
    const storedChoiceEvidence = await query<{ expectedItemRevisionId: string; answeredItemRevisionId: string; taskRevisionId: string; selectedRevisionId: string }>(
      `select a.details, a.details->>'expectedItemRevisionId' as "expectedItemRevisionId",
             a.details->>'answeredItemRevisionId' as "answeredItemRevisionId", t.item_revision_id as "taskRevisionId",
             t.answer_key->'optionItemRevisionIds'->>(attempt.answer->>'optionId') as "selectedRevisionId"
         from learning_app.assessments a
         join learning_app.attempts attempt on attempt.id = a.attempt_id
         join learning_app.session_tasks t on t.id = attempt.task_id
        where attempt.task_id = $1
          and a.skill = 'reading'`,
      [confused!.taskId],
    );
    expect(storedChoiceEvidence[0]?.expectedItemRevisionId).toBe(storedChoiceEvidence[0]?.taskRevisionId);
    expect(storedChoiceEvidence[0]?.answeredItemRevisionId).toBe(storedChoiceEvidence[0]?.selectedRevisionId);
    await endSession(services, session.sessionId);

    const progress = await getProgress(services, childA, deckId);
    expect(progress.confusions).toEqual([{ expected: "Thursday", answered: "Tuesday", count: 2 }]);
    // kierunek ma znaczenie: pary w drugą stronę nie ma
    expect(progress.confusions).not.toContainEqual({ expected: "Tuesday", answered: "Thursday", count: 1 });
    // próba widoczna w historii z wynikiem i samodzielnością
    expect(progress.history.length).toBeGreaterThan(0);
    expect(
      progress.history.some((h) => h.target === "Thursday" && h.outcome === "incorrect" && h.independent),
    ).toBe(true);
  });

  it("wyniki wymowy pochodzą od konkretnej usługi i nie są uśredniane", async () => {
    const pairs = [DAYS[3]!, DAYS[1]!, DAYS[2]!];
    const { deckId, versionId } = await publishDeckWithAssignment(services, [childA], pairs);
    await setItemStatus(childA, versionId, 0, "pronunciation", "needs_confirmation");
    await setItemStatus(childA, versionId, 1, "pronunciation", "needs_confirmation");

    const { clock } = buildTestServices();
    const fake: {
      transcription: { status: string; text: string | null; confidence: number | null };
      pronunciation: { status: string; overallScore: number | null; recognizedText: string | null };
    } = {
      transcription: { status: "ok", text: "Thursday", confidence: 0.9 },
      pronunciation: { status: "ok", overallScore: 95, recognizedText: "Thursday" },
    };
    const speechServices = createServices({
      db: testDatabase().db,
      clock,
      speech: {
        stt: {
          name: "fake-stt",
          transcribe: async () => fake.transcription as { status: "ok"; text: string; confidence: number },
        },
        pronunciation: {
          name: "fake-pron",
          assess: async () => fake.pronunciation as { status: "ok"; overallScore: number; recognizedText: string },
        },
      },
    });

    const session = await startSession(speechServices, { childId: childA, deckId, microphoneEnabled: true });
    const spoken: string[] = [];
    for (let step = 0; step < 40 && spoken.length < 2; step++) {
      const task = (await nextTask(speechServices, session.sessionId))!;
      expect(task).not.toBeNull();
      if (task.exerciseType === "exposure") {
        await completePresentation(speechServices, { taskId: task.taskId });
        continue;
      }
      if (task.exerciseType !== "speech") {
        await pool.query(
          `update learning_app.session_tasks set state = 'answered' where id = $1 and state = 'issued'`,
          [task.taskId],
        );
        continue;
      }
      const key = await answerKeyOf(task.taskId);
      fake.transcription = { status: "ok", text: key.target, confidence: 0.9 };
      fake.pronunciation = { status: "ok", overallScore: key.target === "Thursday" ? 95 : 40, recognizedText: key.target };
      await submitSpeechAttempt(speechServices, { taskId: task.taskId, clientAttemptId: randomUUID() }, wavInput(1));
      spoken.push(key.target);
      // niekalibrowane pasma nie kończą zadania — zamykamy ręcznie, by wydać kolejne
      await pool.query(
        `update learning_app.session_tasks set state = 'answered' where id = $1 and state = 'issued'`,
        [task.taskId],
      );
    }
    expect(spoken.sort()).toEqual(["Thursday", "Tuesday"]);
    await endSession(speechServices, session.sessionId);

    const progress = await getProgress(services, childA, deckId);
    expect(progress.pronunciation.assessed).toBe(true);
    const scores = [...progress.pronunciation.latestScores].sort((a, b) => a.target.localeCompare(b.target));
    expect(scores).toEqual([
      // pasma v2 (design 2026-10-09): 95 → correct, 40 → below
      { target: "Thursday", provider: "fake-pron", score: 95, band: "correct", assessedAt: expect.any(String) },
      { target: "Tuesday", provider: "fake-pron", score: 40, band: "below", assessedAt: expect.any(String) },
    ]);
    // żadnej uśrednionej wartości z nieporównywalnych skal
    expect(scores.some((s) => s.score === 67.5)).toBe(false);
  });

  it("zmiana znaczenia wymaga ponownego sprawdzenia nowego klucza, a stary wynik zostaje w historii", async () => {
    const pairs = [DAYS[3]!, DAYS[1]!, DAYS[2]!];
    const { deckId, versionId } = await publishDeckWithAssignment(services, [childA, childB], pairs);

    // dziecko zalicza Recall czwartku poprawną pisemną odpowiedzią
    await setItemStatus(childA, versionId, 0, "recall", "needs_confirmation");
    const session = await startSession(services, { childId: childA, deckId, microphoneEnabled: false });
    const task = (await nextTask(services, session.sessionId))!;
    expect(task.exerciseType).toBe("recall");
    await submitAttempt(services, {
      taskId: task.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: "Thursday",
    });
    await endSession(services, session.sessionId);

    const before = await getProgress(services, childA, deckId);
    const thursday = before.items.find((item) => item.target === "Thursday")!;
    expect(thursday.skills.recall).toBe("practicing");
    expect(thursday.skills.spelling).toBe("practicing");
    expect(thursday.meaningChanged).toBe(false);

    // rodzic zmienia znaczenie słowa i publikuje wersję 2
    await publishSecondVersionWithMeaningChange(services, deckId, 0, "czwartek (dzień)");

    const after = await getProgress(services, childA, deckId);
    const changed = after.items.find((item) => item.target === "Thursday")!;
    // nowy klucz Recall wymaga ponownego sprawdzenia (SPEC §90)
    expect(changed.skills.recall).toBe("needs_confirmation");
    expect(changed.meaningChanged).toBe(true);
    // niezmienione angielskie słowo zachowuje wynik pisowni (SPEC §90)
    expect(changed.skills.spelling).toBe("practicing");
    // elementy bez zmian bez wyników
    for (const item of after.items.filter((i) => i.target !== "Thursday")) {
      expect(item.meaningChanged).toBe(false);
      expect(item.skills.recall).toBe("not_assessed");
    }
    // stary wynik pozostaje czytelny w historii — ze słowami, które dziecko widziało
    expect(after.history).toHaveLength(2);
    expect(
      after.history.some(
        (h) =>
          h.source === "czwartek" && h.target === "Thursday" && h.skill === "recall" &&
          h.outcome === "correct" && h.independent && h.modality === "text",
      ),
    ).toBe(true);

    // dziecko B bez zmian; usunięcie A kasuje jego próby, wspólny zestaw zostaje
    const other = await getProgress(services, childB, deckId);
    expect(other.items.find((item) => item.target === "Thursday")!.skills.recall).toBe("not_assessed");

    const deckCount = (await query<{ count: number }>(`select count(*)::int as count from learning_app.decks`))[0]!.count;
    const itemCount = (await query<{ count: number }>(`select count(*)::int as count from learning_app.learning_items`))[0]!.count;
    await deleteChild(services, childA);
    expect((await query<{ count: number }>(`select count(*)::int as count from learning_app.attempts`))[0]!.count).toBe(0);
    expect((await query<{ count: number }>(`select count(*)::int as count from learning_app.decks`))[0]!.count).toBe(deckCount);
    expect((await query<{ count: number }>(`select count(*)::int as count from learning_app.learning_items`))[0]!.count).toBe(itemCount);
    const remaining = await getProgress(services, childB, deckId);
    expect(remaining.history).toEqual([]);
  });
});
