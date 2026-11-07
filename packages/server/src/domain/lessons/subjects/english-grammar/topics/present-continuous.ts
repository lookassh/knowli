import type { LearningObjective, LessonTopic } from "../../../types";
import { NUMBERLESS_SUBJECT_NOTE, notes } from "../teaching-notes";

/**
 * Temat Present Continuous (trzeci temat katalogu `english_grammar`, design
 * „Present Continuous” §2–§3). Główny odbiorca to 11-latek po „to be” i niepewnym
 * Present Simple: dziecko ma zrozumieć, KIEDY użyć czasu, a nie wkuć formę.
 * Dlatego porównanie z Present Simple (`now_or_usually`) stoi na drugim miejscu —
 * scheduler wprowadza dwa nowe cele na sesję, więc pierwsza sesja to forma i wybór
 * czasu. Pierwsza karta celu 1 to scenka bez definicji (przykłady przed regułą),
 * forma budowana z am/is/are, które dziecko zna. `{{examples}}` w karcie to
 * miejsce na przykłady z materiału lekcji.
 *
 * Pokrycie etapów ocenianych w każdym celu: prowadzony (choice/order/short_answer),
 * produktywny (gap/error_fix/transform), samodzielny (open_answer).
 *
 * `lesson_listen_choice` (#198) mają cele ze słyszalną różnicą formy: is/are
 * (affirmative), isn't/aren't (negative) i Is/Are otwierające pytanie (questions).
 * Nie mają go cele porównania (lektor czytałby wskaźnik czasu, więc słuch nie
 * sprawdzałby wyboru czasu) ani pisowni -ing (różnica tylko w zapisie).
 *
 * Cele porównania (2 i 6) nie mają kategorii formy: sprawdzanym elementem jest
 * wybór czasu, a dobry czas ze złą formą to „prawie” bez kategorii (§7.3).
 * Ich `descriptionEn` czytają generator, model oceniający i prompt historyjki.
 */

const PREFIX = "english_grammar.present_continuous";

/**
 * Dydaktyka tematu dla generatora paczek (`generationNotesEn`, etap 4 #358): siedem wskazówek z dawnych opisów
 * reguł (`present-continuous-guidance.ts`) przy tych samych zagadnieniach, i pułapki z usuniętych heurystyk.
 * Kod jej nie sprawdza.
 */
const PC_TOPIC_NOTES = notes(
  "Teaching hints for the present_continuous topic: the child learns WHEN to use the tense, so every exercise makes the " +
    "time of the action clear with a marker or a scene. Polish often uses one verb for both (Ola czyta), so the marker or the " +
    "scene decides, never the Polish verb. " +
    "A short Polish scene in instructionPl is a good context: its own short sentence before the task (Cicho! Dziadek śpi. " +
    "Uzupełnij zdanie.); never use teraz, właśnie, zawsze or zwykle as words of the task " +
    "itself (never Teraz uzupełnij zdanie.), because there they are no marker. " +
    "A context sentence may use is or are without a verb (This is Ola., It is sunny.), but never a verb used as an " +
    "adjective after is (never The door is open.). " +
    "explanationPl is exactly one sentence: an exclamation or a question of the scene stands in quotes („Look!”, „Cicho!”, " +
    "„Gdzie jest tata?”), so it ends no sentence; it names only verb forms that stand in this exercise (is cooking for a " +
    "sentence with cooking, never another verb such as is reading). " +
    "The examples of the objective (shown to the child on its cards) follow the rules of its exercises, with the same markers. " +
    "Never copy an example from the objective's cards into an exercise: change at least the subject, the verb or the object. " +
    "Polish appears only in instructionPl, explanationPl and the lesson_open_answer prompt; stems, statements, options and answers " +
    "are in English (Polish names such as Ola are fine).",
  "A present continuous sentence with a future time word (today, tonight, tomorrow, next week, on Monday) talks about the future, " +
    "so these exercises never use one.",
  NUMBERLESS_SUBJECT_NOTE,
);

/** Tłumaczenia w celach form (1, 3, 4, 5): dawny dopisek reguły tłumaczeń (tylko paczki tłumaczeń; tekst sam to zaznacza). */
const PC_FORMS_TRANSLATION_NOTES =
  "A translation carries the Polish now marker into English (teraz → now, w tej chwili → at the moment, Patrz! → Look!; in a " +
  "negative never a bare teraz) and lists the other now markers the sentence allows as acceptedAnswers, never a variant " +
  "without a marker.";

/** Dydaktyka celów porównania (2 i 6). */
const PC_TENSE_CHOICE_NOTES =
  "Teaching hints for the tense-choice objectives (now_or_usually and now_or_usually_more): every exercise makes clear whether " +
  "the action is happening right now or happens usually, and the child infers the time from a situation, not from a marker " +
  "word. At least half of the lesson_gap, lesson_error_fix and gap lesson_choice exercises carry the time only in a short " +
  "Polish scene in instructionPl and have no English time marker in the stem or statement: now — Cicho! Dziadek śpi. " +
  "Wybierz dobrą formę. with the stem Grandpa ___ on the sofa.; usually — Tata codziennie myje auto. Popraw błąd w zdaniu. " +
  "with Dad is washing the car. → Dad washes the car.; other scenes: Gdzie jest tata? / Ola codziennie gra w piłkę. The " +
  "other exercises may put an English marker into the sentence (Look!, right now, every day); never write the refrain teraz " +
  "czy zwykle in an instruction, because it has markers of both groups. Their lesson_choice options are the same verb in the two tenses " +
  "(reads / is reading), and each stem is a different frame with its own object or place (Ola ___ a comic., Grandpa ___ on the sofa.). " +
  "explanationPl also names the marker or the scene (Every day mówi, że to zwykle, więc Ola reads. / „Cicho!” mówi, że dziadek śpi w tej chwili, więc Grandpa is sleeping.). " +
  "A translation carries the marker of its Polish sentence into English: a scene or a strong now marker (Patrz! → Look!, " +
  "w tej chwili → at the moment, never a bare teraz) or a usually marker (codziennie → every day), and lists the other now " +
  "markers the sentence allows as acceptedAnswers. " +
  "The examples of the objective are a pair with the same verb (Look! Ola is reading. / Ola reads comics every day.).";


/**
 * Zdanie o mieszaniu czasów w historyjce (spec §9): tylko w opisach celów
 * porównania, więc historyjka miesza czasy wyłącznie wtedy, gdy rodzic wybrał
 * któryś z nich.
 */
export const STORY_MIX_SENTENCE = "The end-of-lesson story may mix present simple and present continuous.";

/** Refren podpowiedzi celów porównania (spec §3.3). */
const NOW_OR_USUALLY = "Zapytaj siebie: teraz czy zwykle?";

/**
 * Reguły werdyktu wspólne dla celów porównania (spec §7.3): sprawdzanym elementem
 * jest wybór czasu, więc błąd formy przy dobrym czasie to „prawie” bez kategorii.
 * Zakres wymogu kontekstu i przykłady błędów formy i hybryd różnią się między
 * celem 2 (wybór „now / usually” celowo bez wskaźnika, §5.5) a celem 6.
 */
function tenseChoiceVerdict(contextScope: string, formExamples: string, hybridExamples: string): string {
  return (
    `${contextScope} the context makes the right tense clear: a time marker in the sentence (right now, at the moment, Look!, every day, usually, on Mondays) ` +
    "or a short Polish scene in the instruction. The checked element is the choice of tense, not the verb form. " +
    `If the child chooses the right tense but makes a form mistake (${formExamples}), return 'almost' with errorCategory: null. ` +
    "If the child uses the wrong tense, return 'incorrect' with continuous_for_habit (present continuous for something that happens usually) " +
    "or simple_for_now (present simple for something happening right now). " +
    `A hybrid of am/is/are with a present simple verb for something that happens usually (${hybridExamples}) is 'incorrect' with be_plus_simple.`
  );
}

const affirmative: LearningObjective = {
  id: `${PREFIX}.affirmative`,
  generationNotesEn: notes(PC_TOPIC_NOTES, PC_FORMS_TRANSLATION_NOTES),
  titlePl: "Teraz: am/is/are + -ing",
  descriptionEn:
    "The present continuous describes an action happening right now, at this moment: am, is or are matching the subject " +
    "+ the verb with -ing (I am reading, she is playing, the dogs are playing). Affirmative sentences with action verbs only.",
  cards: [
    {
      title: "Co się dzieje?",
      body: "Popatrz! Tom is jumping. Mum is cooking. To dzieje się teraz, w tej chwili.",
    },
    {
      title: "Dwie części",
      body: "am, is, are już znasz. Dokładasz czasownik z -ing: she is reading, they are playing.",
    },
    {
      title: "Przykłady z lekcji",
      body: "Zobacz, co dzieje się teraz: {{examples}}",
    },
  ],
  errorCategories: ["missing_be_form", "wrong_be_form", "missing_ing"],
  hints: {
    missing_be_form: "To dzieje się teraz, więc potrzebne jest am, is albo are i czasownik z -ing: he is playing.",
    wrong_be_form: "Dobierz formę do osoby: I am, he/she/it is, you/we/they are.",
    missing_ing: "Gdy jest am/is/are, czasownik ma -ing: she is playing.",
  },
  exerciseTypes: [
    "lesson_card",
    "lesson_notice",
    "lesson_choice",
    "lesson_listen_choice",
    "lesson_order",
    "lesson_gap",
    "lesson_error_fix",
    "lesson_open_answer",
  ],
};

const nowOrUsually: LearningObjective = {
  id: `${PREFIX}.now_or_usually`,
  generationNotesEn: notes(
    PC_TOPIC_NOTES,
    PC_TENSE_CHOICE_NOTES,
    "now_or_usually also checks meaning: a lesson_choice with options exactly now and usually, instructionPl exactly " +
      "Kiedy to się dzieje? and a stem without a marker (Ola is reading a comic. → now; Ola reads comics. → usually); a present " +
      "simple stem there has a general plural object (Ola reads comics., not Ola reads a comic.).",
  ),
  titlePl: "Teraz czy zwykle? (po Present Simple)",
  descriptionEn:
    "Choosing between the present simple for things that happen usually, regularly or every day (Ola reads every day.) " +
    "and the present continuous for things happening right now, at this moment (Look! Ola is reading.), in affirmative sentences only. " +
    "One kind of exercise checks the meaning of a form instead: a lesson_choice with options exactly 'now' and 'usually', " +
    "whose stimulus is an affirmative present simple or present continuous sentence with no time marker at all (Ola is reading a book.); " +
    "the key follows from the tense of the sentence (present continuous → now, present simple → usually). " +
    tenseChoiceVerdict(
      "In every other exercise, where the child chooses or produces a tense,",
      "a missing -s, a wrong -ing spelling, am/is/are without -ing or a missing am/is/are when the context is now, such as She is play now. or She playing now.",
      "I'm go to school every day.",
    ) +
    " " +
    STORY_MIX_SENTENCE,
  cards: [
    {
      title: "Teraz czy zwykle?",
      body: "Po polsku „Ola czyta” to i teraz, i zwykle. Po angielsku wybierasz: teraz — Ola is reading, zwykle — Ola reads. Zapytaj siebie: teraz czy zwykle?",
    },
    {
      title: "Dwa zdania",
      body: "Dad cooks dinner every day. — to zwykle. Look! Dad is cooking now. — to teraz.",
    },
    {
      title: "Po polsku czasem słychać",
      body: "Tom jedzie na rowerze — teraz: Tom is riding his bike now. Tom jeździ na rowerze codziennie — zwykle: Tom rides his bike every day.",
    },
    {
      title: "Przykłady z lekcji",
      body: "Teraz czy zwykle? Sprawdź na przykładach: {{examples}}",
    },
  ],
  errorCategories: ["continuous_for_habit", "simple_for_now", "be_plus_simple"],
  hints: {
    continuous_for_habit: `${NOW_OR_USUALLY} Every day, usually, codziennie, zwykle — to zwykle, wtedy bez am/is/are i bez -ing: Ola reads every day.`,
    simple_for_now: `${NOW_OR_USUALLY} Now, Look!, teraz, Cicho! — to teraz, wtedy am/is/are + -ing: Ola is reading now.`,
    be_plus_simple: `${NOW_OR_USUALLY} Gdy coś dzieje się zwykle, nie ma am/is/are: I go to school every day.`,
  },
  exerciseTypes: [
    "lesson_card",
    "lesson_choice",
    "lesson_gap",
    "lesson_error_fix",
    "lesson_open_answer",
  ],
};

const negative: LearningObjective = {
  id: `${PREFIX}.negative`,
  generationNotesEn: notes(
    PC_TOPIC_NOTES,
    PC_FORMS_TRANSLATION_NOTES,
    "In a negative a bare now can be read as nowadays: give a negative a strong now marker (right now, at the moment) or a scene.",
  ),
  titlePl: "Przeczenie: isn't / aren't + -ing",
  descriptionEn:
    "Present continuous negatives for actions not happening right now: am not, isn't or aren't matching the subject " +
    "+ the verb with -ing (I am not sleeping, he isn't playing, we aren't reading). They never use don't or doesn't.",
  cards: [
    {
      title: "Dodaj not",
      body: "Przeczenie to am not, isn't albo aren't + czasownik z -ing: he isn't sleeping, we aren't playing.",
    },
    {
      title: "Bez don't",
      body: "Tu nie ma don't ani doesn't: she isn't reading, a nie „she doesn't reading”.",
    },
    {
      title: "Przykłady z lekcji",
      body: "Popatrz na przeczenia z lekcji: {{examples}}",
    },
  ],
  errorCategories: ["wrong_negation", "missing_be_form", "wrong_be_form", "missing_ing", "extra_auxiliary"],
  hints: {
    wrong_negation: "Przeczenie to am/is/are + not + czasownik z -ing: she isn't playing, I am not playing.",
    missing_be_form: "W przeczeniu też potrzebne jest am, is albo are: he isn't playing, a nie samo „he not playing”.",
    wrong_be_form: "Dobierz formę do osoby: I am not, he/she/it isn't, you/we/they aren't.",
    missing_ing: "Gdy jest am/is/are, czasownik ma -ing: she isn't playing.",
    extra_auxiliary: "Tu nie ma don't ani doesn't — wystarczy isn't albo aren't: he isn't playing.",
  },
  exerciseTypes: [
    "lesson_card",
    "lesson_choice",
    "lesson_listen_choice",
    "lesson_gap",
    "lesson_error_fix",
    "lesson_transform",
    "lesson_open_answer",
  ],
};

const questions: LearningObjective = {
  id: `${PREFIX}.questions`,
  generationNotesEn: notes(PC_TOPIC_NOTES, PC_FORMS_TRANSLATION_NOTES),
  titlePl: "Pytania i krótkie odpowiedzi",
  descriptionEn:
    "Present continuous yes/no questions put am, is or are before the subject, followed by the verb with -ing " +
    "(Is she reading? Are they playing?); they never use do or does. Short answers repeat the same form of 'to be' " +
    "(Yes, she is. No, they aren't.). The only wh-question is the fixed phrase What + am/is/are + subject + doing? " +
    "(What are you doing?), answered with a full present continuous sentence (I am reading.).",
  cards: [
    {
      title: "Zamień kolejność",
      body: "W pytaniu am, is, are stoi na początku, przed osobą: Is she reading? Are they playing?",
    },
    {
      title: "Krótka odpowiedź",
      body: "Odpowiadasz tą samą formą: Yes, she is. No, they aren't.",
    },
    {
      title: "Co teraz robisz?",
      body: "What are you doing? — Co teraz robisz? What is he doing? — Co on teraz robi?",
    },
    {
      title: "Przykłady z lekcji",
      body: "Zobacz pytania z lekcji: {{examples}}",
    },
  ],
  errorCategories: ["word_order", "missing_be_form", "wrong_be_form", "extra_auxiliary", "short_answer_form", "missing_ing"],
  hints: {
    word_order: "W pytaniu am/is/are idzie przed osobę: Is she reading? Are they playing?",
    missing_be_form: "W pytaniu przed osobą stoi am, is albo are: Are you playing? What are you doing?",
    wrong_be_form: "Dobierz formę do osoby: Am I…?, Is he…?, Are they…?",
    extra_auxiliary: "Tu nie ma do ani does — pytanie zaczyna am, is albo are: Is he reading?",
    short_answer_form: "Krótka odpowiedź powtarza formę z pytania: Is she reading? → Yes, she is.",
    missing_ing: "Po osobie czasownik ma -ing: Is she reading?",
  },
  exerciseTypes: [
    "lesson_card",
    "lesson_choice",
    "lesson_listen_choice",
    "lesson_order",
    "lesson_short_answer",
    "lesson_gap",
    "lesson_transform",
    "lesson_open_answer",
  ],
};

const ingSpelling: LearningObjective = {
  id: `${PREFIX}.ing_spelling`,
  generationNotesEn: notes(PC_TOPIC_NOTES, PC_FORMS_TRANSLATION_NOTES),
  titlePl: "Pisownia -ing",
  descriptionEn:
    "Spelling of the -ing form (British spelling): most verbs just add -ing (play → playing, read → reading, jump → jumping); " +
    "a final silent -e is dropped (make → making, write → writing); -ie changes to -y (lie → lying, tie → tying); " +
    "one-syllable verbs ending in one vowel + one consonant double the last consonant (run → running, swim → swimming, sit → sitting), " +
    "but not after two consonants or after w, x, y (jump → jumping, fix → fixing, snow → snowing, play → playing). Only verbs that follow these rules.",
  cards: [
    {
      title: "Zwykle tylko -ing",
      body: "Najczęściej dokładasz samo -ing: play → playing, read → reading, jump → jumping.",
    },
    {
      title: "Znika e, ie → y",
      body: "Końcowe e znika: make → making, write → writing (jedno t!). Końcówka ie zmienia się w y: lie → lying, tie → tying.",
    },
    {
      title: "Podwójna litera",
      body: "Gdy słowo ma jedną sylabę i kończy się jedną samogłoską i jedną spółgłoską, podwajasz ostatnią literę: run → running, swim → swimming, sit → sitting. Nie podwajasz w, x, y: play → playing, fix → fixing, snow → snowing. Ale: jump → jumping (dwie spółgłoski), read → reading i cook → cooking (dwie samogłoski).",
    },
    {
      title: "Przykłady z lekcji",
      body: "Sprawdź pisownię na przykładach: {{examples}}",
    },
  ],
  errorCategories: ["ing_spelling", "missing_ing"],
  hints: {
    ing_spelling: "Sprawdź końcówkę: make → making, run → running, lie → lying.",
    missing_ing: "Gdy jest am/is/are, czasownik ma -ing: she is playing.",
  },
  exerciseTypes: [
    "lesson_card",
    "lesson_choice",
    "lesson_gap",
    "lesson_error_fix",
    "lesson_open_answer",
  ],
};

const nowOrUsuallyMore: LearningObjective = {
  id: `${PREFIX}.now_or_usually_more`,
  generationNotesEn: notes(
    PC_TOPIC_NOTES,
    PC_TENSE_CHOICE_NOTES,
    "In now_or_usually_more a choice between whole questions has instructionPl exactly Wybierz poprawne pytanie. (no time and " +
      "no scene in it), as its stem a short English context sentence without a gap about the same person or thing as the question " +
      "that fits the key's time and never suggests the other one (Ola is in a tennis club. → Does Ola play tennis on Mondays?), " +
      "and the time marker in both options. A lesson_error_fix there puts the present continuous into the statement and the " +
      "present simple into the answer, with the usually marker in the statement or in a Polish scene in instructionPl (Ola isn't " +
      "dancing on Fridays. → Ola doesn't dance on Fridays.), because the present simple with now is often correct English (nowadays).",
  ),
  titlePl: "Teraz czy zwykle? Przeczenia i pytania",
  descriptionEn:
    "Choosing between the present simple and the present continuous in negatives and questions: " +
    "don't/doesn't + base verb for things that do not happen usually versus am not/isn't/aren't + -ing for things not happening right now " +
    "(She doesn't watch TV on Mondays. / She isn't watching TV right now.); Do/Does + subject + base verb to ask about habits " +
    "versus Am/Is/Are + subject + -ing to ask about right now (Do you play football on Saturdays? / Are you playing football right now?). " +
    tenseChoiceVerdict(
      "In every exercise",
      "doesn't eats, a question without do or does, a wrong -ing spelling, am/is/are without -ing or a missing am/is/are when the context is now, " +
        "such as She isn't watch TV now. or She playing now.",
      "She isn't watch TV on Mondays. / Are you play football on Saturdays?",
    ) +
    " " +
    STORY_MIX_SENTENCE,
  cards: [
    {
      title: "Jak pytasz?",
      body: "Pytasz o to, co dzieje się zwykle → Do / Does. Pytasz o to, co dzieje się teraz → Am / Is / Are.",
    },
    {
      title: "Pytania",
      body: "Do you play football on Saturdays? — zwykle. Are you playing football right now? — teraz.",
    },
    {
      title: "Przeczenia",
      body: "She doesn't watch TV on Mondays. — zwykle. She isn't watching TV right now. — teraz.",
    },
    {
      title: "Przykłady z lekcji",
      body: "Przy każdym przykładzie zapytaj siebie: teraz czy zwykle? {{examples}}",
    },
  ],
  errorCategories: ["continuous_for_habit", "simple_for_now", "be_plus_simple"],
  hints: {
    continuous_for_habit: `${NOW_OR_USUALLY} Every day, on Mondays, codziennie — to zwykle, wtedy don't/doesn't albo Do/Does: She doesn't watch TV on Mondays.`,
    simple_for_now: `${NOW_OR_USUALLY} Now, Look!, teraz — to teraz, wtedy am not/isn't/aren't albo Am/Is/Are + -ing: Are you playing football right now?`,
    be_plus_simple: `${NOW_OR_USUALLY} Gdy coś dzieje się zwykle, nie ma am/is/are: She doesn't watch TV on Mondays. Do you play football on Saturdays?`,
  },
  exerciseTypes: [
    "lesson_card",
    "lesson_choice",
    "lesson_gap",
    "lesson_error_fix",
    "lesson_open_answer",
  ],
};

export const presentContinuousV1: LessonTopic = {
  id: "present_continuous",
  version: 1,
  titlePl: "Present Continuous",
  extraErrorCategories: [
    { code: "wrong_be_form", labelPl: "Zła forma czasownika „to be” (am/is/are)" },
    { code: "missing_be_form", labelPl: "Brak formy czasownika „to be” (np. „he playing”, „he not playing”)" },
    { code: "missing_ing", labelPl: "am/is/are bez -ing (np. „she is play”, „she is plays”)" },
    { code: "ing_spelling", labelPl: "Błąd w pisowni -ing" },
    { code: "be_plus_simple", labelPl: "Mieszanie czasów: am/is/are przy czynności codziennej (np. „I'm go to school every day”)" },
    { code: "continuous_for_habit", labelPl: "-ing zamiast zwykłego czasu (czynność codzienna)" },
    { code: "simple_for_now", labelPl: "Zwykły czas zamiast -ing (czynność teraz)" },
  ],
  transforms: [
    { id: "to_negative", instructionPl: "Zamień na przeczenie" },
    { id: "to_question", instructionPl: "Zamień na pytanie" },
    { id: "to_affirmative", instructionPl: "Zamień na zdanie twierdzące" },
  ],
  objectives: [
    affirmative,
    nowOrUsually,
    negative,
    questions,
    ingSpelling,
    nowOrUsuallyMore,
  ],
};
