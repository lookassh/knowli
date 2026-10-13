import { createSubjectRegistry, type SubjectRegistry } from "../registry";
import type { SubjectModule } from "../types";
import { englishGrammarSubject } from "./english-grammar/module";

/**
 * Rejestr przedmiotów produkcyjnych. To jedyne miejsce, w którym silnik „widzi”
 * konkretne przedmioty — przez wartości, nie przez import w kodzie silnika
 * (test architektoniczny pilnuje, że `domain/lessons/*.ts` poza `subjects/`
 * niczego stąd nie importuje). Dodanie przedmiotu = import modułu tutaj i wpis
 * w `PRODUCTION_SUBJECTS`.
 */
export const PRODUCTION_SUBJECTS: readonly SubjectModule[] = [englishGrammarSubject];

/** Buduje rejestr przedmiotów produkcyjnych (waliduje każdy przez `validateSubject`). */
export function createProductionSubjectRegistry(): SubjectRegistry {
  return createSubjectRegistry([...PRODUCTION_SUBJECTS]);
}
