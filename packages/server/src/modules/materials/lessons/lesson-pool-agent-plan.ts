import { AppError } from "../../../errors";
import type { AgentCapableSubject } from "../../../domain/lessons/agent/capable";
import { AGENT_PLAN_MAX_OBJECTIVES, AGENT_PLAN_MIN_OBJECTIVES, validateAgentPlan } from "../../../domain/lessons/agent/plan";
import { MAX_TEXT_LENGTH } from "../../../domain/lessons/pool-validation";
import { validateDynamicTopicData } from "../../../domain/lessons/topic-resolution";
import type { DynamicTopicData, RawPlanObjective } from "../../../domain/lessons/types";
import type { LessonAgentPlanInput, LessonPoolAgentProvider, RunCostSink } from "../../../ports/ai";
import { buildDynamicTopicData, withSubjectObjectiveKinds } from "./lesson-drafts";
import { classifyLessonGenerationFailure } from "./lesson-generation-errors";
import type { RunBudgetSink } from "./lesson-pool-agent-policy";

/**
 * Plan zagadnień kierownika agenta puli (spec etapu 1 §7.1 pkt 2): planista
 * proponuje zagadnienia, a `propose` składa temat tą samą ścieżką co potok
 * (`validateAgentPlan` → `buildDynamicTopicData` → `withSubjectObjectiveKinds` →
 * `validateDynamicTopicData`). Błędy wracają do modelu; pierwsza poprawna
 * propozycja wygrywa.
 */

export interface PlanArgs {
  readonly agent: LessonPoolAgentProvider;
  readonly subject: AgentCapableSubject;
  readonly deckId: string;
  readonly topicTitle: string;
  readonly material: string;
  readonly instruction?: string;
  readonly cost: RunBudgetSink;
  readonly maxSteps: number;
  readonly signal: AbortSignal;
}

export type PlanOutcome =
  | {
      readonly status: "accepted";
      readonly dynamicTopic: DynamicTopicData;
      /** Przykłady kart z planu: identyfikator zagadnienia tematu → linie. */
      readonly examples: Readonly<Record<string, readonly string[]>>;
      readonly steps: number;
    }
  | { readonly status: "plan_failed"; readonly failure: { readonly errorCode: string }; readonly steps: number };

/** Brak przyjętej propozycji po wszystkich krokach: ten sam kod co niepoprawne zagadnienia w potoku. */
const NOT_ACCEPTED_CODE = classifyLessonGenerationFailure(new AppError("validation")).errorCode;

function slugOf(objectiveId: string): string {
  return objectiveId.slice(objectiveId.lastIndexOf(".") + 1);
}

/** Linie przykładów planu: przycięte, niepuste, najwyżej `MAX_TEXT_LENGTH` znaków (jak w potoku). */
function planExampleLines(objective: RawPlanObjective | undefined): string[] {
  return (objective?.examples ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= MAX_TEXT_LENGTH);
}

export async function planAgentObjectives(args: PlanArgs): Promise<PlanOutcome> {
  const { subject, topicTitle, material } = args;
  let accepted: { dynamicTopic: DynamicTopicData; examples: Record<string, string[]> } | undefined;
  let requests = 0;
  const cost: RunCostSink = {
    record: (usd) => {
      requests += 1;
      args.cost.record(usd);
    },
  };

  const propose = async (raw: unknown): Promise<{ ok: boolean; errors: string[] }> => {
    if (accepted !== undefined) return { ok: false, errors: ["a plan was already accepted"] };
    const plan = validateAgentPlan(raw, subject, material);
    if (!plan.ok) return { ok: false, errors: plan.errors };
    const built = buildDynamicTopicData(
      plan.objectives,
      subject.id,
      args.deckId,
      topicTitle,
      (objective) => validateDynamicTopicData(subject, { titlePl: topicTitle, objectives: [objective] }),
      subject.ttsForPrompts === true,
    );
    // Odrzucone pojedyncze zagadnienie zmieniłoby pokrycie planu: cała propozycja wraca do modelu.
    if (built.data === undefined || built.errors.length > 0) return { ok: false, errors: built.errors };
    const data = withSubjectObjectiveKinds(subject, built.data);
    const topicErrors = validateDynamicTopicData(subject, data);
    if (topicErrors.length > 0) return { ok: false, errors: topicErrors };
    // Przykłady po slugu z tematu (po sanityzacji), nie po surowym slugu modelu.
    const examples: Record<string, string[]> = {};
    for (const objective of data.objectives) {
      const lines = planExampleLines(plan.objectives.find((item) => item.slug === slugOf(objective.id)));
      if (lines.length > 0) examples[objective.id] = lines;
    }
    accepted = { dynamicTopic: data, examples };
    return { ok: true, errors: [] };
  };

  const input: LessonAgentPlanInput = {
    subjectTitle: subject.titlePl,
    topicTitle,
    material,
    ...(args.instruction === undefined ? {} : { instruction: args.instruction }),
    generationRole: subject.prompts.generationRole,
    ...(subject.prompts.objectivesRules === undefined ? {} : { objectivesRules: subject.prompts.objectivesRules }),
    objectiveCount: { min: AGENT_PLAN_MIN_OBJECTIVES, max: AGENT_PLAN_MAX_OBJECTIVES },
    ...(subject.agentPolicy.planCoverage === undefined ? {} : { coverage: subject.agentPolicy.planCoverage(material) }),
    maxSteps: args.maxSteps,
  };

  let steps: number;
  try {
    steps = (
      await args.agent.planObjectives(
        input,
        { propose, shouldStop: () => accepted !== undefined || args.cost.exhausted() || args.signal.aborted },
        cost,
        args.signal,
      )
    ).steps;
  } catch (error) {
    // Przyjęty plan przed wyjątkiem (np. termin po ostatnim kroku) nadal obowiązuje.
    if (accepted === undefined) {
      return { status: "plan_failed", failure: { errorCode: classifyLessonGenerationFailure(error).errorCode }, steps: requests };
    }
    steps = requests;
  }
  if (accepted === undefined) return { status: "plan_failed", failure: { errorCode: NOT_ACCEPTED_CODE }, steps };
  return { status: "accepted", dynamicTopic: accepted.dynamicTopic, examples: accepted.examples, steps };
}
