import { ttsInstructionsFor, type MediaSettings } from "../config";
import type { TtsStyle } from "../domain/tts-style";

/** Zdania stylu dla pl-PL (spec tonu TTS §3.2); każde ≤ 120 znaków. Dopisywane do instrukcji języka. */
export const STYLE_SENTENCES_PL: Readonly<Record<TtsStyle, string>> = {
  ui_praise: "Powiedz radośnie, z uśmiechem w głosie, jak do ośmiolatka.",
  ui_gentle: "Powiedz ciepło i spokojnie, bez rozczarowania w głosie.",
  ui_guidance: "Powiedz przyjaźnie i zachęcająco, wyraźnie.",
  ui_closing: "Powiedz ciepło i z zadowoleniem.",
  lesson_question: "Przeczytaj przyjaźnie, spokojnym tempem i wyraźnie.",
  lesson_card: "Przeczytaj jak ciepły nauczyciel, który opowiada, spokojnym tempem.",
};

/**
 * Instrukcja dla modelu TTS: instrukcja języka (etap 1) plus zdanie stylu.
 * Bez stylu, dla locale innego niż pl-PL albo przy `tts.style !== "instructions"` wynik to dokładnie
 * `ttsInstructionsFor` — fingerprinty słówek i nagrań bez stylu pozostają jak przed wprowadzeniem stylu.
 * Nigdy nie zwraca pustego łańcucha.
 */
export function ttsRequestInstructions(
  tts: MediaSettings["tts"],
  locale: string,
  style?: TtsStyle,
): string | undefined {
  const language = ttsInstructionsFor(tts, locale);
  if (!style || locale !== "pl-PL" || tts.style !== "instructions") return language;
  const joined = [language, STYLE_SENTENCES_PL[style]].filter(Boolean).join(" ");
  return joined || undefined;
}
