import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createAuthoredLesson,
  createProductionSubjectRegistry,
  createServices,
  getLearningOverview,
  issueIntegrationToken,
  publishLessonDraft,
  revokeIntegrationToken,
  type IntegrationScope,
  type Services,
} from "@learning/server";
import {
  LessonAuthoringDraftDtoSchema,
  LessonCatalogDtoSchema,
  LessonDraftWriteResultSchema,
  LessonValidateResultSchema,
  type LessonExerciseInput,
} from "@learning/contracts";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import { createLearningMcpDependencies, handleLearningMcpRequest } from "../../apps/web/src/integrations/learning-mcp-route";
import { IntegrationReadLimiter } from "../../apps/web/src/integrations/integration-read-limiter";

/**
 * Lekcje pisane przez agenta przez MCP (`docs/integrations/lesson-authoring.md`): klient Streamable HTTP na fikcyjnych
 * danych przez prawdziwą trasę `/api/mcp`, docelowy PostgreSQL, fake TTS. Wiersze macierzy I/O.
 */

const { db, pool } = testDatabase();
const cleanup: Array<() => Promise<void>> = [];

const AFFIRMATIVE = "english_grammar.present_continuous.affirmative";

const choice = (stem: string, correct: string, wrong: string): LessonExerciseInput => ({
  exerciseType: "lesson_choice", objectiveId: AFFIRMATIVE, instructionPl: "Wybierz dobrą formę.", stem,
  options: [{ id: "a", text: correct }, { id: "b", text: wrong }], correctOption: "a", answer: correct, acceptedAnswers: [], focus: correct.split(" "),
});
const gap = (stem: string, answer: string): LessonExerciseInput => ({
  exerciseType: "lesson_gap", objectiveId: AFFIRMATIVE, instructionPl: "Uzupełnij zdanie.", stem, answer, acceptedAnswers: [], focus: answer.split(" "),
});
const errorFix = (statement: string, answer: string, focus: string[]): LessonExerciseInput => ({
  exerciseType: "lesson_error_fix", objectiveId: AFFIRMATIVE, instructionPl: "Popraw błąd w zdaniu.", statement, answer, acceptedAnswers: [], focus,
});
const translation = (prompt: string, answer: string, focus: string[]): LessonExerciseInput => ({
  exerciseType: "lesson_open_answer", objectiveId: AFFIRMATIVE, instructionPl: "Przetłumacz na angielski.", prompt, answer,
  acceptedAnswers: / now\.$/.test(answer) ? ["right now", "at the moment"].map((marker) => answer.replace(/ now\.$/, ` ${marker}.`)) : [], focus,
});

/** Pula jednego zagadnienia: 3 prowadzone, 4 produktywne, 3 samodzielne (jak `lesson-present-continuous.test.ts`). */
const EXERCISES: LessonExerciseInput[] = [
  choice("The dogs ___ in the park now.", "are walking", "is walking"),
  choice("Look! Mum ___ dinner.", "is cooking", "are cooking"),
  {
    exerciseType: "lesson_order", objectiveId: AFFIRMATIVE, instructionPl: "Ułóż zdanie.",
    items: [{ id: "i1", text: "Kasia" }, { id: "i2", text: "is" }, { id: "i3", text: "reading" }, { id: "i4", text: "a book" }],
    answer: "Kasia is reading a book", acceptedAnswers: [], focus: ["is", "reading"],
  },
  gap("Tom ___ (play) football in the garden now.", "is playing"),
  gap("The children ___ (paint) in the classroom now.", "are painting"),
  errorFix("Grandma sleeping on the sofa now.", "Grandma is sleeping on the sofa now.", ["is"]),
  errorFix("Look! The cats is jumping.", "Look! The cats are jumping.", ["are"]),
  translation("Tata teraz myje samochód.", "Dad is washing the car now.", ["is", "washing"]),
  translation("Dzieci teraz rysują w ogrodzie.", "The children are drawing in the garden now.", ["are", "drawing"]),
  translation("Ola teraz pije mleko.", "Ola is drinking milk now.", ["is", "drinking"]),
];

const LESSON = {
  subjectId: "english_grammar",
  topicId: "present_continuous",
  objectiveIds: [AFFIRMATIVE],
  material: "Fikcyjny materiał: Tom is playing football now.",
  examples: { [AFFIRMATIVE]: ["Tom is jumping now.", "The dogs are playing now."] },
  exercises: EXERCISES,
};

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
    learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
    learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`);
});
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
afterAll(() => pool.end());

async function world(): Promise<Services> {
  const fakes = await fakeGeneration();
  cleanup.push(fakes.dispose);
  return createServices({ db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps, subjects: createProductionSubjectRegistry() });
}

async function token(services: Services, scope: IntegrationScope): Promise<string> {
  const secret = `umiem_${randomUUID()}_${randomBytes(32).toString("base64url")}`;
  await issueIntegrationToken(services, `test ${scope}`, secret, scope);
  return secret;
}

async function connect(services: Services, secret: string): Promise<Client> {
  const deps = {
    ...createLearningMcpDependencies(services, new Set()),
    limiter: new IntegrationReadLimiter(),
    writeLimiter: new IntegrationReadLimiter(10, 3_600_000),
    requestId: () => randomUUID(),
  };
  const client = new Client({ name: "lesson-authoring-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://integration.local/api/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${secret}` } },
    fetch: async (input, init) => handleLearningMcpRequest(new Request(input, init), deps),
  });
  await client.connect(transport);
  cleanup.push(async () => { await client.close().catch(() => undefined); });
  return client;
}

type ToolResult = { isError?: boolean; structuredContent?: unknown; content?: unknown };

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return client.callTool({ name, arguments: args }) as Promise<ToolResult>;
}

function toolErrorOf(result: ToolResult): { code: string; message: string; retryable: boolean; details?: Record<string, unknown> } {
  expect(result.isError).toBe(true);
  return JSON.parse((result.content as { text: string }[])[0]!.text);
}

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  return (await pool.query<{ n: number }>(sql, params)).rows[0]!.n;
}

describe("lekcje pisane przez agenta przez MCP", () => {
  it("katalog → walidacja → utworzenie → stan spełniają outputSchema; szkic w review z nagraniami, bez runu, publikowalny przez rodzica", async () => {
    const services = await world();
    const client = await connect(services, await token(services, "lessons:write"));

    expect((await client.listTools()).tools.map(({ name }) => name).sort())
      .toEqual(["lesson_catalog", "lesson_draft_create", "lesson_draft_get", "lesson_draft_replace", "lesson_validate"]);

    const catalog = LessonCatalogDtoSchema.parse((await call(client, "lesson_catalog", { subjectId: "english_grammar", topicId: "present_continuous" })).structuredContent);
    const affirmative = catalog.objectives.find(({ id }) => id === AFFIRMATIVE)!;
    expect(affirmative.examplesRequired).toBe(true);
    expect(affirmative.rules.types.length).toBeGreaterThan(0);
    expect(affirmative.exerciseTypes).not.toContain("lesson_card");
    expect(catalog.story.enabled).toBe(true);
    expect(catalog.limits).toEqual({ maxExercises: 150, maxRequestBytes: 512 * 1024, writesPerHour: 10 });

    const dryRun = LessonValidateResultSchema.parse((await call(client, "lesson_validate", LESSON)).structuredContent);
    expect(dryRun).toEqual({ ok: true, exercises: [], coverage: [], exposureLeaks: [], story: [] });
    expect(await countRows("select count(*)::int as n from learning_app.decks")).toBe(0);

    const clientRequestId = randomUUID();
    const created = LessonDraftWriteResultSchema.parse((await call(client, "lesson_draft_create", { ...LESSON, clientRequestId })).structuredContent);
    expect(created).toMatchObject({ deckId: clientRequestId, editNumber: 1, coverage: [], exposureLeaks: [] });
    const replay = LessonDraftWriteResultSchema.parse((await call(client, "lesson_draft_create", { ...LESSON, clientRequestId })).structuredContent);
    expect(replay).toEqual(created);

    const version = (await pool.query<{ state: string; lesson_context: Record<string, unknown> }>(
      "select state, lesson_context from learning_app.deck_versions where deck_id = $1", [clientRequestId],
    )).rows;
    expect(version).toHaveLength(1);
    expect(version[0]!.state).toBe("review");
    expect(version[0]!.lesson_context).toMatchObject({ poolSize: EXERCISES.length, examples: LESSON.examples });
    expect(await countRows("select count(*)::int as n from learning_app.generation_runs where deck_version_id = $1", [created.draftId])).toBe(0);
    // Nagrania zlecone w transakcji zapisu (zdania po odpowiedzi gramatyki).
    expect(await countRows(
      `select count(*)::int as n from learning_app.revision_assets ra join learning_app.item_revisions ir on ir.id = ra.item_revision_id
        where ir.deck_version_id = $1 and ra.asset_id is not null`, [created.draftId],
    )).toBeGreaterThan(0);

    const state = await call(client, "lesson_draft_get", { deckId: clientRequestId });
    const draft = LessonAuthoringDraftDtoSchema.parse(state.structuredContent);
    expect(draft).toMatchObject({ status: "review", editNumber: 1, objectiveIds: [AFFIRMATIVE], coverage: [], exposureLeaks: [] });
    expect(draft.exercises.map(({ answer }) => answer)).toEqual(EXERCISES.map(({ answer }) => answer));
    expect(JSON.stringify(state)).not.toMatch(/interests|assignments|revisionId|promptAudio/);

    await expect(publishLessonDraft(services, draft.draftId, draft.editNumber)).resolves.toEqual({ deckVersionId: draft.draftId });
  });

  it("ujawnienie zdania z karty liczy się w walidacji, także gdy przykłady go nie zawierają", async () => {
    const services = await world();
    const client = await connect(services, await token(services, "lessons:write"));
    // Karta „Co się dzieje?” zagadnienia zawiera zdanie „Tom is jumping.”.
    const leaking = [...EXERCISES, translation("Tomek skacze.", "Tom is jumping.", ["is", "jumping"])];
    const result = LessonValidateResultSchema.parse((await call(client, "lesson_validate", { ...LESSON, exercises: leaking })).structuredContent);
    expect(result.exposureLeaks).toContainEqual({ index: EXERCISES.length, kind: "hard", source: { kind: "card_example", objectiveId: AFFIRMATIVE } });
  });

  it("błędne zadania i niedozwolone pola dają validation bez zapisu; cudzy zestaw o tym id daje conflict", async () => {
    const services = await world();
    const client = await connect(services, await token(services, "lessons:write"));

    const broken = [...EXERCISES];
    broken[3] = { ...broken[3]!, focus: ["football"] };
    const rejected = toolErrorOf(await call(client, "lesson_draft_create", { ...LESSON, exercises: broken, clientRequestId: randomUUID() }));
    expect(rejected.code).toBe("validation");
    const issues = (rejected.details as { exercises: { index: number; issues: { rule: string; field: string; pl: string }[] }[] }).exercises;
    expect(issues.map(({ index }) => index)).toEqual([3]);
    expect(issues[0]!.issues[0]).toMatchObject({ rule: expect.any(String), field: "focus", pl: expect.any(String) });

    const withInterests = toolErrorOf(await call(client, "lesson_draft_create", { ...LESSON, interests: ["dinozaury"], clientRequestId: randomUUID() }));
    expect(withInterests.code).toBe("validation");
    expect(JSON.stringify(withInterests.details)).toContain("interests");

    // Macierz „Za dużo”: ponad 150 zadań to `validation` w formacie narzędzi, nie tekst SDK.
    const tooMany = Array.from({ length: 151 }, () => EXERCISES[0]!);
    expect(toolErrorOf(await call(client, "lesson_draft_create", { ...LESSON, exercises: tooMany, clientRequestId: randomUUID() })))
      .toMatchObject({ code: "validation", details: { issues: [expect.objectContaining({ path: "exercises" })] } });

    const missingExamples = toolErrorOf(await call(client, "lesson_draft_create", { ...LESSON, examples: {}, clientRequestId: randomUUID() }));
    expect(missingExamples).toMatchObject({ code: "validation", details: { examples: { missing: [AFFIRMATIVE], unknown: [] } } });
    expect(await countRows("select count(*)::int as n from learning_app.decks")).toBe(0);

    const vocabularyId = randomUUID();
    await pool.query("insert into learning_app.decks (id, title, kind) values ($1, 'Fikcyjne słówka', 'vocabulary')", [vocabularyId]);
    expect(toolErrorOf(await call(client, "lesson_draft_create", { ...LESSON, clientRequestId: vocabularyId })).code).toBe("conflict");
  });

  it("poprawka opublikowanego zestawu jest atomowa, zachowuje id zadań i sprawdza numer edycji", async () => {
    const services = await world();
    const secret = await token(services, "lessons:write");
    const client = await connect(services, secret);
    const deckId = randomUUID();
    const created = LessonDraftWriteResultSchema.parse((await call(client, "lesson_draft_create", { ...LESSON, clientRequestId: deckId })).structuredContent);
    await publishLessonDraft(services, created.draftId, created.editNumber);

    const published = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
    expect(published.status).toBe("published");
    const kept = published.exercises;

    // Błąd zadania: brak szkicu po odrzuceniu (kopia z opublikowanej wycofana razem z edycją).
    const invalid = kept.map((exercise, index) => (index === 3 ? { ...exercise, focus: ["football"] } : exercise));
    const failed = toolErrorOf(await call(client, "lesson_draft_replace", { deckId, expectedEditNumber: published.editNumber, exercises: invalid }));
    expect(failed.code).toBe("validation");
    expect(await countRows("select count(*)::int as n from learning_app.deck_versions where deck_id = $1", [deckId])).toBe(1);

    expect(toolErrorOf(await call(client, "lesson_draft_replace", { deckId, expectedEditNumber: published.editNumber + 1, exercises: kept })).code).toBe("conflict");

    const added = translation("Mama teraz śpiewa.", "Mum is singing now.", ["is", "singing"]);
    const replaced = LessonDraftWriteResultSchema.parse((await call(client, "lesson_draft_replace", {
      deckId, expectedEditNumber: published.editNumber, exercises: [...kept, added], title: "Fikcyjna lekcja",
    })).structuredContent);
    expect(replaced.draftId).not.toBe(published.draftId);
    expect(replaced.editNumber).toBe(2);

    const draft = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
    expect(draft).toMatchObject({ status: "draft", title: "Fikcyjna lekcja", editNumber: 2 });
    expect(draft.exercises.slice(0, kept.length).map(({ id }) => id)).toEqual(kept.map(({ id }) => id));
    expect(kept.map(({ id }) => id)).not.toContain(draft.exercises.at(-1)!.id);

    expect(toolErrorOf(await call(client, "lesson_draft_replace", { deckId, expectedEditNumber: 1, exercises: kept })).code).toBe("conflict");
  });

  it("run generowania w toku daje conflict i zostaje nietknięty", async () => {
    const services = await world();
    const client = await connect(services, await token(services, "lessons:write"));
    const deckId = randomUUID();
    const created = LessonDraftWriteResultSchema.parse((await call(client, "lesson_draft_create", { ...LESSON, clientRequestId: deckId })).structuredContent);
    const runId = randomUUID();
    await pool.query(
      `insert into learning_app.generation_runs (id, deck_version_id, expected_edit_number, kind, dedupe_key, state, input)
       values ($1, $2, 1, 'lesson', $3, 'queued', '{}'::jsonb)`,
      [runId, created.draftId, `lesson:${runId}`],
    );
    const draft = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
    const result = toolErrorOf(await call(client, "lesson_draft_replace", { deckId, expectedEditNumber: draft.editNumber, exercises: draft.exercises }));
    expect(result.code).toBe("conflict");
    expect((await pool.query("select state from learning_app.generation_runs where id = $1", [runId])).rows[0]).toEqual({ state: "queued" });
  });

  it("zakresy: learning:read nie widzi narzędzi autorskich, lessons:write nie czyta postępów, zapis sprawdza token ponownie", async () => {
    const services = await world();
    const reader = await token(services, "learning:read");
    const writer = await token(services, "lessons:write");

    const readClient = await connect(services, reader);
    expect((await readClient.listTools()).tools.map(({ name }) => name)).toEqual(["umiem_get_learning_overview"]);
    await expect(readClient.callTool({ name: "lesson_catalog", arguments: { subjectId: "english_grammar", topicId: "present_continuous" } })).rejects.toThrow();

    const writeClient = await connect(services, writer);
    await expect(writeClient.callTool({ name: "umiem_get_learning_overview", arguments: {} })).rejects.toThrow();
    await expect(getLearningOverview(services, { days: 7, upcomingTestDays: 14 }, writer)).rejects.toMatchObject({ code: "forbidden" });

    const input = { ...LESSON, clientRequestId: randomUUID() };
    await expect(createAuthoredLesson(services, reader, input)).rejects.toMatchObject({ code: "forbidden" });
    await revokeIntegrationToken(services, writer.split("_")[1]!);
    await expect(createAuthoredLesson(services, writer, input)).rejects.toMatchObject({ code: "unauthorized" });
    expect(await countRows("select count(*)::int as n from learning_app.decks")).toBe(0);
  });

  it("baza nie przyjmuje tokenu bez zakresu ani z dwoma zakresami", async () => {
    const services = await world();
    const secret = await token(services, "lessons:write");
    const id = secret.split("_")[1]!;
    for (const scopes of ["{}", "{learning:read,lessons:write}", "{admin}"]) {
      await expect(pool.query("update learning_app.integration_tokens set scopes = $2::text[] where id = $1", [id, scopes])).rejects.toThrow();
    }
  });

  it("walidacja z deckId przyjmuje id zadań zestawu i odrzuca niezgodne zagadnienia lub obce id", async () => {
    const services = await world();
    const client = await connect(services, await token(services, "lessons:write"));
    const deckId = randomUUID();
    await call(client, "lesson_draft_create", { ...LESSON, clientRequestId: deckId });
    const draft = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);

    const sameLesson = LessonValidateResultSchema.parse((await call(client, "lesson_validate", { deckId, exercises: draft.exercises })).structuredContent);
    expect(sameLesson).toMatchObject({ ok: true, exercises: [], exposureLeaks: [] });

    const otherObjectives = await call(client, "lesson_validate", {
      deckId, objectiveIds: ["english_grammar.present_continuous.negative"], exercises: draft.exercises,
    });
    expect(toolErrorOf(otherObjectives).code).toBe("validation");
    const foreignId = await call(client, "lesson_validate", { deckId, exercises: [{ ...draft.exercises[0]!, id: randomUUID() }, ...draft.exercises.slice(1)] });
    expect(toolErrorOf(foreignId)).toMatchObject({ code: "validation", details: { unknownIds: [expect.any(String)] } });
  });

  it("historyjka: utworzenie z historyjką, poprawka z story: null ją usuwa; powtórzone id i zestaw zarchiwizowany dają validation", async () => {
    const services = await world();
    const client = await connect(services, await token(services, "lessons:write"));
    const deckId = randomUUID();
    const story = {
      sentences: ["Sam has a red bike.", "He rides it to school.", "His sister walks.", "They meet at the park."],
      questions: [{ id: "q1", question: "Jaki rower ma Sam?", options: [{ id: "a", text: "niebieski" }, { id: "b", text: "czerwony" }, { id: "c", text: "zielony" }], correctOption: "b" }],
    };
    const created = LessonDraftWriteResultSchema.parse((await call(client, "lesson_draft_create", { ...LESSON, story, clientRequestId: deckId })).structuredContent);
    const withStory = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
    expect(withStory.story).toEqual(story);

    const duplicated = [...withStory.exercises, withStory.exercises[0]!];
    expect(toolErrorOf(await call(client, "lesson_draft_replace", { deckId, expectedEditNumber: created.editNumber, exercises: duplicated })).code).toBe("validation");

    const removed = LessonDraftWriteResultSchema.parse((await call(client, "lesson_draft_replace", {
      deckId, expectedEditNumber: created.editNumber, exercises: withStory.exercises, story: null,
    })).structuredContent);
    const withoutStory = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
    expect(withoutStory.story).toBeUndefined();

    await pool.query("update learning_app.decks set archived_at = now() where id = $1", [deckId]);
    const archived = await call(client, "lesson_draft_replace", { deckId, expectedEditNumber: removed.editNumber, exercises: withoutStory.exercises });
    expect(toolErrorOf(archived).code).toBe("validation");
  });
});
