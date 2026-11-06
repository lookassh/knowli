import type { TypeExamples } from "../../types";

/**
 * Przykłady typów tematów „to be” i Present Continuous dla księgi reguł agenta (`agentPolicy.typeExamples`).
 * Ogólne przykłady kart typów ćwiczą Present Simple (drinks, plays, don't), a w temacie „to be” łamią reguły
 * luki (`hint` „be”, odpowiedź to forma be) i uczą do/does. Każdy cel ma własny zestaw, bo cele
 * różnią się biegunowością (przeczenia wymagają not, cele twierdzące go zabraniają) i formą
 * (skróty, pytania przez inwersję, krótkie odpowiedzi).
 *
 * Zasady jak w kartach typów: każdy typ celu ma własne zdanie (model kopiuje przykłady, a wspólne
 * zdanie łamałoby `lesson.leak`), klocki `lesson_order` bez interpunkcji końcowej, żadnego zdania z
 * kart tematu (happy, ready) i `acceptedAnswers` bez skrótu pełnej formy (to ten sam wariant po
 * normalizacji). Test przepuszcza każdy przykład przez walidację swojego celu.
 */

/** Ostatni segment id zagadnienia tematu „to be” (np. `english_grammar.to_be.questions` → `questions`). */
type ToBeObjective = "affirmative_forms" | "contractions" | "negative_forms" | "questions" | "short_answers";

const TO_BE_EXAMPLES: Readonly<Record<ToBeObjective, TypeExamples>> = {
  affirmative_forms: {
    lesson_notice: {
      exerciseType: "lesson_notice",
      instructionPl: "Wskaż formę „be” po I.",
      noticeSegments: [["I", "am", "at", "home."], ["You", "are", "at", "school."]],
      correctOption: "am",
      answer: "am",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz poprawną formę.",
      stem: "We ___ in the park.",
      options: [{ id: "a", text: "am" }, { id: "b", text: "is" }, { id: "c", text: "are" }],
      correctOption: "c",
      answer: "are",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_listen_choice: {
      exerciseType: "lesson_listen_choice",
      stem: "I ___ in the garden.",
      options: [{ id: "a", text: "am" }, { id: "b", text: "are" }],
      correctOption: "a",
      answer: "am",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_order: {
      exerciseType: "lesson_order",
      instructionPl: "Ułóż zdanie.",
      items: [{ id: "a", text: "My" }, { id: "b", text: "cat" }, { id: "c", text: "is" }, { id: "d", text: "black" }],
      answer: "My cat is black",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij lukę.",
      stem: "They ___ my friends.",
      hint: "be",
      answer: "are",
      acceptedAnswers: [],
      focus: ["are"],
    },
    lesson_error_fix: {
      exerciseType: "lesson_error_fix",
      instructionPl: "Popraw błąd w zdaniu.",
      statement: "She are my sister.",
      answer: "She is my sister.",
      acceptedAnswers: [],
      focus: ["is"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski.",
      prompt: "Mój tata jest wysoki.",
      answer: "My dad is tall.",
      acceptedAnswers: [],
      focus: ["is"],
    },
  },
  contractions: {
    lesson_notice: {
      exerciseType: "lesson_notice",
      instructionPl: "Wskaż skrót od he is.",
      noticeSegments: [["He's", "my", "brother."], ["We're", "at", "home."]],
      correctOption: "He's",
      answer: "He's",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz skrót od I am.",
      stem: "___ tired.",
      options: [{ id: "a", text: "I'm" }, { id: "b", text: "You're" }, { id: "c", text: "He's" }],
      correctOption: "a",
      answer: "I'm",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij lukę skrótem.",
      stem: "I have a dog. ___ very small.",
      hint: "be",
      answer: "It's",
      acceptedAnswers: [],
      focus: ["It's"],
    },
    lesson_error_fix: {
      exerciseType: "lesson_error_fix",
      instructionPl: "Popraw błąd w zdaniu.",
      statement: "They's in the park.",
      answer: "They're in the park.",
      acceptedAnswers: [],
      focus: ["They're"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski, używając skrótu.",
      prompt: "Jestem w szkole.",
      answer: "I'm at school.",
      acceptedAnswers: [],
      focus: ["I'm"],
    },
  },
  negative_forms: {
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz poprawną formę.",
      stem: "They ___ at school today.",
      options: [{ id: "a", text: "aren't" }, { id: "b", text: "isn't" }],
      correctOption: "a",
      answer: "aren't",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_listen_choice: {
      exerciseType: "lesson_listen_choice",
      stem: "He ___ at home.",
      options: [{ id: "a", text: "isn't" }, { id: "b", text: "aren't" }],
      correctOption: "a",
      answer: "isn't",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij lukę przeczeniem.",
      stem: "I ___ hungry.",
      hint: "be",
      answer: "am not",
      acceptedAnswers: [],
      focus: ["am", "not"],
    },
    lesson_error_fix: {
      exerciseType: "lesson_error_fix",
      instructionPl: "Popraw błąd w zdaniu.",
      statement: "We isn't late.",
      answer: "We aren't late.",
      acceptedAnswers: [],
      focus: ["aren't"],
    },
    lesson_transform: {
      exerciseType: "lesson_transform",
      instructionPl: "Zamień na przeczenie.",
      statement: "It is cold.",
      transformId: "to_negative",
      answer: "It isn't cold.",
      acceptedAnswers: [],
      focus: ["isn't"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski.",
      prompt: "Ona nie jest zmęczona.",
      answer: "She isn't tired.",
      acceptedAnswers: [],
      focus: ["isn't"],
    },
  },
  questions: {
    lesson_notice: {
      exerciseType: "lesson_notice",
      instructionPl: "Wskaż formę „be”, która zaczyna pytanie.",
      noticeSegments: [["Am", "I", "late?"], ["You", "are", "late."]],
      correctOption: "Am",
      answer: "Am",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz poprawną formę.",
      stem: "___ he your brother?",
      options: [{ id: "a", text: "Is" }, { id: "b", text: "Are" }],
      correctOption: "a",
      answer: "Is",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_listen_choice: {
      exerciseType: "lesson_listen_choice",
      stem: "___ they your cats?",
      options: [{ id: "a", text: "Are" }, { id: "b", text: "Is" }],
      correctOption: "a",
      answer: "Are",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_order: {
      exerciseType: "lesson_order",
      instructionPl: "Ułóż pytanie.",
      items: [{ id: "a", text: "Is" }, { id: "b", text: "it" }, { id: "c", text: "your" }, { id: "d", text: "bag" }],
      answer: "Is it your bag",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij lukę.",
      stem: "___ you at home?",
      hint: "be",
      answer: "Are",
      acceptedAnswers: [],
      focus: ["Are"],
    },
    lesson_transform: {
      exerciseType: "lesson_transform",
      instructionPl: "Zamień na pytanie.",
      statement: "The dog is in the garden.",
      transformId: "to_question",
      answer: "Is the dog in the garden?",
      acceptedAnswers: [],
      focus: ["Is"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski.",
      prompt: "Czy jesteś głodny?",
      answer: "Are you hungry?",
      acceptedAnswers: [],
      focus: ["Are", "you"],
    },
  },
  short_answers: {
    lesson_short_answer: {
      exerciseType: "lesson_short_answer",
      instructionPl: "Wybierz krótką odpowiedź.",
      prompt: "Is she your sister?",
      options: [{ id: "a", text: "Yes, she is." }, { id: "b", text: "Yes, she does." }],
      correctOption: "a",
      answer: "Yes, she is.",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz poprawną odpowiedź.",
      stem: "Are you at school?",
      options: [{ id: "a", text: "No, I'm not." }, { id: "b", text: "No, you aren't." }],
      correctOption: "a",
      answer: "No, I'm not.",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij krótką odpowiedź.",
      stem: "Is he at home? Yes, he ___.",
      hint: "be",
      answer: "is",
      acceptedAnswers: [],
      focus: ["is"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz krótką odpowiedź na angielski.",
      prompt: "Czy oni są w parku? Nie, nie są.",
      answer: "No, they aren't.",
      acceptedAnswers: [],
      focus: ["aren't"],
    },
  },
};

/** Ostatni segment id zagadnienia tematu Present Continuous. */
type PresentContinuousObjective = "affirmative" | "now_or_usually" | "negative" | "questions" | "ing_spelling" | "now_or_usually_more";

/**
 * Przykłady typów tematu Present Continuous: ogólne przykłady kart (Present Simple, `hint`) łamią
 * reguły tematu (luka bez `hint` z czasownikiem w nawiasie, wskaźnik „teraz”, tabela -ing). Zasady
 * jak w przykładach „to be”; dodatkowo żaden przykład nie powtarza zdania z kart tematu (test
 * `type-examples.test.ts`), a każdy cel ma własne czasowniki i podmioty.
 */
const PRESENT_CONTINUOUS_EXAMPLES: Readonly<Record<PresentContinuousObjective, TypeExamples>> = {
  affirmative: {
    lesson_notice: {
      exerciseType: "lesson_notice",
      instructionPl: "Wskaż czasownik z -ing.",
      noticeSegments: [["Grandpa", "is", "painting", "now."], ["His", "picture", "is", "big."]],
      correctOption: "painting",
      answer: "painting",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz poprawną formę.",
      stem: "The birds ___ in the tree now.",
      options: [{ id: "a", text: "are singing" }, { id: "b", text: "is singing" }],
      correctOption: "a",
      answer: "are singing",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_listen_choice: {
      exerciseType: "lesson_listen_choice",
      stem: "My sister ___ walking the dog.",
      options: [{ id: "a", text: "is" }, { id: "b", text: "are" }],
      correctOption: "a",
      answer: "is",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_order: {
      exerciseType: "lesson_order",
      instructionPl: "Ułóż zdanie.",
      items: [{ id: "a", text: "We" }, { id: "b", text: "are" }, { id: "c", text: "drinking" }, { id: "d", text: "milk" }],
      answer: "We are drinking milk",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij zdanie.",
      stem: "Look! Tom ___ (climb) a tree.",
      answer: "is climbing",
      acceptedAnswers: [],
      focus: ["is", "climbing"],
    },
    lesson_error_fix: {
      exerciseType: "lesson_error_fix",
      instructionPl: "Popraw błąd w zdaniu.",
      statement: "The boys is kicking a ball now.",
      answer: "The boys are kicking a ball now.",
      acceptedAnswers: [],
      focus: ["are"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski.",
      prompt: "Kot teraz śpi na kanapie.",
      answer: "The cat is sleeping on the sofa now.",
      // Inne wskaźniki „teraz” jako warianty (ślepa ocena sondy: tłumaczenie bez „at the moment”).
      acceptedAnswers: ["The cat is sleeping on the sofa right now.", "The cat is sleeping on the sofa at the moment."],
      focus: ["is", "sleeping"],
    },
  },
  now_or_usually: {
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Cicho! Mama pracuje. Wybierz dobrą formę.",
      stem: "Mum ___ at her desk.",
      options: [{ id: "a", text: "is working" }, { id: "b", text: "works" }],
      correctOption: "a",
      answer: "is working",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij zdanie.",
      stem: "My brother ___ (walk) to school every day.",
      answer: "walks",
      acceptedAnswers: [],
      focus: ["walks"],
    },
    lesson_error_fix: {
      exerciseType: "lesson_error_fix",
      instructionPl: "Popraw błąd w zdaniu.",
      statement: "Look! Grandpa reads the newspaper.",
      answer: "Look! Grandpa is reading the newspaper.",
      acceptedAnswers: [],
      focus: ["is", "reading"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski.",
      prompt: "Ola codziennie pije sok.",
      answer: "Ola drinks juice every day.",
      acceptedAnswers: [],
      focus: ["drinks"],
    },
  },
  negative: {
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz poprawną formę.",
      stem: "The children ___ sleeping now.",
      options: [{ id: "a", text: "aren't" }, { id: "b", text: "isn't" }],
      correctOption: "a",
      answer: "aren't",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_listen_choice: {
      exerciseType: "lesson_listen_choice",
      stem: "The baby ___ crying now.",
      options: [{ id: "a", text: "isn't" }, { id: "b", text: "aren't" }],
      correctOption: "a",
      answer: "isn't",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij zdanie.",
      stem: "Ola ___ (not draw) right now.",
      answer: "isn't drawing",
      acceptedAnswers: [],
      focus: ["isn't", "drawing"],
    },
    lesson_error_fix: {
      exerciseType: "lesson_error_fix",
      instructionPl: "Popraw błąd w zdaniu.",
      statement: "Dad not washing the car right now.",
      answer: "Dad isn't washing the car right now.",
      acceptedAnswers: [],
      focus: ["isn't"],
    },
    lesson_transform: {
      exerciseType: "lesson_transform",
      instructionPl: "Zamień na przeczenie.",
      statement: "The girls are talking right now.",
      transformId: "to_negative",
      answer: "The girls aren't talking right now.",
      acceptedAnswers: [],
      focus: ["aren't"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski.",
      prompt: "Mój brat w tym momencie nie pracuje.",
      answer: "My brother isn't working at the moment.",
      acceptedAnswers: ["My brother isn't working now.", "My brother isn't working right now."],
      focus: ["isn't", "working"],
    },
  },
  questions: {
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz poprawną formę.",
      stem: "___ your friends waiting for the bus?",
      options: [{ id: "a", text: "Are" }, { id: "b", text: "Is" }],
      correctOption: "a",
      answer: "Are",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_listen_choice: {
      exerciseType: "lesson_listen_choice",
      stem: "___ Grandma drinking tea?",
      options: [{ id: "a", text: "Is" }, { id: "b", text: "Are" }],
      correctOption: "a",
      answer: "Is",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_order: {
      exerciseType: "lesson_order",
      instructionPl: "Ułóż pytanie.",
      items: [{ id: "a", text: "Are" }, { id: "b", text: "they" }, { id: "c", text: "eating" }, { id: "d", text: "lunch" }],
      answer: "Are they eating lunch",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_short_answer: {
      exerciseType: "lesson_short_answer",
      instructionPl: "Wybierz krótką odpowiedź.",
      prompt: "Is Tom helping his mum?",
      options: [{ id: "a", text: "Yes, he is." }, { id: "b", text: "Yes, he does." }],
      correctOption: "a",
      answer: "Yes, he is.",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij pytanie.",
      stem: "___ you listening to music?",
      answer: "Are",
      acceptedAnswers: [],
      focus: ["Are"],
    },
    lesson_transform: {
      exerciseType: "lesson_transform",
      instructionPl: "Zamień na pytanie.",
      statement: "Ola is cleaning her room now.",
      transformId: "to_question",
      answer: "Is Ola cleaning her room now?",
      acceptedAnswers: [],
      focus: ["Is"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski.",
      prompt: "Czy Ola teraz gra na gitarze?",
      answer: "Is Ola playing the guitar now?",
      acceptedAnswers: ["Is Ola playing the guitar right now?", "Is Ola playing the guitar at the moment?"],
      focus: ["Is"],
    },
  },
  ing_spelling: {
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz poprawną pisownię.",
      stem: "Tom is ___ a letter now.",
      options: [{ id: "a", text: "writing" }, { id: "b", text: "writeing" }],
      correctOption: "a",
      answer: "writing",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij zdanie.",
      stem: "The cat ___ (sit) on the wall now.",
      answer: "is sitting",
      acceptedAnswers: [],
      focus: ["is", "sitting"],
    },
    lesson_error_fix: {
      exerciseType: "lesson_error_fix",
      instructionPl: "Popraw błąd w zdaniu.",
      statement: "The children are danceing now.",
      answer: "The children are dancing now.",
      acceptedAnswers: [],
      focus: ["dancing"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski.",
      prompt: "Mama teraz biegnie do sklepu.",
      answer: "Mum is running to the shop now.",
      acceptedAnswers: ["Mum is running to the shop right now.", "Mum is running to the shop at the moment."],
      focus: ["is", "running"],
    },
  },
  now_or_usually_more: {
    lesson_choice: {
      exerciseType: "lesson_choice",
      instructionPl: "Wybierz dobre pytanie.",
      stem: "Tom is at the swimming pool.",
      options: [{ id: "a", text: "Does Tom swim on Fridays?" }, { id: "b", text: "Is Tom swimming on Fridays?" }],
      correctOption: "a",
      answer: "Does Tom swim on Fridays?",
      acceptedAnswers: [],
      focus: [],
    },
    lesson_gap: {
      exerciseType: "lesson_gap",
      instructionPl: "Uzupełnij zdanie.",
      stem: "Grandma ___ (not drive) on Sundays.",
      answer: "doesn't drive",
      acceptedAnswers: [],
      focus: ["doesn't", "drive"],
    },
    lesson_error_fix: {
      exerciseType: "lesson_error_fix",
      instructionPl: "Popraw błąd w zdaniu.",
      statement: "We don't eat ice cream right now.",
      answer: "We aren't eating ice cream right now.",
      acceptedAnswers: [],
      focus: ["aren't", "eating"],
    },
    lesson_open_answer: {
      exerciseType: "lesson_open_answer",
      instructionPl: "Przetłumacz na angielski.",
      prompt: "Czy Ola tańczy w soboty?",
      answer: "Does Ola dance on Saturdays?",
      acceptedAnswers: [],
      focus: ["Does"],
    },
  },
};

/** Temat czasownika „to be” (`topics/to-be.ts`). */
const TO_BE_TOPIC = "to_be";

/** Temat Present Continuous (`topics/present-continuous.ts`). */
const PRESENT_CONTINUOUS_TOPIC = "present_continuous";

/** Przykłady tematów według ostatniego segmentu id zagadnienia. */
const EXAMPLES_BY_TOPIC: Readonly<Record<string, Readonly<Record<string, TypeExamples>>>> = {
  [TO_BE_TOPIC]: TO_BE_EXAMPLES,
  [PRESENT_CONTINUOUS_TOPIC]: PRESENT_CONTINUOUS_EXAMPLES,
};

/** Przykłady przedmiotu dla zagadnienia; poza tematami „to be” i Present Continuous — przykłady kart typów. */
export function grammarTypeExamples(at: { readonly topicId: string; readonly objectiveId: string }): TypeExamples | undefined {
  const examples = Object.hasOwn(EXAMPLES_BY_TOPIC, at.topicId) ? EXAMPLES_BY_TOPIC[at.topicId] : undefined;
  const objective = at.objectiveId.split(".").at(-1) ?? "";
  return examples !== undefined && Object.hasOwn(examples, objective) ? examples[objective] : undefined;
}
