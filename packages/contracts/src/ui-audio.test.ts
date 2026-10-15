import { describe, expect, it } from "vitest";
import * as contracts from "./index";

const publicContract = contracts as unknown as Record<string, unknown>;

describe("publiczny kontrakt wskazówek Kid UI", () => {
  it("eksportuje walidowany katalog 17 stałych kluczy audio", () => {
    const keySchema = publicContract.UiAudioKeySchema as { options: string[]; safeParse(value: unknown): { success: boolean } };
    const dtoSchema = publicContract.UiAudioCatalogDtoSchema as { safeParse(value: unknown): { success: boolean } };
    expect(keySchema.options).toHaveLength(17);
    expect(dtoSchema.safeParse({ ready: false, assets: {} }).success).toBe(true);
    expect(dtoSchema.safeParse({ ready: true, assets: { correct: "not-a-uuid" } }).success).toBe(false);
  });
});
