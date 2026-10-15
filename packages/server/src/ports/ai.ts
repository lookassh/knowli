/**
 * Porty dostawców AI. SDK żyje wyłącznie w adapterach za tymi interfejsami;
 * domena i moduły nie znają Azure/OpenAI. Sygnał przerwania przekazuje worker.
 */

export interface LlmGenerateDeckInput {
  prompt: string;
  sourceLocale: string;
  targetLocale: string;
  maxItems: number;
  vocabularyFormat?: "standard" | "picture";
}

/** Surowy element od LLM; moduł generacji waliduje go Zodem przed zapisem. */
export interface LlmGeneratedItem {
  source: string;
  target: string;
  acceptedAnswers: string[];
  example?: string;
  visualType: "image" | "color" | "number" | "sequence" | "none";
  visualData?: Record<string, unknown>;
}

/**
 * Wejście generacji puli lekcji (design „Generowanie puli (worker)”). Port nie
 * zna żadnego przedmiotu ani gramatyki — dostaje opis przedmiotu, celów,
 * dozwolone typy i materiał jako zwykłe dane, a adapter składa z nich prompt.
 * Przedmiot opisany polami (`subjectTitle`, `promptProfile`, `answerLocale`,
 * `promptLocale`, `exerciseTypes`, `transforms`), nie obiektem `SubjectModule`,
 * żeby adapter nie zależał od domeny lekcji.
 */
export interface LlmLessonObjectiveInput {
  readonly id: string;
  readonly descriptionEn: string;
  readonly exerciseTypes: readonly string[];
  readonly errorCategories: readonly string[];
}

export interface LlmLessonTransformInput {
  readonly id: string;
  readonly instructionPl: string;
}

export interface LlmPromptProfileInput {
  readonly generationRole: string;
  readonly gradingRole: string;
  readonly almostDefinition: string;
  /** Dziedzinowe reguły semantyki pól ćwiczeń (opcjonalne, od przedmiotu). */
  readonly fieldRules?: string;
}

/** Ile ćwiczeń danego etapu wygenerować dla jednego celu (partia per cel). */
export interface LlmLessonStageCounts {
  readonly guided: number;
  readonly productive: number;
  readonly independent: number;
}

export interface LessonPoolInput {
  readonly subjectId: string;
  readonly subjectTitle: string;
  readonly answerLocale: string;
  readonly promptLocale: string;
  readonly promptProfile: LlmPromptProfileInput;
  /** Typy wspierane przez przedmiot (ograniczenie dla modelu). */
  readonly exerciseTypes: readonly string[];
  /** Przekształcenia dostępne w temacie (dla `lesson_transform`). */
  readonly transforms: readonly LlmLessonTransformInput[];
  /** Cele tej partii — zwykle jeden (generacja per cel). */
  readonly objectives: readonly LlmLessonObjectiveInput[];
  readonly material: string;
  readonly instruction?: string;
  /** Łączna liczba ćwiczeń per cel i jej rozkład na etapy. */
  readonly countPerObjective: number;
  readonly stageCounts: LlmLessonStageCounts;
  readonly graderAvailable: boolean;
  /** Tożsamość duplikatu w obrębie puli; domyślnie zgodność odpowiedzi. */
  readonly deduplication?: "answer" | "exercise";
  /** Odpowiedzi już w puli (dla dogenerowania bez duplikatów). */
  readonly existingAnswers?: readonly string[];
  /** Bodźce już w puli, używane gdy przedmiot deduplikuje całe ćwiczenia. */
  readonly existingExercises?: readonly { objectiveId: string; exerciseType: string; stimulus: string }[];
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateDeck(
    input: LlmGenerateDeckInput,
    signal?: AbortSignal,
  ): Promise<{ items: LlmGeneratedItem[] }>;
  /**
   * Generacja surowej puli ćwiczeń jednego celu (design „Generowanie puli”).
   * Zwraca surowe ćwiczenia (walidacja w domenie, `pool-validation.ts`) oraz
   * przykłady per cel do kart lekcji. Port nie waliduje kształtu.
   */
  generateLessonPool(
    input: LessonPoolInput,
    signal?: AbortSignal,
  ): Promise<{ exercises: unknown[]; examples: Record<string, string[]> }>;
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
  model: string;
  size: string;
  quality: string;
  format: string;
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

/** Pojedynczy fonem oceny wymowy (Azure, Granularity Phoneme). */
export interface PronunciationPhoneme {
  phoneme: string;
  accuracyScore: number | null;
}

/** Jedno słowo oceny wymowy z fonemami; ErrorType null = bez zastrzeżeń. */
export interface PronunciationWord {
  text: string;
  accuracyScore: number | null;
  errorType: string | null;
  phonemes: PronunciationPhoneme[];
}

/** Wynik oceny wymowy względem JEDNEGO oczekiwanego tekstu (SPEC §23). */
export interface PronunciationResult {
  status: "ok" | "no_speech" | "failed";
  /** Wynik ogólny w skali providera; null przy ciszy, awarii i niepewności. */
  overallScore: number | null;
  /** Tekst rozpoznany przez usługę wymowy — odrębny od transkrypcji STT. */
  recognizedText: string | null;
  /** Szczegóły fonemów, jeśli provider je zwraca. */
  words?: PronunciationWord[];
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: AudioInput, signal?: AbortSignal): Promise<TranscriptionResult>;
}

/**
 * Wejście modelu oceniającego (design „Model oceniający”, `GraderInput`). Port
 * nie zna gramatyki ani przedmiotu — adapter dostaje gotowe fragmenty profilu
 * przedmiotu, polecenie, bodziec, opis celu z kategoriami oraz odpowiedź
 * dziecka JAKO DANE. Odpowiedź dziecka trafia wyłącznie do wiadomości `user`;
 * nigdy do promptu systemowego ani do logów.
 */
export interface GraderInput {
  readonly subjectTitle: string;
  readonly topicTitle: string;
  readonly roleProfile: {
    readonly gradingRole: string;
    readonly almostDefinition: string;
  };
  readonly instruction: string;
  readonly stimulus: string | null;
  readonly objective: {
    readonly description: string;
    readonly errorCategories: readonly { readonly code: string; readonly label: string }[];
  };
  /** Zatwierdzone warianty poprawnej odpowiedzi (dane referencyjne). */
  readonly acceptedAnswers: readonly string[];
  /** Odpowiedź dziecka ≤ 200 znaków, przekazywana jako dane. */
  readonly childAnswer: string;
}

/**
 * Model oceniający zgodny z OpenAI (design „Model oceniający”). Zwraca SUROWY
 * obiekt JSON — walidację robi domena (`validateVerdict`), żeby adapter nie
 * interpretował treści. `promptVersion` jest stałą adaptera i wchodzi do klucza
 * cache werdyktów (zmiana promptu unieważnia zapisane werdykty).
 */
export interface AnswerGraderProvider {
  readonly name: string;
  readonly model: string;
  readonly promptVersion: string;
  grade(input: GraderInput, signal: AbortSignal): Promise<unknown>;
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
