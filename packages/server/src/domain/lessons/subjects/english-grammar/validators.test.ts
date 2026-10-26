import { describe, expect, it } from "vitest";
import { validateEnglishGrammarExercise } from "./validators";
import { presentSimpleV1 } from "./topics/present-simple";
import { toBeV1 } from "./topics/to-be";
import { validateLessonExercise } from "../../pool-validation";
import { englishGrammarSubject } from "./module";
import type { LessonExerciseDraft } from "../../types";

/** Buduje szkic `lesson_gap` z czasownikiem w podpowiedzi (bezokolicznik) i odpowiedzią luki. */
function gap(hint: string, answer: string): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId: "english_grammar.present_simple.third_person_s",
    stem: "He ___ every day.",
    hint,
    answer,
    acceptedAnswers: [answer],
    focus: answer.split(" "),
  };
}

function contextualGap(
  objectiveId: string,
  stem: string,
  answer: string,
  hint?: string,
): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId,
    stem,
    ...(hint === undefined ? {} : { hint }),
    answer,
    acceptedAnswers: [],
    focus: answer.split(" "),
  };
}

describe("validateEnglishGrammarExercise — lesson_gap, forma czasownika w Present Simple", () => {
  it("akceptuje formę podstawową, +s, +es, y→ies, nieregularne", () => {
    const ok: [string, string][] = [
      ["play", "plays"],
      ["play", "play"],
      ["watch", "watches"],
      ["study", "studies"],
      ["go", "goes"],
      ["have", "has"],
      ["be", "is"],
      ["be", "are"],
      ["be", "am"],
      ["do", "does"],
    ];
    for (const [hint, answer] of ok) {
      expect(validateEnglishGrammarExercise(gap(hint, answer), presentSimpleV1)).toEqual([]);
    }
  });

  it("akceptuje formy z operatorem (doesn't play / does not play)", () => {
    expect(validateEnglishGrammarExercise(gap("play", "doesn't play"), presentSimpleV1)).toEqual([]);
    expect(validateEnglishGrammarExercise(gap("play", "does not play"), presentSimpleV1)).toEqual([]);
  });

  it("odrzuca błędne formy (plaies, played, watchs)", () => {
    expect(validateEnglishGrammarExercise(gap("play", "plaies"), presentSimpleV1).length).toBeGreaterThan(0);
    expect(validateEnglishGrammarExercise(gap("play", "played"), presentSimpleV1).length).toBeGreaterThan(0);
    expect(validateEnglishGrammarExercise(gap("watch", "watchs"), presentSimpleV1).length).toBeGreaterThan(0);
  });

  it("bez podpowiedzi (hint) nie dokłada reguły czasownika", () => {
    const noHint: LessonExerciseDraft = { ...gap("play", "plays"), hint: undefined };
    expect(validateEnglishGrammarExercise(noHint, presentSimpleV1)).toEqual([]);
  });
});

describe("validateEnglishGrammarExercise — lesson_gap, temat to_be", () => {
  const beGap = (objectiveId: string, stem: string, answer: string, hint?: string): LessonExerciseDraft => ({
    exerciseType: "lesson_gap",
    objectiveId,
    stem,
    ...(hint === undefined ? {} : { hint }),
    answer,
    acceptedAnswers: [],
    focus: answer.split(" "),
  });
  const AFF = "english_grammar.to_be.affirmative_forms";
  const NEG = "english_grammar.to_be.negative_forms";

  it.each([
    ["I ___ happy.", "am"],
    ["She ___ happy.", "is"],
    ["They ___ happy.", "are"],
    ["___ she happy?", "Is"],
    ["___ they ready?", "Are"],
  ])("akceptuje formę zgodną z podmiotem: %s → %s", (stem, answer) => {
    expect(validateEnglishGrammarExercise(beGap(AFF, stem, answer, "be"), toBeV1)).toEqual([]);
  });

  it.each([
    ["She is ___ happy.", "not"],
    ["She ___ happy.", "is not"],
    ["She ___ happy.", "isn't"],
    ["They ___ ready.", "aren't"],
    ["I ___ ready.", "am not"],
  ])("akceptuje przeczenie: %s → %s", (stem, answer) => {
    expect(validateEnglishGrammarExercise(beGap(NEG, stem, answer, "be"), toBeV1)).toEqual([]);
  });

  it.each([
    ["They ___ happy.", "is"],
    ["I ___ happy.", "is"],
    ["She ___ happy.", "are"],
    ["She ___ happy.", "does"],
    ["They ___ happy.", "do"],
    ["She ___ happy.", "plays"],
    ["I ___ happy.", "not"],
  ])("odrzuca formę niezgodną z podmiotem albo spoza „be”: %s → %s", (stem, answer) => {
    expect(validateEnglishGrammarExercise(beGap(AFF, stem, answer, "be"), toBeV1)).not.toEqual([]);
  });

  it("bez podpowiedzi poprawna forma nadal przechodzi", () => {
    expect(validateEnglishGrammarExercise(beGap(AFF, "We ___ happy.", "are"), toBeV1)).toEqual([]);
  });

  it.each([
    ["biegunowość: twierdzenie z przeczeniem", AFF, "She ___ happy.", "is not", "be"],
    ["biegunowość: przeczenie bez not", NEG, "She ___ happy.", "is", "be"],
    ["biegunowość: Yes z przeczeniem", "english_grammar.to_be.short_answers", "Yes, she ___.", "isn't", "be"],
    ["biegunowość: No bez przeczenia", "english_grammar.to_be.short_answers", "No, she ___.", "is", "be"],
    ["brak hint nadal sprawdza formę", AFF, "They ___ happy.", "is", undefined],
    ["podmiot rzeczownikowy l.mn.", AFF, "The dogs ___ happy.", "is", "be"],
    ["pytanie o this", "english_grammar.to_be.questions", "What ___ this?", "are", "be"],
    ["skrót z inną osobą niż podmiot", AFF, "She ___ happy.", "he's", "be"],
  ])("odrzuca: %s", (_name, objectiveId, stem, answer, hint) => {
    expect(validateEnglishGrammarExercise(beGap(objectiveId, stem, answer, hint), toBeV1)).not.toEqual([]);
  });

  it.each([
    ["podmiot złożony You and I", AFF, "You and I ___ happy.", "are", "be"],
    ["podmiot rzeczownikowy l.poj.", AFF, "The dog ___ happy.", "is", "be"],
    ["podmiot rzeczownikowy l.mn.", AFF, "The dogs ___ happy.", "are", "be"],
    ["pytanie o this", "english_grammar.to_be.questions", "What ___ this?", "is", "be"],
  ])("akceptuje: %s", (_name, objectiveId, stem, answer, hint) => {
    expect(validateEnglishGrammarExercise(beGap(objectiveId, stem, answer, hint), toBeV1)).toEqual([]);
  });

  it.each([
    ["pytanie Where z podmiotem po luce", AFF, "Where ___ the dogs?", "are"],
    ["pytanie How old z podmiotem po luce", AFF, "How old ___ your brothers?", "are"],
    ["konstrukcja There z podmiotem po luce", AFF, "There ___ two cats.", "are"],
    ["dopełnienie you nie jest podmiotem", AFF, "This ___ for you.", "is"],
    ["rzeczownik z dopełnieniem you", AFF, "The cake ___ for you.", "is"],
    ["podmiot przed porównaniem z you", AFF, "My brother ___ taller than you.", "is"],
    ["luka na początku zdania, skrót They're", AFF, "___ happy.", "They're"],
    ["luka na początku zdania, skrót I'm", AFF, "___ happy.", "I'm"],
  ])("akceptuje podmiot sąsiadujący z luką: %s", (_name, objectiveId, stem, answer) => {
    expect(validateEnglishGrammarExercise(beGap(objectiveId, stem, answer, "be"), toBeV1)).toEqual([]);
  });

  it.each([
    ["pytanie Where ze złą formą", AFF, "Where ___ the dogs?", "is"],
    ["pytanie o the dog z Are", "english_grammar.to_be.questions", "___ the dog happy?", "Are"],
    ["luka przed dogs ze skrótem She's", AFF, "___ dogs.", "She's"],
    ["This ze złą formą", AFF, "This ___ for you.", "are"],
  ])("odrzuca podmiot sąsiadujący z luką: %s", (_name, objectiveId, stem, answer) => {
    expect(validateEnglishGrammarExercise(beGap(objectiveId, stem, answer, "be"), toBeV1)).not.toEqual([]);
  });

  it.each([
    ["imię własne James kończące się na s", AFF, "James ___ happy.", "is"],
  ])("akceptuje: %s", (_name, objectiveId, stem, answer) => {
    expect(validateEnglishGrammarExercise(beGap(objectiveId, stem, answer, "be"), toBeV1)).toEqual([]);
  });

  it.each([
    ["przysłówek częstotliwości przed luką (she)", AFF, "She always ___ happy.", "is"],
    ["przysłówek częstotliwości przed luką (I)", AFF, "I always ___ tired.", "am"],
    ["przysłówek częstotliwości przed luką (we)", AFF, "We never ___ late.", "are"],
  ])("odrzuca zły szyk przysłówka: %s", (_name, objectiveId, stem, answer) => {
    expect(validateEnglishGrammarExercise(beGap(objectiveId, stem, answer, "be"), toBeV1)).not.toEqual([]);
  });

  it.each([
    ["choice z isn't dla podmiotu they", "isn't", false],
    ["choice z aren't dla podmiotu they", "aren't", true],
    ["choice z am not dla podmiotu they", "am not", false],
  ])("wielotokenowa forma w choice: %s", (_name, answer, valid) => {
    const ex: LessonExerciseDraft = {
      exerciseType: "lesson_choice",
      objectiveId: NEG,
      stem: "They ___ ready.",
      answer,
      acceptedAnswers: [],
      focus: [],
      options: [
        { id: "a", text: "isn't" },
        { id: "b", text: "aren't" },
      ],
      correctOption: answer === "aren't" ? "b" : "a",
    };
    const errors = validateEnglishGrammarExercise(ex, toBeV1);
    expect(errors.length === 0).toBe(valid);
  });

  it.each([
    ["odpowiedź he am do bodźca z luką", "he am", false],
    ["odpowiedź he is do bodźca z luką", "he is", true],
  ])("zgodność zaimka ze skrótu z formą: %s", (_name, answer, valid) => {
    const ex: LessonExerciseDraft = {
      exerciseType: "lesson_short_answer",
      objectiveId: "english_grammar.to_be.short_answers",
      prompt: "Is he ready? Yes, ___.",
      answer,
      acceptedAnswers: [],
      focus: [],
      options: [
        { id: "a", text: "he is" },
        { id: "b", text: "he am" },
      ],
      correctOption: valid ? "a" : "b",
    };
    const errors = validateEnglishGrammarExercise(ex, toBeV1);
    expect(errors.length === 0).toBe(valid);
  });

  it("odrzuca skrót I'm jako odpowiedź luki krótkiej odpowiedzi, pełna forma przechodzi", () => {
    const SHORT = "english_grammar.to_be.short_answers";
    expect(validateEnglishGrammarExercise(beGap(SHORT, "Yes, I ___.", "I'm", "be"), toBeV1)).not.toEqual([]);
    expect(validateEnglishGrammarExercise(beGap(SHORT, "Yes, I ___.", "am", "be"), toBeV1)).toEqual([]);
  });

  it.each(["is", "jest", "to be"])("odrzuca hint %s dla luki to_be (dozwolony tylko „be” albo brak)", (hint) => {
    expect(validateEnglishGrammarExercise(beGap(AFF, "She ___ happy.", "is", hint), toBeV1)).not.toEqual([]);
  });

  it("odrzuca błędny wariant akceptowany luki, nie tylko odpowiedź kanoniczną", () => {
    const ex: LessonExerciseDraft = {
      ...beGap(AFF, "She ___ happy.", "is", "be"),
      acceptedAnswers: ["are"],
    };
    expect(validateEnglishGrammarExercise(ex, toBeV1)).not.toEqual([]);
  });

  it.each([
    ["transform to_affirmative spod celu przeczeń jest poprawny", {
      exerciseType: "lesson_transform",
      objectiveId: NEG,
      statement: "She isn't happy.",
      transformId: "to_affirmative",
      answer: "She is happy.",
      acceptedAnswers: [],
      focus: ["is"],
    }, true],
    ["zdanie z podmiotem złożonym Tom and I", {
      exerciseType: "lesson_open_answer",
      objectiveId: AFF,
      prompt: "Tom i ja jesteśmy szczęśliwi.",
      answer: "Tom and I are happy.",
      acceptedAnswers: [],
      focus: ["are"],
    }, true],
    ["błąd w drugiej klauzuli po and", {
      exerciseType: "lesson_open_answer",
      objectiveId: AFF,
      prompt: "Tom jest szczęśliwy, a on jest smutny.",
      answer: "Tom is happy and he are sad.",
      acceptedAnswers: [],
      focus: ["are"],
    }, false],
    ["pytanie z podmiotem złożonym po inwersji", {
      exerciseType: "lesson_transform",
      objectiveId: "english_grammar.to_be.questions",
      statement: "He is happy.",
      transformId: "to_question",
      answer: "Is he and Tom happy?",
      acceptedAnswers: [],
      focus: ["Is", "he"],
    }, false],
  ] as const)("%s", (_name, ex, valid) => {
    const errors = validateEnglishGrammarExercise(ex as unknown as LessonExerciseDraft, toBeV1);
    expect(errors.length === 0).toBe(valid);
  });

  const shortAnswerCase = (prompt: string, answer: string, other: string) => ({
    exerciseType: "lesson_short_answer",
    objectiveId: "english_grammar.to_be.short_answers",
    prompt,
    answer,
    acceptedAnswers: [] as string[],
    focus: [] as string[],
    options: [
      { id: "a", text: answer },
      { id: "b", text: other },
    ],
    correctOption: "a",
  });

  it.each([
    ["krótka odpowiedź z perspektywą you na pytanie o you", shortAnswerCase("Are you ready?", "Yes, you are.", "Yes, I am."), false],
    ["twierdząca krótka odpowiedź nie może kończyć się skrótem I'm", shortAnswerCase("Are you ready?", "Yes, I'm.", "Yes, I am."), false],
    ["przecząca krótka odpowiedź ze skrótem I'm not jest poprawna", shortAnswerCase("Are you ready?", "No, I'm not.", "No, I am."), true],
    ["krótka odpowiedź you na pytanie Am I jest poprawna", shortAnswerCase("Am I late?", "Yes, you are.", "Yes, I am."), true],
  ] as const)("%s", (_name, ex, valid) => {
    const errors = validateEnglishGrammarExercise(ex as unknown as LessonExerciseDraft, toBeV1);
    expect(errors.length === 0).toBe(valid);
  });

  it.each([
    ["error_fix ze złą zgodnością w odpowiedzi", {
      exerciseType: "lesson_error_fix",
      objectiveId: AFF,
      statement: "She is happy.",
      answer: "She are happy.",
      acceptedAnswers: [],
      focus: ["are"],
    }],
    ["transform z do zamiast inwersji", {
      exerciseType: "lesson_transform",
      objectiveId: "english_grammar.to_be.questions",
      statement: "She is happy.",
      transformId: "to_question",
      answer: "Does she is happy?",
      acceptedAnswers: [],
      focus: ["Does"],
    }],
    ["open_answer ze złą zgodnością", {
      exerciseType: "lesson_open_answer",
      objectiveId: AFF,
      prompt: "Oni są szczęśliwi.",
      answer: "They is happy.",
      acceptedAnswers: [],
      focus: ["is"],
    }],
    ["choice z formą niezgodną z podmiotem w stem", {
      exerciseType: "lesson_choice",
      objectiveId: AFF,
      stem: "She ___ happy.",
      answer: "are",
      acceptedAnswers: [],
      focus: [],
      options: [
        { id: "a", text: "is" },
        { id: "b", text: "are" },
      ],
      correctOption: "b",
    }],
  ] as const)("odrzuca typ inny niż luka: %s", (_name, ex) => {
    expect(validateEnglishGrammarExercise(ex as LessonExerciseDraft, toBeV1)).not.toEqual([]);
  });
});

describe("temat to_be — reprezentatywne ćwiczenia przechodzą walidację puli", () => {
  const base = { acceptedAnswers: [] as string[], focus: [] as string[] };
  const exercises: LessonExerciseDraft[] = [
    {
      ...base,
      exerciseType: "lesson_choice",
      objectiveId: "english_grammar.to_be.affirmative_forms",
      stem: "She ___ happy.",
      answer: "is",
      options: [
        { id: "a", text: "am" },
        { id: "b", text: "is" },
        { id: "c", text: "are" },
      ],
      correctOption: "b",
    },
    {
      ...base,
      exerciseType: "lesson_gap",
      objectiveId: "english_grammar.to_be.affirmative_forms",
      stem: "They ___ happy.",
      hint: "be",
      answer: "are",
      focus: ["are"],
    },
    {
      ...base,
      exerciseType: "lesson_error_fix",
      objectiveId: "english_grammar.to_be.affirmative_forms",
      statement: "She are happy.",
      answer: "She is happy.",
      focus: ["is"],
    },
    {
      ...base,
      exerciseType: "lesson_transform",
      objectiveId: "english_grammar.to_be.questions",
      statement: "She is happy.",
      transformId: "to_question",
      answer: "Is she happy?",
      focus: ["Is", "she"],
    },
    {
      ...base,
      exerciseType: "lesson_transform",
      objectiveId: "english_grammar.to_be.negative_forms",
      statement: "They are ready.",
      transformId: "to_negative",
      answer: "They are not ready.",
      acceptedAnswers: [],
      focus: ["are", "not"],
    },
    {
      ...base,
      exerciseType: "lesson_short_answer",
      objectiveId: "english_grammar.to_be.short_answers",
      prompt: "Is she happy?",
      answer: "Yes, she is.",
      options: [
        { id: "a", text: "Yes, she is." },
        { id: "b", text: "Yes, she are." },
      ],
      correctOption: "a",
    },
    {
      ...base,
      exerciseType: "lesson_open_answer",
      objectiveId: "english_grammar.to_be.affirmative_forms",
      prompt: "Ona jest szczęśliwa.",
      answer: "She is happy.",
      acceptedAnswers: [],
      focus: ["is"],
    },
  ];

  it.each(exercises.map((ex) => [ex.exerciseType, ex] as const))("%s bez błędów", (_type, ex) => {
    expect(validateLessonExercise(ex, englishGrammarSubject, toBeV1)).toEqual([]);
  });
});

describe("validateEnglishGrammarExercise — inne typy", () => {
  it("typy inne niż luka → []", () => {
    const choice: LessonExerciseDraft = {
      exerciseType: "lesson_choice",
      objectiveId: "english_grammar.present_simple.third_person_s",
      stem: "He ___ football.",
      answer: "plays",
      acceptedAnswers: ["plays"],
      focus: ["plays"],
      options: [
        { id: "a", text: "play" },
        { id: "b", text: "plays" },
      ],
      correctOption: "b",
    };
    expect(validateEnglishGrammarExercise(choice, presentSimpleV1)).toEqual([]);
  });

  it.each([
    ["operator does not with base verb after gap", "english_grammar.present_simple.negative", "She ___ play tennis.", "does not", "do", true],
    ["contracted operator with base verb after gap", "english_grammar.present_simple.negative", "She ___ play tennis.", "doesn't", "do", true],
    ["operator before inflected verb", "english_grammar.present_simple.negative", "She ___ plays tennis.", "does not", "do", false],
    ["base-form objective accepts does + base verb", "english_grammar.present_simple.base_form_after_does", "___ she play tennis?", "does", "do", true],
    ["base-form objective rejects does + inflected verb", "english_grammar.present_simple.base_form_after_does", "___ she plays tennis?", "does", "do", false],
    ["main verb supplied in gap", "english_grammar.present_simple.third_person_s", "She ___ tennis.", "plays", "play", true],
    ["operator and main verb supplied in gap", "english_grammar.present_simple.negative", "She ___ tennis.", "doesn't play", "play", true],
    ["Polish verb hint", "english_grammar.present_simple.third_person_s", "She ___ tennis.", "plays", "grać", false],
  ] as const)("auxiliaryGapWithHintUsesCompletedSentence: %s", (_name, objectiveId, stem, answer, hint, valid) => {
    const errors = validateEnglishGrammarExercise(contextualGap(objectiveId, stem, answer, hint), presentSimpleV1);
    expect(errors.length === 0).toBe(valid);
  });

  it("accepts a short answer operator without requiring a main verb hint", () => {
    const shortAnswer: LessonExerciseDraft = {
      exerciseType: "lesson_gap",
      objectiveId: "english_grammar.present_simple.short_answers",
      stem: "Yes, he ___.",
      answer: "does",
      acceptedAnswers: [],
      focus: ["does"],
    };
    expect(validateEnglishGrammarExercise(shortAnswer, presentSimpleV1)).toEqual([]);
  });

  it.each([
    ["operator agrees with a different subject", "___ she play tennis?", "do", "do"],
    ["question operator must be followed by the base verb", "___ she plays tennis?", "does", "do"],
  ])("rejects an invalid question operator despite a lexical fallback: %s", (_name, stem, answer, hint) => {
    expect(validateEnglishGrammarExercise(contextualGap("english_grammar.present_simple.question", stem, answer, hint), presentSimpleV1)).not.toEqual([]);
  });

  it("checks question subject agreement when the optional hint is absent", () => {
    const invalid = contextualGap("english_grammar.present_simple.question", "___ she play tennis?", "do");
    expect(validateEnglishGrammarExercise(invalid, presentSimpleV1)).not.toEqual([]);
  });

  it("translationCannotUseCanonicalOrAcceptedAnswerAsStimulus", () => {
    const translated: LessonExerciseDraft = {
      exerciseType: "lesson_open_answer",
      objectiveId: "english_grammar.present_simple.third_person_s",
      prompt: "She plays football every day.",
      answer: "She plays football every day.",
      acceptedAnswers: ["SHE   PLAYS football every day!"],
      focus: ["plays"],
    };
    const errors = validateEnglishGrammarExercise(translated, presentSimpleV1);
    expect(errors.some((error) => /prompt.*answer|bodziec.*odpowiedzi/i.test(error))).toBe(true);
    const acceptedLeak = validateEnglishGrammarExercise({
      ...translated,
      prompt: "SHE PLAYS FOOTBALL EVERY DAY!",
      answer: "She plays football daily.",
      acceptedAnswers: ["She plays football every day."],
    }, presentSimpleV1);
    expect(acceptedLeak.some((error) => /prompt.*answer|bodziec.*odpowiedzi/i.test(error))).toBe(true);
  });
});
