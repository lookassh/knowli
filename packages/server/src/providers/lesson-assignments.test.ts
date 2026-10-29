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

  it("pozostawia inne ćwiczenia i odbiera odpowiedź rekordom o złym kształcie", () => {
    const gap = { exerciseType: "lesson_gap", answer: "x" };
    const [same, broken] = materializeGeneratedAssignments([gap, { ...match, pairs: [null] }]) as Record<string, unknown>[];
    expect(same).toBe(gap);
    expect(broken!.answer).toBeUndefined();
  });
});
