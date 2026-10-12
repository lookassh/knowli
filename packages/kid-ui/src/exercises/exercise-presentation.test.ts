import { describe, expect, it } from "vitest";
import { getExercisePresentation } from "./exercise-presentation";
import type { TaskDto } from "@learning/contracts";

const task = (kind: TaskDto["prompt"]["kind"]): TaskDto => ({
  taskId: "10000000-0000-4000-8000-000000000004",
  sessionId: "10000000-0000-4000-8000-000000000003",
  ordinal: 0,
  exerciseType: kind,
  direction: null,
  state: "issued",
  remainingAssessed: 1,
  prompt: kind === "exposure"
    ? { kind, source: "kot", target: "cat", example: null, audioAssetId: null, exampleAudioAssetId: null, imageAssetId: null, visualType: "none" }
    : kind === "listening"
      ? { kind, audioAssetId: "10000000-0000-4000-8000-000000000006", options: [{ id: "10000000-0000-4000-8000-000000000007", text: "kot" }] }
      : kind === "reading"
        ? { kind, text: "cat", options: [{ id: "10000000-0000-4000-8000-000000000007", text: "kot" }] }
        : kind === "reverse_recognition"
          ? { kind, prompt: "kot", options: [{ id: "10000000-0000-4000-8000-000000000007", text: "cat" }] }
          : kind === "recall" || kind === "spelling"
            ? { kind, prompt: "kot" }
            : kind === "letter_completion"
              ? { kind, prompt: "kot", fragment: "c_t" }
              : { kind: "speech" as const, text: "cat", audioAssetId: null, imageAssetId: null, visualType: "none" as const },
});

describe("getExercisePresentation", () => {
  it.each([
    ["exposure", "Poznaj nowe słowo", "sparkles"],
    ["listening", "Posłuchaj i wybierz", "volume"],
    ["reading", "Wybierz znaczenie słowa", "book"],
    ["reverse_recognition", "Wybierz angielskie słowo", "ear"],
    ["recall", "Jak jest po angielsku?", "book"],
    ["spelling", "Napisz po angielsku", "pencil"],
    ["letter_completion", "Uzupełnij litery", "letters"],
    ["speech", "Powiedz na głos", "microphone"],
  ] as const)("maps %s to a fixed instruction without revealing the target", (kind, instruction, icon) => {
    const result = getExercisePresentation(task(kind));
    expect(result).toEqual({ instruction, icon });
    expect(result.instruction).not.toContain("cat");
  });
});
