import type { LessonObjectiveAgentTools, LessonPoolAgentProvider } from "../../packages/server/src/ports/ai";

/**
 * Jedno ćwiczenie wysłane przez agenta puli w `submit` i odpowiedź walidacji, którą model dostał
 * z powrotem (`accepted` albo `errors`). Zawiera treść ćwiczenia — wyłącznie do pliku wyników próby
 * poza repozytorium, nigdy na konsolę.
 */
export type AgentSubmission = {
  readonly objective: string;
  /** Numer wywołania `submit` w zagadnieniu (od 1). */
  readonly call: number;
  readonly index: number;
  readonly exerciseType: string | null;
  readonly exercise: unknown;
} & ({ readonly accepted: string; readonly notes?: readonly string[] } | { readonly errors: readonly string[] });

const slugOf = (objectiveId: string) => objectiveId.split(".").at(-1) ?? objectiveId;

/**
 * Agent puli, który zapisuje do `log` każde wysłane ćwiczenie z wynikiem narzędzia (próba
 * `chapter-generation.probe.test.ts`: przyczyny odrzuceń nie trafiają do punktu kontrolnego ani
 * dziennika). Wynik narzędzia i pozostałe narzędzia przechodzą bez zmian.
 */
export function recordingAgent(agent: LessonPoolAgentProvider, log: AgentSubmission[]): LessonPoolAgentProvider {
  return {
    name: agent.name,
    model: agent.model,
    planObjectives: (input, tools, cost, signal) => agent.planObjectives(input, tools, cost, signal),
    runObjective: (input, tools, cost, signal) => {
      const objective = slugOf(input.objective.id);
      let call = 0;
      const recorded: LessonObjectiveAgentTools = {
        submit: async (raw) => {
          call += 1;
          const current = call;
          const outcome = await tools.submit(raw);
          for (const result of outcome.results) {
            const exercise = raw.exercises[result.index];
            const exerciseType =
              exercise !== null && typeof exercise === "object" && typeof (exercise as { exerciseType?: unknown }).exerciseType === "string"
                ? (exercise as { exerciseType: string }).exerciseType
                : null;
            log.push("accepted" in result
              ? { objective, call: current, index: result.index, exerciseType, accepted: result.accepted, ...(result.notes === undefined ? {} : { notes: result.notes }), exercise }
              : { objective, call: current, index: result.index, exerciseType, errors: result.errors, exercise });
          }
          return outcome;
        },
        remove: (id) => tools.remove(id),
        shouldStop: () => tools.shouldStop(),
      };
      return agent.runObjective(input, recorded, cost, signal);
    },
  };
}

/**
 * Miary przebiegu kontrolnego z dziennika wysłanych ćwiczeń. Same liczby i id reguł — bez treści,
 * więc nadają się też na konsolę.
 */
export type SubmissionMetrics = {
  readonly submitted: number;
  readonly accepted: number;
  /** Przyjęte już w pierwszym wywołaniu `submit` zagadnienia. */
  readonly acceptedFirstCall: number;
  /** Kody odrzuceń całego runu (z punktu kontrolnego): wynik narzędzia nie niesie kodu, więc nie da się ich przypisać do wysłanego ćwiczenia. */
  readonly rejectedByCode: Record<string, number>;
  /** Odrzucone wysłane ćwiczenia per id reguły z prefiksu `[id]` błędu (ćwiczenie liczy się raz na regułę). */
  readonly rejectedByRule: Record<string, number>;
  /** Przyjęte ćwiczenia per id reguły z prefiksu `[id]` noty (raz na ćwiczenie i regułę). */
  readonly acceptedWithNotes: Record<string, number>;
  /** Różne wywołania `submit` (zagadnienie + numer wywołania); po „+N” numeracja zagadnień się powtarza, więc to dolna granica. */
  readonly submitCalls: number;
  readonly openAnswers: number;
  /** Przyjęte pytania otwarte, których podpowiedź przeżyła: niepusty `hint` i brak noty `[hint.reveals_words]` (jedyne miejsce usuwania podpowiedzi). */
  readonly openAnswersWithHint: number;
};

const OPEN_ANSWER_TYPE = "lesson_open_answer";
const HINT_REMOVED_RULE = "hint.reveals_words";

/** Id reguł z prefiksów `[id]` błędów lub not; wiersze bez prefiksu (np. „unchecked: …”) pomijamy. */
function ruleIdsOf(lines: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const text of lines) {
    const id = /^\[([a-z0-9_.]+)\]/u.exec(text)?.[1];
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** `rejectionCodes`: kody odrzuceń runu z punktu kontrolnego (domyślnie brak). */
export function submissionMetrics(log: readonly AgentSubmission[], rejectionCodes: Readonly<Record<string, number>> = {}): SubmissionMetrics {
  const rejectedByRule: Record<string, number> = {};
  const acceptedWithNotes: Record<string, number> = {};
  const calls = new Set<string>();
  let accepted = 0;
  let acceptedFirstCall = 0;
  let openAnswers = 0;
  let openAnswersWithHint = 0;
  for (const entry of log) {
    calls.add(`${entry.objective}#${entry.call}`);
    if ("errors" in entry) {
      for (const id of ruleIdsOf(entry.errors)) bump(rejectedByRule, id);
      continue;
    }
    accepted += 1;
    if (entry.call === 1) acceptedFirstCall += 1;
    const noteRules = ruleIdsOf(entry.notes ?? []);
    for (const id of noteRules) bump(acceptedWithNotes, id);
    if (entry.exerciseType === OPEN_ANSWER_TYPE) {
      openAnswers += 1;
      const hint = (entry.exercise as { hint?: unknown } | null)?.hint;
      if (typeof hint === "string" && hint.trim() !== "" && !noteRules.has(HINT_REMOVED_RULE)) openAnswersWithHint += 1;
    }
  }
  return {
    submitted: log.length,
    accepted,
    acceptedFirstCall,
    rejectedByCode: { ...rejectionCodes },
    rejectedByRule,
    acceptedWithNotes,
    submitCalls: calls.size,
    openAnswers,
    openAnswersWithHint,
  };
}

/** Liczniki oczyszczeń przy przyjęciu, zsumowane z wierszy `[lesson-agent] … obj=…` dziennika generacji (jedyne ich źródło poza statystykami w pamięci workera). */
export function cleanupCounters(lessonLog: readonly string[]): { hintsRemoved: number; variantsRemoved: number; quotesSnapped: number } {
  const totals = { hintsRemoved: 0, variantsRemoved: 0, quotesSnapped: 0 };
  for (const text of lessonLog) {
    if (!text.startsWith("[lesson-agent]") || !/ obj=/u.test(text)) continue;
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      const value = new RegExp(String.raw` ${key}=(\d+)`, "u").exec(text)?.[1];
      if (value !== undefined) totals[key] += Number(value);
    }
  }
  return totals;
}
