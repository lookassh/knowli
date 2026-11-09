import { validatePoolIssues, type PoolValidationOptions } from "../pool-validation";
import { A, admitInOrder, contextFor, gap as gapOf, open as openOf, stateWith, type StepEntry } from "../testing/agent-admission-fixtures";
import { historyLikeSubject } from "../testing/history-like-subject";
import { registerRuleCases } from "../testing/rule-cases";
import type { LearningObjective, LessonExerciseDraft, LessonExerciseType, LessonTopic, SubjectModule } from "../types";

/**
 * Przypadki reguł katalogu lekcji (`lesson-rules.ts`) dla testu kompletności
 * `rule-cases.test.ts`. Reguły całej puli: każdy przypadek woła prawdziwy
 * `validatePoolIssues` na przedmiocie testowym (silnik nie importuje
 * przedmiotów produkcyjnych) i zwraca zgłoszenia odrzuconych ćwiczeń.
 * Ujawnienia: prawdziwy krok reguł lekcji (`lessonRulesStep`) na przedmiocie testowym.
 */

const TYPES: readonly LessonExerciseType[] = ["lesson_gap", "lesson_open_answer", "lesson_listen_choice"];
const OBJECTIVE_ID = "lesson_cases.topic.any";

const objective: LearningObjective = {
  id: OBJECTIVE_ID,
  titlePl: "Cel testowy",
  descriptionEn: "Test objective.",
  cards: [{ title: "Karta", body: "Treść." }, { title: "Druga", body: "Treść." }],
  errorCategories: ["wrong_date"],
  hints: { wrong_date: "Sprawdź." },
  exerciseTypes: TYPES,
};

const topic: LessonTopic = {
  id: "lesson_cases",
  version: 1,
  titlePl: "Temat testowy",
  extraErrorCategories: [],
  transforms: [],
  objectives: [objective],
};

/** Przedmiot z unikalnością odpowiedzi (domyślna polityka puli). */
const answerSubject: SubjectModule = {
  ...historyLikeSubject,
  exerciseTypes: TYPES,
  topics: [topic],
  validateExercise: () => [],
};

/** Przedmiot z unikalnością bodźca (`poolDeduplication: "exercise"`). */
const stimulusSubject: SubjectModule = { ...answerSubject, poolDeduplication: "exercise" };

function gap(stem: string, answer: string): LessonExerciseDraft {
  return { exerciseType: "lesson_gap", objectiveId: OBJECTIVE_ID, stem, answer, acceptedAnswers: [], focus: [answer] };
}

function open(answer: string): LessonExerciseDraft {
  return {
    exerciseType: "lesson_open_answer",
    objectiveId: OBJECTIVE_ID,
    prompt: "Co ona robi?",
    answer,
    acceptedAnswers: [],
    // Drugie słowo odpowiedzi (czasownik) jako sprawdzany element.
    focus: [answer.split(" ")[1] ?? answer],
  };
}

const listen: LessonExerciseDraft = {
  exerciseType: "lesson_listen_choice",
  objectiveId: OBJECTIVE_ID,
  stem: "She ___ tennis.",
  options: [{ id: "a", text: "plays" }, { id: "b", text: "play" }],
  correctOption: "a",
  answer: "plays",
  acceptedAnswers: [],
  focus: [],
};

/** Zgłoszenia odrzuconych ćwiczeń puli. */
const poolIssues = (
  exercises: readonly LessonExerciseDraft[],
  subject: SubjectModule,
  options: PoolValidationOptions = {},
) => () => validatePoolIssues(exercises, subject, topic, options).rejected.flatMap((entry) => entry.issues);

/** Zgłoszenia odrzucenia kandydata. */
function issuesOf(entry: StepEntry | undefined) {
  return entry !== undefined && "rejected" in entry ? entry.rejected.issues : [];
}

/** Krok reguł lekcji dla jednego kandydata w zagadnieniu A. */
const admitted = (
  draft: LessonExerciseDraft,
  options: { readonly fixed?: readonly LessonExerciseDraft[]; readonly examples?: readonly string[] } = {},
) => () => {
  const state = stateWith({ fixed: options.fixed ?? [], examples: options.examples === undefined ? {} : { [A]: options.examples } });
  return issuesOf(admitInOrder(state, A, [draft], contextFor()).results[0]);
};

registerRuleCases([
  // Ujawnienia: kandydat ofiarą (przykład karty) i kandydat źródłem (ujawnia samodzielne fixed).
  { rule: "lesson.leak", violation: admitted(openOf(A, "Kiedy?", "w 966 roku"), { examples: ["w 966 roku"] }) },
  { rule: "lesson.leak_source", violation: admitted(gapOf(A, "Chrzest w roku ___.", "966"), { fixed: [openOf(A, "Rok chrztu?", "966")] }) },
  // Zdanie ćwiczenia słuchowego ujawnia odpowiedź ćwiczenia tekstowego (w puli i wobec szkicu).
  { rule: "lesson.listen_reveals_answer", violation: poolIssues([open("She plays tennis."), listen], answerSubject) },
  {
    rule: "lesson.listen_reveals_answer",
    violation: poolIssues([open("She plays tennis.")], answerSubject, { existingExercises: [listen] }),
  },
  {
    rule: "lesson.duplicate_stimulus",
    violation: poolIssues([gap("She ___ tennis.", "plays"), gap("She ___ tennis.", "likes")], stimulusSubject),
  },
  {
    rule: "lesson.duplicate_answer",
    violation: poolIssues([gap("She ___ tennis.", "plays"), gap("He ___ football.", "Plays")], answerSubject),
  },
]);

/** Poprawna pula przypadków (test pilnuje, że bez naruszenia nie ma odrzuceń). */
export const LESSON_CASE_BASELINES: readonly { readonly name: string; readonly issues: () => readonly unknown[] }[] = [
  { name: "pula z unikalnymi odpowiedziami", issues: poolIssues([gap("She ___ tennis.", "plays"), open("She likes tennis.")], answerSubject) },
  {
    name: "pula z unikalnymi bodźcami",
    issues: poolIssues([gap("She ___ tennis.", "plays"), gap("He ___ football.", "plays"), listen], stimulusSubject),
  },
];
