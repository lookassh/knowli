import { describe, expect, it } from "vitest";
import type { AgentObjective, LessonExerciseDraft } from "../../types";
import { schoolAgentPolicy } from "./agent-policy";
import { validateLessonExercise } from "../../pool-validation";
import { describeRule, ruleOf, type RuleId, type RuleTextContext } from "../../rules/catalog";
import { schoolSubject } from "./module";

const TEXT_CTX: RuleTextContext = { answerMaxLength: 600, groundingRequired: true };

const objective: AgentObjective = {
  id: "school.dx.geografia",
  titlePl: "Geografia",
  descriptionEn: "Geography.",
  cards: [{ title: "Mapa", body: "Mapa to obraz Ziemi." }],
  exerciseTypes: [],
};

function draft(overrides: Partial<LessonExerciseDraft>): LessonExerciseDraft {
  return { exerciseType: "lesson_open_answer", objectiveId: objective.id, answer: "Mierzeja Wiślana", acceptedAnswers: [], focus: [], ...overrides };
}

const MATERIAL = "Mierzeja Wiślana to piaszczysty pas lądu między Zatoką Gdańską a Zalewem Wiślanym.";
const sanitize = (d: LessonExerciseDraft, material = MATERIAL) => schoolAgentPolicy.sanitize!(d, { material });

describe("schoolAgentPolicy — wartości i typy", () => {
  it("jest polityką przedmiotu szkolnego", () => {
    expect(schoolSubject.agentPolicy).toBe(schoolAgentPolicy);
  });

  it("ma zapas samodzielnych 1 i luz 2, a checker dostaje materiał", () => {
    expect(schoolAgentPolicy.independentReserve).toBe(1);
    expect(schoolAgentPolicy.slack).toBe(2);
    expect(schoolAgentPolicy.checkerNeedsMaterial).toBe(true);
  });

  it("typy ślepe to zamknięte typy z lukami, bez otwartych, układanek, rachunków i słów kluczowych", () => {
    expect(schoolAgentPolicy.blindSolveTypes).toEqual(["lesson_choice", "lesson_match", "lesson_group", "lesson_cloze", "lesson_gap"]);
    expect(schoolAgentPolicy.blindSolveTypes).toContain("lesson_gap");
    for (const type of ["lesson_open_answer", "lesson_order", "lesson_calculation", "lesson_keywords", "lesson_listen_choice"] as const) {
      expect(schoolAgentPolicy.blindSolveTypes).not.toContain(type);
    }
    const subjectTypes = new Set<string>(schoolSubject.exerciseTypes);
    for (const type of schoolAgentPolicy.blindSolveTypes) expect(subjectTypes.has(type)).toBe(true);
  });

  it("warianty sprawdza się tylko przy lukach", () => {
    expect(schoolAgentPolicy.variantCheckTypes).toEqual(["lesson_gap"]);
  });

  it("szkoła nie deklaruje kontroli 2b (przebieg bazowy, etap 5b; kod 2b usuwa etap 5c)", () => {
    expect(schoolAgentPolicy.hintJudgeTypes).toBeUndefined();
    expect(schoolAgentPolicy.openAnswerCheckTypes).toBeUndefined();
    expect(schoolAgentPolicy.ruleNotes?.["check.hint_judge"]).toBeUndefined();
    expect(schoolAgentPolicy.ruleNotes?.["check.open_answer"]).toBeUndefined();
    expect(schoolSubject.baselinePool).toBe(true);
  });

  it("dopisek lesson.leak nie wspomina pokoju, podpowiada inny fakt lub inne sformułowanie i trafia do opisu reguły", () => {
    const leak = schoolAgentPolicy.ruleNotes?.["lesson.leak"] ?? "";
    expect(leak).not.toContain("room");
    expect(leak).toContain("ask about a different fact of the material or phrase the question differently");
    expect(describeRule(ruleOf(schoolSubject, "lesson.leak" as RuleId)!, TEXT_CTX, leak)).toContain(leak);
    expect(schoolAgentPolicy.ruleNotes?.["lesson.leak_source"]?.length ?? 0).toBeGreaterThan(0);
  });

  it("nie ma wymaganych typów ani braków", () => {
    expect(schoolAgentPolicy.requiredTypes).toBeUndefined();
    expect(schoolAgentPolicy.objectiveGaps).toBeUndefined();
  });
});

describe("schoolAgentPolicy.sanitize", () => {
  it.each(["lesson_gap", "lesson_choice", "lesson_cloze", "lesson_order"] as const)("usuwa podpowiedź przy %s", (exerciseType) => {
    const result = sanitize(draft({ exerciseType, hint: "Pomyśl o rzekach." }));
    expect(result.removed).toEqual(["hint"]);
    expect(result.draft).not.toHaveProperty("hint");
    expect(result.draft.exerciseType).toBe(exerciseType);
    expect(result.notes?.map((note) => [note.rule, note.found])).toEqual([["school.hint_open_answer_only", `removed: ${exerciseType} takes no hint in school`]]);
  });

  it("usuwa podpowiedź także przy pytaniu otwartym (szkoła nie generuje podpowiedzi, etap 5b)", () => {
    const result = sanitize(draft({ hint: "Pomyśl o rzekach." }));
    expect(result.removed).toEqual(["hint"]);
    expect(result.draft).not.toHaveProperty("hint");
    expect(result.notes).toEqual([
      {
        rule: "school.hint_open_answer_only",
        field: "hint",
        pl: "hint: szkoła nie generuje podpowiedzi — podpowiedź została usunięta",
        found: "removed: lesson_open_answer takes no hint in school",
      },
    ]);
  });

  it("niezmienione ćwiczenie zwraca puste removed", () => {
    const original = draft({ exerciseType: "lesson_gap" });
    const result = sanitize(original);
    expect(result.removed).toEqual([]);
    expect(result.draft).toBe(original);
  });
});

describe("schoolAgentPolicy — podpowiedź pytania otwartego (spec §5.1)", () => {
  it("bramka szkoły nie zwraca ustaleń (podpowiedź nie odrzuca już ćwiczenia)", () => {
    const findings = schoolAgentPolicy.exerciseGate?.(draft({ hint: "Przykładem jest Mierzeja Wiślana" }), objective, { material: MATERIAL }) ?? [];
    expect(findings).toEqual([]);
  });

  it("edytor rodzica przyjmuje podpowiedź, którą sanityzacja agenta by usunęła", () => {
    const topic = schoolSubject.buildDynamicTopic!({
      titlePl: "Geografia",
      objectives: [{ id: objective.id, titlePl: "Mierzeje", descriptionEn: "Spits.", cards: [{ title: "Mierzeja", body: "Pas lądu." }, { title: "Przykład", body: "Mierzeja Wiślana." }] }],
    });
    const open = draft({
      prompt: "Podaj przykład mierzei.",
      focus: ["Mierzeja"],
      questionType: "fact",
      requiredElements: [{ id: "e1", text: "Mierzeja Wiślana" }],
      expectedForm: "short",
      sourceRefs: [{ quote: "Mierzeja Wiślana to piaszczysty pas lądu" }],
      hint: "Przykładem jest Mierzeja Wiślana",
    });
    expect(sanitize(open).removed).toEqual(["hint"]);
    expect(validateLessonExercise(open, schoolSubject, topic)).toEqual([]);
  });

  it("szkic z błędem kontraktu nie rzuca", () => {
    const broken = draft({
      prompt: "x".repeat(500),
      answer: "",
      acceptedAnswers: ["", "y".repeat(400)],
      requiredElements: [{ id: "", text: "" }, { id: "e1", text: "Mierzeja Wiślana ".repeat(20) }],
      sourceRefs: [{ quote: "" }, { quote: "z".repeat(700) }, { quote: "mierzeja wiślana to piaszczysty pas" }],
      hint: "",
    });
    expect(() => sanitize(broken)).not.toThrow();
    expect(() => sanitize({ ...broken, hint: "Mierzeja Wiślana" })).not.toThrow();
    expect(() => sanitize(broken, "")).not.toThrow();
  });
});

describe("schoolAgentPolicy — cytaty wyrównane do materiału (spec §5.2)", () => {
  it("zastępuje cytat modelu dokładnym fragmentem materiału i liczy zmiany", () => {
    const result = sanitize(draft({
      sourceRefs: [
        { quote: "mierzeja wiślana to piaszczysty pas lądu" },
        { quote: "między Zatoką Gdańską a Zalewem Wiślanym" },
        { quote: "Cytat spoza materiału, zostaje bez zmian." },
      ],
    }));
    expect(result.quotesSnapped).toBe(1);
    expect(result.draft.sourceRefs).toEqual([
      { quote: "Mierzeja Wiślana to piaszczysty pas lądu" },
      { quote: "między Zatoką Gdańską a Zalewem Wiślanym" },
      { quote: "Cytat spoza materiału, zostaje bez zmian." },
    ]);
  });

  it("cytat rodzica (`parentAdded`) bez zmian", () => {
    const refs = [{ quote: "mierzeja wiślana to piaszczysty pas lądu", parentAdded: true }];
    const result = sanitize(draft({ sourceRefs: refs }));
    expect(result.quotesSnapped).toBe(0);
    expect(result.draft.sourceRefs).toEqual(refs);
  });

  it("bez zmian cytatów i podpowiedzi zwraca ten sam szkic", () => {
    const original = draft({ exerciseType: "lesson_gap", sourceRefs: [{ quote: "Mierzeja Wiślana to piaszczysty pas lądu" }] });
    const result = sanitize(original);
    expect(result.draft).toBe(original);
    expect(result.quotesSnapped).toBe(0);
  });
});
