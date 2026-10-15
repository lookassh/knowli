import { describe, expect, it } from "vitest";
import * as kid from "./kid";
import { ChildInputSchema, ChildPatchSchema, DraftDtoSchema } from "./decks";
import { GenerationCommandSchema } from "./generation";
import { SessionInputSchema, SessionDtoSchema, KidProfileDtoSchema, KidDeckDtoSchema, TaskDtoSchema, DisclosureDtoSchema } from "./kid";

const id = "00000000-0000-4000-8000-000000000001";

describe("kontrakty zestawu obrazkowego", () => {
  it("udostępnia bezpieczny opis wizualny, wariant zestawu i możliwości sesji", () => {
    expect("MeaningVisualSchema" in kid).toBe(true);
    if (!("MeaningVisualSchema" in kid)) return;
    const meaning = (kid as typeof kid & { MeaningVisualSchema: { safeParse: (value: unknown) => { success: boolean } } }).MeaningVisualSchema;
    expect(meaning.safeParse({ kind: "image", imageAssetId: id }).success).toBe(true);
    expect(meaning.safeParse({ kind: "color", color: "#ff0000" }).success).toBe(true);
    expect(meaning.safeParse({ kind: "number", count: 50 }).success).toBe(true);
    expect(meaning.safeParse({ kind: "image", imageAssetId: "x" }).success).toBe(false);
    expect(meaning.safeParse({ kind: "number", count: 51 }).success).toBe(false);
    expect(ChildInputSchema.parse({ displayName: "Ala", avatarKey: "fox" })).toMatchObject({ canRead: true });
    expect(ChildPatchSchema.safeParse({ canRead: "false" }).success).toBe(false);
    expect(GenerationCommandSchema.parse({ prompt: "zwierzęta", idempotencyKey: "picture-test" })).toMatchObject({ vocabularyFormat: "standard" });
  });

  it("przenosi canRead, cover, resume, disclosure audio, pending attempt i bezpieczne reasons", () => {
    expect(KidProfileDtoSchema.safeParse({ childId: id, displayName: "Ala", avatarKey: "fox", recordingMode: "hold", canRead: false }).success).toBe(true);
    expect(KidDeckDtoSchema.shape).toHaveProperty("coverVisual");
    expect(KidDeckDtoSchema.shape).toHaveProperty("resumeOnly");
    expect(TaskDtoSchema.shape).toHaveProperty("pendingAttemptId");
    expect(DisclosureDtoSchema.shape).toHaveProperty("audioAssetId");
    expect(SessionInputSchema.parse({ childId: id, deckId: id, microphoneEnabled: true })).toMatchObject({ supportsPictureVocabulary: false });
    expect(SessionDtoSchema.shape).toHaveProperty("canRead");
    expect(DraftDtoSchema.shape).toHaveProperty("vocabularyFormat");
    expect("KidValidationReasonSchema" in kid).toBe(true);
  });
});
