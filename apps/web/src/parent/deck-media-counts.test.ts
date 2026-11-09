import { describe, expect, it } from "vitest";
import type { DraftDto } from "@learning/contracts";
import { draftMediaCounts } from "./DeckEditor";

function draft(states: string[]): DraftDto {
  return { assets: states.map((state) => ({ state })) } as unknown as DraftDto;
}

function draftWithErrorCodes(assets: Array<{ state: string; errorCode?: string | null }>): DraftDto {
  return { assets } as unknown as DraftDto;
}

describe("draftMediaCounts (#397)", () => {
  it("counts pending and failed assets of the draft, ignoring other states", () => {
    expect(draftMediaCounts(draft(["approved", "pending", "pending", "failed", "omitted"])))
      .toEqual({ pending: 2, failed: 1, storageFailed: 0 });
  });

  it("returns zeros for an all-approved draft and for a missing draft", () => {
    expect(draftMediaCounts(draft(["approved", "approved"]))).toEqual({ pending: 0, failed: 0, storageFailed: 0 });
    expect(draftMediaCounts(null)).toEqual({ pending: 0, failed: 0, storageFailed: 0 });
    expect(draftMediaCounts(undefined)).toEqual({ pending: 0, failed: 0, storageFailed: 0 });
  });

  it("separates terminal media_storage failures from other failed assets (#385)", () => {
    expect(draftMediaCounts(draftWithErrorCodes([
      { state: "failed", errorCode: "media_storage" },
      { state: "failed", errorCode: "attempts_exhausted" },
      { state: "pending", errorCode: "media_storage" },
    ]))).toEqual({ pending: 1, failed: 2, storageFailed: 1 });
  });
});
