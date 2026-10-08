import { z } from "zod";
import { DaySchema, InstantSchema, UuidSchema } from "./common";
import { AttemptModalitySchema } from "./kid";

/**
 * Kontrakty panelu postępów rodzica (SPEC §25, architecture.md §12:
 * GET /api/v1/parent/progress?childId=&deckId=). Raport pokazuje wyłącznie
 * dane dziecka i zestawu — bez kluczy odpowiedzi, promptów ani surowych
 * odpowiedzi usług.
 */

/** Kolejność umiejętności w raporcie zgodna z rejestr domenowym. */
export const REPORT_SKILLS = ["listening", "reading", "recall", "pronunciation", "spelling"] as const;
export type ReportSkill = (typeof REPORT_SKILLS)[number];

/**
 * Status umiejętności elementu. Wartości odpowiadają projekcji zadań 5–8;
 * `needs_confirmation` oznacza także umiejętność wymagającą ponownego
 * sprawdzenia po zmianie znaczenia materiału (SPEC §90) — wtedy element
 * ma `meaningChanged`.
 */
export const ItemSkillStatusSchema = z.enum([
  "mastered",
  "needs_confirmation",
  "needs_reconfirmation",
  "practicing",
  "not_assessed",
]);
export type ItemSkillStatus = z.infer<typeof ItemSkillStatusSchema>;

/** Podsumowanie jednej umiejętności: liczba elementów w każdym statusie. */
export const SkillReportDtoSchema = z.object({
  skill: z.enum(REPORT_SKILLS),
  totalItems: z.number().int().nonnegative(),
  /** Opanowane z potwierdzeniem po przerwie. */
  mastered: z.number().int().nonnegative(),
  /** Seria sukcesów gotowa do potwierdzenia lub ponowne sprawdzenie po zmianie. */
  needsConfirmation: z.number().int().nonnegative(),
  /** Było opanowane; po błędzie wymaga ponownego potwierdzenia (SPEC §20). */
  needsReconfirmation: z.number().int().nonnegative(),
  /** Ćwiczone, seria sukcesów niepełna. */
  practicing: z.number().int().nonnegative(),
  /** Bez wiarygodnej oceny. */
  notAssessed: z.number().int().nonnegative(),
});
export type SkillReportDto = z.infer<typeof SkillReportDtoSchema>;

/** Status jednego elementu zestawu per umiejętność. */
export const ProgressItemDtoSchema = z.object({
  itemId: UuidSchema,
  position: z.number().int().nonnegative(),
  source: z.string(),
  target: z.string(),
  skills: z.record(z.enum(REPORT_SKILLS), ItemSkillStatusSchema),
  /** Zmiana znaczenia materiału unieważniła co najmniej jedną umiejętność. */
  meaningChanged: z.boolean(),
});
export type ProgressItemDto = z.infer<typeof ProgressItemDtoSchema>;

/** Najczęstsza pomyłka z zachowaniem kierunku (SPEC §21). */
export const ConfusionDtoSchema = z.object({
  expected: z.string().min(1),
  answered: z.string().min(1),
  count: z.number().int().positive(),
});
export type ConfusionDto = z.infer<typeof ConfusionDtoSchema>;

/**
 * Automatyczny wynik wymowy konkretnej usługi (SPEC §25). Score pochodzi
 * z jednej usługi i jej skali — raport nie uśrednia nieporównywalnych skal.
 */
export const PronunciationScoreDtoSchema = z.object({
  target: z.string().min(1),
  provider: z.string().min(1),
  score: z.number(),
  /** Pasma obecne wyłącznie po kalibracji w próbie technicznej (zadanie 0). */
  band: z.enum(["correct", "partial", "below"]).optional(),
  assessedAt: InstantSchema,
});
export type PronunciationScoreDto = z.infer<typeof PronunciationScoreDtoSchema>;

/** Wpis historii prób: słowa z rewizji, której dotyczyła próba. */
export const HistoryEntryDtoSchema = z.object({
  receivedAt: InstantSchema,
  source: z.string(),
  target: z.string(),
  skill: z.enum(REPORT_SKILLS),
  outcome: z.enum(["correct", "incorrect", "unassessed"]),
  independent: z.boolean(),
  modality: AttemptModalitySchema,
});
export type HistoryEntryDto = z.infer<typeof HistoryEntryDtoSchema>;

export const ProgressDtoSchema = z.object({
  childId: UuidSchema,
  childName: z.string(),
  deckId: UuidSchema,
  deckTitle: z.string(),
  /** Termin sprawdzianu z przypisania; null bez przypisania lub terminu. */
  testDate: DaySchema.nullable(),
  totalItems: z.number().int().nonnegative(),
  skills: z.array(SkillReportDtoSchema),
  items: z.array(ProgressItemDtoSchema),
  confusions: z.array(ConfusionDtoSchema),
  pronunciation: z.object({
    /** false → panel pokazuje „Nie sprawdzono” (SPEC §25). */
    assessed: z.boolean(),
    latestScores: z.array(PronunciationScoreDtoSchema),
  }),
  /** Najnowsze próby najpierw; słowa mogą pochodzić ze starszych rewizji. */
  history: z.array(HistoryEntryDtoSchema),
});
export type ProgressDto = z.infer<typeof ProgressDtoSchema>;
