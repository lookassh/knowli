import { describe, expect, it } from "vitest";
import type { AgentObjective, LessonExerciseDraft } from "../../types";
import { schoolAgentPolicy } from "./agent-policy";
import { validateLessonExercise } from "../../pool-validation";
import { schoolSubject } from "./module";

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

describe("schoolAgentPolicy — pola modułu", () => {
  it("moduł szkoły składa pola generowania z polityki: materiał w kontroli zamkniętych, bez dopisków reguł", () => {
    expect(schoolSubject.checkerNeedsMaterial).toBe(true);
    expect(schoolSubject.sanitize).toBe(schoolAgentPolicy.sanitize);
    expect(schoolSubject.ruleNotes).toBeUndefined();
  });
});

describe("schoolAgentPolicy.sanitize", () => {
  it.each(["lesson_gap", "lesson_choice", "lesson_cloze", "lesson_order"] as const)("usuwa podpowiedź przy %s", (exerciseType) => {
    const result = sanitize(draft({ exerciseType, hint: "Pomyśl o rzekach." }));
    expect(result.draft).not.toHaveProperty("hint");
    expect(result.draft.exerciseType).toBe(exerciseType);
    expect(result.notes?.map((note) => [note.rule, note.found])).toEqual([["school.hint_open_answer_only", `removed: ${exerciseType} takes no hint in school`]]);
  });

  it("usuwa podpowiedź także przy pytaniu otwartym (szkoła nie generuje podpowiedzi, etap 5b)", () => {
    const result = sanitize(draft({ hint: "Pomyśl o rzekach." }));
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

  it("niezmienione ćwiczenie zwraca ten sam szkic bez not", () => {
    const original = draft({ exerciseType: "lesson_gap" });
    const result = sanitize(original);
    expect(result.notes).toEqual([]);
    expect(result.draft).toBe(original);
  });
});

describe("schoolAgentPolicy — podpowiedź pytania otwartego (spec §5.1)", () => {
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
    expect(sanitize(open).draft).not.toHaveProperty("hint");
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
  it("zastępuje cytat modelu dokładnym fragmentem materiału", () => {
    const result = sanitize(draft({
      sourceRefs: [
        { quote: "mierzeja wiślana to piaszczysty pas lądu" },
        { quote: "między Zatoką Gdańską a Zalewem Wiślanym" },
        { quote: "Cytat spoza materiału, zostaje bez zmian." },
      ],
    }));
    expect(result.draft.sourceRefs).toEqual([
      { quote: "Mierzeja Wiślana to piaszczysty pas lądu" },
      { quote: "między Zatoką Gdańską a Zalewem Wiślanym" },
      { quote: "Cytat spoza materiału, zostaje bez zmian." },
    ]);
  });

  it("cytat rodzica (`parentAdded`) bez zmian", () => {
    const refs = [{ quote: "mierzeja wiślana to piaszczysty pas lądu", parentAdded: true }];
    const result = sanitize(draft({ sourceRefs: refs }));
    expect(result.draft.sourceRefs).toEqual(refs);
  });

  it("bez zmian cytatów i podpowiedzi zwraca ten sam szkic", () => {
    const original = draft({ exerciseType: "lesson_gap", sourceRefs: [{ quote: "Mierzeja Wiślana to piaszczysty pas lądu" }] });
    const result = sanitize(original);
    expect(result.draft).toBe(original);
  });
});
