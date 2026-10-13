/**
 * Typy silnika lekcji (design „Przedmiot i katalog”, „Typy ćwiczeń i etapy”).
 * Silnik jest niezależny od przedmiotu: nie zna angielskiego ani gramatyki.
 * Przedmiot to wtyczka (`SubjectModule`) za interfejsem (Strategy + Registry).
 * Domena nie importuje bazy, SDK ani zegara.
 */

/** Kod kategorii błędu; walidowany rejestrem przedmiotu (baza ∪ przedmiot ∪ temat). */
export type ErrorCategoryCode = string;

/** Kategoria błędu z polską etykietą dla rodzica i podpowiedzi dziecka. */
export interface ErrorCategory {
  readonly code: ErrorCategoryCode;
  readonly labelPl: string;
}

/** Typy ćwiczeń lekcji (design: 9 typów `lesson_*`). */
export type LessonExerciseType =
  | "lesson_card"
  | "lesson_notice"
  | "lesson_choice"
  | "lesson_order"
  | "lesson_short_answer"
  | "lesson_gap"
  | "lesson_error_fix"
  | "lesson_transform"
  | "lesson_open_answer";

/** Etap nauki celu (design: tabela typów → etapy). */
export type LessonStage = "intro" | "guided" | "productive" | "independent";

/**
 * Cel nauki (reguła gramatyki / fakt). Każde ćwiczenie sprawdza dokładnie
 * jeden cel. `cards` to 2–4 karty po polsku; `{{examples}}` = przykłady z lekcji.
 * `hints` ma szablon podpowiedzi po polsku dla każdej kategorii celu.
 */
export interface LearningObjective {
  readonly id: string; // "english_grammar.present_simple.third_person_s"
  readonly titlePl: string; // „-s w 3. osobie”
  readonly descriptionEn: string; // opis dla promptów generacji i oceny
  readonly cards: readonly { readonly title: string; readonly body: string }[];
  readonly errorCategories: readonly ErrorCategoryCode[];
  readonly hints: Readonly<Record<ErrorCategoryCode, string>>;
  readonly exerciseTypes: readonly LessonExerciseType[];
}

/**
 * Temat lekcji. `version` rośnie przy zmianie; stare wersje zostają w rejestrze.
 * `extraErrorCategories` i `transforms` są dostępne celom tematu.
 * `objectives` są w kolejności nauki.
 */
export interface LessonTopic {
  readonly id: string; // "present_simple"
  readonly version: number;
  readonly titlePl: string;
  readonly extraErrorCategories: readonly ErrorCategory[];
  readonly transforms: readonly { readonly id: string; readonly instructionPl: string }[];
  readonly objectives: readonly LearningObjective[];
}

/** Normalizator odpowiedzi przedmiotu. */
export interface AnswerNormalizer {
  /** Zbiór równoważnych sekwencji tokenów (np. rozwinięcia skrótów). */
  normalize(text: string): string[][];
}

/** Fragmenty promptów generacji i oceny specyficzne dla przedmiotu. */
export interface SubjectPromptProfile {
  readonly generationRole: string; // opis roli autora ćwiczeń dla tego przedmiotu
  readonly gradingRole: string; // co ocenia model (zastosowanie celu, nie styl)
  readonly almostDefinition: string; // kiedy werdykt „almost”
  /**
   * Reguły semantyki pól ćwiczeń doklejane do promptu generacji po ogólnym
   * opisie pól przez adapter (dziedzinowe, np. „hint = bezokolicznik”).
   * Opcjonalne: przedmiot bez reguł pól pomija pole.
   */
  readonly fieldRules?: string;
}

/**
 * Minimalny szkic ćwiczenia potrzebny w sygnaturze `validateExercise`.
 * Pola payloadu z design „Data Models” → `item_revisions.payload` dla
 * `lesson_exercise`. Decyzja (opisana w raporcie): `answerLocale`/`promptLocale`
 * NIE należą do szkicu — wynikają z przedmiotu (`SubjectModule.answerLocale`
 * / `promptLocale`), a `validateExercise` jest już wywoływany w kontekście
 * przedmiotu, więc powielanie locale w szkicu byłoby redundancją (DRY/YAGNI).
 */
export interface LessonExerciseDraft {
  readonly exerciseType: LessonExerciseType;
  readonly objectiveId: string;
  readonly instructionPl?: string;
  readonly stem?: string;
  readonly statement?: string;
  readonly prompt?: string;
  readonly hint?: string;
  readonly transformId?: string;
  /**
   * `lesson_notice` (design „Typy ćwiczeń i etapy”): 2–3 zdania, każde jako lista
   * segmentów-słów (`string`), każdy segment niepusty i ≤ limitu długości tekstu.
   * Dziecko wskazuje jedno słowo — `correctOption` jest równe (po normalizatorze
   * przedmiotu, w dowolnym wariancie) któremuś segmentowi. `options` nie dotyczy
   * tego typu (wybór wskazaniem, nie z listy opcji).
   */
  readonly noticeSegments?: readonly (readonly string[])[];
  readonly answer: string;
  readonly acceptedAnswers: readonly string[];
  readonly focus: readonly string[];
  readonly options?: readonly { readonly id: string; readonly text: string }[];
  readonly correctOption?: string;
  readonly items?: readonly { readonly id: string; readonly text: string }[];
}

/**
 * Przedmiot jako wtyczka. Dostarcza katalog tematów i celów, dozwolone typy
 * ćwiczeń, normalizator odpowiedzi, kategorie błędów, profil promptów oraz
 * walidator specyficzny dla przedmiotu. Dodanie przedmiotu = nowy katalog
 * `subjects/<id>/` i jeden wpis w rejestrze.
 */
export interface SubjectModule {
  readonly id: string; // "english_grammar"
  readonly titlePl: string; // „Angielski — gramatyka”
  readonly answerLocale: string; // "en-GB" — język odpowiedzi dziecka
  readonly promptLocale: string; // "pl-PL" — język poleceń
  readonly exerciseTypes: readonly LessonExerciseType[]; // typy wspierane przez przedmiot
  readonly errorCategories: readonly ErrorCategory[]; // kategorie przedmiotu (poza bazowymi)
  readonly normalizer: AnswerNormalizer;
  readonly topics: readonly LessonTopic[]; // wszystkie wersje tematów
  readonly prompts: SubjectPromptProfile;
  /** Błędy specyficzne dla przedmiotu (pusta lista = poprawne). */
  validateExercise(ex: LessonExerciseDraft, topic: LessonTopic): string[];
  readonly ttsForAnswers: boolean; // czy generować audio odpowiedzi kanonicznej
}
