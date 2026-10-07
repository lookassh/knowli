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
