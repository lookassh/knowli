import type {
  AssistanceKind,
  AttemptQualification,
  IndependenceReason,
  Policy,
  ProgressStatus,
  SkillOutcome,
} from "../types";
import { crossBreakEligible } from "../independence";
import {
  projectSeries,
  windowHasConfirmedStreak,
  type SeriesEntry,
  type SeriesRules,
} from "../series-projection";

/**
 * Kontekst kwalifikacji próby celu lekcji (design „Kwalifikacja i projekcja
 * celów”). Analogiczny do `EvaluationContext` słówek, ale ujawnienie odpowiedzi
 * jest już rozstrzygnięte przez moduł (`answerPreviouslyExposed`): dla celów
 * liczy się, czy `target_key` ćwiczenia był kiedykolwiek pokazany dziecku
 * (req 7.2), a nie okno sekund od ekspozycji tego samego zadania.
 */
export interface LessonQualificationContext {
  receivedAt: string;
  policy: Policy;
  firstTry: boolean;
  assistance: readonly AssistanceKind[];
  answerPreviouslyExposed: boolean;
  previousSessionContactAt: string | null;
  timezone: string;
}

/**
 * Kwalifikacja próby jako niezależnego zastosowania reguły (req 7.2, SPEC §18.1):
 * pierwsza odpowiedź w zadaniu, bez wsparcia i gdy odpowiedź nie była wcześniej
 * ujawniona dziecku. `confirmationEligible` z tej samej reguły przerwy co słówka.
 * Kolejność przyczyn deterministyczna: not_first_try → assisted → recent_exposure.
 */
export function qualifyLessonAttempt(ctx: LessonQualificationContext): AttemptQualification {
  const reason = independenceReason(ctx);
  return {
    independent: reason === undefined,
    confirmationEligible: crossBreakEligible(
      ctx.receivedAt,
      ctx.previousSessionContactAt,
      ctx.policy,
      ctx.timezone,
    ),
    ...(reason ? { reason } : {}),
  };
}

function independenceReason(ctx: LessonQualificationContext): IndependenceReason | undefined {
  if (!ctx.firstTry) return "not_first_try";
  if (ctx.assistance.length > 0) return "assisted";
  // Ujawnienie `target_key` w dowolnym zadaniu/lekcji/kartkówce — reużywamy
  // literału `recent_exposure`, bo z punktu widzenia niezależności to ten sam
  // powód: odpowiedź była widziana.
  if (ctx.answerPreviouslyExposed) return "recent_exposure";
  return undefined;
}

/** Wpis historii oceny celu — źródło projekcji postępu per reguła (req 7.3–7.5). */
export interface ObjectiveHistoryEntry {
  receivedAt: string;
  policyVersion: string;
  objectiveId: string;
  itemId: string;
  outcome: SkillOutcome;
  reason?: string;
  independent: boolean;
  confirmationEligible: boolean;
}

/** Projekcja postępu jednego celu. */
export interface ObjectiveProgress {
  status: ProgressStatus;
  streak: number;
  nextReviewAt: string | null;
}

interface ObjectiveSeriesEntry extends SeriesEntry {
  itemId: string;
}

/**
 * Projekcja postępu per cel z historii ocen (req 7.3–7.5). Czysta funkcja:
 * interpretuje tylko wpisy bieżącej wersji polityki i `receivedAt <= now`
 * (SPEC §20), rozdziela po `objectiveId` i stosuje wspólny projektor serii.
 * Reguła opanowania: okno `successStreakRequired` ostatnich kwalifikujących
 * sukcesów na RÓŻNYCH `itemId` i co najmniej jeden `confirmationEligible` —
 * sukces na tym samym ćwiczeniu co wcześniejszy w oknie nie zwiększa serii okna,
 * ale jej nie przerywa. Błąd (w tym „Nie pamiętam”) przerywa serię; nieocenione
 * i niesamodzielne są neutralne; po utracie opanowania status
 * `needs_reconfirmation`. `nextReviewAt` tym samym mechanizmem co słówka.
 */
export function projectObjectiveProgress(
  history: readonly ObjectiveHistoryEntry[],
  policy: Policy,
  now: string,
): Record<string, ObjectiveProgress> {
  const nowMs = Date.parse(now);
  const relevant = history
    .filter((entry) => entry.policyVersion === policy.version && Date.parse(entry.receivedAt) <= nowMs)
    .slice()
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));

  const byObjective = new Map<string, ObjectiveHistoryEntry[]>();
  for (const entry of relevant) {
    const list = byObjective.get(entry.objectiveId) ?? [];
    list.push(entry);
    byObjective.set(entry.objectiveId, list);
  }

  const result: Record<string, ObjectiveProgress> = {};
  for (const [objectiveId, entries] of byObjective) {
    const seriesEntries: ObjectiveSeriesEntry[] = entries.map((entry) => ({
      receivedAt: entry.receivedAt,
      outcome: entry.outcome,
      independent: entry.independent,
      confirmationEligible: entry.confirmationEligible,
      itemId: entry.itemId,
    }));
    const { status, streak, nextReviewAt } = projectSeries(seriesEntries, policy, OBJECTIVE_RULES);
    result[objectiveId] = { status, streak, nextReviewAt };
  }
  return result;
}

/**
 * Czas ostatniego NIEZALEŻNEGO, poprawnego i ocenionego zastosowania reguły w
 * historii — JEDNO źródło prawdy dla `child_objective_progress.lastIndependentAt`
 * współdzielone przez ścieżkę przyrostową (lesson-attempts) i odbudowę
 * (progress-rebuild). Filtruje po `policyVersion` tak samo jak
 * `projectObjectiveProgress`, więc przełączenie wersji polityki nie rozjeżdża
 * obu ścieżek: liczy się tylko dowód bieżącej wersji. Zwraca ISO albo null.
 */
export function lastIndependentObjectiveAt(
  history: readonly ObjectiveHistoryEntry[],
  policyVersion: string,
): string | null {
  return (
    history
      .filter((h) => h.policyVersion === policyVersion && h.independent && h.outcome === "correct")
      .map((h) => h.receivedAt)
      .sort()
      .at(-1) ?? null
  );
}

/**
 * Reguła opanowania celu: sukces liczy do okna tylko na nowym ćwiczeniu
 * (różne `itemId`); opanowanie to pełne okno różnych ćwiczeń z co najmniej
 * jednym potwierdzeniem po przerwie.
 */
const OBJECTIVE_RULES: SeriesRules<ObjectiveSeriesEntry> = {
  countsTowardWindow(entry, window) {
    return !window.some((w) => w.itemId === entry.itemId);
  },
  // Do potwierdzenia potrzeba `successStreakRequired` RÓŻNYCH ćwiczeń (req 7.3).
  // Okno z definicji zawiera tylko różne `itemId` (patrz `countsTowardWindow`),
  // więc jego długość to liczba różnych ćwiczeń w serii.
  confirmationReady(window, policy) {
    return window.length >= policy.successStreakRequired;
  },
  windowSatisfiesMastery(window, policy) {
    return windowHasConfirmedStreak(window, policy);
  },
};
