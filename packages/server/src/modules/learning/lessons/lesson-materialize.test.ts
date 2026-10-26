import { describe, expect, it } from "vitest";
import { englishGrammarSubject } from "../../../domain/lessons/subjects/english-grammar/module";
import { evaluateChoice, type LessonAnswerKey } from "../../../domain/lessons/evaluate";
import { materializeExercise, type LoadedExercise } from "./lesson-materialize";

/**
 * P1-1: `correctOption` kontraktu (pool-validation) niesie ID OPCJI dla
 * choice/short_answer i TEKST słowa (zrównany normalizatorem) dla notice.
 * Materializacja musi wyznaczyć `answerKey.correctOptionId` zgodnie z tym
 * kontraktem — inaczej każda odpowiedź dziecka jest oceniana jako błędna.
 * Silnik pozostaje niezależny od przedmiotu: normalizator pochodzi z `SubjectModule`.
 */

const subject = englishGrammarSubject;
const topic = subject.topics[0]!;

function loaded(payload: LoadedExercise["payload"]): LoadedExercise {
  return {
    revisionId: "rev-1",
    itemId: "item-1",
    position: 0,
    payload,
    targetKey: "tk-1",
    audioAssetId: null,
  };
}

/** Klucz odpowiedzi z materializacji zrzutowany na typ oceny. */
function answerKeyOf(task: ReturnType<typeof materializeExercise>): LessonAnswerKey {
  return task.answerKey as unknown as LessonAnswerKey;
}

describe("materializeExercise — correctOption po ID (P1-1)", () => {
  function choiceTask(seed: string, payload: Partial<LoadedExercise["payload"]>, forTopic = topic) {
    return materializeExercise(
      { independentCheck: false, reason: "practice" },
      seed,
      loaded({
        exerciseType: "lesson_choice",
        objectiveId: "english_grammar.present_simple.third_person_s",
        instructionPl: "Wybierz poprawną formę.",
        stem: "She ___ football.",
        options: [
          { id: "a", text: "plays" },
          { id: "b", text: "play" },
        ],
        correctOption: "a",
        answer: "plays",
        acceptedAnswers: [],
        focus: ["plays"],
        answerLocale: subject.answerLocale,
        promptLocale: subject.promptLocale,
        ...payload,
      }),
      forTopic,
      subject,
    );
  }

  it("lesson_choice: correctOptionId wskazuje opcję o tekście poprawnej, a wybór tej opcji jest oceniony correct", () => {
    const task = choiceTask("seed-choice", {});
    const key = answerKeyOf(task);
    const options = task.prompt.kind === "lesson_choice" ? task.prompt.options : [];
    const correctRendered = options.find((o) => o.id === key.correctOptionId);

    expect(key.correctOptionId).toBeDefined();
    expect(correctRendered?.text).toBe("plays"); // opcja o ID "a"
    expect(evaluateChoice(key.correctOptionId!, key)).toBe(true);
  });

  it("lesson_choice: visualSubject przechodzi z payloadu do promptu dziecka", () => {
    const task = choiceTask("seed-visual", {
      objectiveId: "english_grammar.to_be.affirmative_forms",
      instructionPl: "Kto to jest? Wybierz.",
      stem: "___ is happy.",
      visualSubject: "girl",
      options: [
        { id: "a", text: "She" },
        { id: "b", text: "He" },
      ],
      answer: "She",
      focus: ["She"],
    }, subject.topics.find((t) => t.id === "to_be")!);
    expect(task.prompt.kind).toBe("lesson_choice");
    expect(task.prompt.kind === "lesson_choice" ? task.prompt.visualSubject : undefined).toBe("girl");
  });

  it("translation prompt is the Polish source and keeps answers private", () => {
    const task = materializeExercise(
      { independentCheck: false, reason: "practice" },
      "seed-translation",
      loaded({
        exerciseType: "lesson_open_answer",
        objectiveId: "english_grammar.present_simple.third_person_s",
        instructionPl: "Przetłumacz na angielski.",
        prompt: "Ona codziennie gra w piłkę.",
        answer: "She plays football every day.",
        acceptedAnswers: ["She plays football daily."],
        focus: ["plays"],
        answerLocale: "en-GB",
        promptLocale: "pl-PL",
      }),
      topic,
      subject,
    );
    expect(task.prompt).toMatchObject({ kind: "lesson_open_answer", prompt: "Ona codziennie gra w piłkę." });
    expect(JSON.stringify(task.prompt)).not.toContain("She plays football");
    expect(task.answerKey).toMatchObject({ answer: "She plays football every day." });
  });

  it("lesson_short_answer: correctOptionId wskazuje opcję o tekście poprawnej odpowiedzi", () => {
    const task = materializeExercise(
      { independentCheck: false, reason: "practice" },
      "seed-short",
      loaded({
        exerciseType: "lesson_short_answer",
        objectiveId: "english_grammar.present_simple.short_answers",
        prompt: "Czy ona gra?",
        options: [
          { id: "x", text: "Yes, she does" },
          { id: "y", text: "Yes, she do" },
        ],
        correctOption: "x",
        answer: "Yes, she does",
        acceptedAnswers: [],
        focus: ["does"],
        answerLocale: subject.answerLocale,
        promptLocale: subject.promptLocale,
      }),
      topic,
      subject,
    );

    const key = answerKeyOf(task);
    const options = task.prompt.kind === "lesson_short_answer" ? task.prompt.options : [];
    const correctRendered = options.find((o) => o.id === key.correctOptionId);

    expect(key.correctOptionId).toBeDefined();
    expect(correctRendered?.text).toBe("Yes, she does");
    expect(evaluateChoice(key.correctOptionId!, key)).toBe(true);
  });

  it("lesson_notice: correctOption=TEKST trafia w segment także w innym wariancie wielkości liter (normalizator przedmiotu)", () => {
    const task = materializeExercise(
      { independentCheck: false, reason: "practice" },
      "seed-notice",
      loaded({
        exerciseType: "lesson_notice",
        objectiveId: "english_grammar.present_simple.third_person_s",
        instructionPl: "Dotknij słowa z końcówką -s.",
        noticeSegments: [["She", "plays", "football."], ["They", "play", "too."]],
        correctOption: "Plays", // inna wielkość liter niż segment "plays" — zrównane normalizatorem
        answer: "plays",
        acceptedAnswers: [],
        focus: ["plays"],
        answerLocale: subject.answerLocale,
        promptLocale: subject.promptLocale,
      }),
      topic,
      subject,
    );

    const key = answerKeyOf(task);
    const segments = task.prompt.kind === "lesson_notice" ? task.prompt.segments.flat() : [];
    const correct = segments.find((s) => s.id === key.correctOptionId);

    expect(key.correctOptionId).toBeDefined();
    expect(correct?.text).toBe("plays");
  });
});
