import { describe, expect, it } from "vitest";
import { MAX_TEXT_LENGTH, validateLessonExercise } from "../pool-validation";
import { englishChapterSubject } from "../subjects/english-chapter/module";
import { TRANSLATION_INSTRUCTION } from "../subjects/english-chapter/validators";
import { A, admitInOrder, B, choice, contextFor, gap, keywords, listen, open, stateWith, subject, topic, type StepEntry } from "../testing/agent-admission-fixtures";
import { schoolSubject } from "../subjects/school/module";
import { testIssue } from "../testing/test-issue";
import type { DynamicTopicData, LessonExerciseDraft } from "../types";
import { removeExercise, submitExamples, type AgentCheckContext } from "./admission";
import { agentObjectivesOf } from "./capable";
import { createLessonAgentState, orderedLesson, poolOf, type LessonAgentState } from "./state";

const ctx = contextFor();

/** Przyjmuje kandydatów po kolei krokiem reguł lekcji i ujawnień, jak walidacja puli przebiegu bazowego. */
function submit(state: LessonAgentState, objectiveId: string, drafts: readonly LessonExerciseDraft[], context: AgentCheckContext = ctx) {
  return admitInOrder(state, objectiveId, drafts, context);
}

function codeOf(entry: StepEntry | undefined): string {
  if (entry === undefined) return "missing";
  return "accepted" in entry ? "accepted" : entry.rejected.code;
}

function accepted(state: LessonAgentState, objectiveId: string, drafts: readonly LessonExerciseDraft[], context: AgentCheckContext = ctx): LessonAgentState {
  const result = submit(state, objectiveId, drafts, context);
  expect(result.results.map(codeOf)).toEqual(drafts.map(() => "accepted"));
  return result.state;
}

describe("fixture'y przyjmowania", () => {
  it("szkice pomocnicze są poprawne dla przedmiotu testowego", () => {
    for (const draft of [choice(A, 1), open(A, "Kiedy?", "w 966 roku", "f1"), gap(A, "Chrzest w roku ___.", "966"), keywords(A, "f1", 1), listen(A, 1)]) {
      expect(validateLessonExercise(draft, subject, topic), draft.exerciseType).toEqual([]);
    }
  });
});

describe("krok reguł lekcji — kody i powody odrzuceń (spec katalogu reguł §4.1–4.2)", () => {
  const rejectionAt = (entry: StepEntry | undefined) => {
    if (entry === undefined || !("rejected" in entry)) throw new Error(`expected rejection, got ${JSON.stringify(entry)}`);
    return entry.rejected;
  };

  it("ofiara reguł lekcji: zgłoszenie ofiary z id reguły", () => {
    const triggering = {
      ...subject,
      validatePoolExtra: (drafts: readonly LessonExerciseDraft[]) => {
        const triggered = drafts.some((draft) => draft.answer === "odpowiedź 9");
        return new Map(drafts.flatMap((draft, index) => (triggered && draft.answer === "odpowiedź 1" ? [[index, [testIssue("ofiara", "victim of trigger")]] as const] : [])));
      },
    };
    const context = contextFor({ subject: triggering });
    const state = accepted(stateWith(), A, [choice(A, 1)], context);
    const rejection = rejectionAt(submit(state, A, [choice(A, 9)], context).results[0]);
    expect(rejection).toMatchObject({ kind: "lesson", code: "lesson_extra", ruleIds: ["test.issue"] });
    expect(rejection.issues).toEqual([testIssue("ofiara", "victim of trigger")]);
  });

  it("własne odrzucenie reguły puli: lesson_pool z id reguły", () => {
    const state = accepted(stateWith(), A, [choice(A, 1)]);
    const rejection = rejectionAt(submit(state, A, [choice(A, 1)]).results[0]);
    expect(rejection).toMatchObject({ code: "lesson_pool", ruleIds: ["lesson.duplicate_stimulus"] });
    expect(rejection.issues[0]!.found).toMatch(/^same stimulus as the earlier lesson_choice /u);
  });

  it("ofiara reguł puli: duplikat odpowiedzi ćwiczenia późniejszego zagadnienia — lesson_pool", () => {
    // Unikalność odpowiedzi zachowuje PIERWSZE wystąpienie: kandydat w A wyprzedza przyjęte ćwiczenie B.
    const byAnswer = contextFor({ subject: { ...subject, poolDeduplication: "answer" } });
    const state = accepted(stateWith(), B, [choice(B, 1)], byAnswer);
    const rejection = rejectionAt(submit(state, A, [gap(A, "Inne pytanie: ___.", "odpowiedź 1")], byAnswer).results[0]);
    expect(rejection).toMatchObject({ kind: "lesson", code: "lesson_pool", ruleIds: ["lesson.duplicate_answer"] });
  });
});

describe("przyjmowanie paczki — słowa kluczowe szkoły po pytaniu otwartym swojej rodziny", () => {
  const OBJECTIVE = "school.ddeck.fotosynteza";
  const QUOTE = "wytwarza cukry";
  const material = `Fotosynteza to proces, w którym roślina z wody i dwutlenku węgla, przy udziale światła, ${QUOTE}.`;
  const schoolTopic = schoolSubject.buildDynamicTopic!({
    titlePl: "Przyroda",
    objectives: [{
      id: OBJECTIVE,
      titlePl: "Fotosynteza",
      descriptionEn: "Photosynthesis.",
      cards: [{ title: "Co to jest?", body: "Roślina wytwarza cukry." }, { title: "Po co?", body: "Cukry są pokarmem rośliny." }],
    }],
  });
  const context: AgentCheckContext = {
    subject: schoolSubject,
    material,
    limits: new Map([[OBJECTIVE, { targetCount: 8 }]]),
  };
  const state = () => createLessonAgentState({ topic: schoolTopic, objectives: agentObjectivesOf(schoolTopic), fixed: [], examples: {}, fixedSources: {} });
  const openDraft = (overrides: Partial<LessonExerciseDraft> = {}): LessonExerciseDraft => ({
    exerciseType: "lesson_open_answer",
    objectiveId: OBJECTIVE,
    prompt: "Co to jest fotosynteza?",
    answer: "Roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry.",
    acceptedAnswers: [],
    focus: ["wytwarza cukry"],
    questionType: "definition",
    requiredElements: [{ id: "e1", text: "Roślina wytwarza cukry." }],
    expectedForm: "explanation",
    sourceRefs: [{ quote: QUOTE }],
    familyId: "def",
    ...overrides,
  });
  const keywordsDraft: LessonExerciseDraft = {
    exerciseType: "lesson_keywords",
    objectiveId: OBJECTIVE,
    familyId: "def",
    keywordOptions: [{ id: "k1", text: "światło" }, { id: "k2", text: "cukry" }, { id: "k3", text: "tlen" }, { id: "k4", text: "korzenie" }],
    keyOptionIds: ["k1", "k2"],
    answer: "światło, cukry",
    acceptedAnswers: [],
    focus: [],
    sourceRefs: [{ quote: QUOTE }],
  };
  it("słowa kluczowe po pytaniu swojej rodziny przechodzą", () => {
    expect(submit(state(), OBJECTIVE, [openDraft(), keywordsDraft], context).results.map(codeOf)).toEqual(["accepted", "accepted"]);
  });

  it("bez rodziny w lekcji: school.keywords_family_missing", () => {
    const [entry] = submit(state(), OBJECTIVE, [keywordsDraft], context).results;
    expect(entry).toMatchObject({ rejected: { ruleIds: ["school.keywords_family_missing"] } });
  });
});

describe("przyjmowanie paczki — reguły lekcji", () => {
  it("duplikat w paczce: drugi lesson_pool", () => {
    const result = submit(stateWith(), A, [choice(A, 1), choice(A, 1)]);
    expect(result.results.map(codeOf)).toEqual(["accepted", "lesson_pool"]);
    expect(poolOf(result.state, A).map((entry) => entry.id)).toEqual(["ex1"]);
  });

  it("ponowne wysłanie przyjętego ćwiczenia: lesson_pool", () => {
    const state = accepted(stateWith(), A, [choice(A, 1)]);
    expect(submit(state, A, [choice(A, 1)]).results[0]).toMatchObject({ rejected: { kind: "lesson", code: "lesson_pool" } });
  });

  it("wadliwe fixed (duplikat w fixed) nie blokuje poprawnego kandydata", () => {
    const state = stateWith({ fixed: [choice(A, 1), choice(A, 1)] });
    const result = submit(state, A, [choice(A, 2)]);
    expect(result.results).toEqual([{ accepted: "ex1" }]);
  });

  it("fixed odrzucone przez validatePoolExtra (sierota słów kluczowych) nie blokuje poprawnego kandydata", () => {
    const state = stateWith({ fixed: [keywords(A, "f9", 9)] });
    const result = submit(state, A, [choice(A, 1)]);
    expect(result.results).toEqual([{ accepted: "ex1" }]);
  });

  it("słowa kluczowe bez rodziny w lekcji: lesson_extra", () => {
    const result = submit(stateWith(), A, [keywords(A, "f1", 1)]);
    expect(result.results[0]).toEqual({
      rejected: {
        kind: "lesson",
        code: "lesson_extra",
        issues: [testIssue("keywords without open-answer family")],
        ruleIds: ["test.issue"],
      },
    });
  });

  it("błąd validatePoolExtra na innym ćwiczeniu odrzuca kandydata: lesson_extra", () => {
    const triggering = {
      ...subject,
      validatePoolExtra: (drafts: readonly LessonExerciseDraft[]) => {
        const triggered = drafts.some((draft) => draft.answer === "odpowiedź 9");
        return new Map(drafts.flatMap((draft, index) => (triggered && draft.answer === "odpowiedź 1" ? [[index, [testIssue("victim of trigger")]] as const] : [])));
      },
    };
    const context = contextFor({ subject: triggering });
    const state = accepted(stateWith(), A, [choice(A, 1)], context);
    const result = submit(state, A, [choice(A, 9)], context);
    expect(result.results[0]).toMatchObject({ rejected: { kind: "lesson", code: "lesson_extra" } });
    expect(result.results[0]).toMatchObject({ rejected: { issues: [testIssue("victim of trigger")] } });
  });
});

describe("przyjmowanie paczki — konflikt słuchowy między zagadnieniami (rozdział)", () => {
  const WEATHER = "english_chapter.ddeck.weather";
  const WEARING = "english_chapter.ddeck.wearing";
  const data: DynamicTopicData = {
    titlePl: "Unit 1",
    objectives: [
      {
        id: WEATHER,
        titlePl: "Pogoda",
        descriptionEn: "Weather words: raining, sunny, windy.",
        kind: "words",
        cards: [
          { title: "Słówka", body: "raining — pada deszcz\nsunny — słonecznie" },
          { title: "Jeszcze", body: "windy — wietrznie" },
        ],
      },
      {
        id: WEARING,
        titlePl: "Co mam na sobie?",
        descriptionEn: "Frame: I'm wearing (a) ...",
        kind: "frame",
        cards: [
          { title: "Wzór", body: "I'm wearing (a) …" },
          { title: "Przykład", body: "I'm wearing a coat. — Mam na sobie płaszcz." },
        ],
      },
    ],
  };
  const chapterTopic = englishChapterSubject.buildDynamicTopic!(data);
  const chapter = englishChapterSubject;
  const material = "It's raining today. It's sunny today. It's windy. I'm wearing a coat.";
  const chapterCtx: AgentCheckContext = {
    subject: chapter,
    material,
    limits: new Map([WEATHER, WEARING].map((id) => [id, { targetCount: 8 }])),
  };
  const chapterState = () =>
    createLessonAgentState({ topic: chapterTopic, objectives: agentObjectivesOf(chapterTopic), fixed: [], examples: {}, fixedSources: {} });

  const listenWeather: LessonExerciseDraft = {
    exerciseType: "lesson_listen_choice",
    objectiveId: WEATHER,
    stem: "It's ___ today.",
    options: [
      { id: "a", text: "raining" },
      { id: "b", text: "sunny" },
    ],
    correctOption: "a",
    answer: "raining",
    acceptedAnswers: [],
    focus: ["raining"],
  };
  const translationWearing: LessonExerciseDraft = {
    exerciseType: "lesson_open_answer",
    objectiveId: WEARING,
    instructionPl: TRANSLATION_INSTRUCTION,
    prompt: "Dziś pada deszcz.",
    answer: "It's raining today.",
    acceptedAnswers: [],
    focus: ["raining"],
  };

  it("szkice rozdziału są poprawne osobno", () => {
    expect(validateLessonExercise(listenWeather, chapter, chapterTopic)).toEqual([]);
    expect(validateLessonExercise(translationWearing, chapter, chapterTopic)).toEqual([]);
  });

  it("tekstowe ćwiczenie w B z odpowiedzią równą zdaniu słuchowemu przyjętemu w A: lesson_pool", () => {
    const withListen = submit(chapterState(), WEATHER, [listenWeather], chapterCtx);
    expect(withListen.results.map(codeOf)).toEqual(["accepted"]);
    const result = submit(withListen.state, WEARING, [translationWearing], chapterCtx);
    expect(result.results[0]).toMatchObject({ rejected: { kind: "lesson", code: "lesson_pool" } });
  });

  it("ćwiczenie słuchowe w A ze zdaniem równym odpowiedzi tekstowej przyjętej w B: lesson_pool", () => {
    const withText = submit(chapterState(), WEARING, [translationWearing], chapterCtx);
    expect(withText.results.map(codeOf)).toEqual(["accepted"]);
    const result = submit(withText.state, WEATHER, [listenWeather], chapterCtx);
    expect(result.results[0]).toMatchObject({ rejected: { kind: "lesson", code: "lesson_pool" } });
  });
});

describe("submitExamples", () => {
  it("4 linie → przyjęte 3 (przycięte), czwarta pominięta", () => {
    const result = submitExamples(stateWith(), A, ["  Mieszko I przyjął chrzest.  ", "Zdanie drugie.", "Zdanie trzecie.", "Zdanie czwarte."], ctx);
    expect(result.accepted).toBe(3);
    expect(result.state.examples.get(A)).toEqual(["Mieszko I przyjął chrzest.", "Zdanie drugie.", "Zdanie trzecie."]);
  });

  it("identyczne linie (po przycięciu) liczą się raz i nie zajmują miejsc kolejnych przykładów", () => {
    const result = submitExamples(stateWith(), A, ["Zdanie pierwsze.", "Zdanie pierwsze.", "  Zdanie pierwsze. ", "Zdanie drugie.", "Zdanie trzecie."], ctx);
    expect(result.accepted).toBe(3);
    expect(result.state.examples.get(A)).toEqual(["Zdanie pierwsze.", "Zdanie drugie.", "Zdanie trzecie."]);
  });

  it("linia ujawniająca przyjęte samodzielne ćwiczenie odpada, pozostałe przyjęte", () => {
    const state = accepted(stateWith(), A, [open(A, "Rok chrztu?", "966")]);
    const result = submitExamples(state, A, ["Chrzest Polski.", "966"], ctx);
    expect(result.accepted).toBe(1);
    expect(result.state.examples.get(A)).toEqual(["Chrzest Polski."]);
  });

  it("linia ujawniająca samodzielne fixed innego zagadnienia też odpada", () => {
    const state = stateWith({ fixed: [open(B, "Rok chrztu?", "966")] });
    const result = submitExamples(state, A, ["966"], ctx);
    expect(result.accepted).toBe(0);
  });

  it("linia równa odpowiedzi ćwiczenia niesamodzielnego nie jest ujawnieniem", () => {
    const state = accepted(stateWith(), A, [gap(A, "Rok ___.", "966")]);
    expect(submitExamples(state, A, ["966"], ctx)).toMatchObject({ accepted: 1 });
  });

  it("zastępuje poprzednie przykłady zagadnienia, inne zagadnienia bez zmian", () => {
    const state = stateWith({ examples: { [A]: ["Stare A."], [B]: ["Stare B."] } });
    const result = submitExamples(state, A, ["Nowe A."], ctx);
    expect(result).toMatchObject({ accepted: 1 });
    expect(result.state.examples.get(A)).toEqual(["Nowe A."]);
    expect(result.state.examples.get(B)).toEqual(["Stare B."]);
    expect(state.examples.get(A)).toEqual(["Stare A."]);
  });

  it("żadna linia nie przeszła → stare przykłady zostają (ten sam stan)", () => {
    const state = accepted(stateWith({ examples: { [A]: ["Stare A."] } }), A, [open(A, "Rok chrztu?", "966")]);
    const result = submitExamples(state, A, ["966", "   ", 7, "x".repeat(MAX_TEXT_LENGTH + 1)], ctx);
    expect(result.accepted).toBe(0);
    expect(result.state).toBe(state);
    expect(result.state.examples.get(A)).toEqual(["Stare A."]);
  });

  it("pusta tablica → nic nie przyjęte, stan bez zmian", () => {
    const state = stateWith({ examples: { [A]: ["Stare A."] } });
    expect(submitExamples(state, A, [], ctx)).toEqual({ state, accepted: 0 });
  });

  it('"x" → nic nie przyjęte', () => {
    const state = stateWith();
    expect(submitExamples(state, A, "x", ctx)).toEqual({ state, accepted: 0 });
  });

  it("przyjęte przykłady wpływają na kolejne kontrole ujawnień", () => {
    const state = submitExamples(stateWith(), A, ["w 966 roku"], ctx).state;
    const result = submit(state, A, [open(A, "Kiedy?", "w 966 roku")]);
    expect(result.results[0]).toMatchObject({ rejected: { code: "leak_victim" } });
  });
});

describe("wydajność przyjmowania", () => {
  // Lekcja szkoły: 6 zagadnień po 15 ćwiczeń (90) i materiał ok. 15 000 znaków; paczka 12.
  const OBJECTIVES = 6;
  const sentence = (o: number, k: number) => `Fakt ${o}-${k}: w zagadnieniu numer ${o} zdarzenie ${k} opisuje materiał rodzica.`;
  const material = Array.from({ length: OBJECTIVES }, (_, o) => Array.from({ length: 35 }, (_, k) => sentence(o, k)).join(" ")).join(" ");
  const schoolTopic = schoolSubject.buildDynamicTopic!({
    titlePl: "Duża lekcja",
    objectives: Array.from({ length: OBJECTIVES }, (_, o) => ({
      id: `school.ddeck.o${o}`,
      titlePl: `Zagadnienie ${o}`,
      descriptionEn: `Objective ${o}.`,
      cards: [
        { title: "Karta 1", body: sentence(o, 0) },
        { title: "Karta 2", body: sentence(o, 1) },
      ],
    })),
  });
  const ids = schoolTopic.objectives.map((objective) => objective.id);

  function schoolDraft(o: number, k: number): LessonExerciseDraft {
    const objectiveId = ids[o]!;
    const answer = `odpowiedź ${o}-${k}`;
    const sourceRefs = [{ quote: sentence(o, k % 30) }];
    if (k % 3 === 0) return { ...choice(objectiveId, 0), stem: `Pytanie ${o}-${k}: ___`, options: [{ id: "a", text: answer }, { id: "b", text: `inna ${o}-${k}` }], answer, sourceRefs };
    if (k % 3 === 1) return { ...gap(objectiveId, `Luka ${o}-${k}: ___.`, answer), sourceRefs };
    return {
      ...open(objectiveId, `Pytanie otwarte ${o}-${k}?`, answer),
      questionType: "definition",
      requiredElements: [{ id: "e1", text: answer }],
      expectedForm: "explanation",
      sourceRefs,
    };
  }

  it("90 ćwiczeń, 6 zagadnień, materiał ok. 15 000 znaków: kolejne lessonRulesStep paczki 12 < 2000 ms (w CI < 10 000 ms)", () => {
    expect(material.length).toBeGreaterThan(14_000);
    expect(material.length).toBeLessThan(16_000);
    const fixed = Array.from({ length: OBJECTIVES }, (_, o) => Array.from({ length: 15 }, (_, k) => schoolDraft(o, k))).flat();
    const state = createLessonAgentState({ topic: schoolTopic, objectives: agentObjectivesOf(schoolTopic), fixed, examples: {}, fixedSources: {} });
    const context: AgentCheckContext = {
      subject: schoolSubject,
      material,
      limits: new Map(ids.map((id) => [id, { targetCount: 8 }])),
    };
    const batch = Array.from({ length: 12 }, (_, k) => schoolDraft(0, 15 + k));
    const startedAt = performance.now();
    const admitted = submit(state, ids[0]!, batch, context);
    const elapsed = performance.now() - startedAt;
    expect(admitted.results.filter((entry) => "accepted" in entry)).toHaveLength(12);
    // Strażnik złożoności (np. kwadratowej), nie benchmark: współdzielony runner CI dostaje zapas.
    expect(elapsed).toBeLessThan(process.env.CI ? 10_000 : 2000);
  });
});

describe("removeExercise", () => {
  it("usuwa własne ćwiczenie razem z osieroconymi słowami kluczowymi rodziny", () => {
    const withFamily = accepted(stateWith(), A, [open(A, "Kiedy?", "w 966 roku", "f1"), keywords(A, "f1", 1)]);
    const state = accepted(withFamily, A, [choice(A, 1)]);
    const result = removeExercise(state, A, "ex1");
    expect(result.removed).toEqual(["ex1", "ex2"]);
    expect(poolOf(result.state, A).map((entry) => entry.id)).toEqual(["ex3"]);
  });

  it("usuwa tylko wskazane ćwiczenie, gdy rodzina ma jeszcze pytanie otwarte (także fixed)", () => {
    const state = accepted(stateWith({ fixed: [open(A, "Kto?", "Mieszko I", "f1")] }), A, [open(A, "Kiedy?", "w 966 roku", "f1"), keywords(A, "f1", 1)]);
    expect(removeExercise(state, A, "ex1").removed).toEqual(["ex1"]);
  });

  it("nieznane, cudze i fixed → [] i ten sam stan", () => {
    let state = stateWith({ fixed: [choice(A, 7)] });
    state = accepted(state, A, [choice(A, 1)]);
    state = accepted(state, B, [choice(B, 2)]);
    for (const [objectiveId, id] of [[A, "ex99"], [A, "ex2"], [B, "ex1"]] as const) {
      const result = removeExercise(state, objectiveId, id);
      expect(result.removed).toEqual([]);
      expect(result.state).toBe(state);
    }
    expect(orderedLesson(state)).toHaveLength(3);
  });
});

describe("niezmienność wejścia", () => {
  it("lessonRulesStep i removeExercise nie zmieniają stanu wejściowego", () => {
    const state = accepted(stateWith({ examples: { [A]: ["x"] }, fixed: [choice(B, 3)] }), A, [open(A, "Kiedy?", "w 966 roku", "f1"), keywords(A, "f1", 1)]);
    const snapshot = structuredClone(state);
    const drafts = [choice(A, 1), keywords(A, "f1", 2), choice(A, 1)];
    const draftsSnapshot = structuredClone(drafts);
    submit(state, A, drafts);
    removeExercise(state, A, "ex1");
    expect(state).toEqual(snapshot);
    expect(drafts).toEqual(draftsSnapshot);
  });
});
