import { describe, expect, test } from "vitest";
import type { LessonMockTestSummaryDto } from "@learning/contracts";
import { computeLessonMockScore, lessonMockOutcomeStatus } from "./lesson-mock-score";

type Solution = LessonMockTestSummaryDto["solutions"][number];

function solution(outcome: Solution["outcome"]): Solution {
  return {
    taskId: "00000000-0000-0000-0000-000000000000",
    objectiveId: "obj",
    titlePl: "Cel",
    exerciseType: "lesson_choice",
    prompt: "Pytanie",
    childAnswer: "a",
    correctAnswer: "a",
    outcome,
  };
}

describe("lessonMockOutcomeStatus", () => {
  test("poprawna → correct, błędna → incorrect", () => {
    expect(lessonMockOutcomeStatus("correct")).toBe("correct");
    expect(lessonMockOutcomeStatus("incorrect")).toBe("incorrect");
  });

  test("pominięte i nieocenione nie są błędem — to notAssessed", () => {
    expect(lessonMockOutcomeStatus("skipped")).toBe("notAssessed");
    expect(lessonMockOutcomeStatus("unassessed")).toBe("notAssessed");
  });
});

describe("computeLessonMockScore", () => {
  test("liczy poprawne zadania ze wszystkich; błąd obniża wynik", () => {
    const solutions = [solution("correct"), solution("correct"), solution("incorrect")];
    expect(computeLessonMockScore(solutions)).toEqual({ correct: 2, total: 3, percent: 67, stars: 4 });
  });

  test("komplet poprawnych to 100% i 6 gwiazdek", () => {
    expect(computeLessonMockScore([solution("correct"), solution("correct")])).toEqual({ correct: 2, total: 2, percent: 100, stars: 6 });
  });

  test("niepełna próba: pominięte i nieocenione obniżają wynik, ale nie są błędem", () => {
    const solutions = [solution("correct"), solution("skipped"), solution("unassessed"), solution("incorrect")];
    expect(computeLessonMockScore(solutions)).toEqual({ correct: 1, total: 4, percent: 25, stars: 1 });
  });

  test("pusta próba nie dzieli przez zero", () => {
    expect(computeLessonMockScore([])).toEqual({ correct: 0, total: 0, percent: 0, stars: 0 });
  });
});
