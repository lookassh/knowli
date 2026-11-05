import { describe, expect, it } from "vitest";
import type { LessonExerciseDraft } from "../../types";
import { stripGapVerb } from "./present-continuous-validation";
import { presentContinuousV1 } from "./topics/present-continuous";
import { validateEnglishGrammarExercise } from "./validators";

type Objective = "affirmative" | "now_or_usually" | "negative" | "questions" | "ing_spelling" | "now_or_usually_more";

/** Szkic luki tematu Present Continuous (jak `contextualGap` w `validators.test.ts`). */
function pcGap(objective: Objective, stem: string, answer: string, extra: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId: `english_grammar.present_continuous.${objective}`,
    stem,
    answer,
    acceptedAnswers: [],
    focus: answer.split(" "),
    ...extra,
  };
}

function validate(ex: LessonExerciseDraft): string[] {
  return validateEnglishGrammarExercise(ex, presentContinuousV1);
}

function expectPrefix(ex: LessonExerciseDraft, prefix: string): void {
  const errors = validate(ex);
  expect(errors.some((error) => error.startsWith(prefix)), `${prefix} w ${JSON.stringify(errors)}`).toBe(true);
}

describe("stripGapVerb", () => {
  it("usuwa nawias tuż po luce i zwraca czasownik oraz „not”", () => {
    expect(stripGapVerb("He ___ (play) football now.")).toEqual({ stem: "He ___ football now.", verb: "play", negative: false });
    expect(stripGapVerb("She ___ (not watch) TV now.")).toEqual({ stem: "She ___ TV now.", verb: "watch", negative: true });
    expect(stripGapVerb("___ she reading?")).toEqual({ stem: "___ she reading?", negative: false });
    expect(stripGapVerb("He ___ football (play) now.")).toEqual({ stem: "He ___ football (play) now.", negative: false });
  });
});

describe("validatePresentContinuousExercise — luka, poprawne", () => {
  const ok: [Objective, string, string][] = [
    ["affirmative", "He ___ (play) football now.", "is playing"],
    ["affirmative", "They always ___ (play) football now.", "are playing"],
    ["affirmative", "Łucja ___ (read) now.", "is reading"],
    ["affirmative", "The children ___ (play) now.", "are playing"],
    ["affirmative", "Tom and Ola ___ (jump) now.", "are jumping"],
    ["affirmative", "James ___ (read) now.", "is reading"],
    ["negative", "She ___ (not watch) TV now.", "isn't watching"],
    ["negative", "She ___ (not watch) TV now.", "is not watching"],
    ["questions", "___ she reading a book?", "Is"],
    ["questions", "What ___ they doing?", "are"],
    ["questions", "Is she reading? Yes, she ___.", "is"],
    ["questions", "___ Ola reading a book?", "Is"],
    ["questions", "___ the dogs running?", "Are"],
    ["questions", "What ___ Ola doing?", "is"],
    ["questions", "___ Tom and Ola playing?", "Are"],
    ["questions", "___ the boy and the girl playing?", "Are"],
    ["questions", "What ___ your mum and dad doing?", "are"],
    ["questions", "___ your mum and dad cooking?", "Are"],
    ["questions", "What ___ the cat and the dog doing?", "are"],
    ["ing_spelling", "He ___ (swim) now.", "is swimming"],
    ["affirmative", "She ___ (have) lunch now.", "is having"],
    ["affirmative", "He ___ (look) at the stars now.", "is looking"],
    ["affirmative", "They ___ playing now.", "are"],
    ["negative", "She ___ sleeping now.", "isn't"],
  ];
  it.each(ok)("%s: „%s” → „%s”", (objective, stem, answer) => {
    expect(validate(pcGap(objective, stem, answer))).toEqual([]);
  });

  it("wariant odpowiedzi sprawdzany jak odpowiedź", () => {
    expect(validate(pcGap("negative", "She ___ (not watch) TV now.", "isn't watching", { acceptedAnswers: ["is not watching"] }))).toEqual([]);
    expectPrefix(pcGap("affirmative", "He ___ (play) now.", "is playing", { acceptedAnswers: ["are playing"] }), "pc-be:");
  });
});

describe("validatePresentContinuousExercise — luka, odrzucone", () => {
  it("forma be niezgodna z podmiotem (pc-be:)", () => {
    expectPrefix(pcGap("affirmative", "He ___ (play) now.", "are playing"), "pc-be:");
    expectPrefix(pcGap("questions", "___ Ola reading a book?", "Are"), "pc-be:");
    expectPrefix(pcGap("questions", "___ the dogs running?", "Is"), "pc-be:");
    expectPrefix(pcGap("questions", "What ___ Ola doing?", "are"), "pc-be:");
    expectPrefix(pcGap("questions", "___ Tom and Ola playing?", "Is"), "pc-be:");
    expectPrefix(pcGap("questions", "___ your mum and dad cooking?", "Is"), "pc-be:");
    expectPrefix(pcGap("questions", "What ___ the cat and the dog doing?", "is"), "pc-be:");
  });

  it("brak formy -ing albo zła forma (pc-ing:)", () => {
    expectPrefix(pcGap("affirmative", "He ___ (play) now.", "is play"), "pc-ing:");
  });

  it("niepusty hint w luce (pc-shape:); w innych typach bez reguły tematu", () => {
    expectPrefix(pcGap("affirmative", "He ___ (play) now.", "is playing", { hint: "play" }), "pc-shape:");
    const openAnswer: LessonExerciseDraft = {
      exerciseType: "lesson_open_answer",
      objectiveId: "english_grammar.present_continuous.affirmative",
      prompt: "Tata teraz gotuje obiad.",
      hint: "play",
      answer: "Dad is cooking dinner now.",
      acceptedAnswers: [],
      focus: ["is", "cooking"],
    };
    expect(validate(openAnswer)).toEqual([]);
  });

  it("luka z czasownikiem bez nawiasu (pc-shape:)", () => {
    expectPrefix(pcGap("affirmative", "He ___ now.", "is playing"), "pc-shape:");
  });

  it("nawias dalej w zdaniu (pc-shape:)", () => {
    expectPrefix(pcGap("affirmative", "He ___ football (play) now.", "is playing"), "pc-shape:");
  });

  it("nawias w bodźcu wyboru i „posłuchaj i wybierz” (pc-shape:)", () => {
    const options = [{ id: "a", text: "is playing" }, { id: "b", text: "are playing" }];
    expectPrefix({ ...pcGap("affirmative", "He ___ (play) now.", "is playing"), exerciseType: "lesson_choice", options, correctOption: "a" }, "pc-shape:");
    expectPrefix({
      ...pcGap("affirmative", "He ___ (play) now.", "is"),
      exerciseType: "lesson_listen_choice",
      options: [{ id: "a", text: "is" }, { id: "b", text: "are" }],
      correctOption: "a",
    }, "pc-shape:");
  });

  it("klasa formy -ing spoza celu (pc-ing:)", () => {
    expectPrefix(pcGap("affirmative", "He ___ (swim) now.", "is swimming"), "pc-ing:");
    expectPrefix(pcGap("ing_spelling", "He ___ (play) now.", "is playing"), "pc-ing:");
  });

  it("nawias z „not” wymagany w celu 3, zakazany w celu 1 (pc-shape:)", () => {
    expectPrefix(pcGap("negative", "She ___ (watch) TV now.", "isn't watching"), "pc-shape:");
    expectPrefix(pcGap("affirmative", "He ___ (not play) now.", "isn't playing"), "pc-shape:");
  });

  it("luka na formę be w celu 5 (pc-shape:)", () => {
    expectPrefix(pcGap("ing_spelling", "He ___ swimming now.", "is"), "pc-shape:");
  });

  it("odpowiedź zaczynająca się apostrofem (pc-shape:)", () => {
    expectPrefix(pcGap("affirmative", "I ___ (play) now.", "'m playing"), "pc-shape:");
  });

  it("wskaźnik zakazany (pc-marker:)", () => {
    expectPrefix(pcGap("affirmative", "He ___ (play) tennis tomorrow.", "is playing"), "pc-marker:");
    expectPrefix(pcGap("affirmative", "He ___ (play) tennis now.", "is playing", { instructionPl: "Jutro mecz." }), "pc-marker:");
  });

  it("czasownik stanu w formie -ing i „being” (pc-state:)", () => {
    expectPrefix(pcGap("affirmative", "She ___ (like) it now.", "is liking"), "pc-state:");
    expectPrefix(pcGap("affirmative", "He ___ (be) silly now.", "is being"), "pc-state:");
    expectPrefix(pcGap("affirmative", "She ___ (have) a cat now.", "is having"), "pc-state:");
  });

  it("kolokacja „having” nie jest dozwolona w celu 5 (pc-ing:)", () => {
    expectPrefix(pcGap("ing_spelling", "She ___ (have) lunch now.", "is having"), "pc-ing:");
  });

  it("czasownik spoza tabeli (pc-ing:)", () => {
    expectPrefix(pcGap("affirmative", "The plant ___ (photosynthesise) now.", "is photosynthesising"), "pc-ing:");
  });

  it("biegunowość celu twierdzącego i przeczącego (pc-be:)", () => {
    expectPrefix(pcGap("negative", "She ___ sleeping now.", "is"), "pc-be:");
    expectPrefix(pcGap("affirmative", "They ___ playing now.", "aren't"), "pc-be:");
    expectPrefix(pcGap("questions", "Is she reading? No, she ___.", "is"), "pc-be:");
  });
});
