import { describe, expect, it } from "vitest";
import { resolveTaskAssistance } from "./task-assistance";

describe("resolveTaskAssistance", () => {
  it("treats audio as support only when it reveals an answer", () => {
    const resolve = (exerciseType: "reading" | "listening" | "speech", disclosureKinds: ("audio_issued" | "hint_issued")[]) =>
      resolveTaskAssistance({ exerciseType, visibleLetterFragment: false, distinctChoiceCount: 3, disclosureKinds });
    expect(resolve("reading", ["audio_issued"])).toEqual(["model_audio"]);
    expect(resolve("listening", ["audio_issued"])).toEqual([]);
    expect(resolve("speech", ["audio_issued"])).toEqual([]);
  });

  it("does not call a singleton choice an independent check", () => {
    expect(resolveTaskAssistance({
      exerciseType: "listening",
      visibleLetterFragment: false,
      distinctChoiceCount: 1,
      disclosureKinds: [],
    })).toEqual(["options"]);
  });

  it("counts visible letters and answer hints as support", () => {
    expect(resolveTaskAssistance({
      exerciseType: "letter_completion",
      visibleLetterFragment: true,
      distinctChoiceCount: null,
      disclosureKinds: ["hint_issued"],
    })).toEqual(["visible_letters", "answer_reveal"]);
  });
});
