import type { ObjectiveAgentLimits } from "../../../domain/lessons/agent/admission";
import type { AgentCapableSubject } from "../../../domain/lessons/agent/capable";
import { allExamples, orderedLesson, type LessonAgentState } from "../../../domain/lessons/agent/state";
import { avoidSentencesFor } from "../../../domain/lessons/avoid-sentences";
import type { AgentObjective, LessonTopic } from "../../../domain/lessons/types";
import type { LessonObjectiveAgentInput } from "../../../ports/ai";
import { buildPoolInput, poolStageCounts } from "./lesson-drafts";

/**
 * Wejście podagenta zagadnienia (spec etapu 1 §6.1, §7): pola promptu z
 * `buildPoolInput` z liczbami z `targets` (jedyne źródło liczb), lista zdań do
 * unikania i zdania kart CAŁEJ lekcji z bieżącego stanu (w chwili startu
 * podagenta). Czysta funkcja nad przekazanymi danymi.
 */
export interface ObjectiveAgentInputArgs {
  readonly subject: AgentCapableSubject;
  readonly topic: LessonTopic;
  readonly state: LessonAgentState;
  readonly objective: AgentObjective;
  readonly limits: ObjectiveAgentLimits;
  readonly material: string;
  readonly instruction?: string;
  readonly interests?: readonly string[];
  readonly graderAvailable: boolean;
  readonly examplesFromPlan: boolean;
  readonly maxSteps: number;
}

function cardsText(objective: AgentObjective): string {
  return objective.cards.map((card) => `${card.title}: ${card.body}`).join("\n");
}

export function objectiveAgentInput(args: ObjectiveAgentInputArgs): LessonObjectiveAgentInput {
  const { subject, topic, state, objective, limits } = args;
  const examples = allExamples(state);
  const pool = buildPoolInput(
    subject,
    topic,
    objective.id,
    limits.targetCount,
    args.material,
    args.instruction,
    args.graderAvailable,
    [],
    [],
    args.interests,
    { avoidSentences: avoidSentencesFor({ examples, exercises: orderedLesson(state), subject }) },
  );
  // Wymagane typy po filtrze typów zagadnienia (jak w statusie); pusta grupa nie jest wymaganiem.
  const requiredTypes = (subject.agentPolicy.requiredTypes?.(objective) ?? [])
    .map((group) => group.filter((type) => objective.exerciseTypes.includes(type)))
    .filter((group) => group.length > 0);
  return {
    pool,
    objective: {
      id: objective.id,
      title: objective.titlePl,
      ...(objective.kind === undefined ? {} : { kind: objective.kind }),
      cards: objective.cards,
      examplesFromPlan: args.examplesFromPlan,
    },
    otherObjectives: state.objectives
      .filter((other) => other.id !== objective.id)
      .map((other) => ({ title: other.titlePl, ...(other.kind === undefined ? {} : { kind: other.kind }), cards: cardsText(other) })),
    cardSentences: [...new Set(Object.values(examples).flat())],
    targets: { ...poolStageCounts(subject, objective.exerciseTypes, limits.targetCount), requiredTypes, ...limits },
    maxSteps: args.maxSteps,
  };
}
