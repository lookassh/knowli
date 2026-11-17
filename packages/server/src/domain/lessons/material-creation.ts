import type { LessonExerciseDraft, SubjectModule } from "./types";

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

/** Czy zagadnienie z materiału musi mieć `kind` (przedmiot opisuje rodzaje zagadnień w prompcie). */
export function requiresObjectiveKind(subject: Pick<SubjectModule, "prompts">): boolean {
  return subject.prompts.objectivesRules !== undefined;
}

/** Czy karty zagadnień dostają nagrania (a więc `voiceTone`). */
export function recordsCards(subject: Pick<SubjectModule, "ttsForPrompts">): boolean {
  return subject.ttsForPrompts === true;
}

/**
 * Czyści świeże wyjście modelu z pól, których ćwiczenie wyboru ze słuchu nie
 * ma: polecenie dziecka jest stałe z katalogu komunikatów, bodźcem jest
 * nagranie (podpowiedź zdradzałaby odpowiedź), a piktogram należy do wyboru
 * obrazkowego. To niepożądany dodatek modelu, nie dane rodzica — wołaj
 * wyłącznie na świeżo wygenerowanych ćwiczeniach (generacja i dogenerowanie),
 * nigdy w edycji ani publikacji. Inne typy i ćwiczenie bez dodatków wracają
 * bez zmian (ta sama referencja).
 */
export function stripListenChoiceExtras(draft: LessonExerciseDraft): LessonExerciseDraft {
  if (draft.exerciseType !== "lesson_listen_choice") return draft;
  if (draft.instructionPl === undefined && draft.hint === undefined && draft.visualSubject === undefined) return draft;
  const { instructionPl: _instruction, hint: _hint, visualSubject: _visual, ...rest } = draft;
  return rest;
}

/** Zdania promptu zagadnień wspólne generatorowi paczek (adapter LLM) i agentowi MCP — jedno źródło tekstu. */
// Zmiana tych stałych zmienia płatny prompt generatora; `llm.test.ts` przypina go bajt w bajt.
export const OBJECTIVES_SPLIT_GENERAL =
  "Split the parent material into 2-8 learnable objectives (one checkable knowledge unit each), in teaching order. ";
export const OBJECTIVES_CARDS_GENERAL =
  "cards (2-4 Polish explanation cards {title, body} in simple language for a child; body at most 600 characters; " +
  "you may simplify and add a non-factual analogy, but NEVER add facts, dates or definitions that are not in the material). ";
export const OBJECTIVES_SPLIT_SUBJECT = "Split the parent material into learnable objectives, in teaching order. ";
export const OBJECTIVES_CARDS_SUBJECT =
  "kind and cards as the subject rules below say; card body at most 600 characters; NEVER add facts, words or definitions " +
  "that are not in the material. ";

/** Zasady podziału materiału na zagadnienia i karty dla agenta tworzącego lekcję (bez instrukcji formatu JSON generatora). */
export function materialObjectiveRules(subject: Pick<SubjectModule, "prompts">): string {
  const rules = subject.prompts.objectivesRules;
  return rules !== undefined
    ? `${OBJECTIVES_SPLIT_SUBJECT}Each objective has titlePl, descriptionEn, kind and cards: ${OBJECTIVES_CARDS_SUBJECT}Subject rules: ${rules}`
    : `${OBJECTIVES_SPLIT_GENERAL}Each objective has titlePl, descriptionEn and ${OBJECTIVES_CARDS_GENERAL}`;
}
