import { describe, expect, it } from "vitest";
import { lessonExerciseIdentity, lessonExerciseStimulusRecord } from "../domain/lessons/exercise-identity";
import { poolCoverage, validatePool } from "../domain/lessons/pool-validation";
import { stageOf } from "../domain/lessons/stages";
import { englishChapterSubject } from "../domain/lessons/subjects/english-chapter/module";
import { refineChapterPool } from "../domain/lessons/subjects/english-chapter/validators";
import { englishGrammarSubject } from "../domain/lessons/subjects/english-grammar/module";
import { presentSimpleV1 } from "../domain/lessons/subjects/english-grammar/topics/present-simple";
import type { LessonPoolInput } from "../ports/ai";
import { toExerciseDraft } from "../modules/materials/lessons/lesson-drafts";
import { isMaterialVocabularyTarget, materialPhraseIndex } from "../domain/lessons/subjects/english/material-phrase";
import { DEFAULT_FAKE_DECK_ITEMS, FakeLlmProvider, FakeTtsProvider } from "./fake";

describe("FakeLlmProvider lesson pool", () => {
  it("produces a publishable 3/4/2 grammar pool after functional-stimulus deduplication", async () => {
    const objective = presentSimpleV1.objectives.find((item) => item.id.endsWith("third_person_s"))!;
    const input: LessonPoolInput = {
      subjectId: englishGrammarSubject.id,
      subjectTitle: englishGrammarSubject.titlePl,
      answerLocale: englishGrammarSubject.answerLocale,
      promptLocale: englishGrammarSubject.promptLocale,
      promptProfile: { generationRole: "lesson", gradingRole: "grammar", almostDefinition: "close" },
      exerciseTypes: englishGrammarSubject.exerciseTypes,
      transforms: [],
      objectives: [{
        id: objective.id,
        descriptionEn: objective.descriptionEn,
        exerciseTypes: objective.exerciseTypes,
        errorCategories: objective.errorCategories,
      }],
      material: "play football school music pets",
      countPerObjective: 20,
      stageCounts: { guided: 6, productive: 10, independent: 4 },
      graderAvailable: false,
      deduplication: "exercise",
    };
    const raw = await new FakeLlmProvider().generateLessonPool(input);
    const drafts = raw.exercises.map(toExerciseDraft);
    const result = validatePool(drafts, englishGrammarSubject, presentSimpleV1);
    expect(result.rejected).toEqual([]);
    expect(result.valid).toHaveLength(20);
    expect(result.valid.filter((item) => stageOf(item.exerciseType) === "guided")).toHaveLength(6);
    expect(result.valid.filter((item) => stageOf(item.exerciseType) === "productive")).toHaveLength(10);
    expect(result.valid.filter((item) => stageOf(item.exerciseType) === "independent")).toHaveLength(4);
  });
});

describe("FakeLlmProvider — rozdział angielskiego", () => {
  const MATERIAL = [
    "Zagadnienie 1: Ubrania",
    "coat, boots, dress, skirt, t-shirt",
    "Zagadnienie 2: Pogoda",
    "It's raining. It's snowing. What's the weather like?",
  ].join("\n");

  const topic = englishChapterSubject.buildDynamicTopic!({
    titlePl: "Unit 1",
    objectives: [{
      id: "english_chapter.ddeck.clothes",
      titlePl: "Ubrania",
      descriptionEn: "Clothes",
      kind: "words",
      cards: [{ title: "Słówka", body: "coat — płaszcz" }, { title: "Jeszcze", body: "boots — buty" }],
    }],
  });

  function chapterInput(overrides: Partial<LessonPoolInput> = {}): LessonPoolInput {
    return {
      subjectId: englishChapterSubject.id,
      subjectTitle: englishChapterSubject.titlePl,
      answerLocale: englishChapterSubject.answerLocale,
      promptLocale: englishChapterSubject.promptLocale,
      promptProfile: { generationRole: "lesson", gradingRole: "chapter", almostDefinition: "close" },
      exerciseTypes: englishChapterSubject.exerciseTypes,
      transforms: [],
      objectives: [{
        id: topic.objectives[0]!.id,
        descriptionEn: "Clothes",
        exerciseTypes: topic.objectives[0]!.exerciseTypes,
        errorCategories: [],
      }],
      material: MATERIAL,
      countPerObjective: 14,
      stageCounts: { guided: 4, productive: 7, independent: 3 },
      graderAvailable: false,
      deduplication: "exercise",
      ...overrides,
    };
  }

  it("buduje pulę ze słów materiału: przechodzi słownik, walidację puli i pokrycie 3/3/2", async () => {
    const raw = await new FakeLlmProvider().generateLessonPool(chapterInput());
    const drafts = raw.exercises.map(toExerciseDraft);

    expect(refineChapterPool(drafts, { material: MATERIAL }).rejected).toEqual([]);
    const result = validatePool(drafts, englishChapterSubject, topic);
    expect(result.rejected).toEqual([]);
    expect(result.valid).toHaveLength(14);
    expect(poolCoverage(result.valid, [topic.objectives[0]!.id], englishChapterSubject.poolMinimums!)).toEqual([]);
  });

  it("nie dodaje cytatów ani podpowiedzi, a polecenia są unikalne i niosą polskie zdanie", async () => {
    const raw = await new FakeLlmProvider().generateLessonPool(chapterInput());
    const exercises = raw.exercises as Record<string, unknown>[];
    for (const exercise of exercises) {
      expect(exercise).not.toHaveProperty("sourceRefs");
      expect(exercise).not.toHaveProperty("hint");
    }
    const instructions = exercises
      .filter((exercise) => exercise.exerciseType !== "lesson_open_answer")
      .map((exercise) => exercise.instructionPl);
    expect(new Set(instructions).size).toBe(instructions.length);
    expect(instructions.every((text) => typeof text === "string" && /Zdanie numer \d+/u.test(text))).toBe(true);
  });

  it("dogenerowanie kontynuuje numerację, więc tożsamości ćwiczeń się nie powtarzają", async () => {
    const llm = new FakeLlmProvider();
    const options = { instructionIsStimulus: true };
    const first = await llm.generateLessonPool(chapterInput());
    const existingExercises = first.exercises.map((exercise) => lessonExerciseStimulusRecord(toExerciseDraft(exercise), options));
    const second = await llm.generateLessonPool(chapterInput({ existingExercises }));
    const identities = [...first.exercises, ...second.exercises].map((exercise) => lessonExerciseIdentity(toExerciseDraft(exercise), options));
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("zagadnienia z regułami podziału dostają rodzaj: pierwsze words, kolejne frame; bez reguł bez rodzaju", async () => {
    const llm = new FakeLlmProvider();
    const base = { subjectTitle: "Angielski — rozdział", topicTitle: "Unit 1", material: MATERIAL, generationRole: "role" };
    const withRules = (await llm.generateLessonObjectives({ ...base, objectivesRules: "kinds" })).objectives as { kind?: string }[];
    expect(withRules.map((objective) => objective.kind)).toEqual(["words", "frame"]);
    const withoutRules = (await llm.generateLessonObjectives(base)).objectives as { kind?: string }[];
    expect(withoutRules.every((objective) => !("kind" in objective))).toBe(true);
  });
});

describe("FakeLlmProvider — zestaw słówek ze źródła", () => {
  const SOURCE_TEXT = [
    "What's the weather like? It's sunny. It's raining.",
    "I'm wearing a coat and boots. She is wearing a pink T-shirt. Don't forget your coat!",
  ].join("\n");
  const sourceInput = (overrides: Partial<{ maxItems: number; vocabularyFormat: "standard" | "picture" }> = {}) => ({
    material: SOURCE_TEXT,
    sourceLocale: "pl-PL",
    targetLocale: "en-GB",
    maxItems: 50,
    vocabularyFormat: "standard" as const,
    ...overrides,
  });

  it("bez kolejki: różne słowa treści z tekstu (≥ 3 litery), znaczenie i pierwsze zdanie z tym słowem", async () => {
    const llm = new FakeLlmProvider();
    const { items } = await llm.generateDeck(sourceInput());

    expect(items.map((item) => item.target)).toEqual(["weather", "like", "sunny", "raining", "wearing", "coat", "boots", "pink", "shirt", "forget"]);
    expect(items.find((item) => item.target === "coat")).toEqual({
      source: "„coat” po polsku",
      target: "coat",
      acceptedAnswers: [],
      example: "I'm wearing a coat and boots.",
      visualType: "none",
    });
    expect(items.find((item) => item.target === "shirt")!.example).toBe("She is wearing a pink T-shirt.");
    // każdy element przechodzi walidację serwera trybu ze źródła
    const index = materialPhraseIndex(SOURCE_TEXT);
    expect(items.every((item) => isMaterialVocabularyTarget(item.target, index))).toBe(true);
    expect(llm.requests).toEqual([sourceInput()]);
  });

  it("limit maxItems; format obrazkowy daje ilustracje dopuszczalne w zestawie obrazkowym", async () => {
    const llm = new FakeLlmProvider();
    const limited = await llm.generateDeck(sourceInput({ maxItems: 3 }));
    expect(limited.items.map((item) => item.target)).toEqual(["weather", "like", "sunny"]);

    const picture = await llm.generateDeck(sourceInput({ vocabularyFormat: "picture", maxItems: 2 }));
    expect(picture.items.map((item) => item.visualType)).toEqual(["image", "image"]);
  });

  it("kolejka zachowań nadal ma pierwszeństwo przed elementami z tekstu; tryb opisu bez zmian", async () => {
    const llm = new FakeLlmProvider();
    const queued = [{ source: "parasol", target: "umbrella", acceptedAnswers: [], visualType: "none" }];
    llm.queue({ items: queued });
    expect((await llm.generateDeck(sourceInput())).items).toEqual(queued);

    const description = new FakeLlmProvider();
    const { items } = await description.generateDeck({ prompt: "dni tygodnia", sourceLocale: "pl-PL", targetLocale: "en-GB", maxItems: 10 });
    expect(items).toEqual(DEFAULT_FAKE_DECK_ITEMS);
  });
});

describe("FakeTtsProvider", () => {
  const base = { text: "Świetnie!", locale: "pl-PL", voice: "fake-voice", format: "mp3" as const };

  it("różne instrukcje dają różne bajty", async () => {
    const tts = new FakeTtsProvider();
    const plain = await tts.synthesize(base);
    const styled = await tts.synthesize({ ...base, instructions: "Powiedz radośnie." });
    const other = await tts.synthesize({ ...base, instructions: "Powiedz ciepło." });
    expect(styled.bytes).not.toEqual(plain.bytes);
    expect(other.bytes).not.toEqual(styled.bytes);
  });

  it("bez instrukcji bajty pozostają takie jak dotąd", async () => {
    const tts = new FakeTtsProvider();
    const first = await tts.synthesize(base);
    const second = await tts.synthesize({ ...base });
    expect(second.bytes).toEqual(first.bytes);
  });
});
