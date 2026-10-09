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

/** Częściowa edycja danych profilu, bez zmiany tożsamości i historii. */
export const ChildPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  avatarKey: z.string().min(1).max(40).optional(),
}).strict().refine((input) => input.displayName !== undefined || input.avatarKey !== undefined, {
  message: "At least one profile field is required",
});
export type ChildPatch = z.infer<typeof ChildPatchSchema>;

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

export const ColorVisualDataSchema = z.object({
  color: z.string().regex(/^#[\da-f]{6}$/i),
}).strict();
export const NumberVisualDataSchema = z.object({
  count: z.number().int().min(1).max(50),
}).strict();
export const SequenceVisualDataSchema = z.object({
  position: z.number().int().min(1).max(12),
  total: z.number().int().min(1).max(12),
  sequenceStart: z.string().min(1).max(40),
}).strict().refine(({ position, total }) => position <= total);

const WEEKDAY_POSITIONS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const ENGLISH_NUMBER_VALUES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

const ENGLISH_NUMBER_UNITS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const ENGLISH_COLOR_HEXES: Record<string, string> = {
  red: "#ff0000",
  blue: "#0000ff",
  green: "#008000",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  black: "#000000",
  white: "#ffffff",
  brown: "#a52a2a",
  gray: "#808080",
  grey: "#808080",
};

function knownEnglishNumber(target: string | undefined): number | undefined {
  const word = target?.trim().toLowerCase().replace(/[\s-]/g, "");
  if (!word) return undefined;
  if (/^\d+$/.test(word)) {
    const numeric = Number(word);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 50 ? numeric : undefined;
  }
  const exact = ENGLISH_NUMBER_VALUES[word];
  if (exact !== undefined) return exact;
  for (const [tensWord, tensValue] of Object.entries(ENGLISH_NUMBER_VALUES)) {
    if (tensValue < 20 || tensValue % 10 !== 0 || !word.startsWith(tensWord)) continue;
    const unitValue = ENGLISH_NUMBER_UNITS[word.slice(tensWord.length) ?? ""];
    if (unitValue !== undefined) return tensValue + unitValue;
  }
  return undefined;
}

/** Waliduje dane rendererów deterministycznych przy granicy kontraktu. */
export function isVisualDataValid(
  visualType: VisualType,
  visualData: Record<string, unknown> | undefined,
  target?: string,
): boolean {
  if (visualData === undefined) {
    return visualType !== "color" && visualType !== "number" && visualType !== "sequence";
  }
  switch (visualType) {
    case "color": {
      const parsed = ColorVisualDataSchema.safeParse(visualData);
      if (!parsed.success) return false;
      const expectedColor = target === undefined ? undefined : ENGLISH_COLOR_HEXES[target.trim().toLowerCase()];
      return expectedColor === undefined || parsed.data.color.toLowerCase() === expectedColor;
    }
    case "number": {
      const parsed = NumberVisualDataSchema.safeParse(visualData);
      if (!parsed.success) return false;
      const expectedCount = knownEnglishNumber(target);
      return expectedCount === undefined || parsed.data.count === expectedCount;
    }
    case "sequence": {
      const parsed = SequenceVisualDataSchema.safeParse(visualData);
      if (!parsed.success) return false;
      const weekdayPosition = target === undefined ? undefined : WEEKDAY_POSITIONS[target.trim().toLowerCase()];
      if (weekdayPosition === undefined) return true;
      return parsed.data.position === weekdayPosition &&
        parsed.data.total === 7 &&
        parsed.data.sequenceStart.trim().toLowerCase() === "monday";
    }
    case "image":
    case "none":
      return true;
  }
}

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
}).refine((item) => isVisualDataValid(item.visualType, item.visualData, item.target), {
  path: ["visualData"],
  message: "visualData does not match visualType",
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
