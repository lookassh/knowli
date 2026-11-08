import { registerRuleCases } from "../../testing/rule-cases";
import type { DynamicTopicData, LessonExerciseDraft } from "../../types";
import { englishChapterSubject } from "./module";

/**
 * Przypadki reguł katalogu rozdziału (`rules.ts`) dla testu kompletności
 * `rules/rule-cases.test.ts`. Każdy przypadek woła prawdziwy hak przedmiotu
 * (`validateExercise`).
 */

const WEATHER = "english_chapter.ddeck.weather";
const WEARING = "english_chapter.ddeck.wearing";

const DATA: DynamicTopicData = {
  titlePl: "Unit 1",
  objectives: [
    {
      id: WEATHER,
      titlePl: "Pogoda",
      descriptionEn: "Weather words.",
      kind: "words",
      cards: [{ title: "Słówka", body: "raining — pada deszcz\nsunny — słonecznie" }],
    },
  ],
};
const topic = englishChapterSubject.buildDynamicTopic!(DATA);

function draft(overrides: Partial<LessonExerciseDraft>): LessonExerciseDraft {
  return { exerciseType: "lesson_gap", objectiveId: WEATHER, answer: "sunny", acceptedAnswers: [], focus: [], ...overrides };
}

const choice = (overrides: Partial<LessonExerciseDraft> = {}) =>
  draft({
    exerciseType: "lesson_choice",
    instructionPl: "Dziś pada deszcz. Wybierz słowo.",
    stem: "It's ___ today.",
    options: [{ id: "a", text: "raining" }, { id: "b", text: "sunny" }],
    correctOption: "a",
    answer: "raining",
    ...overrides,
  });

const gap = (overrides: Partial<LessonExerciseDraft> = {}) =>
  draft({ instructionPl: "Dziś jest słonecznie. Wpisz brakujące słowo.", stem: "It's ___ today.", ...overrides });

const order = (overrides: Partial<LessonExerciseDraft> = {}) =>
  draft({
    exerciseType: "lesson_order",
    objectiveId: WEARING,
    instructionPl: "Ułóż zdanie: Mam na sobie płaszcz.",
    items: ["I'm", "wearing", "a", "coat"].map((text, index) => ({ id: `i${index}`, text })),
    answer: "I'm wearing a coat",
    ...overrides,
  });

const translation = (overrides: Partial<LessonExerciseDraft> = {}) =>
  draft({
    exerciseType: "lesson_open_answer",
    objectiveId: WEARING,
    instructionPl: "Przetłumacz na angielski.",
    prompt: "Mam na sobie płaszcz.",
    answer: "I'm wearing a coat.",
    ...overrides,
  });

const validate = (exercise: LessonExerciseDraft) => () => englishChapterSubject.validateExercise(exercise, topic);

registerRuleCases([
  { rule: "chapter.stem_single_gap", violation: validate(choice({ stem: "It's sunny today." })) },
  { rule: "chapter.translation_instruction_required", violation: validate(translation({ instructionPl: undefined })) },
  { rule: "chapter.hint_not_allowed", violation: validate(gap({ hint: "sun" })) },
  {
    rule: "chapter.order_items_distinct",
    violation: validate(order({ items: ["I'm", "wearing", "a", "A", "coat"].map((text, index) => ({ id: `i${index}`, text })) })),
  },
]);
