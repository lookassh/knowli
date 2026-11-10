import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createAuthoredLesson,
  createProductionSubjectRegistry,
  createServices,
  editLessonDraft,
  getLearningOverview,
  issueIntegrationToken,
  publishLessonDraft,
  readDeck,
  readLessonDeck,
  revokeIntegrationToken,
  runDueGenerationWork,
  type IntegrationScope,
  type Services,
} from "@learning/server";
import {
  LessonAuthoringDraftDtoSchema,
  DeckDraftWriteResultSchema,
  LessonCatalogDtoSchema,
  LessonDraftAppendResultSchema,
  LessonDraftWriteResultSchema,
  LessonValidateResultSchema,
  MaterialListResultSchema,
  SourceMaterialDtoSchema,
  VocabularyDeckDtoSchema,
  type LessonExerciseInput,
} from "@learning/contracts";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import { seedSchoolDraft } from "./school-lesson-audio-helpers";
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
      .toEqual(["lesson_catalog", "lesson_draft_append", "lesson_draft_create", "lesson_draft_get", "lesson_draft_replace", "lesson_validate"]);

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

  it("run historyjki w toku nie blokuje dodania zadania i zostaje w kolejce; poprawka z historyjką go unieważnia", async () => {
    const services = await world();
    const client = await connect(services, await token(services, "lessons:write"));
    const deckId = randomUUID();
    const created = LessonDraftWriteResultSchema.parse((await call(client, "lesson_draft_create", { ...LESSON, clientRequestId: deckId })).structuredContent);
    // Run historyjki zlecany po każdej udanej generacji lekcji (`input.purpose = "story"`):
    // edycja ćwiczeń go nie przerywa, więc nie może blokować dodawania zadań przez MCP.
    const storyRunId = randomUUID();
    await pool.query(
      `insert into learning_app.generation_runs (id, deck_version_id, expected_edit_number, kind, dedupe_key, state, input)
       values ($1, $2, 1, 'lesson', $3, 'queued', '{"purpose":"story"}'::jsonb)`,
      [storyRunId, created.draftId, `lesson-story:${storyRunId}`],
    );
    const draft = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
    const added = translation("Mama teraz śpiewa.", "Mum is singing now.", ["is", "singing"]);
    const replaced = LessonDraftWriteResultSchema.parse((await call(client, "lesson_draft_replace", {
      deckId, expectedEditNumber: draft.editNumber, exercises: [...draft.exercises, added],
    })).structuredContent);
    expect(replaced.editNumber).toBe(draft.editNumber + 1);
    const after = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
    expect(after.exercises).toHaveLength(EXERCISES.length + 1);
    expect(after.exercises.at(-1)?.answer).toBe("Mum is singing now.");
    expect((await pool.query("select state from learning_app.generation_runs where id = $1", [storyRunId])).rows[0]).toEqual({ state: "queued" });

    // Poprawka z polem `story` to świadomy wybór historyjki: run w toku zostaje unieważniony jak przy edycji rodzica.
    const story = {
      sentences: ["Sam has a red bike.", "He rides it to school.", "His sister walks.", "They meet at the park."],
      questions: [{ id: "q1", question: "Jaki rower ma Sam?", options: [{ id: "a", text: "niebieski" }, { id: "b", text: "czerwony" }, { id: "c", text: "zielony" }], correctOption: "b" }],
    };
    await call(client, "lesson_draft_replace", { deckId, expectedEditNumber: replaced.editNumber, exercises: after.exercises, story });
    expect((await pool.query("select state from learning_app.generation_runs where id = $1", [storyRunId])).rows[0]).toEqual({ state: "superseded" });
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
    for (const scopes of ["{}", "{learning:read,lessons:write}", "{materials:write,materials:publish}", "{lessons:write,materials:write}", "{admin}"]) {
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

  describe("lekcja szkolna z materiału rodzica", () => {
    const [SPIDERS, INSECTS, QUOTE] = ["school.ddeck000.pajaki", "school.ddeck000.owady", "Pająk ma osiem nóg i nie jest owadem."];
    const sourceRefs = [{ quote: QUOTE }];
    const schoolChoice = (objectiveId: string, n: number): LessonExerciseInput => ({
      exerciseType: "lesson_choice", objectiveId, instructionPl: "Wybierz odpowiedź.", stem: `Wybierz liczbę ${n}.`, answer: `liczba ${n}`, acceptedAnswers: [],
      focus: [`liczba ${n}`], options: [{ id: "a", text: `liczba ${n}` }, { id: "b", text: "żadna" }], correctOption: "a", sourceRefs,
    });
    const schoolGap = (objectiveId: string, n: number): LessonExerciseInput => ({
      exerciseType: "lesson_gap", objectiveId, instructionPl: "Uzupełnij.", stem: `Pająk numer ${n} ma ___ nóg.`, answer: `osiem ${n}`, acceptedAnswers: [], focus: [`osiem ${n}`], sourceRefs,
    });
    const schoolOpen = (objectiveId: string, n: number): LessonExerciseInput => ({
      exerciseType: "lesson_open_answer", objectiveId, instructionPl: "Wyjaśnij.", prompt: `Wyjaśnij zasadę ${n}.`, answer: `Zasada ${n}: pająk ma osiem nóg.`, acceptedAnswers: [`Reguła ${n}`],
      focus: [`Zasada ${n}`], questionType: "definition", expectedForm: "explanation", requiredElements: [{ id: "e1", text: `zasada ${n}` }],
      supplementaryElements: ["nie jest owadem"], commonErrors: ["sześć nóg"], sourceRefs,
    });
    /** 79 zadań dwóch zagadnień: pula publikowalna (3 prowadzone, 2 produktywne, 2 samodzielne na zagadnienie) i dopełnienie wyborami. */
    const POOL: LessonExerciseInput[] = [SPIDERS, INSECTS].flatMap((objectiveId, o) => [
      ...[1, 2, 3].map((n) => schoolChoice(objectiveId, o * 100 + n)),
      ...[1, 2].map((n) => schoolGap(objectiveId, o * 100 + n)),
      ...[1, 2].map((n) => schoolOpen(objectiveId, o * 100 + n)),
    ]).concat(Array.from({ length: 65 }, (_, n) => schoolChoice(SPIDERS, 1000 + n)));

    async function schoolLesson() {
      const services = await world();
      const seeded = await seedSchoolDraft([SPIDERS, INSECTS].map((id, index) => ({
        id, titlePl: index === 0 ? "Pająki" : "Owady", descriptionEn: "Fictional objective.", cards: [{ title: "Karta", body: "Pająk ma osiem nóg." }],
      })));
      const draft = await editLessonDraft(services, seeded.versionId, { expectedEditNumber: 1, exercises: POOL });
      return { services, ...seeded, editNumber: draft.editNumber };
    }
    const added = schoolOpen(INSECTS, 777);
    /** Tożsamość zapisanych zadań wersji: rewizje, klucze umiejętności i powiązane nagrania (historia dziecka trzyma się `skill_version`). */
    const identity = async (versionId: string) => (await pool.query(
      `select ir.item_id, ir.id as revision_id, ir.payload, irs.skill_version_id,
              (select array_agg(ra.asset_id order by ra.role) from learning_app.revision_assets ra where ra.item_revision_id = ir.id) as assets
         from learning_app.item_revisions ir join learning_app.item_revision_skills irs on irs.item_revision_id = ir.id
        where ir.deck_version_id = $1 order by ir.position`, [versionId],
    )).rows;
    const mediaCount = () => countRows("select count(*)::int as n from learning_app.media_assets");

    it("odczyt 79 zadań z materiałem i zagadnieniami, walidacja i dopisanie jednego: 80 zadań, stare id bez zmian, treść w panelu, nagranie zlecone", async () => {
      const { services, deckId, versionId, editNumber } = await schoolLesson();
      const client = await connect(services, await token(services, "lessons:write"));

      const catalog = LessonCatalogDtoSchema.parse((await call(client, "lesson_catalog", { deckId })).structuredContent);
      expect(catalog).toMatchObject({ subjectId: "school", subjectTitlePl: "Przyroda", topicTitlePl: "Pająki" });
      expect(catalog.objectives.map(({ id }) => id)).toEqual([SPIDERS, INSECTS]);
      expect(JSON.stringify(catalog.objectives[0]!.rules)).toContain("school.quote_in_material");
      const narrowed = LessonCatalogDtoSchema.parse((await call(client, "lesson_catalog", { deckId, objectiveIds: [INSECTS] })).structuredContent);
      expect(narrowed.objectives.map(({ id }) => id)).toEqual([INSECTS]);
      expect(toolErrorOf(await call(client, "lesson_catalog", { deckId, subjectId: "school" })).code).toBe("validation");
      expect(toolErrorOf(await call(client, "lesson_catalog", { subjectId: "school", topicId: "dynamic" })).code).toBe("validation");

      const before = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
      expect(before.exercises).toHaveLength(79);
      expect(before).toMatchObject({ subjectId: "school", subjectTitlePl: "Przyroda", editNumber, objectiveIds: [SPIDERS, INSECTS] });
      expect(before.material).toContain(QUOTE);
      expect(before.objectives).toEqual([SPIDERS, INSECTS].map((id, index) => ({
        id, titlePl: index === 0 ? "Pająki" : "Owady", cards: [{ title: "Karta", body: "Pająk ma osiem nóg." }],
        exerciseTypes: expect.arrayContaining(["lesson_choice", "lesson_open_answer", "lesson_keywords"]),
      })));
      expect(before.objectives[0]!.exerciseTypes).not.toContain("lesson_card");
      // Pełne zadanie: klucz, warianty, kryteria i źródła wracają bez utraty pól.
      const { id: _id, ...storedOpen } = before.exercises.find(({ prompt }) => prompt === "Wyjaśnij zasadę 1.")!;
      expect(storedOpen).toEqual(schoolOpen(SPIDERS, 1));

      const [storedBefore, mediaBefore] = [await identity(versionId), await mediaCount()];
      const dryRun = LessonValidateResultSchema.parse((await call(client, "lesson_validate", { deckId, append: true, exercises: [added] })).structuredContent);
      expect(dryRun).toMatchObject({ ok: true, exercises: [], coverage: [], exposureLeaks: [], firstNewIndex: 79 });
      // Walidacja na sucho nie zapisuje i nie zleca nagrań.
      expect(await mediaCount()).toBe(mediaBefore);
      expect(await identity(versionId)).toEqual(storedBefore);
      expect(await countRows("select count(*)::int as n from learning_app.item_revisions where deck_version_id = $1", [versionId])).toBe(79);
      expect(await countRows("select edit_number as n from learning_app.deck_versions where id = $1", [versionId])).toBe(editNumber);

      const result = LessonDraftAppendResultSchema.parse((await call(client, "lesson_draft_append", { deckId, expectedEditNumber: editNumber, exercises: [added] })).structuredContent);
      expect(result).toMatchObject({ deckId, draftId: versionId, editNumber: editNumber + 1 });

      const after = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
      expect(after.exercises).toHaveLength(80);
      expect(after.exercises.slice(0, 79)).toEqual(before.exercises);
      expect(after.exercises[79]).toEqual({ ...added, id: result.exerciseIds[0] });
      // Historia: 79 zapisanych zadań ma te same rewizje, klucze umiejętności i nagrania; doszło tylko nagranie nowego pytania.
      expect((await identity(versionId)).slice(0, 79)).toEqual(storedBefore);
      expect(await mediaCount()).toBe(mediaBefore + 1);
      expect(toolErrorOf(await call(client, "lesson_draft_append", { deckId, expectedEditNumber: editNumber, exercises: [schoolOpen(INSECTS, 778)] })).code).toBe("conflict");

      // Panel rodzica czyta ten sam szkic.
      const panel = (await readLessonDeck(services, deckId)).draft!;
      expect(panel.exercises).toHaveLength(80);
      expect(panel.exercises.at(-1)).toMatchObject({ id: result.exerciseIds[0], prompt: added.prompt, answer: added.answer });
      // Brakujące nagranie pytania nowego zadania zlecone istniejącym mechanizmem w transakcji zapisu.
      expect(await countRows(
        `select count(*)::int as n from learning_app.revision_assets ra join learning_app.item_revisions ir on ir.id = ra.item_revision_id
          where ir.item_id = $1 and ra.role = 'prompt_audio' and ra.asset_id is not null`, [result.exerciseIds[0]],
      )).toBe(1);

      // Odesłanie całej puli z odczytu niczego nie gubi i nie zmienia id.
      await call(client, "lesson_draft_replace", { deckId, expectedEditNumber: after.editNumber, exercises: after.exercises });
      const roundTrip = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
      expect(roundTrip.exercises).toEqual(after.exercises);
      expect(roundTrip.editNumber).toBe(after.editNumber + 1);
      expect((await identity(versionId)).slice(0, 79)).toEqual(storedBefore);
    });

    it("run generowania puli blokuje dopisanie, run historyjki nie; ponad limit zadań daje validation", async () => {
      const { services, deckId, versionId, editNumber } = await schoolLesson();
      const client = await connect(services, await token(services, "lessons:write"));
      const run = async (input: string) => {
        const id = randomUUID();
        await pool.query(
          `insert into learning_app.generation_runs (id, deck_version_id, expected_edit_number, kind, dedupe_key, state, input)
           values ($1, $2, $3, 'lesson', $4, 'queued', $5::jsonb)`, [id, versionId, editNumber, `lesson:${id}`, input],
        );
        return id;
      };
      const stateOf = async (id: string) => (await pool.query("select state from learning_app.generation_runs where id = $1", [id])).rows[0].state;
      const append = (exercises: unknown[]) => call(client, "lesson_draft_append", { deckId, expectedEditNumber: editNumber, exercises });

      const tooMany = toolErrorOf(await append(Array.from({ length: 72 }, (_, n) => schoolChoice(INSECTS, 9000 + n))));
      expect(tooMany.code).toBe("validation");

      const poolRun = await run("{}");
      expect(toolErrorOf(await append([added])).code).toBe("conflict");
      expect(await stateOf(poolRun)).toBe("queued");
      expect(await countRows("select count(*)::int as n from learning_app.item_revisions where deck_version_id = $1", [versionId])).toBe(79);

      await pool.query("delete from learning_app.generation_runs where id = $1", [poolRun]);
      const storyRun = await run('{"purpose":"story"}');
      expect(LessonDraftAppendResultSchema.parse((await append([added])).structuredContent).exerciseIds).toHaveLength(1);
      expect(await stateOf(storyRun)).toBe("queued");
    });

    it("błędny cytat, niedozwolony typ, obce zagadnienie, podrobione parentAdded, stary numer edycji i brak uprawnień: błąd bez częściowego zapisu", async () => {
      const { services, deckId, versionId, editNumber } = await schoolLesson();
      const client = await connect(services, await token(services, "lessons:write"));
      const append = (exercises: unknown[], expectedEditNumber = editNumber) => call(client, "lesson_draft_append", { deckId, expectedEditNumber, exercises });
      const mediaBefore = await mediaCount();
      type Details = { exercises: { index: number; issues: { rule: string; field: string }[] }[] };
      const issuesOf = async (exercise: unknown) => {
        const error = toolErrorOf(await append([added, exercise]));
        expect(error.code).toBe("validation");
        return (error.details as Details).exercises;
      };

      const quote = await issuesOf({ ...schoolChoice(SPIDERS, 5000), sourceRefs: [{ quote: "Pająk ma dziesięć nóg i jest owadem." }] });
      expect(quote).toEqual([{ index: 80, issues: [expect.objectContaining({ rule: "school.quote_in_material", field: "sourceRefs[0].quote" })] }]);
      // Ta sama walidacja na sucho: błąd per zadanie i pole, bez wyjątku.
      const dryRun = LessonValidateResultSchema.parse((await call(client, "lesson_validate", {
        deckId, append: true, exercises: [{ ...schoolChoice(SPIDERS, 5000), sourceRefs: [{ quote: "Pająk ma dziesięć nóg i jest owadem." }] }],
      })).structuredContent);
      expect(dryRun).toMatchObject({ ok: false, firstNewIndex: 79, exercises: [{ index: 79, issues: [{ rule: "school.quote_in_material", field: "sourceRefs[0].quote" }] }] });

      const type = await issuesOf({ exerciseType: "lesson_error_fix", objectiveId: SPIDERS, statement: "Pająk ma sześć nóg.", answer: "Pająk ma osiem nóg.", acceptedAnswers: [], focus: ["osiem"], sourceRefs });
      expect(type[0]!.index).toBe(80);
      expect(type[0]!.issues.map(({ rule }) => rule)).toContain("exercise.type_not_allowed");

      const foreign = await issuesOf(schoolChoice("school.ddeck999.inna_lekcja", 5001));
      expect(foreign[0]!.issues.map(({ rule }) => rule)).toContain("exercise.unknown_objective");

      const forged = toolErrorOf(await append([{ ...schoolChoice(SPIDERS, 5002), sourceRefs: [{ quote: "Zmyślony cytat spoza materiału lekcji.", parentAdded: true }] }]));
      expect(forged).toMatchObject({ code: "validation", details: { parentAdded: [79] } });

      // Cytat rodzica zapisanego zadania wolno zachować, ale nie przy zmienionej odpowiedzi.
      await pool.query(
        `update learning_app.item_revisions set payload = jsonb_set(payload, '{sourceRefs}', '[{"quote":"Własne źródło rodzica spoza materiału.","parentAdded":true}]'::jsonb)
          where deck_version_id = $1 and position = 0`, [versionId],
      );
      const stored = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent).exercises;
      expect(stored[0]!.sourceRefs).toEqual([{ quote: "Własne źródło rodzica spoza materiału.", parentAdded: true }]);
      const replace = (first: unknown) => call(client, "lesson_validate", { deckId, exercises: [first, ...stored.slice(1)] });
      expect(LessonValidateResultSchema.parse((await replace(stored[0])).structuredContent).ok).toBe(true);
      expect(toolErrorOf(await replace({ ...stored[0]!, answer: "liczba 999", focus: ["liczba 999"], options: [{ id: "a", text: "liczba 999" }, { id: "b", text: "żadna" }] })))
        .toMatchObject({ code: "validation", details: { parentAdded: [0] } });
      // Przykłady kart zagadnienia usuniętego przez rodzica nie blokują walidacji.
      await pool.query(`update learning_app.deck_versions set lesson_context = jsonb_set(lesson_context, '{examples}', '{"school.ddeck000.usuniete":["Zdanie."]}'::jsonb) where id = $1`, [versionId]);
      expect(LessonValidateResultSchema.parse((await call(client, "lesson_validate", { deckId, append: true, exercises: [added] })).structuredContent).ok).toBe(true);

      expect(toolErrorOf(await append([added], editNumber + 1)).code).toBe("conflict");
      expect(toolErrorOf(await append([{ ...added, id: randomUUID() }])).code).toBe("validation");

      const reader = await connect(services, await token(services, "learning:read"));
      await expect(call(reader, "lesson_draft_append", { deckId, expectedEditNumber: editNumber, exercises: [added] })).rejects.toThrow(/403|Forbidden/);

      expect(await countRows("select count(*)::int as n from learning_app.item_revisions where deck_version_id = $1", [versionId])).toBe(79);
      expect(await countRows("select edit_number as n from learning_app.deck_versions where id = $1", [versionId])).toBe(editNumber);
      expect(await countRows("select count(*)::int as n from learning_app.learning_items where deck_id = $1", [deckId])).toBe(79);
      expect(await mediaCount()).toBe(mediaBefore);
    });

    it("dopisanie do opublikowanej lekcji tworzy szkic w tej samej transakcji; wersja opublikowana zostaje bez zmian", async () => {
      const { services, deckId, versionId, editNumber } = await schoolLesson();
      await publishLessonDraft(services, versionId, editNumber);
      const client = await connect(services, await token(services, "lessons:write"));
      const published = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
      expect(published.status).toBe("published");
      const publishedBefore = await identity(versionId);

      // Błąd reguły i stary numer edycji: brak szkicu.
      expect(toolErrorOf(await call(client, "lesson_draft_append", { deckId, expectedEditNumber: published.editNumber, exercises: [{ ...added, sourceRefs: [{ quote: "Cytat, którego nie ma w materiale." }] }] })).code).toBe("validation");
      expect(toolErrorOf(await call(client, "lesson_draft_append", { deckId, expectedEditNumber: published.editNumber + 1, exercises: [added] })).code).toBe("conflict");
      expect(await countRows("select count(*)::int as n from learning_app.deck_versions where deck_id = $1", [deckId])).toBe(1);

      const result = LessonDraftAppendResultSchema.parse((await call(client, "lesson_draft_append", { deckId, expectedEditNumber: published.editNumber, exercises: [added] })).structuredContent);
      expect(result.draftId).not.toBe(versionId);
      const draft = LessonAuthoringDraftDtoSchema.parse((await call(client, "lesson_draft_get", { deckId })).structuredContent);
      expect(draft.status).toBe("draft");
      expect(draft.exercises.slice(0, 79).map(({ id }) => id)).toEqual(published.exercises.map(({ id }) => id));
      expect(draft.exercises).toHaveLength(80);
      // Wersja opublikowana niezmienna: te same rewizje, treść, klucze umiejętności, nagrania i numer edycji.
      expect(await identity(versionId)).toEqual(publishedBefore);
      expect(await countRows("select edit_number as n from learning_app.deck_versions where id = $1", [versionId])).toBe(published.editNumber);
      expect((await readLessonDeck(services, deckId)).published!.exercises).toHaveLength(79);
    });
  });

  describe("materiały: słówka, źródła, nagrania, publikacja", () => {
    const word = (source: string, target: string, acceptedAnswers: string[] = []) =>
      ({ source, target, acceptedAnswers, locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" as const });
    const skillsOf = async (itemId: string) => (await pool.query<{ skill: string; id: string; predecessor_id: string | null }>(
      `select irs.skill, sv.id, sv.predecessor_id from learning_app.item_revision_skills irs
         join learning_app.skill_versions sv on sv.id = irs.skill_version_id where irs.item_id = $1 order by irs.skill`, [itemId],
    )).rows;

    it("zestaw słówek: dopisanie słowa i poprawa wariantu tłumaczenia; zapis w panelu, historia, media, błędy bez częściowego zapisu", async () => {
      const services = await world();
      const client = await connect(services, await token(services, "materials:write"));
      // Schematy wszystkich narzędzi zakresu przechodzą przez prawdziwe `tools/list`.
      expect((await client.listTools()).tools.map(({ name }) => name)).toHaveLength(16);
      const deckId = randomUUID();
      const created = DeckDraftWriteResultSchema.parse((await call(client, "deck_draft_create", { clientRequestId: deckId, title: "Fikcyjne owoce" })).structuredContent);
      expect(created).toMatchObject({ deckId, editNumber: 1, itemIds: [] });
      expect(DeckDraftWriteResultSchema.parse((await call(client, "deck_draft_create", { clientRequestId: deckId })).structuredContent)).toEqual(created);
      const seeded = DeckDraftWriteResultSchema.parse((await call(client, "deck_draft_edit", {
        deckId, expectedEditNumber: 1, items: [word("jabłko", "apple"), word("gruszka", "pear", ["a pear"])],
      })).structuredContent);
      const [appleId, pearId] = seeded.itemIds as [string, string];
      const before = VocabularyDeckDtoSchema.parse((await call(client, "deck_get", { deckId })).structuredContent);
      expect(before.items.map(({ id, target }) => [id, target])).toEqual([[appleId, "apple"], [pearId, "pear"]]);
      const [appleSkills, pearSkills] = [await skillsOf(appleId), await skillsOf(pearId)];

      const listed = await call(client, "material_list", { query: "OWOCE" });
      expect(MaterialListResultSchema.parse(listed.structuredContent).materials).toEqual([
        { deckId, title: "Fikcyjne owoce", kind: "vocabulary", state: "draft", itemCount: 2, draftEditNumber: seeded.editNumber, published: false },
      ]);
      expect(JSON.stringify(listed)).not.toMatch(/assignedChildren|displayName|childId/);

      // Dopisanie słowa i poprawa wariantu istniejącego tłumaczenia jednym zapisem, bez odsyłania reszty.
      const pear = before.items[1]!;
      const edited = DeckDraftWriteResultSchema.parse((await call(client, "deck_draft_edit", {
        deckId, expectedEditNumber: seeded.editNumber, items: [{ ...pear, acceptedAnswers: ["a pear", "pear fruit"] }, word("śliwka", "plum")],
      })).structuredContent);
      expect(edited.editNumber).toBe(seeded.editNumber + 1);
      expect(edited.itemIds[0]).toBe(pearId);
      const plumId = edited.itemIds[1]!;

      // Panel rodzica widzi zapis.
      const panel = (await readDeck(services, deckId)).draft!;
      expect(panel.editNumber).toBe(edited.editNumber);
      expect(panel.items.map(({ id, target, acceptedAnswers }) => [id, target, acceptedAnswers])).toEqual([
        [appleId, "apple", []], [pearId, "pear", ["a pear", "pear fruit"]], [plumId, "plum", []],
      ]);
      // Historia: nietknięte słowo zachowuje klucze umiejętności; zmiana wariantów daje nowe klucze z poprzednikiem (reguła `classifyRevisionImpact`).
      expect(await skillsOf(appleId)).toEqual(appleSkills);
      const pearAfter = await skillsOf(pearId);
      expect(pearAfter.map(({ skill, predecessor_id }) => [skill, predecessor_id])).toEqual(pearSkills.map(({ skill, id }) => [skill, id]));
      // Brakujące nagranie nowego słowa zlecone istniejącym mechanizmem w transakcji zapisu.
      expect(await countRows(
        `select count(*)::int as n from learning_app.revision_assets ra join learning_app.item_revisions ir on ir.id = ra.item_revision_id
          where ir.item_id = $1 and ra.role = 'target_audio' and ra.asset_id is not null`, [plumId],
      )).toBe(1);

      // Błędy bez częściowego zapisu.
      const edit = (args: Record<string, unknown>, expectedEditNumber = edited.editNumber) => call(client, "deck_draft_edit", { deckId, expectedEditNumber, ...args });
      expect(toolErrorOf(await edit({ items: [word("wiśnia", "cherry")] }, seeded.editNumber)).code).toBe("conflict");
      expect(toolErrorOf(await edit({ items: [word("wiśnia", "cherry"), { ...word("x", "y"), id: randomUUID() }] })).code).toBe("validation");
      expect(toolErrorOf(await edit({ items: [{ ...pear, target: "pears" }], remove: [pearId] })).code).toBe("validation");
      expect(toolErrorOf(await edit({ remove: [appleId, pearId, plumId] })).code).toBe("validation");
      expect(toolErrorOf(await edit({ items: [{ ...word("kolor", "red"), visualType: "color", visualData: { color: "not-a-color" } }] })).code).toBe("validation");
      const unchanged = (await readDeck(services, deckId)).draft!;
      expect(unchanged.editNumber).toBe(edited.editNumber);
      expect(unchanged.items.map(({ id }) => id)).toEqual([appleId, pearId, plumId]);

      // Zmiana samego tytułu pustego zestawu i kolizja id z cudzym rodzajem zestawu.
      const emptyId = randomUUID();
      await call(client, "deck_draft_create", { clientRequestId: emptyId });
      expect(DeckDraftWriteResultSchema.parse((await call(client, "deck_draft_edit", { deckId: emptyId, expectedEditNumber: 1, title: "Pusty" })).structuredContent).editNumber).toBe(2);
      // Pozycja innego zestawu i rola nagrania lekcji w zestawie słówek.
      expect(toolErrorOf(await call(client, "recording_regenerate", { deckId: emptyId, target: { kind: "item", itemId: appleId, role: "target_audio" } })).code).toBe("not_found");
      expect(toolErrorOf(await call(client, "recording_regenerate", { deckId, target: { kind: "item", itemId: appleId, role: "prompt_audio" } })).code).toBe("validation");
      expect(toolErrorOf(await call(client, "recording_regenerate", { deckId, target: { kind: "story" } })).code).toBe("validation");

      // Ponowne nagranie w szkicu: nowe ujęcie nagrania słowa.
      const regenerated = (await call(client, "recording_regenerate", { deckId, target: { kind: "item", itemId: appleId, role: "target_audio" } })).structuredContent as { assetId: string };
      expect(regenerated.assetId).toMatch(/^[0-9a-f-]{36}$/);

      const removed = DeckDraftWriteResultSchema.parse((await edit({ remove: [plumId], title: "Owoce" })).structuredContent);
      expect((await readDeck(services, deckId)).draft).toMatchObject({ title: "Owoce", editNumber: removed.editNumber });
      expect((await readDeck(services, deckId)).draft!.items.map(({ id }) => id)).toEqual([appleId, pearId]);

      // Token redagujący nie publikuje ani nie archiwizuje; token samych lekcji nie widzi zestawów słówek; lekcja to nie zestaw słówek.
      await expect(call(client, "material_publish", { deckId, expectedEditNumber: removed.editNumber })).rejects.toThrow(/403|Forbidden/);
      await expect(call(client, "material_archive", { deckId })).rejects.toThrow(/403|Forbidden/);
      const lessonsOnly = await connect(services, await token(services, "lessons:write"));
      await expect(call(lessonsOnly, "deck_get", { deckId })).rejects.toThrow(/403|Forbidden/);
      expect(toolErrorOf(await call(client, "lesson_draft_get", { deckId })).code).toBe("validation");
    });

    it("opublikowany zestaw słówek: publikacja tokenem materials:publish, edycja tworzy szkic, wersja opublikowana bez zmian", async () => {
      const services = await world();
      const editor = await connect(services, await token(services, "materials:write"));
      const publisher = await connect(services, await token(services, "materials:publish"));
      const deckId = randomUUID();
      await call(editor, "deck_draft_create", { clientRequestId: deckId, title: "Fikcyjne warzywa" });
      const seeded = DeckDraftWriteResultSchema.parse((await call(editor, "deck_draft_edit", { deckId, expectedEditNumber: 1, items: [word("marchew", "carrot")] })).structuredContent);
      const publish = () => call(publisher, "material_publish", { deckId, expectedEditNumber: seeded.editNumber });
      // Nagranie jeszcze niegotowe: publikacja odrzucona jak w panelu, bez wersji opublikowanej.
      expect(toolErrorOf(await publish())).toMatchObject({ code: "validation", details: { media: "pending" } });
      expect(await countRows("select count(*)::int as n from learning_app.decks where id = $1 and published_version_id is not null", [deckId])).toBe(0);
      for (let pass = 0; pass < 20; pass += 1) {
        if ((await runDueGenerationWork(services, { lesson: 0, deck: 0, tts: 50, images: 0 })).processed === 0) break;
      }
      expect((await publish()).structuredContent).toEqual({ deckId, deckVersionId: seeded.draftId });
      const rowsOf = async (versionId: string) => (await pool.query(
        "select id, item_id, payload, position from learning_app.item_revisions where deck_version_id = $1 order by position", [versionId],
      )).rows;
      const publishedRows = await rowsOf(seeded.draftId);
      const published = VocabularyDeckDtoSchema.parse((await call(editor, "deck_get", { deckId })).structuredContent);
      expect(published).toMatchObject({ status: "published", draftId: seeded.draftId, recordings: [{ itemId: seeded.itemIds[0], role: "target_audio", state: "approved" }] });

      // Stary numer edycji i błąd walidacji: brak szkicu.
      expect(toolErrorOf(await call(editor, "deck_draft_edit", { deckId, expectedEditNumber: published.editNumber + 1, items: [word("burak", "beetroot")] })).code).toBe("conflict");
      expect(toolErrorOf(await call(editor, "deck_draft_edit", { deckId, expectedEditNumber: published.editNumber, remove: [randomUUID()] })).code).toBe("validation");
      expect(await countRows("select count(*)::int as n from learning_app.deck_versions where deck_id = $1", [deckId])).toBe(1);

      const edited = DeckDraftWriteResultSchema.parse((await call(editor, "deck_draft_edit", {
        deckId, expectedEditNumber: published.editNumber, items: [{ ...published.items[0]!, acceptedAnswers: ["a carrot"] }, word("burak", "beetroot")],
      })).structuredContent);
      expect(edited.draftId).not.toBe(seeded.draftId);
      expect(edited.itemIds[0]).toBe(seeded.itemIds[0]);
      const draft = VocabularyDeckDtoSchema.parse((await call(editor, "deck_get", { deckId })).structuredContent);
      expect(draft).toMatchObject({ status: "draft", draftId: edited.draftId, editNumber: edited.editNumber });
      expect(draft.items.map(({ target, acceptedAnswers }) => [target, acceptedAnswers])).toEqual([["carrot", ["a carrot"]], ["beetroot", []]]);
      // Wersja opublikowana, z której uczy się dziecko, zostaje identyczna.
      expect(await rowsOf(seeded.draftId)).toEqual(publishedRows);
      expect(await countRows("select count(*)::int as n from learning_app.decks where id = $1 and published_version_id = $2", [deckId, seeded.draftId])).toBe(1);
      expect((await readDeck(services, deckId)).published!.items.map(({ target, acceptedAnswers }) => [target, acceptedAnswers])).toEqual([["carrot", []]]);

      // Zestaw zarchiwizowany nie przyjmuje edycji; id lekcji nie jest zestawem słówek.
      await call(publisher, "material_archive", { deckId });
      expect(toolErrorOf(await call(editor, "deck_draft_edit", { deckId, expectedEditNumber: edited.editNumber, title: "X" })).code).toBe("validation");
    });

    it("źródła: zapis, odczyt i edycja z kontrolą rewizji", async () => {
      const services = await world();
      const client = await connect(services, await token(services, "materials:write"));
      const input = { clientRequestId: randomUUID(), title: "Fikcyjny rozdział", body: "Pająk ma osiem nóg." };
      const created = (await call(client, "source_create", input)).structuredContent as { sourceId: string; created: boolean };
      expect(created.created).toBe(true);
      expect((await call(client, "source_create", input)).structuredContent).toEqual({ sourceId: created.sourceId, created: false });
      const source = SourceMaterialDtoSchema.parse((await call(client, "source_get", { sourceId: created.sourceId })).structuredContent);
      expect(source).toMatchObject({ title: "Fikcyjny rozdział", body: "Pająk ma osiem nóg.", revision: 1, decks: [] });
      const updated = SourceMaterialDtoSchema.parse((await call(client, "source_update", { sourceId: source.id, expectedRevision: 1, body: "Pająk ma osiem nóg i nie jest owadem." })).structuredContent);
      expect(updated).toMatchObject({ revision: 2, body: "Pająk ma osiem nóg i nie jest owadem." });
      expect(toolErrorOf(await call(client, "source_update", { sourceId: source.id, expectedRevision: 1, title: "Inny" })).code).toBe("conflict");
      expect(toolErrorOf(await call(client, "source_update", { sourceId: source.id, expectedRevision: 2 })).code).toBe("validation");
      const list = (await call(client, "source_list", {})).structuredContent as { sources: { id: string; title: string; revision: number }[] };
      expect(list.sources).toEqual([expect.objectContaining({ id: source.id, title: "Fikcyjny rozdział", revision: 2 })]);
    });

    it("publikacja i archiwizacja tylko tokenem materials:publish, który nie czyta ani nie redaguje treści", async () => {
      const services = await world();
      const editor = await connect(services, await token(services, "materials:write"));
      const deckId = randomUUID();
      const created = LessonDraftWriteResultSchema.parse((await call(editor, "lesson_draft_create", { ...LESSON, clientRequestId: deckId })).structuredContent);
      // Role nagrań słówek nie dotyczą zadań lekcji (liczyłyby nagranie z pól pozycji słówek); id lekcji nie tworzy zestawu słówek.
      const exerciseId = LessonAuthoringDraftDtoSchema.parse((await call(editor, "lesson_draft_get", { deckId })).structuredContent).exercises[0]!.id;
      const mediaBefore = await countRows("select count(*)::int as n from learning_app.media_assets");
      expect(toolErrorOf(await call(editor, "recording_regenerate", { deckId, target: { kind: "item", itemId: exerciseId, role: "target_audio" } })).code).toBe("validation");
      expect(await countRows("select count(*)::int as n from learning_app.media_assets")).toBe(mediaBefore);
      expect(toolErrorOf(await call(editor, "deck_draft_create", { clientRequestId: deckId })).code).toBe("conflict");
      expect(toolErrorOf(await call(editor, "illustration_omit", { deckId, itemId: exerciseId })).code).toBe("validation");

      // Szkic z brakiem pokrycia: publikacja odrzucona z listą braków, bez wersji opublikowanej.
      const gapId = randomUUID();
      const gap = LessonDraftWriteResultSchema.parse((await call(editor, "lesson_draft_create", { ...LESSON, exercises: EXERCISES.slice(0, 3), clientRequestId: gapId })).structuredContent);
      const gapPublisher = await connect(services, await token(services, "materials:publish"));
      const refused = toolErrorOf(await call(gapPublisher, "material_publish", { deckId: gapId, expectedEditNumber: gap.editNumber }));
      expect(refused.code).toBe("conflict");
      expect((refused.details as { coverage: unknown[] }).coverage.length).toBeGreaterThan(0);
      expect(await countRows("select count(*)::int as n from learning_app.decks where id = $1 and published_version_id is not null", [gapId])).toBe(0);

      const publisher = await connect(services, await token(services, "materials:publish"));
      expect((await publisher.listTools()).tools.map(({ name }) => name).sort()).toEqual(["material_archive", "material_list", "material_publish"]);
      await expect(call(publisher, "lesson_draft_get", { deckId })).rejects.toThrow(/403|Forbidden/);
      await expect(call(publisher, "lesson_draft_append", { deckId, expectedEditNumber: 1, exercises: [EXERCISES[0]] })).rejects.toThrow(/403|Forbidden/);

      const listed = MaterialListResultSchema.parse((await call(publisher, "material_list", { kind: "lesson", query: "present" })).structuredContent).materials;
      expect(listed).toContainEqual(expect.objectContaining({ deckId, kind: "lesson", state: "review", draftEditNumber: created.editNumber, published: false }));
      expect(toolErrorOf(await call(publisher, "material_publish", { deckId, expectedEditNumber: created.editNumber + 1 })).code).toBe("conflict");
      expect(await countRows("select count(*)::int as n from learning_app.decks where id = $1 and published_version_id is not null", [deckId])).toBe(0);

      expect((await call(publisher, "material_publish", { deckId, expectedEditNumber: created.editNumber })).structuredContent).toEqual({ deckId, deckVersionId: created.draftId });
      expect(await countRows("select count(*)::int as n from learning_app.decks where id = $1 and published_version_id = $2", [deckId, created.draftId])).toBe(1);
      // Po publikacji nie ma szkicu: kolejna publikacja i ponowne nagranie to conflict.
      expect(toolErrorOf(await call(publisher, "material_publish", { deckId, expectedEditNumber: created.editNumber })).code).toBe("conflict");
      expect(toolErrorOf(await call(editor, "recording_regenerate", { deckId, target: { kind: "story" } })).code).toBe("conflict");

      expect((await call(publisher, "material_archive", { deckId })).structuredContent).toEqual({ deckId });
      expect(await countRows("select count(*)::int as n from learning_app.decks where id = $1 and archived_at is not null", [deckId])).toBe(1);
      const ids = async (args: Record<string, unknown>) => MaterialListResultSchema.parse((await call(publisher, "material_list", args)).structuredContent).materials.map((row) => row.deckId);
      expect(await ids({})).not.toContain(deckId);
      expect(await ids({ includeArchived: true })).toContain(deckId);
      // Archiwizacja jest idempotentna, a zarchiwizowanego materiału nie da się opublikować.
      expect((await call(publisher, "material_archive", { deckId })).structuredContent).toEqual({ deckId });
      expect(toolErrorOf(await call(publisher, "material_publish", { deckId, expectedEditNumber: 1 })).code).toBe("validation");
    });
  });
});
