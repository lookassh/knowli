import { describe, expect, it } from "vitest";
import { resolveTaskAssistance } from "./task-assistance";

describe("resolveTaskAssistance", () => {
  it("treats audio as support only when it reveals an answer", () => {
    const resolve = (exerciseType: "reading" | "listening" | "speech" | "picture_recognition", disclosureKinds: ("audio_issued" | "hint_issued")[]) =>
      resolveTaskAssistance({ exerciseType, visibleLetterFragment: false, distinctChoiceCount: 3, disclosureKinds });
    expect(resolve("reading", ["audio_issued"])).toEqual(["model_audio"]);
    expect(resolve("listening", ["audio_issued"])).toEqual([]);
    expect(resolve("speech", ["audio_issued"])).toEqual([]);
    // picture_recognition: audio przed odpowiedzią odtwarza poprawne słowo (SPEC §12.4a, A07)
    expect(resolve("picture_recognition", ["audio_issued"])).toEqual(["model_audio"]);
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
