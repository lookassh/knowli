import { z } from "zod";
import { UuidSchema } from "./common";
import { GenerationDtoSchema } from "./generation";

/**
 * Profil dziecka. Input pochodzi od rodzica; DTO dodaje identyfikator.
 * Ograniczenia odzwierciedlają CHECK-i w learning_app.child_profiles.
 */
export const ChildInputSchema = z.object({
  displayName: z.string().min(1).max(80),
  avatarKey: z.string().min(1).max(40),
  birthYear: z.number().int().min(1900).max(2200).optional(),
});
export type ChildInput = z.infer<typeof ChildInputSchema>;

export const ChildDtoSchema = ChildInputSchema.extend({
  id: UuidSchema,
});
export type ChildDto = z.infer<typeof ChildDtoSchema>;

export const PronunciationAttemptDtoSchema = z.object({
  word: z.string().min(1),
  score: z.number(),
  band: z.enum(["correct", "partial", "below"]).nullable(),
  attemptedAt: z.string().min(1),
});

export const PronunciationSettingsDtoSchema = z.object({
  pronunciationAvailable: z.boolean(),
  thresholds: z.object({ correctMinScore: z.number(), partialMinScore: z.number() }).nullable(),
  attempts: z.array(PronunciationAttemptDtoSchema).max(20),
});

export const PronunciationBandsInputSchema = z.object({
  correctMinScore: z.number().int().min(0).max(100),
  partialMinScore: z.number().int().min(0).max(100),
}).refine((input) => input.correctMinScore > input.partialMinScore, {
  message: "correctMinScore must be greater than partialMinScore",
});

export type PronunciationSettingsDto = z.infer<typeof PronunciationSettingsDtoSchema>;
export type PronunciationBandsInput = z.infer<typeof PronunciationBandsInputSchema>;

export function toChildDto(row: {
  id: string;
  displayName: string;
  avatarKey: string;
  birthYear: number | null;
}): ChildDto {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarKey: row.avatarKey,
    ...(row.birthYear === null ? {} : { birthYear: row.birthYear }),
  };
}

/** Typ wizualizacji: obraz/czynność przez provider, reszta renderowana deterministycznie. */
export const VisualTypeSchema = z.enum(["image", "color", "number", "sequence", "none"]);
export type VisualType = z.infer<typeof VisualTypeSchema>;

export const LocalesSchema = z.object({
  source: z.string().min(2).max(10),
  target: z.string().min(2).max(10),
});
export type Locales = z.infer<typeof LocalesSchema>;

/**
 * Słownik zestawu. `id` opcjonalnie wskazuje istniejący learning_item przy
 * edycji szkicu; brak id oznacza nowy element. Limity z architecture.md §7
 * (120 znaków celu/źródła, 300 przykładu).
 */
export const VocabularyItemInputSchema = z.object({
  id: UuidSchema.optional(),
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  acceptedAnswers: z.array(z.string().min(1).max(120)).max(20),
  locales: LocalesSchema,
  example: z.string().min(1).max(300).optional(),
  visualType: VisualTypeSchema,
  visualData: z.record(z.string(), z.unknown()).optional(),
});
export type VocabularyItemInput = z.infer<typeof VocabularyItemInputSchema>;

export const DraftInputSchema = z.object({
  title: z.string().min(1).max(200),
  items: z.array(VocabularyItemInputSchema).min(1).max(50),
});
export type DraftInput = z.infer<typeof DraftInputSchema>;

/** Edycja szkicu z optimistic locking: wymagany expectedEditNumber. */
export const DraftPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  items: z.array(VocabularyItemInputSchema).min(1).max(50).optional(),
  expectedEditNumber: z.number().int().positive(),
});
export type DraftPatch = z.infer<typeof DraftPatchSchema>;

export const DraftItemDtoSchema = VocabularyItemInputSchema.extend({
  revisionId: UuidSchema,
});
export type DraftItemDto = z.infer<typeof DraftItemDtoSchema>;

export const RevisionAssetDtoSchema = z.object({
  itemRevisionId: UuidSchema,
  role: z.enum(["target_audio", "example_audio", "illustration"]),
  /** failed = wyczerpane próby generacji; rodzic widzi porażkę, nie wieczny spinner */
  state: z.enum(["pending", "approved", "failed", "omitted"]),
  assetId: UuidSchema.nullable(),
});
export type RevisionAssetDto = z.infer<typeof RevisionAssetDtoSchema>;

export const DraftDtoSchema = z.object({
  id: UuidSchema,
  deckId: UuidSchema,
  editNumber: z.number().int().positive(),
  status: z.enum(["draft", "review", "published"]),
  title: z.string(),
  items: z.array(DraftItemDtoSchema),
  assets: z.array(RevisionAssetDtoSchema),
});
export type DraftDto = z.infer<typeof DraftDtoSchema>;

/** Lokalna data rodziny (termin sprawdzianu): YYYY-MM-DD w strefie rodziny. */
export function isFamilyDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const DeckStateSchema = z.enum(["draft", "review", "published", "archived"]);
export type DeckState = z.infer<typeof DeckStateSchema>;

export const DeckSummaryDtoSchema = z.object({
  deckId: UuidSchema,
  title: z.string(),
  state: DeckStateSchema,
  editableVersionId: UuidSchema.nullable(),
  publishedVersionId: UuidSchema.nullable(),
});
export type DeckSummaryDto = z.infer<typeof DeckSummaryDtoSchema>;

export const AssignmentDtoSchema = z.object({
  childId: UuidSchema,
  displayName: z.string(),
  testDate: z.string().nullable(),
  active: z.boolean(),
});
export type AssignmentDto = z.infer<typeof AssignmentDtoSchema>;

/**
 * Widok zestawu dla panelu rodzica: edytowalny szkic (lub null), opublikowana
 * wersja, najnowszy run generacji szkicu oraz przypisania dzieci.
 */
export const DeckDtoSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  state: DeckStateSchema,
  draft: DraftDtoSchema.nullable(),
  published: DraftDtoSchema.nullable(),
  generation: GenerationDtoSchema.nullable(),
  assignments: z.array(AssignmentDtoSchema),
});
export type DeckDto = z.infer<typeof DeckDtoSchema>;

/** PUT /parent/assignments/:childId/:deckId — przypisanie i termin sprawdzianu. */
export const AssignmentPutSchema = z.object({
  testDate: z
    .string()
    .nullable()
    .refine((value) => value === null || isFamilyDate(value), {
      message: "testDate must be YYYY-MM-DD or null",
    }),
});
export type AssignmentPut = z.infer<typeof AssignmentPutSchema>;

export const PublishCommandSchema = z.object({
  expectedEditNumber: z.number().int().positive(),
});
export type PublishCommand = z.infer<typeof PublishCommandSchema>;

export const RevisionAssetCommandSchema = z.object({
  itemRevisionId: UuidSchema,
  role: z.enum(["target_audio", "example_audio", "illustration"]),
});
export type RevisionAssetCommand = z.infer<typeof RevisionAssetCommandSchema>;

export const OmitIllustrationSchema = z.object({
  itemRevisionId: UuidSchema,
});
export type OmitIllustration = z.infer<typeof OmitIllustrationSchema>;
