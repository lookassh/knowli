import { describe, expect, it } from "vitest";
import type { LessonExerciseDraft } from "../../types";
import { solverView } from "../../agent/solver";
import { validatePool } from "../../pool-validation";
import { englishGrammarSubject } from "./module";
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
    ["affirmative", "The cat and the dog ___ (sleep) now.", "are sleeping"],
    ["affirmative", "Tom and his sister ___ (play) now.", "are playing"],
    ["affirmative", "Look! The cat and the dog ___ (sleep).", "are sleeping"],
    ["affirmative", "Mum is cooking and Dad ___ (read) now.", "is reading"],
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
    expectPrefix(pcGap("affirmative", "The cat and the dog ___ (sleep) now.", "is sleeping"), "pc-be:");
    expectPrefix(pcGap("affirmative", "Ola and her mum ___ (cook) now.", "is cooking"), "pc-be:");
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

  it("luka z czasownikiem obejmuje całą formę — be albo do/does przed luką w tym samym zdaniu (pc-shape:)", () => {
    expectPrefix(pcGap("questions", "Is she ___ (read) a book?", "is reading"), "pc-shape:");
    expectPrefix(pcGap("affirmative", "She is ___ (play) now.", "is playing"), "pc-shape:");
    expectPrefix(pcGap("negative", "She isn't ___ (not watch) TV now.", "isn't watching"), "pc-shape:");
    expectPrefix(pcGap("now_or_usually_more", "She doesn't ___ (not watch) TV every morning.", "doesn't watch"), "pc-shape:");
    expectPrefix(pcGap("affirmative", "I'm ___ (play) now.", "am playing"), "pc-shape:");
    expectPrefix(pcGap("affirmative", "Look! Mum is cooking and Dad is ___ (read).", "is reading"), "pc-shape:");
  });

  it("forma be w poprzednim zdaniu albo zdaniu składowym nie blokuje luki z czasownikiem", () => {
    expect(validate(pcGap("affirmative", "Mum is cooking and Dad ___ (read) now.", "is reading"))).toEqual([]);
    expect(validate(pcGap("affirmative", "Look! Mum is cooking. Dad ___ (read) now.", "is reading"))).toEqual([]);
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

  it("przeczenie w luce na formę be tylko w celu 3 albo po „No”, bez podwójnego „not” (pc-be:)", () => {
    expectPrefix(pcGap("questions", "___ she reading a book?", "Isn't"), "pc-be:");
    expectPrefix(pcGap("questions", "She ___ reading now.", "isn't"), "pc-be:");
    expectPrefix(pcGap("negative", "She ___ not sleeping now.", "isn't"), "pc-be:");
    expect(validate(pcGap("questions", "Is she reading? No, she ___.", "isn't"))).toEqual([]);
    expect(validate(pcGap("negative", "She ___ not sleeping now.", "is"))).toEqual([]);
  });
});

/** Szkic ćwiczenia z całym zdaniem tematu Present Continuous. */
function pcSentence(
  exerciseType: LessonExerciseDraft["exerciseType"],
  objective: Objective,
  answer: string,
  extra: Partial<LessonExerciseDraft> = {},
): LessonExerciseDraft {
  return {
    exerciseType,
    objectiveId: `english_grammar.present_continuous.${objective}`,
    answer,
    acceptedAnswers: [],
    focus: [],
    ...extra,
  };
}

function pcChoice(objective: Objective, stem: string, correct: string, wrong: string): LessonExerciseDraft {
  return pcSentence("lesson_choice", objective, correct, {
    stem,
    options: [{ id: "a", text: correct }, { id: "b", text: wrong }],
    correctOption: "a",
  });
}

function pcOrder(objective: Objective, answer: string): LessonExerciseDraft {
  const words = answer.split(" ");
  return pcSentence("lesson_order", objective, answer, { items: words.map((text, index) => ({ id: `w${index}`, text })) });
}

function pcTransform(objective: Objective, transformId: string, statement: string, answer: string): LessonExerciseDraft {
  return pcSentence("lesson_transform", objective, answer, { statement, transformId });
}

function pcTranslation(objective: Objective, prompt: string, answer: string): LessonExerciseDraft {
  return pcSentence("lesson_open_answer", objective, answer, { prompt });
}

function pcShortAnswer(prompt: string, correct: string, wrong: string): LessonExerciseDraft {
  return pcSentence("lesson_short_answer", "questions", correct, {
    prompt,
    options: [{ id: "a", text: correct }, { id: "b", text: wrong }],
    correctOption: "a",
  });
}

describe("validatePresentContinuousExercise — całe zdania, poprawne", () => {
  const ok: [string, LessonExerciseDraft][] = [
    ["wybór w celu 1", pcChoice("affirmative", "Look! Mum ___ dinner.", "is cooking", "are cooking")],
    ["kolejność w celu 4 (What … doing?)", pcOrder("questions", "What is he doing?")],
    ["krótka odpowiedź w celu 4", pcShortAnswer("Is she reading?", "Yes, she is.", "No, she isn't.")],
    ["przekształcenie na przeczenie w celu 3", pcTransform("negative", "to_negative", "He is playing now.", "He isn't playing now.")],
    ["przekształcenie na pytanie w celu 4", pcTransform("questions", "to_question", "He is playing now.", "Is he playing now?")],
    ["tłumaczenie w celu 1", pcTranslation("affirmative", "Tata teraz gotuje obiad.", "Dad is cooking dinner now.")],
    ["pytanie z imieniem", pcOrder("questions", "Is Ola reading?")],
    ["pytanie z przeczeniem ze skrótem", pcOrder("questions", "Aren't they playing?")],
    ["pytanie z przeczeniem i imieniem", pcOrder("questions", "Isn't Ola reading now?")],
    ["What + podmiot w liczbie mnogiej + doing", pcOrder("questions", "What are the children doing?")],
    ["dwa zdania z różnymi podmiotami", pcTranslation("affirmative", "Teraz mama gotuje, a tata czyta.", "Mum is cooking and Dad is reading now.")],
    ["podmiot złożony w drugim zdaniu", pcTranslation("affirmative", "Teraz mama gotuje, a Tom i Ola grają.", "Mum is cooking and Tom and Ola are playing now.")],
    ["kolokacja „having lunch”", pcTranslation("affirmative", "Ona teraz je obiad.", "She is having lunch now.")],
    ["pisownia w celu 5", pcTranslation("ing_spelling", "On teraz pływa.", "He is swimming now.")],
    ["„What … doing?” z odpowiedzią pełnym zdaniem", pcShortAnswer("What are you doing?", "I am reading a book.", "I reading a book.")],
    ["krótka odpowiedź z luką po „No”", pcShortAnswer("Is she reading? No, she ___.", "isn't", "is")],
    ["wybór formy be przy -ing z bodźca (klasa sprawdzana tylko w kluczu)", pcChoice("affirmative", "The dogs ___ running now.", "are", "is")],
    ["wybór Is/Are przy imieniu", pcChoice("questions", "___ Ola reading a book?", "Is", "Are")],
    ["podmiot złożony z określnikami", pcTranslation("affirmative", "Kot i pies teraz śpią.", "The cat and the dog are sleeping now.")],
    ["podmiot złożony z zaimkiem dzierżawczym", pcTranslation("affirmative", "Tom i jego siostra teraz grają.", "Tom and his sister are playing now.")],
    ["podmiot złożony „The boy and the girl”", pcOrder("affirmative", "The boy and the girl are playing now.")],
    ["podmiot złożony „Ola and her mum”", pcOrder("affirmative", "Ola and her mum are cooking now.")],
    ["podmiot złożony „She and her friend”", pcOrder("affirmative", "She and her friend are playing now.")],
    ["podmiot złożony po „Look!”", pcTranslation("affirmative", "Patrz! Kot i pies śpią.", "Look! The cat and the dog are sleeping.")],
    ["wybór z podmiotem złożonym", pcChoice("affirmative", "The cat and the dog ___ now.", "are sleeping", "is sleeping")],
    ["wybór formy be bez dwuznaczności", pcSentence("lesson_choice", "questions", "Is", {
      stem: "___ she reading a book?",
      options: [{ id: "a", text: "Is" }, { id: "b", text: "Are" }, { id: "c", text: "Am" }],
      correctOption: "a",
    })],
    ["wybór po „No” z dystraktorem innej osoby", pcChoice("questions", "Is she reading? No, she ___.", "isn't", "aren't")],
    ["czasownik pogody", pcOrder("questions", "Is it raining now?")],
    ["czasownik pogody w wyborze", pcChoice("questions", "___ it snowing now?", "Is", "Are")],
  ];
  it.each(ok)("%s", (_name, ex) => {
    expect(validate(ex)).toEqual([]);
  });
});

describe("validatePresentContinuousExercise — całe zdania, odrzucone", () => {
  const rejected: [string, LessonExerciseDraft, string][] = [
    ["klucz z „He's”", pcTranslation("affirmative", "On teraz gra.", "He's playing now."), "pc-shape:"],
    ["klucz z „What's”", pcOrder("questions", "What's he doing?"), "pc-shape:"],
    ["pytanie z „Where”", pcOrder("questions", "Where is he going?"), "pc-shape:"],
    ["„What” bez „doing”", pcOrder("questions", "What is he eating?"), "pc-shape:"],
    ["pytanie z „Where” w bodźcu krótkiej odpowiedzi", pcShortAnswer("Where is he going?", "He is going to school.", "He going to school."), "pc-shape:"],
    ["hybryda „is plays”", pcTranslation("affirmative", "Ona teraz gra.", "She is plays now."), "pc-ing:"],
    ["forma bez -ing „is play”", pcOrder("affirmative", "She is play now."), "pc-ing:"],
    ["czasownik drop_e w celu 1", pcTranslation("affirmative", "On teraz pisze.", "He is writing now."), "pc-ing:"],
    ["czasownik plain w celu 5", pcTranslation("ing_spelling", "On teraz gra.", "He is playing now."), "pc-ing:"],
    ["„They is”", pcTranslation("affirmative", "Oni teraz grają.", "They is playing now."), "pc-be:"],
    ["„The dogs is”", pcTranslation("affirmative", "Psy teraz biegają.", "The dogs is running now."), "pc-be:"],
    ["„Are Ola”", pcOrder("questions", "Are Ola reading?"), "pc-be:"],
    ["„Isn't they”", pcOrder("questions", "Isn't they playing?"), "pc-be:"],
    ["brak formy be", pcTranslation("affirmative", "On teraz gra.", "He playing now."), "pc-be:"],
    ["to_negative z odpowiedzią twierdzącą", pcTransform("negative", "to_negative", "He is playing now.", "He is playing now!"), "pc-be:"],
    ["przeczenie w celu 1", pcOrder("affirmative", "He isn't playing now."), "pc-be:"],
    ["„Yes” z przeczeniem", pcShortAnswer("Is she reading?", "Yes, she isn't.", "No, she is."), "pc-be:"],
    ["osoba krótkiej odpowiedzi niezgodna z pytaniem", pcShortAnswer("Is she reading?", "Yes, he is.", "No, she isn't."), "pc-be:"],
    ["tłumaczenie bez wskaźnika", pcTranslation("affirmative", "Tata gotuje obiad.", "Dad is cooking dinner now."), "pc-marker:"],
    ["tłumaczenie ze wskaźnikiem „zwykle”", pcTranslation("affirmative", "Tata teraz zawsze gotuje obiad.", "Dad is cooking dinner now."), "pc-marker:"],
    ["wybór z kluczem z czasownikiem stanu", pcChoice("affirmative", "___", "I am liking it now.", "I like it now."), "pc-state:"],
    ["wybór z formą be niezgodną z podmiotem", pcChoice("affirmative", "The dogs ___ now.", "is running", "are running"), "pc-be:"],
    ["„The cat and the dog is”", pcOrder("affirmative", "The cat and the dog is sleeping now."), "pc-be:"],
    ["„Tom and his sister is”", pcTranslation("affirmative", "Tom i jego siostra teraz grają.", "Tom and his sister is playing now."), "pc-be:"],
    ["klucz z „Where's”", pcOrder("questions", "Where's he going?"), "pc-shape:"],
    ["klucz z „Who's”", pcOrder("questions", "Who's playing now?"), "pc-shape:"],
    ["wybór: klucz „Isn't” w celu 4 (twierdzenie też pasuje)", pcChoice("questions", "___ she reading a book?", "Isn't", "Is"), "pc-be:"],
    ["wybór: dystraktor „Isn't” do klucza „Is” (dwie poprawne)", pcChoice("questions", "___ she reading a book?", "Is", "Isn't"), "pc-be:"],
    ["wybór: podwójne przeczenie w celu 3", pcChoice("negative", "She ___ not sleeping now.", "isn't", "is"), "pc-be:"],
  ];
  it.each(rejected)("%s", (_name, ex, prefix) => {
    expectPrefix(ex, prefix);
  });

  it("wariant odpowiedzi z „there's” (pc-shape:)", () => {
    expectPrefix({ ...pcTranslation("affirmative", "Teraz pies biega.", "A dog is running now."), acceptedAnswers: ["There's a dog running now."] }, "pc-shape:");
  });

  it("czasownik stanu w kluczu wyboru daje tylko komunikat pc-state:", () => {
    const errors = validate(pcChoice("affirmative", "___", "I am liking it now.", "I like it now."));
    expect(errors.every((error) => error.startsWith("pc-state:")), JSON.stringify(errors)).toBe(true);
  });
});

/** Wybór „now / usually” (§5.5): bodziec bez wskaźnika, klucz z czasu zdania. */
function pcNowUsually(stem: string, key: "now" | "usually", extra: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return pcSentence("lesson_choice", "now_or_usually", key, {
    instructionPl: "Kiedy to się dzieje?",
    stem,
    options: [{ id: "a", text: key }, { id: "b", text: key === "now" ? "usually" : "now" }],
    correctOption: "a",
    ...extra,
  });
}

function pcErrorFix(objective: Objective, statement: string, answer: string): LessonExerciseDraft {
  return pcSentence("lesson_error_fix", objective, answer, { statement });
}

describe("validatePresentContinuousExercise — cele porównania (2 i 6), poprawne", () => {
  const ok: [string, LessonExerciseDraft][] = [
    ["cel 2: luka ze wskaźnikiem „zwykle”", pcGap("now_or_usually", "Ola ___ (read) a comic every evening.", "reads")],
    ["cel 2: luka po „Look!”", pcGap("now_or_usually", "Look! Ola ___ (read) a comic.", "is reading")],
    ["cel 2: okolicznik na początku zdania", pcGap("now_or_usually", "Every day Ola ___ (read) a comic.", "reads")],
    ["cel 2: podmiot złożony w Present Simple", pcGap("now_or_usually", "Every evening Mum and Dad ___ (watch) TV.", "watch")],
    ["cel 2: podmiot „Tom and Ola”", pcGap("now_or_usually", "Tom and Ola ___ (play) football every day.", "play")],
    ["cel 2: drugie zdanie składowe po Present Simple", pcGap("now_or_usually", "Mum cooks dinner and Dad ___ (read) every evening.", "reads")],
    ["cel 2: wybór na scence z polecenia", pcSentence("lesson_choice", "now_or_usually", "is sleeping", {
      instructionPl: "Cicho! Dziadek śpi.",
      stem: "Grandpa ___ in the armchair.",
      options: [{ id: "a", text: "sleeps" }, { id: "b", text: "is sleeping" }],
      correctOption: "b",
    })],
    ["cel 2: „now / usually” do zdania w Present Continuous", pcNowUsually("Ola is reading a book.", "now")],
    ["cel 2: „now / usually” do zdania w Present Simple", pcNowUsually("Ola reads books.", "usually")],
    ["cel 2: „now / usually” z poleceniem „Teraz czy zwykle?”", pcNowUsually("Ola reads books.", "usually", { instructionPl: "Teraz czy zwykle?" })],
    ["cel 2: kolokacja „having lunch”", pcTranslation("now_or_usually", "Ona teraz je obiad.", "She is having lunch now.")],
    ["cel 2: tłumaczenie w Present Simple", pcTranslation("now_or_usually", "Tata codziennie gotuje obiad.", "Dad cooks dinner every day.")],
    ["cel 2: poprawianie Present Simple na Present Continuous", pcErrorFix("now_or_usually", "Look! Ola reads.", "Look! Ola is reading.")],
    ["cel 2: poprawianie Present Continuous na Present Simple", pcErrorFix("now_or_usually", "Ola is reading every day.", "Ola reads every day.")],
    ["cel 6: poprawianie przeczenia", pcErrorFix("now_or_usually_more", "She isn't watching TV every morning.", "She doesn't watch TV every morning.")],
    ["cel 6: luka z przeczeniem w Present Simple", pcGap("now_or_usually_more", "She ___ (not watch) TV every morning.", "doesn't watch")],
    ["cel 6: luka z przeczeniem w Present Continuous", pcGap("now_or_usually_more", "She ___ (not watch) TV now.", "isn't watching")],
    ["cel 6: „am not” i klasa double", pcGap("now_or_usually_more", "I ___ (not swim) now.", "am not swimming")],
    ["cel 6: „don't” w liczbie mnogiej", pcGap("now_or_usually_more", "They ___ (not swim) on Sundays.", "don't swim")],
    ["cel 6: wybór pytania", pcSentence("lesson_choice", "now_or_usually_more", "Do you play football on Saturdays?", {
      instructionPl: "Wybierz poprawne pytanie.",
      options: [{ id: "a", text: "Do you play football on Saturdays?" }, { id: "b", text: "Are you playing football on Saturdays?" }],
      correctOption: "a",
    })],
    ["cel 6: wybór przeczenia w luce", pcChoice("now_or_usually_more", "She ___ TV every morning.", "doesn't watch", "isn't watching")],
    ["cel 6: tłumaczenie pytania", pcTranslation("now_or_usually_more", "Czy grasz teraz w piłkę?", "Are you playing football now?")],
  ];
  it.each(ok)("%s", (_name, ex) => {
    expect(validate(ex)).toEqual([]);
  });
});

describe("validatePresentContinuousExercise — cele porównania (2 i 6), odrzucone", () => {
  const rejected: [string, LessonExerciseDraft, string][] = [
    ["luka bez wskaźnika", pcGap("now_or_usually", "Ola ___ (read) a comic.", "reads"), "pc-marker:"],
    ["mieszane grupy wskaźników", pcGap("now_or_usually", "Look! Ola ___ (read) a comic every evening.", "is reading"), "pc-marker:"],
    ["Present Simple po „Look!”", pcGap("now_or_usually", "Look! Ola ___ (read).", "reads"), "pc-marker:"],
    ["Present Continuous przy „every evening”", pcGap("now_or_usually", "Ola ___ (read) a comic every evening.", "is reading"), "pc-marker:"],
    ["forma Present Simple niezgodna z osobą", pcGap("now_or_usually", "He ___ (play) every day.", "play"), "pc-be:"],
    ["forma Present Simple w liczbie mnogiej niezgodna z osobą", pcGap("now_or_usually", "Tom and Ola ___ (play) football every day.", "plays"), "pc-be:"],
    ["„now / usually” ze wskaźnikiem w bodźcu", pcNowUsually("Ola is reading now.", "now"), "pc-marker:"],
    ["„now / usually” z kluczem „usually” do zdania w Present Continuous", pcNowUsually("Ola is reading a book.", "usually"), "pc-marker:"],
    ["„now / usually” ze scenką w poleceniu", pcNowUsually("Ola is reading a book.", "now", { instructionPl: "Cicho! Ola czyta." }), "pc-marker:"],
    ["„now / usually” z pytaniem", pcNowUsually("Is Ola reading a book?", "now"), "pc-shape:"],
    ["klasa double w celu 2 (także przy Present Simple)", pcGap("now_or_usually", "He ___ (swim) every day.", "swims"), "pc-ing:"],
    ["cel 2: nawias z „not”", pcGap("now_or_usually", "He ___ (not play) football every day.", "doesn't play"), "pc-shape:"],
    ["cel 2: luka na formę be", pcGap("now_or_usually", "Look! Ola ___ reading.", "is"), "pc-shape:"],
    ["cel 6: luka na formę be", pcGap("now_or_usually_more", "Look! Ola ___ not reading.", "is"), "pc-shape:"],
    ["cel 2: wybór z pytaniem", pcChoice("now_or_usually", "___ Ola reading a comic now?", "Is", "Does"), "pc-shape:"],
    ["cel 6: luka z pytaniem", pcGap("now_or_usually_more", "___ you (play) tennis every Saturday?", "Do"), "pc-shape:"],
    ["cel 6: pytanie w „Ułóż zdanie”", pcOrder("now_or_usually_more", "Do you play football on Saturdays?"), "pc-shape:"],
    ["cel 2: czasownik stanu w dowolnej formie", pcTranslation("now_or_usually", "Ona codziennie lubi jabłka.", "She likes apples every day."), "pc-state:"],
    ["polecenie „Teraz czy zwykle?” (mieszane grupy)", pcGap("now_or_usually", "Ola ___ (read) a comic every evening.", "reads", { instructionPl: "Teraz czy zwykle?" }), "pc-marker:"],
    ["cel 2: poprawianie zmienia tylko podmiot", pcErrorFix("now_or_usually", "Look! Tom is reading.", "Look! Ola is reading."), "pc-error-fix:"],
    ["cel 2: poprawianie z kluczem w złym czasie", pcErrorFix("now_or_usually", "Look! Ola is reading.", "Look! Ola reads."), "pc-marker:"],
    ["cel 2: tłumaczenie w Present Continuous przy „codziennie”", pcTranslation("now_or_usually", "Ola czyta codziennie.", "Ola is reading every day."), "pc-marker:"],
    ["cel 6: przeczenie w Present Continuous przy „every morning”", pcGap("now_or_usually_more", "She ___ (not watch) TV every morning.", "isn't watching"), "pc-marker:"],
    ["cel 6: wybór pytania z operatorem niezgodnym z osobą", pcSentence("lesson_choice", "now_or_usually_more", "Does you play football on Saturdays?", {
      options: [{ id: "a", text: "Does you play football on Saturdays?" }, { id: "b", text: "Are you playing football on Saturdays?" }],
      correctOption: "a",
    }), "pc-be:"],
    ["wybór z dwoma poprawnymi opcjami", pcChoice("now_or_usually", "Look! Ola ___ a comic.", "is reading", "is drawing"), "pc-marker:"],
    ["dwa zdania składowe w różnych czasach", pcGap("now_or_usually", "Mum cooks dinner and Dad ___ (read) now.", "is reading"), "pc-marker:"],
  ];
  it.each(rejected)("%s", (_name, ex, prefix) => {
    expectPrefix(ex, prefix);
  });

  it("pytanie z luką w wyborze — tylko pc-shape: (pytania wyłącznie całymi zdaniami)", () => {
    const questions: LessonExerciseDraft[] = [
      pcChoice("now_or_usually_more", "___ you play football on Saturdays?", "Do", "Are"),
      pcChoice("now_or_usually_more", "___ she play football on Saturdays?", "Does", "Is"),
      pcChoice("now_or_usually_more", "___ you playing football now?", "Are", "Do"),
      pcChoice("now_or_usually_more", "What ___ you doing now?", "are", "do"),
      pcChoice("now_or_usually", "___ Ola read comics every evening", "Does", "Is"),
    ];
    for (const ex of questions) {
      const errors = validate(ex);
      expect(errors.length > 0 && errors.every((error) => error.startsWith("pc-shape:")), `${ex.stem}: ${JSON.stringify(errors)}`).toBe(true);
    }
  });

  it("drugie zdanie składowe po Present Simple: podmiot to tylko „Dad” (bez pc-be:)", () => {
    const errors = validate(pcGap("now_or_usually", "Mum cooks dinner and Dad ___ (read) now.", "is reading"));
    expect(errors.some((error) => error.startsWith("pc-be:")), JSON.stringify(errors)).toBe(false);
  });
});

describe("przypięte zachowanie poza walidatorem tematu", () => {
  it("widok checkera luki celu 2: scenka z polecenia i czasownik w nawiasie, bez podpowiedzi", () => {
    const gap = pcGap("now_or_usually", "Grandpa ___ (sleep) in the armchair.", "is sleeping", {
      instructionPl: "Cicho! Dziadek śpi.",
      hint: "play",
    });
    const view = solverView(gap, presentContinuousV1);
    expect(view).toContain("Cicho! Dziadek śpi.");
    expect(view).toContain("Grandpa ___ (sleep) in the armchair.");
    expect(view).not.toContain("play");
  });

  it("pula z wyborem i tłumaczeniem tego samego zdania przechodzi walidację (spec §6.3, świadomie)", () => {
    const choice: LessonExerciseDraft = {
      ...pcChoice("affirmative", "Dad ___ dinner now.", "is cooking", "are cooking"),
      focus: ["is", "cooking"],
    };
    const translation: LessonExerciseDraft = {
      ...pcTranslation("affirmative", "Tata teraz gotuje obiad.", "Dad is cooking dinner now."),
      focus: ["is", "cooking"],
    };
    const result = validatePool([choice, translation], englishGrammarSubject, presentContinuousV1);
    expect(result.rejected).toEqual([]);
    expect(result.valid).toEqual([choice, translation]);
  });
});
