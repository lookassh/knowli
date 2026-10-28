import { describe, expect, it } from "vitest";
import { validateSubject } from "../../catalog-validation";
import { createSubjectRegistry } from "../../registry";
import { resolveLessonTopic, validateDynamicTopicData } from "../../topic-resolution";
import type { DynamicTopicData, LessonExerciseDraft } from "../../types";
import { poolCoverage, validateLessonExercise, validatePool } from "../../pool-validation";
import { renderCalculationPrompt, computeCalculationAnswer } from "../../calculation";
import type { CalculationSpec } from "@learning/contracts";
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

const scale: CalculationSpec = {
  kind: "scale_distance", params: { scaleDenominator: 25000, mapDistanceCm: 3 },
  unit: "m", templateFamilyId: "map-scale",
};
function calculationDraft(calculation: CalculationSpec = scale, overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_calculation", objectiveId: dynamicData.objectives[0]!.id,
    calculation, prompt: renderCalculationPrompt(calculation), answer: computeCalculationAnswer(calculation).answer,
    acceptedAnswers: [], focus: [], sourceRefs: [{ quote: "wytwarza cukry" }], ...overrides,
  };
}

describe("school calculation validation", () => {
  const topic = schoolSubject.buildDynamicTopic!(dynamicData);
  it.each([
    [scale, "Na mapie w skali 1:25 000 odcinek ma 3 cm. Oblicz odległość w terenie w m.", "750 m"],
    [{ kind: "height_difference", params: { upperHeightM: 400, lowerHeightM: 150 }, unit: "m", templateFamilyId: "height" },
      "Punkt wyższy: 400 m n.p.m., punkt niższy: 150 m n.p.m. Oblicz różnicę wysokości w m.", "250 m"],
    [{ kind: "unit_conversion", params: { value: 2, fromUnit: "km" }, unit: "m", templateFamilyId: "units" },
      "Przelicz 2 km na m.", "2000 m"],
  ] as const)("accepts canonical %j without open-answer fields", (calculation, prompt, answer) => {
    expect(validateLessonExercise(calculationDraft(calculation, { prompt, answer }), schoolSubject, topic)).toEqual([]);
  });
  it.each([
    ["calculation", { calculation: undefined }],
    ["prompt", { prompt: "Oblicz odległość do Warszawy." }],
    ["answer", { answer: "0,75 km" }],
    ["acceptedAnswers", { acceptedAnswers: ["750"] }],
    ["focus", { focus: ["750"] }],
    ["sourceRefs", { sourceRefs: undefined }],
    ["requiredElements", { requiredElements: [{ id: "one", text: "wynik" }] }],
    ["familyId", { familyId: "open-answer-family" }],
  ] as const)("rejects an invalid %s", (field, overrides) => {
    expect(validateLessonExercise(calculationDraft(scale, overrides), schoolSubject, topic).some((error) => error.includes(field))).toBe(true);
  });
  it("collects invalid kind and excessive tolerance without throwing", () => {
    const invalid = { ...scale, kind: "unknown" } as unknown as CalculationSpec;
    expect(validateLessonExercise(calculationDraft(scale, { calculation: invalid }), schoolSubject, topic).some((error) => error.includes("calculation"))).toBe(true);
    expect(validateLessonExercise(calculationDraft(scale, { calculation: { ...scale, tolerance: 8 } }), schoolSubject, topic).some((error) => error.includes("calculation"))).toBe(true);
  });
  it("rejects calculation parameters attached to another exercise type", () => {
    expect(validateLessonExercise(openDraft({ calculation: scale }), schoolSubject, topic).some((error) => error.includes("calculation"))).toBe(true);
  });
  it("checks quote membership at the pool hook with material", () => {
    const forged = calculationDraft(scale, { sourceRefs: [{ quote: "Skala mapy określa stosunek odległości." }] });
    expect(validateLessonExercise(forged, schoolSubject, topic)).toEqual([]);
    expect(schoolSubject.validatePoolExtra!([forged], { material: MATERIAL }).get(0)?.some((error) => error.includes("sourceRefs"))).toBe(true);
  });
  it("allows numeric variants in a shared template family and deduplicates across family IDs", () => {
    const a = calculationDraft();
    const b = calculationDraft({ ...scale, params: { ...scale.params, mapDistanceCm: 4 } });
    expect(schoolSubject.validatePoolExtra!([a, b], { material: MATERIAL }).size).toBe(0);
    const duplicate = calculationDraft({ ...scale, templateFamilyId: "other-family" });
    const result = validatePool([a, b, duplicate], schoolSubject, topic);
    expect(result.valid).toEqual([a, b]);
    expect(result.rejected.map((entry) => entry.exercise)).toEqual([duplicate]);
  });
  it("treats the same template family slug in another objective as a separate family", () => {
    const other = calculationDraft({ kind: "height_difference", params: { upperHeightM: 400, lowerHeightM: 150 }, unit: "m", templateFamilyId: "map-scale" }, { objectiveId: "school.other" });
    expect(schoolSubject.validatePoolExtra!([calculationDraft(), other], { material: MATERIAL }).size).toBe(0);
  });
  it.each([
    { calculation: { kind: "height_difference", params: { upperHeightM: 400, lowerHeightM: 150 }, unit: "m", templateFamilyId: "map-scale" } },
    { calculation: { ...scale, unit: "km" } },
  ] as const)("rejects inconsistent calculation template family %j", (overrides) => {
    const result = schoolSubject.validatePoolExtra!([calculationDraft(), calculationDraft(scale, overrides)], { material: MATERIAL });
    expect(result.get(1)?.some((error) => error.includes("templateFamilyId"))).toBe(true);
  });
  it("requires a common conversion input unit in a template family", () => {
    const conversion: CalculationSpec = { kind: "unit_conversion", params: { value: 2, fromUnit: "km" }, unit: "m", templateFamilyId: "units" };
    const a = calculationDraft(conversion);
    const b = calculationDraft({ ...conversion, params: { value: 3, fromUnit: "cm" } });
    expect(schoolSubject.validatePoolExtra!([a, b], { material: MATERIAL }).get(1)?.some((error) => error.includes("templateFamilyId"))).toBe(true);
  });
  it("counts calculations as independent while retaining the school pool minima", () => {
    const gaps = poolCoverage([calculationDraft()], [dynamicData.objectives[0]!.id], schoolSubject.poolMinimums!);
    expect(gaps.map(({ stage, required, actual }) => ({ stage, required, actual }))).toEqual([
      { stage: "guided", required: 3, actual: 0 },
      { stage: "productive", required: 2, actual: 0 },
      { stage: "independent", required: 2, actual: 1 },
    ]);
  });
});

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

  it.each([
    ["7 elementów wymaganych", { requiredElements: Array.from({ length: 7 }, (_, i) => ({ id: `e${i + 1}`, text: `element ${i + 1}` })) }],
    ["odpowiedź wzorcowa ponad 300 znaków", { answer: "a".repeat(301) }],
    ["cytat ponad 600 znaków", { sourceRefs: [{ quote: "b".repeat(601) }] }],
    ["4 cytaty", { sourceRefs: Array.from({ length: 4 }, () => ({ quote: "wytwarza cukry" })) }],
    ["5 typowych błędów", { commonErrors: ["a", "b", "c", "d", "e"] }],
  ])("odrzuca ćwiczenie łamiące limit kontraktu DTO (%s), zanim trafi do szkicu", (_label, overrides) => {
    // Szkic z polami ponad limit nie przeszedłby walidacji odpowiedzi API rodzica.
    const topic = schoolSubject.buildDynamicTopic!(dynamicData);
    const { valid, rejected } = validatePool([openDraft(overrides as Partial<LessonExerciseDraft>)], schoolSubject, topic);
    expect(valid).toEqual([]);
    expect(rejected).toHaveLength(1);
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

  it("ten sam slug rodziny w dwóch zagadnieniach to dwie niezależne rodziny (partie per cel)", () => {
    // Model generuje każdy cel osobno i powtarza slugi typu „f1” — nie wolno przez to odrzucić drugiego celu.
    const a = openDraft({ familyId: "f1", prompt: "Co to jest fotosynteza?" });
    const b = openDraft({ familyId: "f1", objectiveId: "school.ddeck.chrzest", prompt: "Kiedy Mieszko przyjął chrzest?", answer: "W 966 roku.", focus: ["966"], requiredElements: [{ id: "e1", text: "966 rok" }] });
    expect(schoolSubject.validatePoolExtra!([a, b], { material: MATERIAL }).size).toBe(0);
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
