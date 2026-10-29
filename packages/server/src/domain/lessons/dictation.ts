/**
 * Dyktowanie odpowiedzi otwartej (design szkoły §5.3–5.6): czyste reguły nad
 * wynikiem STT. Dyktowanie nie jest próbą — zwraca tekst do pola odpowiedzi
 * albo powód jego braku, więc niepewne rozpoznanie nigdy nie dochodzi do oceny.
 */

export type DictationStatus = "heard" | "no_speech" | "uncertain" | "too_long" | "unavailable";

export type DictationResult =
  | { status: "heard"; text: string }
  | { status: Exclude<DictationStatus, "heard"> };

/** Wynik STT w kształcie portu `SttProvider` (bez zależności domeny od portów). */
export interface DictationTranscription {
  status: "ok" | "no_speech" | "failed";
  text: string | null;
  confidence: number | null;
}

export interface DictationPolicy {
  /** Poniżej tej pewności tekst nie trafia do pola (gdy provider ją podaje). */
  minConfidence: number;
  /** Limit długości odpowiedzi otwartej (jak dla tekstu). */
  maxLength: number;
  /** Najdłuższe nagranie przyjmowane w lekcji. */
  maxSeconds: number;
  /** Bezpiecznik kosztu: dyktowania na jedną sesję. */
  maxCallsPerSession: number;
}

/**
 * Wartości startowe ze spike'u 2026-10-29 (design §5.1, §5.5): śmieci i cisza
 * 0,00–0,12, poprawna mowa w zdaniach ≥ 0,60. Do kalibracji na głosie dziecka.
 */
export const DEFAULT_DICTATION_POLICY: DictationPolicy = {
  minConfidence: 0.5,
  maxLength: 600,
  maxSeconds: 45,
  maxCallsPerSession: 40,
};

/** Porównywalna postać tekstu: NFC, bez skrajnych i zdublowanych odstępów. */
export function comparableDictationText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function classifyDictation(
  transcription: DictationTranscription,
  policy: DictationPolicy = DEFAULT_DICTATION_POLICY,
): DictationResult {
  if (transcription.status === "failed") return { status: "unavailable" };
  const text = transcription.text === null ? "" : comparableDictationText(transcription.text);
  if (transcription.status === "no_speech" || text === "") return { status: "no_speech" };
  if (transcription.confidence !== null && transcription.confidence < policy.minConfidence) {
    return { status: "uncertain" };
  }
  if ([...text].length > policy.maxLength) return { status: "too_long" };
  return { status: "heard", text };
}

/**
 * Sposób wprowadzenia odpowiedzi zapisywany przy próbie. Deklarację „mowa”
 * przyjmujemy tylko dla zadania, dla którego serwer zwrócił tekst z dyktowania
 * (`dictatedFingerprint`); `edited` = odpowiedź różni się od tego tekstu.
 */
export function resolveInputMethod(args: {
  declared: "keyboard" | "speech" | undefined;
  answerFingerprint: string;
  dictatedFingerprint: string | undefined;
}): { inputMethod: "keyboard" } | { inputMethod: "speech"; edited: boolean } {
  if (args.declared !== "speech" || args.dictatedFingerprint === undefined) return { inputMethod: "keyboard" };
  return { inputMethod: "speech", edited: args.answerFingerprint !== args.dictatedFingerprint };
}
