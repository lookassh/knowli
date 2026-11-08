import type { AgentObjective, LessonTopic } from "../types";

/** Zagadnienia tematu w widoku agenta: kolejność, karty i typy ćwiczeń z celów tematu. */
export function agentObjectivesOf(topic: LessonTopic): AgentObjective[] {
  return topic.objectives.map((objective) => ({
    id: objective.id,
    titlePl: objective.titlePl,
    descriptionEn: objective.descriptionEn,
    cards: objective.cards.map((card) => ({ title: card.title, body: card.body })),
    exerciseTypes: objective.exerciseTypes,
  }));
}
