import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiLlmProvider } from "./llm";
import type { LessonPoolInput } from "../../ports/ai";

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
});

describe("createOpenAiLlmProvider.generateLessonPool — składanie promptu", () => {
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
        exercises: { items: { additionalProperties: boolean; required: string[]; properties: { exerciseType: { enum: string[] } } } };
        examples: { type: string };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    const exercise = schema.properties.exercises.items;
    expect(exercise.additionalProperties).toBe(false);
    // Enum typów wyłącznie z danych wejścia, BEZ typów niepulowych (lesson_card
    // wydaje silnik deterministycznie, walidacja puli zawsze by go odrzuciła).
    expect(exercise.properties.exerciseType.enum).toEqual(["lesson_choice", "lesson_gap", "lesson_open_answer"]);
    // Wszystkie pola ćwiczenia dokładnie w required (strict mode, opcjonalne jako nullable).
    expect([...exercise.required].sort()).toEqual(
      [...Object.keys(exercise.properties)].sort(),
    );
    // examples jako tablica par (strict mode nie wspiera dowolnych kluczy mapy).
    expect(schema.properties.examples.type).toBe("array");

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
    expect(system).toContain("2 to 4 options");
    expect(system).toContain("correctOption must be the id of exactly one of the options");

    // Doprecyzowana semantyka pól (incydent deepseek 2026-10-13: polskie słowa
    // z materiału w hint; warianty acceptedAnswers różniące się tylko wielkością
    // liter). Każde zdanie odpowiada konkretnej regule pool-validation.
    expect(system).toContain("Field rules for this subject:");
    expect(system).toContain("For lesson_gap, hint must be the base form of the verb.");
    expect(system).toContain("Language discipline:");
    expect(system).toContain("never copy prompt-language words from the parent material into answer-language fields");
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
