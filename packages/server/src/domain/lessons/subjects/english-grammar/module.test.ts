import { describe, expect, it } from "vitest";
import { englishGrammarSubject } from "./module";
import { englishGrammarPrompts, PRESENT_CONTINUOUS_PROMPT_EXAMPLES, presentContinuousFieldRules } from "./prompts";
import { validateEnglishGrammarExercise } from "./validators";
import { presentSimpleV1 } from "./topics/present-simple";
import { toBeV1 } from "./topics/to-be";
import { presentContinuousV1, STORY_MIX_SENTENCE } from "./topics/present-continuous";
import { answersEquivalent, validateLessonExercise } from "../../pool-validation";
import { createProductionSubjectRegistry, PRODUCTION_SUBJECTS } from "../index";
import { validateSubject } from "../../catalog-validation";
import type { LessonExerciseDraft } from "../../types";
import { stateVerbIn } from "../english/ing-forms";

describe("englishGrammarSubject — spójność katalogu", () => {
  it("validateSubject zwraca pustą listę (katalog poprawny)", () => {
    expect(validateSubject(englishGrammarSubject)).toEqual([]);
  });

  it("metadane przedmiotu zgodne z briefem", () => {
    expect(englishGrammarSubject.id).toBe("english_grammar");
    expect(englishGrammarSubject.titlePl).toBe("Angielski — gramatyka");
    expect(englishGrammarSubject.answerLocale).toBe("en-GB");
    expect(englishGrammarSubject.promptLocale).toBe("pl-PL");
    expect(englishGrammarSubject.ttsForAnswers).toBe(false);
    expect(englishGrammarSubject.ttsForFeedbackSentence).toBe(true);
    expect(englishGrammarSubject.exerciseExplanations).toBe(true);
  });

  it("english grammar enables end-of-session story with rules", () => {
    expect(englishGrammarSubject.lessonStory).toBe(true);
    expect(englishGrammarSubject.prompts.storyRules?.trim()).toBeTruthy();
    // Tylko formy celów z żądania, nie wszystkich reguł tematu.
    expect(englishGrammarSubject.prompts.storyRules).toContain("Use only the grammar forms of the objectives listed above");
    expect(englishGrammarSubject.prompts.storyRules).not.toContain("several rules of the topic");
  });

  it("obsługuje wszystkie 10 typów ćwiczeń", () => {
    expect([...englishGrammarSubject.exerciseTypes].sort()).toEqual(
      [
        "lesson_card",
        "lesson_choice",
        "lesson_error_fix",
        "lesson_gap",
        "lesson_listen_choice",
        "lesson_notice",
        "lesson_open_answer",
        "lesson_order",
        "lesson_short_answer",
        "lesson_transform",
      ].sort(),
    );
  });

  it("fieldRules profilu promptów definiują semantykę hint dla lesson_gap (walidator traktuje hint jako bezokolicznik)", () => {
    // Incydent 2026-10-13 (deepseek): polskie słowa z materiału w hint →
    // odrzucenie przez validateEnglishGrammarExercise. Reguła musi precyzować:
    // angielska forma podstawowa, kontrprzykłady, widoczność dla dziecka.
    const rules = englishGrammarPrompts.fieldRules ?? "";
    expect(rules).not.toBe("");
    expect(rules).toMatch(/base form|infinitive/i);
    expect(rules).toContain("plays");
    expect(rules).toMatch(/never put polish/i);
    expect(rules).toMatch(/hint/i);
  });

  it("fieldRules — migawka", () => {
    // Zdanie na wiersz: diff migawki pokazuje dokładnie zmienione zdania promptu.
    expect((englishGrammarPrompts.fieldRules ?? "").split(/(?<=\.) (?=[A-Z])/)).toMatchInlineSnapshot(`
      [
        "For lesson_open_answer, prompt is the source sentence in the prompt language to translate; answer and acceptedAnswers are in the answer language.",
        "Example: prompt 'Ona codziennie gra w piłkę.' → answer 'She plays football every day.' Never repeat the canonical answer or any accepted answer as the prompt stimulus.",
        "For objectives whose id contains '.present_simple.', set the lesson_gap hint to the English BASE FORM (infinitive) of the verb that fills the gap (hint "play" for answer "plays", hint "study" for answer "studies"), or leave hint null; the gap answer must be a present simple form of that base verb (plays, doesn't play) — keep it short, at most the verb with an auxiliary (never a full sentence with a subject).",
        "In those objectives an operator-only answer (do, does, don't, doesn't, do not, does not) may be used when the remaining sentence supplies the base verb; hint may then be the auxiliary base form do.",
        "Never put Polish words, translations, pronouns or rule explanations in hint — the child sees hint as support.",
        "Expanded contractions are NOT new acceptedAnswers variants: after normalization "does not play" equals "doesn't play", so never list the expanded form of the canonical answer in acceptedAnswers.",
        "For objectives whose id contains ".to_be." the checked verb is 'to be': set the lesson_gap hint to "be" (or leave it null) and make the gap answer am, is or are matching the subject (I -> am; he, she, it -> is; you, we, they -> are), in negatives am not, is not, are not, isn't or aren't. 'To be' questions swap the subject and the form (Is she happy?, Are they ready?) and never use do or does; short answers repeat the form (Yes, she is. / No, they aren't.).",
        "Keep 'to be' sentences very short and concrete, reusing a small set of subjects and words from the material so the only new thing is the form of 'to be'.",
        "In a lesson_gap for 'to be', the answer is only the form itself (am, is, are, isn't, aren't, am not, is not, are not, or not when the form already stands in the sentence) — never a full short answer such as 'No, she is not', which the sentence around the gap already supplies.",
        "Short answers to questions about 'you' answer as 'I': Are you ready? -> Yes, I am.",
        "Picture choice (only for objectives whose id contains '.affirmative_forms'): some lesson_choice exercises set visualSubject to who is pictured (boy or man = he, girl or woman = she, group = they, dog = it); then the stem is a sentence frame with the pronoun missing (___ is happy. / ___ are happy.) and the options are pronouns (He, She, It, They), so the child picks the pronoun for the picture.",
        "In such exercises the be form in the stem must match the pictured subject, and never set visualSubject on other exercise types. lesson_listen_choice (listening choice): a narrator reads the full sentence aloud and the child picks the word that fills the gap, so use it only when the checked form SOUNDS different. stem is one short natural sentence of at most 12 words with exactly one gap written as ___ (two or more underscores) standing on the objective's checked element; 2 or 3 options that differ AUDIBLY in that element (play / plays, don't / doesn't, Do / Does, is / are, isn't / aren't) and exactly one is correct.",
        "Never offer an equivalent option (a full form and a contraction of the same form, such as does not and doesn't, or is not and isn't) and never start an option with an apostrophe.",
        "Do not check a difference that exists only in spelling.",
        "When the options differ only by an -s ending that adds no syllable (like / likes, go / goes, study / studies, he / he's), the word right after the gap must not begin with an s, z or sh sound (snakes, soccer, school, zoo, shoes, city): in connected speech the ending merges into that sound and both forms sound the same.",
        "Write He ___ dinosaurs. or She ___ football., never He ___ snakes. or She ___ soccer.",
        "This does not apply to Do / Does or watch / watches, which sound different anyway (___ she play tennis? is fine).",
        "Never set instructionPl, hint or visualSubject on a lesson_listen_choice exercise: the recording is the whole stimulus and the child sees only the gap sentence and the options.",
        "For objectives whose id contains '.present_continuous.' (an action happening right now, at this moment) these rules apply; objectives are named by the last part of their id, and now_or_usually and now_or_usually_more are the tense-choice objectives.",
        "Verbs: in affirmative, now_or_usually, negative and questions use only these verbs, which add -ing without spelling changes: play, read, jump, fix, do, go, walk, talk, eat, drink, sleep, cook, paint, draw, sing, watch, listen, wait, work, study, climb, cry, fly, carry, ask, open, help, wash, clean, brush, call, kick, throw, catch, pull, push, build, wear, laugh, learn, buy, bring, send, fall, turn, pick, stay, count, try, hurry, rain, snow — also in the brackets of a gap and when the answer is in the present simple.",
        "In ing_spelling every exercise practises one spelling rule with these verbs: drop the final e: make, write, ride, dance, smile, bake, take, come, give, live, drive, skate, close, use, move, share, save, leave, wave, shine; double the last consonant: run, swim, sit, get, stop, shop, hop, clap, dig, jog, put, cut, hit, chat, skip, drop, win; ie becomes y: lie, tie; a verb from the first list only as a contrast in lesson_choice.",
        "In now_or_usually_more use the verbs of all these lists.",
        "Never use travel, begin, visit, cancel.",
        "Besides these verbs the present continuous may also use having breakfast, having lunch, having dinner, having a bath, having a shower, having fun, having a party, looking at, looking for (never in ing_spelling).",
        "Never use these state verbs in the -ing form, and never being: like, love, hate, prefer, want, need, wish, know, understand, believe, remember, forget, recognise, mean, seem, sound, cost, own, belong, think, see, hear, feel, taste, smell, have, look; the collocations above are the only exceptions.",
        "In the tense-choice objectives never use them in any form at all (no likes, has, wants), except those collocations and Look!.",
        "Time markers — now: now, right now, at the moment; Look! Listen! Shh! Be quiet! only at the start of a sentence; in Polish: teraz, właśnie, w tej chwili, w tym momencie, akurat; Cicho! Ciii! Patrz! Popatrz! Spójrz! Zobacz! Posłuchaj! Słuchaj! only at the start of a sentence; Gdzie jest …? / Gdzie są …? only at the start of the text.",
        "Usually: every day, every week, every morning, every evening, every night, every weekend, every summer, every Monday, every Tuesday, every Wednesday, every Thursday, every Friday, every Saturday, every Sunday, usually, always, often, sometimes, never, on Mondays, on Tuesdays, on Wednesdays, on Thursdays, on Fridays, on Saturdays, on Sundays, at weekends, once a week, twice a week, <number> times a week, <number> times a day; in Polish: codziennie, każdego dnia, każdego ranka, każdego wieczoru, co rano, co wieczór, co tydzień, co sobotę, w każdy, w każdą, w każde, w poniedziałki, we wtorki, w środy, w czwartki, w piątki, w soboty, w niedziele, w weekendy, zwykle, zazwyczaj, zawsze, często, czasem, czasami, rzadko, nigdy.",
        "Never use any of these markers anywhere in the exercise, in English or Polish (future or ambiguous): tomorrow, tonight, next week, next month, next year, next weekend, next summer, next winter, next spring, next autumn, next holidays, next time, next morning, next evening, next night, next Monday, next Tuesday, next Wednesday, next Thursday, next Friday, next Saturday, next Sunday, this evening, this morning, this afternoon, today, on Monday, on Tuesday, on Wednesday, on Thursday, on Friday, on Saturday, on Sunday, at the weekend, jutro, wieczorem, dzisiaj, dziś.",
        "A present continuous sentence never has a usually marker, and always is never used with the present continuous.",
        "Every lesson_gap has hint null and one of two shapes.",
        "Verb gap: the gap stands for the whole verb form and the base verb stands in brackets right after the gap (Tom ___ (play) football now. → is playing); write (not verb) in the brackets in the verb gaps of negative and in every gap of now_or_usually_more (She ___ (not watch) TV now. → isn't watching), and never in other objectives.",
        "Be gap, only in affirmative, negative and questions: the gap stands only for am, is or are (optionally with not, never not alone), the -ing form already stands in the sentence and there are no brackets (___ she reading a book? → Is; No, they ___. → aren't).",
        "Never write brackets anywhere else: not elsewhere in a gap sentence, and never in a lesson_choice or lesson_listen_choice stem or option, a statement or an answer. am, is or are always matches the subject (I am; he, she, it, one name or one thing is; you, we, they, two names or a plural noun are); short answers repeat it (Is she reading? → Yes, she is.; Are you playing? → Yes, I am.).",
        "In a be gap and in a lesson_choice between forms of am, is or are, a negative answer (isn't, aren't, am not) is allowed only in negative or after No, and never when not already follows the gap; never offer two options that differ only by not or n't (Is / Isn't).",
        "Answers and accepted answers never use he's, she's, it's, what's, that's, there's, where's or who's: write the full is (He is playing.).",
        "The only wh-question is What + am/is/are + subject + doing? (What are you doing?), answered with a full present continuous sentence; never start a sentence with any other question (What is she reading?, Where is he going?). lesson_error_fix: the statement and the answer differ in one place of at most 3 words, and that place is the checked mistake: in affirmative, negative and questions a missing am/is/are (He playing football. → He is playing football.), a verb without -ing after am/is/are (She is play. → She is playing.) or a wrong form of am/is/are (They is jumping. → They are jumping.); in negative and questions also do or does instead of am/is/are (He doesn't playing now. → He isn't playing now.); in ing_spelling only a wrong -ing spelling (He is swiming. → He is swimming.); in the tense-choice objectives the present simple swapped with the present continuous of the same verb (Look! Ola reads. → Look! Ola is reading.), with the correct side matching the time marker.",
        "Translations (lesson_open_answer) in affirmative, negative, questions and ing_spelling: the Polish prompt has a now marker and no usually marker (Mama teraz gotuje obiad.), and the answer contains its literal English equivalent (Mum is cooking dinner now.; teraz → now, w tej chwili → at the moment, Patrz! → Look!); never list accepted answers without it.",
        "Tense-choice objectives (now_or_usually: affirmative sentences only; now_or_usually_more: negatives and questions only): every exercise has a clear context of exactly one marker group — now markers, and then every verb is in the present continuous, or usually markers, and then every verb is in the present simple (with -s or does/doesn't for he, she, it or one name, the base form or do/don't otherwise).",
        "The context is an English marker in the sentence or a short Polish scene in instructionPl (in lesson_open_answer: in the Polish prompt); about half of these exercises use a scene without an English marker (Cicho! Dziadek śpi. / Gdzie jest tata? / Ola codziennie gra w piłkę.).",
        "Markers count in stem, statement, answer, acceptedAnswers, options, instructionPl and prompt, so never mix the groups there and never write the refrain teraz czy zwykle in an instruction; explanationPl names the marker or the scene (Widzisz every day? To zwykle, więc Ola reads.).",
        "In their lesson_choice the options are forms of the same verb in the two tenses (reads / is reading) and exactly one fits: never a distractor that is also correct, such as another verb in the right tense.",
        "Each lesson_choice stem is a different frame with its own object or place (Ola ___ a comic., Grandpa ___ on the sofa.), never a bare Ola ___ ., because the instruction does not make two stems different.",
        "Never put a gap in a question: in now_or_usually_more questions appear only as whole-sentence options of lesson_choice (Do you play football on Saturdays? / Are you playing football on Saturdays?) and in lesson_open_answer, and its gaps and lesson_error_fix use negatives only. now_or_usually also checks meaning: a lesson_choice with options exactly now and usually, instructionPl exactly Kiedy to się dzieje? and a stem that is one affirmative present simple or present continuous sentence with no time marker and no gap (Ola is reading a comic. → now; Ola reads comics. → usually). lesson_listen_choice (affirmative, negative, questions): the options are exactly is / are, isn't / aren't, or Is / Are opening a question — never He's / He. lesson_notice (affirmative): across all its sentences exactly one word is an -ing form, and correctOption is that word.",
        "Polish appears only in instructionPl and in the lesson_open_answer prompt; stems, statements, options and answers are in English (Polish names such as Ola are fine).",
        "Examples (key fields only): {"exerciseType":"lesson_gap","objectiveId":"english_grammar.present_continuous.affirmative","instructionPl":"Uzupełnij zdanie.","stem":"Tom ___ (play) football in the garden now.","answer":"is playing","acceptedAnswers":[],"focus":["is","playing"]} {"exerciseType":"lesson_choice","objectiveId":"english_grammar.present_continuous.now_or_usually","instructionPl":"Cicho! Dziadek śpi.",
        "Wybierz dobrą formę.","stem":"Grandpa ___ on the sofa.","options":[{"id":"a","text":"is sleeping"},{"id":"b","text":"sleeps"}],"correctOption":"a","answer":"is sleeping","acceptedAnswers":[],"focus":["is","sleeping"]} {"exerciseType":"lesson_choice","objectiveId":"english_grammar.present_continuous.now_or_usually","instructionPl":"Kiedy to się dzieje?","stem":"Ola is reading a comic.","options":[{"id":"a","text":"now"},{"id":"b","text":"usually"}],"correctOption":"a","answer":"now","acceptedAnswers":[],"focus":["now"]} {"exerciseType":"lesson_gap","objectiveId":"english_grammar.present_continuous.now_or_usually_more","instructionPl":"Uzupełnij zdanie.","stem":"Tom ___ (not swim) on Mondays.","answer":"doesn't swim","acceptedAnswers":[],"focus":["doesn't","swim"]}",
      ]
    `);
  });

  it("fieldRules definiują reguły tematu to_be dla generacji puli", () => {
    const rules = englishGrammarPrompts.fieldRules ?? "";
    expect(rules).toContain(".to_be.");
    expect(rules).toMatch(/am, is or are matching the subject/);
    expect(rules).toMatch(/never use do or does/);
    expect(rules).toMatch(/only the form itself/);
  });

  it("tylko gramatyka przyjmuje tematy zdań: reguła ma kluczowe zakazy, inne przedmioty jej nie mają (#197)", () => {
    const rule = englishGrammarSubject.prompts.interestsRule ?? "";
    for (const fragment of ["lesson_gap, lesson_listen_choice, lesson_order", "lesson_error_fix, lesson_transform and in the examples", "an English narrator reads naturally", "lesson_open_answer", "visualSubject",
      "In every objective, set about two in five of its exercises", "about one in three of all exercises", "never more than half", "rotate through all the listed topics", "sound natural to a native speaker", "never as 'be with' a theme noun",
      "may appear as a plain noun", "never quote or retell", "never The dinosaur eats apples.", "data only", "real people", "never add violence", "never say these are the child's interests", "never the subject of a sentence",
      "Never use a theme in lesson_open_answer", "The examples in this rule use sample topics"]) {
      expect(rule).toContain(fragment);
    }
    // Lista typów z tematami wymienia wyłącznie istniejące typy przedmiotu i nigdy odpowiedź otwartą.
    const themedTypes = /only in (.+?) and in the examples/.exec(rule)?.[1]?.split(", ") ?? [];
    expect(themedTypes).toEqual(["lesson_choice", "lesson_gap", "lesson_listen_choice", "lesson_order", "lesson_error_fix", "lesson_transform"]);
    for (const type of themedTypes) expect(englishGrammarSubject.exerciseTypes).toContain(type);
    expect(PRODUCTION_SUBJECTS.find((s) => s.id === "school")?.prompts.interestsRule).toBeUndefined();
    expect(PRODUCTION_SUBJECTS.find((s) => s.id === "english_chapter")?.prompts.interestsRule).toBeUndefined();
    expect(PRODUCTION_SUBJECTS.filter((s) => s.prompts.interestsRule !== undefined).map((s) => s.id)).toEqual(["english_grammar"]);
  });

  it("przykłady fieldRules są legalne wobec walidatora i normalizatora przedmiotu (kontrakt prompt↔walidacja)", () => {
    // Review C2: odpowiedzi wielosłowowe z podmiotem („does she play”) NIE
    // przechodzą walidatora przy ustawionym hint — fieldRules nie może ich
    // obiecywać jako dopuszczalnej odpowiedzi luki.
    expect(englishGrammarPrompts.fieldRules).not.toContain("does she play");

    // Formy wymieniane w fieldRules (forma 3. osoby, operator + not + bezokolicznik)
    // przechodzą walidację przy hint = bezokolicznik.
    const gap = (hint: string, answer: string): LessonExerciseDraft => ({
      exerciseType: "lesson_gap",
      objectiveId: "english_grammar.present_simple.third_person_s",
      stem: "He ___ every day.",
      hint,
      answer,
      acceptedAnswers: [],
      focus: answer.split(" "),
    });
    expect(validateEnglishGrammarExercise(gap("play", "plays"), presentSimpleV1)).toEqual([]);
    expect(validateEnglishGrammarExercise(gap("play", "doesn't play"), presentSimpleV1)).toEqual([]);
    expect(validateEnglishGrammarExercise(gap("play", "does she play"), presentSimpleV1).length).toBeGreaterThan(0);

    // Review C1: rozwinięcie skrótu jest równoważne kanonicznej po normalizatorze
    // (zakazany wariant acceptedAnswers); krótsza forma bez podmiotu jest legalna.
    const normalizer = englishGrammarSubject.normalizer;
    expect(answersEquivalent("doesn't play", "does not play", normalizer)).toBe(true);
    expect(answersEquivalent("she doesn't play", "doesn't play", normalizer)).toBe(false);
  });
});

describe("createProductionSubjectRegistry", () => {
  it("PRODUCTION_SUBJECTS zawiera english_grammar", () => {
    expect(PRODUCTION_SUBJECTS).toContain(englishGrammarSubject);
  });

  it("rejestr udostępnia temat to_be@1", () => {
    const registry = createProductionSubjectRegistry();
    const topic = registry.getTopic("english_grammar", "to_be", 1);
    expect(topic?.id).toBe("to_be");
    expect(topic?.version).toBe(1);
    expect(topic?.titlePl).toBe("Czasownik „to be”");
  });

  it("rejestr udostępnia temat present_continuous@1", () => {
    const registry = createProductionSubjectRegistry();
    const topic = registry.getTopic("english_grammar", "present_continuous", 1);
    expect(topic).toBe(presentContinuousV1);
    expect(topic?.id).toBe("present_continuous");
    expect(topic?.version).toBe(1);
    expect(topic?.titlePl).toBe("Present Continuous");
  });

  it("rejestr udostępnia przedmiot i temat present_simple@1", () => {
    const registry = createProductionSubjectRegistry();
    expect(registry.getSubject("english_grammar")).toBe(englishGrammarSubject);
    const topic = registry.getTopic("english_grammar", "present_simple", 1);
    expect(topic?.id).toBe("present_simple");
    expect(topic?.version).toBe(1);
    expect(topic?.titlePl).toBe("Present Simple");
  });
});

const TOPIC_CASES = [
  {
    id: "to_be",
    objectiveIds: [
      "english_grammar.to_be.affirmative_forms",
      "english_grammar.to_be.contractions",
      "english_grammar.to_be.negative_forms",
      "english_grammar.to_be.questions",
      "english_grammar.to_be.short_answers",
    ],
  },
  {
    id: "present_simple",
    objectiveIds: [
      "english_grammar.present_simple.affirmative_base",
      "english_grammar.present_simple.third_person_s",
      "english_grammar.present_simple.spelling_es_ies",
      "english_grammar.present_simple.negative",
      "english_grammar.present_simple.question",
      "english_grammar.present_simple.short_answers",
      "english_grammar.present_simple.base_form_after_does",
    ],
  },
  {
    id: "present_continuous",
    objectiveIds: [
      "english_grammar.present_continuous.affirmative",
      "english_grammar.present_continuous.now_or_usually",
      "english_grammar.present_continuous.negative",
      "english_grammar.present_continuous.questions",
      "english_grammar.present_continuous.ing_spelling",
      "english_grammar.present_continuous.now_or_usually_more",
    ],
  },
] as const;

for (const topicCase of TOPIC_CASES) {
  describe(`temat ${topicCase.id} — spójność katalogu`, () => {
    const topic = englishGrammarSubject.topics.find((t) => t.id === topicCase.id)!;

    it("ma cele w oczekiwanej kolejności nauki", () => {
      expect(topic.objectives.map((o) => o.id)).toEqual(topicCase.objectiveIds);
    });

    it("każdy cel ma kategorie błędów z szablonami podpowiedzi", () => {
      for (const objective of topic.objectives) {
        expect(objective.errorCategories.length).toBeGreaterThanOrEqual(2);
        for (const code of objective.errorCategories) {
          expect(objective.hints[code]).toBeTruthy();
        }
      }
    });

    it("każdy cel ma co najmniej jedną kartę z miejscem {{examples}}", () => {
      for (const objective of topic.objectives) {
        const hasExamples = objective.cards.some(
          (card) => card.title.includes("{{examples}}") || card.body.includes("{{examples}}"),
        );
        expect(hasExamples, `cel ${objective.id} bez {{examples}}`).toBe(true);
      }
    });

    it("każdy cel ma 2–4 karty", () => {
      for (const objective of topic.objectives) {
        expect(objective.cards.length, objective.id).toBeGreaterThanOrEqual(2);
        expect(objective.cards.length, objective.id).toBeLessThanOrEqual(4);
      }
    });

    it("ma trzy przekształcenia tematu", () => {
      expect(topic.transforms.map((t) => t.id).sort()).toEqual(
        ["to_affirmative", "to_negative", "to_question"].sort(),
      );
    });
  });
}

describe("englishGrammarSubject — wybór ze słuchu (#198)", () => {
  const typesOf = (topic: { objectives: readonly { id: string; exerciseTypes: readonly string[] }[] }, suffix: string) =>
    topic.objectives.find((objective) => objective.id.endsWith(suffix))?.exerciseTypes ?? [];

  it("cele ze słyszalną różnicą formy dostają lesson_listen_choice", () => {
    for (const suffix of [".affirmative_base", ".third_person_s", ".negative", ".question"]) {
      expect(typesOf(presentSimpleV1, suffix), suffix).toContain("lesson_listen_choice");
    }
    for (const suffix of [".affirmative_forms", ".negative_forms", ".questions"]) {
      expect(typesOf(toBeV1, suffix), suffix).toContain("lesson_listen_choice");
    }
    for (const suffix of [".affirmative", ".negative", ".questions"]) {
      expect(typesOf(presentContinuousV1, suffix), suffix).toContain("lesson_listen_choice");
    }
  });

  it("cele pisowni, krótkich odpowiedzi i formy po does nie dostają typu", () => {
    for (const suffix of [".spelling_es_ies", ".short_answers", ".base_form_after_does"]) {
      expect(typesOf(presentSimpleV1, suffix), suffix).not.toContain("lesson_listen_choice");
    }
    for (const suffix of [".contractions", ".short_answers"]) {
      expect(typesOf(toBeV1, suffix), suffix).not.toContain("lesson_listen_choice");
    }
    // Cele porównania: lektor czytałby wskaźnik czasu, więc słuch nie sprawdzałby wyboru czasu.
    for (const suffix of [".now_or_usually", ".ing_spelling", ".now_or_usually_more"]) {
      expect(typesOf(presentContinuousV1, suffix), suffix).not.toContain("lesson_listen_choice");
    }
  });

  it("poprawne ćwiczenie ze słuchu dla to_be.questions przechodzi walidację (Is/Are otwierające pytanie)", () => {
    const draft: LessonExerciseDraft = {
      exerciseType: "lesson_listen_choice",
      objectiveId: "english_grammar.to_be.questions",
      stem: "___ she happy?",
      options: [{ id: "a", text: "Is" }, { id: "b", text: "Are" }],
      correctOption: "a",
      answer: "Is",
      acceptedAnswers: [],
      focus: ["Is"],
    };
    expect(validateLessonExercise(draft, englishGrammarSubject, toBeV1)).toEqual([]);
  });

  it("wersje tematów bez zmian", () => {
    expect(presentSimpleV1.version).toBe(1);
    expect(toBeV1.version).toBe(1);
    expect(presentContinuousV1.version).toBe(1);
    expect(Object.fromEntries(englishGrammarSubject.topics.map((topic) => [topic.id, topic.version]))).toEqual({
      present_simple: 1,
      to_be: 1,
      present_continuous: 1,
    });
  });

  it("fieldRules opisują regułę typu: jedna luka, słyszalna różnica, bez równoważnych opcji i bez instructionPl", () => {
    const rules = englishGrammarPrompts.fieldRules ?? "";
    expect(rules).toContain("lesson_listen_choice");
    expect(rules).toMatch(/at most 12 words/);
    expect(rules).toMatch(/exactly one gap/);
    expect(rules).toMatch(/audibly/i);
    expect(rules).toMatch(/never offer an equivalent/i);
    expect(rules).toMatch(/apostrophe/);
    expect(rules).toMatch(/instructionPl.*hint.*visualSubject/s);
  });

  it("fieldRules zabraniają sybilantu zaraz za luką przy opcjach różnych o -s (końcówka zlewa się w mowie)", () => {
    const rules = englishGrammarPrompts.fieldRules ?? "";
    expect(rules).toMatch(/-s ending that adds no syllable.*right after the gap.*s, z or sh sound/s);
    expect(rules).toContain("This does not apply to Do / Does or watch / watches");
    expect(rules).toContain("never He ___ snakes. or She ___ soccer.");
  });
});

describe("temat present_continuous — cele, kategorie i opisy (spec §3, §7.3, §9)", () => {
  const PC = "english_grammar.present_continuous";
  const objective = (suffix: string) => presentContinuousV1.objectives.find((o) => o.id === `${PC}.${suffix}`)!;
  const COMPARISON = ["now_or_usually", "now_or_usually_more"] as const;

  it("typy ćwiczeń celów zgodne z tabelą §3.1", () => {
    const types = Object.fromEntries(
      presentContinuousV1.objectives.map((o) => [o.id.slice(PC.length + 1), [...o.exerciseTypes].sort()]),
    );
    const lesson = (...names: string[]) => names.map((name) => `lesson_${name}`).sort();
    expect(types).toEqual({
      affirmative: lesson("card", "notice", "choice", "listen_choice", "order", "gap", "error_fix", "open_answer"),
      now_or_usually: lesson("card", "choice", "gap", "error_fix", "open_answer"),
      negative: lesson("card", "choice", "listen_choice", "gap", "error_fix", "transform", "open_answer"),
      questions: lesson("card", "choice", "listen_choice", "order", "short_answer", "gap", "transform", "open_answer"),
      ing_spelling: lesson("card", "choice", "gap", "error_fix", "open_answer"),
      now_or_usually_more: lesson("card", "choice", "gap", "error_fix", "open_answer"),
    });
  });

  it("kategorie błędów tematu i ich przypisanie do celów zgodne z §3.3", () => {
    expect(presentContinuousV1.extraErrorCategories.map((c) => c.code)).toEqual([
      "wrong_be_form",
      "missing_be_form",
      "missing_ing",
      "ing_spelling",
      "be_plus_simple",
      "continuous_for_habit",
      "simple_for_now",
    ]);
    const categories = Object.fromEntries(
      presentContinuousV1.objectives.map((o) => [o.id.slice(PC.length + 1), [...o.errorCategories]]),
    );
    expect(categories).toEqual({
      affirmative: ["missing_be_form", "wrong_be_form", "missing_ing"],
      now_or_usually: ["continuous_for_habit", "simple_for_now", "be_plus_simple"],
      negative: ["wrong_negation", "missing_be_form", "wrong_be_form", "missing_ing", "extra_auxiliary"],
      questions: ["word_order", "missing_be_form", "wrong_be_form", "extra_auxiliary", "short_answer_form", "missing_ing"],
      ing_spelling: ["ing_spelling", "missing_ing"],
      now_or_usually_more: ["continuous_for_habit", "simple_for_now", "be_plus_simple"],
    });
  });

  it("przekształcenia mają te same polecenia co Present Simple", () => {
    expect(presentContinuousV1.transforms).toEqual(presentSimpleV1.transforms);
  });

  it("cele porównania nie mają kategorii formy, a opis definiuje werdykt wyboru czasu (§7.3)", () => {
    for (const suffix of COMPARISON) {
      const o = objective(suffix);
      for (const formCategory of ["missing_ending", "wrong_auxiliary", "extra_ending"]) {
        expect(o.errorCategories, `${suffix}: ${formCategory}`).not.toContain(formCategory);
      }
      expect(o.descriptionEn).toContain("The checked element is the choice of tense");
      expect(o.descriptionEn).toContain("'almost' with errorCategory: null");
      for (const code of ["continuous_for_habit", "simple_for_now", "be_plus_simple"]) {
        expect(o.descriptionEn, `${suffix}: ${code}`).toContain(code);
      }
    }
  });

  it("podpowiedzi celów porównania powtarzają refren „teraz czy zwykle?” (§3.3)", () => {
    for (const suffix of COMPARISON) {
      for (const hint of Object.values(objective(suffix).hints)) {
        expect(hint, suffix).toContain("Zapytaj siebie: teraz czy zwykle?");
      }
    }
  });

  it("zdanie o mieszaniu czasów w historyjce jest w opisie dokładnie celów porównania (§9)", () => {
    expect(STORY_MIX_SENTENCE).toBe("The end-of-lesson story may mix present simple and present continuous.");
    const withStoryMix = englishGrammarSubject.topics
      .flatMap((topic) => topic.objectives)
      .filter((o) => o.descriptionEn.includes(STORY_MIX_SENTENCE))
      .map((o) => o.id);
    expect(withStoryMix).toEqual([`${PC}.now_or_usually`, `${PC}.now_or_usually_more`]);
  });

  it("karty uczą trudnej pisowni -ing i pary jedzie/jeździ (§3.2)", () => {
    const text = (suffix: string) => objective(suffix).cards.map((card) => `${card.title} ${card.body}`).join(" ");
    for (const fragment of ["write → writing (jedno t!)", "tie → tying", "jump → jumping", "fix → fixing", "run → running"]) {
      expect(text("ing_spelling")).toContain(fragment);
    }
    expect(text("now_or_usually")).toContain("jedzie");
    expect(text("now_or_usually")).toContain("jeździ");
  });
});

describe("fieldRules — temat present_continuous i zawężenie Present Simple (spec §7)", () => {
  const rules = englishGrammarPrompts.fieldRules ?? "";
  const PS_HEADER = "For objectives whose id contains '.present_simple.'";
  const PC_HEADER = "For objectives whose id contains '.present_continuous.'";

  it("reguły luki Present Simple, hint jako bezokolicznik i operator dotyczą tylko celów '.present_simple.' (§7.1)", () => {
    // Jedno zdanie od nagłówka do formy odpowiedzi: model nie czyta reguły jako ogólnej dla przedmiotu.
    expect(rules).toMatch(/For objectives whose id contains '\.present_simple\.'[^.]*present simple form of that base verb/);
    const header = rules.indexOf(PS_HEADER);
    const toBe = rules.indexOf('For objectives whose id contains ".to_be."');
    expect(header).toBeGreaterThanOrEqual(0);
    for (const fragment of ["BASE FORM (infinitive)", "present simple form of that base verb", "operator-only answer"]) {
      expect(rules.indexOf(fragment), fragment).toBeGreaterThan(header);
      expect(rules.indexOf(fragment), fragment).toBeLessThan(toBe);
    }
    expect(rules.slice(0, header)).not.toMatch(/lesson_gap set hint|operator/);
  });

  it("blok '.present_continuous.' zawiera kluczowe reguły i listy ze stałych (§7.2)", () => {
    const block = presentContinuousFieldRules();
    expect(block.startsWith(PC_HEADER)).toBe(true);
    expect(rules).toContain(block);
    for (const fragment of ["'.present_continuous.'", "hint null", "Look!", "every day", "tomorrow", "play", "swim", "What + am/is/are", "Kiedy to się dzieje?"]) {
      expect(block, fragment).toContain(fragment);
    }
    // Refren „teraz czy zwykle” ma wskaźniki obu grup — prompt go zakazuje, a nie proponuje.
    expect(block).toContain("never write the refrain teraz czy zwykle");
  });

  it("przykłady bloku przechodzą walidator przedmiotu i ogólną walidację ćwiczenia, a tekst bloku zawiera ich JSON", () => {
    expect(PRESENT_CONTINUOUS_PROMPT_EXAMPLES.map((ex) => `${ex.objectiveId.split(".").at(-1)}/${ex.exerciseType}`)).toEqual([
      "affirmative/lesson_gap",
      "now_or_usually/lesson_choice",
      "now_or_usually/lesson_choice",
      "now_or_usually_more/lesson_gap",
    ]);
    const block = presentContinuousFieldRules();
    for (const ex of PRESENT_CONTINUOUS_PROMPT_EXAMPLES) {
      expect(validateEnglishGrammarExercise(ex, presentContinuousV1), ex.stem).toEqual([]);
      expect(validateLessonExercise(ex, englishGrammarSubject, presentContinuousV1), ex.stem).toEqual([]);
      expect(block).toContain(JSON.stringify(ex));
    }
  });

  it("kolokacje wymienione w bloku są dozwolone przez regułę czasowników stanu (§5.3)", () => {
    const block = presentContinuousFieldRules();
    const collocations = /may also use (.+?) \(never in ing_spelling\)/.exec(block)?.[1]?.split(", ") ?? [];
    expect(collocations.length).toBeGreaterThan(0);
    for (const phrase of collocations) {
      expect(stateVerbIn(`She is ${phrase} now.`, "ing_form"), phrase).toBeUndefined();
    }
  });
});
