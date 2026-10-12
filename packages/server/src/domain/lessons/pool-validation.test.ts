import { describe, expect, it } from "vitest";
import {
  GAP_MARKER,
  MAX_ACCEPTED_ANSWERS,
  MAX_OPTIONS,
  MAX_ORDER_ITEMS,
  MAX_TEXT_LENGTH,
  MIN_OPTIONS,
  MIN_ORDER_ITEMS,
  findDuplicateAnswers,
  poolCoverage,
  validateLessonExercise,
  validatePool,
} from "./pool-validation";
import { englishGrammarSubject } from "./subjects/english-grammar/module";
import { historyLikeSubject } from "./testing/history-like-subject";
import type { LessonExerciseDraft, LessonTopic, SubjectModule } from "./types";
import { stageOf } from "./stages";

const englishTopic = englishGrammarSubject.topics[0]!;
const historyTopic = historyLikeSubject.topics[0]!;

const OBJ = {
  affirmative: "english_grammar.present_simple.affirmative_base",
  thirdPerson: "english_grammar.present_simple.third_person_s",
  negative: "english_grammar.present_simple.negative",
  spelling: "english_grammar.present_simple.spelling_es_ies",
} as const;

/** Bazowy poprawny szkic danego typu dla celu angielskiego (nadpisywany w testach). */
function draft(overrides: Partial<LessonExerciseDraft>): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId: OBJ.thirdPerson,
    answer: "plays",
    acceptedAnswers: [],
    focus: ["plays"],
    stem: `She ${GAP_MARKER} tennis.`,
    hint: "play",
    ...overrides,
  };
}

describe("validateLessonExercise — cel i typ", () => {
  it("odrzuca cel spoza tematu", () => {
    const errors = validateLessonExercise(
      draft({ objectiveId: "english_grammar.present_simple.nieistniejacy" }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes("cel"))).toBe(true);
  });

  it("przyjmuje istniejący cel i dozwolony typ", () => {
    expect(validateLessonExercise(draft({}), englishGrammarSubject, englishTopic)).toEqual([]);
  });

  it("odrzuca typ niedozwolony dla celu", () => {
    // affirmative_base nie wspiera lesson_error_fix
    const errors = validateLessonExercise(
      draft({
        objectiveId: OBJ.affirmative,
        exerciseType: "lesson_error_fix",
        statement: "I plays football.",
        answer: "I play football",
        focus: ["play"],
        stem: undefined,
        hint: undefined,
      }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes("typ"))).toBe(true);
  });

  it("odrzuca lesson_card jako ćwiczenie puli", () => {
    const errors = validateLessonExercise(
      draft({ exerciseType: "lesson_card", stem: undefined, hint: undefined, focus: [] }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes("lesson_card"))).toBe(true);
  });
});

describe("validateLessonExercise — focus", () => {
  it("odrzuca pusty focus dla typu tekstowego", () => {
    const errors = validateLessonExercise(draft({ focus: [] }), englishGrammarSubject, englishTopic);
    expect(errors.some((e) => e.toLowerCase().includes("focus"))).toBe(true);
  });

  it("odrzuca focus niebędący podsekwencją tokenów odpowiedzi", () => {
    const errors = validateLessonExercise(
      draft({ focus: ["runs"] }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.toLowerCase().includes("focus"))).toBe(true);
  });

  it("przyjmuje focus dopasowany przez wariant normalizacji (skrót rozwinięty)", () => {
    // doesn't ≡ does not — focus „does not” jest podsekwencją rozwiniętego wariantu
    const ex = draft({
      objectiveId: OBJ.negative,
      exerciseType: "lesson_open_answer",
      prompt: "Napisz przeczenie.",
      answer: "she doesn't like tea",
      focus: ["does", "not"],
      stem: undefined,
      hint: undefined,
    });
    expect(validateLessonExercise(ex, englishGrammarSubject, englishTopic)).toEqual([]);
  });

  it("działa z fixture bez skrótów (focus podsekwencją)", () => {
    const ex = draft({
      objectiveId: historyTopic.objectives[0]!.id,
      exerciseType: "lesson_open_answer",
      prompt: "Kiedy był chrzest Polski?",
      answer: "w 966 roku",
      focus: ["966"],
      stem: undefined,
      hint: undefined,
    });
    expect(validateLessonExercise(ex, historyLikeSubject, historyTopic)).toEqual([]);
  });
});

describe("validateLessonExercise — lesson_order", () => {
  function orderDraft(items: readonly string[], answer: string): LessonExerciseDraft {
    return {
      exerciseType: "lesson_order",
      objectiveId: "english_grammar.present_simple.question",
      answer,
      acceptedAnswers: [],
      focus: ["does"],
      items: items.map((text, i) => ({ id: `i${i}`, text })),
    };
  }

  it("przyjmuje 3–10 elementów złączonych w odpowiedź", () => {
    expect(
      validateLessonExercise(
        orderDraft(["Does", "she", "play"], "Does she play"),
        englishGrammarSubject,
        englishTopic,
      ),
    ).toEqual([]);
  });

  it("odrzuca mniej niż 3 elementy", () => {
    const errors = validateLessonExercise(
      orderDraft(["Does", "she"], "Does she"),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes(String(MIN_ORDER_ITEMS)))).toBe(true);
  });

  it("odrzuca więcej niż 10 elementów", () => {
    const many = Array.from({ length: MAX_ORDER_ITEMS + 1 }, (_, i) => `w${i}`);
    const errors = validateLessonExercise(
      orderDraft(many, many.join(" ")),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes(String(MAX_ORDER_ITEMS)))).toBe(true);
  });

  it("odrzuca gdy złączone elementy nie dają odpowiedzi", () => {
    const errors = validateLessonExercise(
      orderDraft(["Does", "she", "play"], "Does he play"),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("validateLessonExercise — opcje (choice/short_answer/notice)", () => {
  function choiceDraft(opts: readonly string[], correct: string): LessonExerciseDraft {
    return {
      exerciseType: "lesson_choice",
      objectiveId: OBJ.thirdPerson,
      answer: "plays",
      acceptedAnswers: [],
      focus: ["plays"],
      prompt: "Wybierz formę.",
      options: opts.map((text, i) => ({ id: `o${i}`, text })),
      correctOption: correct,
    };
  }

  it("przyjmuje 2–4 unikalne opcje z poprawną wśród nich", () => {
    expect(
      validateLessonExercise(choiceDraft(["plays", "play"], "o0"), englishGrammarSubject, englishTopic),
    ).toEqual([]);
  });

  it("odrzuca mniej niż 2 opcje", () => {
    const errors = validateLessonExercise(
      choiceDraft(["plays"], "o0"),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes(String(MIN_OPTIONS)))).toBe(true);
  });

  it("odrzuca więcej niż 4 opcje", () => {
    const errors = validateLessonExercise(
      choiceDraft(["a", "b", "c", "d", "e"], "o0"),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes(String(MAX_OPTIONS)))).toBe(true);
  });

  it("odrzuca opcje nieunikalne po normalizacji", () => {
    const errors = validateLessonExercise(
      choiceDraft(["plays", "Plays"], "o0"),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("odrzuca correctOption spoza opcji", () => {
    const errors = validateLessonExercise(
      choiceDraft(["plays", "play"], "oX"),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.toLowerCase().includes("correctoption") || e.includes("poprawn"))).toBe(
      true,
    );
  });
});

describe("validateLessonExercise — lesson_gap", () => {
  it("odrzuca brak znacznika luki w stem", () => {
    const errors = validateLessonExercise(
      draft({ stem: "She plays tennis." }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes("luk"))).toBe(true);
  });

  it("odrzuca więcej niż jeden znacznik luki", () => {
    const errors = validateLessonExercise(
      draft({ stem: `${GAP_MARKER} ${GAP_MARKER}` }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes("luk"))).toBe(true);
  });

  it("odrzuca odpowiedź luki dłuższą niż 3 tokeny", () => {
    const errors = validateLessonExercise(
      draft({
        objectiveId: OBJ.negative,
        answer: "she does not play",
        focus: ["does", "not", "play"],
      }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes("3"))).toBe(true);
  });

  it("odrzuca gdy odpowiedź luki nie pokrywa się z focus", () => {
    const errors = validateLessonExercise(
      draft({ answer: "plays", focus: ["she"], stem: `She ${GAP_MARKER}.` }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("validateLessonExercise — error_fix i transform", () => {
  it("odrzuca lesson_error_fix gdy statement == odpowiedź po normalizacji", () => {
    const errors = validateLessonExercise(
      {
        exerciseType: "lesson_error_fix",
        objectiveId: OBJ.spelling,
        answer: "she goes",
        acceptedAnswers: [],
        focus: ["goes"],
        statement: "She goes.",
      },
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes("statement"))).toBe(true);
  });

  it("przyjmuje lesson_error_fix gdy statement różny od odpowiedzi", () => {
    expect(
      validateLessonExercise(
        {
          exerciseType: "lesson_error_fix",
          objectiveId: OBJ.spelling,
          answer: "she goes",
          acceptedAnswers: [],
          focus: ["goes"],
          statement: "She go.",
        },
        englishGrammarSubject,
        englishTopic,
      ),
    ).toEqual([]);
  });

  it("odrzuca lesson_transform z nieistniejącym transformId", () => {
    const errors = validateLessonExercise(
      {
        exerciseType: "lesson_transform",
        objectiveId: OBJ.negative,
        answer: "she doesn't play",
        acceptedAnswers: [],
        focus: ["does", "not"],
        statement: "She plays.",
        transformId: "nieistnieje",
      },
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes("transformId"))).toBe(true);
  });

  it("przyjmuje lesson_transform z istniejącym transformId", () => {
    expect(
      validateLessonExercise(
        {
          exerciseType: "lesson_transform",
          objectiveId: OBJ.negative,
          answer: "she doesn't play",
          acceptedAnswers: [],
          focus: ["does", "not"],
          statement: "She plays.",
          transformId: "to_negative",
        },
        englishGrammarSubject,
        englishTopic,
      ),
    ).toEqual([]);
  });
});

describe("validateLessonExercise — długości i acceptedAnswers", () => {
  it("odrzuca pole tekstowe dłuższe niż limit", () => {
    const errors = validateLessonExercise(
      draft({ prompt: "a".repeat(MAX_TEXT_LENGTH + 1) }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes(String(MAX_TEXT_LENGTH)))).toBe(true);
  });

  it("odrzuca więcej niż limit acceptedAnswers", () => {
    const errors = validateLessonExercise(
      draft({ acceptedAnswers: Array.from({ length: MAX_ACCEPTED_ANSWERS + 1 }, (_, i) => `v${i}`) }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes(String(MAX_ACCEPTED_ANSWERS)))).toBe(true);
  });

  it("odrzuca pusty wariant w acceptedAnswers", () => {
    const errors = validateLessonExercise(
      draft({ acceptedAnswers: ["  "] }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("odrzuca wariant duplikujący odpowiedź kanoniczną po normalizacji", () => {
    const errors = validateLessonExercise(
      draft({ acceptedAnswers: ["Plays"] }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("validateLessonExercise — delegacja do subject.validateExercise", () => {
  it("dokłada błędy zwrócone przez przedmiot", () => {
    const fakeSubject: SubjectModule = {
      ...historyLikeSubject,
      validateExercise: () => ["Błąd przedmiotu: X"],
    };
    const ex = draft({
      objectiveId: historyTopic.objectives[0]!.id,
      exerciseType: "lesson_gap",
      answer: "966",
      focus: ["966"],
      stem: `Chrzest w ${GAP_MARKER} roku.`,
      hint: undefined,
    });
    const errors = validateLessonExercise(ex, fakeSubject, historyTopic);
    expect(errors).toContain("Błąd przedmiotu: X");
  });

  it("prawdziwy walidator angielskiego odrzuca złą formę luki", () => {
    const errors = validateLessonExercise(
      draft({ answer: "played", focus: ["played"], hint: "play", stem: `She ${GAP_MARKER}.` }),
      englishGrammarSubject,
      englishTopic,
    );
    expect(errors.some((e) => e.includes("Present Simple"))).toBe(true);
  });
});

describe("findDuplicateAnswers", () => {
  it("grupuje odpowiedzi o wspólnym wariancie normalizacji", () => {
    const exercises: LessonExerciseDraft[] = [
      draft({ answer: "she plays" }),
      draft({ answer: "She  Plays" }),
      draft({ answer: "he runs" }),
    ];
    const groups = findDuplicateAnswers(exercises, englishGrammarSubject);
    expect(groups.length).toBe(1);
    expect(groups[0]!.length).toBe(2);
  });

  it("wykrywa duplikat przez skrót (doesn't ≡ does not)", () => {
    const exercises: LessonExerciseDraft[] = [
      draft({ objectiveId: OBJ.negative, answer: "she doesn't play", focus: ["does", "not"] }),
      draft({ objectiveId: OBJ.negative, answer: "she does not play", focus: ["does", "not"] }),
    ];
    const groups = findDuplicateAnswers(exercises, englishGrammarSubject);
    expect(groups.length).toBe(1);
  });

  it("zwraca pustą tablicę bez duplikatów", () => {
    const exercises: LessonExerciseDraft[] = [draft({ answer: "she plays" }), draft({ answer: "he runs" })];
    expect(findDuplicateAnswers(exercises, englishGrammarSubject)).toEqual([]);
  });
});

describe("validatePool", () => {
  it("odrzuca pojedyncze niepoprawne, zachowuje poprawne", () => {
    const good = draft({ answer: "plays", focus: ["plays"] });
    const bad = draft({ answer: "plays", focus: ["runs"] }); // focus nie w odpowiedzi
    const result = validatePool([good, bad], englishGrammarSubject, englishTopic);
    expect(result.valid).toContain(good);
    expect(result.rejected.some((r) => r.exercise === bad)).toBe(true);
  });

  it("przy duplikacie zachowuje pierwszy, odrzuca kolejne", () => {
    const first = draft({ answer: "plays" });
    const dup = draft({ answer: "Plays" });
    const result = validatePool([first, dup], englishGrammarSubject, englishTopic);
    expect(result.valid).toContain(first);
    expect(result.valid).not.toContain(dup);
    expect(result.rejected.some((r) => r.exercise === dup)).toBe(true);
  });
});

describe("poolCoverage", () => {
  const minimums = { guided: 1, productive: 1, independent: 1 };

  function typed(type: LessonExerciseDraft["exerciseType"], objectiveId: string): LessonExerciseDraft {
    return draft({
      exerciseType: type,
      objectiveId,
      stem: type === "lesson_gap" ? `x ${GAP_MARKER}` : undefined,
      hint: undefined,
    });
  }

  it("pusta tablica gdy pokrycie spełnione", () => {
    const exercises = [
      typed("lesson_choice", OBJ.thirdPerson),
      typed("lesson_gap", OBJ.thirdPerson),
      typed("lesson_open_answer", OBJ.thirdPerson),
    ];
    expect(poolCoverage(exercises, [OBJ.thirdPerson], minimums)).toEqual([]);
  });

  it("raportuje braki per etap", () => {
    const exercises = [typed("lesson_choice", OBJ.thirdPerson)]; // brak productive, independent
    const gaps = poolCoverage(exercises, [OBJ.thirdPerson], minimums);
    const stages = gaps.map((g) => g.stage);
    expect(stages).toContain("productive");
    expect(stages).toContain("independent");
    expect(stages).not.toContain("guided");
  });

  it("lesson_notice (intro) nie liczy się do pokrycia", () => {
    const exercises = [
      typed("lesson_notice", OBJ.thirdPerson),
      typed("lesson_gap", OBJ.thirdPerson),
      typed("lesson_open_answer", OBJ.thirdPerson),
    ];
    const gaps = poolCoverage(exercises, [OBJ.thirdPerson], minimums);
    // notice nie pokrywa guided → guided wciąż brakuje
    expect(gaps.some((g) => g.stage === "guided")).toBe(true);
    expect(stageOf("lesson_notice")).toBe("intro");
  });

  it("raportuje braki osobno dla każdego celu", () => {
    const exercises = [typed("lesson_choice", OBJ.thirdPerson)];
    const gaps = poolCoverage(exercises, [OBJ.thirdPerson, OBJ.negative], minimums);
    expect(gaps.some((g) => g.objectiveId === OBJ.negative)).toBe(true);
    expect(gaps.filter((g) => g.objectiveId === OBJ.negative).length).toBe(3);
  });
});
