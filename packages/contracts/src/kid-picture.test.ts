import { describe, expect, it } from "vitest";
import * as kid from "./kid";
import { ChildInputSchema, ChildPatchSchema, DraftDtoSchema } from "./decks";
import { GenerationCommandSchema } from "./generation";
import { SessionInputSchema, SessionDtoSchema, KidProfileDtoSchema, KidDeckDtoSchema, TaskDtoSchema, DisclosureDtoSchema, FeedbackDtoSchema } from "./kid";
import { TaskPromptSchema } from "./kid";

const id = "00000000-0000-4000-8000-000000000001";

describe("kontrakty zestawu obrazkowego", () => {
  it("udostępnia bezpieczny opis wizualny, wariant zestawu i możliwości sesji", () => {
    expect("MeaningVisualSchema" in kid).toBe(true);
    if (!("MeaningVisualSchema" in kid)) return;
    const meaning = (kid as typeof kid & { MeaningVisualSchema: { safeParse: (value: unknown) => { success: boolean } } }).MeaningVisualSchema;
    expect(meaning.safeParse({ kind: "image", imageAssetId: id }).success).toBe(true);
    expect(meaning.safeParse({ kind: "color", color: "#ff0000" }).success).toBe(true);
    expect(meaning.safeParse({ kind: "number", count: 0 }).success).toBe(true);
    expect(meaning.safeParse({ kind: "number", count: 50 }).success).toBe(true);
    expect(meaning.safeParse({ kind: "number", count: 0 }).success).toBe(true);
    expect(meaning.safeParse({ kind: "image", imageAssetId: "x" }).success).toBe(false);
    expect(meaning.safeParse({ kind: "number", count: -1 }).success).toBe(false);
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

  it("akceptuje od dwóch do czterech opcji obrazkowych i odrzuca większą liczbę", () => {
    const options = [
      { id, labelPl: "jeden", visual: { kind: "number", count: 1 } },
      { id: "00000000-0000-4000-8000-000000000002", labelPl: "dwa", visual: { kind: "number", count: 2 } },
      { id: "00000000-0000-4000-8000-000000000003", labelPl: "czerwony", visual: { kind: "color", color: "#ff0000" } },
      { id: "00000000-0000-4000-8000-000000000004", labelPl: "kot", visual: { kind: "image", imageAssetId: "00000000-0000-4000-8000-000000000005" } },
      { id: "00000000-0000-4000-8000-000000000006", labelPl: "pies", visual: { kind: "image", imageAssetId: "00000000-0000-4000-8000-000000000007" } },
    ];
    const prompt = (count: number) => ({ kind: "picture_listening", audioAssetId: id, options: options.slice(0, count) });
    for (const count of [2, 3, 4]) expect(TaskPromptSchema.safeParse(prompt(count)).success).toBe(true);
    expect(TaskPromptSchema.safeParse(prompt(5)).success).toBe(false);
  });

  it("picture_recognition: obrazek + polski podpis + 2–4 angielskie słowa, bez audio", () => {
    const words = ["horse", "house", "mouse", "door", "shore"];
    const options = (count: number) => words.slice(0, count).map((text, index) => ({
      id: index === 0 ? id : `00000000-0000-4000-8000-00000000000${index + 1}`,
      text,
    }));
    const prompt = (count: number) => ({
      kind: "picture_recognition",
      visual: { kind: "image", imageAssetId: "00000000-0000-4000-8000-000000000010" },
      source: "koń",
      options: options(count),
    });
    for (const count of [2, 3, 4]) expect(TaskPromptSchema.safeParse(prompt(count)).success).toBe(true);
    expect(TaskPromptSchema.safeParse(prompt(1)).success).toBe(false);
    expect(TaskPromptSchema.safeParse(prompt(5)).success).toBe(false);
    expect(TaskPromptSchema.safeParse({ ...prompt(2), audioAssetId: id }).success).toBe(false);
    expect(TaskPromptSchema.safeParse({ ...prompt(2), source: "" }).success).toBe(false);
    expect(TaskPromptSchema.safeParse({ ...prompt(2), visual: { kind: "image" } }).success).toBe(false);
  });

  it("FeedbackDto.correctAudioAssetId: opcjonalny UUID, niedozwolony przy not_assessed", () => {
    const base = { kind: "great" as const };
    expect(FeedbackDtoSchema.safeParse({ ...base, correctAudioAssetId: id }).success).toBe(true);
    expect(FeedbackDtoSchema.safeParse({ ...base, correctAudioAssetId: "x" }).success).toBe(false);
    expect(FeedbackDtoSchema.safeParse({ kind: "not_assessed", correctAudioAssetId: id }).success).toBe(false);
    expect(FeedbackDtoSchema.safeParse({ kind: "not_assessed" }).success).toBe(true);
  });

  it("SessionInput: supportsPictureRecognition domyślnie false dla starszego klienta", () => {
    expect(SessionInputSchema.parse({ childId: id, deckId: id, microphoneEnabled: true }))
      .toMatchObject({ supportsPictureVocabulary: false, supportsPictureRecognition: false });
    expect(SessionInputSchema.parse({ childId: id, deckId: id, microphoneEnabled: true, supportsPictureRecognition: true }))
      .toMatchObject({ supportsPictureRecognition: true });
  });
});
