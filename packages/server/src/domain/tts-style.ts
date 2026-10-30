import type { LessonVoiceTone } from "@learning/contracts";

/** Rola komunikatu lub nagrania lekcji, od której zależy styl wypowiedzi TTS (spec tonu TTS §2.1). */
export type TtsRoleStyle =
  | "ui_praise" | "ui_gentle" | "ui_guidance" | "ui_closing"
  | "lesson_question" | "lesson_card";

/** Semantyczny styl wypowiedzi: rola albo ton lekcji; zdanie dla modelu dobiera profil przy adapterze. */
export type TtsStyle = TtsRoleStyle | LessonVoiceTone;

/**
 * Liczba zdań w tekście nagrania (spec tonu TTS §4.3): po normalizacji odstępów zdanie to fragment
 * zakończony `.`, `!`, `?` lub `…` (albo końcem tekstu). Ciąg znaków kończących, np. „…?”, to jedna granica;
 * znak kończący liczy się, gdy po nim jest odstęp lub koniec tekstu (kropka w „3.5” nie dzieli).
 */
export function sentenceCount(text: string): number {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/[.!?…]+(?=\s|$)/)
    .filter((fragment) => /[^\s.!?…]/.test(fragment))
    .length;
}

/**
 * Styl nagrania pytania lub karty lekcji: ton autora, a bez niego rola. Reguła szeptu: `mysterious`
 * dla tekstu z mniej niż dwoma zdaniami daje `curious` (spec tonu TTS §4.3).
 */
export function lessonPromptStyle(
  role: "lesson_question" | "lesson_card",
  tone: LessonVoiceTone | undefined,
  text: string,
): TtsStyle {
  if (!tone) return role;
  if (tone === "mysterious" && sentenceCount(text) < 2) return "curious";
  return tone;
}
