import { describe, expect, it } from "vitest";
import type { CalculationSpec } from "@learning/contracts";
import { englishGrammarSubject } from "../../../domain/lessons/subjects/english-grammar/module";
import { validatePool } from "../../../domain/lessons/pool-validation";
import type { LessonExerciseDraft, LessonTopic } from "../../../domain/lessons/types";
import { schoolSubject } from "../../../domain/lessons/subjects/school/module";
import { validateDynamicTopicData } from "../../../domain/lessons/topic-resolution";
import { buildDynamicTopicData, buildLessonPayload, buildObjectiveCriteria, collectBatchExerciseMetadata, filterExercisesToRequestedObjective, minimumCountPerObjective, objectiveBatchCounts, isWellShapedRawExercise, lessonPayloadVersion, poolStageCounts, scopeFamiliesToRun, splitStages, stripParentAddedFlags, summarizeLessonPoolValidation, toExerciseDraft, withoutEmptyOptionalArrays } from "./lesson-drafts";

describe("calculation persistence and grading criteria", () => {
  const calculation = { kind: "scale_distance" as const, params: { scaleDenominator: 25000, mapDistanceCm: 3 }, unit: "m" as const, templateFamilyId: "scale" };
  const draft: LessonExerciseDraft = {
    exerciseType: "lesson_calculation", objectiveId: "school.dx.scale",
    prompt: "Oblicz odległość.", answer: "750 m", acceptedAnswers: [], focus: [],
    calculation,
  };
  const hash = (exercise: LessonExerciseDraft) => buildObjectiveCriteria(exercise, schoolSubject, 1).criteriaHash;

  it("retains the private calculation through draft/payload conversion and marks payload v3", () => {
    const mapped = toExerciseDraft(draft);
    expect(mapped.calculation).toEqual(draft.calculation);
    expect(buildLessonPayload(mapped, schoolSubject).calculation).toEqual(draft.calculation);
    expect(toExerciseDraft(buildLessonPayload(mapped, schoolSubject)).calculation).toEqual(draft.calculation);
    expect(lessonPayloadVersion(mapped, schoolSubject)).toBe(3);
  });

  it("changes the criteria hash for parameters, kind, result unit and tolerance", () => {
    const spec = calculation;
    const alternatives: CalculationSpec[] = [
      { ...spec, params: { scaleDenominator: 25000, mapDistanceCm: 4 } },
      { ...spec, unit: "km" as const },
      { ...spec, tolerance: 1 },
      { kind: "height_difference" as const, params: { upperHeightM: 900, lowerHeightM: 150 }, unit: "m" as const, templateFamilyId: "height" },
    ];
    for (const calculation of alternatives) expect(hash({ ...draft, calculation })).not.toBe(hash(draft));
  });

  it("ignores template family, parameter key order and an explicit default tolerance", () => {
    expect(hash({ ...draft, calculation: { ...calculation, templateFamilyId: "another-family", tolerance: 0,
      params: { mapDistanceCm: 3, scaleDenominator: 25000 } } })).toBe(hash(draft));
  });
});

const OBJECTIVE_ID = "english_grammar.present_simple.third_person_s";

/** Minimalny temat zgodny z celem używanym przez przedmiot english_grammar. */
function presentSimpleTopic(): LessonTopic {
  const topic = englishGrammarSubject.topics.find((t) => t.id === "present_simple");
  if (!topic) throw new Error("fixture topic missing");
  return topic;
}

/** Poprawny kształtowo lesson_choice (surowy obiekt z portu). */
function validChoiceRaw(answer: string) {
  return {
    exerciseType: "lesson_choice",
    objectiveId: OBJECTIVE_ID,
    instructionPl: "Wybierz.",
    stem: "She ___ football.",
    answer,
    acceptedAnswers: [],
    focus: [],
    options: [
      { id: "a", text: answer },
      { id: "b", text: `${answer}x` },
    ],
    correctOption: "a",
  };
}

/** lesson_choice o złym kształcie: null w tablicy opcji. */
function malformedOptionsRaw() {
  return {
    exerciseType: "lesson_choice",
    objectiveId: OBJECTIVE_ID,
    instructionPl: "Wybierz.",
    answer: "watches",
    acceptedAnswers: [],
    focus: [],
    options: [null, { id: "b", text: "watch" }],
    correctOption: "b",
  };
}

describe("P2-7: strażnik kształtu surowego ćwiczenia (isWellShapedRawExercise)", () => {
  it.each(["acceptedAnswers", "focus"])("odrzuca null w %s zamiast wywracać walidację puli", (field) => {
    const raw = { ...validChoiceRaw("watches"), [field]: [null] };
    expect(isWellShapedRawExercise(raw)).toBe(false);
    const rows = [validChoiceRaw("plays"), raw].filter(isWellShapedRawExercise).map(toExerciseDraft);
    expect(validatePool(rows, englishGrammarSubject, presentSimpleTopic()).valid.map((r) => r.answer)).toEqual(["plays"]);
  });
  it("validatePool odrzuca zły kształt bez wyjątku i zachowuje poprawne rekordy", () => {
    const topic = presentSimpleTopic();
    const drafts = [validChoiceRaw("plays"), malformedOptionsRaw()].map(toExerciseDraft);
    const result = validatePool(drafts, englishGrammarSubject, topic);
    expect(result.valid.map((ex) => ex.answer)).toEqual(["plays"]);
    expect(result.rejected).toHaveLength(1);
  });

  it("strażnik odrzuca ćwiczenie z null w options", () => {
    expect(isWellShapedRawExercise(malformedOptionsRaw())).toBe(false);
  });

  it("strażnik odrzuca options z elementem bez pola text", () => {
    expect(
      isWellShapedRawExercise({ ...validChoiceRaw("plays"), options: [{ id: "a" }, { id: "b", text: "x" }] }),
    ).toBe(false);
  });

  it("strażnik odrzuca items z elementem o złym typie", () => {
    expect(
      isWellShapedRawExercise({
        exerciseType: "lesson_order",
        objectiveId: OBJECTIVE_ID,
        answer: "a b c",
        acceptedAnswers: [],
        focus: [],
        items: [{ id: "i1", text: "a" }, 42, { id: "i3", text: "c" }],
      }),
    ).toBe(false);
  });

  it("strażnik odrzuca noticeSegments o złym kształcie (null segment)", () => {
    expect(
      isWellShapedRawExercise({
        exerciseType: "lesson_notice",
        objectiveId: OBJECTIVE_ID,
        answer: "plays",
        acceptedAnswers: [],
        focus: [],
        noticeSegments: [["plays", null], ["two"]],
        correctOption: "plays",
      }),
    ).toBe(false);
  });

  it("strażnik przepuszcza poprawny kształtowo lesson_choice", () => {
    expect(isWellShapedRawExercise(validChoiceRaw("plays"))).toBe(true);
  });

  it("strażnik przepuszcza ćwiczenie bez pól tablicowych (gap)", () => {
    expect(
      isWellShapedRawExercise({
        exerciseType: "lesson_gap",
        objectiveId: OBJECTIVE_ID,
        answer: "plays",
        acceptedAnswers: [],
        focus: ["plays"],
        stem: "___ here.",
      }),
    ).toBe(true);
  });

  it("top-level null in model output is rejected before mapping, preserving valid siblings", () => {
    const raws: unknown[] = [validChoiceRaw("plays"), null];
    const wellShaped = raws.filter(isWellShapedRawExercise).map(toExerciseDraft);
    expect(wellShaped).toHaveLength(1);
    expect(validatePool(wellShaped, englishGrammarSubject, presentSimpleTopic()).valid.map((ex) => ex.answer)).toEqual(["plays"]);
  });

  it("collects metadata from a batch containing top-level null without throwing", () => {
    expect(() => collectBatchExerciseMetadata([validChoiceRaw("plays"), null], true)).not.toThrow();
    expect(collectBatchExerciseMetadata([validChoiceRaw("plays"), null], true).answers).toEqual(["plays"]);
  });

  it("summarizes rejection rules and counts without logging answer text", () => {
    const summary = summarizeLessonPoolValidation({
      rawCount: 2,
      shapeRejected: 0,
      outOfScopeCount: 0,
      rejectedExerciseCount: 1,
      rejectedErrors: ["lesson_gap: answer secret-child-text does not match", "lesson_gap: answer other-secret does not match"],
      duplicateCount: 0,
      validCount: 0,
    });
    expect(summary).toContain("lesson_gap×2");
    expect(summary).toContain("odrzucone=1");
    expect(summary).not.toContain("secret-child-text");
    expect(summary).not.toContain("other-secret");
  });

  it("rejects a well-shaped exercise returned for a different objective in this batch", () => {
    const foreign = { ...validChoiceRaw("plays"), objectiveId: "english_grammar.present_simple.negative" };
    const result = filterExercisesToRequestedObjective([validChoiceRaw("watches"), foreign, null], OBJECTIVE_ID);
    expect(result.outOfScopeCount).toBe(1);
    expect(result.exercises).toEqual([validChoiceRaw("watches"), null]);
  });

  it("GREEN: po odfiltrowaniu strażnikiem validatePool nie rzuca i zwraca poprawne", () => {
    const topic = presentSimpleTopic();
    const raws = [validChoiceRaw("plays"), malformedOptionsRaw()];
    const wellShaped = raws.filter(isWellShapedRawExercise).map(toExerciseDraft);
    const { valid } = validatePool(wellShaped, englishGrammarSubject, topic);
    expect(valid.map((v) => v.answer)).toEqual(["plays"]);
  });
});

describe("ton lektora (voiceTone) z wyjścia modelu", () => {
  const rawExercise = {
    exerciseType: "lesson_open_answer",
    objectiveId: "school.dx.foto",
    prompt: "Co to jest fotosynteza?",
    answer: "Roślina wytwarza cukry.",
    acceptedAnswers: [],
    focus: ["cukry"],
  };

  it("zachowuje znany ton ćwiczenia, a nieznany albo null pomija", () => {
    expect(toExerciseDraft({ ...rawExercise, voiceTone: "gentle" }).voiceTone).toBe("gentle");
    expect("voiceTone" in toExerciseDraft({ ...rawExercise, voiceTone: "loud" })).toBe(false);
    expect("voiceTone" in toExerciseDraft({ ...rawExercise, voiceTone: null })).toBe(false);
    expect("voiceTone" in toExerciseDraft({ ...rawExercise, voiceTone: 3 })).toBe(false);
    expect("voiceTone" in toExerciseDraft(rawExercise)).toBe(false);
  });

  it("przenosi ton do payloadu rewizji i z powrotem", () => {
    const payload = buildLessonPayload(toExerciseDraft({ ...rawExercise, voiceTone: "curious" }), schoolSubject);
    expect(payload.voiceTone).toBe("curious");
    expect(toExerciseDraft(payload).voiceTone).toBe("curious");
    expect("voiceTone" in buildLessonPayload(toExerciseDraft(rawExercise), schoolSubject)).toBe(false);
  });

  it("nie zmienia kryteriów celu ani wersji payloadu", () => {
    const plain = toExerciseDraft(rawExercise);
    const toned = toExerciseDraft({ ...rawExercise, voiceTone: "mysterious" });
    expect(buildObjectiveCriteria(toned, schoolSubject, 1)).toEqual(buildObjectiveCriteria(plain, schoolSubject, 1));
    expect(lessonPayloadVersion(toned, schoolSubject)).toBe(lessonPayloadVersion(plain, schoolSubject));
  });

  it("karty zagadnień: znany ton zachowany, nieznany i null pominięte", () => {
    const raw = {
      slug: "a",
      titlePl: "Zagadnienie",
      descriptionEn: "Topic description.",
      cards: [
        { title: "Karta 1", body: "Treść 1.", voiceTone: "cheerful" },
        { title: "Karta 2", body: "Treść 2.", voiceTone: "loud" },
        { title: "Karta 3", body: "Treść 3.", voiceTone: null },
        { title: "Karta 4", body: "Treść 4." },
      ],
    };
    const cards = buildDynamicTopicData([raw], "deck", "Temat").data!.objectives[0]!.cards;
    expect(cards[0]!.voiceTone).toBe("cheerful");
    expect(cards.slice(1).every((card) => !("voiceTone" in card))).toBe(true);
  });
});

describe("stripParentAddedFlags (generacja nie jest źródłem rodzica)", () => {
  it("usuwa flagę parentAdded z cytatów ćwiczeń generowanych", () => {
    const draft = toExerciseDraft({
      exerciseType: "lesson_open_answer",
      objectiveId: "school.dx.foto",
      prompt: "Co to jest fotosynteza?",
      answer: "Roślina wytwarza cukry.",
      acceptedAnswers: [],
      focus: ["cukry"],
      sourceRefs: [{ quote: "cytat spoza materiału, wystarczająco długi", parentAdded: true }],
    });
    expect(draft.sourceRefs?.[0]?.parentAdded).toBe(true);
    const [stripped] = stripParentAddedFlags([draft]);
    expect(stripped!.sourceRefs).toEqual([{ quote: "cytat spoza materiału, wystarczająco długi" }]);
  });
});

describe("objectiveBatchCounts (pula strukturalnie publikowalna i nieprzekraczana, W3)", () => {
  it("każda partia spełnia minima każdego etapu szkoły (3/2/2), także przy małej puli i wielu zagadnieniach", () => {
    for (const objectiveCount of [1, 3, 8]) {
      for (const count of objectiveBatchCounts(20, objectiveCount, schoolSubject)) {
        const split = splitStages(count);
        expect(split.guided).toBeGreaterThanOrEqual(3);
        expect(split.productive).toBeGreaterThanOrEqual(2);
        expect(split.independent).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("suma partii równa się zamówionej puli, gdy pula mieści minima (bez nadwyżki z zaokrągleń)", () => {
    const minimum = minimumCountPerObjective(schoolSubject);
    for (const poolSize of [20, 30, 60, 100, 120, 160]) {
      for (const objectiveCount of [1, 2, 3, 5, 6, 7, 8]) {
        const counts = objectiveBatchCounts(poolSize, objectiveCount, schoolSubject);
        const sum = counts.reduce((a, b) => a + b, 0);
        expect(counts).toHaveLength(objectiveCount);
        expect(sum, `pula ${poolSize}, cele ${objectiveCount}`).toBe(Math.max(poolSize, minimum * objectiveCount));
      }
    }
  });

  it("przy puli mniejszej niż minima podnosi ją do minimum publikacji (8 celów × minimum)", () => {
    const minimum = minimumCountPerObjective(schoolSubject);
    expect(objectiveBatchCounts(20, 8, schoolSubject)).toEqual(Array(8).fill(minimum));
    expect(objectiveBatchCounts(160, 3, schoolSubject).reduce((a, b) => a + b, 0)).toBe(160);
  });
});

describe("buildDynamicTopicData (wadliwe zagadnienie nie przerywa generacji)", () => {
  const card = (n: number) => ({ title: `Karta ${n}`, body: `Treść karty ${n}.` });
  const raw = (slug: string, cards = [card(1), card(2)], titlePl = `Zagadnienie ${slug}`) =>
    ({ slug, titlePl, descriptionEn: "Topic description.", cards });
  const validate = (objective: Parameters<NonNullable<Parameters<typeof buildDynamicTopicData>[3]>>[0]) =>
    validateDynamicTopicData(schoolSubject, { titlePl: "Temat", objectives: [objective] });

  it("pomija zagadnienie z jedną kartą albo pustym tytułem, a pozostałe zachowuje", () => {
    const built = buildDynamicTopicData([raw("a"), raw("b", [card(1)]), raw("c", undefined, "  "), raw("d")], "deck", "Temat", validate);
    expect(built.data?.objectives.map((o) => o.id)).toEqual(["school.ddeck.a", "school.ddeck.d"]);
    expect(built.errors).toHaveLength(2);
    expect(validateDynamicTopicData(schoolSubject, built.data!)).toEqual([]);
  });

  it("nadaje unikalne identyfikatory także wtedy, gdy sufiks koliduje z innym slugiem", () => {
    const built = buildDynamicTopicData([raw("a"), raw("a_3"), raw("a")], "deck", "Temat", validate);
    const ids = built.data!.objectives.map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
    expect(validateDynamicTopicData(schoolSubject, built.data!)).toEqual([]);
  });
});

describe("withoutEmptyOptionalArrays (puste tablice strict output to brak pola)", () => {
  it("nie odrzuca poprawnej luki gramatyki za puste tablice innych typów i v3 z modelu", () => {
    const grammarTopic = englishGrammarSubject.topics[0]!;
    const objective = grammarTopic.objectives.find((o) => o.exerciseTypes.includes("lesson_gap"))!;
    const raw = {
      exerciseType: "lesson_gap", objectiveId: objective.id, instructionPl: "Uzupełnij.", stem: "He ___ football.",
      answer: "plays", acceptedAnswers: [], focus: ["plays"],
      options: [], items: [], noticeSegments: [],
      requiredElements: [], supplementaryElements: [], commonErrors: [], sourceRefs: [],
      questionType: null, expectedForm: null, familyId: null,
    };
    // Bez czyszczenia poprawne ćwiczenie odpada (np. `options: []` łamie minimum kontraktu).
    expect(validatePool([toExerciseDraft(raw)], englishGrammarSubject, grammarTopic).rejected).toHaveLength(1);
    const cleaned = withoutEmptyOptionalArrays(toExerciseDraft(raw));
    for (const field of ["options", "items", "noticeSegments", "requiredElements", "supplementaryElements", "commonErrors", "sourceRefs"]) {
      expect(cleaned).not.toHaveProperty(field);
    }
    const result = validatePool([cleaned], englishGrammarSubject, grammarTopic);
    expect(result.rejected.flatMap((r) => r.errors)).toEqual([]);
    expect(result.valid).toHaveLength(1);
  });

  it("wybór bez opcji nadal jest odrzucany — pusta tablica nie ukrywa prawdziwego braku", () => {
    const grammarTopic = englishGrammarSubject.topics[0]!;
    const objective = grammarTopic.objectives.find((o) => o.exerciseTypes.includes("lesson_choice"))!;
    const cleaned = withoutEmptyOptionalArrays(toExerciseDraft({
      exerciseType: "lesson_choice", objectiveId: objective.id, instructionPl: "Wybierz.", stem: "He ___ football.",
      answer: "plays", acceptedAnswers: [], focus: ["plays"], options: [], correctOption: "a",
    }));
    expect(validatePool([cleaned], englishGrammarSubject, grammarTopic).rejected).toHaveLength(1);
  });
});

describe("scopeFamiliesToRun (dogenerowanie nie dołącza do istniejących rodzin)", () => {
  it("dodaje sufiks runu do familyId i templateFamilyId, zachowując poprawny slug", () => {
    const runId = "3f2a9c1e-0000-4000-8000-000000000000";
    const open = scopeFamiliesToRun({ exerciseType: "lesson_open_answer", objectiveId: "o", answer: "a", acceptedAnswers: [], focus: [], familyId: "f1" }, runId);
    expect(open.familyId).toBe("f1-r3f2a9c");
    const long = "a".repeat(56) + "-b";
    const calc = scopeFamiliesToRun({ exerciseType: "lesson_calculation", objectiveId: "o", answer: "750 m", acceptedAnswers: [], focus: [],
      calculation: { kind: "scale_distance", params: { scaleDenominator: 25000, mapDistanceCm: 3 }, unit: "m", templateFamilyId: long } }, runId);
    const slug = calc.calculation!.templateFamilyId;
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slug.endsWith("-r3f2a9c")).toBe(true);
  });
});

describe("poolStageCounts (rachunek nie zabiera miejsca wymaganym pytaniom otwartym)", () => {
  it("przy celu z rachunkami przesuwa jedno miejsce z produktywnego do samodzielnego, zachowując budżet i minima", () => {
    // 60 ćwiczeń na 6 zagadnień (sonda na prawdziwym LLM): 4/4/2 — oba samodzielne potrzebne pytaniom otwartym.
    expect(splitStages(10)).toEqual({ guided: 4, productive: 4, independent: 2 });
    expect(poolStageCounts(schoolSubject, ["lesson_open_answer", "lesson_calculation"], 10)).toEqual({ guided: 4, productive: 3, independent: 3 });
  });

  it("nie zmienia podziału bez rachunków, przy zapasie samodzielnym ani kosztem minimum produktywnego", () => {
    expect(poolStageCounts(schoolSubject, ["lesson_open_answer"], 10)).toEqual(splitStages(10));
    expect(poolStageCounts(schoolSubject, ["lesson_open_answer", "lesson_calculation"], 15)).toEqual(splitStages(15));
    // 5 → 2/2/1: przesunięcie zabrałoby produktywnemu minimum 2, więc podział zostaje.
    expect(poolStageCounts(schoolSubject, ["lesson_open_answer", "lesson_calculation"], 5)).toEqual(splitStages(5));
  });
});
