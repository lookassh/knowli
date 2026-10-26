import { z } from "zod";
import { InstantSchema, UuidSchema } from "./common";
import { isVisualDataValid, RecordingModeSchema, VisualTypeSchema } from "./decks";
import { SessionActivityResultDtoSchema } from "./reward-activity";
import { LessonVisualSubjectSchema } from "./lessons";

const visualPromptFields = {
  visualType: VisualTypeSchema.default("none"),
  visualData: z.record(z.string(), z.unknown()).optional(),
};

function validateVisualPrompt(
  prompt: { visualType: z.infer<typeof VisualTypeSchema>; visualData?: Record<string, unknown>; target: string },
  ctx: z.RefinementCtx,
) {
  if (!isVisualDataValid(prompt.visualType, prompt.visualData, prompt.target)) {
    ctx.addIssue({ code: "custom", path: ["visualData"], message: "visualData does not match visualType" });
  }
}

/**
 * Kontrakty Kid API (architecture.md §9). Publiczne DTO nigdy nie zawierają
 * klucza odpowiedzi, kryteriów oceny ani technicznych score'ów — te zostają
 * wyłącznie po stronie serwera w session_tasks.answer_key.
 */

export const EXERCISE_TYPES = [
  "exposure",
  "listening",
  "reading",
  "reverse_recognition",
  "picture_recognition",
  "recall",
  "speech",
  "letter_completion",
  "spelling",
  // Typy lekcji (design „Typy ćwiczeń i etapy”). Dodane jako nowe warianty,
  // zgodność wsteczna istniejących słówek zachowana.
  "lesson_card",
  "lesson_notice",
  "lesson_choice",
  "lesson_order",
  "lesson_short_answer",
  "lesson_gap",
  "lesson_error_fix",
  "lesson_transform",
  "lesson_open_answer",
] as const;
export type ExerciseTypeDto = (typeof EXERCISE_TYPES)[number];

export const ChoiceOptionSchema = z.object({
  id: UuidSchema,
  text: z.string().min(1),
});
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;

export const MeaningVisualSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), imageAssetId: UuidSchema }).strict(),
  z.object({ kind: z.literal("color"), color: z.string().regex(/^#[0-9a-f]{6}$/) }).strict(),
  z.object({ kind: z.literal("number"), count: z.number().int().min(0).max(50) }).strict(),
]);
export type MeaningVisual = z.infer<typeof MeaningVisualSchema>;

export const PictureChoiceOptionSchema = z.object({
  id: UuidSchema,
  labelPl: z.string().min(1),
  visual: MeaningVisualSchema,
}).strict();
export type PictureChoiceOption = z.infer<typeof PictureChoiceOptionSchema>;

/** Publiczny element do ułożenia (`lesson_order`) — identyfikator i widoczny tekst. */
export const LessonItemSchema = z.object({
  id: UuidSchema,
  text: z.string().min(1),
});
export type LessonItem = z.infer<typeof LessonItemSchema>;

/** Segment zdania `lesson_notice` do wskazania — bez informacji, który jest poprawny. */
export const LessonSegmentSchema = z.object({
  id: UuidSchema,
  text: z.string().min(1),
});
export type LessonSegment = z.infer<typeof LessonSegmentSchema>;

/** Publiczna treść zadania — discriminated union po polu kind = typ ćwiczenia. */
export const TaskPromptSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("exposure"),
    source: z.string().min(1),
    target: z.string().min(1),
    example: z.string().nullable(),
    audioAssetId: UuidSchema.nullable(),
    /**
     * Audio zdania przykładowego przygotowane z zestawem (SPEC §22); null, gdy
     * karta nie ma przykładu. Treść zdania jest już widoczna na prezentacji,
     * więc odsłuch nie wymaga osobnej ekspozycji (arch §12).
     */
    exampleAudioAssetId: UuidSchema.nullable(),
    /**
     * Zatwierdzona przez rodzica ilustracja — pomoc wizualna prezentacji
     * (SPEC §12.1, §24); null, gdy karta nie ma obrazu. Bajty przez route
     * media, bez dodatkowej ekspozycji (arch §12).
     */
    imageAssetId: UuidSchema.nullable(),
    ...visualPromptFields,
  }),
  z.object({ kind: z.literal("picture_exposure"), visual: MeaningVisualSchema, audioAssetId: UuidSchema.nullable() }).strict(),
  z.object({
    kind: z.literal("listening"),
    options: z.array(ChoiceOptionSchema).min(1),
    audioAssetId: UuidSchema,
  }),
  z.object({
    kind: z.literal("picture_listening"),
    options: z.array(PictureChoiceOptionSchema).min(2).max(4),
    audioAssetId: UuidSchema,
  }).strict(),
  z.object({ kind: z.literal("picture_recall"), visual: MeaningVisualSchema }).strict(),
  z.object({
    kind: z.literal("picture_recognition"),
    /**
     * Wizualizacja znaczenia (obraz/kolor/liczba) — zatwierdzona z przygotowaniem
     * materiału. Prompt nie niesie audio angielskiego słowa (SPEC A07): próba
     * pozostaje czystym rozpoznawaniem wzrokowym, a odsłuch poprawnej opcji
     * ujawnia serwer dopiero w feedbacku (`correctAudioAssetId`).
     */
    visual: MeaningVisualSchema,
    /** Polskie słowo źródłowe jako mały podpis pod obrazkiem (np. „koń”). */
    source: z.string().min(1),
    /** Angielskie słowa: jedno poprawne + dystraktory, unikalne teksty (SPEC §13). */
    options: z.array(ChoiceOptionSchema).min(2).max(4),
  }).strict(),
  z.object({
    kind: z.literal("reading"),
    text: z.string().min(1),
    options: z.array(ChoiceOptionSchema).min(1),
  }),
  z.object({
    kind: z.literal("reverse_recognition"),
    prompt: z.string().min(1),
    options: z.array(ChoiceOptionSchema).min(1),
  }),
  z.object({ kind: z.literal("recall"), prompt: z.string().min(1) }),
  z.object({ kind: z.literal("spelling"), prompt: z.string().min(1) }),
  z.object({
    kind: z.literal("letter_completion"),
    prompt: z.string().min(1),
    fragment: z.string().min(1),
  }),
  z.object({
    kind: z.literal("speech"),
    text: z.string().min(1),
    audioAssetId: UuidSchema.nullable(),
    /** Ilustracja karty; cel i tak jest widoczny w treści zadania (SPEC §24). */
    imageAssetId: UuidSchema.nullable(),
    ...visualPromptFields,
  }),
  z.object({ kind: z.literal("picture_speech"), visual: MeaningVisualSchema, audioAssetId: UuidSchema.nullable() }).strict(),
  // Gałęzie lekcji (design „Typy ćwiczeń i etapy” — kolumna Kid prompt).
  // KAŻDA jest `.strict()`: Kid DTO nigdy nie zawiera odpowiedzi, wariantów,
  // elementu sprawdzanego (`focus`), celu ani kategorii błędu. `audioAssetId`
  // (TTS odpowiedzi kanonicznej) jest OPCJONALNE WYŁĄCZNIE przy typach
  // tekstowych (`lesson_gap`/`error_fix`/`transform`/`open_answer`), gdzie —
  // zgodnie z wym. 4.6 i design.md „Odsłuch w zadaniach tekstowych lekcji =
  // wsparcie” — odsłuch zdania wzorcowego PRZED odpowiedzią jest dozwolonym
  // wsparciem (ekspozycja pieczętowana, próba niesamodzielna). Typy zamknięte
  // (`notice`/`choice`/`short_answer`/`order`) NIE niosą audio: odtworzenie
  // kanonicznej odpowiedzi zdradziłoby właściwą opcję/kolejność i obeszłoby
  // deterministyczną ocenę po identyfikatorach (wym. 4.3).
  z.object({
    kind: z.literal("lesson_card"),
    card: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      examples: z.array(z.string().min(1)),
    }).strict(),
  }).strict(),
  z.object({
    kind: z.literal("lesson_notice"),
    instructionPl: z.string().min(1),
    segments: z.array(z.array(LessonSegmentSchema).min(1)).min(1),
  }).strict(),
  z.object({
    kind: z.literal("lesson_choice"),
    visualSubject: LessonVisualSubjectSchema.optional(),
    instructionPl: z.string().min(1),
    stem: z.string().min(1),
    options: z.array(ChoiceOptionSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal("lesson_order"),
    instructionPl: z.string().min(1),
    items: z.array(LessonItemSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal("lesson_short_answer"),
    question: z.string().min(1),
    options: z.array(ChoiceOptionSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal("lesson_gap"),
    instructionPl: z.string().min(1),
    stemWithGap: z.string().min(1),
    hint: z.string().min(1).optional(),
    audioAssetId: UuidSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("lesson_error_fix"),
    instructionPl: z.string().min(1),
    statement: z.string().min(1),
    audioAssetId: UuidSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("lesson_transform"),
    instructionPl: z.string().min(1),
    statement: z.string().min(1),
    audioAssetId: UuidSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("lesson_open_answer"),
    instructionPl: z.string().min(1),
    prompt: z.string().min(1),
    audioAssetId: UuidSchema.optional(),
  }).strict(),
]).superRefine((prompt, ctx) => {
  if (prompt.kind === "exposure" || prompt.kind === "speech") {
    validateVisualPrompt({
      visualType: prompt.visualType,
      ...(prompt.visualData === undefined ? {} : { visualData: prompt.visualData }),
      target: prompt.kind === "exposure" ? prompt.target : prompt.text,
    }, ctx);
  }
});
export type TaskPrompt = z.infer<typeof TaskPromptSchema>;

export const SessionInputSchema = z.object({
  mode: z.enum(["training", "mock_test"]).optional(),
  childId: UuidSchema,
  deckId: UuidSchema,
  microphoneEnabled: z.boolean(),
  supportsPictureVocabulary: z.boolean().default(false),
  /**
   * Klient rozumie typ `picture_recognition` (obrazek → angielskie słowo).
   * Klient bez flagi (domyślnie false) nie otrzymuje tego typu w sesji —
   * degradacja zgodna z wzorcem `supportsPictureVocabulary` (arch §20).
   */
  supportsPictureRecognition: z.boolean().default(false),
});
export type SessionInput = z.input<typeof SessionInputSchema>;

export const SessionDtoSchema = z.object({
  mode: z.enum(["training", "mock_test", "daily_round"]),
  sessionId: UuidSchema,
  childId: UuidSchema,
  deckId: UuidSchema,
  deckVersionId: UuidSchema,
  policyId: z.string().min(1),
  microphoneEnabled: z.boolean(),
  canRead: z.boolean().default(true),
  vocabularyFormat: z.enum(["standard", "picture"]).default("standard"),
  state: z.enum(["active", "completed", "ended"]),
  /** Maksymalny budżet zadań ocenianych; prezentacje go nie powiększają. */
  taskBudget: z.number().int().positive(),
  tasksIssued: z.number().int().nonnegative(),
  assessedTasksIssued: z.number().int().nonnegative(),
  startedAt: InstantSchema,
  /** True, gdy zwrócono istniejącą aktywną sesję zamiast tworzyć nową. */
  resumed: z.boolean(),
});
export type SessionDto = z.input<typeof SessionDtoSchema>;

export const TaskDtoSchema = z.object({
  taskId: UuidSchema,
  sessionId: UuidSchema,
  ordinal: z.number().int().nonnegative(),
  exerciseType: z.enum(EXERCISE_TYPES),
  direction: z.enum(["target_to_source", "source_to_target"]).nullable(),
  state: z.enum(["issued", "answered", "completed", "skipped"]),
  prompt: TaskPromptSchema,
  /** Zadania oceniane łącznie z bieżącym — podstawa komunikatu „Jeszcze N”. */
  remainingAssessed: z.number().int().positive(),
  pendingAttemptId: UuidSchema.optional(),
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;

export const EventInputSchema = z.object({
  taskId: UuidSchema,
  clientEventId: UuidSchema,
  kind: z.enum(["display_confirmed", "audio_played"]),
  stepId: z.string().min(1).optional(),
});
export type EventInput = z.infer<typeof EventInputSchema>;

export const DisclosureInputSchema = z.object({
  taskId: UuidSchema,
  kind: z.enum(["audio", "hint"]),
});
export type DisclosureInput = z.infer<typeof DisclosureInputSchema>;

export const DisclosureDtoSchema = z.object({
  taskId: UuidSchema,
  /** Serwerowy identyfikator kroku — wspólne pole odpowiedzi i późniejszych ACK. */
  stepId: z.string().min(1),
  kind: z.enum(["audio", "hint"]),
  /** Rozwiązanie własnego zadania; tylko dla podpowiedzi (SPEC §16). */
  reveal: z.object({ target: z.string().min(1) }).nullable(),
  audioAssetId: UuidSchema.optional(),
});
export type DisclosureDto = z.infer<typeof DisclosureDtoSchema>;

export const FeedbackAudioDtoSchema = z.object({
  attemptId: UuidSchema,
  taskId: UuidSchema,
  stepId: z.string().min(1),
  audioAssetId: UuidSchema,
});
export type FeedbackAudioDto = z.infer<typeof FeedbackAudioDtoSchema>;

export const PresentationCompletionInputSchema = z.object({
  taskId: UuidSchema,
  clientCommandId: UuidSchema.optional(),
});
export type PresentationCompletionInput = z.infer<typeof PresentationCompletionInputSchema>;

export const PresentationCompletionDtoSchema = z.object({
  taskId: UuidSchema,
  state: z.literal("completed"),
  completedAt: InstantSchema,
});
export type PresentationCompletionDto = z.infer<typeof PresentationCompletionDtoSchema>;

export const SessionSummaryResultsSchema = z.object({
  independentSuccesses: z.object({
    recall: z.number().int().nonnegative(),
    spelling: z.number().int().nonnegative(),
  }),
  practiceItems: z.array(z.object({
    itemId: UuidSchema,
    target: z.string().min(1),
    skills: z.array(z.enum(["recall", "spelling"])).min(1),
  })),
});
export type SessionSummaryResults = z.infer<typeof SessionSummaryResultsSchema>;

export const SessionSummaryDtoSchema = SessionSummaryResultsSchema.extend({
  sessionId: UuidSchema,
  state: z.enum(["completed", "ended"]),
  tasksIssued: z.number().int().nonnegative(),
  assessedTasksIssued: z.number().int().nonnegative(),
  endedAt: InstantSchema,
  /**
   * Wynik oceny aktywności (punkty/albo jawny brak oceny). OPCJONALNY:
   * zamrożony raport wiedzy w `context.summary` go NIE zawiera — dołączamy go
   * do odpowiedzi HTTP z `learning_sessions.activity_review`, więc powtórne
   * zakończenie zwraca ten sam wynik bez ponownego modelu. Brak pola = sesja
   * zakończona bez raportu (nie jest to dowód braku nauki).
   */
  activity: SessionActivityResultDtoSchema.optional(),
  /**
   * Wariant lekcji (design „Kwalifikacja i projekcja celów”, req 7.7): podsumowanie
   * per cel — ile ćwiczeń celu wykonano i ile poprawnie. BEZ procentów, bez statusów
   * technicznych i bez kategorii błędów (prywatność: `.strict()` broni przed wyciekiem
   * takiego pola). Opcjonalne — podsumowanie słówek go nie niesie (zgodność wsteczna).
   */
  objectives: z.array(z.object({
    objectiveId: z.string().min(1),
    titlePl: z.string().min(1),
    practiced: z.number().int().nonnegative(),
    correct: z.number().int().nonnegative(),
  }).strict()).optional(),
});
export type SessionSummaryDto = z.infer<typeof SessionSummaryDtoSchema>;

/**
 * Widok profilu dla ekranu dziecka: nazwa, awatar (arch §12) oraz jeden ogólny
 * licznik dorobku punktów. Bez salda do wydania, dziennych celów i pakietów.
 */
export const KidProfileDtoSchema = z.object({
  childId: UuidSchema,
  displayName: z.string().min(1),
  avatarKey: z.string().min(1),
  recordingMode: RecordingModeSchema,
  canRead: z.boolean().default(true),
  /** Suma zatwierdzonych sekund sesji zakończonych dzisiaj; brak oznacza starszy serwer lub niedostępne dane. */
  todayActivitySeconds: z.number().int().nonnegative().optional(),
  /** Distinguishes an unavailable report from an older server that omits the activity field. */
  todayActivityUnavailable: z.boolean().optional(),
  /** Ogólny dorobek dziecka (1 pkt / pełna zatwierdzona minuta nauki). */
  rewardPoints: z.number().int().nonnegative().default(0),
});
export type KidProfileDto = z.input<typeof KidProfileDtoSchema>;

/** Zestaw przypisany dziecku, dostępny do nauki (arch §12). */
export const KidDeckDtoSchema = z.object({
  mockTestAvailable: z.boolean().default(false),
  activeSession: z.object({ sessionId: UuidSchema, mode: z.enum(["training", "mock_test", "daily_round"]) }).nullable().default(null),
  /**
   * Rodzaj zestawu. OPCJONALNE dla zgodności wstecznej — brak pola oznacza
   * „vocabulary” (konsumenci traktują `undefined` jak słówka). Nie `.default()`,
   * by nie poszerzać typu wyjściowego o nowe pole WYMAGANE w każdym miejscu
   * konstrukcji DTO (server/kid-ui/e2e) — to byłaby niezgodność wsteczna typu.
   */
  kind: z.enum(["vocabulary", "lesson"]).optional(),
  vocabularyFormat: z.enum(["standard", "picture"]).default("standard"),
  coverVisual: MeaningVisualSchema.nullable().default(null),
  /** Opcjonalna okładka zestawu; brak pola zachowuje zgodność starszych serwerów. */
  coverAssetId: UuidSchema.nullable().optional(),
  resumeOnly: z.boolean().default(false),
  /** Tytuł przedmiotu dla lekcji; brak/undefined dla słówek (zgodność wsteczna). */
  subjectTitle: z.string().min(1).nullable().optional(),
  deckId: UuidSchema,
  title: z.string().min(1),
  /** Liczba słów w przypiętej, opublikowanej wersji zestawu. */
  itemCount: z.number().int().nonnegative(),
  /** Elementy z opanowaną umiejętnością samodzielnego Recall. */
  independentlyRecalledCount: z.number().int().nonnegative(),
  /** Termin sprawdzianu z przypisania (lokalna data rodziny) lub null. */
  testDate: z.string().nullable(),
  /**
   * Czy harmonogram ma teraz dla dziecka zaplanowaną pracę w tym zestawie
   * (należne sprawdzenia/powtórki albo nowy materiał)? Podstawa sekcji
   * „Rekomendowane”; ćwiczyć można każdy zestaw w dowolnym momencie.
   */
  recommended: z.boolean(),
});
export type KidDeckDto = z.input<typeof KidDeckDtoSchema>;

export const KidValidationReasonSchema = z.enum([
  "picture_client_update_required",
  "vocabulary_requires_reading",
  "non_reader_mock_test_unavailable",
  "picture_guidance_unavailable",
  "picture_audio_unavailable",
  /** Raport aktywności ma nieznaną wersję formatu — klient musi się odświeżyć. */
  "activity_report_update_required",
]);
export type KidValidationReason = z.infer<typeof KidValidationReasonSchema>;
export const KidValidationDetailsSchema = z.object({ reason: KidValidationReasonSchema }).strict();
export type KidValidationDetails = z.infer<typeof KidValidationDetailsSchema>;

/**
 * Feedback dla dziecka po próbie — wybór treści pochodzi z reguł domeny
 * (SPEC §16). `correctText` to rozwiązanie własnego zadania, ujawniane
 * wyłącznie wraz z ekspozycją zapisaną przed odpowiedzią HTTP.
 */
export const PronunciationFragmentDtoSchema = z.object({
  text: z.string().min(1),
  verdict: z.enum(["good", "almost", "unknown"]),
});
export type PronunciationFragmentDto = z.infer<typeof PronunciationFragmentDtoSchema>;

export const SpeechFeedbackDtoSchema = z.object({
  recognition: z.enum(["matched", "different", "uncertain", "no_speech", "unavailable"]),
  pronunciation: z.enum(["good", "practice", "unreliable", "unavailable", "not_configured", "not_applicable"]),
  referenceText: z.string().min(1).max(200).optional(),
}).strict().superRefine((speech, ctx) => {
  if (["uncertain", "no_speech", "unavailable"].includes(speech.recognition) && speech.referenceText !== undefined) {
    ctx.addIssue({ code: "custom", path: ["referenceText"], message: "uncertain recognition cannot disclose a reference text" });
  }
});
export type SpeechFeedbackDto = z.infer<typeof SpeechFeedbackDtoSchema>;

/** Fragment zapisu w porównaniu pisowni; `pill` = fragment do wyróżnienia (issue #9). */
export const SpellingDiffSegmentSchema = z.object({
  text: z.string().min(1),
  state: z.enum(["plain", "pill"]),
});
export type SpellingDiffSegmentDto = z.infer<typeof SpellingDiffSegmentSchema>;

/**
 * Porównanie zapisu dziecka z właściwym wariantem: dwa zsegmentowane wiersze.
 * Segmenty `expected` składają się dokładnie na `correctText`; bez odległości
 * i technicznych score'ów (dziecko nie widzi liczb).
 */
export const SpellingDiffSchema = z.object({
  given: z.array(SpellingDiffSegmentSchema).min(1).max(32),
  expected: z.array(SpellingDiffSegmentSchema).min(1).max(32),
  capitalizationHint: z.boolean().optional(),
});
export type SpellingDiff = z.infer<typeof SpellingDiffSchema>;

export const FeedbackDtoSchema = z.object({
  kind: z.enum(["great", "capitalization_hint", "almost", "incorrect", "content_matched", "not_assessed", "spelling_hint", "lesson_hint", "lesson_almost"]),
  correctText: z.string().min(1).optional(),
  heardText: z.string().min(1).max(200).optional(),
  fragments: z.array(PronunciationFragmentDtoSchema).max(6).optional(),
  speech: SpeechFeedbackDtoSchema.optional(),
  spellingDiff: SpellingDiffSchema.optional(),
  /**
   * Zsegmentowana odpowiedź dziecka z zaznaczonymi fragmentami (reuse
   * `SpellingDiffSegmentSchema`) — tylko dla rodzajów lekcji `lesson_almost`
   * i `lesson_hint`.
   */
  answerSegments: z.array(SpellingDiffSegmentSchema).min(1).max(32).optional(),
  /** Szablon podpowiedzi kategorii celu (po polsku) — wymagany dla `lesson_hint`. */
  hintPl: z.string().min(1).optional(),
  /** Wskazówka prezentacji; endpoint odsłuchu zawsze ponownie sprawdza uprawnienie. */
  referenceAudioAvailable: z.boolean().optional(),
  /**
   * Audio poprawnej opcji `picture_recognition`: identyfikator ujawniany
   * WYŁĄCZNIE w feedbacku wraz z oceną próby (serwer zamyka zdarzenie
   * `audio_issued` przed odpowiedzią HTTP). Przed odpowiedzią prompt nie
   * niesie żadnego audio (SPEC A07).
   */
  correctAudioAssetId: UuidSchema.optional(),
}).strict().superRefine((feedback, ctx) => {
  if (feedback.kind === "spelling_hint" && feedback.spellingDiff === undefined) {
    ctx.addIssue({ code: "custom", path: ["spellingDiff"], message: "spelling_hint requires spellingDiff" });
  }
  if (feedback.kind !== "spelling_hint" && feedback.spellingDiff !== undefined) {
    ctx.addIssue({ code: "custom", path: ["spellingDiff"], message: "spellingDiff is only allowed with spelling_hint" });
  }
  if (feedback.kind === "spelling_hint" && feedback.spellingDiff !== undefined) {
    const expected = feedback.spellingDiff.expected.map((segment) => segment.text).join("");
    if (expected !== feedback.correctText) {
      ctx.addIssue({ code: "custom", path: ["spellingDiff"], message: "expected segments must compose into correctText" });
    }
  }
  // Reguły lekcji: answerSegments tylko dla rodzajów lekcji; lesson_hint
  // wymaga hintPl. correctText jest dozwolone (najbliższy zatwierdzony wariant).
  const LESSON_SEGMENT_KINDS = ["lesson_almost", "lesson_hint"];
  if (feedback.answerSegments !== undefined && !LESSON_SEGMENT_KINDS.includes(feedback.kind)) {
    ctx.addIssue({ code: "custom", path: ["answerSegments"], message: "answerSegments is only allowed with lesson_almost or lesson_hint" });
  }
  if (feedback.kind === "lesson_hint" && feedback.hintPl === undefined) {
    ctx.addIssue({ code: "custom", path: ["hintPl"], message: "lesson_hint requires hintPl" });
  }
  if (feedback.hintPl !== undefined && feedback.kind !== "lesson_hint") {
    ctx.addIssue({ code: "custom", path: ["hintPl"], message: "hintPl is only allowed with lesson_hint" });
  }
  if (feedback.speech && ["uncertain", "no_speech", "unavailable"].includes(feedback.speech.recognition)) {
    for (const field of ["heardText", "correctText", "fragments"] as const) {
      if (feedback[field] !== undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: "uncertain recognition cannot disclose speech content" });
      }
    }
  }
  // Odsłuch poprawnego słowa ujawnia rozwiązanie: nie towarzyszy feedbackowi,
  // który niczego nie ujawnia (próba nieoceniona, „Pomiń”, awaria techniczna).
  if (feedback.kind === "not_assessed" && feedback.correctAudioAssetId !== undefined) {
    ctx.addIssue({ code: "custom", path: ["correctAudioAssetId"], message: "not_assessed cannot disclose the correct word audio" });
  }
});
export type FeedbackDto = z.infer<typeof FeedbackDtoSchema>;

export const AttemptModalitySchema = z.enum(["choice", "text", "audio", "dont_remember", "skip", "sequence"]);
export type AttemptModality = z.infer<typeof AttemptModalitySchema>;

/**
 * Odpowiedź dziecka na zadanie (arch §12). `clientAttemptId` zabezpiecza retry
 * transportowy; ponowne użycie tego samego klucza z inną treścią daje 409.
 * Odpowiedź audio idzie multipartem (bajty nagrania poza JSON) i jest
 * oceniana ścieżką mowy: rezerwacja processing → analiza → finalizacja.
 */
export const AttemptInputSchema = z.discriminatedUnion("modality", [
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("choice"),
    optionId: UuidSchema,
  }),
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("text"),
    text: z.string().max(500),
  }),
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("audio"),
  }),
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("dont_remember"),
  }),
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("skip"),
  }),
  z.object({
    taskId: UuidSchema,
    clientAttemptId: UuidSchema,
    modality: z.literal("sequence"),
    /** Kolejność wskazana przez dziecko (`lesson_order`): 1–10 unikalnych id. */
    itemIds: z.array(UuidSchema).min(1).max(10).refine(
      (ids) => new Set(ids).size === ids.length,
      { message: "itemIds must be unique" },
    ),
  }),
]);
export type AttemptInput = z.infer<typeof AttemptInputSchema>;

export const AttemptDtoSchema = z.object({
  attemptId: UuidSchema,
  taskId: UuidSchema,
  state: z.enum(["processing", "completed"]),
  modality: AttemptModalitySchema,
  /** Reguły domeny; null dopóki ocena trwa (audio). */
  feedback: FeedbackDtoSchema.nullable(),
  /** Stan zadania po próbie: „issued” pozwala na drugie podejście. */
  taskState: z.enum(["issued", "answered", "completed", "skipped"]),
  /** Serwerowy krok ujawnienia feedbacku — pole dla późniejszych ACK obserwacji. */
  stepId: z.string().min(1).nullable(),
  receivedAt: InstantSchema,
  completedAt: InstantSchema.nullable(),
});
export type AttemptDto = z.infer<typeof AttemptDtoSchema>;
