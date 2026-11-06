import { describe, expect, it } from "vitest";
import type { LessonExerciseDraft } from "../../types";
import { errorFixRegion } from "./present-continuous-exercise-rules";
import { presentContinuousV1 } from "./topics/present-continuous";
import { validateEnglishGrammarExercise } from "./validators";

type Objective = "affirmative" | "now_or_usually" | "negative" | "questions" | "ing_spelling" | "now_or_usually_more";

function validate(ex: LessonExerciseDraft): string[] {
  return validateEnglishGrammarExercise(ex, presentContinuousV1).map((issue) => issue.pl);
}

function expectPrefix(ex: LessonExerciseDraft, prefix: string): void {
  const errors = validate(ex);
  expect(errors.some((error) => error.startsWith(prefix)), `${prefix} w ${JSON.stringify(errors)}`).toBe(true);
}

function pcErrorFix(objective: Objective, statement: string, answer: string, extra: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft {
  return {
    exerciseType: "lesson_error_fix",
    objectiveId: `english_grammar.present_continuous.${objective}`,
    statement,
    answer,
    acceptedAnswers: [],
    focus: [],
    ...extra,
  };
}

function pcNotice(noticeSegments: readonly (readonly string[])[], correctOption: string): LessonExerciseDraft {
  return {
    exerciseType: "lesson_notice",
    objectiveId: "english_grammar.present_continuous.affirmative",
    noticeSegments,
    correctOption,
    answer: correctOption,
    acceptedAnswers: [],
    focus: [],
  };
}

function pcListenChoice(objective: Objective, stem: string, correct: string, wrong: string): LessonExerciseDraft {
  return {
    exerciseType: "lesson_listen_choice",
    objectiveId: `english_grammar.present_continuous.${objective}`,
    stem,
    options: [{ id: "a", text: correct }, { id: "b", text: wrong }],
    correctOption: "a",
    answer: correct,
    acceptedAnswers: [],
    focus: [],
  };
}

describe("errorFixRegion", () => {
  it("obszar między wspólnym prefiksem a sufiksem tokenów", () => {
    expect(errorFixRegion("He playing football now.", "He is playing football now.")).toEqual({ wrong: [], right: ["is"] });
    expect(errorFixRegion("She is play now.", "She is playing now.")).toEqual({ wrong: ["play"], right: ["playing"] });
    expect(errorFixRegion("He is swiming now.", "He is swimming now.")).toEqual({ wrong: ["swiming"], right: ["swimming"] });
  });

  it("rozwija skróty przed porównaniem (wybiera najmniejszy obszar z wariantów)", () => {
    expect(errorFixRegion("He's play now.", "He is playing now.")).toEqual({ wrong: ["play"], right: ["playing"] });
    expect(errorFixRegion("She isn't play now.", "She is not playing now.")).toEqual({ wrong: ["play"], right: ["playing"] });
  });

  it("null bez różnicy i przy obszarze dłuższym niż 3 tokeny", () => {
    expect(errorFixRegion("He is playing now.", "he is playing now")).toBeNull();
    expect(errorFixRegion("He's playing now.", "He is playing now.")).toBeNull();
    expect(errorFixRegion("He is playing football now.", "She is playing tennis now.")).toBeNull();
    expect(errorFixRegion("He is play football in the park now.", "He is playing football in the garden now.")).toBeNull();
  });
});

describe("validatePresentContinuousExercise — poprawianie błędu", () => {
  const ok: [string, LessonExerciseDraft][] = [
    ["cel 1: brak formy be", pcErrorFix("affirmative", "He playing football now.", "He is playing football now.")],
    ["cel 1: forma bez -ing po be", pcErrorFix("affirmative", "She is play now.", "She is playing now.")],
    ["cel 1: forma Present Simple po be", pcErrorFix("affirmative", "She is plays now.", "She is playing now.")],
    ["cel 1: kolokacja „having lunch”", pcErrorFix("affirmative", "She is have lunch now.", "She is having lunch now.")],
    ["cel 3: brak formy be przed „not”", pcErrorFix("negative", "He not playing now.", "He isn't playing now.")],
    ["cel 3: brak -ing w przeczeniu", pcErrorFix("negative", "They aren't play now.", "They aren't playing now.")],
    ["cel 4: brak -ing w pytaniu", pcErrorFix("questions", "Is she read now?", "Is she reading now?")],
    ["cel 5: pisownia -ing", pcErrorFix("ing_spelling", "He is swiming now.", "He is swimming now.")],
    ["cel 5: pisownia ie → y", pcErrorFix("ing_spelling", "The cat is lieing on the sofa now.", "The cat is lying on the sofa now.")],
    ["cel 1: zła forma be", pcErrorFix("affirmative", "He are playing now.", "He is playing now.")],
    ["cel 3: do/does zamiast formy be", pcErrorFix("negative", "He doesn't playing now.", "He isn't playing now.")],
    ["cel 4: do/does zamiast formy be w pytaniu", pcErrorFix("questions", "Does she reading now?", "Is she reading now?")],
  ];
  it.each(ok)("%s", (_name, ex) => {
    expect(validate(ex)).toEqual([]);
  });

  const rejected: [string, LessonExerciseDraft, string][] = [
    ["inne zdanie (podmiot i dopełnienie)", pcErrorFix("affirmative", "He is playing football now.", "She is playing tennis now."), "pc-error-fix:"],
    ["dwa odległe obszary różnicy", pcErrorFix("affirmative", "He is play football in the park now.", "He is playing football in the garden now."), "pc-error-fix:"],
    ["obszar ze słowem bez zmian w środku", pcErrorFix("affirmative", "He is play football at the park now.", "He is playing football in the park now."), "pc-error-fix:"],
    ["cel 1: zmiana tylko podmiotu", pcErrorFix("affirmative", "Tom is playing now.", "Ola is playing now."), "pc-error-fix:"],
    ["cel 5: zła forma be (poza elementem celu)", pcErrorFix("ing_spelling", "He are swimming now.", "He is swimming now."), "pc-error-fix:"],
    ["cel 5: zła forma be przy -ing z klasy plain", pcErrorFix("ing_spelling", "He are playing now.", "He is playing now."), "pc-error-fix:"],
    ["cel 1: do/does zamiast formy be (tylko cele 3 i 4)", pcErrorFix("affirmative", "He does playing now.", "He is playing now."), "pc-error-fix:"],
    ["cel 3: do/does → be bez formy -ing", pcErrorFix("negative", "He doesn't happy now.", "He isn't happy now."), "pc-error-fix:"],
    ["cel 1: inny czasownik", pcErrorFix("affirmative", "She is play now.", "She is reading now."), "pc-error-fix:"],
    ["cel 1: błąd pisowni należy do celu 5", pcErrorFix("affirmative", "He is jumpping now.", "He is jumping now."), "pc-error-fix:"],
    ["cel 5: brak -ing to nie błąd pisowni", pcErrorFix("ing_spelling", "He is swim now.", "He is swimming now."), "pc-error-fix:"],
    ["cel 5: inny czasownik", pcErrorFix("ing_spelling", "He is swiming now.", "He is running now."), "pc-error-fix:"],
    ["wariant odpowiedzi z innym obszarem", pcErrorFix("affirmative", "He playing now.", "He is playing now.", { acceptedAnswers: ["Tom is playing now."] }), "pc-error-fix:"],
    ["odpowiedź z formą be niezgodną z podmiotem", pcErrorFix("affirmative", "They playing now.", "They is playing now."), "pc-be:"],
  ];
  it.each(rejected)("%s", (_name, ex, prefix) => {
    expectPrefix(ex, prefix);
  });
});

describe("validatePresentContinuousExercise — „Wskaż słowo”", () => {
  it("jedna forma -ing równa correctOption; „morning” nie jest formą -ing", () => {
    expect(validate(pcNotice([["Tom", "is", "playing", "now."], ["Good", "morning!"]], "playing"))).toEqual([]);
  });

  it("dwie formy -ing (pc-notice:)", () => {
    expectPrefix(pcNotice([["Tom", "is", "playing", "now."], ["Ola", "is", "reading."]], "playing"), "pc-notice:");
    expectPrefix(pcNotice([["Tom", "is", "playing", "now."], ["Ola", "is", "playing."]], "playing"), "pc-notice:");
  });

  it("znak interpunkcji przy słowie do wskazania", () => {
    expect(validate(pcNotice([["Tom", "is", "playing!"]], "playing"))).toEqual([]);
  });

  it("forma -ing z kolokacji liczy się jak forma z tabeli (pc-notice:)", () => {
    expectPrefix(pcNotice([["Tom", "is", "playing", "now."], ["Mum", "is", "having", "lunch."]], "playing"), "pc-notice:");
  });

  it("correctOption inne niż jedyna forma -ing albo brak formy -ing (pc-notice:)", () => {
    expectPrefix(pcNotice([["Tom", "is", "playing", "now."], ["Good", "morning!"]], "is"), "pc-notice:");
    expectPrefix(pcNotice([["Tom", "is", "here", "now."], ["Good", "morning!"]], "morning"), "pc-notice:");
  });
});

describe("validatePresentContinuousExercise — „Posłuchaj i wybierz”", () => {
  const ok: [string, LessonExerciseDraft][] = [
    ["cel 3: isn't / aren't", pcListenChoice("negative", "She ___ sleeping now.", "isn't", "aren't")],
    ["cel 1: is / are", pcListenChoice("affirmative", "The dogs ___ running now.", "are", "is")],
    ["cel 4: Is / Are", pcListenChoice("questions", "___ they playing now?", "Are", "Is")],
  ];
  it.each(ok)("%s", (_name, ex) => {
    expect(validate(ex)).toEqual([]);
  });

  it("opcje spoza par is / are, isn't / aren't (pc-shape:)", () => {
    expectPrefix(pcListenChoice("affirmative", "___ playing football now.", "He's", "He"), "pc-shape:");
    expectPrefix(pcListenChoice("negative", "She ___ sleeping now.", "isn't", "is"), "pc-shape:");
  });

  it("klucz niezgodny z podmiotem albo celem (pc-be:)", () => {
    expectPrefix(pcListenChoice("negative", "She ___ sleeping now.", "aren't", "isn't"), "pc-be:");
    expectPrefix(pcListenChoice("affirmative", "The dogs ___ running now.", "is", "are"), "pc-be:");
  });
});
