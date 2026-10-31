import { describe, expect, it } from "vitest";
import { DeckDtoSchema, DeckSourceDtoSchema } from "./decks";
import { GenerationCommandSchema, GenerationDtoSchema } from "./generation";
import { LessonDeckSourceDtoSchema } from "./lessons";
import { MAX_GENERATION_INSTRUCTION_LENGTH } from "./limits";

const idempotencyKey = "generation-key-1";
const sourceMaterialId = "60dd9545-0fae-4ee5-bd14-4c2c045b99bd";
const id = "11111111-1111-4111-8111-111111111111";

function issuePaths(result: ReturnType<typeof GenerationCommandSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("GenerationCommandSchema", () => {
  it("accepts a prompt on its own as before", () => {
    const parsed = GenerationCommandSchema.parse({ prompt: "zwierzęta", idempotencyKey });
    expect(parsed).toMatchObject({ prompt: "zwierzęta", vocabularyFormat: "standard" });
    expect(
      GenerationCommandSchema.safeParse({
        prompt: "zwierzęta",
        idempotencyKey,
        title: "Zwierzęta",
        vocabularyFormat: "picture",
        maxItems: 100,
        locales: { source: "pl-PL", target: "en-GB" },
      }).success,
    ).toBe(true);
  });

  it("accepts a source with its expected revision, format, limit and instruction", () => {
    const parsed = GenerationCommandSchema.parse({
      sourceMaterialId,
      expectedSourceRevision: 3,
      instruction: "tylko pogoda",
      idempotencyKey,
      title: "Pogoda",
      vocabularyFormat: "picture",
      maxItems: 40,
    });
    expect(parsed).toMatchObject({ sourceMaterialId, expectedSourceRevision: 3, instruction: "tylko pogoda" });
    expect(parsed.prompt).toBeUndefined();
    expect(GenerationCommandSchema.safeParse({ sourceMaterialId, expectedSourceRevision: 1, idempotencyKey }).success).toBe(true);
  });

  it("requires exactly one of prompt and sourceMaterialId", () => {
    const both = GenerationCommandSchema.safeParse({ prompt: "zwierzęta", sourceMaterialId, expectedSourceRevision: 1, idempotencyKey });
    expect(both.success).toBe(false);
    expect(issuePaths(both)).toContain("sourceMaterialId");
    const neither = GenerationCommandSchema.safeParse({ idempotencyKey });
    expect(neither.success).toBe(false);
    expect(issuePaths(neither)).toContain("prompt");
  });

  it("ties expectedSourceRevision to sourceMaterialId in both directions", () => {
    const withoutRevision = GenerationCommandSchema.safeParse({ sourceMaterialId, idempotencyKey });
    expect(withoutRevision.success).toBe(false);
    expect(issuePaths(withoutRevision)).toContain("expectedSourceRevision");
    const withoutSource = GenerationCommandSchema.safeParse({ prompt: "zwierzęta", expectedSourceRevision: 1, idempotencyKey });
    expect(withoutSource.success).toBe(false);
    expect(issuePaths(withoutSource)).toContain("expectedSourceRevision");
  });

  it("rejects a non-positive or fractional expectedSourceRevision and a malformed sourceMaterialId", () => {
    expect(GenerationCommandSchema.safeParse({ sourceMaterialId, expectedSourceRevision: 0, idempotencyKey }).success).toBe(false);
    expect(GenerationCommandSchema.safeParse({ sourceMaterialId, expectedSourceRevision: 1.5, idempotencyKey }).success).toBe(false);
    expect(GenerationCommandSchema.safeParse({ sourceMaterialId: "nie-uuid", expectedSourceRevision: 1, idempotencyKey }).success).toBe(false);
  });

  it("limits instruction to 500 characters and allows it only with a source", () => {
    expect(MAX_GENERATION_INSTRUCTION_LENGTH).toBe(500);
    const base = { sourceMaterialId, expectedSourceRevision: 1, idempotencyKey };
    expect(GenerationCommandSchema.safeParse({ ...base, instruction: "a".repeat(500) }).success).toBe(true);
    expect(GenerationCommandSchema.safeParse({ ...base, instruction: "a".repeat(501) }).success).toBe(false);
    expect(GenerationCommandSchema.safeParse({ ...base, instruction: "" }).success).toBe(false);
    const withPrompt = GenerationCommandSchema.safeParse({ prompt: "zwierzęta", instruction: "tylko pogoda", idempotencyKey });
    expect(withPrompt.success).toBe(false);
    expect(issuePaths(withPrompt)).toContain("instruction");
  });

  it("forbids locales with a source (the pair is fixed) but keeps them for a prompt", () => {
    const withSource = GenerationCommandSchema.safeParse({
      sourceMaterialId,
      expectedSourceRevision: 1,
      idempotencyKey,
      locales: { source: "pl-PL", target: "en-GB" },
    });
    expect(withSource.success).toBe(false);
    expect(issuePaths(withSource)).toContain("locales");
    expect(
      GenerationCommandSchema.safeParse({ prompt: "zwierzęta", idempotencyKey, locales: { source: "pl-PL", target: "en-GB" } }).success,
    ).toBe(true);
  });

  it("limits the prompt to 4000 characters and keeps it nonempty", () => {
    expect(GenerationCommandSchema.safeParse({ prompt: "a".repeat(4000), idempotencyKey }).success).toBe(true);
    expect(GenerationCommandSchema.safeParse({ prompt: "a".repeat(4001), idempotencyKey }).success).toBe(false);
    expect(GenerationCommandSchema.safeParse({ prompt: "", idempotencyKey }).success).toBe(false);
  });

  it("still tolerates unknown keys in both modes (not strict) and drops them", () => {
    const fromPrompt = GenerationCommandSchema.safeParse({ prompt: "zwierzęta", idempotencyKey, clientHint: "web-1" });
    const fromSource = GenerationCommandSchema.safeParse({ sourceMaterialId, expectedSourceRevision: 1, idempotencyKey, clientHint: "web-1" });
    expect(fromPrompt.success).toBe(true);
    expect(fromSource.success).toBe(true);
    expect(fromPrompt.data).not.toHaveProperty("clientHint");
    expect(fromSource.data).not.toHaveProperty("clientHint");
  });

  it("still validates the shared fields in source mode", () => {
    const base = { sourceMaterialId, expectedSourceRevision: 1, idempotencyKey };
    expect(GenerationCommandSchema.safeParse({ ...base, maxItems: 101 }).success).toBe(false);
    expect(GenerationCommandSchema.safeParse({ ...base, maxItems: 0 }).success).toBe(false);
    expect(GenerationCommandSchema.safeParse({ ...base, idempotencyKey: "short" }).success).toBe(false);
  });
});

describe("GenerationDtoSchema", () => {
  const run = { id, deckId: null, deckVersionId: null, state: "succeeded", attempts: 1, errorCode: null };

  it("carries an optional count of rejected items", () => {
    expect(GenerationDtoSchema.parse(run).rejectedCount).toBeUndefined();
    expect(GenerationDtoSchema.parse({ ...run, rejectedCount: 3 }).rejectedCount).toBe(3);
    expect(GenerationDtoSchema.parse({ ...run, rejectedCount: 0 }).rejectedCount).toBe(0);
    expect(GenerationDtoSchema.parse({ ...run, rejectedCount: null }).rejectedCount).toBeNull();
  });

  it("rejects a negative or fractional rejected count", () => {
    expect(GenerationDtoSchema.safeParse({ ...run, rejectedCount: -1 }).success).toBe(false);
    expect(GenerationDtoSchema.safeParse({ ...run, rejectedCount: 1.5 }).success).toBe(false);
  });
});

describe("DeckSourceDtoSchema", () => {
  const source = { id, title: "Pogoda", copiedRevision: 1, currentRevision: 2 };

  it("is strict with positive revisions", () => {
    expect(DeckSourceDtoSchema.parse(source)).toEqual(source);
    expect(DeckSourceDtoSchema.safeParse({ ...source, body: "tekst" }).success).toBe(false);
    expect(DeckSourceDtoSchema.safeParse({ ...source, copiedRevision: 0 }).success).toBe(false);
    expect(DeckSourceDtoSchema.safeParse({ ...source, currentRevision: 0 }).success).toBe(false);
  });

  it("is the same schema the lesson deck view uses", () => {
    expect(LessonDeckSourceDtoSchema).toBe(DeckSourceDtoSchema);
  });
});

describe("DeckDtoSchema source", () => {
  const deck = { id, title: "Pogoda", state: "draft", draft: null, published: null, generation: null, assignments: [] };

  it("accepts a deck without a source and with one", () => {
    expect(DeckDtoSchema.parse(deck).source).toBeUndefined();
    const source = { id, title: "Pogoda", copiedRevision: 1, currentRevision: 1 };
    expect(DeckDtoSchema.parse({ ...deck, source }).source).toEqual(source);
  });

  it("rejects a malformed source", () => {
    expect(DeckDtoSchema.safeParse({ ...deck, source: { id, title: "Pogoda" } }).success).toBe(false);
  });
});
