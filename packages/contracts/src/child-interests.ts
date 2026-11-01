import { z } from "zod";
import { MAX_CHILD_INTERESTS, MAX_CHILD_INTEREST_LENGTH } from "./limits";

/** Litery i cyfry Unicode, spacja oraz `-`, `'`, `’`, `&`, `.` (bez znaków HTML). */
const INTEREST_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '’&.-]*$/u;

/** NFC, `trim` i zwinięcie białych znaków do jednej spacji — tak samo na kliencie i serwerze. */
export function normalizeChildInterest(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Jedno zainteresowanie dziecka (temat zdań w lekcji). `.overwrite()` normalizuje wartość
 * bez zmiany typu schematu, więc zostaje `ZodString` (bez `.transform`).
 */
export const ChildInterestSchema = z
  .string()
  .overwrite(normalizeChildInterest)
  .min(1)
  .max(MAX_CHILD_INTEREST_LENGTH)
  .regex(INTEREST_PATTERN, { message: "Interest contains unsupported characters" });

/** Lista 0–5 zainteresowań bez duplikatów (po normalizacji, bez względu na wielkość liter). */
export const ChildInterestsSchema = z
  .array(ChildInterestSchema)
  .max(MAX_CHILD_INTERESTS)
  .refine(
    (items) => new Set(items.map((item) => item.toLowerCase())).size === items.length,
    { message: "Interests must be unique" },
  );

/** Czy wartość przechodzi walidację po normalizacji (dla formularzy). */
export function isValidChildInterest(value: string): boolean {
  return ChildInterestSchema.safeParse(value).success;
}

/**
 * Dołącza zainteresowania do listy: normalizuje, pomija puste, niepoprawne i duplikaty
 * (bez względu na wielkość liter), zachowuje kolejność i ucina do limitu.
 */
export function mergeChildInterests(current: readonly string[], added: readonly string[]): string[] {
  const result = [...current];
  const seen = new Set(result.map((item) => item.toLowerCase()));
  for (const candidate of added) {
    if (result.length >= MAX_CHILD_INTERESTS) break;
    const parsed = ChildInterestSchema.safeParse(candidate);
    if (!parsed.success || seen.has(parsed.data.toLowerCase())) continue;
    seen.add(parsed.data.toLowerCase());
    result.push(parsed.data);
  }
  return result;
}
