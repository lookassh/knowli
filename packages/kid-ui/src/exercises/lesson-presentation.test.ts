import { describe, expect, it } from "vitest";
import { messages, type TaskDto } from "@learning/contracts";
import { getExercisePresentation } from "./exercise-presentation";

const id = "10000000-0000-4000-8000-000000000004";
const opt = (text: string, n: number) => ({ id: `10000000-0000-4000-8000-00000000000${n}`, text });

function lessonTask(prompt: TaskDto["prompt"]): TaskDto {
  return {
    taskId: id, sessionId: "10000000-0000-4000-8000-000000000003", ordinal: 0,
    exerciseType: prompt.kind as TaskDto["exerciseType"], direction: null, state: "issued", remainingAssessed: 1, prompt,
  };
}

describe("getExercisePresentation — gałęzie lekcji", () => {
  it("lesson_card ma stałe polecenie, nie powiela tytułu karty", () => {
    const result = getExercisePresentation(lessonTask({
      kind: "lesson_card",
      card: { title: "Czas Present Simple", body: "Treść", examples: ["He plays."] },
    }));
    expect(result).toEqual({ instruction: messages.kid.lessonCardInstruction, icon: "sparkles" });
    expect(result.instruction).not.toContain("Present Simple");
  });

  it("typy ze zdaniem biorą polecenie z instructionPl promptu", () => {
    expect(getExercisePresentation(lessonTask({
      kind: "lesson_choice", instructionPl: "Wybierz właściwą formę", stem: "He ___ football.",
      options: [opt("play", 7), opt("plays", 8)],
    })).instruction).toBe("Wybierz właściwą formę");
    expect(getExercisePresentation(lessonTask({
      kind: "lesson_gap", instructionPl: "Uzupełnij lukę", stemWithGap: "He ___ (play).",
    })).instruction).toBe("Uzupełnij lukę");
    expect(getExercisePresentation(lessonTask({
      kind: "lesson_order", instructionPl: "Ułóż zdanie", items: [opt("She", 7), opt("plays", 8)],
    })).instruction).toBe("Ułóż zdanie");
  });

  it("lesson_short_answer używa pytania jako polecenia", () => {
    expect(getExercisePresentation(lessonTask({
      kind: "lesson_short_answer", question: "Jaka to osoba?", options: [opt("3.", 7), opt("1.", 8)],
    })).instruction).toBe("Jaka to osoba?");
  });

  it("lesson_calculation bierze polecenie z instructionPl", () => {
    expect(getExercisePresentation(lessonTask({
      kind: "lesson_calculation", instructionPl: "Oblicz.", prompt: "Przelicz 0,75 km na m.",
    }))).toEqual({ instruction: "Oblicz.", icon: "pencil" });
  });
});
