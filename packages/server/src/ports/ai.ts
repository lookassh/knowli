/**
 * Porty dostawców AI. SDK żyje wyłącznie w adapterach za tymi interfejsami;
 * domena i moduły nie znają Azure/OpenAI. Sygnał przerwania przekazuje worker.
 */

export interface LlmGenerateDeckInput {
  prompt: string;
  sourceLocale: string;
  targetLocale: string;
  maxItems: number;
}

/** Surowy element od LLM; moduł generacji waliduje go Zodem przed zapisem. */
export interface LlmGeneratedItem {
  source: string;
  target: string;
  acceptedAnswers: string[];
  example?: string;
  visualType: "image" | "color" | "number" | "sequence" | "none";
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateDeck(
    input: LlmGenerateDeckInput,
    signal?: AbortSignal,
  ): Promise<{ items: LlmGeneratedItem[] }>;
}

export interface TtsSynthesizeInput {
  text: string;
  locale: string;
  voice: string;
  format: "mp3";
}

export interface TtsProvider {
  readonly name: string;
  readonly model: string;
  synthesize(
    input: TtsSynthesizeInput,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

export interface ImageGenerateInput {
  prompt: string;
  size: string;
}

export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  generate(
    input: ImageGenerateInput,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

/**
 * Krótkotrwałe nagranie dziecka (arch §11). Bajty żyją wyłącznie w pamięci
 * żądania: nie trafiają do bazy, kolejki, plików ani logów.
 */
export interface AudioInput {
  bytes: Uint8Array;
  mimeType: string;
  /** Wariant języka nagrania, np. „en-GB” — serwer nadpisze wartością zestawu. */
  locale: string;
}

/**
 * Wynik zwykłego STT — rozpoznanie treści, nie ocena wymowy (SPEC §23).
 * Wyniki muszą umieć reprezentować brak wiarygodnego rozpoznania: zero ani
 * pusty tekst nie zastępują informacji o ciszy czy awarii.
 */
export interface TranscriptionResult {
  status: "ok" | "no_speech" | "failed";
  text: string | null;
  /** Pewność 0–1, gdy provider ją zwraca; null = usługa jej nie podaje. */
  confidence: number | null;
}

/** Wynik oceny wymowy względem JEDNEGO oczekiwanego tekstu (SPEC §23). */
export interface PronunciationResult {
  status: "ok" | "no_speech" | "failed";
  /** Wynik ogólny w skali providera; null przy ciszy, awarii i niepewności. */
  overallScore: number | null;
  /** Tekst rozpoznany przez usługę wymowy — odrębny od transkrypcji STT. */
  recognizedText: string | null;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: AudioInput, signal?: AbortSignal): Promise<TranscriptionResult>;
}

export interface PronunciationProvider {
  readonly name: string;
  assess(
    audio: AudioInput,
    expectedText: string,
    signal?: AbortSignal,
  ): Promise<PronunciationResult>;
}

/**
 * Dowody z jednego nagrania (zadanie 8). Ocena wymowy wykonuje się względem
 * `expectedText`; wyniku nie przenosi się na inny wypowiedziany wariant.
 */
export interface SpeechEvidence {
  sttProvider: string;
  transcription: TranscriptionResult;
  pronunciation: (PronunciationResult & { provider: string; expectedText: string }) | null;
}
