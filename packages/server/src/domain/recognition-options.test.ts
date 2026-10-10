import { describe, expect, it } from "vitest";
import { buildRecognitionOptions } from "./recognition-options";
import type { ScheduleCandidate, SchedulePeer } from "./scheduler";
import { computeTargetKey } from "./target-key";

const target: ScheduleCandidate = {
  itemRevisionId: "rev-a", itemId: "item-a", position: 0, target: "café", source: "kawa", acceptedAnswers: ["coffee"], targetLocale: "en-GB",
  progress: {}, failuresThisSession: 0, supportedThisSession: false, usedThisSession: 1, presentationsThisSession: 1, lastContactAt: null, lastUsedOrdinal: 0,
  readingDirections: {}, practiceMix: { listening: 0, reading: 0 }, introducedSkills: { recall: false, pronunciation: false },
};
const peers: SchedulePeer[] = [
  { itemRevisionId: "rev-a", position: 0, target: "café", source: "kawa", targetLocale: "en-GB", acceptedAnswers: ["coffee"] },
  { itemRevisionId: "rev-b", position: 1, target: "tea", source: "herbata", targetLocale: "en-GB", acceptedAnswers: [] },
  { itemRevisionId: "rev-c", position: 2, target: "espresso", source: "kawa", targetLocale: "en-GB", acceptedAnswers: [] },
];

describe("buildRecognitionOptions", () => {
  it("returns null when fewer than two distinct safe answers remain", () => {
    expect(buildRecognitionOptions({ target, peers: [peers[0]!], direction: "listening", reservedTargetKeys: [], rotateBy: 0 })).toBeNull();
    expect(buildRecognitionOptions({
      target, peers, direction: "listening",
      reservedTargetKeys: [computeTargetKey("tea", "en-GB"), computeTargetKey("espresso", "en-GB")], rotateBy: 0,
    })).toBeNull();
  });

  it("deduplicates normalized choices and always returns one correct answer", () => {
    const result = buildRecognitionOptions({ target, peers, direction: "listening", reservedTargetKeys: [], rotateBy: 0 });
    expect(result?.options.filter((option) => option.correct)).toHaveLength(1);
    expect(new Set(result?.options.map((option) => option.text.normalize("NFC").trim().toLowerCase())).size).toBe(2);
    expect(result?.options.map((option) => option.itemRevisionId)).toContain("rev-b");
  });

  it("places the preferred safe confusion in the first distractor slot", () => {
    const result = buildRecognitionOptions({ target, peers, direction: "listening", reservedTargetKeys: [], rotateBy: 2, preferredRevisionIds: ["rev-b"] });
    expect(result?.options[1]?.itemRevisionId).toBe("rev-b");
  });

  it("does not let a preferred confusion bypass reservations or duplicate-answer filtering", () => {
    const reserved = buildRecognitionOptions({
      target, peers: [...peers, { itemRevisionId: "rev-d", position: 3, target: "milk", source: "mleko", targetLocale: "en-GB", acceptedAnswers: [] }],
      direction: "listening", reservedTargetKeys: [computeTargetKey("tea", "en-GB")], rotateBy: 0, preferredRevisionIds: ["rev-b"],
    });
    expect(reserved?.options.some((option) => option.itemRevisionId === "rev-b")).toBe(false);
    expect(reserved?.options[1]?.itemRevisionId).toBe("rev-d");
  });

  it("does not offer a distractor whose accepted variant matches the expected answer", () => {
    const result = buildRecognitionOptions({
      target,
      peers: [peers[0]!, { ...peers[1]!, target: "java", acceptedAnswers: ["coffee"] }, { ...peers[2]!, target: "espresso" }],
      direction: "source_to_target", reservedTargetKeys: [], rotateBy: 0,
    });
    expect(result?.options.map((option) => option.text)).not.toContain("java");
  });
});
