/**
 * Porty dostawców AI. SDK żyje wyłącznie w adapterach za tymi interfejsami;
 * domena i moduły nie znają Azure/OpenAI. Sygnał przerwania przekazuje worker.
 */

/**
 * Wejście generacji zestawu słówek. Tryb „z opisu”: `prompt` rodzica, model
 * dobiera słowa do tematu. Tryb ze źródła (design 2026-10-30 §6.2): tekst źródła
 * w `material` i opcjonalne zawężenie `instruction` — model ma wypisać wyłącznie
 * słowa z tekstu, ale gwarancją jest walidacja per element w module generacji.
 */
export type LlmGenerateDeckInput = {
  sourceLocale: string;
  targetLocale: string;
  maxItems: number;
  vocabularyFormat?: "standard" | "picture";
} & ({ prompt: string } | { material: string; instruction?: string });

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
  /** Dydaktyka zagadnienia katalogu dla promptu paczki przebiegu bazowego (`LearningObjective.generationNotesEn`). */
  readonly generationNotesEn?: string;
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
  /** Semantyka typów par, grup i luk (opcjonalna, od przedmiotu); adapter dokłada ją do części strukturalnej bloku. */
  readonly typeRules?: Partial<Record<string, string>>;
  /** Reguła użycia tematów zdań (opcjonalna, od przedmiotu); adapter dokłada ją do promptu systemowego tylko razem z `interests`. */
  readonly interestsRule?: string;
}

/** Ile ćwiczeń danego etapu wygenerować dla jednego celu (cele etapów paczki przebiegu bazowego). */
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
  /** Cele wejścia — w wejściu paczki dokładnie jeden (jej zagadnienie). */
  readonly objectives: readonly LlmLessonObjectiveInput[];
  readonly material: string;
  readonly instruction?: string;
  /** Tematy zdań z zainteresowań dziecka (dane od rodzica); adapter wstawia je do wiadomości użytkownika tylko przy `promptProfile.interestsRule`. */
  readonly interests?: readonly string[];
  /** Łączna liczba ćwiczeń per cel i jej rozkład na etapy. */
  readonly countPerObjective: number;
  readonly stageCounts: LlmLessonStageCounts;
  /**
   * Ile DODATKOWYCH ćwiczeń `lesson_listen_choice` (0–2) wolno wygenerować na cel: leżą poza
   * podziałem etapów i poza `countPerObjective`, a prompt podnosi o nie limit ćwiczeń celu. Brak pola =
   * adapter nie prosi o ten typ (przedmiot bez nagrań zdań albo cel bez typu na liście).
   */
  readonly listenChoicePerObjective?: number;
  /** Ile miejsc etapu samodzielnego zastrzec dla różnych pytań otwartych (przedmioty v3). */
  readonly minDistinctOpenAnswers?: number;
  /** Czy każde ćwiczenie MUSI nieść cytaty źródłowe z materiału (przedmioty z uziemieniem). */
  readonly groundingRequired?: boolean;
  /**
   * Limit długości `answer` i wariantów `acceptedAnswers` przedmiotu (ten sam, którym posługuje się walidacja i
   * opis reguły `answer.max_length`); schemat narzędzia bierze go stąd.
   */
  readonly answerMaxLength: number;
  /** Tożsamość duplikatu w obrębie puli; domyślnie zgodność odpowiedzi. */
  readonly deduplication?: "answer" | "exercise";
  /** Czy generator ma zwracać `voiceTone` ćwiczenia (przedmiot z `ttsForPrompts`); bez flagi schemat i prompt nie mają pola. */
  readonly voiceTones?: boolean;
  /** Czy generator ma zwracać `explanationPl` ćwiczenia (przedmiot z `exerciseExplanations`); bez flagi schemat i prompt nie mają pola. */
  readonly exerciseExplanations?: boolean;
  /**
   * Zdania, których rozwiązania dziecko już widziało (przykłady kart, ćwiczenia niesamodzielne):
   * generator nie powinien używać ich jako odpowiedzi ćwiczeń samodzielnych. Porównanie fake'a
   * po `toLowerCase().trim()` bez końcowej kropki; brak pola = bez ograniczeń.
   */
  readonly avoidSentences?: readonly string[];
  /**
   * Księga reguł zagadnienia (domenowa `lessonRuleBook`, spec katalogu reguł §3): karty typów i opisy
   * reguł, które sprawdza walidacja przebiegu bazowego. Adapter tylko ją renderuje; nie dopisuje własnych reguł.
   */
  readonly ruleBook: LessonRuleBookInput;
}

/** Wiersz księgi reguł: id reguły (nazywa ją odrzucenie) i jej opis dla modelu, po angielsku. */
export interface LessonRuleBookLine {
  readonly id: string;
  readonly text: string;
  /** Pomijana w prompcie (kształt rekordu, powtórzenie listy pól karty typu); renderer daje za nie jedno zdanie o schemacie wyjścia. */
  readonly brief?: boolean;
}

/** Blok typu ćwiczenia w księdze reguł: karta typu, semantyka typu przedmiotu i reguły tylko tego typu. */
export interface LessonRuleBookTypeBlock {
  readonly type: string;
  readonly summary: string;
  /** Przykład rekordu w JSON. */
  readonly example?: string;
  readonly subjectRule?: string;
  readonly rules: readonly LessonRuleBookLine[];
}

/**
 * Księga reguł jako zwykłe dane (port nie zna domeny lekcji; strukturalnie `RuleBook` z
 * `domain/lessons/rules/rule-book.ts`).
 */
export interface LessonRuleBookInput {
  readonly general: readonly LessonRuleBookLine[];
  readonly types: readonly LessonRuleBookTypeBlock[];
}

/**
 * Wejście generacji zagadnień tematu dynamicznego (przedmioty szkolne):
 * model wyprowadza z materiału cele nauki z kartami. Zwraca surowe obiekty;
 * kształt i semantykę waliduje serwer (Zod + reguły katalogu).
 */
export interface LessonObjectivesInput {
  readonly subjectTitle: string;
  readonly topicTitle: string;
  readonly material: string;
  readonly instruction?: string;
  readonly generationRole: string;
  /** Czy karty zagadnień niosą `voiceTone` (przedmiot z `ttsForPrompts`); bez flagi schemat i prompt nie mają pola. */
  readonly voiceTones?: boolean;
  /** Reguły zagadnień przedmiotu (rozdział): schemat wymaga wtedy `kind`, a prompt bierze liczbę i format kart z reguł. */
  readonly objectivesRules?: string;
}

/**
 * Wejście generacji historyjki na koniec sesji lekcji (design „Historyjka
 * lekcji”): temat, cele, materiał rodzica i zasady przedmiotu. Bez danych
 * dziecka. `avoidSentences` to rozwiązane zdania puli ćwiczeń wersji (bariera
 * ekspozycji), których model ma nie powtarzać.
 */
export interface LessonStoryInput {
  readonly subjectTitle: string;
  readonly topicTitle: string;
  readonly answerLocale: string;
  readonly promptLocale: string;
  readonly objectives: readonly { readonly id: string; readonly descriptionEn: string }[];
  readonly material: string;
  readonly instruction?: string;
  readonly generationRole: string;
  readonly storyRules: string;
  readonly avoidSentences: readonly string[];
}

/**
 * Licznik kosztu runu generowania puli lekcji. Adapter zgłasza KAŻDE żądanie HTTP, także nieudane i
 * ponowione: kwotę w USD albo `null`, gdy koszt jest nieznany (przebieg liczy wtedy szacunek), raz
 * na wywołanie modelu, zaraz po odpowiedzi. Przebieg nigdy nie woła `UsageRecorder` — robi to
 * adapter z tego samego zdarzenia.
 */
export interface RunCostSink {
  record(usd: number | null): void;
}

/**
 * Wejście paczki przebiegu bazowego (spec etapu 2 §3–§4): jedno zagadnienie i jeden typ ćwiczenia.
 * `pool` buduje moduł dla jednego typu (księga reguł tego typu); adapter
 * tylko renderuje prompt.
 */
export interface LessonPacketInput {
  readonly pool: LessonPoolInput;
  readonly objective: {
    readonly id: string;
    readonly title: string;
    readonly cards: readonly { readonly title: string; readonly body: string }[];
  };
  readonly type: string;
  readonly count: number;
  /** Pierwsza paczka zagadnienia zwraca też 1–3 przykłady kart. */
  readonly withExamples: boolean;
  readonly timeoutMs: number;
}

/** Generator paczki przebiegu bazowego: surowe rekordy bez zmian (kształt i reguły sprawdza moduł). */
export interface LessonPacketGenerator {
  generatePacket(input: LessonPacketInput, cost: RunCostSink, signal: AbortSignal): Promise<{ readonly exercises: readonly unknown[]; readonly examples?: readonly unknown[] }>;
}

/**
 * Kontrola zadań zamkniętych (spec etapu 2 §2): widoki dziecka bez klucza i celu. Wynik per
 * pozycja jako `unknown` (schemat i porównanie w domenie, `closed-check.ts`); przy innej liczbie
 * wyników niż pozycji wszystkie `undefined`.
 */
export interface ClosedCheckInput {
  readonly contract: "choice" | "order";
  readonly items: readonly { readonly view: string }[];
  readonly timeoutMs: number;
  /** Materiał lekcji — tylko przedmiot z `SubjectModule.checkerNeedsMaterial` (szkoła, etap 5b §5.2). */
  readonly material?: string;
}

export interface ClosedExerciseChecker {
  checkClosed(input: ClosedCheckInput, cost: RunCostSink, signal: AbortSignal): Promise<{ readonly results: readonly unknown[] }>;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateDeck(
    input: LlmGenerateDeckInput,
    signal?: AbortSignal,
  ): Promise<{ items: LlmGeneratedItem[] }>;
  generateLessonObjectives(
    input: LessonObjectivesInput,
    signal?: AbortSignal,
  ): Promise<{ objectives: unknown[] }>;
  /**
   * Generacja historyjki: surowy obiekt `{ sentences: string[], questions:
   * { question, options: string[], correctOptionIndex }[] }`; mapowanie na
   * `LessonStory` i walidacja semantyczna należą do przypadku użycia.
   */
  generateLessonStory(
    input: LessonStoryInput,
    signal?: AbortSignal,
  ): Promise<{ story: unknown }>;
}

/** `wav` = PCM od providera opakowane w WAV (Gemini TTS); `mp3` = gotowy plik providera. */
export type TtsFormat = "mp3" | "wav";

export interface TtsSynthesizeInput {
  text: string;
  locale: string;
  voice: string;
  format: TtsFormat;
  /** Model zapisany w zasobie (fingerprint); brak = model adaptera. */
  model?: string;
  /** Instrukcja wymowy zapisana w zasobie (np. język); nie jest czytana na głos. */
  instructions?: string;
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
  /**
   * Czas nagrania w ms z metadanych (ustawiany przez przypadki użycia z
   * `normalizeAudioInput`); adapter mowy używa go do kosztów przed nagłówkiem WAV.
   */
  durationMs?: number;
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
  /**
   * Odpowiedź dziecka przekazywana jako dane: ≤ 200 znaków (lekcje), ≤ 600 (odpowiedzi szkolne).
   */
  readonly childAnswer: string;
  /**
   * Rozsypanka (etap 3 #360): klocki w kolejności ułożonej przez dziecko. Obecność
   * dokłada do promptu lekcji linię o ułożonej kolejności; `childAnswer` to te same
   * klocki złączone spacją (tekst wyłącznie z ćwiczenia, limit 600 znaków).
   */
  readonly blocks?: readonly string[];
  /**
   * Dane ścieżki szkolnej (Etap 2): elementy wymagane ćwiczenia, forma i cytaty
   * źródłowe. Obecność przełącza adapter na werdykt dwuwymiarowy i prompt
   * `school-grader-v3` (design §9.1; `spoken` → wariant `school-grader-v3-speech`); brak = dotychczasowy werdykt v1.
   */
  readonly school?: {
    readonly question: string;
    readonly modelAnswer: string;
    readonly requiredElements: readonly { readonly id: string; readonly text: string }[];
    readonly supplementaryElements: readonly string[];
    /** Typowe błędne odpowiedzi/stwierdzenia (dane referencyjne oceny). */
    readonly commonErrors: readonly string[];
    readonly expectedForm: string;
    readonly sourceQuotes: readonly string[];
    /**
     * Odpowiedź podyktowana i niepoprawiona ręcznie. Adapter przełącza wariant promptu
     * (tolerancja cech mowy, bez wymogu jednego zdania) i wersję promptu, czyli klucz cache.
     * Do usługi trafia wyłącznie jako znacznik sposobu wprowadzenia.
     */
    readonly spoken?: boolean;
  };
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
  /** Wszystkie bieżące wersje promptu (lekcje i szkoła) — panel werdyktów pokazuje tylko je. */
  readonly promptVersions: readonly string[];
  /** Wersja promptu dla konkretnego wejścia (szkoła/grupa); brak = `promptVersion`. */
  promptVersionForInput?(input: GraderInput): string;
  grade(input: GraderInput, signal: AbortSignal): Promise<unknown>;
}

/**
 * Jedno zadanie w wejściu oceny aktywności sesji (spec client-reward-time).
 * Zadania i odpowiedzi pochodzą z bazy serwera, ponumerowane ordinalami —
 * model nie dostaje imion dziecka, identyfikatorów ani kluczy transportowych.
 */
export interface SessionActivityReviewTask {
  readonly taskOrdinal: number;
  /** Instrukcja/bodziec ćwiczenia jako dane (tekst widoczny dla dziecka). */
  readonly instruction: string;
  readonly stimulus: string | null;
  readonly options: readonly string[];
  readonly acceptedAnswers: readonly string[];
  /** Faktycznie wysłane odpowiedzi; `uncertain` oznacza niepewne rozpoznanie STT. */
  readonly submittedAnswers: readonly {
    readonly modality: string;
    readonly text: string | null;
    readonly uncertain: boolean;
    /** Czy przed tą próbą ujawniono podpowiedź/odpowiedź (osobna pozycja czasowa). */
    readonly supportDisclosedBefore: boolean;
  }[];
  readonly editCount: number;
  readonly editWindows: readonly { readonly atMs: number; readonly count: number }[];
  readonly playbacks: readonly { readonly fromMs: number; readonly toMs: number }[];
  readonly pauses: readonly { readonly kind: string; readonly fromMs: number; readonly toMs: number }[];
  readonly activeIntervals: readonly (readonly [number, number])[];
}

/**
 * Wąski port oceny aktywności sesji — osobny od `AnswerGraderProvider` i
 * `lesson_verdicts`; bez cache i limitu wywołań odpowiedzi lekcyjnych. Model
 * wskazuje WYŁĄCZNIE zadania bez podstaw do zaliczenia pracy; nie zwraca
 * sekund, punktów ani mnożników. Walidację kształtu robi moduł domeny.
 */
export interface SessionActivityReviewer {
  readonly name: string;
  readonly model: string;
  readonly promptVersion: string;
  review(input: { tasks: readonly SessionActivityReviewTask[] }, signal: AbortSignal): Promise<unknown>;
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
