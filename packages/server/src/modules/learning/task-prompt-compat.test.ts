import { describe, expect, it } from "vitest";
import { addLegacyTaskPromptDefaults } from "./task-prompt-compat";

describe("legacy issued task prompt compatibility", () => {
  it("preserves an existing illustration when a snapshot predates visualType", () => {
    const imageAssetId = "asset-123";
    const prompt = addLegacyTaskPromptDefaults({ kind: "exposure", imageAssetId, target: "Monday" });

    expect(prompt).toMatchObject({ kind: "exposure", imageAssetId, visualType: "image", exampleAudioAssetId: null });
  });

  it("defaults old prompts without an illustration to no visualization", () => {
    const prompt = addLegacyTaskPromptDefaults({ kind: "speech", imageAssetId: null, text: "Monday" });

    expect(prompt).toMatchObject({ kind: "speech", imageAssetId: null, visualType: "none" });
  });
});
