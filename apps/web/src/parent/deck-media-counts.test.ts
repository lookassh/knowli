import { describe, expect, it } from "vitest";
import type { DraftDto } from "@learning/contracts";
import { draftMediaCounts } from "./DeckEditor";

function draft(states: string[]): DraftDto {
  return { assets: states.map((state) => ({ state })) } as unknown as DraftDto;
}

describe("draftMediaCounts (#397)", () => {
  it("counts pending and failed assets of the draft, ignoring other states", () => {
    expect(draftMediaCounts(draft(["approved", "pending", "pending", "failed", "omitted"])))
      .toEqual({ pending: 2, failed: 1 });
  });

  it("returns zeros for an all-approved draft and for a missing draft", () => {
    expect(draftMediaCounts(draft(["approved", "approved"]))).toEqual({ pending: 0, failed: 0 });
    expect(draftMediaCounts(null)).toEqual({ pending: 0, failed: 0 });
    expect(draftMediaCounts(undefined)).toEqual({ pending: 0, failed: 0 });
  });
});
