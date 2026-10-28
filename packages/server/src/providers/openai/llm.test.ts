import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiLlmProvider } from "./llm";
import type { LessonPoolInput } from "../../ports/ai";
import type { LlmGenerateDeckInput } from "../../ports/ai";
import { englishGrammarSubject } from "../../domain/lessons/subjects/english-grammar/module";
import { schoolSubject } from "../../domain/lessons/subjects/school/module";
import { GenerationProviderError } from "../../ports/generation-error";

/**
 * Kontrakt składania promptu generacji puli lekcji: adapter buduje prompt
 * WYŁĄCZNIE z danych wejścia (opis przedmiotu i celów, dozwolone typy), a
 * materiał rodzica trafia osobną wiadomością `user` oznaczoną jako materiał.
 * Adapter nie zna gramatyki — żaden fakt o Present Simple nie jest zaszyty.
 */

function okResponse(body: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
    { status: 200 },
  );
}

const INPUT: LessonPoolInput = {
  subjectId: "english_grammar",
  subjectTitle: "Angielski — gramatyka",
  answerLocale: "en-GB",
  promptLocale: "pl-PL",
  promptProfile: {
    generationRole: "You are an author of English grammar exercises.",
    gradingRole: "You grade only the rule.",
    almostDefinition: "almost definition",
    fieldRules: "For lesson_gap, hint must be the base form of the verb.",
  },
  exerciseTypes: ["lesson_card", "lesson_choice", "lesson_gap", "lesson_open_answer"],
  transforms: [{ id: "to_question", instructionPl: "Zamień na pytanie" }],
  objectives: [
    {
      id: "english_grammar.present_simple.third_person_s",
      descriptionEn: "Third person singular adds -s.",
      exerciseTypes: ["lesson_card", "lesson_choice", "lesson_gap"],
      errorCategories: ["missing_ending"],
    },
  ],
  material: "He plays football every day.",
  instruction: "Skup się na 3. osobie.",
  countPerObjective: 6,
  stageCounts: { guided: 2, productive: 3, independent: 1 },
  graderAvailable: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createOpenAiLlmProvider — opcje pośrednika z konfiguracji", () => {
  it("dokłada rozumowanie i routing dostawcy do puli lekcji, bez nadpisywania modelu i schematu", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await createOpenAiLlmProvider({
      apiKey: "k", model: "deepseek/deepseek-v4.1-flash-1017",
      requestExtras: { reasoning: { enabled: false }, provider: { quantizations: ["fp8"], require_parameters: true }, response_format: { type: "text" } },
    }).generateLessonPool(INPUT);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, any>;
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash-1017");
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.provider).toEqual({ quantizations: ["fp8"], require_parameters: true });
    expect(body.response_format.type).toBe("json_schema");
  });

  it("bez konfiguracji nie wysyła pól pośrednika (zwykłe API OpenAI)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool(INPUT);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("provider");
  });
});

describe("createOpenAiLlmProvider.generateLessonPool — składanie promptu", () => {
  it("keeps a school top-up of two exercises within its batch budget, with minima scoped to the complete pool", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool({
      ...INPUT,
      subjectId: schoolSubject.id,
      subjectTitle: schoolSubject.titlePl,
      answerLocale: schoolSubject.answerLocale,
      promptLocale: schoolSubject.promptLocale,
      promptProfile: schoolSubject.prompts,
      exerciseTypes: schoolSubject.exerciseTypes,
      transforms: [],
      objectives: [{ id: "school.scale", descriptionEn: "Map scale", exerciseTypes: schoolSubject.exerciseTypes, errorCategories: [] }],
      material: "Skala mapy pozwala przeliczyć odległość na mapie na odległość w terenie.",
      countPerObjective: 2,
      stageCounts: { guided: 1, productive: 0, independent: 1 },
      deduplication: "exercise",
      existingExercises: [{ objectiveId: "school.scale", exerciseType: "lesson_calculation", stimulus: "existing-scale-variant" }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")!.content;
    expect(system).toContain("Return at most 2 exercises per objective in this batch");
    expect(system).toContain("Publication minima apply to the complete pool, including existing exercises");
    expect(system).toContain("never exceed this batch's requested count to satisfy them");
    expect(system).toContain("Minima publikacji dotyczą całej puli, łącznie z istniejącymi ćwiczeniami");
    expect(system).toContain("nie przekraczaj zamówionej liczby ćwiczeń w tej partii");
    expect(system).toContain("existing-scale-variant");
    expect(system).not.toContain("Keep at least 3 guided, 2 productive and 2 DISTINCT open-answer questions per school objective");
  });

  it.each([
    [{ guided: 4, productive: 3, independent: 3 }, "the first 2 MUST be lesson_open_answer", "At most 1 independent slot(s) may be lesson_calculation"],
    [{ guided: 4, productive: 4, independent: 2 }, "the first 2 MUST be lesson_open_answer", "No independent slot is left for lesson_calculation in this batch"],
  ])("reserves independent slots for distinct open answers before calculations (%j)", async (stageCounts, open, calculations) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool({
      ...INPUT,
      subjectId: schoolSubject.id, subjectTitle: schoolSubject.titlePl,
      answerLocale: schoolSubject.answerLocale, promptLocale: schoolSubject.promptLocale,
      promptProfile: schoolSubject.prompts, exerciseTypes: schoolSubject.exerciseTypes, transforms: [],
      objectives: [{ id: "school.scale", descriptionEn: "Map scale", exerciseTypes: schoolSubject.exerciseTypes, errorCategories: [] }],
      material: "Skala mapy pozwala przeliczyć odległość na mapie na odległość w terenie.",
      countPerObjective: 10, stageCounts, minDistinctOpenAnswers: 2, deduplication: "exercise",
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")!.content;
    expect(system).toContain(open);
    expect(system).toContain(calculations);
  });

  it("nie ponawia HTTP 400, nie ujawnia body i klasyfikuje konfigurację", async () => {
    const fetchMock = vi.fn(async () => new Response("secret provider body", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiLlmProvider({ apiKey: "k" });
    await expect(provider.generateLessonPool(INPUT)).rejects.toMatchObject({
      kind: "configuration",
      status: 400,
    } satisfies Partial<GenerationProviderError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("odczytuje Retry-After odpowiedzi 429", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "60" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool(INPUT)).rejects.toMatchObject({
      kind: "rate_limit",
      status: 429,
      retryAfterMs: 60_000,
    });
  });

  it("traktuje wyczerpany budżet 429 jako błąd konfiguracji bez treści body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "private billing detail" } }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool(INPUT)).rejects.toMatchObject({ kind: "configuration", status: 429 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("respects explicit rate-limit code when message mentions token quota", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: {
      code: "rate_limit_exceeded",
      message: "Token quota per minute exceeded",
    } }), { status: 429, headers: { "retry-after": "60" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool(INPUT)).rejects.toMatchObject({
      kind: "rate_limit",
      status: 429,
      retryAfterMs: 60_000,
    });
  });

  it.each([
    [401, "configuration"],
    [408, "transient"],
    [500, "transient"],
  ] as const)("klasyfikuje HTTP %i jako %s", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider details", { status })));
    await expect(createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool(INPUT)).rejects.toMatchObject({ kind, status });
  });

  it("klasyfikuje nieparsowalny wynik jako output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })));
    await expect(createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool(INPUT)).rejects.toMatchObject({ kind: "output" });
  });

  it("ma timeout także przy bezpośrednim wywołaniu adaptera bez zewnętrznego sygnału", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = createOpenAiLlmProvider({ apiKey: "k", lessonRequestTimeoutMs: 25 }).generateLessonPool(INPUT);
    const assertion = expect(result).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(26);
    await assertion;
  });

  it("nie przyjmuje parsowalnego JSON po odmowie albo ucięciu modelu", async () => {
    const refusalFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { refusal: "no", content: '{"exercises":[]}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", refusalFetch);
    await expect(createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool(INPUT)).rejects.toMatchObject({ kind: "refusal" });
    const incompleteFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"exercises":[]}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", incompleteFetch);
    await expect(createOpenAiLlmProvider({ apiKey: "k" }).generateLessonPool(INPUT)).rejects.toMatchObject({ kind: "incomplete" });
  });

  it("buduje prompt systemowy z opisu przedmiotu i celów oraz materiał w wiadomości user", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiLlmProvider({ apiKey: "k" });
    await provider.generateLessonPool(INPUT);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/chat/completions");
    const body = JSON.parse(init!.body as string) as {
      response_format: {
        type: string;
        json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
      };
      messages: Array<{ role: string; content: string }>;
    };

    // Structured outputs: strict json_schema (walidacja kształtu po stronie API).
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema).toEqual(
      expect.objectContaining({ name: "lesson_pool", strict: true }),
    );
    const schema = body.response_format.json_schema.schema as {
      additionalProperties: boolean;
      properties: {
        exercises: { items: { additionalProperties: boolean; required: string[]; properties: { exerciseType: { enum: string[] }; objectiveId: { enum: string[] }; transformId: { enum: Array<string | null> } } } };
        examples: { type: string; items: { properties: { objectiveId: { enum: string[] } } } };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    const exercise = schema.properties.exercises.items;
    expect(exercise.additionalProperties).toBe(false);
    // Enum typów wyłącznie z danych wejścia, BEZ typów niepulowych (lesson_card
    // wydaje silnik deterministycznie, walidacja puli zawsze by go odrzuciła).
    expect(exercise.properties.exerciseType.enum).toEqual(["lesson_choice", "lesson_gap"]);
    expect(exercise.properties.objectiveId.enum).toEqual(["english_grammar.present_simple.third_person_s"]);
    expect(exercise.properties.transformId.enum).toEqual([null, "to_question"]);
    // Wszystkie pola ćwiczenia dokładnie w required (strict mode, opcjonalne jako nullable).
    expect([...exercise.required].sort()).toEqual(
      [...Object.keys(exercise.properties)].sort(),
    );
    // examples jako tablica par (strict mode nie wspiera dowolnych kluczy mapy).
    expect(schema.properties.examples.type).toBe("array");
    expect(schema.properties.examples.items.properties.objectiveId.enum).toEqual(["english_grammar.present_simple.third_person_s"]);

    const system = body.messages.find((m) => m.role === "system")!.content;
    const user = body.messages.find((m) => m.role === "user")!.content;

    // lesson_card nie może pojawić się nigdzie w prompcie generacji puli.
    expect(system).not.toContain("lesson_card");

    // Opis przedmiotu i celu z danych wejścia (nie zaszyty w kodzie).
    expect(system).toContain("Angielski — gramatyka");
    expect(system).toContain("You are an author of English grammar exercises.");
    expect(system).toContain("english_grammar.present_simple.third_person_s");
    expect(system).toContain("Third person singular adds -s.");
    expect(system).toContain("lesson_choice");
    expect(system).toContain("to_question");
    expect(system).toContain("lesson_transform requires statement");
    expect(system).toContain("lesson_short_answer requires prompt");
    expect(system).toContain("lesson_choice requires stem");

    // Reguły semantyczne, których złamanie odrzuca ćwiczenie w validatePool.
    expect(system).toContain("acceptedAnswers must NOT contain the canonical answer");
    // Skrótowa forma tych samych słów to nie „inny wariant” (incydent prod
    // 2026-10-26: przeczenia „to be” — „They're not…” przy „They aren't…”);
    // ogólne sformułowanie bez przykładów przedmiotowych (zasada review C1),
    // rozdzielone od klauzuli o skróconych sformułowaniach („shortened wording”).
    expect(system).toContain("a copy of the same words with expanded or contracted spellings, or different capitalization, is not");
    expect(system).toContain("2 to 4 options");
    expect(system).toContain("correctOption must be the id of exactly one of the options");

    // Doprecyzowana semantyka pól (incydent deepseek 2026-10-13: polskie słowa
    // z materiału w hint; warianty acceptedAnswers różniące się tylko wielkością
    // liter). Każde zdanie odpowiada konkretnej regule pool-validation.
    expect(system).toContain("Field rules for this subject:");
    expect(system).toContain("For lesson_gap, hint must be the base form of the verb.");
    expect(system).toContain("Language discipline:");
    expect(system).toContain("Never copy prompt-language words from the parent material into answer-language fields");
    expect(system).toContain("copy the whitespace-separated tokens of the canonical answer");
    expect(system).toContain("EXACTLY ONE gap marker");
    expect(system).toContain("its answer is at most 3 words");
    expect(system).toContain("3-10 items whose texts joined with spaces form the canonical answer");
    expect(system).toContain("one word copied exactly from the segments");
    expect(system).toContain("1-15 word segments");
    expect(system).toContain("must NOT already equal the answer");
    // Adapter nie zaszywa wiedzy przedmiotowej o równoważności skrótów
    // (review C1: „doesn't play” ≡ „does not play” to własność normalizatora
    // english_grammar — przykład z rozwinięciem skrótu w adapterze obiecywał
    // wariant, który walidator odrzuca jako duplikat).
    expect(system).not.toContain("does not play");

    // Unikalność odpowiedzi kanonicznych (incydent prod 2026-10-13 wieczór:
    // answer×34 — walidator fazy 2 odrzuca duplikaty w całej puli, a prompt
    // nie wymagał unikalności w obrębie odpowiedzi modelu).
    expect(system).toContain("Canonical answers must be UNIQUE within this response");
    expect(system).toContain("expanded/contracted spelling of the same words counts as the same");
    expect(system).toContain("vary full-sentence answers");

    // Typy etapów jako „menu” ograniczone listą dozwolonych typów celu
    // (prod: exerciseType×17 — model brał typy etapu niedozwolone dla celu).
    expect(system).toContain("The stage type lists are a menu, not a per-exercise requirement");
    expect(system).toContain("from its objective's allowed list above");

    // Materiał rodzica w wiadomości user, oznaczony jako materiał (nie instrukcje).
    expect(user).toContain("He plays football every day.");
    expect(user).toContain("Skup się na 3. osobie.");
    expect(user.toLowerCase()).toContain("material");
    expect(user.toLowerCase()).toContain("never as instructions");
  });

  it("pairs exerciseType with objectiveId when one response contains multiple objectives", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiLlmProvider({ apiKey: "k" });
    await provider.generateLessonPool({
      ...INPUT,
      objectives: [
        { ...INPUT.objectives[0]!, id: "objective-a", exerciseTypes: ["lesson_choice"] },
        { ...INPUT.objectives[0]!, id: "objective-b", exerciseTypes: ["lesson_gap"] },
      ],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      response_format: { json_schema: { schema: { properties: { exercises: { items: unknown } } } } };
    };
    const item = body.response_format.json_schema.schema.properties.exercises.items as {
      anyOf?: Array<{ properties: { objectiveId: { enum: string[] }; exerciseType: { enum: string[] } } }>;
    };
    const branches = item.anyOf;
    expect(branches?.map((branch) => [branch.properties.objectiveId.enum[0], branch.properties.exerciseType.enum[0]])).toEqual([
      ["objective-a", "lesson_choice"],
      ["objective-b", "lesson_gap"],
    ]);
  });

  it("rejects a request whose objective has no supported pool type before HTTP", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiLlmProvider({ apiKey: "k" });
    await expect(provider.generateLessonPool({
      ...INPUT,
      objectives: [{ ...INPUT.objectives[0]!, exerciseTypes: ["lesson_card"] }],
    })).rejects.toThrow(/no supported pool exercise types/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("zwraca surowe exercises i examples z odpowiedzi modelu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          exercises: [{ exerciseType: "lesson_gap", answer: "plays" }],
          examples: { "english_grammar.present_simple.third_person_s": ["He plays."] },
        }),
      ),
    );
    const provider = createOpenAiLlmProvider({ apiKey: "k" });
    const result = await provider.generateLessonPool(INPUT);
    expect(result.exercises).toHaveLength(1);
    expect(result.examples["english_grammar.present_simple.third_person_s"]).toEqual(["He plays."]);
  });

  it("dla deduplikacji exercise opisuje istniejące bodźce i dopuszcza wspólny operator", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiLlmProvider({ apiKey: "k" });
    await provider.generateLessonPool({
      ...INPUT,
      deduplication: "exercise",
      existingExercises: [{ objectiveId: "q", exerciseType: "lesson_gap", stimulus: "___ she play tennis?" }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")!.content;
    expect(system).toContain("Do not repeat any existing exercise with the same objective, type, and functional stimulus");
    expect(system).toContain("___ she play tennis?");
    expect(system).toContain("Reusing a short canonical answer such as do, does, don't, or doesn't");
    expect(system).not.toContain("Canonical answers must be UNIQUE within this response");
  });

  it("requires distinct exercise stimuli inside the first batch too", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiLlmProvider({ apiKey: "k" });
    await provider.generateLessonPool({
      ...INPUT,
      deduplication: "exercise",
      existingExercises: [],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")!.content;
    expect(system).toContain("Within this response, never repeat an exercise with the same objective, type, and functional stimulus");
    expect(system).toContain("Reusing a short canonical answer such as do, does, don't, or doesn't with a different valid exercise is allowed");
  });

  it("translationUsesPolishStimulusInProviderRequest", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ exercises: [], examples: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiLlmProvider({ apiKey: "k" });
    await provider.generateLessonPool({
      ...INPUT,
      promptProfile: englishGrammarSubject.prompts,
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")!.content;
    expect(system).toContain("lesson_open_answer.prompt may be a translation source in the prompt language");
    expect(system).toContain("For lesson_open_answer, prompt is the source sentence in the prompt language to translate");
    expect(system).toContain("answer and acceptedAnswers always use the answer language");
    expect(system).not.toContain("prompt (in the answer language)");
  });

  it("tłumaczy examples z tablicy par {objectiveId, examples} z strict schema na record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          exercises: [],
          examples: [
            { objectiveId: "english_grammar.present_simple.third_person_s", examples: ["He plays.", "She runs."] },
            { objectiveId: "other.objective", examples: ["X."] },
          ],
        }),
      ),
    );
    const provider = createOpenAiLlmProvider({ apiKey: "k" });
    const result = await provider.generateLessonPool(INPUT);
    expect(result.examples).toEqual({
      "english_grammar.present_simple.third_person_s": ["He plays.", "She runs."],
      "other.objective": ["X."],
    });
  });
});

describe("createOpenAiLlmProvider.generateDeck — tryb zestawu", () => {
  it("w trybie obrazkowym wymaga konkretnych znaczeń bez zależności od tekstu", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await createOpenAiLlmProvider({ apiKey: "k" }).generateDeck({
      prompt: "kolory i liczby",
      sourceLocale: "pl-PL",
      targetLocale: "en-GB",
      maxItems: 10,
      vocabularyFormat: "picture",
    } as LlmGenerateDeckInput);

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")!.content;
    expect(system).toContain("Picture vocabulary");
    expect(system).toContain("concrete");
    expect(system).toContain("Do not include abstract concepts");
    expect(system).toContain("image, color, or number");
    expect(system).toContain("omit none and sequence");
  });
});
