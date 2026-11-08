import { describe, expect, it } from "vitest";
import { validateLessonExercise, validateLessonExerciseIssues, validatePool } from "../../pool-validation";
import { clip, messagesOf } from "../../rules/catalog";
import type { DynamicTopicData, LessonExerciseDraft } from "../../types";
import { englishChapterSubject } from "./module";
import { TRANSLATION_INSTRUCTION, validateChapterExercise, withTranslationInstruction } from "./validators";

const WEATHER = "english_chapter.ddeck.weather";
const WEARING = "english_chapter.ddeck.wearing";

const DATA: DynamicTopicData = {
  titlePl: "Unit 1",
  objectives: [
    {
      id: WEATHER,
      titlePl: "Pogoda",
      descriptionEn: "Weather words: raining, sunny, windy.",
      kind: "words",
      cards: [
        { title: "Słówka", body: "raining — pada deszcz\nsunny — słonecznie" },
        { title: "Jeszcze", body: "windy — wietrznie" },
      ],
    },
    {
      id: WEARING,
      titlePl: "Co mam na sobie?",
      descriptionEn: "Frame: I'm wearing (a) ...",
      kind: "frame",
      cards: [
        { title: "Wzór", body: "I'm wearing (a) …" },
        { title: "Przykład", body: "I'm wearing a coat. — Mam na sobie płaszcz." },
      ],
    },
  ],
};
const TOPIC = englishChapterSubject.buildDynamicTopic!(DATA);

/** Komunikaty dla rodzica z walidatora rozdziału (napisy sprzed katalogu reguł). */
const chapterMessages = (ex: LessonExerciseDraft) => messagesOf(validateChapterExercise(ex, TOPIC));

function choice(overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_choice",
    objectiveId: WEATHER,
    instructionPl: "Dziś pada deszcz. Wybierz słowo.",
    stem: "It's ___ today.",
    options: [
      { id: "a", text: "raining" },
      { id: "b", text: "sunny" },
    ],
    correctOption: "a",
    answer: "raining",
    acceptedAnswers: [],
    focus: [],
    ...overrides,
  };
}

function listen(overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_listen_choice",
    objectiveId: WEATHER,
    stem: "It's ___ today.",
    options: [
      { id: "a", text: "raining" },
      { id: "b", text: "sunny" },
    ],
    correctOption: "a",
    answer: "raining",
    acceptedAnswers: [],
    focus: ["raining"],
    ...overrides,
  };
}

function gap(overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId: WEATHER,
    instructionPl: "Dziś jest słonecznie. Wpisz brakujące słowo.",
    stem: "It's ___ today.",
    answer: "sunny",
    acceptedAnswers: [],
    focus: ["sunny"],
    ...overrides,
  };
}

function order(overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_order",
    objectiveId: WEARING,
    instructionPl: "Ułóż zdanie: Mam na sobie płaszcz.",
    items: [
      { id: "i1", text: "I'm" },
      { id: "i2", text: "wearing" },
      { id: "i3", text: "a" },
      { id: "i4", text: "coat" },
    ],
    answer: "I'm wearing a coat",
    acceptedAnswers: [],
    focus: [],
    ...overrides,
  };
}

function openAnswer(overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_open_answer",
    objectiveId: WEARING,
    instructionPl: TRANSLATION_INSTRUCTION,
    prompt: "Mam na sobie płaszcz.",
    answer: "I'm wearing a coat.",
    acceptedAnswers: [],
    focus: ["coat"],
    ...overrides,
  };
}

function cloze(overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_cloze",
    objectiveId: WEATHER,
    instructionPl: "Dziś pada deszcz. Jutro jest słonecznie. Uzupełnij tekst.",
    clozeText: "It's ___ today. Tomorrow it's ___.",
    gapAnswers: ["raining", "sunny"],
    extraWords: ["windy"],
    answer: "raining, sunny",
    acceptedAnswers: [],
    focus: [],
    ...overrides,
  };
}

describe("validateChapterExercise", () => {
  it("przepuszcza poprawny wybór, lukę, układankę, tekst z lukami i tłumaczenie — także w pełnej walidacji ćwiczenia", () => {
    for (const ex of [choice(), gap(), order(), cloze(), openAnswer()]) {
      expect(chapterMessages(ex), ex.exerciseType).toEqual([]);
      expect(validateLessonExercise(ex, englishChapterSubject, TOPIC), ex.exerciseType).toEqual([]);
    }
  });

  it("bank słów cloze bez dystraktora równoważnego odpowiedzi luki po rozwinięciu skrótu (#316)", () => {
    const ruleIds = (ex: LessonExerciseDraft) => validateLessonExerciseIssues(ex, englishChapterSubject, TOPIC).map((issue) => issue.rule);
    const contracted = cloze({ instructionPl: "Uzupełnij tekst.", clozeText: "It ___ windy. It's ___ today.", gapAnswers: ["isn't", "sunny"], extraWords: ["is not"] });
    expect(ruleIds(contracted)).toContain("cloze.bank_confusable");
    expect(ruleIds({ ...contracted, extraWords: ["raining"] })).not.toContain("cloze.bank_confusable");
  });

  it("wybór: answer to tekst poprawnej opcji, skrót równoważny przechodzi (#315)", () => {
    const ruleIds = (ex: LessonExerciseDraft) => validateLessonExerciseIssues(ex, englishChapterSubject, TOPIC).map((issue) => issue.rule);
    expect(ruleIds(choice({ correctOption: "b" }))).toContain("answer.correct_option_text");
    expect(ruleIds(choice({ options: [{ id: "a", text: "isn't" }, { id: "b", text: "is" }], stem: "It ___ raining.", answer: "is not" }))).not.toContain("answer.correct_option_text");
  });

  it("wymaga dokładnie jednej luki w zdaniu wyboru", () => {
    const stemErrors = (ex: LessonExerciseDraft) => chapterMessages(ex).filter((e) => e.startsWith("stem:"));
    expect(stemErrors(choice({ stem: "It's ____ and __ today." }))).toHaveLength(1);
    expect(stemErrors(choice({ stem: "It's sunny today." }))).toHaveLength(1);
    expect(stemErrors(choice({ stem: undefined }))).toHaveLength(1);
  });

  it("luka bez znacznika albo z dwoma odpada w walidacji ogólnej — jednym komunikatem", () => {
    const stemErrors = (ex: LessonExerciseDraft) => validateLessonExercise(ex, englishChapterSubject, TOPIC).filter((e) => e.startsWith("stem:"));
    expect(stemErrors(gap({ stem: "It's sunny today." }))).toHaveLength(1);
    expect(stemErrors(gap({ stem: "It's ___ and ___ today." }))).toHaveLength(1);
    // Przedmiot nie powiela reguły silnika dla luki.
    expect(validateChapterExercise(gap({ stem: "It's sunny today." }), TOPIC)).toEqual([]);
  });

  it("od etapu 5a nie sprawdza polskiego bodźca ani słów materiału: ogólne polecenie i słowo spoza rozdziału przechodzą", () => {
    const bare = choice({
      instructionPl: "Wybierz słowo.",
      options: [{ id: "a", text: "snowing" }, { id: "b", text: "sunny" }],
      answer: "snowing",
    });
    expect(validateChapterExercise(bare, TOPIC)).toEqual([]);
    expect(validateLessonExercise(bare, englishChapterSubject, TOPIC)).toEqual([]);
  });

  it("tłumaczenie wymaga niepustego polecenia (inaczej dziecko widzi tylko tytuł zagadnienia)", () => {
    const instructionErrors = (instructionPl: string | undefined) =>
      chapterMessages(openAnswer({ instructionPl })).filter((e) => e.startsWith("instructionPl:"));
    expect(instructionErrors(undefined)).toHaveLength(1);
    expect(instructionErrors("   ")).toHaveLength(1);
    expect(instructionErrors(TRANSLATION_INSTRUCTION)).toEqual([]);
  });

  it("odrzuca pole hint (bodziec jest w poleceniu, kartkówka usuwa hint)", () => {
    expect(chapterMessages(gap({ hint: "sun" })).some((e) => e.startsWith("hint:"))).toBe(true);
    expect(chapterMessages(choice({ hint: "pogoda" })).some((e) => e.startsWith("hint:"))).toBe(true);
  });

  it("odrzuca dwa klocki o tym samym tekście po normalizacji", () => {
    const twoA = order({
      instructionPl: "Ułóż zdanie: Mam na sobie czapkę i płaszcz.",
      items: [
        { id: "i1", text: "I'm" },
        { id: "i2", text: "wearing" },
        { id: "i3", text: "a" },
        { id: "i4", text: "hat" },
        { id: "i5", text: "and" },
        { id: "i6", text: "A" },
        { id: "i7", text: "coat" },
      ],
      answer: "I'm wearing a hat and a coat",
    });
    expect(chapterMessages(twoA).some((e) => e.startsWith("items:"))).toBe(true);
  });

  it("odpowiedź i wariant dłuższe niż 120 znaków odpadają w pełnej walidacji — jednym komunikatem", () => {
    const long = `I'm wearing a coat ${"a".repeat(121 - "I'm wearing a coat ".length)}`;
    expect([...long]).toHaveLength(121);
    const fieldErrors = (ex: LessonExerciseDraft, field: string) =>
      validateLessonExercise(ex, englishChapterSubject, TOPIC).filter((e) => e.startsWith(`${field}:`) && e.includes("120"));
    expect(fieldErrors(openAnswer({ answer: long }), "answer")).toHaveLength(1);
    expect(fieldErrors(openAnswer({ acceptedAnswers: [long] }), "acceptedAnswers")).toHaveLength(1);
    expect(validatePool([openAnswer({ answer: long })], englishChapterSubject, TOPIC).valid).toEqual([]);
    expect(validateLessonExercise(openAnswer({ answer: long.slice(0, 120) }), englishChapterSubject, TOPIC)).toEqual([]);
  });
});

describe("zgłoszenia reguł katalogu rozdziału", () => {
  const issuesOf = (ex: LessonExerciseDraft) => validateChapterExercise(ex, TOPIC);

  it("luka w zdaniu wyboru: reguła, pole i found z liczbą luk", () => {
    expect(issuesOf(choice({ stem: "It's ____ and __ today." }))).toEqual([
      expect.objectContaining({
        rule: "chapter.stem_single_gap",
        field: "stem",
        found: `stem ${clip("It's ____ and __ today.")} has 2 gaps, expected exactly one`,
      }),
    ]);
  });

  it("tłumaczenie bez polecenia, podpowiedź i powtórzony klocek mają własne reguły", () => {
    expect(issuesOf(openAnswer({ instructionPl: undefined }))).toEqual([
      expect.objectContaining({ rule: "chapter.translation_instruction_required", field: "instructionPl" }),
    ]);
    expect(issuesOf(gap({ hint: "sun" }))).toEqual([
      expect.objectContaining({ rule: "chapter.hint_not_allowed", field: "hint", found: `hint ${clip("sun")} is set, but this subject has no hints` }),
    ]);
    const twoA = order({
      instructionPl: "Ułóż zdanie: Mam na sobie kapelusz.",
      items: [{ id: "i1", text: "a" }, { id: "i2", text: "A" }, { id: "i3", text: "hat" }],
    });
    expect(issuesOf(twoA)).toEqual([
      expect.objectContaining({
        rule: "chapter.order_items_distinct",
        field: "items[1].text",
        found: `items[1] ${clip("A")} repeats items[0] ${clip("a")}`,
      }),
    ]);
  });
});

describe("withTranslationInstruction (oczyszczenie świeżego wyjścia modelu)", () => {
  it("tłumaczenie bez polecenia dostaje stałe „Przetłumacz na angielski.”, inne typy nie", () => {
    expect(TRANSLATION_INSTRUCTION).toBe("Przetłumacz na angielski.");
    const missing = openAnswer({ instructionPl: undefined });
    const own = openAnswer({ instructionPl: "Napisz po angielsku." });
    const otherType = gap({ instructionPl: undefined });
    expect([missing, openAnswer({ instructionPl: "  " }), own, otherType].map((ex) => withTranslationInstruction(ex).instructionPl)).toEqual([
      TRANSLATION_INSTRUCTION, TRANSLATION_INSTRUCTION, "Napisz po angielsku.", undefined,
    ]);
    // Uzupełnione tłumaczenie przechodzi walidację przedmiotu; wejście nie jest modyfikowane, zgodne wraca bez kopii.
    expect(validateChapterExercise(withTranslationInstruction(missing), TOPIC)).toEqual([]);
    expect(missing.instructionPl).toBeUndefined();
    expect(withTranslationInstruction(own)).toBe(own);
    expect(withTranslationInstruction(otherType)).toBe(otherType);
  });
});

describe("wybór ze słuchu w przedmiocie rozdziału", () => {
  it("nie wymaga polskiego bodźca w poleceniu — bodźcem jest nagranie", () => {
    expect(validateChapterExercise(listen(), TOPIC)).toEqual([]);
    expect(validateLessonExercise(listen(), englishChapterSubject, TOPIC)).toEqual([]);
  });

  it("polecenie, podpowiedź i pole obrazka są niedozwolone", () => {
    expect(validateLessonExercise(listen({ instructionPl: "Dziś pada deszcz. Wybierz słowo." }), englishChapterSubject, TOPIC)).not.toEqual([]);
    expect(validateChapterExercise(listen({ hint: "rain" }), TOPIC)).not.toEqual([]);
  });
});

