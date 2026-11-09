import type { AgentCheckContext, ObjectiveAgentLimits } from "../../../domain/lessons/agent/admission";
import { createLessonAgentState, type LessonAgentState } from "../../../domain/lessons/agent/state";
import { objectiveStatus, type ObjectiveStatus } from "../../../domain/lessons/agent/status";
import { cardExposureSources } from "../../../domain/lessons/card-exposure-sources";
import { outsideStagePath } from "../../../domain/lessons/stages";
import type {
  AgentObjective,
  DynamicTopicData,
  LessonExerciseDraft,
  LessonTopic,
  SubjectModule,
} from "../../../domain/lessons/types";
import type { LlmLessonStageCounts } from "../../../ports/ai";
import { listenChoiceAllowance, mergeExamples, objectiveBatchCounts, poolStageCounts } from "./lesson-drafts";
import type { AgentFailure } from "./lesson-pool-agent-policy";
import type { RejectionLogEntry } from "./lesson-pool-agent-tools";

/**
 * Typy wejścia i wyniku próby generowania puli lekcji (przebieg bazowy, `lesson-baseline-pool.ts`) oraz
 * wspólny stan startowy: limity zagadnień, tryb „dodaj N” i zagadnienia do wygenerowania. Bez bazy i
 * bez identyfikatorów przedmiotów.
 */

export type { AgentFailure };

/** Źródło zagadnień — unia rozłączna (każdy wariant niesie swoje dane). */
export type AgentObjectiveSource =
  | { readonly source: "catalog"; readonly topic: LessonTopic }
  | { readonly source: "input"; readonly dynamicTopic: DynamicTopicData };

/**
 * Cel runu: `pool` (domyślnie) — pula wszystkich zagadnień; `add` — `count` nowych ćwiczeń jednego
 * zagadnienia (przycisk „Dogeneruj +N”, spec etapu 2a §6.4). `count` to liczba jeszcze brakujących nowych
 * ćwiczeń (wołający odejmuje nowe ćwiczenia z punktu kontrolnego).
 */
export type LessonPoolAgentTarget =
  | { readonly mode: "pool" }
  | { readonly mode: "add"; readonly objectiveId: string; readonly count: number };

export interface SettledObjective {
  readonly objectiveId: string;
  readonly status: "complete" | "incomplete" | "failed";
  readonly missing: readonly string[];
  /** Tylko przy `failed`: kod i ponawialność z `classifyLessonGenerationFailure`. */
  readonly failure?: AgentFailure;
  /** Przyjęte ćwiczenia puli zagadnienia w kolejności lekcji (bez `fixed`). */
  readonly exercises: readonly LessonExerciseDraft[];
  readonly examples: readonly string[];
  readonly steps: number;
  /** Wydatek runu w chwili rozliczenia (`cost.spentUsd`, zawiera już `initialSpentUsd`). */
  readonly spentUsd: number;
  /** Odrzucenia zagadnienia w tej próbie (kody trafiają do punktu kontrolnego także po przerwaniu runu). */
  readonly rejections: readonly RejectionLogEntry[];
}

/** Wynik rozwiązania zagadnień dla haka tematu (spec etapu 2a §6.1). */
export interface ResolvedObjectives {
  /** Temat wejścia (`input`); brak przy katalogu. */
  readonly dynamicTopic?: DynamicTopicData;
  readonly spentUsd: number;
}

export interface LessonPoolAgentRunInput {
  readonly runId: string;
  readonly subjectId: string;
  readonly deckId: string;
  readonly objectiveSource: AgentObjectiveSource;
  readonly topicTitle: string;
  readonly material: string;
  readonly instruction?: string;
  readonly interests?: readonly string[];
  readonly poolSize: number;
  readonly graderAvailable: boolean;
  readonly fixed: readonly LessonExerciseDraft[];
  readonly draftExamples: Readonly<Record<string, readonly string[]>>;
  /** Zagadnienia już zapisane: pomijane, ich ćwiczenia są w `fixed`. */
  readonly skipObjectives: readonly string[];
  readonly familyScope: string | null;
  readonly initialSpentUsd: number;
  /**
   * Wołany synchronicznie po każdym zgłoszeniu kosztu z wydatkiem runu (zawiera `initialSpentUsd`) —
   * także dla zagadnień, których hak nie zdąży się wykonać przed przerwaniem.
   */
  readonly onSpend?: (spentUsd: number) => void;
  /**
   * Przykłady kart wstawiane do stanu (liczą się do statusu i są źródłami ujawnień), np. z punktu
   * kontrolnego albo szkicu.
   */
  readonly initialExamples?: Readonly<Record<string, readonly string[]>>;
  /** `true` = przykłady z wyjścia modelu są ignorowane (ustalone, np. ze szkicu w trybie „dodaj N”); brak = `false`. */
  readonly examplesFixed?: boolean;
  /** Stałe źródła ujawnień spoza zagadnień (np. zdania historyjki szkicu). */
  readonly extraExposureSources?: readonly string[];
  /** Brak = `{ mode: "pool" }`. W trybie `add` `skipObjectives` nie ma znaczenia: działa tylko `objectiveId`. */
  readonly target?: LessonPoolAgentTarget;
  /**
   * Wołany raz, od razu po rozwiązaniu tematu (`catalog`/`input`), przed wywołaniami modelu; błąd przerywa
   * run jak błąd `onObjectiveSettled`.
   */
  readonly onObjectivesResolved?: (resolved: ResolvedObjectives) => Promise<void>;
  /**
   * Wołany szeregowo dla każdego rozliczonego zagadnienia (po walidacji puli); błąd przerywa run.
   */
  readonly onObjectiveSettled?: (settled: SettledObjective) => Promise<void>;
}

/** Statystyki próby: rekordy z wyjścia modelu, przyjęte do puli, odrzucenia według rodzaju i wywołania kontroli. */
export interface LessonPoolAgentStats {
  submitted: number;
  accepted: number;
  rejectedByKind: Record<string, number>;
  checkerCalls: number;
}

export interface LessonPoolAgentResult {
  /** Zagadnienia uruchomione w tym runie (bez pominiętych), w kolejności lekcji. */
  readonly objectives: readonly SettledObjective[];
  readonly stats: LessonPoolAgentStats;
  readonly rejections: readonly RejectionLogEntry[];
  readonly spentUsd: number;
  readonly unknownCostCalls: number;
}

/** Klucz stałych źródeł ujawnień spoza zagadnień (`extraExposureSources`) w `fixedSources` stanu. */
const EXTRA_SOURCES_KEY = "__extra";

export function slugOf(objectiveId: string): string {
  return objectiveId.slice(objectiveId.lastIndexOf(".") + 1);
}

/** Zerowe statystyki próby (także wynik „bez czasu na generowanie” w `lesson-agent-generation.ts`). */
export function emptyLessonPoolAgentStats(): LessonPoolAgentStats {
  return { submitted: 0, accepted: 0, rejectedByKind: {}, checkerCalls: 0 };
}

/** Limity przyjmowania i liczby promptu zagadnienia w trybie „dodaj N” (§6.4). */
export interface AddModePlan {
  readonly limits: ObjectiveAgentLimits;
  readonly promptTargets: { readonly stages: LlmLessonStageCounts; readonly listenAllowance: number };
}

/**
 * Tryb „dodaj N” (§6.4), braki etapów ze statusu zagadnienia na starcie (`start`):
 * - limit: `targetCount` statusu = ćwiczenia zagadnienia w `fixed` na ścieżce etapów + `count`;
 * - prompt: podział etapów = braki etapów + `count` rozłożone przez `poolStageCounts`, bez podnoszenia etapu
 *   samodzielnego (`fixed` już się liczy); dodatek słuchowy w prompcie = to, co jeszcze można przyjąć.
 */
function addModePlan(
  subject: SubjectModule,
  objective: LessonTopic["objectives"][number],
  fixed: readonly LessonExerciseDraft[],
  count: number,
  start: ObjectiveStatus,
): AddModePlan {
  const own = fixed.filter((draft) => draft.objectiveId === objective.id);
  const fixedOnStagePath = own.filter((draft) => !outsideStagePath(draft.exerciseType)).length;
  const listenAllowance = listenChoiceAllowance(subject, objective, []);
  const listenLeft = Math.max(0, listenAllowance - own.filter((draft) => draft.exerciseType === "lesson_listen_choice").length);
  const split = poolStageCounts(subject, objective.exerciseTypes, count);
  const stages = {
    guided: start.stageGaps.guided + split.guided,
    productive: start.stageGaps.productive + split.productive,
    independent: start.stageGaps.independent + split.independent,
  };
  return {
    limits: { targetCount: fixedOnStagePath + count },
    promptTargets: { stages, listenAllowance: listenLeft },
  };
}

/**
 * Limity zagadnień trybu „pula” z liczb per cel (`objectiveBatchCounts`): `targetCount` z puli rodzica.
 * Wspólne z kontrolą końcową workera przed zapisem do szkicu.
 */
export function lessonAgentLimits(
  subject: SubjectModule,
  topic: LessonTopic,
  poolSize: number,
): ReadonlyMap<string, ObjectiveAgentLimits> {
  const counts = objectiveBatchCounts(poolSize, topic.objectives.length, subject);
  return new Map(
    topic.objectives.map((objective, index) => [
      objective.id,
      { targetCount: counts[index]! },
    ]),
  );
}

/**
 * Stan startowy próby (pula i „dodaj N”): limity zagadnień, stan lekcji z `fixed`, przykładami
 * początkowymi i stałymi źródłami ujawnień, a w trybie „dodaj N” —
 * limity i liczby promptu zagadnienia z {@link addModePlan}.
 */
export function poolStartState(args: {
  readonly subject: SubjectModule;
  readonly topic: LessonTopic;
  readonly objectives: readonly AgentObjective[];
  readonly input: LessonPoolAgentRunInput;
}): {
  state: LessonAgentState;
  ctx: AgentCheckContext;
  addMode?: { readonly remaining: number };
  promptTargets?: AddModePlan["promptTargets"];
} {
  const { subject, topic, objectives, input } = args;
  const limits = new Map(lessonAgentLimits(subject, topic, input.poolSize));
  const ctx: AgentCheckContext = { subject, material: input.material, limits };
  const addTarget = input.target?.mode === "add" ? input.target : undefined;
  const extraSources = input.extraExposureSources ?? [];
  const state = createLessonAgentState({
    topic,
    objectives,
    fixed: input.fixed,
    examples: input.initialExamples ?? {},
    fixedSources: mergeExamples(
      mergeExamples(cardExposureSources(subject, topic), input.draftExamples),
      extraSources.length === 0 ? {} : { [EXTRA_SOURCES_KEY]: extraSources },
    ),
  });
  if (addTarget === undefined) return { state, ctx };
  // Tryb „dodaj N”: braki etapów na starcie (nie zależą od `targetCount`, więc wystarczą limity puli w ctx),
  // potem limity zagadnienia ustawiane raz.
  const objective = topic.objectives.find((item) => item.id === addTarget.objectiveId)!;
  const plan = addModePlan(subject, objective, input.fixed, addTarget.count, objectiveStatus(state, addTarget.objectiveId, ctx));
  limits.set(addTarget.objectiveId, plan.limits);
  return { state, ctx, addMode: { remaining: addTarget.count }, promptTargets: plan.promptTargets };
}

/** Zagadnienia do wygenerowania: w puli bez pominiętych (`skipObjectives`), w „dodaj N” tylko cel. */
export function objectivesToRun(objectives: readonly AgentObjective[], input: LessonPoolAgentRunInput): AgentObjective[] {
  const target = input.target;
  if (target?.mode === "add") return objectives.filter((objective) => objective.id === target.objectiveId);
  const skipped = new Set(input.skipObjectives);
  return objectives.filter((objective) => !skipped.has(objective.id));
}
