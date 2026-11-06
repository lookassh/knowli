import { describe, expect, it } from "vitest";
import type { LessonExerciseDraft } from "../../types";
import { errorFixRegion } from "./present-continuous-exercise-rules";
import { presentContinuousV1 } from "./topics/present-continuous";
import { validateEnglishGrammarExercise } from "./validators";

type Objective = "affirmative" | "now_or_usually" | "negative" | "questions" | "ing_spelling" | "now_or_usually_more";

/** Id reguł zgłoszonych przez walidator przedmiotu w temacie Present Continuous (pusta lista = poprawne). */
function validate(ex: LessonExerciseDraft): string[] {
  return validateEnglishGrammarExercise(ex, presentContinuousV1).map((issue) => issue.rule);
}

function expectRule(ex: LessonExerciseDraft, rule: string): void {
  expect(validate(ex)).toContain(rule);
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
  ];
  it.each(ok)("%s", (_name, ex) => {
    expect(validate(ex)).toEqual([]);
  });

  const rejected: [string, LessonExerciseDraft, string][] = [
    ["inne zdanie (podmiot i dopełnienie)", pcErrorFix("affirmative", "He is playing football now.", "She is playing tennis now."), "grammar.pc_error_fix_region"],
    ["dwa odległe obszary różnicy", pcErrorFix("affirmative", "He is play football in the park now.", "He is playing football in the garden now."), "grammar.pc_error_fix_region"],
    ["obszar ze słowem bez zmian w środku", pcErrorFix("affirmative", "He is play football at the park now.", "He is playing football in the park now."), "grammar.pc_error_fix_kind"],
    ["cel 1: zmiana tylko podmiotu", pcErrorFix("affirmative", "Tom is playing now.", "Ola is playing now."), "grammar.pc_error_fix_kind"],
    ["cel 5: zła forma be (poza elementem celu)", pcErrorFix("ing_spelling", "He are swimming now.", "He is swimming now."), "grammar.pc_error_fix_kind"],
    ["cel 5: zła forma be przy -ing z klasy plain", pcErrorFix("ing_spelling", "He are playing now.", "He is playing now."), "grammar.pc_error_fix_kind"],
    ["cel 3: do/does → be bez formy -ing", pcErrorFix("negative", "He doesn't happy now.", "He isn't happy now."), "grammar.pc_error_fix_kind"],
    ["cel 1: inny czasownik", pcErrorFix("affirmative", "She is play now.", "She is reading now."), "grammar.pc_error_fix_kind"],
    ["cel 1: błąd pisowni należy do celu 5", pcErrorFix("affirmative", "He is jumpping now.", "He is jumping now."), "grammar.pc_error_fix_kind"],
    ["cel 5: brak -ing to nie błąd pisowni", pcErrorFix("ing_spelling", "He is swim now.", "He is swimming now."), "grammar.pc_error_fix_kind"],
    ["cel 5: inny czasownik", pcErrorFix("ing_spelling", "He is swiming now.", "He is running now."), "grammar.pc_error_fix_kind"],
    ["wariant odpowiedzi z innym obszarem", pcErrorFix("affirmative", "He playing now.", "He is playing now.", { acceptedAnswers: ["Tom is playing now."] }), "grammar.pc_error_fix_kind"],
    ["odpowiedź z formą be niezgodną z podmiotem", pcErrorFix("affirmative", "They playing now.", "They is playing now."), "grammar.pc_be_form_subject"],
  ];
  it.each(rejected)("%s", (_name, ex, rule) => {
    expectRule(ex, rule);
  });
});

/**
 * Ślepa ocena sondy (Task 18): zdanie z do/does przed formą -ing ma dwie poprawki („Tom doesn't
 * watching TV now.” → „Tom isn't watching TV now.” albo „Tom doesn't watch TV now.”), więc
 * `error_fix` z takim zdaniem jest odrzucany w każdym celu.
 */
describe("validatePresentContinuousExercise — do/does przed formą -ing w zdaniu z błędem", () => {
  const rejected: [string, LessonExerciseDraft][] = [
    ["cel 3: doesn't + -ing", pcErrorFix("negative", "Tom doesn't watching TV now.", "Tom isn't watching TV now.")],
    ["cel 3: don't + -ing", pcErrorFix("negative", "We don't playing football now.", "We aren't playing football now.")],
    ["cel 3: does not + -ing", pcErrorFix("negative", "He does not playing now.", "He is not playing now.")],
    ["cel 4: Does + podmiot + -ing", pcErrorFix("questions", "Does she reading now?", "Is she reading now?")],
    ["cel 4: Do + podmiot z rzeczownikiem + -ing", pcErrorFix("questions", "Do the boys playing now?", "Are the boys playing now?")],
    ["cel 4: What does + podmiot + doing", pcErrorFix("questions", "What does he doing?", "What is he doing?")],
    ["cel 1: does + -ing", pcErrorFix("affirmative", "He does playing now.", "He is playing now.")],
    ["cel 5: kolokacja po doesn't", pcErrorFix("ing_spelling", "She doesn't having lunch now.", "She isn't having lunch now.")],
    ["cel 6: doesn't + -ing przy „zwykle”", pcErrorFix("now_or_usually_more", "She doesn't watching TV on Mondays.", "She doesn't watch TV on Mondays.")],
  ];
  it.each(rejected)("%s", (_name, ex) => {
    expectRule(ex, "grammar.pc_error_fix_do_ing");
  });

  const ok: [string, LessonExerciseDraft][] = [
    ["cel 3: brak formy be przed „not” (odpowiedź z isn't)", pcErrorFix("negative", "Tom not watching TV now.", "Tom isn't watching TV now.")],
    ["cel 6: zamiana czasu z doesn't + forma podstawowa", pcErrorFix("now_or_usually_more", "Look! Ola doesn't sleep.", "Look! Ola isn't sleeping.")],
  ];
  it.each(ok)("%s", (_name, ex) => {
    expect(validate(ex)).toEqual([]);
  });

  it("forma -ing po innym czasowniku po do/does (go swimming) nie jest tym błędem", () => {
    expect(validate(pcErrorFix("now_or_usually_more", "Ola don't go swimming on Mondays.", "Ola doesn't go swimming on Mondays."))).not.toContain("grammar.pc_error_fix_do_ing");
  });
});

describe("validatePresentContinuousExercise — „Wskaż słowo”", () => {
  it("jedna forma -ing równa correctOption; „morning” nie jest formą -ing", () => {
    expect(validate(pcNotice([["Tom", "is", "playing", "now."], ["Good", "morning!"]], "playing"))).toEqual([]);
  });

  it("dwie formy -ing", () => {
    expectRule(pcNotice([["Tom", "is", "playing", "now."], ["Ola", "is", "reading."]], "playing"), "grammar.pc_notice_ing_count");
    expectRule(pcNotice([["Tom", "is", "playing", "now."], ["Ola", "is", "playing."]], "playing"), "grammar.pc_notice_ing_count");
  });

  it("znak interpunkcji przy słowie do wskazania", () => {
    expect(validate(pcNotice([["Tom", "is", "playing!"]], "playing"))).toEqual([]);
  });

  it("forma -ing z kolokacji liczy się jak forma z tabeli", () => {
    expectRule(pcNotice([["Tom", "is", "playing", "now."], ["Mum", "is", "having", "lunch."]], "playing"), "grammar.pc_notice_ing_count");
  });

  it("correctOption inne niż jedyna forma -ing albo brak formy -ing", () => {
    expectRule(pcNotice([["Tom", "is", "playing", "now."], ["Good", "morning!"]], "is"), "grammar.pc_notice_target");
    expectRule(pcNotice([["Tom", "is", "here", "now."], ["Good", "morning!"]], "morning"), "grammar.pc_notice_ing_count");
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

  it("opcje spoza par is / are, isn't / aren't", () => {
    expectRule(pcListenChoice("affirmative", "___ playing football now.", "He's", "He"), "grammar.pc_listen_choice_options");
    expectRule(pcListenChoice("negative", "She ___ sleeping now.", "isn't", "is"), "grammar.pc_listen_choice_options");
  });

  it("klucz niezgodny z podmiotem albo celem", () => {
    expectRule(pcListenChoice("negative", "She ___ sleeping now.", "aren't", "isn't"), "grammar.pc_be_form_subject");
    expectRule(pcListenChoice("affirmative", "The dogs ___ running now.", "is", "are"), "grammar.pc_be_form_subject");
  });
});
