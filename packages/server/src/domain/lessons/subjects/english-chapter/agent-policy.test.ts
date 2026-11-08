import { describe, expect, it } from "vitest";
import type { LessonExerciseDraft } from "../../types";
import { chapterAgentPolicy } from "./agent-policy";
import { englishChapterSubject } from "./module";
import { TRANSLATION_INSTRUCTION } from "./validators";

describe("chapterAgentPolicy — wartości i typy", () => {
  it("jest polityką przedmiotu rozdziału", () => {
    expect(englishChapterSubject.agentPolicy).toBe(chapterAgentPolicy);
  });

  it("ma zapas samodzielnych 1 i luz 2, bez materiału dla checkera", () => {
    expect(chapterAgentPolicy.independentReserve).toBe(1);
    expect(chapterAgentPolicy.slack).toBe(2);
    expect(chapterAgentPolicy.checkerNeedsMaterial).toBe(false);
  });

  it("nie ma sędziego podpowiedzi ani kontroli otwartej (zachowanie jak w 2a)", () => {
    expect(chapterAgentPolicy.hintJudgeTypes).toBeUndefined();
    expect(chapterAgentPolicy.openAnswerCheckTypes).toBeUndefined();
    for (const key of ["check.hint_judge", "check.open_answer"]) {
      expect(chapterAgentPolicy.ruleNotes?.[key]).toBeUndefined();
    }
  });

  it("typy ślepe i wariantów należą do przedmiotu, bez keywords i listen_choice", () => {
    const subjectTypes = new Set<string>(englishChapterSubject.exerciseTypes);
    for (const type of [...chapterAgentPolicy.blindSolveTypes, ...chapterAgentPolicy.variantCheckTypes]) {
      expect(subjectTypes.has(type)).toBe(true);
    }
    expect(chapterAgentPolicy.blindSolveTypes).not.toContain("lesson_keywords");
    expect(chapterAgentPolicy.blindSolveTypes).not.toContain("lesson_listen_choice");
    expect(chapterAgentPolicy.blindSolveTypes).toContain("lesson_cloze");
    expect(chapterAgentPolicy.variantCheckTypes).toEqual(["lesson_open_answer", "lesson_gap"]);
  });

  it("typy ślepe to dokładnie zbiór PoC (gałąź nie-szkolna) przecięty z typami rozdziału", () => {
    expect(chapterAgentPolicy.blindSolveTypes).toEqual([
      "lesson_choice",
      "lesson_gap",
      "lesson_cloze",
      "lesson_open_answer",
      "lesson_order",
      "lesson_match",
      "lesson_group",
    ]);
    expect(chapterAgentPolicy.variantCheckTypes).toEqual(["lesson_open_answer", "lesson_gap"]);
  });

  it("dopisek lesson.leak_source ma ustaloną treść", () => {
    expect(chapterAgentPolicy.ruleNotes?.["lesson.leak_source"]).toBe("Use a different sentence.");
  });

  it("dopisek lesson.leak podpowiada zmianę pokoju, przedmiotu lub miejsca", () => {
    expect(chapterAgentPolicy.ruleNotes?.["lesson.leak"]).toContain("change the room, object or place");
  });

  it("dopisek check.blind_solve: polskie zdanie źródłowe wskazuje jedno sformułowanie, szyki w acceptedAnswers", () => {
    expect(chapterAgentPolicy.ruleNotes?.["check.blind_solve"]).toContain("(pronoun, tense, word order)");
    expect(chapterAgentPolicy.ruleNotes?.["check.blind_solve"]).toContain("acceptedAnswers");
  });
});

describe("sanitize", () => {
  it("bez bramek, wymaganych typów i braków słów (etap 5a); tłumaczenie bez polecenia dostaje stałe polecenie", () => {
    for (const key of ["requiredTypes", "exerciseGate", "objectiveGaps"] as const) expect(chapterAgentPolicy[key]).toBeUndefined();
    const translation: LessonExerciseDraft = {
      exerciseType: "lesson_open_answer", objectiveId: "english_chapter.dx.room", prompt: "Mam łóżko.", answer: "I have a bed.", acceptedAnswers: [], focus: ["bed"],
    };
    expect(chapterAgentPolicy.sanitize!(translation, { material: "" })).toEqual({ draft: { ...translation, instructionPl: TRANSLATION_INSTRUCTION }, removed: [] });
  });
});
