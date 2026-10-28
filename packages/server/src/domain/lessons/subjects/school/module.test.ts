import { describe, expect, it } from "vitest";
import { validateSubject } from "../../catalog-validation";
import { createSubjectRegistry } from "../../registry";
import { resolveLessonTopic, validateDynamicTopicData } from "../../topic-resolution";
import type { DynamicTopicData, LessonExerciseDraft } from "../../types";
import { validatePool } from "../../pool-validation";
import { schoolSubject } from "./module";

const MATERIAL =
  "Fotosynteza to proces, w którym roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry. " +
  "Mieszko I przyjął chrzest w 966 roku, aby włączyć państwo do chrześcijańskiej Europy.";

const dynamicData: DynamicTopicData = {
  titlePl: "Przyroda i historia",
  objectives: [
    {
      id: "school.ddeck.fotosynteza",
      titlePl: "Fotosynteza",
      descriptionEn: "Photosynthesis: plants produce sugars from water, carbon dioxide and light.",
      cards: [
        { title: "Co to jest?", body: "Roślina wytwarza cukry z wody i dwutlenku węgla przy świetle." },
        { title: "Po co?", body: "Cukry są pokarmem rośliny." },
      ],
    },
  ],
};

function openDraft(overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_open_answer",
    objectiveId: "school.ddeck.fotosynteza",
    prompt: "Co to jest fotosynteza?",
    answer: "Roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry.",
    acceptedAnswers: [],
    focus: ["wytwarza cukry"],
    questionType: "definition",
    requiredElements: [{ id: "e1", text: "Roślina wytwarza cukry." }],
    expectedForm: "explanation",
    sourceRefs: [{ quote: "wytwarza cukry" }],
    ...overrides,
  };
}

describe("przedmiot school", () => {
  it("przechodzi walidację katalogu z pustą listą tematów", () => {
    expect(validateSubject(schoolSubject)).toEqual([]);
  });

  it("składa temat dynamiczny i rozwiązuje go przez rejestr", () => {
    const topic = schoolSubject.buildDynamicTopic!(dynamicData);
    expect(topic.id).toBe("dynamic");
    expect(topic.objectives[0]?.hints.missing_element).toBeTruthy();

    const registry = createSubjectRegistry([schoolSubject]);
    const resolved = resolveLessonTopic(registry, {
      subjectId: "school",
      topicId: "dynamic",
      topicVersion: 1,
      dynamicTopic: dynamicData,
    });
    expect(resolved?.topic.objectives[0]?.id).toBe("school.ddeck.fotosynteza");
  });

  it("waliduje dane dynamiczne regułami katalogu (karty 2–4)", () => {
    expect(validateDynamicTopicData(schoolSubject, dynamicData)).toEqual([]);
    const bad: DynamicTopicData = {
      ...dynamicData,
      objectives: [{ ...dynamicData.objectives[0]!, cards: [{ title: "Jedna", body: "Karta." }] }],
    };
    expect(validateDynamicTopicData(schoolSubject, bad).length).toBeGreaterThan(0);
  });

  it("akceptuje ćwiczenie otwarte z polami v3 i uziemionym cytatem", () => {
    const topic = schoolSubject.buildDynamicTopic!(dynamicData);
    const { valid, rejected } = validatePool([openDraft()], schoolSubject, topic);
    expect(rejected).toEqual([]);
    expect(valid).toHaveLength(1);
    const extra = schoolSubject.validatePoolExtra!([openDraft()], { material: MATERIAL });
    expect(extra.size).toBe(0);
  });

  it("odrzuca cytat spoza materiału, a cytat rodzica przepuszcza", () => {
    const forged = openDraft({ sourceRefs: [{ quote: "Rośliny jedzą słońce na śniadanie." }] });
    const extra = schoolSubject.validatePoolExtra!([forged], { material: MATERIAL });
    expect(extra.get(0)?.some((e) => e.includes("sourceRefs"))).toBe(true);

    const parent = openDraft({ sourceRefs: [{ quote: "Rośliny jedzą słońce na śniadanie.", parentAdded: true }] });
    expect(schoolSubject.validatePoolExtra!([parent], { material: MATERIAL }).size).toBe(0);
  });

  it("wymaga elementów wymaganych i formy dla odpowiedzi otwartej", () => {
    const topic = schoolSubject.buildDynamicTopic!(dynamicData);
    const { rejected } = validatePool(
      [openDraft({ requiredElements: undefined, expectedForm: undefined })],
      schoolSubject,
      topic,
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.errors.some((e) => e.includes("requiredElements"))).toBe(true);
  });

  it("pilnuje spójności rodziny pytań", () => {
    const a = openDraft({ familyId: "fam", prompt: "Co to jest fotosynteza?" });
    const b = openDraft({ familyId: "fam", prompt: "Wyjaśnij fotosyntezę.", answer: "Inny wzorzec odpowiedzi, wytwarza cukry.", focus: ["cukry"] });
    const extra = schoolSubject.validatePoolExtra!([a, b], { material: MATERIAL });
    expect(extra.get(1)?.some((e) => e.includes("familyId"))).toBe(true);
  });
  it("rodzina sformułowań przechodzi PEŁNĄ walidację puli (regresja deduplikacji)", () => {
    const topic = schoolSubject.buildDynamicTopic!(dynamicData);
    const a = openDraft({ familyId: "foto-def", prompt: "Co to jest fotosynteza?" });
    const b = openDraft({ familyId: "foto-def", prompt: "Wyjaśnij własnymi słowami, czym jest fotosynteza." });
    const extra = schoolSubject.validatePoolExtra!([a, b], { material: MATERIAL });
    expect(extra.size).toBe(0);
    const { valid, rejected } = validatePool([a, b], schoolSubject, topic);
    expect(rejected).toEqual([]);
    expect(valid).toHaveLength(2);
  });

  it("rodzina z identycznym tekstem pytania jest odrzucana", () => {
    const a = openDraft({ familyId: "fam", prompt: "Co to jest fotosynteza?" });
    const b = openDraft({ familyId: "fam", prompt: "Co to jest fotosynteza?" });
    const extra = schoolSubject.validatePoolExtra!([a, b], { material: MATERIAL });
    expect(extra.get(1)?.some((e) => e.includes("familyId"))).toBe(true);
  });

  it("za krótki cytat nie uziemia ćwiczenia", () => {
    const ex = openDraft({ sourceRefs: [{ quote: "966" }] });
    const extra = schoolSubject.validatePoolExtra!([ex], { material: MATERIAL });
    expect(extra.get(0)?.some((e) => e.includes("za krótki"))).toBe(true);
  });

  it("expectedForm na typie zamkniętym jest odrzucane", () => {
    const topic = schoolSubject.buildDynamicTopic!(dynamicData);
    const choice = openDraft({
      exerciseType: "lesson_choice",
      stem: "Co wytwarza roślina?",
      prompt: undefined,
      questionType: undefined,
      requiredElements: undefined,
      expectedForm: "short",
      focus: [],
      options: [{ id: "a", text: "cukry" }, { id: "b", text: "tlen" }],
      correctOption: "a",
      answer: "cukry",
    });
    const { rejected } = validatePool([choice], schoolSubject, topic);
    expect(rejected[0]?.errors.some((e) => e.includes("expectedForm"))).toBe(true);
  });});
