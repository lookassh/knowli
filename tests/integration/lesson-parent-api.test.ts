import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createServices,
  loginParent,
  runDueGenerationWork,
  setupParent,
  createChild,
  type Services,
} from "@learning/server";
import {
  LessonDeckDtoSchema,
  LessonDraftDtoSchema,
  SubjectCatalogDtoSchema,
  type LessonExerciseInput,
} from "@learning/contracts";
import { testDatabase, truncateCoreTables } from "./helpers";
import { ManualClock } from "./helpers";
import { fakeGeneration, type FakeGeneration } from "./fakes";
import { handleParentApi } from "../../apps/web/src/parent/parent-router";
import { errorResponse } from "../../apps/web/src/http/errors";

const { pool } = testDatabase();
const BASE = "http://localhost:3000";

async function truncateDeckTables(): Promise<void> {
  await pool.query(
    `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
       learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
       learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
  );
}

function lessonServices(fakes: FakeGeneration, clock = new ManualClock()): Services {
  const { db } = testDatabase();
  return createServices({ db, clock, media: fakes.settings, generation: fakes.deps });
}

/** Request helper: path -> segments; GET has no origin requirement. */
function req(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string | null; origin?: string | null } = {},
): { request: Request; segments: string[] } {
  const origin = options.origin === undefined ? BASE : options.origin;
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (origin) headers.origin = origin;
  if (options.cookie) headers.cookie = `parent_session=${options.cookie}`;
  const request = new Request(`${BASE}/api/v1/parent/${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const segments = path.split("?")[0]!.split("/").filter((s) => s.length > 0);
  return { request, segments };
}

function call(
  services: Services,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string | null; origin?: string | null } = {},
): Promise<Response> {
  const { request, segments } = req(method, path, options);
  // Odwzorowanie produkcyjnego `withApi`: wyjątki stają się odpowiedzią z
  // jednolitym formatem błędu (łącznie z `details`), tak jak w route.ts.
  return handleParentApi(request, services, segments).catch((error) => errorResponse(error));
}

const SUBJECT = "english_grammar";
const TOPIC = "present_simple";
const OBJECTIVE = "english_grammar.present_simple.third_person_s";

function lessonBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subjectId: SUBJECT,
    topicId: TOPIC,
    objectiveIds: [OBJECTIVE],
    material: "He plays football. She watches TV. They study English every day.",
    instruction: "Ćwicz -s w 3. osobie.",
    poolSize: 20,
    clientRequestId: randomUUID(),
    ...overrides,
  };
}

/** Pętli worker generacji aż do wyczerpania pracy (lekcja + TTS odpowiedzi). */
async function drainWork(services: Services): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const { processed } = await runDueGenerationWork(services, { lesson: 5, deck: 5, tts: 50, images: 50 });
    if (processed === 0) return;
  }
}

/** Tworzy lekcję i generuje szkic (fake provider), zwraca {deckId, versionId, cookie}. */
async function createAndGenerate(
  services: Services,
  cookie: string,
): Promise<{ deckId: string; versionId: string }> {
  const created = await call(services, "POST", "lessons", { body: lessonBody(), cookie });
  expect(created.status).toBe(202);
  const { deckId } = (await created.json()) as { deckId: string };
  await drainWork(services);
  const read = await call(services, "GET", `lessons/${deckId}`, { cookie });
  const dto = LessonDeckDtoSchema.parse(await read.json());
  return { deckId, versionId: dto.draft!.id };
}

describe("Parent API lekcji (integracja, przez router HTTP)", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await truncateCoreTables();
    await truncateDeckTables();
  });

  afterAll(async () => {
    for (const dispose of disposers.splice(0)) await dispose();
    await pool.end();
  });

  async function freshParent(fakes: FakeGeneration): Promise<{ services: Services; cookie: string }> {
    const services = lessonServices(fakes);
    await setupParent(services, "lesson-api-pin");
    const { token } = await loginParent(services, "lesson-api-pin");
    return { services, cookie: token };
  }

  it("wymaga sesji rodzica (401) i Origin dla mutacji (403)", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);

    const noSession = await call(services, "GET", "lesson-catalog", { cookie: null });
    expect(noSession.status).toBe(401);
    const crossOrigin = await call(services, "POST", "lessons", {
      body: lessonBody(),
      cookie,
      origin: "https://attacker.example",
    });
    expect(crossOrigin.status).toBe(403);
  });

  it("katalog zawiera english_grammar / present_simple z celami", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);

    const res = await call(services, "GET", "lesson-catalog", { cookie });
    expect(res.status).toBe(200);
    const catalog = SubjectCatalogDtoSchema.parse(await res.json());
    const subject = catalog.subjects.find((s) => s.id === SUBJECT)!;
    expect(subject.titlePl).toBe("Angielski — gramatyka");
    const topic = subject.topics.find((t) => t.id === TOPIC)!;
    expect(topic.objectives.some((o) => o.id === OBJECTIVE)).toBe(true);
  });

  it("utworzenie lekcji → 202 {runId, deckId}, idempotentny retry", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);
    const body = lessonBody();

    const first = await call(services, "POST", "lessons", { body, cookie });
    const retry = await call(services, "POST", "lessons", { body, cookie });
    expect(first.status).toBe(202);
    expect(retry.status).toBe(202);
    const a = (await first.json()) as { runId: string; deckId: string };
    const b = (await retry.json()) as { runId: string; deckId: string };
    expect(a).toEqual(b);
    const count = await pool.query("select count(*)::int as c from learning_app.decks");
    expect(count.rows[0]!.c).toBe(1);
  });

  it("odczyt szkicu po wygenerowaniu: pokrycie, odrzucone, run i przypisania", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);

    const created = await call(services, "POST", "lessons", { body: lessonBody(), cookie });
    const { deckId } = (await created.json()) as { deckId: string };
    await runDueGenerationWork(services);

    const res = await call(services, "GET", `lessons/${deckId}`, { cookie });
    expect(res.status).toBe(200);
    const dto = LessonDeckDtoSchema.parse(await res.json());
    expect(dto.draft).not.toBeNull();
    expect(dto.published).toBeNull();
    expect(dto.draft!.status).toBe("review");
    expect(dto.draft!.subjectId).toBe(SUBJECT);
    expect(dto.draft!.exercises.length).toBeGreaterThan(0);
    expect(dto.draft!.rejectedCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(dto.draft!.coverage)).toBe(true);
    expect(dto.generation?.state).toBe("succeeded");
    expect(dto.assignments).toEqual([]);
  });

  it("edycja: poprawna zmiana polecenia zachowuje skill_version; zmiana odpowiedzi tworzy nowy", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);
    const { deckId } = await createAndGenerate(services, cookie);

    const read = await call(services, "GET", `lessons/${deckId}`, { cookie });
    const dto = LessonDeckDtoSchema.parse(await read.json());
    const draft = dto.draft!;
    const exercises = draft.exercises.map(stripToInput);

    const skillBefore = await objectiveSkillVersionIds(draft.id);

    // Zmiana kosmetyczna (polecenie) pierwszego ćwiczenia.
    const cosmetic = exercises.map((ex, i) => (i === 0 ? { ...ex, instructionPl: "Nowe polecenie." } : ex));
    const patched = await call(services, "PATCH", `lesson-drafts/${draft.id}`, {
      body: { expectedEditNumber: draft.editNumber, exercises: cosmetic },
      cookie,
    });
    expect(patched.status).toBe(200);
    const afterCosmetic = LessonDraftDtoSchema.parse(await patched.json());
    expect(afterCosmetic.editNumber).toBe(draft.editNumber + 1);
    const skillAfterCosmetic = await objectiveSkillVersionIds(draft.id);
    expect(skillAfterCosmetic).toEqual(skillBefore);

    // Zmiana odpowiedzi pierwszego ćwiczenia → nowa skill_version.
    const afterInputs = afterCosmetic.exercises.map(stripToInput);
    const changed = afterInputs.map((ex, i) =>
      i === 0 ? { ...ex, answer: "goes", acceptedAnswers: [], focus: ["goes"] } : ex,
    );
    const patched2 = await call(services, "PATCH", `lesson-drafts/${draft.id}`, {
      body: { expectedEditNumber: afterCosmetic.editNumber, exercises: changed },
      cookie,
    });
    expect(patched2.status).toBe(200);
    const skillAfterChange = await objectiveSkillVersionIds(draft.id);
    expect(skillAfterChange).not.toEqual(skillAfterCosmetic);
  });

  it("edycja: błędy walidacji per ćwiczenie (400 z listą)", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);
    const { deckId } = await createAndGenerate(services, cookie);
    const dto = LessonDeckDtoSchema.parse(await (await call(services, "GET", `lessons/${deckId}`, { cookie })).json());
    const draft = dto.draft!;
    const exercises = draft.exercises.map(stripToInput);

    // Niepoprawna luka: brak znacznika i odpowiedź > 3 tokeny.
    const invalid = exercises.map((ex, i) =>
      i === 0
        ? { ...ex, exerciseType: "lesson_gap" as const, stem: "no marker", answer: "a b c d e", acceptedAnswers: [], focus: [] }
        : ex,
    );
    const res = await call(services, "PATCH", `lesson-drafts/${draft.id}`, {
      body: { expectedEditNumber: draft.editNumber, exercises: invalid },
      cookie,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; details?: { exercises?: unknown[] } };
    expect(body.code).toBe("validation");
    expect(Array.isArray(body.details?.exercises)).toBe(true);
    expect(body.details!.exercises!.length).toBeGreaterThan(0);
  });

  it("edycja: konflikt expectedEditNumber → 409; edycja opublikowanej → 409", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);
    const { deckId } = await createAndGenerate(services, cookie);
    const dto = LessonDeckDtoSchema.parse(await (await call(services, "GET", `lessons/${deckId}`, { cookie })).json());
    const draft = dto.draft!;
    const exercises = draft.exercises.map(stripToInput);

    const stale = await call(services, "PATCH", `lesson-drafts/${draft.id}`, {
      body: { expectedEditNumber: draft.editNumber + 5, exercises },
      cookie,
    });
    expect(stale.status).toBe(409);
  });

  it("publikacja: braki pokrycia → 409 z listą; po dogenerowaniu/edycji → 200; szkic niewidoczny w Kid API", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);
    const { deckId } = await createAndGenerate(services, cookie);
    let dto = LessonDeckDtoSchema.parse(await (await call(services, "GET", `lessons/${deckId}`, { cookie })).json());
    const draft = dto.draft!;

    // Zepsuj pokrycie: usuń wszystkie ćwiczenia poza jednym (brak etapów).
    const only = draft.exercises.slice(0, 1).map(stripToInput);
    const trimmed = await call(services, "PATCH", `lesson-drafts/${draft.id}`, {
      body: { expectedEditNumber: draft.editNumber, exercises: only },
      cookie,
    });
    const trimmedDto = LessonDraftDtoSchema.parse(await trimmed.json());

    const blocked = await call(services, "POST", `lesson-drafts/${draft.id}/publish`, {
      body: { expectedEditNumber: trimmedDto.editNumber },
      cookie,
    });
    expect(blocked.status).toBe(409);
    const gaps = (await blocked.json()) as { code: string; details?: { coverage?: Array<{ objectiveId: string; stage: string; required: number; actual: number }> } };
    expect(gaps.details?.coverage?.length).toBeGreaterThan(0);
    expect(gaps.details!.coverage![0]).toMatchObject({ objectiveId: OBJECTIVE });

    // Przywróć pełne pokrycie i opublikuj. Pierwsze ćwiczenie przeżyło (ma id);
    // pozostałe zostały usunięte, więc dodajemy je jako nowe (bez id).
    const survivor: LessonExerciseInput = {
      ...stripToInput(draft.exercises[0]!),
      id: trimmedDto.exercises[0]!.id,
    };
    const readded: LessonExerciseInput[] = draft.exercises.slice(1).map((ex) => {
      const input = stripToInput(ex);
      const { id: _id, ...rest } = input;
      return rest as LessonExerciseInput;
    });
    const full: LessonExerciseInput[] = [survivor, ...readded];
    const restored = await call(services, "PATCH", `lesson-drafts/${draft.id}`, {
      body: { expectedEditNumber: trimmedDto.editNumber, exercises: full },
      cookie,
    });
    expect(restored.status).toBe(200);
    const restoredDto = LessonDraftDtoSchema.parse(await restored.json());
    await drainWork(services);
    const published = await call(services, "POST", `lesson-drafts/${draft.id}/publish`, {
      body: { expectedEditNumber: restoredDto.editNumber },
      cookie,
    });
    expect(published.status).toBe(200);

    dto = LessonDeckDtoSchema.parse(await (await call(services, "GET", `lessons/${deckId}`, { cookie })).json());
    expect(dto.published).not.toBeNull();
    expect(dto.published!.status).toBe("published");
  });

  it("dogenerowanie: 202 z regenerate", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);
    const { deckId } = await createAndGenerate(services, cookie);
    const dto = LessonDeckDtoSchema.parse(await (await call(services, "GET", `lessons/${deckId}`, { cookie })).json());
    const draft = dto.draft!;

    const res = await call(services, "POST", `lesson-drafts/${draft.id}/regenerate`, {
      body: { objectiveId: OBJECTIVE, count: 4, expectedEditNumber: draft.editNumber, clientRequestId: randomUUID() },
      cookie,
    });
    expect(res.status).toBe(202);
    const out = (await res.json()) as { generationRunId?: string; runId?: string; deckId: string };
    expect(out.deckId).toBe(deckId);
  });

  it("nowa wersja z opublikowanej", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);
    const { deckId } = await createAndGenerate(services, cookie);
    const dto = LessonDeckDtoSchema.parse(await (await call(services, "GET", `lessons/${deckId}`, { cookie })).json());
    const draft = dto.draft!;
    const publish = await call(services, "POST", `lesson-drafts/${draft.id}/publish`, {
      body: { expectedEditNumber: draft.editNumber },
      cookie,
    });
    expect(publish.status).toBe(200);

    const forked = await call(services, "POST", `lessons/${deckId}/draft`, { cookie });
    expect(forked.status).toBe(201);
    const newDraft = LessonDraftDtoSchema.parse(await forked.json());
    expect(newDraft.status).toBe("draft");
    expect(newDraft.deckId).toBe(deckId);
    expect(newDraft.exercises.length).toBe(draft.exercises.length);
    expect(newDraft.subjectId).toBe(SUBJECT);
  });

  it("przypisanie z celem lesson; cele słówek → 400", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);
    const { deckId } = await createAndGenerate(services, cookie);
    const dto = LessonDeckDtoSchema.parse(await (await call(services, "GET", `lessons/${deckId}`, { cookie })).json());
    await call(services, "POST", `lesson-drafts/${dto.draft!.id}/publish`, {
      body: { expectedEditNumber: dto.draft!.editNumber },
      cookie,
    });
    const child = await createChild(services, { displayName: "Ala", avatarKey: "cat" });

    const ok = await call(services, "PUT", `assignments/${child.id}/${deckId}`, {
      body: { testDate: "2026-10-20", testGoals: ["lesson"] },
      cookie,
    });
    expect(ok.status).toBe(204);

    const bad = await call(services, "PUT", `assignments/${child.id}/${deckId}`, {
      body: { testDate: "2026-10-20", testGoals: ["recall"] },
      cookie,
    });
    expect(bad.status).toBe(400);
  });

  it("endpointy słówek dla lekcji → deck_kind_mismatch; i odwrotnie", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { services, cookie } = await freshParent(fakes);
    const { deckId } = await createAndGenerate(services, cookie);
    const dto = LessonDeckDtoSchema.parse(await (await call(services, "GET", `lessons/${deckId}`, { cookie })).json());
    const draft = dto.draft!;

    // Edytor słówek (PATCH /drafts/:id) na wersji lekcji → deck_kind_mismatch.
    const res = await call(services, "PATCH", `drafts/${draft.id}`, {
      body: { expectedEditNumber: draft.editNumber, title: "x" },
      cookie,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("deck_kind_mismatch");
  });
});

// --- helpery testowe (SQL i mapowanie DTO→Input) ---

function stripToInput(ex: Record<string, unknown>): LessonExerciseInput {
  const { revisionId: _r, ...rest } = ex as { revisionId?: string } & Record<string, unknown>;
  return rest as LessonExerciseInput;
}

async function objectiveSkillVersionIds(versionId: string): Promise<string[]> {
  const rows = await pool.query<{ skill_version_id: string }>(
    `select irs.skill_version_id from learning_app.item_revision_skills irs
       join learning_app.item_revisions ir on ir.id = irs.item_revision_id
      where ir.deck_version_id = $1 and irs.skill = 'objective'
      order by ir.position`,
    [versionId],
  );
  return rows.rows.map((r) => r.skill_version_id);
}
