import { describe, expect, it } from "vitest";
import { computeTargetKey } from "../target-key";
import { lessonExerciseTargetKey } from "./exposure-key";
import { englishGrammarSubject } from "./subjects/english-grammar/module";
import { historyLikeSubject } from "./testing/history-like-subject";
import type { LessonExerciseDraft } from "./types";

function draft(overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId: "o1",
    stem: "It's ___ today.",
    answer: "snowing",
    acceptedAnswers: [],
    focus: ["snowing"],
    ...overrides,
  };
}

describe("lessonExerciseTargetKey", () => {
  it("bez exposureText to computeTargetKey(answer, answerLocale) — gramatyka i inne przedmioty bez zmian", () => {
    expect(lessonExerciseTargetKey(englishGrammarSubject, draft())).toBe(computeTargetKey("snowing", "en-GB"));
    expect(lessonExerciseTargetKey(historyLikeSubject, draft({ answer: "966" }))).toBe(computeTargetKey("966", "pl-PL"));
  });

  it("z exposureText klucz pochodzi z jego wyniku, w języku odpowiedzi przedmiotu", () => {
    const subject = { ...englishGrammarSubject, exposureText: (d: LessonExerciseDraft) => `It's ${d.answer} today.` };
    const key = lessonExerciseTargetKey(subject, draft());
    expect(key).toBe(computeTargetKey("It's snowing today.", "en-GB"));
    expect(key).not.toBe(computeTargetKey("snowing", "en-GB"));
  });

  it("exposureText dostaje cały szkic", () => {
    const seen: LessonExerciseDraft[] = [];
    const subject = { ...englishGrammarSubject, exposureText: (d: LessonExerciseDraft) => { seen.push(d); return d.answer; } };
    const exercise = draft();
    lessonExerciseTargetKey(subject, exercise);
    expect(seen).toEqual([exercise]);
  });
});
