import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSchoolLesson,
  createServices,
  executeLessonGeneration,
  publishLessonDraft,
  readGeneration,
  readLessonDeck,
  regenerateObjective,
  type Services,
} from "@learning/server";
import { messages, type LessonDraftDto } from "@learning/contracts";
import { emptyLessonAgentProgress } from "../../packages/server/src/modules/materials/lessons/lesson-agent-checkpoint";
import { FakeExerciseChecker } from "../../packages/server/src/providers/fake-lesson-agent";
import { fakeGeneration } from "./fakes";
import { ManualClock, testDatabase } from "./helpers";

/**
 * Szkoła na przebiegu bazowym (etap 5b, #362): produkcyjny rejestr, fake paczek i kontroli zamkniętych.
 * Etap zagadnień, paczki z keywords przy pytaniach otwartych, materiał w kontroli, brak podpowiedzi,
 * wznowienie punktu kontrolnego agenta z kontrolami 2b i „dodaj N” bez keywords.
 */

const { pool } = testDatabase();

const MATERIAL = [
  "Zagadnienie 1: Części rośliny",
  "Korzeń pobiera z gleby wodę i sole mineralne. Łodyga przewodzi wodę do liści. Liście wytwarzają pokarm w procesie fotosyntezy.",
  "Zagadnienie 2: Chrzest Polski",
  "Mieszko I przyjął chrzest w 966 roku. Chrzest wzmocnił państwo i dał mu sojuszników w Europie.",
].join("\n");

describe("szkoła na przebiegu bazowym (integracja, etap 5b)", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await pool.query(
      `truncate learning_app.child_profiles, learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
              learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
              learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  });

  afterAll(() => pool.end());

  async function schoolWorld() {
    const checker = new FakeExerciseChecker();
    const fakes = await fakeGeneration({ checker });
    disposers.push(fakes.dispose);
    const services: Services = createServices({ db: testDatabase().db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps });
    return { fakes, services, checker };
  }

  async function generate(services: Services): Promise<{ runId: string; deckId: string; draft: LessonDraftDto }> {
    const { runId, deckId } = await createSchoolLesson(services, {
      subjectTitlePl: "Przyroda",
      topicTitlePl: "Materiał",
      material: MATERIAL,
      poolSize: 40,
      clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");
    return { runId, deckId, draft: (await readLessonDeck(services, deckId)).draft! };
  }

  it("generuje się przebiegiem bazowym: keywords z rodziną pytania, kontrola z materiałem, bez podpowiedzi, szkic do publikacji", async () => {
    const { fakes, services, checker } = await schoolWorld();
    const { draft } = await generate(services);

    expect(fakes.llm.objectiveRequests).toHaveLength(1);
    expect(fakes.agent.calls).toHaveLength(0);
    expect(fakes.agent.packetCalls.length).toBeGreaterThan(0);
    // Keywords zamawia wyłącznie paczka pytań otwartych; żadnej paczki samych keywords.
    expect(fakes.agent.packetCalls.some((call) => call.type === "lesson_keywords")).toBe(false);
    expect(fakes.agent.packetCalls.filter((call) => call.pool.exerciseTypes.includes("lesson_keywords")).every((call) => call.type === "lesson_open_answer")).toBe(true);
    // Kontrola zamkniętych szkoły dostaje materiał lekcji.
    expect(checker.closedCalls.length).toBeGreaterThan(0);
    expect(checker.closedCalls.every((call) => call.material === MATERIAL)).toBe(true);

    expect(draft.exercises.some((exercise) => exercise.hint !== undefined && exercise.hint !== null)).toBe(false);
    const keywords = draft.exercises.filter((exercise) => exercise.exerciseType === "lesson_keywords");
    expect(keywords.length).toBeGreaterThan(0);
    for (const objectiveId of draft.objectiveIds) {
      expect(keywords.filter((exercise) => exercise.objectiveId === objectiveId).length).toBeLessThanOrEqual(1);
    }
    for (const exercise of keywords) {
      expect(draft.exercises.some((other) => other.exerciseType === "lesson_open_answer" && other.objectiveId === exercise.objectiveId && other.familyId === exercise.familyId)).toBe(true);
    }

    await expect(publishLessonDraft(services, draft.id, draft.editNumber)).resolves.toEqual({ deckVersionId: draft.id });
  });

  it("wznawia punkt kontrolny agenta z kontrolami 2b: bez etapu zagadnień, stare kody mają polskie etykiety", async () => {
    const { fakes, services } = await schoolWorld();
    const { runId, deckId } = await createSchoolLesson(services, {
      subjectTitlePl: "Przyroda",
      topicTitlePl: "Materiał",
      material: MATERIAL,
      poolSize: 40,
      clientRequestId: randomUUID(),
    });
    const plants = `school.d${deckId}.rosliny`;
    const baptism = `school.d${deckId}.chrzest`;
    const dynamicTopic = {
      titlePl: "Materiał",
      objectives: [
        { id: plants, titlePl: "Części rośliny", descriptionEn: "Plant parts.", cards: [{ title: "Pojęcia", body: "korzeń, łodyga, liście" }, { title: "Zadania", body: "Korzeń pobiera wodę." }] },
        { id: baptism, titlePl: "Chrzest Polski", descriptionEn: "Baptism of Poland.", cards: [{ title: "Daty", body: "966 — chrzest Mieszka I" }, { title: "Skutki", body: "Chrzest wzmocnił państwo." }] },
      ],
    };
    await pool.query("update learning_app.generation_runs set agent_checkpoint = $1::jsonb where id = $2", [
      JSON.stringify({
        ...emptyLessonAgentProgress(),
        dynamicTopic,
        objectives: { [plants]: { status: "incomplete", exercises: [], examples: [] } },
        rejectionCodes: { hint_reveals_paraphrase: 2, open_not_accepted: 1 },
        checkCounters: { hintJudged: 3, openChecked: 2 },
      }),
      runId,
    ]);

    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");
    expect(fakes.llm.objectiveRequests).toHaveLength(0);
    expect(fakes.agent.calls).toHaveLength(0);

    const draft = (await readLessonDeck(services, deckId)).draft!;
    expect(draft.objectiveIds).toEqual([plants, baptism]);
    const labels = messages.lessons.agentRejectionReasons;
    expect(draft.rejectedReasons?.[labels.hint_reveals_paraphrase]).toBe(2);
    expect(draft.rejectedReasons?.[labels.open_not_accepted]).toBe(1);
  });

  it("„dodaj N” na zagadnieniu szkoły: bez keywords, rodziny z sufiksem runu", async () => {
    const { fakes, services } = await schoolWorld();
    const { deckId, draft } = await generate(services);
    const objectiveId = draft.objectiveIds[0]!;
    const callsBefore = fakes.agent.packetCalls.length;

    const regen = await regenerateObjective(services, { deckId, objectiveId, count: 3, expectedEditNumber: draft.editNumber, clientRequestId: randomUUID() });
    await executeLessonGeneration(services, regen.runId);
    expect((await readGeneration(services, regen.runId)).state).toBe("succeeded");

    const added = fakes.agent.packetCalls.slice(callsBefore);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((call) => !call.pool.exerciseTypes.includes("lesson_keywords"))).toBe(true);
    const after = (await readLessonDeck(services, deckId)).draft!;
    const ofObjective = (current: LessonDraftDto) => current.exercises.filter((exercise) => exercise.objectiveId === objectiveId);
    expect(ofObjective(after).length).toBe(ofObjective(draft).length + 3);
    expect(ofObjective(after).filter((exercise) => exercise.exerciseType === "lesson_keywords").length).toBeLessThanOrEqual(1);
  });
});
