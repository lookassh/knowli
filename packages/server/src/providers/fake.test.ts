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
import { FakeLlmProvider, FakeTtsProvider } from "./fake";

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

describe("FakeLlmProvider voice tones", () => {
  const poolInput = {
    subjectId: "school",
    subjectTitle: "Szkoła",
    answerLocale: "pl-PL",
    promptLocale: "pl-PL",
    promptProfile: { generationRole: "lesson", gradingRole: "grade", almostDefinition: "close" },
    exerciseTypes: ["lesson_open_answer", "lesson_choice"],
    transforms: [],
    objectives: [{ id: "o1", descriptionEn: "d", exerciseTypes: ["lesson_open_answer", "lesson_choice"], errorCategories: [] }],
    material: "Skala mapy pozwala przeliczyć odległość.",
    countPerObjective: 3,
    stageCounts: { guided: 1, productive: 0, independent: 2 },
    graderAvailable: false,
  } satisfies LessonPoolInput;
  const objectivesInput = { subjectTitle: "Szkoła", topicTitle: "Mapa", material: "Pierwsze zdanie. Drugie zdanie.", generationRole: "role" };

  it("gives the first exercise curious and the first card cheerful only when voiceTones is set", async () => {
    const llm = new FakeLlmProvider();
    const on = await llm.generateLessonPool({ ...poolInput, voiceTones: true });
    expect(on.exercises.map((e) => (e as { voiceTone?: unknown }).voiceTone)).toEqual(["curious", undefined, undefined]);
    const off = await llm.generateLessonPool(poolInput);
    for (const exercise of off.exercises) expect(exercise).not.toHaveProperty("voiceTone");

    const cardsOn = (await llm.generateLessonObjectives({ ...objectivesInput, voiceTones: true })).objectives as { cards: Record<string, unknown>[] }[];
    expect(cardsOn[0]!.cards.map((c) => c.voiceTone)).toEqual(["cheerful", undefined]);
    const cardsOff = (await llm.generateLessonObjectives(objectivesInput)).objectives as { cards: Record<string, unknown>[] }[];
    for (const card of cardsOff[0]!.cards) expect(card).not.toHaveProperty("voiceTone");
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
