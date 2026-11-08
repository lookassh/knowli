import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  computeTargetKey,
  createChild,
  createLessonFromMaterial,
  createSchoolLesson,
  createServices,
  editLessonDraft,
  endSession,
  executeLessonGeneration,
  nextTask,
  publishLessonDraft,
  readGeneration,
  readLessonDeck,
  regenerateObjective,
  startSession,
  submitAttempt,
  type Services,
} from "@learning/server";
import { LessonExerciseInputSchema, type LessonDraftDto, type TaskDto } from "@learning/contracts";
import { lessonPoolMinimums } from "../../packages/server/src/domain/lessons/lesson-coverage";
import { stageOf } from "../../packages/server/src/domain/lessons/stages";
import { englishChapterSubject } from "../../packages/server/src/domain/lessons/subjects/english-chapter/module";
import { englishCardSentences } from "../../packages/server/src/domain/lessons/subjects/english/card-sentences";
import type { LessonExerciseDraft } from "../../packages/server/src/domain/lessons/types";
import { emptyLessonAgentProgress } from "../../packages/server/src/modules/materials/lessons/lesson-agent-checkpoint";
import type { FakeLessonPoolAgentOptions } from "../../packages/server/src/providers/fake-lesson-agent";
import { seedChapterDraft } from "./chapter-lesson-helpers";
import { fakeGeneration } from "./fakes";
import { ManualClock, rejectionCodesOf, testDatabase } from "./helpers";
import { mockTestDeck } from "./mock-test-helpers";

/**
 * Lekcja „Angielski — rozdział” na PostgreSQL z fałszywymi providerami (design 2026-10-30, §4 i §8). Od etapu 5a
 * (#362) rozdział generuje przebieg bazowy: zagadnienia z rodzajem z etapu zagadnień (fake LLM: sekcje „Słowa:”/
 * „Zwroty:” albo nagłówki „Zagadnienie N:”), ćwiczenia z paczek fake'a generatora, kontrola zamkniętych. Poza
 * generowaniem: pula bez cytatów, edycja rodzica, zdania kart jako źródła ujawnień, ekspozycja rozwiązanego zdania
 * w samodzielności, języki w Kid DTO i kartkówka (pule sterowane zasiewa `seedChapterDraft`).
 */

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

/** Rozdział w trzech zagadnieniach słów z nagłówków „Zagadnienie N:” (jak `CHAPTER_BODY` z E2E). */
const CHAPTER_MATERIAL = [
  "Zagadnienie 1: Ubrania",
  "coat, boots, dress, skirt, t-shirt",
  "Zagadnienie 2: Pogoda",
  "It's raining. It's snowing. What's the weather like?",
  "Zagadnienie 3: Co mam na sobie",
  "I'm wearing a coat. I'm wearing boots.",
].join("\n");

/** Rozdział z sekcjami „Słowa:” i „Zwroty:”: etap zagadnień fake'a daje zagadnienie słów i ramy. */
const SECTION_MATERIAL = [
  "Słowa:",
  "coat — płaszcz",
  "boots — buty",
  "scarf — szalik",
  "gloves — rękawiczki",
  "Zwroty:",
  "I am wearing …",
  "Put on your …",
].join("\n");
const SECTION_KINDS = ["words", "frame"];

/** Jedno zagadnienie bez nagłówków — pula sterowana w testach samodzielności. */
const WEAR_MATERIAL = "I wear a coat. I wear boots. She wears a dress. We wear a skirt.";

describe("lekcja Angielski — rozdział (integracja)", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await pool.query(
      `truncate learning_app.child_profiles, learning_app.parent_sessions, learning_app.parent_credentials,
              learning_app.integration_tokens, learning_app.generation_runs, learning_app.child_objective_progress,
              learning_app.lesson_verdicts, learning_app.revision_assets, learning_app.media_assets,
              learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
              learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) await dispose();
  });

  afterAll(() => pool.end());

  /** Usługi z produkcyjnym rejestrem przedmiotów i fałszywymi providerami (generator paczek, checker niedostępny). */
  async function chapterWorld(agent: FakeLessonPoolAgentOptions = {}) {
    const fakes = await fakeGeneration({ agent });
    disposers.push(fakes.dispose);
    const clock = new ManualClock();
    const services = createServices({ db: testDatabase().db, clock, media: fakes.settings, generation: fakes.deps });
    return { fakes, services, clock };
  }

  async function generateChapter(services: Services, material = CHAPTER_MATERIAL, topicTitlePl = "Unit 1") {
    const { runId, deckId } = await createLessonFromMaterial(services, {
      subjectId: "english_chapter",
      topicTitlePl,
      material,
      poolSize: 40,
      clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");
    const deck = await readLessonDeck(services, deckId);
    return { runId, deckId, draft: deck.draft! };
  }

  /** Ćwiczenie szkicu jako wejście edycji (bez identyfikatora rewizji oraz stanu nagrań wyjaśnienia i zdania — tylko do odczytu). */
  function editInputs(exercises: LessonDraftDto["exercises"]) {
    return exercises.map(({ revisionId: _revisionId, explanationAudio: _explanationAudio, sentenceAudio: _sentenceAudio, ...input }) => LessonExerciseInputSchema.parse(input));
  }

  function stageCounts(draft: LessonDraftDto, objectiveId: string) {
    const counts = { guided: 0, productive: 0, independent: 0 };
    for (const exercise of draft.exercises.filter((item) => item.objectiveId === objectiveId)) {
      const stage = stageOf(exercise.exerciseType);
      if (stage === "guided" || stage === "productive" || stage === "independent") counts[stage] += 1;
    }
    return counts;
  }

  it("rozdział generuje się przebiegiem bazowym: zagadnienia z rodzajem z etapu zagadnień, pula bez cytatów w payloadzie v2, szkic gotowy do publikacji", async () => {
    const { fakes, services } = await chapterWorld();
    const { runId, deckId, draft } = await generateChapter(services, SECTION_MATERIAL);

    // Jedno wywołanie etapu zagadnień, ćwiczenia z paczek (bez pętli agenta).
    expect(fakes.llm.objectiveRequests).toHaveLength(1);
    expect(fakes.agent.calls).toHaveLength(0);
    expect(fakes.agent.packetCalls.length).toBeGreaterThan(0);

    const objectives = draft.dynamicTopic!.objectives;
    expect(objectives.map((objective) => objective.kind)).toEqual(SECTION_KINDS);
    for (const objective of objectives) expect(objective.id.startsWith(`english_chapter.d${deckId}.`)).toBe(true);
    expect(draft.objectiveIds).toEqual(objectives.map((objective) => objective.id));

    // Rodzaj zagadnienia jest zapisany w kontekście wersji, nie tylko w widoku rodzica.
    const [version] = await query<{ lesson_context: { dynamicTopic: { objectives: { id: string; kind?: string }[] } } }>(
      "select lesson_context from learning_app.deck_versions where id = $1", [draft.id],
    );
    expect(version!.lesson_context.dynamicTopic.objectives.map((objective) => objective.kind)).toEqual(SECTION_KINDS);

    const revisions = await query<{ payload_version: number; payload: Record<string, unknown>; target_key: string }>(
      "select payload_version, payload, target_key from learning_app.item_revisions where deck_version_id = $1 order by position", [draft.id],
    );
    expect(revisions.length).toBe(draft.exercises.length);
    for (const revision of revisions) {
      expect(revision.payload_version).toBe(2);
      expect(revision.payload).not.toHaveProperty("sourceRefs");
      expect(revision.payload).not.toHaveProperty("hint");
      expect(englishChapterSubject.exerciseTypes).toContain(revision.payload.exerciseType);
    }
    // Typy przypisań rozdziału przechodzą przebieg bazowy (kontrola pól match, group, cloze).
    const types = new Set(draft.exercises.map((exercise) => exercise.exerciseType));
    for (const type of ["lesson_match", "lesson_cloze", "lesson_group", "lesson_order"] as const) expect(types.has(type), type).toBe(true);
    // Klucz ekspozycji luki to rozwiązane zdanie, a nie samo słowo.
    const gap = draft.exercises.find((exercise) => exercise.exerciseType === "lesson_gap")!;
    const [gapRevision] = revisions.filter((revision) => revision.payload.stem === gap.stem && revision.payload.answer === gap.answer);
    expect(gapRevision!.target_key).toBe(computeTargetKey(gap.stem!.replace(/_{2,}/u, gap.answer).replace(/[.!?…\s]+$/u, ""), "en-GB"));
    expect(gapRevision!.target_key).not.toBe(computeTargetKey(gap.answer, "en-GB"));

    expect(await rejectionCodesOf(runId)).toEqual({});
    expect(draft.rejectedReasons).toBeUndefined();
    expect(draft.coverage).toEqual([]);
    expect(draft.generationGaps).toBeUndefined();
    for (const objective of objectives) {
      const counts = stageCounts(draft, objective.id);
      expect(counts.guided).toBeGreaterThanOrEqual(3);
      expect(counts.productive).toBeGreaterThanOrEqual(3);
      expect(counts.independent).toBeGreaterThanOrEqual(2);
    }

    await expect(publishLessonDraft(services, draft.id, draft.editNumber)).resolves.toEqual({ deckVersionId: draft.id });
    expect((await readLessonDeck(services, deckId)).published).not.toBeNull();
  });

  it("wznowienie z punktu kontrolnego w formacie agenta: bez etapu zagadnień, gotowe zagadnienie zostaje z przykładami, niegotowe dostaje nowe przykłady", async () => {
    const { fakes, services } = await chapterWorld();
    const { runId, deckId } = await createLessonFromMaterial(services, {
      subjectId: "english_chapter",
      topicTitlePl: "Unit 1",
      material: SECTION_MATERIAL,
      poolSize: 40,
      clientRequestId: randomUUID(),
    });
    const CLOTHES = `english_chapter.d${deckId}.clothes`;
    const WEARING = `english_chapter.d${deckId}.wearing`;
    // Punkt kontrolny jak po próbie agenta (planista: temat i przykłady planu, jedno zagadnienie gotowe).
    const dynamicTopic = {
      titlePl: "Unit 1",
      objectives: [
        {
          id: CLOTHES, titlePl: "Ubrania", descriptionEn: "Clothes words.", kind: "words" as const,
          cards: [{ title: "Słowa", body: "coat, boots, scarf, gloves" }, { title: "Temat", body: "Ubrania" }],
        },
        {
          id: WEARING, titlePl: "Co mam na sobie", descriptionEn: "Frames: I am wearing, Put on your.", kind: "frame" as const,
          cards: [{ title: "Zwroty", body: "I am wearing …\nPut on your …" }, { title: "Temat", body: "Co mam na sobie" }],
        },
      ],
    };
    const clothes: LessonExerciseDraft[] = [
      {
        exerciseType: "lesson_choice", objectiveId: CLOTHES, instructionPl: "Mam szalik. Wybierz słowo.", stem: "I have a ___.",
        options: [{ id: "a", text: "scarf" }, { id: "b", text: "coat" }], correctOption: "a", answer: "scarf", acceptedAnswers: [], focus: [],
      },
      {
        exerciseType: "lesson_gap", objectiveId: CLOTHES, instructionPl: "To moje rękawiczki. Wpisz brakujące słowo.", stem: "These are my ___.",
        answer: "gloves", acceptedAnswers: [], focus: ["gloves"],
      },
      {
        exerciseType: "lesson_open_answer", objectiveId: CLOTHES, instructionPl: "Przetłumacz na angielski.", prompt: "Mam buty.",
        answer: "I have boots.", acceptedAnswers: [], focus: ["boots"],
      },
    ];
    const clothesExamples = ["This is my coat."];
    await pool.query("update learning_app.generation_runs set agent_checkpoint = $1::jsonb where id = $2", [
      JSON.stringify({
        ...emptyLessonAgentProgress(),
        dynamicTopic,
        objectives: { [CLOTHES]: { status: "complete", exercises: clothes, examples: clothesExamples } },
      }),
      runId,
    ]);

    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");

    // Temat z punktu kontrolnego: bez etapu zagadnień; paczki tylko dla zagadnienia niegotowego, przykłady kart z jego pierwszej paczki.
    expect(fakes.llm.objectiveRequests).toHaveLength(0);
    expect(fakes.agent.calls).toHaveLength(0);
    expect(fakes.agent.packetCalls.length).toBeGreaterThan(0);
    expect(fakes.agent.packetCalls.every((call) => call.objective.id === WEARING)).toBe(true);
    expect(fakes.agent.packetCalls.filter((call) => call.withExamples)).toHaveLength(1);

    const draft = (await readLessonDeck(services, deckId)).draft!;
    // DTO rodzica nie niesie `descriptionEn`; kontekst wersji ma temat z punktu kontrolnego bez zmian.
    expect(draft.dynamicTopic!.objectives.map(({ id, kind, cards }) => ({ id, kind, cards }))).toEqual(
      dynamicTopic.objectives.map(({ id, kind, cards }) => ({ id, kind, cards })),
    );
    const [version] = await query<{ lesson_context: { dynamicTopic: unknown } }>("select lesson_context from learning_app.deck_versions where id = $1", [draft.id]);
    expect(version!.lesson_context.dynamicTopic).toEqual(dynamicTopic);
    expect(draft.objectiveIds).toEqual([CLOTHES, WEARING]);
    // Gotowe zagadnienie zapisane z punktu kontrolnego, zagadnienie ramy dogenerowane.
    const answersOf = (objectiveId: string) => draft.exercises.filter((exercise) => exercise.objectiveId === objectiveId).map((exercise) => exercise.answer);
    expect(answersOf(CLOTHES)).toEqual(clothes.map((exercise) => exercise.answer));
    expect(answersOf(WEARING).length).toBeGreaterThan(0);
    // Gotowe zagadnienie zachowuje przykłady z punktu kontrolnego, niegotowe dostaje nowe.
    expect(draft.examples[CLOTHES]).toEqual(clothesExamples);
    expect(draft.examples[WEARING]!.length).toBeGreaterThan(0);
  });

  it("„+N” na zagadnieniu rozdziału: przebieg bazowy dopisuje dokładnie N ćwiczeń tego zagadnienia", async () => {
    const { fakes, services } = await chapterWorld();
    const { deckId, draft } = await generateChapter(services, SECTION_MATERIAL);
    const frameObjectiveId = draft.objectiveIds[1]!;
    const ofFrame = (current: LessonDraftDto) => current.exercises.filter((exercise) => exercise.objectiveId === frameObjectiveId).length;
    const callsBefore = fakes.agent.packetCalls.length;

    const regen = await regenerateObjective(services, {
      deckId, objectiveId: frameObjectiveId, count: 3, expectedEditNumber: draft.editNumber, clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, regen.runId);
    expect((await readGeneration(services, regen.runId)).state).toBe("succeeded");

    const added = fakes.agent.packetCalls.slice(callsBefore);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((call) => call.objective.id === frameObjectiveId && !call.withExamples)).toBe(true);
    // „Dodaj N” zna cały szkic: rozwiązania innych zagadnień są zdaniami do unikania.
    const after = (await readLessonDeck(services, deckId)).draft!;
    expect(ofFrame(after)).toBe(ofFrame(draft) + 3);
    expect(after.exercises.filter((exercise) => exercise.objectiveId !== frameObjectiveId)).toEqual(
      draft.exercises.filter((exercise) => exercise.objectiveId !== frameObjectiveId),
    );
    expect(after.generationGaps).toBeUndefined();
  });

  describe("zdania kart rozdziału jako źródła ujawnień (#237)", () => {
    const CARD = "There is a bed in my room.";
    const CARD_ANSWER = "There is a bed in my room";
    const CARD_MATERIAL = `${CARD} I like my bed.`;

    it("generator paczek dostaje zdania kart w zdaniach do unikania od startu, a „+N” — także rozwiązania szkicu", async () => {
      const { fakes, services } = await chapterWorld();
      const { deckId, draft } = await generateChapter(services, CHAPTER_MATERIAL);
      const cardSentences = englishCardSentences(draft.dynamicTopic!.objectives.flatMap((objective) => objective.cards));
      // Karty „Pogody” to zdania materiału.
      expect(cardSentences).toEqual(expect.arrayContaining(["It's raining.", "It's snowing."]));
      const poolCalls = [...fakes.agent.packetCalls];
      expect(new Set(poolCalls.map((call) => call.objective.id))).toEqual(new Set(draft.objectiveIds));
      for (const call of poolCalls) expect(call.pool.avoidSentences).toEqual(expect.arrayContaining(["It's raining.", "It's snowing."]));

      const [first] = draft.objectiveIds;
      const regen = await regenerateObjective(services, {
        deckId, objectiveId: first!, count: 2, expectedEditNumber: draft.editNumber, clientRequestId: randomUUID(),
      });
      await executeLessonGeneration(services, regen.runId);
      expect((await readGeneration(services, regen.runId)).state).toBe("succeeded");
      const regenCall = fakes.agent.packetCalls.slice(poolCalls.length)[0]!;
      // Rozwiązania idą w postaci ekspozycji przedmiotu: bez końcowej interpunkcji.
      const bare = (text: string) => text.replace(/[.!?…\s]+$/u, "");
      const avoid = regenCall.pool.avoidSentences!.map(bare);
      const translations = draft.exercises.filter((exercise) => exercise.exerciseType === "lesson_open_answer");
      expect(translations.length).toBeGreaterThan(0);
      for (const exercise of translations) expect(avoid).toContain(bare(exercise.answer));
    });

    it("braki etapów liczą tylko zapisane przykłady: tłumaczenie rodzica równe zdaniu karty nie zmienia pokrycia", async () => {
      const { services } = await chapterWorld();
      const { draft } = await generateChapter(services, CARD_MATERIAL, "Pokój");
      const objectiveId = draft.objectiveIds[0]!;
      expect(draft.coverage).toEqual([]);
      // Etap samodzielny dokładnie na minimum: wykluczenie jednego ćwiczenia dałoby brak.
      const minimum = lessonPoolMinimums(englishChapterSubject).independent;
      const independent = draft.exercises.filter((exercise) => exercise.objectiveId === objectiveId && stageOf(exercise.exerciseType) === "independent");
      expect(independent.length).toBeGreaterThanOrEqual(minimum);
      const target = independent.find((exercise) => exercise.exerciseType === "lesson_open_answer")!;
      const keptIndependent = new Set([target.id, ...independent.filter((exercise) => exercise.id !== target.id).slice(0, minimum - 1).map((exercise) => exercise.id)]);

      // Rodzic zmienia rozwiązanie samodzielnego tłumaczenia na zdanie z karty zagadnienia (i usuwa nadmiarowe samodzielne).
      const edited = await editLessonDraft(services, draft.id, {
        expectedEditNumber: draft.editNumber,
        exercises: editInputs(draft.exercises
          .filter((exercise) => stageOf(exercise.exerciseType) !== "independent" || exercise.objectiveId !== objectiveId || keptIndependent.has(exercise.id))
          .map((exercise) => exercise.id === target.id ? { ...exercise, answer: CARD_ANSWER, acceptedAnswers: [], focus: ["bed"] } : exercise)),
      });
      expect(edited.exercises.find((exercise) => exercise.id === target.id)!.answer).toBe(CARD_ANSWER);
      expect(edited.exercises.filter((exercise) => exercise.objectiveId === objectiveId && stageOf(exercise.exerciseType) === "independent")).toHaveLength(minimum);
      // Edytor liczy tylko zapisane przykłady kart: zdanie karty nie wyklucza tłumaczenia z pokrycia.
      expect(edited.coverage).toEqual([]);
      expect(edited.exposureLeaks).toBeUndefined();
    });
  });

  it("domyślna pula fake'a rozdziału nie ma ujawnionych rozwiązań ani innych odrzuceń", async () => {
    const { services } = await chapterWorld();
    const { runId, draft } = await generateChapter(services);
    expect(await rejectionCodesOf(runId)).toEqual({});
    expect(draft.rejectedReasons).toBeUndefined();
    expect(draft.coverage).toEqual([]);
    expect(draft.exposureLeaks).toBeUndefined();
  });

  it("rodzic: wariant luki spoza materiału przechodzi edycję i publikację", async () => {
    const { services } = await chapterWorld();
    const { deckId, draft } = await generateChapter(services);
    const gap = draft.exercises.find((exercise) => exercise.exerciseType === "lesson_gap")!;

    const edited = await editLessonDraft(services, draft.id, {
      expectedEditNumber: draft.editNumber,
      exercises: editInputs(draft.exercises.map((exercise) =>
        exercise.id === gap.id ? { ...exercise, acceptedAnswers: ["umbrella"] } : exercise)),
    });
    expect(edited.exercises.find((exercise) => exercise.id === gap.id)!.acceptedAnswers).toEqual(["umbrella"]);

    await expect(publishLessonDraft(services, edited.id, edited.editNumber)).resolves.toEqual({ deckVersionId: edited.id });
    const published = (await readLessonDeck(services, deckId)).published!;
    expect(published.exercises.find((exercise) => exercise.stem === gap.stem && exercise.answer === gap.answer)!.acceptedAnswers).toEqual(["umbrella"]);
  });

  it("rodzic: patch zagadnień zachowuje rodzaj, także po usunięciu zagadnienia", async () => {
    const { services } = await chapterWorld();
    const { draft } = await generateChapter(services, SECTION_MATERIAL);
    const original = draft.dynamicTopic!.objectives;
    expect(original.map((objective) => objective.kind)).toEqual(SECTION_KINDS);

    const renamed = await editLessonDraft(services, draft.id, {
      expectedEditNumber: draft.editNumber,
      dynamicTopic: { objectives: original.map((objective) => ({ id: objective.id, titlePl: `${objective.titlePl} (po zmianie)`, cards: objective.cards })) },
    });
    expect(renamed.dynamicTopic!.objectives.map((objective) => objective.titlePl)).toEqual(original.map((objective) => `${objective.titlePl} (po zmianie)`));
    expect(renamed.dynamicTopic!.objectives.map((objective) => objective.kind)).toEqual(SECTION_KINDS);

    // Usunięcie pierwszego zagadnienia nie przesuwa rodzajów pozostałych.
    const kept = renamed.dynamicTopic!.objectives.slice(1);
    const trimmed = await editLessonDraft(services, renamed.id, {
      expectedEditNumber: renamed.editNumber,
      dynamicTopic: { objectives: kept.map((objective) => ({ id: objective.id, titlePl: objective.titlePl, cards: objective.cards })) },
    });
    expect(trimmed.dynamicTopic!.objectives.map((objective) => objective.kind)).toEqual(["frame"]);
    const [version] = await query<{ lesson_context: { dynamicTopic: { objectives: { kind?: string }[] } } }>(
      "select lesson_context from learning_app.deck_versions where id = $1", [draft.id],
    );
    expect(version!.lesson_context.dynamicTopic.objectives.map((objective) => objective.kind)).toEqual(["frame"]);
  });

  it("rodzic: ton lektora karty odrzucony — rozdział nie ma nagrań pytań i kart (spec tonu TTS §4.5)", async () => {
    const { services } = await chapterWorld();
    const { draft } = await generateChapter(services);
    const objectives = draft.dynamicTopic!.objectives;
    for (const objective of objectives) for (const card of objective.cards) expect(card).not.toHaveProperty("voiceTone");
    await expect(editLessonDraft(services, draft.id, {
      expectedEditNumber: draft.editNumber,
      dynamicTopic: { objectives: objectives.map((objective, index) => ({
        id: objective.id,
        titlePl: objective.titlePl,
        cards: index === 0 ? [{ ...objective.cards[0]!, voiceTone: "cheerful" as const }, ...objective.cards.slice(1)] : objective.cards,
      })) },
    })).rejects.toMatchObject({ code: "validation" });
  });

  it("„+N” na szkicu rozdziału sprzed przebiegu bazowego: temat i rodzaj zagadnienia ze szkicu, pusty punkt kontrolny (Review Focus 5)", async () => {
    // Szkic jak z potoku: tytuły „Zagadnienie N: …” z nagłówków materiału, zagadnienie ramy jako drugie,
    // bez `agent_checkpoint` (run zestawu unieważniony edycją rodzica).
    const { fakes, services } = await chapterWorld();
    const choice = (objectiveId: string, instructionPl: string, stem: string, correct: string, wrong: string) => ({
      exerciseType: "lesson_choice", objectiveId, instructionPl, stem,
      options: [{ id: "a", text: correct }, { id: "b", text: wrong }], correctOption: "a",
      answer: correct, acceptedAnswers: [], focus: [],
    });
    const gap = (objectiveId: string, instructionPl: string, stem: string, answer: string) => ({
      exerciseType: "lesson_gap", objectiveId, instructionPl, stem, answer, acceptedAnswers: [], focus: [answer],
    });
    const seeded = await seedChapterDraft(services, {
      material: [
        "Zagadnienie 1: Ubrania",
        "coat, boots, dress, skirt, hat",
        "Zagadnienie 2: Co mam na sobie",
        "I'm wearing a coat today. I'm wearing boots. She is wearing a dress.",
      ].join("\n"),
      topicTitlePl: "Ubrania",
      objectives: [
        {
          slug: "ubrania", titlePl: "Zagadnienie 1: Ubrania", kind: "words",
          cards: [{ title: "Słowa", body: "coat, boots, dress, skirt, hat" }, { title: "Temat", body: "Ubrania" }],
          exercises: (_deckId, objectiveId) => [
            {
              exerciseType: "lesson_match", objectiveId, instructionPl: "Połącz słowa w pary.",
              pairs: [{ left: "coat", right: "płaszcz" }, { left: "boots", right: "buty" }, { left: "dress", right: "sukienka" }],
              extraRight: ["czapka"], answer: "coat, boots, dress", acceptedAnswers: [], focus: [],
            },
            choice(objectiveId, "Mam na sobie spódnicę. Wybierz słowo.", "This is my ___.", "skirt", "hat"),
            gap(objectiveId, "To moja czapka. Wpisz brakujące słowo.", "This is my ___.", "hat"),
          ],
        },
        {
          slug: "co_mam_na_sobie", titlePl: "Zagadnienie 2: Co mam na sobie", kind: "frame",
          cards: [{ title: "Zdania", body: "I'm wearing a coat today. I'm wearing boots." }, { title: "Temat", body: "Co mam na sobie" }],
          exercises: (_deckId, objectiveId) => [
            {
              exerciseType: "lesson_order", objectiveId, instructionPl: "Ona ma na sobie sukienkę. Ułóż zdanie.",
              items: [{ id: "i1", text: "She" }, { id: "i2", text: "is" }, { id: "i3", text: "wearing" }, { id: "i4", text: "a dress" }],
              answer: "She is wearing a dress", acceptedAnswers: [], focus: [],
            },
            choice(objectiveId, "Mam na sobie buty. Wybierz słowo.", "I'm wearing ___.", "boots", "hat"),
          ],
        },
      ],
    });
    const [frameObjectiveId] = seeded.objectiveIds.slice(1);
    const checkpoints = await query<{ agent_checkpoint: unknown }>(
      "select agent_checkpoint from learning_app.generation_runs where deck_version_id = $1", [seeded.versionId],
    );
    expect(checkpoints.map((row) => row.agent_checkpoint)).toEqual([null]);
    const before = (await readLessonDeck(services, seeded.deckId)).draft!;
    const ofFrame = (draft: LessonDraftDto) => draft.exercises.filter((exercise) => exercise.objectiveId === frameObjectiveId).length;

    const regen = await regenerateObjective(services, {
      deckId: seeded.deckId, objectiveId: frameObjectiveId!, count: 4, expectedEditNumber: seeded.editNumber, clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, regen.runId);

    expect((await readGeneration(services, regen.runId)).state).toBe("succeeded");
    const after = (await readLessonDeck(services, seeded.deckId)).draft!;
    expect(ofFrame(after)).toBeGreaterThanOrEqual(ofFrame(before) + 4);
    // Paczki dostały zagadnienie ze szkicu (tytuł i karty), bez etapu zagadnień; rodzaj `frame` wyznacza typy (układanka, bez grup).
    expect(fakes.llm.objectiveRequests).toHaveLength(0);
    expect(fakes.agent.calls).toHaveLength(0);
    const packets = fakes.agent.packetCalls;
    expect(packets.length).toBeGreaterThan(0);
    for (const call of packets) {
      expect(call.objective).toEqual({ id: frameObjectiveId, title: "Zagadnienie 2: Co mam na sobie", cards: before.dynamicTopic!.objectives[1]!.cards });
    }
    expect(packets.some((call) => call.type === "lesson_group")).toBe(false);
    expect(after.dynamicTopic).toEqual(before.dynamicTopic);
  });

  it("regresja szkoły: createSchoolLesson dalej tworzy cele school.d… z cytatami źródłowymi", async () => {
    const { services } = await chapterWorld();
    const { runId, deckId } = await createSchoolLesson(services, {
      subjectTitlePl: "Przyroda",
      topicTitlePl: "Materiał",
      material: [
        "Zagadnienie 1: Fotosynteza",
        "Wyjaśnienie: Fotosynteza to proces, w którym roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry. Cukry są pokarmem rośliny.",
        "Zagadnienie 2: Chrzest Polski",
        "Wyjaśnienie: Mieszko I przyjął chrzest w 966 roku. Chrzest włączył państwo do chrześcijańskiej Europy i wzmocnił władzę księcia.",
      ].join("\n"),
      poolSize: 40,
      clientRequestId: randomUUID(),
    });
    await executeLessonGeneration(services, runId);
    expect((await readGeneration(services, runId)).state).toBe("succeeded");
    const draft = (await readLessonDeck(services, deckId)).draft!;

    expect(draft.objectiveIds.length).toBe(2);
    for (const id of draft.objectiveIds) expect(id.startsWith(`school.d${deckId}.`)).toBe(true);
    // Szkoła nie dostaje rodzaju zagadnienia — to opcja przedmiotu rozdziału.
    for (const objective of draft.dynamicTopic!.objectives) expect(objective.kind).toBeUndefined();
    const revisions = await query<{ payload_version: number; payload: { sourceRefs?: unknown } }>(
      "select payload_version, payload from learning_app.item_revisions where deck_version_id = $1", [draft.id],
    );
    expect(revisions.length).toBeGreaterThan(0);
    for (const revision of revisions) {
      expect(revision.payload_version).toBe(3);
      expect(Array.isArray(revision.payload.sourceRefs)).toBe(true);
    }
  });

  describe("sesje dziecka na opublikowanej lekcji rozdziału", () => {
    /** Pula sterowana: wspólne zdania wyboru i luki oraz luka w innym zdaniu z tym samym słowem. */
    function controlledPool(objectiveId: string) {
      const choice = (instruction: string, stem: string, correct: string, wrong: string) => ({
        exerciseType: "lesson_choice", objectiveId, instructionPl: instruction, stem,
        options: [{ id: "a", text: correct }, { id: "b", text: wrong }], correctOption: "a",
        answer: correct, acceptedAnswers: [], focus: [],
      });
      const gap = (instruction: string, stem: string, answer: string) => ({
        exerciseType: "lesson_gap", objectiveId, instructionPl: instruction, stem,
        answer, acceptedAnswers: [], focus: [answer],
      });
      const translation = (prompt: string, answer: string, focus: string) => ({
        exerciseType: "lesson_open_answer", objectiveId, instructionPl: "Przetłumacz na angielski.", prompt,
        answer, acceptedAnswers: [], focus: [focus],
      });
      return [
        choice("Mam na sobie płaszcz. Wybierz słowo.", "I wear a ___.", "coat", "dress"),
        choice("Mam na sobie buty. Wybierz słowo.", "I wear ___.", "boots", "skirt"),
        choice("Ona ma sukienkę. Wybierz słowo.", "She wears a ___.", "dress", "skirt"),
        // To samo rozwiązane zdanie co w wyborze: „I wear a coat” i „I wear boots”.
        gap("Mam na sobie płaszcz. Wpisz brakujące słowo.", "I wear a ___.", "coat"),
        gap("Mam na sobie buty. Wpisz brakujące słowo.", "I wear ___.", "boots"),
        // Inne zdanie z tym samym słowem „coat” co w pierwszym wyborze.
        gap("Zimą noszę płaszcz. Wpisz brakujące słowo.", "We wear a ___ in winter.", "coat"),
        translation("Mam płaszcz.", "We have the coat", "coat"),
        translation("Ona ma sukienkę.", "She has a dress", "dress"),
      ];
    }

    /**
     * Opublikowany rozdział z pulą sterowaną zasianą wprost (bez generowania): jedno zagadnienie słów
     * z kartami z materiału; `examples` trafiają na karty tego zagadnienia.
     */
    async function publishedChapter(examples: string[] = []) {
      const { services, clock } = await chapterWorld();
      const seeded = await seedChapterDraft(services, {
        material: WEAR_MATERIAL,
        topicTitlePl: "Ubrania",
        objectives: [{
          slug: "ubrania",
          titlePl: "Ubrania",
          kind: "words",
          cards: [{ title: "Wyjaśnienie", body: "I wear a coat." }, { title: "Do zapamiętania", body: "I wear boots." }],
          exercises: (_deckId, objectiveId) => controlledPool(objectiveId),
        }],
        ...(examples.length > 0 ? { examples: { ubrania: examples } } : {}),
      });
      const draft = (await readLessonDeck(services, seeded.deckId)).draft!;
      expect(draft.objectiveIds).toEqual(seeded.objectiveIds);
      expect(draft.exercises).toHaveLength(controlledPool(seeded.objectiveIds[0]!).length);
      expect(draft.coverage).toEqual([]);
      await publishLessonDraft(services, seeded.versionId, seeded.editNumber);
      return { services, clock, deckId: seeded.deckId, draft };
    }

    async function assign(childId: string, deckId: string, mockTest = false) {
      await pool.query(
        mockTest
          ? "insert into learning_app.assignments (id, child_id, deck_id, test_date, test_goals) values ($1, $2, $3, '2026-10-20', ARRAY['lesson'])"
          : "insert into learning_app.assignments (id, child_id, deck_id, test_date, test_goals) values ($1, $2, $3, null, null)",
        [randomUUID(), childId, deckId],
      );
    }

    async function answerKey(taskId: string): Promise<Record<string, unknown>> {
      return (await query<{ answer_key: Record<string, unknown> }>("select answer_key from learning_app.session_tasks where id = $1", [taskId]))[0]!.answer_key;
    }

    async function answerCorrectly(services: Services, task: TaskDto) {
      const key = await answerKey(task.taskId);
      if (task.exerciseType === "lesson_choice") {
        return submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.correctOptionId as string });
      }
      return submitAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.answer as string });
    }

    /** Zadanie rozwiązane przez dziecko wraz z zamrożonym kontekstem kwalifikacji jego próby. */
    interface PlayedTask {
      task: TaskDto;
      key: Record<string, unknown>;
      answerPreviouslyExposed: boolean;
      independent: boolean;
    }

    /**
     * Gra kolejne sesje (co godzinę) i odpowiada poprawnie. Plan sesji powstaje
     * z góry, więc nowy cel dostaje w pierwszej sesji tylko etap prowadzony;
     * luki pojawiają się dopiero w kolejnych sesjach. Tłumaczenia (etap
     * samodzielny) w takich sesjach nie ma z powodu zegara, nie puli: należne
     * sprawdzenie samodzielne wymaga upływu terminu powtórki (≥ 12 h dla
     * `needs_confirmation`, ≥ 1 doby po sukcesie — `SUCCESS_INTERVALS_MS`),
     * a krok godzinny go nie osiąga (patrz test należnego sprawdzenia).
     */
    async function playSessions(services: Services, clock: ManualClock, childId: string, deckId: string, sessions: number): Promise<PlayedTask[]> {
      const played: PlayedTask[] = [];
      for (let index = 0; index < sessions; index++) {
        const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
        for (let step = 0; step < 30; step++) {
          const task = await nextTask(services, session.sessionId);
          if (task === null) break;
          if (task.exerciseType === "lesson_card") {
            await completePresentation(services, { taskId: task.taskId });
            continue;
          }
          const key = await answerKey(task.taskId);
          const attempt = await answerCorrectly(services, task);
          expect(attempt.feedback?.kind).toBe("great");
          const [row] = await query<{ context: { answerPreviouslyExposed: boolean }; independent: boolean }>(
            `select at.context, a.independent from learning_app.attempts at
               join learning_app.assessments a on a.attempt_id = at.id
              where at.task_id = $1`, [task.taskId],
          );
          played.push({ task, key, answerPreviouslyExposed: row!.context.answerPreviouslyExposed, independent: row!.independent });
        }
        await endSession(services, session.sessionId);
        clock.advanceHours(1);
      }
      return played;
    }

    /** Rozwiązane zdanie jak w kluczu ekspozycji: bez końcowej interpunkcji, małe litery. */
    function solved(stem: string, word: string): string {
      return stem.replace(/_{2,}/u, word).replace(/[.!?…\s]+$/u, "").toLowerCase();
    }

    /** Kartkówka: wszystkie sloty planu, odpowiedzi poprawne (wynik i omówienie dopiero po zamknięciu). */
    async function playMockTest(services: Services, childId: string, deckId: string): Promise<{ task: TaskDto; key: Record<string, unknown> }[]> {
      const session = await startSession(services, { childId, deckId, microphoneEnabled: false, mode: "mock_test" });
      const played: { task: TaskDto; key: Record<string, unknown> }[] = [];
      for (let step = 0; step < 20; step++) {
        const task = await nextTask(services, session.sessionId);
        if (task === null) break;
        played.push({ task, key: await answerKey(task.taskId) });
        await answerCorrectly(services, task);
      }
      return played;
    }

    it("samodzielność: luka w zdaniu rozwiązanym wcześniej w wyborze jest niesamodzielna, w innym zdaniu z tym samym słowem — samodzielna", async () => {
      const { services, clock, deckId } = await publishedChapter();
      const child = await createChild(services, { displayName: "Rozdział", avatarKey: "owl" });
      await assign(child.id, deckId);
      // Sesje co godzinę: tłumaczenie nie pada, bo należne sprawdzenie czeka na termin powtórki (zegar), a nie na pulę.
      const played = await playSessions(services, clock, child.id, deckId, 3);

      // Sygnał silnika porównujemy z tym, co dziecko wcześniej widziało rozwiązane jako zdanie
      // (wybór i luka kończą się feedbackiem z rozwiązaniem poprawnej odpowiedzi).
      const solvedSentences = new Set<string>();
      const gaps: { stem: string; word: string; exposedBefore: boolean; played: PlayedTask }[] = [];
      for (const entry of played) {
        if (entry.task.exerciseType === "lesson_choice") {
          const { stem } = entry.task.prompt as { stem: string };
          solvedSentences.add(solved(stem, (entry.key.optionValues as Record<string, string>)[entry.key.correctOptionId as string]!));
        } else if (entry.task.exerciseType === "lesson_gap") {
          const { stemWithGap } = entry.task.prompt as { stemWithGap: string };
          const word = entry.key.answer as string;
          const sentence = solved(stemWithGap, word);
          gaps.push({ stem: stemWithGap, word, exposedBefore: solvedSentences.has(sentence), played: entry });
          solvedSentences.add(sentence);
        }
      }
      expect(gaps.length).toBeGreaterThanOrEqual(3);
      for (const gap of gaps) {
        expect(gap.played.answerPreviouslyExposed).toBe(gap.exposedBefore);
        expect(gap.played.independent).toBe(!gap.exposedBefore);
      }

      // Pierwsze podejścia do luk: to samo zdanie co w wyborze nie jest samodzielne, a luka z tym samym słowem
      // w innym zdaniu jest.
      const first = (stem: string) => gaps.find((gap) => gap.stem === stem)!;
      expect(first("I wear a ___.")).toMatchObject({ word: "coat", exposedBefore: true });
      expect(first("I wear a ___.").played).toMatchObject({ answerPreviouslyExposed: true, independent: false });
      expect(first("I wear ___.")).toMatchObject({ word: "boots", exposedBefore: true });
      expect(first("I wear ___.").played).toMatchObject({ answerPreviouslyExposed: true, independent: false });
      expect(first("We wear a ___ in winter.")).toMatchObject({ word: "coat", exposedBefore: false });
      expect(first("We wear a ___ in winter.").played).toMatchObject({ answerPreviouslyExposed: false, independent: true });
    });

    it("przykład karty z tym samym zdaniem co luka (z końcową kropką) czyni lukę niesamodzielną", async () => {
      // Ta sama pula co wyżej, ale karta zagadnienia pokazuje zdanie, które rozwiązuje luka „We wear a ___ in winter.”
      // (bez karty ta luka jest samodzielna — test samodzielności wyżej).
      const { services, clock, deckId } = await publishedChapter(["We wear a coat in winter."]);
      const child = await createChild(services, { displayName: "Karta", avatarKey: "owl" });
      await assign(child.id, deckId);
      const played = await playSessions(services, clock, child.id, deckId, 3);

      // Karta zapisała ekspozycję przykładu pod kluczem rozwiązanego zdania (bez końcowej kropki).
      const [cardExposures] = await query<{ count: number }>(
        `select count(*)::int as count from learning_app.event_exposures x
           join learning_app.learning_events e on e.id = x.event_id
           join learning_app.session_tasks t on t.id = e.task_id
          where x.child_id = $1 and x.target_key = $2 and t.exercise_type = 'lesson_card'`,
        [child.id, computeTargetKey("We wear a coat in winter", "en-GB")],
      );
      expect(cardExposures!.count).toBeGreaterThan(0);

      const gap = played.find((entry) => (entry.task.prompt as { stemWithGap?: string }).stemWithGap === "We wear a ___ in winter.");
      expect(gap?.key.answer).toBe("coat");
      expect(gap).toMatchObject({ answerPreviouslyExposed: true, independent: false });
    });

    /** Słówka tego samego dziecka: zestaw „ze słówek” z tymi samymi słowami co rozdział. */
    const VOCABULARY = [
      { source: "płaszcz", target: "coat" },
      { source: "buty", target: "boots" },
      { source: "sukienka", target: "dress" },
    ];

    /**
     * Usługi słówek bez providerów generacji: publikacja zestawu słówek z fixture'a
     * (audio wstawione wprost) nie uzgadnia mediów z ustawieniami fałszywych providerów.
     */
    function vocabularyServices(clock: ManualClock): Services {
      return createServices({ db: testDatabase().db, clock });
    }

    async function exposureCount(childId: string, target: string): Promise<number> {
      const [row] = await query<{ count: number }>(
        "select count(*)::int as count from learning_app.event_exposures where child_id = $1 and target_key = $2",
        [childId, computeTargetKey(target, "en-GB")],
      );
      return row!.count;
    }

    it("ekspozycja słówka nie blokuje luki w zdaniu z tym samym słowem", async () => {
      const { services, clock, deckId } = await publishedChapter();
      // Słówka coat/boots/dress są już ujawnione dziecku (klucz = samo słowo).
      const vocabulary = await mockTestDeck(vocabularyServices(clock), VOCABULARY.length, true, VOCABULARY);
      for (const { target } of VOCABULARY) expect(await exposureCount(vocabulary.childId, target)).toBeGreaterThan(0);

      await assign(vocabulary.childId, deckId);
      const played = await playSessions(services, clock, vocabulary.childId, deckId, 3);

      // Klucz luki to rozwiązane zdanie, więc ekspozycja słówka „coat” nie czyni zdania z „coat” widzianym.
      const gap = played.find((entry) => (entry.task.prompt as { stemWithGap?: string }).stemWithGap === "We wear a ___ in winter.")!;
      expect(gap.key.answer).toBe("coat");
      expect(gap).toMatchObject({ answerPreviouslyExposed: false, independent: true });
    });

    it("rozwiązywanie zdań rozdziału nie ujawnia klucza słówka", async () => {
      const { services, clock, deckId } = await publishedChapter();
      // Słówka jeszcze nieujawnione: żaden klucz słowa nie jest w ekspozycjach.
      const vocabulary = await mockTestDeck(vocabularyServices(clock), VOCABULARY.length, false, VOCABULARY);
      for (const { target } of VOCABULARY) expect(await exposureCount(vocabulary.childId, target)).toBe(0);

      await assign(vocabulary.childId, deckId);
      const played = await playSessions(services, clock, vocabulary.childId, deckId, 3);

      // Dziecko rozwiązało zdania z tymi słowami (zapis ekspozycji zdań działa), a klucze słówek zostały puste.
      expect(played.some((entry) => entry.task.exerciseType === "lesson_gap")).toBe(true);
      expect(await exposureCount(vocabulary.childId, "I wear a coat")).toBeGreaterThan(0);
      for (const { target } of VOCABULARY) expect(await exposureCount(vocabulary.childId, target)).toBe(0);

      // Zapytanie wykrywa ekspozycje słówek: sesja słówek je zapisuje przy wydaniu prezentacji.
      const session = await startSession(vocabularyServices(clock), { childId: vocabulary.childId, deckId: vocabulary.deckId, microphoneEnabled: false });
      expect((await nextTask(vocabularyServices(clock), session.sessionId))?.exerciseType).toBe("exposure");
      const afterVocabulary = await Promise.all(VOCABULARY.map(({ target }) => exposureCount(vocabulary.childId, target)));
      expect(afterVocabulary.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    });

    it("tłumaczenie jest należnym sprawdzeniem samodzielnym po terminie powtórki", async () => {
      const { services, clock, deckId } = await publishedChapter();
      const child = await createChild(services, { displayName: "Powtórka", avatarKey: "owl" });
      await assign(child.id, deckId);
      const played = await playSessions(services, clock, child.id, deckId, 3);
      expect(played.some((entry) => entry.task.exerciseType === "lesson_open_answer")).toBe(false);

      // Po kwalifikujących sukcesach cel ma termin powtórki (najwcześniej doba po sukcesie); sesja przed nim
      // nie wydaje należnego sprawdzenia, a zaraz po nim zaczyna się tłumaczeniem.
      const [progress] = await query<{ next_review_at: Date | null; objective_id: string }>(
        "select next_review_at, objective_id from learning_app.child_objective_progress where child_id = $1", [child.id],
      );
      expect(progress!.next_review_at).not.toBeNull();
      const dueAt = progress!.next_review_at!.getTime();
      expect(dueAt).toBeGreaterThan(clock.now().getTime());
      clock.advanceMs(dueAt - clock.now().getTime() + 1_000);

      const session = await startSession(services, { childId: child.id, deckId, microphoneEnabled: false });
      let task = await nextTask(services, session.sessionId);
      while (task !== null && task.exerciseType === "lesson_card") {
        await completePresentation(services, { taskId: task.taskId });
        task = await nextTask(services, session.sessionId);
      }
      expect(task?.exerciseType).toBe("lesson_open_answer");
      const [taskRow] = await query<{ context: { reason: string; objectiveId: string; independentCheck: boolean } }>(
        "select context from learning_app.session_tasks where id = $1", [task!.taskId],
      );
      expect(taskRow!.context).toMatchObject({ reason: "due_check", objectiveId: progress!.objective_id, independentCheck: true });

      // Niewidziane tłumaczenie rozwiązane poprawnie jest samodzielnym sukcesem.
      const attempt = await answerCorrectly(services, task!);
      expect(attempt.feedback?.kind).toBe("great");
      const [grade] = await query<{ independent: boolean }>(
        "select a.independent from learning_app.assessments a join learning_app.attempts at on at.id = a.attempt_id where at.task_id = $1", [task!.taskId],
      );
      expect(grade!.independent).toBe(true);
    });

    it("Kid DTO: wybór niesie język treści, a w kartkówce także luka i tłumaczenie (język pytania i odpowiedzi)", async () => {
      const { services, clock, deckId } = await publishedChapter();
      const child = await createChild(services, { displayName: "Języki", avatarKey: "owl" });
      await assign(child.id, deckId, true);

      const [firstTask] = await playSessions(services, clock, child.id, deckId, 1);
      expect(firstTask!.task.prompt).toMatchObject({ kind: "lesson_choice", contentLocale: "en-GB" });

      // Tłumaczenie sprawdzamy w kartkówce: w sesjach nauki co godzinę go nie ma (należne sprawdzenie
      // samodzielne czeka na termin powtórki, ≥ 12 h), a kartkówka wydaje wszystkie sloty puli.
      const mock = await playMockTest(services, child.id, deckId);
      const promptOf = (type: string) => mock.find((entry) => entry.task.exerciseType === type)?.task.prompt;
      expect(promptOf("lesson_choice")).toMatchObject({ contentLocale: "en-GB" });
      expect(promptOf("lesson_gap")).toMatchObject({ contentLocale: "en-GB" });
      expect(promptOf("lesson_open_answer")).toMatchObject({ promptLocale: "pl-PL", answerLocale: "en-GB" });
    });

    it("kartkówka: luka zachowuje polskie zdanie-bodziec w poleceniu, bez podpowiedzi", async () => {
      const { services, deckId } = await publishedChapter();
      const child = await createChild(services, { displayName: "Kartkówka", avatarKey: "owl" });
      await assign(child.id, deckId, true);
      const mock = await playMockTest(services, child.id, deckId);

      const gaps = mock.filter((entry) => entry.task.exerciseType === "lesson_gap").map((entry) => entry.task.prompt as {
        instructionPl: string; stemWithGap: string; hint?: string;
      });
      expect(gaps.map((prompt) => [prompt.stemWithGap, prompt.instructionPl]).sort()).toEqual([
        ["I wear ___.", "Mam na sobie buty. Wpisz brakujące słowo."],
        ["I wear a ___.", "Mam na sobie płaszcz. Wpisz brakujące słowo."],
        ["We wear a ___ in winter.", "Zimą noszę płaszcz. Wpisz brakujące słowo."],
      ]);
      for (const prompt of gaps) expect(prompt).not.toHaveProperty("hint");
    });
  });
});
