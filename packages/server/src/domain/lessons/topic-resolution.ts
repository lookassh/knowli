import { validateSubject } from "./catalog-validation";
import type { SubjectRegistry } from "./registry";
import type { DynamicTopicData, LessonTopic, SubjectModule } from "./types";

/**
 * Jedna ścieżka rozwiązywania tematu lekcji: temat katalogowy z rejestru albo
 * temat dynamiczny złożony przez przedmiot z danych zapisanych w kontekście
 * wersji (`lesson_context.dynamicTopic`). Silnik i moduły nie rozróżniają
 * pochodzenia tematu — pracują na `LessonTopic`.
 */
export interface LessonTopicContextLike {
  readonly subjectId: string;
  readonly topicId: string;
  readonly topicVersion: number;
  readonly dynamicTopic?: DynamicTopicData;
}

export function resolveLessonTopic(
  registry: SubjectRegistry,
  ctx: LessonTopicContextLike,
): { subject: SubjectModule; topic: LessonTopic } | undefined {
  const subject = registry.getSubject(ctx.subjectId);
  if (!subject) return undefined;
  if (subject.buildDynamicTopic && ctx.dynamicTopic) {
    try {
      return { subject, topic: subject.buildDynamicTopic(ctx.dynamicTopic) };
    } catch {
      return undefined; // uszkodzony zapis kontekstu — wywołujący zgłosi brak tematu
    }
  }
  const topic = registry.getTopic(ctx.subjectId, ctx.topicId, ctx.topicVersion);
  return topic ? { subject, topic } : undefined;
}

/**
 * Walidacja danych tematu dynamicznego przed zapisem: składamy temat przez
 * przedmiot i przepuszczamy przez te same reguły katalogu co tematy statyczne.
 * Zwraca błędy po polsku; pusta lista = dane poprawne.
 */
export function validateDynamicTopicData(subject: SubjectModule, data: DynamicTopicData): string[] {
  if (!subject.buildDynamicTopic) {
    return [`przedmiot „${subject.id}” nie wspiera tematów dynamicznych`];
  }
  const errors: string[] = [];
  if (data.titlePl.trim() === "") {
    errors.push("Temat dynamiczny: pusty tytuł tematu");
  }
  if (data.objectives.length === 0) {
    errors.push("Temat dynamiczny: brak zagadnień");
  }
  for (const objective of data.objectives) {
    if (objective.titlePl.trim() === "") {
      errors.push(`Zagadnienie „${objective.id}”: pusty tytuł`);
    }
    if (objective.descriptionEn.trim() === "") {
      errors.push(`Zagadnienie „${objective.id}”: pusty opis dla modelu (descriptionEn)`);
    }
    for (const card of objective.cards) {
      if (card.title.trim() === "" || card.body.trim() === "") {
        errors.push(`Zagadnienie „${objective.id}”: karta z pustym tytułem lub treścią`);
      }
    }
  }
  if (errors.length > 0) return errors;
  const topic = subject.buildDynamicTopic(data);
  return validateSubject({ ...subject, topics: [topic] });
}
