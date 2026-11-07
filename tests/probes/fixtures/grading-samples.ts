/**
 * Próbki odbioru oceny odpowiedzi (etap 3 #360, spec etapu §12). Etykiety spisane przed
 * przebiegiem z tabeli specu — to jedyne ich źródło; sonda `grading.probe.test.ts` ich nie zmienia.
 *
 * `expect`: `pass` — zaliczone (sukces celu), `fail` — nie zaliczone (błąd albo nieocenione),
 * `off_target` — „bez ćwiczonej formy”. `guard` wskazuje próg 2 albo 3 specu.
 */

export type SampleGroup = "present_simple" | "to_be" | "present_continuous" | "chapter" | "school";
export type Expectation = "pass" | "fail" | "off_target";
/** Klasy z progami: 2 — nigdy zaliczone ani „bez ćwiczonej formy”; 3 — nigdy feedback sukcesu. */
export type Guard = "negation" | "wrong_form" | "bad_contraction" | "not_done";

export interface SampleExercise {
  readonly group: SampleGroup;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface GradingSample {
  readonly id: string;
  readonly exercise: string;
  /** Tekst albo kolejność klocków (teksty klocków). */
  readonly answer: string | readonly string[];
  readonly cls: string;
  readonly expect: Expectation;
  readonly guard?: Guard;
  /** Rozstrzyga dopasowanie bez modelu (dokładne albo literówka). */
  readonly noModel?: boolean;
  /** Para różniąca się tylko skrótem (próg 5): ta sama para na dwóch rewizjach w obu kolejnościach. */
  readonly pair?: "A";
}

const PS = "english_grammar.present_simple";
const BE = "english_grammar.to_be";
const PC = "english_grammar.present_continuous";
const CHAPTER_OBJECTIVE = "english_chapter.dprobe.penguins";
export const SCHOOL_TEA = "school.dprobe.herbata";
export const SCHOOL_BUTTERFLY = "school.dprobe.motyl";

const transform = (objectiveId: string, statement: string, instructionPl: string, answer: string, focus: string[], acceptedAnswers: string[] = []) =>
  ({ exerciseType: "lesson_transform", objectiveId, instructionPl, statement, answer, acceptedAnswers, focus });
const translate = (objectiveId: string, prompt: string, answer: string, focus: string[], acceptedAnswers: string[] = [], instructionPl = "Przetłumacz na angielski.") =>
  ({ exerciseType: "lesson_open_answer", objectiveId, instructionPl, prompt, answer, acceptedAnswers, focus });
const order = (objectiveId: string, instructionPl: string, items: string[], focus: string[]) =>
  ({ exerciseType: "lesson_order", objectiveId, instructionPl, items: items.map((text, i) => ({ id: `b${i}`, text })), answer: items.join(" "), acceptedAnswers: [], focus });

const shortAnswer = (question: string, answer: string, focus: string) =>
  translate(`${BE}.short_answers`, question, answer, [focus], [], "Odpowiedz krótko po angielsku.");

export const SAMPLE_EXERCISES: Readonly<Record<string, SampleExercise>> = {
  negate: { group: "present_simple", payload: transform(`${PS}.negative`, "She likes tea.", "Zaprzecz zdaniu.", "She doesn't like tea.", ["doesn't", "like"]) },
  // Stara rewizja: focus zapisany względem rozwiniętej formy (dziś odrzuca go walidacja).
  negateOld: { group: "present_simple", payload: transform(`${PS}.negative`, "She likes tea.", "Zaprzecz zdaniu.", "She doesn't like tea.", ["does", "not"]) },
  readsBook: { group: "present_simple", payload: translate(`${PS}.third_person_s`, "Ona czyta książkę.", "She reads a book.", ["reads"]) },
  alwaysReads: { group: "present_simple", payload: translate(`${PS}.third_person_s`, "Ona zawsze czyta wieczorem.", "She always reads in the evening.", ["reads"]) },
  question: { group: "present_simple", payload: transform(`${PS}.question`, "She plays tennis.", "Zrób pytanie.", "Does she play tennis?", ["Does", "she", "play"]) },
  annaShe: { group: "to_be", payload: shortAnswer("Is Anna happy?", "Yes, she is.", "is") },
  youReady: { group: "to_be", payload: shortAnswer("Are you ready?", "Yes, I am.", "am") },
  theySchool: { group: "to_be", payload: shortAnswer("Are they at school?", "Yes, they are.", "are") },
  annaPairA1: { group: "to_be", payload: shortAnswer("Is Anna happy?", "Yes, Anna is.", "is") },
  annaPairA2: { group: "to_be", payload: shortAnswer("Is Anna happy?", "Yes, Anna is.", "is") },
  notHome: { group: "to_be", payload: translate(`${BE}.negative_forms`, "Ona nie jest w domu.", "She is not at home.", ["is", "not"], ["She isn't at home."]) },
  colour: { group: "to_be", payload: translate(`${BE}.affirmative_forms`, "Mój ulubiony kolor to niebieski.", "My favourite colour is blue.", ["is"]) },
  contract: { group: "to_be", payload: translate(`${BE}.contractions`, "Jestem w szkole.", "I'm at school.", ["I'm"], [], "Przetłumacz na angielski, używając skrótu.") },
  running: { group: "present_continuous", payload: transform(`${PC}.affirmative`, "He runs.", "Zrób zdanie w Present Continuous.", "He's running.", ["running"]) },
  readingNow: { group: "present_continuous", payload: translate(`${PC}.affirmative`, "Ona teraz czyta książkę.", "She is reading a book now.", ["is", "reading"]) },
  tomOrder: { group: "present_continuous", payload: order(`${PC}.affirmative`, "Ułóż zdanie.", ["Tom", "is", "reading", "now"], ["is", "reading"]) },
  penguinEats: { group: "chapter", payload: translate(CHAPTER_OBJECTIVE, "Pingwin je ryby.", "The penguin eats fish.", ["eats"]) },
  penguinGap: { group: "chapter", payload: { exerciseType: "lesson_gap", objectiveId: CHAPTER_OBJECTIVE, instructionPl: "Uzupełnij lukę: Pingwin je ryby.", stem: "The penguin ___ fish.", answer: "eats", acceptedAnswers: [], focus: ["eats"] } },
  penguinColour: { group: "chapter", payload: translate(CHAPTER_OBJECTIVE, "Pingwin lubi kolorowe ryby.", "The penguin likes colourful fish.", ["likes"]) },
  tea: { group: "school", payload: order(SCHOOL_TEA, "Ułóż kroki parzenia herbaty.", ["Nalej wody do czajnika", "Włącz czajnik", "Włóż torebkę do kubka", "Zalej torebkę wrzątkiem"], ["Włącz", "czajnik"]) },
  butterfly: { group: "school", payload: order(SCHOOL_BUTTERFLY, "Ułóż etapy rozwoju motyla.", ["jajo", "gąsienica", "poczwarka", "motyl"], ["poczwarka"]) },
};

export const GRADING_SAMPLES: readonly GradingSample[] = [
  { id: "1", exercise: "negate", answer: "She does not like tea.", cls: "inne poprawne sformułowanie", expect: "pass" },
  { id: "2", exercise: "negate", answer: "She likes tea.", cls: "polecenie niewykonane", expect: "fail", guard: "not_done" },
  { id: "3", exercise: "negate", answer: "She don't like tea.", cls: "błąd w ćwiczonej formie", expect: "fail", guard: "wrong_form" },
  { id: "4", exercise: "negate", answer: "She doesn't likes tea.", cls: "błąd w ćwiczonej formie", expect: "fail", guard: "wrong_form" },
  { id: "5", exercise: "negate", answer: "She doesn't like tee.", cls: "literówka poza focus", expect: "pass", noModel: true },
  { id: "6", exercise: "negate", answer: "She doesnt like tea.", cls: "literówka w focus", expect: "fail" },
  { id: "7", exercise: "negateOld", answer: "She don't like tea.", cls: "błąd w ćwiczonej formie (stara rewizja)", expect: "fail", guard: "wrong_form" },
  { id: "8", exercise: "negateOld", answer: "She does not like tea.", cls: "inne poprawne sformułowanie (stara rewizja)", expect: "pass" },
  { id: "9", exercise: "negateOld", answer: "She doesn't like tee.", cls: "literówka poza focus (stara rewizja)", expect: "pass" },
  { id: "10", exercise: "annaShe", answer: "Yes, she's.", cls: "skrót niegramatyczny", expect: "fail", guard: "bad_contraction" },
  { id: "11", exercise: "youReady", answer: "Yes, I'm.", cls: "skrót niegramatyczny", expect: "fail", guard: "bad_contraction" },
  { id: "12", exercise: "theySchool", answer: "Yes, they're.", cls: "skrót niegramatyczny", expect: "fail", guard: "bad_contraction" },
  { id: "13", exercise: "annaPairA1", answer: "Yes, she is.", cls: "inne poprawne sformułowanie (para A)", expect: "pass", pair: "A" },
  { id: "14", exercise: "annaPairA1", answer: "Yes, she's.", cls: "skrót niegramatyczny (para A)", expect: "fail", guard: "bad_contraction", pair: "A" },
  { id: "14r", exercise: "annaPairA2", answer: "Yes, she's.", cls: "skrót niegramatyczny (para A, odwrotna kolejność)", expect: "fail", guard: "bad_contraction", pair: "A" },
  { id: "13r", exercise: "annaPairA2", answer: "Yes, she is.", cls: "inne poprawne sformułowanie (para A, odwrotna kolejność)", expect: "pass", pair: "A" },
  { id: "15", exercise: "running", answer: "He has running.", cls: "błąd w ćwiczonej formie: fałszywe rozwinięcie He's (para B)", expect: "fail", guard: "wrong_form" },
  { id: "16", exercise: "running", answer: "He is running.", cls: "inne poprawne sformułowanie (para B)", expect: "pass" },
  { id: "17", exercise: "readingNow", answer: "She's reading a book now.", cls: "poprawny skrót", expect: "pass" },
  { id: "18", exercise: "readingNow", answer: "She reads a book now.", cls: "błąd w ćwiczonej formie", expect: "fail", guard: "wrong_form" },
  { id: "19", exercise: "readingNow", answer: "She isn't reading a book now.", cls: "negacja zmieniająca sens", expect: "fail", guard: "negation" },
  { id: "20", exercise: "notHome", answer: "She isn't at home.", cls: "wariant ze skrótem dopisany przez rodzica", expect: "pass", noModel: true },
  { id: "21", exercise: "notHome", answer: "She's not at home.", cls: "poprawny skrót", expect: "pass" },
  { id: "22", exercise: "notHome", answer: "She is at home.", cls: "negacja zmieniająca sens", expect: "fail", guard: "negation" },
  { id: "23", exercise: "readsBook", answer: "She is reading a book.", cls: "poprawna inną formą", expect: "off_target" },
  { id: "24", exercise: "alwaysReads", answer: "She always read in the evening.", cls: "błąd w ćwiczonej formie", expect: "fail", guard: "wrong_form" },
  { id: "25", exercise: "question", answer: "Does she play?", cls: "odpowiedź częściowa", expect: "fail" },
  { id: "26", exercise: "colour", answer: "My favorite color is blue.", cls: "pisownia amerykańska", expect: "pass" },
  { id: "27", exercise: "tomOrder", answer: ["now", "Tom", "is", "reading"], cls: "alternatywny szyk", expect: "pass" },
  { id: "28", exercise: "tomOrder", answer: ["Tom", "reading", "is", "now"], cls: "zła kolejność", expect: "fail" },
  { id: "29", exercise: "penguinEats", answer: "A penguin eats fish.", cls: "inne poprawne sformułowanie", expect: "pass" },
  { id: "30", exercise: "penguinEats", answer: "The penguin doesn't eat fish.", cls: "negacja zmieniająca sens", expect: "fail", guard: "negation" },
  { id: "31", exercise: "penguinGap", answer: "eat", cls: "błąd w ćwiczonej formie", expect: "fail", guard: "wrong_form" },
  { id: "32", exercise: "penguinColour", answer: "The penguin likes colorful fish.", cls: "pisownia amerykańska", expect: "pass", noModel: true },
  { id: "33", exercise: "tea", answer: ["Włóż torebkę do kubka", "Nalej wody do czajnika", "Włącz czajnik", "Zalej torebkę wrzątkiem"], cls: "alternatywny szyk w krokach procesu", expect: "pass" },
  { id: "34", exercise: "tea", answer: ["Nalej wody do czajnika", "Zalej torebkę wrzątkiem", "Włącz czajnik", "Włóż torebkę do kubka"], cls: "zła kolejność", expect: "fail" },
  { id: "35", exercise: "butterfly", answer: ["gąsienica", "jajo", "poczwarka", "motyl"], cls: "zła kolejność", expect: "fail" },
  { id: "36", exercise: "contract", answer: "I am at school.", cls: "polecenie niewykonane (pełna forma zamiast skrótu)", expect: "fail", guard: "not_done" },
];
