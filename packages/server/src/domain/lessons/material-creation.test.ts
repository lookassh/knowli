import { describe, expect, it } from "vitest";
import { materialCreationMode, requiresParentSubjectTitle } from "./material-creation";
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
