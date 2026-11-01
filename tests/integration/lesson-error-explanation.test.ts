import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLesson, createLessonDraftFromPublished, createServices, createSubjectRegistry, editLessonDraft, englishGrammarSubject,
  executeLessonGeneration, publishLessonDraft, readLessonDeck, regenerateLessonPromptAudio, runDueGenerationWork,
} from "@learning/server";
import type { LessonDraftDto } from "@learning/contracts";
import { STYLE_SENTENCES_PL } from "../../packages/server/src/providers/tts-style-profile";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import { audioServices, generationsOf, seedSchoolDraft, SPIDER_OBJECTIVE, spiderExercises, truncateLessonAudioTables } from "./school-lesson-audio-helpers";

/**
 * Wyjaśnienie błędu dla dziecka (issue #196): `explanationPl` ćwiczenia ma nagranie
 * `explanation_audio` (pl-PL, styl `lesson_explanation`) planowane przy przygotowaniu
 * materiału. Nie blokuje publikacji, nie jest zasobem do decyzji rodzica i zależy od
 * flagi przedmiotu `exerciseExplanations`.
 */

const { db, pool } = testDatabase();
const OBJECTIVE = "english_grammar.present_simple.third_person_s";
const FAKE_EXPLANATION = "Ta reguła mówi, jak zbudować poprawne zdanie.";
const cleanup: Array<() => Promise<void>> = [];

beforeEach(async () => {
  await truncateCoreTables();
  await truncateLessonAudioTables();
  await pool.query(`truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
    learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
    learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`);
});
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
afterAll(() => pool.end());

type Fakes = Awaited<ReturnType<typeof fakeGeneration>>;

const withoutExplanations = () => createSubjectRegistry([{ ...englishGrammarSubject, exerciseExplanations: false }]);

async function generatedGrammarLesson() {
  const fakes = await fakeGeneration();
  cleanup.push(fakes.dispose);
  const services = createServices({ db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps });
  const run = await createLesson(services, {
    subjectId: "english_grammar", topicId: "present_simple", objectiveIds: [OBJECTIVE],
    material: "He plays football. She reads books. She watches TV.", poolSize: 20, clientRequestId: randomUUID(),
  });
  await executeLessonGeneration(services, run.runId);
  const draft = (await readLessonDeck(services, run.deckId)).draft!;
  return { services, run, draft, fakes };
}

interface ExplanationRow { revisionId: string; position: number; assetId: string; fingerprint: string; text: string; locale: string; state: string; ready: string }

async function explanationRows(versionId: string): Promise<ExplanationRow[]> {
  return (await pool.query<ExplanationRow>(
    `select ir.id as "revisionId", ir.position, ra.asset_id as "assetId", ra.expected_fingerprint as fingerprint,
            ma.metadata->>'text' as text, ma.metadata->>'locale' as locale, ra.state, ma.state as ready
       from learning_app.revision_assets ra
       join learning_app.item_revisions ir on ir.id = ra.item_revision_id
       join learning_app.media_assets ma on ma.id = ra.asset_id
      where ir.deck_version_id = $1 and ra.role = 'explanation_audio'
      order by ir.position`,
    [versionId],
  )).rows;
}

async function drainWorker(services: ReturnType<typeof createServices>) {
  for (let pass = 0; pass < 20; pass += 1) {
    const result = await runDueGenerationWork(services, { lesson: 0, deck: 0, tts: 50, images: 0 });
    if (result.processed === 0) break;
  }
}

function inputs(draft: LessonDraftDto, edit: (exercise: Record<string, unknown>, index: number) => Record<string, unknown> = (exercise) => exercise) {
  return draft.exercises.map((exercise, index) => {
    const { revisionId: _revision, promptAudio: _prompt, explanationAudio: _explanation, ...rest } = exercise;
    return edit(rest as Record<string, unknown>, index);
  });
}

describe("nagranie wyjaśnienia", () => {
  it("generacja gramatyki zleca explanation_audio (pl-PL) per ćwiczenie; DTO szkicu niesie stan i flagę, a lista zasobów go pomija", async () => {
    const { draft } = await generatedGrammarLesson();
    const rows = await explanationRows(draft.id);
    expect(rows).toHaveLength(draft.exercises.length);
    for (const row of rows) expect(row).toMatchObject({ text: FAKE_EXPLANATION, locale: "pl-PL", state: "pending", ready: "pending" });
    expect(draft.exerciseExplanations).toBe(true);
    for (const exercise of draft.exercises) expect(exercise.explanationAudio).toEqual({ state: "pending" });
    expect(draft.assets.some((asset) => (asset.role as string) === "explanation_audio")).toBe(false);
    expect(draft.assets).toEqual([]);
  });

  it("publikacja nie czeka na pending explanation_audio", async () => {
    const { services, draft } = await generatedGrammarLesson();
    expect((await explanationRows(draft.id)).every((row) => row.state === "pending")).toBe(true);
    await expect(publishLessonDraft(services, draft.id, draft.editNumber)).resolves.toEqual({ deckVersionId: draft.id });
    const published = (await readLessonDeck(services, draft.deckId)).published!;
    expect(published.assets.some((asset) => (asset.role as string) === "explanation_audio")).toBe(false);
  });

  it("publikacja zleca ponownie nieudane nagranie wyjaśnienia (nie jest decyzją rodzica)", async () => {
    const { services, draft } = await generatedGrammarLesson();
    const [failed] = await explanationRows(draft.id);
    await pool.query("update learning_app.media_assets set state = 'failed', lease_token = null where id = $1", [failed!.assetId]);
    await publishLessonDraft(services, draft.id, draft.editNumber);
    const rows = await explanationRows(draft.id);
    expect(rows).toHaveLength(draft.exercises.length);
    for (const row of rows) {
      expect(row.assetId).not.toBe(failed!.assetId);
      expect(row).toMatchObject({ state: "pending", ready: "pending", text: failed!.text });
    }
  });

  it("CHECK roli przyjmuje explanation_audio i dalej odrzuca nieznane role", async () => {
    const { draft } = await generatedGrammarLesson();
    const revision = (await pool.query(`select id from learning_app.item_revisions where deck_version_id = $1 limit 1`, [draft.id])).rows[0].id;
    await pool.query(`delete from learning_app.revision_assets where item_revision_id = $1 and role = 'explanation_audio'`, [revision]);
    await expect(pool.query(
      `insert into learning_app.revision_assets (item_revision_id, role, expected_fingerprint, state) values ($1, 'explanation_audio', 'fp', 'pending')`, [revision],
    )).resolves.toBeDefined();
    await expect(pool.query(
      `insert into learning_app.revision_assets (item_revision_id, role, expected_fingerprint, state) values ($1, 'bogus_audio', 'fp', 'pending')`, [revision],
    )).rejects.toThrow(/revision_assets_role_allowed/);
  });

  it("worker nagrywa wyjaśnienie (pl-PL, ze zdaniem stylu) i DTO pokazuje gotowe nagranie", async () => {
    const { fakes, draft } = await generatedGrammarLesson();
    const styled = { ...fakes.settings, tts: { ...fakes.settings.tts, style: "instructions" as const } };
    // Zmiana trybu stylu zmienia instrukcje, więc uzgodnienie przy zapisie zleca nagranie ze zdaniem stylu.
    const services = createServices({ db, clock: new ManualClock(), media: styled, generation: fakes.deps });
    const saved = await editLessonDraft(services, draft.id, { expectedEditNumber: draft.editNumber, exercises: inputs(draft) });
    await drainWorker(services);

    const rows = await explanationRows(saved.id);
    expect(rows).toHaveLength(saved.exercises.length);
    expect(rows.every((row) => row.ready === "ready")).toBe(true);
    const requested = fakes.tts.requests.filter((request) => request.locale === "pl-PL" && request.text === FAKE_EXPLANATION);
    expect(requested.length).toBeGreaterThan(0);
    expect(requested[0]!.instructions).toContain(STYLE_SENTENCES_PL.lesson_explanation);

    const ready = (await readLessonDeck(services, saved.deckId)).draft!;
    for (const exercise of ready.exercises) expect(exercise.explanationAudio).toMatchObject({ state: "ready", assetId: expect.any(String) });
  });

  it("worker z wyłączoną flagą przedmiotu zastępuje oczekujące explanation_audio bez wołania TTS", async () => {
    const { fakes, draft } = await generatedGrammarLesson();
    const rows = await explanationRows(draft.id);
    const assetIds = [...new Set(rows.map((row) => row.assetId))];
    // Przedmiot traci flagę wyjaśnień, ale zachowuje odczyt zdań feedbacku: tylko wyjaśnienia są anulowane.
    const services = createServices({ db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps, subjects: withoutExplanations() });
    await drainWorker(services);
    expect(fakes.tts.requests.some((request) => request.text === FAKE_EXPLANATION)).toBe(false);
    expect(fakes.tts.requests.length).toBeGreaterThan(0);
    const assets = (await pool.query<{ state: string }>("select state from learning_app.media_assets where id = any($1)", [assetIds])).rows;
    expect(assets.every((asset) => asset.state === "failed")).toBe(true);
    const runs = (await pool.query<{ state: string }>("select state from learning_app.generation_runs where asset_id = any($1)", [assetIds])).rows;
    expect(runs.every((run) => run.state === "superseded")).toBe(true);
  });

  it("przedmiot bez flagi nie ma roli ani pola w DTO szkicu (szkoła)", async () => {
    const { versionId } = await seedSchoolDraft([{ id: SPIDER_OBJECTIVE, titlePl: "Pająki", descriptionEn: "Spiders.",
      cards: [{ title: "Pająki", body: "Pająk ma osiem nóg." }, { title: "Owady", body: "Owady mają sześć nóg." }] }]);
    const draft = await editLessonDraft(audioServices(), versionId, { expectedEditNumber: 1, exercises: spiderExercises() });
    expect(draft).not.toHaveProperty("exerciseExplanations");
    for (const exercise of draft.exercises) expect(exercise).not.toHaveProperty("explanationAudio");
    expect(await explanationRows(versionId)).toEqual([]);
  });

  it("zapis szkicu z wyczyszczonym wyjaśnieniem usuwa wiersz roli tylko tego ćwiczenia", async () => {
    const { services, draft } = await generatedGrammarLesson();
    const saved = await editLessonDraft(services, draft.id, {
      expectedEditNumber: draft.editNumber,
      exercises: inputs(draft, (exercise, index) => {
        if (index !== 0) return exercise;
        const { explanationPl: _removed, ...rest } = exercise;
        return rest;
      }),
    });
    const rows = await explanationRows(saved.id);
    expect(rows).toHaveLength(draft.exercises.length - 1);
    expect(saved.exercises[0]).not.toHaveProperty("explanationAudio");
    expect(saved.exercises[0]).not.toHaveProperty("explanationPl");
    expect(saved.exercises.slice(1).every((exercise) => exercise.explanationAudio?.state === "pending")).toBe(true);
    expect(rows.map((row) => row.position)).not.toContain(0);
  });
});

describe("nagranie wyjaśnienia — „Nagraj ponownie”", () => {
  it("role explanation_audio zleca nową generację tego samego fingerprintu, a wiersz wraca do pending", async () => {
    const { fakes, draft } = await generatedGrammarLesson();
    const worker = createServices({ db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps });
    await drainWorker(worker);
    const [first] = await explanationRows(draft.id);
    expect(first).toMatchObject({ ready: "ready" });

    const { assetId } = await regenerateLessonPromptAudio(worker, { lessonDraftId: draft.id, itemRevisionId: first!.revisionId, role: "explanation_audio" });
    expect(assetId).not.toBe(first!.assetId);
    const generations = await generationsOf(first!.fingerprint);
    expect(generations.map((generation) => generation.generationNumber)).toEqual([1, 2]);
    const row = (await explanationRows(draft.id)).find((entry) => entry.revisionId === first!.revisionId)!;
    expect(row).toMatchObject({ assetId, state: "pending", ready: "pending" });

    // Odsłuch rodzica: nowe nagranie w toku niesie poprzednie gotowe ujęcie.
    const deck = (await readLessonDeck(worker, draft.deckId)).draft!;
    expect(deck.exercises.find((exercise) => exercise.revisionId === first!.revisionId)!.explanationAudio)
      .toEqual({ state: "pending", previousAssetId: first!.assetId });
  });

  it("brak wiersza roli (ćwiczenie bez wyjaśnienia) daje not_found; wywołanie bez role dotyczy prompt_audio i nie rusza wyjaśnienia", async () => {
    const { services, draft } = await generatedGrammarLesson();
    const saved = await editLessonDraft(services, draft.id, {
      expectedEditNumber: draft.editNumber,
      exercises: inputs(draft, (exercise, index) => {
        if (index !== 0) return exercise;
        const { explanationPl: _removed, ...rest } = exercise;
        return rest;
      }),
    });
    const cleared = saved.exercises[0]!.revisionId;
    await expect(regenerateLessonPromptAudio(services, { lessonDraftId: saved.id, itemRevisionId: cleared, role: "explanation_audio" }))
      .rejects.toMatchObject({ code: "not_found" });

    // Gramatyka nie ma nagrań pytań (`ttsForPrompts: false`), więc domyślna rola `prompt_audio` nie ma wiersza.
    const withExplanation = saved.exercises[1]!.revisionId;
    const before = await explanationRows(saved.id);
    await expect(regenerateLessonPromptAudio(services, { lessonDraftId: saved.id, itemRevisionId: withExplanation }))
      .rejects.toMatchObject({ code: "not_found" });
    expect(await explanationRows(saved.id)).toEqual(before);
    expect((await generationsOf(before[0]!.fingerprint)).map((generation) => generation.generationNumber)).toEqual([1]);
  });

  it("nieznana rola jest odrzucana walidacją", async () => {
    const { services, draft } = await generatedGrammarLesson();
    await expect(regenerateLessonPromptAudio(services, {
      lessonDraftId: draft.id, itemRevisionId: draft.exercises[0]!.revisionId, role: "feedback_audio" as never,
    })).rejects.toThrow();
  });
});

describe("nagranie wyjaśnienia — edycja po publikacji", () => {
  it("edycja samego wyjaśnienia zachowuje skill_version i payload_version, a zleca nowe nagranie", async () => {
    const { services, run, draft } = await generatedGrammarLesson();
    await publishLessonDraft(services, draft.id, draft.editNumber);
    const copy = await createLessonDraftFromPublished(services, run.deckId);
    const stateOf = async (versionId: string) => (await pool.query<{ position: number; payloadVersion: number; skills: string }>(
      `select ir.position, ir.payload_version as "payloadVersion",
              string_agg(irs.skill || ':' || irs.skill_version_id::text, ',' order by irs.skill) as skills
         from learning_app.item_revisions ir
         left join learning_app.item_revision_skills irs on irs.item_revision_id = ir.id
        where ir.deck_version_id = $1 group by ir.id, ir.position order by ir.position`,
      [versionId],
    )).rows;
    const before = await stateOf(copy.id);
    expect(before.length).toBe(draft.exercises.length);

    const changed = "Po he, she i it dodajemy s.";
    const edited = await editLessonDraft(services, copy.id, {
      expectedEditNumber: copy.editNumber,
      exercises: inputs(copy, (exercise, index) => (index === 0 ? { ...exercise, explanationPl: changed } : exercise)),
    });
    expect(await stateOf(edited.id)).toEqual(before);

    const rows = await explanationRows(edited.id);
    const updated = rows.find((row) => row.text === changed)!;
    expect(updated).toMatchObject({ state: "pending", ready: "pending", locale: "pl-PL" });
    expect(rows.filter((row) => row.text === FAKE_EXPLANATION)).toHaveLength(draft.exercises.length - 1);
    const queued = await pool.query(
      "select count(*)::int as count from learning_app.generation_runs where asset_id = $1 and state = 'queued'", [updated.assetId]);
    expect(queued.rows[0].count).toBe(1);

    await expect(publishLessonDraft(services, edited.id, edited.editNumber)).resolves.toEqual({ deckVersionId: edited.id });
  });
});
