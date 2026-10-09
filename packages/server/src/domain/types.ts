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

/**
 * Kontrakty oceny i postępu (SPEC §11–18, architecture.md §9.3).
 * Domena nie zna bazy, SDK ani rzeczywistego zegara — czas przychodzi
 * jako dane (ISO UTC), a strefa czasowa rodziny jako nazwa IANA.
 */

/** Kierunek ćwiczenia rozpoznawania tekstu (SPEC §12.3–12.4, arch §9.3). */
export type ReadingDirection = "target_to_source" | "source_to_target";

/** Typy ćwiczeń MVP (SPEC §12); prezentacja materiału to „exposure” (SPEC §11). */
export type ExerciseType =
  | "exposure"
  | "listening"
  | "reading"
  | "reverse_recognition"
  | "recall"
  | "speech"
  | "letter_completion"
  | "spelling";

/**
 * Użyte wsparcie w zadaniu (SPEC §13.2). Obecność któregokolwiek wsparcia
 * dyskwalifikuje niezależność próby; dla wymowy widoczny wzorzec
 * jest oczekiwaną częścią nauki i rozstrzyga o tym ocena mowy (zadanie 8).
 */
export type AssistanceKind =
  | "options"
  | "model_audio"
  | "answer_reveal"
  | "visible_letters"
  | "hint";

/** Wynik ocenianej umiejętności (SPEC §15). */
export type SkillOutcome = "correct" | "incorrect" | "unevaluated";

/**
 * Przyczyna wyniku. `dont_remember` to zadeklarowana trudność (przerywa serię
 * w niezależnym sprawdzaniu, ale nie tworzy mylonej pary); `skipped` i
 * `technical` nie dowodzą braku wiedzy (SPEC §15.1, arch §9.1a).
 */
export type OutcomeReason = "dont_remember" | "skipped" | "ambiguous" | "technical";

/** Dlaczego próba nie jest niezależnym sprawdzeniem (SPEC §18.1). */
export type IndependenceReason = "not_first_try" | "assisted" | "recent_exposure";

/**
 * Pasma oceny wymowy per provider — jawna konfiguracja polityki, celowo
 * pusta do kalibracji próbą techniczną (SPEC §18: bez uniwersalnego progu 80).
 */
export interface PronunciationBands {
  scaleMax: number;
  correctMinScore: number;
  partialMinScore: number;
}

/** Niezmienna wersjonowana polityka nauki, np. learning-v1 (arch §9.3). */
export interface Policy {
  version: string;
  /** Sekundy od ostatniego ujawnienia rozwiązania do niezależnej próby. */
  independenceAfterSeconds: number;
  /** Liczba ostatnich kwalifikujących sukcesów do opanowania. */
  successStreakRequired: number;
  /** Minimalne godziny przerwy dla potwierdzenia w późniejszej sesji. */
  confirmationMinHours: number;
  /** Błędy przed wsparciem w tym samym zadaniu (SPEC §16). */
  supportAfterFailures: number;
  /** Kierunki wymagane do opanowania reading. */
  readingDirections: readonly ReadingDirection[];
  pronunciationBands: Readonly<Record<string, PronunciationBands>>;
}

/**
 * Prywatny klucz odpowiedzi wydanego zadania (arch §9.1). `target` to kanoniczna
 * odpowiedź, `acceptedAnswers` zatwierdzone warianty bez kanonicznej; warianty
 * podlegają tym samym regułom co odpowiedź główna (A36). `correctOptionId` to
 * serwerowe id poprawnej opcji w zadaniach zamkniętych — porównanie po id,
 * nie po tekście, bo opcje mogą się powtarzać między zadaniami.
 */
export interface AnswerKey {
  exerciseType: ExerciseType;
  target: string;
  acceptedAnswers: readonly string[];
  /** Nadpisanie kierunku dla zadań reading. */
  direction?: ReadingDirection;
  /** Serwerowy identyfikator poprawnej opcji (zadania zamknięte). */
  correctOptionId?: string;
}

/**
 * Kontekst kwalifikacji próby zamrożony przy received_at, przed analizą mowy
 * (arch §9.2). `lastExposureAt` to ujawnienie rozwiązania TEGO zadania (lub
 * jego fragmentu) — polski prompt go nie ujawnia; dla zadań rozpoznawania
 * odpowiedź nie jest angielskim rozwiązaniem, więc reguła 300 s ich nie dotyczy
 * (arch §9.3). `previousSessionContactAt` to kontakt z elementem z poprzednich
 * sesji zapamiętany na starcie sesji; późniejszy kontakt w bieżącej sesji go
 * nie zmienia (arch §9.3).
 */
export interface EvaluationContext {
  receivedAt: string;
  policy: Policy;
  lastExposureAt: string | null;
  firstTry: boolean;
  assistance: readonly AssistanceKind[];
  previousSessionContactAt: string | null;
  timezone: string;
}

/** Kwalifikacja próby jako niezależnego sprawdzenia pamięci (SPEC §18.1–3). */
export interface AttemptQualification {
  independent: boolean;
  /** Czy próba, przy sukcesie, może potwierdzić opanowanie po przerwie. */
  confirmationEligible: boolean;
  reason?: IndependenceReason;
}

/** Szczegóły oceny pisowni zapisywane oddzielnie (SPEC §12.8). */
export interface SpellingDetails {
  /** Wariant, do którego dopasowano odpowiedź (ignorując wielkość liter). */
  matchedVariant: string | null;
  wordMatched: boolean;
  letterOrderMatched: boolean;
  capitalizationCorrect: boolean;
  /** Jedyny defekt to kapitalizacja — właściwe słowo, zła wielka litera. */
  capitalizationOnlyDefect: boolean;
}

/**
 * Zachowany wynik usługi wymowy (SPEC §20, §23): identyfikacja providera
 * i wynik ogólny; `band` powstaje tylko przy skalibrowanych pasmach polityki.
 */
export interface PronunciationDetails {
  provider: string;
  score: number;
  band?: "correct" | "partial" | "below";
}

export interface SkillGradeDetails {
  direction?: ReadingDirection;
  spelling?: SpellingDetails;
  pronunciation?: PronunciationDetails;
}

/**
 * Wynik jednej umiejętności. `confirmationEligible` jest prawdziwe tylko
 * dla niezależnego sukcesu spełniającego warunek przerwy.
 */
export interface SkillGrade {
  outcome: SkillOutcome;
  reason?: OutcomeReason;
  independent: boolean;
  confirmationEligible: boolean;
  details?: SkillGradeDetails;
}

/** Fragmenty wymowy pokazywane dziecku (design 2026-10-09) — bez liczb. */
export interface SpeechFragment {
  text: string;
  verdict: "good" | "almost";
}

/** Wynik próby: oceny per umiejętność + kwalifikacja samej próby. */
export interface Grade {
  skills: Partial<Record<Skill, SkillGrade>>;
  attempt: AttemptQualification;
  /** Wiarygodny tekst rozpoznany z mowy; przekazywany dziecku bez score. */
  recognizedText?: string;
  /**
   * Wynik ćwiczenia wymowy (SPEC §12.6): zgodna z kluczem treść wypowiedzi
   * oznacza ćwiczenie wykonane — zadanie zamyka się także wtedy, gdy samej
   * wymowy nie udało się ocenić (§15.4 wynik częściowy), a druga wiarygodna
   * rozbieżność domyka zadanie bez ocen wiedzy (§15.3 kontynuowanie).
   */
  speechAttempt?: { contentMatched: boolean };
  speechFragments?: SpeechFragment[];
}

/**
 * Historia jako uporządkowany (po receivedAt) zapis ocen z czasem i wersją
 * polityki — źródło projekcji postępu (SPEC §20, §18).
 */
export interface HistoryEntry {
  receivedAt: string;
  policyVersion: string;
  skill: Skill;
  outcome: SkillOutcome;
  reason?: OutcomeReason;
  independent: boolean;
  confirmationEligible: boolean;
  details?: SkillGradeDetails;
}

export type History = readonly HistoryEntry[];

/** Status umiejętności w projekcji postępu. */
export type ProgressStatus =
  | "not_assessed"
  | "learning"
  | "needs_confirmation"
  | "needs_reconfirmation"
  | "mastered";

/** Projekcja postępu jednej umiejętności z historii prób. */
export interface SkillProgress {
  status: ProgressStatus;
  /** Bieżąca seria kwalifikujących sukcesów (dla reading łączna). */
  streak: number;
  nextReviewAt: string | null;
  /** Tylko reading: skład kierunków w oknie ostatnich sukcesów. */
  directions?: Partial<Record<ReadingDirection, number>>;
}

export interface Progress {
  skills: Partial<Record<Skill, SkillProgress>>;
}
