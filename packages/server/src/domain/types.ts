/**
 * Kody umiejętności MVP. Rejestr jest otwarty na przyszłe rozszerzenia
 * (architecture.md §15), ale historia nie zakłada niczego poza tą piątką.
 */
export const SKILLS = [
  "listening",
  "reading",
  "recall",
  "pronunciation",
  "spelling",
] as const;

export type Skill = (typeof SKILLS)[number];

export function isSkill(value: string): value is Skill {
  return (SKILLS as readonly string[]).includes(value);
}
