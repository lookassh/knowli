import { z } from "zod";
import { UuidSchema } from "./common";

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
  state: z.enum(["pending", "approved", "omitted"]),
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
