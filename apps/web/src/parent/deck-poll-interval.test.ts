import { describe, expect, it } from "vitest";
import type { DeckDto } from "@learning/contracts";
import { deckPollInterval } from "./DeckEditor";

type Version = NonNullable<DeckDto["draft"]>;

function deck(overrides: { generation?: DeckDto["generation"]; draftAssets?: string[]; publishedAssets?: string[] }): DeckDto {
  const version = (states: string[]) => ({ assets: states.map((state) => ({ state })) }) as unknown as Version;
  return {
    generation: overrides.generation ?? null,
    draft: overrides.draftAssets ? version(overrides.draftAssets) : null,
    published: overrides.publishedAssets ? version(overrides.publishedAssets) : null,
  } as unknown as DeckDto;
}

describe("deckPollInterval", () => {
  it("polls every second while generation is queued or running", () => {
    expect(deckPollInterval(deck({ generation: { state: "queued" } as DeckDto["generation"] }))).toBe(1000);
    expect(deckPollInterval(deck({ generation: { state: "running" } as DeckDto["generation"] }))).toBe(1000);
  });

  it("polls while media of the visible version are pending (draft first, then published)", () => {
    expect(deckPollInterval(deck({ draftAssets: ["approved", "pending"] }))).toBe(1000);
    expect(deckPollInterval(deck({ publishedAssets: ["pending"] }))).toBe(1000);
    // szkic przesłania wersję opublikowaną
    expect(deckPollInterval(deck({ draftAssets: ["approved"], publishedAssets: ["pending"] }))).toBe(false);
  });

  it("stops when nothing is in progress, failed or missing", () => {
    expect(deckPollInterval(undefined)).toBe(false);
    expect(deckPollInterval(deck({ draftAssets: ["approved", "failed"] }))).toBe(false);
    expect(deckPollInterval(deck({ generation: { state: "failed" } as DeckDto["generation"], draftAssets: ["approved"] }))).toBe(false);
  });
});
