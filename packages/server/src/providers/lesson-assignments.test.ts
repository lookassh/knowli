import { describe, expect, it } from "vitest";
import { messages } from "@learning/contracts";
import { materializeGeneratedAssignments } from "./lesson-assignments";

describe("materializeGeneratedAssignments", () => {
  const match = {
    exerciseType: "lesson_match", objectiveId: "o", instructionPl: "Połącz pojęcie z opisem.",
    pairs: [{ left: "równik", right: "dzieli Ziemię na półkule" }, { left: "południk", right: "łączy bieguny" }, { left: "biegun", right: "punkt na osi Ziemi" }],
    extraRight: ["leży nad morzem"], sourceRefs: [{ quote: "Równik dzieli Ziemię na półkule." }], answer: "zmyślona",
  };
  const group = {
    exerciseType: "lesson_group", objectiveId: "o", instructionPl: "",
    groups: [{ id: "g1", label: "ssaki" }, { id: "g2", label: "ptaki" }],
    groupItems: [{ text: "pies", groupId: "g1" }, { text: "kot", groupId: "g1" }, { text: "wróbel", groupId: "g2" }, { text: "sowa", groupId: "g2" }],
    sourceRefs: [{ quote: "Ssaki karmią młode mlekiem." }],
  };

  it("składa odpowiedź z par i grup, a puste polecenie zastępuje wspólnym", () => {
    const [m, g] = materializeGeneratedAssignments([match, group]) as Record<string, unknown>[];
    expect(m).toMatchObject({ answer: "równik, południk, biegun", instructionPl: "Połącz pojęcie z opisem.", acceptedAnswers: [], focus: [], extraRight: ["leży nad morzem"] });
    expect(g).toMatchObject({ answer: "ssaki / ptaki", instructionPl: messages.kid.lessonGroupInstruction, acceptedAnswers: [], focus: [] });
  });

  it("luki z bankiem: odpowiedź ze słów luk i polecenie domyślne", () => {
    const cloze = {
      exerciseType: "lesson_cloze", objectiveId: "o", instructionPl: " ",
      clozeText: "Równik dzieli Ziemię na ___, a bieguny łączy ___.", gapAnswers: ["półkule", "południk"], extraWords: ["równoleżnik"],
      sourceRefs: [{ quote: "Równik dzieli Ziemię na półkule." }], answer: "zmyślona",
    };
    const [c] = materializeGeneratedAssignments([cloze]) as Record<string, unknown>[];
    expect(c).toMatchObject({ answer: "półkule, południk", instructionPl: messages.kid.lessonClozeInstruction, acceptedAnswers: [], focus: [], extraWords: ["równoleżnik"] });
    const [broken] = materializeGeneratedAssignments([{ ...cloze, gapAnswers: [1] }]) as Record<string, unknown>[];
    expect(broken!.answer).toBeUndefined();
  });

  it("przedmiot bez cytatów: sourceRefs null albo brak daje ćwiczenie bez pola sourceRefs, cytaty zostają", () => {
    const cloze = {
      exerciseType: "lesson_cloze", objectiveId: "o", instructionPl: "",
      clozeText: "I wear a ___ and ___.", gapAnswers: ["coat", "hat"], extraWords: ["scarf"],
    };
    const exercises = materializeGeneratedAssignments([
      { ...match, sourceRefs: null }, { ...group, sourceRefs: null }, { ...cloze, sourceRefs: null },
      { ...match, sourceRefs: undefined }, cloze, match,
    ]) as Record<string, unknown>[];
    for (const exercise of exercises.slice(0, 5)) expect(exercise).not.toHaveProperty("sourceRefs");
    expect(exercises[0]).toMatchObject({ answer: "równik, południk, biegun" });
    expect(exercises[2]).toMatchObject({ answer: "coat, hat" });
    expect(exercises[5]).toHaveProperty("sourceRefs", match.sourceRefs);
  });

  it("pozostawia inne ćwiczenia i odbiera odpowiedź rekordom o złym kształcie", () => {
    const gap = { exerciseType: "lesson_gap", answer: "x" };
    const [same, broken] = materializeGeneratedAssignments([gap, { ...match, pairs: [null] }]) as Record<string, unknown>[];
    expect(same).toBe(gap);
    expect(broken!.answer).toBeUndefined();
  });
});
