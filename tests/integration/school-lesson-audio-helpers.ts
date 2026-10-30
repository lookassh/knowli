import { randomUUID } from "node:crypto";
import { createChild, createServices, editLessonDraft, publishLessonDraft } from "@learning/server";
import type { LessonExerciseInput } from "@learning/contracts";
import { ManualClock, testDatabase } from "./helpers";

/**
 * Wspólny świat testów nagrań lekcji szkolnych — „Posłuchaj pytania” (design
 * szkoły §11) i „Posłuchaj karty” (§12): zagadnienie o pająkach, pula
 * spełniająca minima publikacji, fałszywa konfiguracja TTS i podmiana workera
 * gotowym zasobem.
 */

const { db, pool } = testDatabase();

export const SPIDER_OBJECTIVE = "school.ddeck000.pajaki";
const SPIDER_MATERIAL = "Pająk ma osiem nóg i nie jest owadem. Owady mają sześć nóg. Pająki tkają sieci z nici.";
export const FAKE_MEDIA = {
  tts: { provider: "fake", model: "fake-tts", voice: "test", format: "mp3" as const },
  image: { provider: "fake", model: "fake-image", size: "1024x1024", quality: "low", format: "webp" },
};

export function audioServices(media: typeof FAKE_MEDIA = FAKE_MEDIA) {
  return createServices({ db, clock: new ManualClock(), media });
}

export interface SeedObjective {
  id: string;
  titlePl: string;
  descriptionEn: string;
  cards: { title: string; body: string }[];
}

const shared = { objectiveId: SPIDER_OBJECTIVE, acceptedAnswers: [], sourceRefs: [{ quote: "Pająk ma osiem nóg i nie jest owadem." }] };

function choice(stem: string, answer: string): LessonExerciseInput {
  return {
    ...shared, exerciseType: "lesson_choice", instructionPl: "Wybierz odpowiedź.", stem, answer, focus: [answer],
    options: [{ id: "a", text: answer }, { id: "b", text: "cztery" }], correctOption: "a",
  };
}

function gap(answer: string): LessonExerciseInput {
  return { ...shared, exerciseType: "lesson_gap", instructionPl: "Uzupełnij.", stem: `Pająk ma ___ nóg (${answer}).`, answer, focus: [answer] };
}

function openAnswer(answer: string, index: number): LessonExerciseInput {
  return {
    ...shared, exerciseType: "lesson_open_answer", instructionPl: "Wyjaśnij.", prompt: `Wyjaśnij zasadę ${index + 1}.`, answer, focus: [answer],
    questionType: "definition", expectedForm: "explanation", requiredElements: [{ id: "e1", text: answer }],
  };
}

/** Pula pająków spełniająca minima publikacji szkoły; `firstStem` zmienia pytanie pierwszego wyboru. */
export function spiderExercises(firstStem?: string): LessonExerciseInput[] {
  const choices = ["osiem", "sześć", "sieci"].map((answer, index) =>
    choice(index === 0 && firstStem !== undefined ? firstStem : `Wybierz słowo: ${answer}.`, answer));
  const gaps = ["osiem", "sześć"].map(gap);
  const openAnswers = ["Pająk ma osiem nóg.", "Owady mają sześć nóg."].map(openAnswer);
  return [...choices, ...gaps, ...openAnswers];
}

/** Czyści tabele lekcji i mediów między testami (po `truncateCoreTables`). */
export async function truncateLessonAudioTables(): Promise<void> {
  await pool.query(`truncate learning_app.child_objective_progress, learning_app.lesson_verdicts, learning_app.lesson_card_assets,
    learning_app.revision_assets, learning_app.generation_runs, learning_app.media_assets, learning_app.item_revision_skills,
    learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
    learning_app.deck_versions, learning_app.decks cascade`);
}

/** Szkic lekcji szkolnej z tematem dynamicznym złożonym z podanych zagadnień. */
export async function seedSchoolDraft(
  objectives: SeedObjective[],
  examples: Record<string, string[]> = {},
): Promise<{ deckId: string; versionId: string }> {
  const context = {
    subjectId: "school", topicId: "dynamic", topicVersion: 1, objectiveIds: objectives.map((objective) => objective.id), poolSize: 20,
    examples, material: SPIDER_MATERIAL, subjectTitlePl: "Przyroda", dynamicTopic: { titlePl: "Pająki", objectives },
  };
  const [deckId, versionId] = [randomUUID(), randomUUID()];
  await pool.query("insert into learning_app.decks (id,title,kind) values ($1,'Pająki','lesson')", [deckId]);
  await pool.query(`insert into learning_app.deck_versions (id,deck_id,version_number,edit_number,state,title,lesson_context)
    values ($1,$2,1,1,'draft','Pająki',$3::jsonb)`, [versionId, deckId, JSON.stringify(context)]);
  return { deckId, versionId };
}

/** Publikuje szkic z pulą pająków i przypisuje go nowemu dziecku. */
export async function publishAssignedSpiderLesson(
  draft: { deckId: string; versionId: string },
  displayName: string,
  firstStem?: string,
) {
  const active = audioServices();
  const child = await createChild(active, { displayName, avatarKey: "owl" });
  const edited = await editLessonDraft(active, draft.versionId, { expectedEditNumber: 1, exercises: spiderExercises(firstStem) });
  await publishLessonDraft(active, draft.versionId, edited.editNumber);
  await pool.query("insert into learning_app.assignments (id,child_id,deck_id,test_date,test_goals) values ($1,$2,$3,CURRENT_DATE + 7,ARRAY['lesson'])", [randomUUID(), child.id, draft.deckId]);
  return { active, child, ...draft };
}

/** Zastępuje workera: gotowy, niezmienny zasób (bajty nieistotne dla wydania zadania). */
export async function markTtsReady(assetId: string): Promise<void> {
  await pool.query(
    `update learning_app.media_assets
        set state = 'ready', storage_key = $2, mime_type = 'audio/mpeg', byte_count = 3, content_sha256 = $3, lease_token = null
      where id = $1`,
    [assetId, `tts/${assetId}.mp3`, "0".repeat(64)],
  );
}
