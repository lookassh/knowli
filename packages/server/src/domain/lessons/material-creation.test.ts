import { describe, expect, it } from "vitest";
import { materialCreationMode, materialObjectiveRules, recordsCards, requiresObjectiveKind, requiresParentSubjectTitle, stripListenChoiceExtras } from "./material-creation";
import { englishChapterSubject } from "./subjects/english-chapter/module";
import { englishGrammarSubject } from "./subjects/english-grammar/module";
import { schoolSubject } from "./subjects/school/module";
import type { SubjectModule } from "./types";

const dynamic: SubjectModule["buildDynamicTopic"] = () => ({
  id: "dynamic",
  version: 1,
  titlePl: "T",
  extraErrorCategories: [],
  transforms: [],
  objectives: [],
});

describe("materialCreationMode", () => {
  it("rozpoznaje przedmioty rejestru: szkoła z nazwą od rodzica, rozdział ze stałym tytułem, gramatyka katalogowa", () => {
    expect(materialCreationMode(schoolSubject)).toBe("parent");
    expect(materialCreationMode(englishChapterSubject)).toBe("fixed");
    expect(materialCreationMode(englishGrammarSubject)).toBeUndefined();
  });

  it("wymaga obu pól: temat dynamiczny bez deklaracji tytułu albo deklaracja bez tematu nie tworzy z materiału", () => {
    expect(materialCreationMode({ buildDynamicTopic: dynamic })).toBeUndefined();
    expect(materialCreationMode({ materialSubjectTitle: "fixed" })).toBeUndefined();
    expect(materialCreationMode({ materialSubjectTitle: "parent" })).toBeUndefined();
    expect(materialCreationMode({ buildDynamicTopic: dynamic, materialSubjectTitle: "fixed" })).toBe("fixed");
    expect(materialCreationMode({ buildDynamicTopic: dynamic, materialSubjectTitle: "parent" })).toBe("parent");
  });
});

describe("requiresParentSubjectTitle", () => {
  it("jest prawdą tylko dla nazwy przedmiotu od rodzica z zagadnieniami z materiału", () => {
    expect(requiresParentSubjectTitle(schoolSubject)).toBe(true);
    expect(requiresParentSubjectTitle(englishChapterSubject)).toBe(false);
    expect(requiresParentSubjectTitle(englishGrammarSubject)).toBe(false);
    expect(requiresParentSubjectTitle({ materialSubjectTitle: "parent" })).toBe(false);
    expect(requiresParentSubjectTitle({ buildDynamicTopic: dynamic, materialSubjectTitle: "parent" })).toBe(true);
  });
});

describe("requiresObjectiveKind i recordsCards", () => {
  it("rozdział wymaga kind i nie nagrywa kart, szkoła odwrotnie", () => {
    expect([requiresObjectiveKind(englishChapterSubject), recordsCards(englishChapterSubject)]).toEqual([true, false]);
    expect([requiresObjectiveKind(schoolSubject), recordsCards(schoolSubject)]).toEqual([false, true]);
  });
});

describe("stripListenChoiceExtras", () => {
  const base = {
    objectiveId: "english_grammar.present_simple.third_person_s",
    stem: "He ___ football.",
    answer: "plays",
    acceptedAnswers: [],
    focus: ["plays"],
    options: [{ id: "a", text: "plays" }, { id: "b", text: "play" }],
    correctOption: "a",
    instructionPl: "Wybierz słowo.",
    hint: "play",
    visualSubject: "boy",
  } as const;

  it("usuwa polecenie, podpowiedź i piktogram tylko z ćwiczenia słuchowego", () => {
    const stripped = stripListenChoiceExtras({ ...base, exerciseType: "lesson_listen_choice" });
    expect(stripped).not.toHaveProperty("instructionPl");
    expect(stripped).not.toHaveProperty("hint");
    expect(stripped).not.toHaveProperty("visualSubject");
    expect(stripped).toMatchObject({ stem: "He ___ football.", answer: "plays", correctOption: "a" });
  });

  it("zwraca inne typy bez zmian (ta sama referencja)", () => {
    const choice = { ...base, exerciseType: "lesson_choice" } as const;
    expect(stripListenChoiceExtras(choice)).toBe(choice);
  });

  it("zwraca ćwiczenie słuchowe bez dodatków bez zmian", () => {
    const { instructionPl: _i, hint: _h, visualSubject: _v, ...clean } = base;
    const draft = { ...clean, exerciseType: "lesson_listen_choice" } as const;
    expect(stripListenChoiceExtras(draft)).toBe(draft);
  });
});

describe("materialObjectiveRules", () => {
  it("szkoła: ogólny podział 2-8 i karty bez dodawania faktów", () => {
    const rules = materialObjectiveRules(schoolSubject);
    expect(rules).toContain("2-8");
    expect(rules).toContain("at most 600 characters");
    expect(rules).toContain("NEVER add facts");
    expect(rules).not.toContain("Return strict JSON");
  });

  it("rozdział: reguły przedmiotu zamiast ogólnej liczby zagadnień", () => {
    const rules = materialObjectiveRules(englishChapterSubject);
    expect(rules).toContain(englishChapterSubject.prompts.objectivesRules!);
    expect(rules).toContain("at most 600 characters");
    expect(rules).toContain("NEVER add facts, words or definitions");
    expect(rules).not.toContain("Return strict JSON");
  });
});
