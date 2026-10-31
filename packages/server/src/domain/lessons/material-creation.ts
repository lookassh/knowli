import type { SubjectModule } from "./types";

/**
 * Sposób tworzenia zestawu z materiału rodzica — jedno miejsce dla katalogu
 * przedmiotów (`creation`, `subjectTitleRequired`) i poleceń tworzenia, żeby
 * formularz nie obiecywał ścieżki, którą serwer odrzuci.
 *
 * Przedmiot tworzy zestawy z materiału, gdy składa zagadnienia z materiału
 * (`buildDynamicTopic`) i deklaruje, skąd bierze tytuł przedmiotu
 * (`materialSubjectTitle`): `parent` — nazwę podaje rodzic (szkoła, własne
 * polecenie), `fixed` — stały `titlePl` przedmiotu (rozdział angielskiego).
 * Brak któregokolwiek z tych pól oznacza przedmiot katalogowy.
 */
export type MaterialCreationMode = "parent" | "fixed";

type MaterialCreationSubject = Pick<SubjectModule, "buildDynamicTopic" | "materialSubjectTitle">;

/** Sposób tworzenia z materiału albo `undefined` dla przedmiotu katalogowego. */
export function materialCreationMode(subject: MaterialCreationSubject): MaterialCreationMode | undefined {
  return subject.buildDynamicTopic === undefined ? undefined : subject.materialSubjectTitle;
}

/** Czy rodzic musi podać nazwę przedmiotu własnym tytułem (formularz szkolny). */
export function requiresParentSubjectTitle(subject: MaterialCreationSubject): boolean {
  return materialCreationMode(subject) === "parent";
}
