import { describe, expect, it } from "vitest";
import type { AgentObjective, LessonExerciseDraft } from "../../types";
import { baseNormalizer } from "../../normalize";
import { createProductionSubjectRegistry } from "..";
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

describe("schoolAgentPolicy — wartości i typy", () => {
  it("jest polityką przedmiotu szkolnego", () => {
    expect(schoolSubject.agentPolicy).toBe(schoolAgentPolicy);
  });

  it("bramka podpowiedzi używa normalizatora przedmiotu (skrót `baseNormalizer` w polityce)", () => {
    // Polityka nie importuje modułu (cykl), więc normalizator jest wpisany wprost — musi być tym samym.
    expect(schoolSubject.normalizer).toBe(baseNormalizer);
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

  it("sędzia podpowiedzi i kontrola otwarta dotyczą wyłącznie pytania otwartego", () => {
    expect(schoolAgentPolicy.hintJudgeTypes).toEqual(["lesson_open_answer"]);
    expect(schoolAgentPolicy.openAnswerCheckTypes).toEqual(["lesson_open_answer"]);
    const subjectTypes = new Set<string>(schoolSubject.exerciseTypes);
    for (const type of [...(schoolAgentPolicy.hintJudgeTypes ?? []), ...(schoolAgentPolicy.openAnswerCheckTypes ?? [])]) {
      expect(subjectTypes.has(type)).toBe(true);
    }
  });

  it("każdy zarejestrowany przedmiot: niepusta lista kontroli ma komplet tekstów odrzuceń, a sędzia podpowiedzi wymaga materiału", () => {
    const policies = createProductionSubjectRegistry()
      .listSubjects()
      .map((subject) => [subject.id, subject.agentPolicy] as const);
    // Szkoła ma obie listy: niezmiennik nie jest pusty.
    expect(policies.map(([id]) => id)).toContain(schoolSubject.id);
    for (const [id, policy] of policies) {
      const texts = policy.rejectionTexts;
      if ((policy.hintJudgeTypes ?? []).length > 0) {
        expect(policy.checkerNeedsMaterial, id).toBe(true);
        for (const text of [texts.hintUnsupported, texts.hintLanguage, texts.hintReveals]) expect(text?.length ?? 0, id).toBeGreaterThan(0);
      }
      if ((policy.openAnswerCheckTypes ?? []).length > 0) {
        for (const text of [texts.openMissing, texts.openWrong]) expect(text?.length ?? 0, id).toBeGreaterThan(0);
      }
    }
  });

  it("teksty odrzuceń wskazują, co poprawić, i nie pozwalają wyrzucić wymaganych elementów", () => {
    const texts = schoolAgentPolicy.rejectionTexts;
    expect(texts.hintUnsupported).toContain("set hint to null");
    expect(texts.hintLanguage).toContain("not correct Polish");
    expect(texts.hintReveals).toContain("Hint at the reasoning, not the content");
    expect(texts.openMissing).toContain("supplementaryElements");
    expect(texts.openMissing).toContain("Do not drop elements the question genuinely requires");
    expect(texts.openWrong).toContain("commonErrors");
  });

  it("leakVictim nie wspomina pokoju i podpowiada inny fakt lub inne sformułowanie", () => {
    expect(schoolAgentPolicy.rejectionTexts.leakVictim).not.toContain("room");
    expect(schoolAgentPolicy.rejectionTexts.leakVictim).toContain("ask about a different fact of the material or phrase the question differently");
    expect(schoolAgentPolicy.rejectionTexts.leakSource.length).toBeGreaterThan(0);
  });

  it("nie ma wymaganych typów, braków ani planu", () => {
    expect(schoolAgentPolicy.requiredTypes).toBeUndefined();
    expect(schoolAgentPolicy.objectiveGaps).toBeUndefined();
    expect(schoolAgentPolicy.planCoverage).toBeUndefined();
    expect(schoolAgentPolicy.planGate).toBeUndefined();
  });
});

describe("schoolAgentPolicy.sanitize", () => {
  it.each(["lesson_gap", "lesson_choice", "lesson_cloze", "lesson_order"] as const)("usuwa podpowiedź przy %s", (exerciseType) => {
    const result = sanitize(draft({ exerciseType, hint: "Pomyśl o rzekach." }));
    expect(result.removed).toEqual(["hint"]);
    expect(result.draft).not.toHaveProperty("hint");
    expect(result.draft.exerciseType).toBe(exerciseType);
  });

  it("zostawia podpowiedź przy pytaniu otwartym", () => {
    const result = sanitize(draft({ hint: "Pomyśl o rzekach." }));
    expect(result.removed).toEqual([]);
    expect(result.draft.hint).toBe("Pomyśl o rzekach.");
  });

  it("niezmienione ćwiczenie zwraca puste removed", () => {
    const original = draft({ exerciseType: "lesson_gap" });
    const result = sanitize(original);
    expect(result.removed).toEqual([]);
    expect(result.draft).toBe(original);
  });
});

describe("schoolAgentPolicy — podpowiedź pytania otwartego (spec §5.1)", () => {
  it("podpowiedź zdradzająca odpowiedź: usunięta z notą reguły z celem i słowami", () => {
    const result = sanitize(draft({ prompt: "Podaj przykład mierzei.", hint: "Przykładem jest Mierzeja Wiślana" }));
    expect(result.draft).not.toHaveProperty("hint");
    expect(result.removed).toEqual(["hint"]);
    expect(result.notes).toEqual([
      {
        rule: "hint.reveals_words",
        field: "hint",
        pl: "hint: podpowiedź zdradzała odpowiedź albo element wymagany i została usunięta",
        found: 'hint removed: shares "wiślana" with the answer "Mierzeja Wiślana"',
      },
    ]);
  });

  it("nota wskazuje element wymagany", () => {
    const result = sanitize(draft({
      prompt: "Czym jest mierzeja?",
      answer: "To pas lądu oddzielający zalew od morza.",
      requiredElements: [{ id: "e1", text: "piaszczysty pas" }],
      hint: "Pomyśl o piaszczystym pasie",
    }));
    expect(result.removed).toEqual(["hint"]);
    // „pas” ma 3 litery, więc nie jest słowem treściowym.
    expect(result.notes?.[0]?.found).toBe('hint removed: shares "piaszczysty" with the required element "piaszczysty pas"');
  });

  it("zostawia podpowiedź kierującą rozumowaniem i brak podpowiedzi", () => {
    expect(sanitize(draft({ hint: "Pomyśl o piaszczystym pasie lądu." }))).toMatchObject({ removed: [], notes: [] });
    expect(sanitize(draft({ hint: "Pomyśl o piaszczystym pasie lądu." })).draft.hint).toBe("Pomyśl o piaszczystym pasie lądu.");
    expect(sanitize(draft({}))).toMatchObject({ removed: [], notes: [] });
  });

  it("typ inny niż pytanie otwarte: dzisiejsze usunięcie bez noty", () => {
    const result = sanitize(draft({ exerciseType: "lesson_gap", hint: "Mierzeja Wiślana" }));
    expect(result.removed).toEqual(["hint"]);
    expect(result.notes).toEqual([]);
  });

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
