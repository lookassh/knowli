import { computeTargetKey } from "./target-key";
import { isTestPreparationWindow } from "./test-preparation";
import type { ExerciseType, Policy, ProgressStatus, ReadingDirection, Skill } from "./types";
import type { SupportState } from "./support-cycle";
import type { SkillWork } from "./learning-work";
import { buildRecognitionOptions } from "./recognition-options";
import type { ConfusionPair } from "./confusion-priority";

/**
 * Scheduler v1 — jawne priorytety zamiast losowego score (architecture.md §9.3).
 * Czysta funkcja nad migawką stanu: zegar, polityka i postęp przychodzą jako
 * dane, więc decyzje są w pełni powtarzalne i testowalne bez bazy.
 *
 * Rezerwacje: dopóki czeka należne niezależne sprawdzenie Recall/pisowni,
 * jego cel nie może zostać pokazany, odtworzony ani użyty jako dystraktor
 * w innym zadaniu. Zwalnianie rezerwacji (po sprawdzeniu albo pominięciu)
 * należy do modułu sesji, który prowadzi kontekst.
 */

/** Migawka projekcji jednej umiejętności elementu (child_skill_progress). */
export interface SkillSnapshot {
  status: ProgressStatus;
  nextReviewAt: string | null;
  /** Aktualna seria samodzielnych sukcesów; 0 = ostatnia samodzielna próba nie była sukcesem. */
  streak: number;
}

/** Kandydat: rewizja elementu w przypiętej wersji zestawu. */
export interface ScheduleCandidate {
  itemRevisionId: string;
  itemId: string;
  position: number;
  target: string;
  source: string;
  acceptedAnswers: readonly string[];
  targetLocale: string;
  progress: Partial<Record<Skill, SkillSnapshot>>;
  /** Nieudane oceniane próby w bieżącej sesji od ostatniego wsparcia. */
  failuresThisSession: number;
  /** Czy pokazano już prezentację wsparcia po dwóch błędach. */
  supportedThisSession: boolean;
  /** Odtwarzalny stan ograniczonego cyklu wsparcia. */
  support?: SupportState;
  /** Odtwarzalna, niezakończona praca Recall/pisowni/wymowy. */
  work?: Partial<Record<"recall" | "spelling" | "pronunciation", SkillWork>>;
  ownPresentationCompleted?: boolean;
  readingEvidenceDirections?: Partial<Record<ReadingDirection, number>>;
  recognitionFallbackUsedThisSession?: boolean;
  /** Liczba zadań tego elementu w bieżącej sesji. */
  usedThisSession: number;
  /** Prezentacje (exposure) tego elementu w bieżącej sesji. */
  presentationsThisSession: number;
  /** Ostatni kontakt z poprzednich sesji (zamrożony previousContact); null = brak. */
  lastContactAt: string | null;
  /** Ordinal ostatniego zadania tego elementu w bieżącej sesji. */
  lastUsedOrdinal: number | null;
  /** Reading: wystąpienia kierunków zadań tego elementu w bieżącej sesji. */
  readingDirections: Partial<Record<ReadingDirection, number>>;
  /** Zadania rozpoznawania tego elementu w bieżącej sesji, per typ. */
  practiceMix: { listening: number; reading: number };
  /** Etapy już wprowadzone zadaniem w jakiejkolwiek sesji dziecka. */
  introducedSkills: { recall: boolean; pronunciation: boolean };
  /** Czy treść tego elementu była wcześniej ujawniona dziecku. */
  hasBeenPresented?: boolean;
  /** Czy zadanie przygotowawcze dla tego celu wydano już w tej sesji. */
  testPreparationIssued?: boolean;
  settledReviewSkills?: readonly Skill[];
}

/** Inne elementy wersji — pula dystraktorów. */
export interface SchedulePeer {
  itemRevisionId: string;
  position: number;
  target: string;
  source: string;
  targetLocale: string;
  acceptedAnswers: readonly string[];
}

export interface ScheduleInput {
  now: string;
  policy: Policy;
  microphoneEnabled: boolean;
  /** Pozostały budżet zadań ocenianych. */
  assessedRemaining: number;
  /** Ordinal, jaki otrzyma nowo wydane zadanie. */
  nextOrdinal: number;
  candidates: readonly ScheduleCandidate[];
  peers: readonly SchedulePeer[];
  /** Klucze celów objęte aktywną rezerwacją w kontekście sesji. */
  reservedTargetKeys: readonly string[];
  /** Klucze sprawdzeń rozliczonych w tej sesji (wykonane albo pominięte). */
  settledCheckTargetKeys?: readonly string[];
  /** Prywatny, przypięty do sesji kontekst przygotowania do sprawdzianu. */
  testPreparation?: { testDate: string | null; timezone: string };
  /** Ostatnie dwa oceniane powody w kolejności chronologicznej. */
  recentAssessedReasons?: readonly ScheduleReason[];
  /** Powtarzające się, wiarygodne pomyłki tego dziecka w bieżącym zestawie. */
  confusions?: readonly ConfusionPair[];
  recentAssessedTasks?: readonly { reason: ScheduleReason; skill: Skill | null; statusAtIssue: ProgressStatus | null }[];
}

export interface PlannedOption {
  itemRevisionId: string;
  text: string;
  correct: boolean;
}

/** Jawna przyczyna decyzji — trafia do kontekstu zadania i sesji. */
export type ScheduleReason =
  | "due-check"
  | "support"
  | "retry-after-support"
  | "test-preparation"
  | "test-preparation-break"
  | "stage-introduction"
  | "new-material"
  | "recognition-fallback"
  | "new-practice"
  | "due-review"
  | "difficulty-break"
  | "filler-practice"
  | "extra-practice";

export interface TaskPlan {
  itemRevisionId: string;
  exerciseType: ExerciseType;
  direction?: ReadingDirection;
  options?: PlannedOption[];
  /** Klucze celów ujawniane przez publiczną treść zadania. */
  revealsTargetKeys: string[];
  assessed: boolean;
  reason: ScheduleReason;
  /** Prywatny identyfikator źródłowego zadania trudności. */
  supportCycleId?: string;
  skillAtIssue?: Skill;
  statusAtIssue?: ProgressStatus | null;
  /** Rezerwacje utrzymywane po tej decyzji (zapis do kontekstu sesji). */
  keepsReservations: string[];
}

/** Umiejętności z należnym niezależnym sprawdzeniem (rezerwowane). */
const CHECK_SKILLS: readonly ("recall" | "spelling")[] = ["recall", "spelling"];

function keyOf(target: string, locale: string): string {
  return computeTargetKey(target, locale);
}

function isDue(snapshot: SkillSnapshot | undefined, now: string): boolean {
  // termin powrotu niesie wyłącznie oceniana umiejętność; nieznane słowa
  // nie mają nextReviewAt, więc nie są sprawdzane przed nauką (SPEC §13)
  return (
    snapshot !== undefined &&
    snapshot.status !== "not_assessed" &&
    snapshot.nextReviewAt !== null &&
    snapshot.nextReviewAt <= now
  );
}

/** Najbliższy termin należnego sprawdzenia Recall/pisowni elementu. */
interface DueCheckSelection { skill: "recall" | "spelling"; due: string; status: ProgressStatus | null; }

function dueCheckSelection(candidate: ScheduleCandidate, now: string): DueCheckSelection | null {
  const dueChecks: DueCheckSelection[] = [];
  for (const skill of CHECK_SKILLS) {
    if (candidate.settledReviewSkills?.includes(skill)) continue;
    const work = candidate.work?.[skill];
    if (work?.eligibleAt !== null && work !== undefined) {
      if (work.dueNow) dueChecks.push({ skill, due: work.eligibleAt, status: candidate.progress[skill]?.status ?? null });
      continue;
    }
    const snapshot = candidate.progress[skill];
    if (!isDue(snapshot, now)) continue;
    dueChecks.push({ skill, due: snapshot!.nextReviewAt!, status: snapshot!.status });
  }
  return dueChecks.sort((a, b) => a.due.localeCompare(b.due) || (a.skill === "recall" ? -1 : 1))[0] ?? null;
}

function oldestDue(
  candidates: readonly ScheduleCandidate[],
  now: string,
  settled: ReadonlySet<string>,
): { candidate: ScheduleCandidate; check: DueCheckSelection } | null {
  let best: { candidate: ScheduleCandidate; check: DueCheckSelection } | null = null;
  for (const candidate of candidates) {
    const check = dueCheckSelection(candidate, now);
    if (check === null) continue;
    if (settled.has(keyOf(candidate.target, candidate.targetLocale))) continue;
    if (best === null || check.due < best.check.due || (check.due === best.check.due && candidate.position < best.candidate.position)) {
      best = { candidate, check };
    }
  }
  return best;
}

function unseenFresh(candidates: readonly ScheduleCandidate[]): ScheduleCandidate[] {
  return candidates
    .filter(
      (c) =>
        c.usedThisSession === 0 &&
        !c.ownPresentationCompleted &&
        Object.values(c.progress).every((s) => s === undefined || s.status === "not_assessed"),
    )
    .sort((a, b) => a.position - b.position);
}

/**
 * Pokazane dokładnie raz prezentacją w tej sesji — czekają na pierwsze
 * rozpoznawanie. Zadanie rozpoznawania nie jest prezentacją: element
 * dotknięty utrwalaniem nie wraca natychmiast jako „świeżo pokazany”.
 */
function presentedOnce(candidates: readonly ScheduleCandidate[]): ScheduleCandidate[] {
  return candidates
    .filter((c) => c.usedThisSession === 1 && c.presentationsThisSession === 1)
    .sort((a, b) => a.position - b.position);
}

/**
 * Pula lekkiego ćwiczenia rozpoznawania: elementy widziane w tej sesji
 * (utrwalanie) oraz rozpoczęte w poprzednich (ćwiczenie bez blokady
 * harmonogramu). Kolejność: nieopanowane najpierw, najrzadziej użyte
 * w tej sesji, najdawniej widziane (previousContact, brak kontaktu
 * liczy się jako najstarszy), na końcu pozycja. Dzięki temu sesja na
 * w pełni rozpoczętym zestawie rotuje całym materiałem zamiast wiercić
 * jeden element (regresja „zawsze styczeń”).
 */
function practicePool(candidates: readonly ScheduleCandidate[]): ScheduleCandidate[] {
  return candidates
    .filter((c) => c.usedThisSession > 0 || isStarted(c) || c.ownPresentationCompleted === true)
    .sort(
      (a, b) =>
        Number(isFullyMastered(a)) - Number(isFullyMastered(b)) ||
        a.usedThisSession - b.usedThisSession ||
        (a.lastContactAt ?? "").localeCompare(b.lastContactAt ?? "") ||
        a.position - b.position,
    );
}

const RECOGNITION_DIRECTIONS: readonly (ReadingDirection | "listening")[] = [
  "listening", "target_to_source", "source_to_target",
];

function recognitionPossibleWithoutReservations(target: ScheduleCandidate, peers: readonly SchedulePeer[]): boolean {
  return RECOGNITION_DIRECTIONS.some((direction) => buildRecognitionOptions({
    target, peers, direction, reservedTargetKeys: [], rotateBy: 0,
  }) !== null);
}

function recognitionFallback(
  target: ScheduleCandidate,
  reserved: ReadonlySet<string>,
  peers: readonly SchedulePeer[],
  keepsReservations: string[],
): TaskPlan | null {
  if (
    target.recognitionFallbackUsedThisSession ||
    reserved.has(keyOfCandidate(target)) ||
    recognitionPossibleWithoutReservations(target, peers)
  ) return null;
  return {
    itemRevisionId: target.itemRevisionId,
    exerciseType: "exposure",
    revealsTargetKeys: [keyOfCandidate(target)],
    assessed: false,
    reason: "recognition-fallback",
    keepsReservations,
  };
}

function recognitionTaskPlan(
  target: ScheduleCandidate,
  input: ScheduleInput,
  reserved: ReadonlySet<string>,
  keepsReservations: string[],
  reason: ScheduleReason,
  direction: ReadingDirection | "listening",
  allowAlternative = false,
): TaskPlan | null {
  const directions = allowAlternative
    ? [direction, ...RECOGNITION_DIRECTIONS.filter((item) => item !== direction)]
    : [direction];
  for (const selectedDirection of directions) {
    const built = buildRecognitionOptions({
      target,
      peers: input.peers,
      direction: selectedDirection,
      reservedTargetKeys: [...reserved],
      rotateBy: input.nextOrdinal,
      preferredRevisionIds: input.confusions
        ?.filter((pair) => pair.expectedItemRevisionId === target.itemRevisionId &&
          pair.exerciseType === (selectedDirection === "listening" ? "listening" : selectedDirection === "source_to_target" ? "reverse_recognition" : "reading") &&
          pair.direction === (selectedDirection === "listening" ? undefined : selectedDirection))
        .map((pair) => pair.answeredItemRevisionId),
    });
    if (!built) continue;
    return {
      itemRevisionId: target.itemRevisionId,
      exerciseType: selectedDirection === "listening"
        ? "listening"
        : selectedDirection === "source_to_target" ? "reverse_recognition" : "reading",
      ...(selectedDirection === "listening" ? {} : { direction: selectedDirection }),
      options: built.options,
      revealsTargetKeys: built.revealsTargetKeys,
      assessed: true,
      reason,
      keepsReservations,
    };
  }
  const fallbackEligible = reason === "new-practice" || reason === "filler-practice" ||
    reason === "extra-practice" || reason === "test-preparation-break";
  const hasDueRecognition = isDue(target.progress.listening, input.now) || isDue(target.progress.reading, input.now);
  return fallbackEligible && !hasDueRecognition
    ? recognitionFallback(target, reserved, input.peers, keepsReservations)
    : null;
}

/** Wypełnia brakujący dowód; gdy historia nie rozstrzyga, rotuje sesję. */
export function chooseReadingDirection(
  evidence: Partial<Record<ReadingDirection, number>>,
  sessionCounts: Partial<Record<ReadingDirection, number>>,
): ReadingDirection {
  const t2sEvidence = evidence.target_to_source ?? 0;
  const s2tEvidence = evidence.source_to_target ?? 0;
  if (t2sEvidence === 0 && s2tEvidence > 0) return "target_to_source";
  if (s2tEvidence === 0 && t2sEvidence > 0) return "source_to_target";
  const t2s = sessionCounts.target_to_source ?? 0;
  const s2t = sessionCounts.source_to_target ?? 0;
  return s2t < t2s ? "source_to_target" : "target_to_source";
}

/** Czy element ma już jakąkolwiek ocenioną umiejętność (materiał rozpoczęty). */
function isStarted(candidate: ScheduleCandidate): boolean {
  return Object.values(candidate.progress).some((s) => s !== undefined && s.status !== "not_assessed");
}

/** Czy element ma samodzielny sukces rozpoznawania (słuch albo tekst). */
function recognitionSucceeded(candidate: ScheduleCandidate): boolean {
  const listening = candidate.progress.listening;
  const reading = candidate.progress.reading;
  return (listening?.streak ?? 0) >= 1 || (reading?.streak ?? 0) >= 1;
}

/**
 * Pierwsze zadanie kolejnego etapu (SPEC §13): po samodzielnym sukcesie
 * rozpoznawania element przechodzi do przypominania — jedna pisemna odpowiedź
 * ocenia też pisownię — a potem do wymowy. Elementy głębsze w stopniowaniu
 * (przypominanie wprowadzone, wymowa czeka) mają pierwszeństwo przed nową
 * falą przypomnień, więc pary „wpisz, potem powiedz" układają się blisko
 * siebie zamiast tyrać całą talię jednym typem zadania. Zadanie wydaje się
 * raz: etap „wprowadzony” pamięta historia zadań, więc próba technicznie
 * nieoceniona nie zapętla wprowadzania. Cel objęty rezerwacją pomijamy
 * w całości — speech ujawnia angielskie słowo zarezerwowane dla sprawdzenia.
 */
function introductionPlan(
  candidates: readonly ScheduleCandidate[],
  input: ScheduleInput,
  reserved: ReadonlySet<string>,
  keepsReservations: string[],
): TaskPlan | null {
  const pool = practicePool(candidates).slice().sort(
    (a, b) => Number(b.introducedSkills.recall) - Number(a.introducedSkills.recall),
  );
  for (const target of pool) {
    if (reserved.has(keyOfCandidate(target))) continue;
    const noRecognitionEvidenceAvailable =
      target.ownPresentationCompleted === true && !recognitionPossibleWithoutReservations(target, input.peers);
    if (!recognitionSucceeded(target) && !noRecognitionEvidenceAvailable) continue;
    if (!target.introducedSkills.recall) {
      return {
        itemRevisionId: target.itemRevisionId,
        exerciseType: "recall",
        revealsTargetKeys: [],
        assessed: true,
        reason: "stage-introduction",
        keepsReservations,
      };
    }
    if (!target.introducedSkills.pronunciation && input.microphoneEnabled) {
      return {
        itemRevisionId: target.itemRevisionId,
        exerciseType: "speech",
        revealsTargetKeys: [keyOfCandidate(target)],
        assessed: true,
        reason: "stage-introduction",
        keepsReservations,
      };
    }
  }
  return null;
}

/** Czy wszystkie znane umiejętności elementu są opanowane — idą na koniec kolejki. */
function isFullyMastered(candidate: ScheduleCandidate): boolean {
  const snapshots = Object.values(candidate.progress).filter((s) => s !== undefined);
  return snapshots.length > 0 && snapshots.every((s) => s!.status === "mastered");
}

/** Obciążenie jednego elementu zestawu dla rekomendacji (arch §12). */
export interface DeckWorkloadItem {
  /**
   * Migawki umiejętności elementu z etykietą umiejętności; puste = materiał
   * nieprzerobiony przez dziecko (prezentacja jeszcze się nie odbyła lub nie
   * było żadnej próby).
   */
  progress: ReadonlyArray<SkillSnapshot & { skill: Skill }>;
  /** Najwcześniejszy termin zachowanego sprawdzenia bez projekcji. */
  pendingCheckAt?: string | null;
  /** Wprowadzony etap Recall nadal nie został wydany. */
  recallIntroductionNeeded?: boolean;
}

/**
 * Czy zestaw ma teraz pracę zaplanowaną przez harmonogram: należne
 * sprawdzenie Recall/pisowni, powtórka umiejętności, wprowadzenie kolejnego
 * etapu albo nowy materiał? To podstawa rekomendacji na liście zestawów
 * dziecka; dodatkowe utrwalanie (extra-practice) jest dostępne zawsze i nie
 * czyni zestawu rekomendowanym — rekomendacja wskazuje wartość zaplanowaną.
 */
export function hasScheduledWork(items: readonly DeckWorkloadItem[], now: string): boolean {
  for (const item of items) {
    if (item.pendingCheckAt !== undefined && item.pendingCheckAt !== null && item.pendingCheckAt <= now) return true;
    if (item.recallIntroductionNeeded) return true;
    let started = item.pendingCheckAt !== undefined && item.pendingCheckAt !== null;
    let recognitionStreak = 0;
    let recallAssessed = false;
    for (const snapshot of item.progress) {
      if (snapshot.status !== "not_assessed") {
        started = true;
      }
      if (isDue(snapshot, now)) {
        return true;
      }
      if (snapshot.skill === "listening" || snapshot.skill === "reading") {
        recognitionStreak = Math.max(recognitionStreak, snapshot.streak);
      }
      if (snapshot.skill === "recall") {
        recallAssessed = true;
      }
    }
    if (!started) {
      return true; // nowy materiał do prezentacji
    }
    // wprowadzenie przypominania czeka (SPEC §13); samej wymowy nie sprawdzamy,
    // bo rekomendacja nie może zależeć od mikrofonu — wymowa wchodzi w sesji
    if (recognitionStreak >= 1 && !recallAssessed) {
      return true;
    }
  }
  return false;
}

function keyOfCandidate(c: ScheduleCandidate): string {
  return keyOf(c.target, c.targetLocale);
}

function testPreparationPriority(candidate: ScheduleCandidate): readonly [number, number, number, number] {
  const recall = candidate.progress.recall;
  const spelling = candidate.progress.spelling;
  const needsReconfirmation = Number(
    recall?.status === "needs_reconfirmation" || spelling?.status === "needs_reconfirmation",
  );
  const spellingNeeded = Number(
    spelling !== undefined && spelling.status !== "not_assessed" && spelling.status !== "mastered",
  );
  const recallNeeded = Number(
    recall !== undefined && recall.status !== "not_assessed" && recall.status !== "mastered",
  );
  return [-needsReconfirmation, -spellingNeeded, -recallNeeded, candidate.position];
}

function comparePriority(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function testPreparationCandidate(
  candidates: readonly ScheduleCandidate[],
  reserved: ReadonlySet<string>,
  settled: ReadonlySet<string>,
): ScheduleCandidate | null {
  return candidates
    .filter((candidate) =>
      candidate.hasBeenPresented === true &&
      recognitionSucceeded(candidate) &&
      !(candidate.progress.recall?.status === "mastered" && candidate.progress.spelling?.status === "mastered") &&
      candidate.testPreparationIssued !== true &&
      !reserved.has(keyOfCandidate(candidate)) &&
      !settled.has(keyOfCandidate(candidate)),
    )
    .slice()
    .sort((a, b) => comparePriority(testPreparationPriority(a), testPreparationPriority(b)))[0] ?? null;
}

export function selectTask(input: ScheduleInput): TaskPlan | null {
  if (input.candidates.length === 0 || input.assessedRemaining <= 0) {
    return null;
  }

  const reserved = new Set(input.reservedTargetKeys);
  const settled = new Set(input.settledCheckTargetKeys ?? []);
  for (const candidate of input.candidates) {
    if (dueCheckSelection(candidate, input.now) !== null && !settled.has(keyOfCandidate(candidate))) {
      reserved.add(keyOfCandidate(candidate));
    }
  }
  const keepsReservations = [...reserved];

  // 1. Zarezerwowane sprawdzenie Recall/pisowni wykonujemy pierwsze: jedna
  //    pisemna odpowiedź dostarcza obu wyników, zanim feedback ujawni słowo.
  //    Sprawdzenie rozliczone w tej sesji (odpowiedź, „Nie pamiętam”, pominięcie
  //    albo zdradzająca podpowiedź) nie jest wydawane ponownie.
  const due = oldestDue(input.candidates, input.now, settled);
  if (due) {
    return {
      itemRevisionId: due.candidate.itemRevisionId,
      exerciseType: "recall",
      revealsTargetKeys: [],
      assessed: true,
      reason: "due-check",
      skillAtIssue: due.check.skill,
      statusAtIssue: due.check.status,
      keepsReservations,
    };
  }

  // 2. Dwa błędy: prezentacja wsparcia ujawnia wzorzec (SPEC §16); to jedyny
  //    wyjątek od zasady niepowracania do elementu bezpośrednio po trudności.
  const needsSupport = input.candidates.find((c) =>
    c.support ? c.support.phase === "needed" : c.failuresThisSession >= input.policy.supportAfterFailures && !c.supportedThisSession,
  );
  if (needsSupport) {
    return {
      itemRevisionId: needsSupport.itemRevisionId,
      exerciseType: "exposure",
      revealsTargetKeys: [keyOfCandidate(needsSupport)],
      assessed: false,
      reason: "support",
      supportCycleId: needsSupport.support?.sourceTaskId ?? undefined,
      keepsReservations,
    };
  }

  // 3. Po wsparciu łatwiejsze ćwiczenie dopiero po przerwie na inne zadania.
  const retryAfterSupport = input.candidates
    .filter(
      (c) =>
        (c.support ? c.support.phase === "waiting" || c.support.phase === "retry_due" : c.supportedThisSession) &&
        c.lastUsedOrdinal !== null &&
        input.nextOrdinal - c.lastUsedOrdinal >= 2,
    )
    .sort((a, b) => (a.lastUsedOrdinal ?? 0) - (b.lastUsedOrdinal ?? 0))[0];
  if (retryAfterSupport) {
    const retryType = retryAfterSupport.support?.retryType ?? "listening";
    if (retryType === "listening") {
      const retryPlan = recognitionTaskPlan(
        retryAfterSupport, input, reserved, keepsReservations, "retry-after-support", "listening",
      );
      if (retryPlan) return { ...retryPlan, supportCycleId: retryAfterSupport.support?.cycleId ?? retryAfterSupport.support?.sourceTaskId ?? undefined };
    } else {
      return {
        itemRevisionId: retryAfterSupport.itemRevisionId,
        exerciseType: retryType,
        revealsTargetKeys: [keyOfCandidate(retryAfterSupport)],
        assessed: true,
        reason: "retry-after-support",
        supportCycleId: retryAfterSupport.support?.cycleId ?? retryAfterSupport.support?.sourceTaskId ?? undefined,
        keepsReservations,
      };
    }
  }

  const recentReasons = input.recentAssessedReasons ?? [];
  const needsPreparationBreak =
    recentReasons.length >= 2 && recentReasons.slice(-2).every((reason) => reason === "test-preparation");
  if (needsPreparationBreak) {
    const safeKnown = practicePool(input.candidates).find((candidate) => !reserved.has(keyOfCandidate(candidate)));
    if (safeKnown) {
      const plan = recognitionPlan(safeKnown, input, reserved, keepsReservations, "test-preparation-break", true);
      if (plan) return plan;
    }
  }

  if (
    !needsPreparationBreak &&
    input.testPreparation &&
    isTestPreparationWindow({
      now: input.now,
      testDate: input.testPreparation.testDate,
      timezone: input.testPreparation.timezone,
    })
  ) {
    const target = testPreparationCandidate(input.candidates, reserved, settled);
    if (target) {
      return {
        itemRevisionId: target.itemRevisionId,
        exerciseType: "recall",
        revealsTargetKeys: [],
        assessed: true,
        reason: "test-preparation",
        keepsReservations,
      };
    }
  }

  const recentAssessedTasks = input.recentAssessedTasks ?? [];
  const needsDifficultyBreak = recentAssessedTasks.length >= 2 && recentAssessedTasks.slice(-2).every((task) =>
    (task.reason === "due-check" || task.reason === "due-review") &&
    (task.statusAtIssue === "learning" || task.statusAtIssue === "needs_reconfirmation"),
  );
  if (needsDifficultyBreak) {
    const safeKnown = practicePool(input.candidates).find((candidate) => !reserved.has(keyOfCandidate(candidate)));
    if (safeKnown) {
      const plan = recognitionPlan(safeKnown, input, reserved, keepsReservations, "difficulty-break", true);
      if (plan) return plan;
    }
  }

  // Należne powtórki wyprzedzają świeżą porcję nowego materiału; pominięcie
  // rozliczonej umiejętności nie powtarza jej w nieskończonej pętli sesji.
  type DueSkill = { candidate: ScheduleCandidate; skill: Skill; due: string };
  const dueSkills: DueSkill[] = [];
  for (const candidate of input.candidates) {
    if (reserved.has(keyOfCandidate(candidate))) continue;
    for (const [skill, snapshot] of Object.entries(candidate.progress) as [Skill, SkillSnapshot][]) {
      if (skill === "recall" || skill === "spelling") continue;
      if (candidate.settledReviewSkills?.includes(skill)) continue;
      if (skill === "pronunciation" && !input.microphoneEnabled) continue;
      if (isDue(snapshot, input.now)) dueSkills.push({ candidate, skill, due: snapshot.nextReviewAt! });
    }
  }
  dueSkills.sort((a, b) =>
    a.due < b.due ? -1 : a.due > b.due ? 1 : a.candidate.position - b.candidate.position,
  );
  for (const dueSkill of dueSkills) {
    if (dueSkill.skill === "reading") {
      const direction = chooseReadingDirection(dueSkill.candidate.readingEvidenceDirections ?? {}, dueSkill.candidate.readingDirections);
      const plan = recognitionTaskPlan(dueSkill.candidate, input, reserved, keepsReservations, "due-review", direction);
      if (plan) return { ...plan, skillAtIssue: dueSkill.skill, statusAtIssue: dueSkill.candidate.progress[dueSkill.skill]?.status };
      continue;
    }
    if (dueSkill.skill === "pronunciation") {
      return {
        itemRevisionId: dueSkill.candidate.itemRevisionId, exerciseType: "speech",
        revealsTargetKeys: [keyOfCandidate(dueSkill.candidate)], assessed: true, reason: "due-review",
        skillAtIssue: dueSkill.skill, statusAtIssue: dueSkill.candidate.progress[dueSkill.skill]?.status,
        keepsReservations,
      };
    }
    const plan = recognitionTaskPlan(dueSkill.candidate, input, reserved, keepsReservations, "due-review", "listening");
    if (plan) return { ...plan, skillAtIssue: dueSkill.skill, statusAtIssue: dueSkill.candidate.progress[dueSkill.skill]?.status };
  }

  // Wprowadzanie etapów odbywa się po należnych powtórkach; co drugi slot
  // przeplata je z porcjami nowego materiału.
  if (input.nextOrdinal % 2 === 1 || input.candidates.some((candidate) =>
    candidate.ownPresentationCompleted && !recognitionPossibleWithoutReservations(candidate, input.peers),
  )) {
    const introduction = introductionPlan(input.candidates, input, reserved, keepsReservations);
    if (introduction) return introduction;
  }

  // 4. Nowy materiał porcjami 2–3: prezentacje przeplatane łatwym
  //    rozpoznawaniem ze słuchu świeżo pokazanych elementów (SPEC §13).
  const fresh = presentedOnce(input.candidates).filter((candidate) => !reserved.has(keyOfCandidate(candidate)));
  if (fresh.length >= 2 || (fresh.length === 1 && unseenFresh(input.candidates).length === 0)) {
    const target = fresh[0]!;
    const plan = recognitionTaskPlan(target, input, reserved, keepsReservations, "new-practice", "listening", true);
    if (plan) return plan;
  }
  const nextUnseen = unseenFresh(input.candidates).find((candidate) => !reserved.has(keyOfCandidate(candidate)));
  if (nextUnseen) {
    return {
      itemRevisionId: nextUnseen.itemRevisionId,
      exerciseType: "exposure",
      revealsTargetKeys: [keyOfCandidate(nextUnseen)],
      assessed: false,
      reason: "new-material",
      keepsReservations,
    };
  }

  // 6. Lekkie ćwiczenie rozpoznawania bez należnych zadań: jedna pula dla
  //     utrwalania elementów widzianych w tej sesji (filler-practice) i dla
  //     ćwiczenia zestawu w dowolnym momencie (extra-practice, arch §9.3 —
  //     nie wymuszamy oczekiwania na zegar). Miks rozpoznawania per element:
  //     słuch, potem naprzemienne kierunki tekstu, aby oba kierunki reading
  //     zbierały dowody. Jakość dowodów chroni reguła niezależności
  //     (SPEC §18.1) — próba w ciągu 5 minut od ujawnienia wzorca to
  //     utrwalanie, nie samodzielne sprawdzenie, więc dodatkowe ćwiczenie
  //     nie zawyża serii kwalifikujących ani nie zastępuje sprawdzianu.
  //     Budżet sesji obowiązuje jak zwykle.
  const practiceTarget = practicePool(input.candidates).find((c) => !reserved.has(keyOfCandidate(c)));
  if (practiceTarget) {
    const consolidating = practiceTarget.usedThisSession > 0;
    return recognitionPlan(
      practiceTarget,
      input,
      reserved,
      keepsReservations,
      consolidating ? "filler-practice" : "extra-practice",
      consolidating
        ? practiceTarget.practiceMix.listening < practiceTarget.practiceMix.reading
        : input.nextOrdinal % 2 === 0,
    );
  }

  return null;
}

/**
 * Lekkie ćwiczenie rozpoznawania: słuch albo tekst z dystraktorami rówieśników.
 * Wspólne dla utrwalania w sesji (filler-practice) i dodatkowego ćwiczenia
 * poza harmonogramem (extra-practice); cele objęte rezerwacją nie mogą być
 * ani celem, ani dystraktorem.
 */
function recognitionPlan(
  target: ScheduleCandidate,
  input: ScheduleInput,
  reserved: ReadonlySet<string>,
  keepsReservations: string[],
  reason: "filler-practice" | "extra-practice" | "test-preparation-break" | "difficulty-break",
  preferListening: boolean,
): TaskPlan | null {
  const direction = preferListening
    ? "listening"
    : chooseReadingDirection(target.readingEvidenceDirections ?? {}, target.readingDirections);
  return recognitionTaskPlan(target, input, reserved, keepsReservations, reason, direction, true);
}
