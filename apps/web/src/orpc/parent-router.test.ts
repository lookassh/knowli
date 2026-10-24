import { ApiErrorSchema, messages } from "@learning/contracts";
import {
  AppError,
  MAX_DECK_COVER_BYTES,
  acceptVerdictAsVariant,
  archiveDeck,
  clearDeckCover,
  createChild,
  isParentSetupRequired,
  createDraftFromPublished,
  createEmptyDeck,
  createLesson,
  createLessonDraftFromPublished,
  decideLessonVerdict,
  deckIdOfLessonVersion,
  deleteChild,
  editDraft,
  editLessonDraft,
  enqueueDeckGeneration,
  generateDeckCover,
  getLessonMockTestReport,
  getPronunciationSettings,
  getMockTestReport,
  getProgress,
  lessonCatalog,
  lessonObjectiveProgress,
  listChildren,
  listDecks,
  listLessonMockTests,
  listLessonVerdicts,
  listMockTests,
  loginParent,
  logoutParent,
  mockTestKindOfSession,
  omitRevisionAsset,
  publishDraft,
  publishLessonDraft,
  readDeck,
  readDeckKind,
  readDraft,
  readGeneration,
  readLessonDeck,
  readParentWorkCard,
  regenerateObjective,
  regenerateRevisionAsset,
  removeAssignment,
  requireParent,
  retryGeneration,
  setDeckCover,
  setupParent,
  updateChild,
  updateDeckSettings,
  updatePronunciationBands,
  upsertAssignment,
  type Services,
} from "@learning/server";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiCallError, callParent, parentClient } from "../parent/api";
import { clearingSessionCookie, sessionCookie as buildSessionCookie } from "../http/security";
import { createOpenApiHandler } from "./handler";
import { parentORpcRouter } from "./parent-router";

vi.mock("@learning/server", async (importActual) => {
  const actual = await importActual<typeof import("@learning/server")>();
  return {
    ...actual,
    requireParent: vi.fn(),
    isParentSetupRequired: vi.fn(),
    loginParent: vi.fn(),
    logoutParent: vi.fn(),
    setupParent: vi.fn(),
    listChildren: vi.fn(),
    createChild: vi.fn(),
    updateChild: vi.fn(),
    deleteChild: vi.fn(),
    getPronunciationSettings: vi.fn(),
    updatePronunciationBands: vi.fn(),
    listDecks: vi.fn(),
    enqueueDeckGeneration: vi.fn(),
    createEmptyDeck: vi.fn(),
    readDeck: vi.fn(),
    updateDeckSettings: vi.fn(),
    setDeckCover: vi.fn(),
    clearDeckCover: vi.fn(),
    generateDeckCover: vi.fn(),
    createDraftFromPublished: vi.fn(),
    archiveDeck: vi.fn(),
    readDraft: vi.fn(),
    editDraft: vi.fn(),
    publishDraft: vi.fn(),
    regenerateRevisionAsset: vi.fn(),
    omitRevisionAsset: vi.fn(),
    getMockTestReport: vi.fn(),
    listMockTests: vi.fn(),
    getLessonMockTestReport: vi.fn(),
    listLessonMockTests: vi.fn(),
    readDeckKind: vi.fn(),
    mockTestKindOfSession: vi.fn(),
    createLesson: vi.fn(),
    createLessonDraftFromPublished: vi.fn(),
    deckIdOfLessonVersion: vi.fn(),
    editLessonDraft: vi.fn(),
    getProgress: vi.fn(),
    lessonCatalog: vi.fn(),
    publishLessonDraft: vi.fn(),
    readGeneration: vi.fn(),
    readLessonDeck: vi.fn(),
    lessonObjectiveProgress: vi.fn(),
    listLessonVerdicts: vi.fn(),
    decideLessonVerdict: vi.fn(),
    acceptVerdictAsVariant: vi.fn(),
    regenerateObjective: vi.fn(),
    retryGeneration: vi.fn(),
    upsertAssignment: vi.fn(),
    removeAssignment: vi.fn(),
    readParentWorkCard: vi.fn(),
  };
});

const services = { db: {} } as unknown as Services;
const handler = createOpenApiHandler(parentORpcRouter);

const childId = "11111111-1111-4111-8111-111111111111";
const deckId = "44444444-4444-4444-8444-444444444444";
const draftId = "88888888-8888-4888-8888-888888888888";
const assetId = "77777777-7777-4777-8777-777777777777";
const sessionId = "33333333-3333-4333-8333-333333333333";
const runId = "55555555-5555-4555-8555-555555555555";
const verdictId = "22222222-2222-4222-8222-222222222222";
const lessonDraftId = "12121212-1212-4121-8121-121212121212";
const sessionCookie = { cookie: "parent_session=session-token" };

const childDto = {
  id: childId,
  displayName: "Ola",
  avatarKey: "fox",
  recordingMode: "hold" as const,
  canRead: true,
};
const pronunciationSettings = {
  pronunciationAvailable: true,
  thresholds: { correctMinScore: 80, partialMinScore: 50 },
  attempts: [],
};
const deckSummary = {
  deckId,
  title: "Zwierzęta",
  state: "published" as const,
  coverAssetId: null,
  vocabularyFormat: "standard" as const,
  editableVersionId: null,
  publishedVersionId: draftId,
  sessionTaskBudget: 20,
};
const deckDto = {
  id: deckId,
  title: "Zwierzęta",
  state: "published" as const,
  coverAssetId: null,
  sessionTaskBudget: 20,
  draft: null,
  published: null,
  generation: null,
  assignments: [],
};
const draftDto = {
  id: draftId,
  deckId,
  editNumber: 1,
  status: "draft" as const,
  vocabularyFormat: "standard" as const,
  title: "Zwierzęta",
  items: [],
  assets: [],
};

const instant = "2026-10-23T10:00:00.000Z";
const mockTestReport = {
  deckTitle: "Zwierzęta",
  deckVersionNumber: 1,
  sessionId,
  childId,
  deckId,
  deckVersionId: draftId,
  testDate: null,
  testGoals: ["recall" as const],
  requestedTaskCount: 10,
  taskBudget: 10,
  state: "completed" as const,
  complete: true,
  startedAt: instant,
  endedAt: instant,
  skills: [],
  rows: [],
};
const lessonMockTestReport = {
  sessionId,
  objectives: [],
  complete: true,
  taskBudget: 10,
  startedAt: instant,
  endedAt: instant,
};
const workCardDto = {
  childId,
  date: "2026-10-23",
  creditedSeconds: 60,
  unevaluatedSessions: 0,
  reviewService: null,
  sessions: [],
};
const lessonDeckDto = {
  id: deckId,
  title: "Lekcja",
  state: "draft" as const,
  sessionTaskBudget: 20,
  draft: null,
  published: null,
  generation: null,
  assignments: [],
  grading: { available: false },
};
const lessonDraftDto = {
  id: lessonDraftId,
  deckId,
  editNumber: 1,
  status: "draft" as const,
  title: "Lekcja",
  subjectId: "english",
  topicId: "basics",
  topicVersion: 1,
  objectiveIds: ["obj-1"],
  examples: {},
  exercises: [],
  assets: [],
  rejectedCount: 0,
  coverage: [],
};
const objectiveProgress = {
  objectiveId: "obj-1",
  titlePl: "Cel",
  status: "learning" as const,
  lastIndependentAt: null,
  nextReviewAt: null,
  poolExhausted: false,
  topErrors: [],
};
const verdictDto = {
  id: verdictId,
  exerciseRevisionId: draftId,
  objectiveId: "obj-1",
  childAnswer: "go",
  verdict: "correct" as const,
  errorCategory: null,
  note: "",
  graderModel: "g-x",
  parentDecision: null,
  createdAt: instant,
};
const generationDto = {
  id: runId,
  deckId,
  deckVersionId: null,
  state: "failed" as const,
  attempts: 1,
  errorCode: null,
};
const progressDto = {
  childId,
  childName: "Ola",
  deckId,
  deckTitle: "Zwierzęta",
  testDate: null,
  totalItems: 0,
  skills: [],
  items: [],
  confusions: [],
  pronunciation: { assessed: false, latestScores: [] },
  history: [],
  activity: {
    days: 7,
    activeSeconds: 0,
    activeDays: 0,
    sessions: 0,
    answers: 0,
    interactions: 0,
    decks: [],
    daily: [],
  },
};

/** Strumień obrazu z obserwowalnym anulowaniem (regresja limitu 5 MB). */
function coverStream(chunks: readonly Uint8Array[]): {
  stream: ReadableStream<Uint8Array>;
  cancelled: () => boolean;
} {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/parent${path}`, init);
  const { matched, response } = await handler.handle(request, {
    prefix: "/api/v1/parent",
    context: { services, headers: request.headers, url: request.url },
  });
  if (!matched) throw new Error(`no oRPC match for ${path}`);
  return response;
}

function jsonInit(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...sessionCookie, ...headers },
  };
}

/** POST bootstrapu autoryzacji — celowo BEZ cookie sesji (login/setup nie mogą jej wymagać). */
function authInit(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sesja rodzica istnieje domyślnie (requireParent zwraca void — token byłby
  // tylko w cookie); testy 401 podmieniają oczekiwanie na odrzucenie.
  vi.mocked(requireParent).mockResolvedValue(undefined);
  vi.mocked(isParentSetupRequired).mockResolvedValue(false);
});

describe("parent oRPC router — sesja rodzica", () => {
  it("każdy odczyt bez sesji kończy się unauthorized/401 bez wywołania przypadków użycia", async () => {
    vi.mocked(requireParent).mockRejectedValue(new AppError("unauthorized"));

    const reads: Array<[string, string, Mock]> = [
      ["children.list", "/children", vi.mocked(listChildren)],
      ["decks.list", "/decks", vi.mocked(listDecks)],
      ["decks.get", `/decks/${deckId}`, vi.mocked(readDeck)],
      ["drafts.get", `/drafts/${draftId}`, vi.mocked(readDraft)],
      ["children.getPronunciation", `/children/${childId}/pronunciation`, vi.mocked(getPronunciationSettings)],
      ["mockTests.list", `/mock-tests?childId=${childId}&deckId=${deckId}`, vi.mocked(readDeckKind)],
      ["mockTests.get", `/mock-tests/${sessionId}`, vi.mocked(mockTestKindOfSession)],
      ["workCard.get", `/work-card?childId=${childId}`, vi.mocked(readParentWorkCard)],
      ["lessonCatalog.get", "/lesson-catalog", vi.mocked(lessonCatalog)],
      ["lessons.get", `/lessons/${deckId}`, vi.mocked(readLessonDeck)],
      ["lessons.progress", `/lessons/${deckId}/progress?childId=${childId}`, vi.mocked(lessonObjectiveProgress)],
      ["lessons.verdicts", `/lessons/${deckId}/verdicts`, vi.mocked(listLessonVerdicts)],
      ["generation.get", `/generation/${runId}`, vi.mocked(readGeneration)],
      ["progress.get", `/progress?childId=${childId}&deckId=${deckId}`, vi.mocked(getProgress)],
    ];

    for (const [label, path, useCase] of reads) {
      const response = await call(path, { headers: sessionCookie });
      expect(response.status, label).toBe(401);
      const body = ApiErrorSchema.parse(await response.json());
      expect(body.code, label).toBe("unauthorized");
      expect(body.message, label).toBe(messages.errors.unauthorized);
      expect(useCase, label).not.toHaveBeenCalled();
    }
  });

  it("mutacja bez sesji również pada na unauthorized/401", async () => {
    vi.mocked(requireParent).mockRejectedValue(new AppError("unauthorized"));

    const response = await call("/decks/generate", jsonInit({
      prompt: "angielskie zwierzęta",
      idempotencyKey: "key-12345678",
    }));

    expect(response.status).toBe(401);
    expect(enqueueDeckGeneration).not.toHaveBeenCalled();
  });
});

describe("parent oRPC router — auth bootstrap (login/logout/setup)", () => {
  const secret = { secret: "1234" };

  it("GET /login zwraca stan ekranu logowania bez cookie i bez sesji", async () => {
    vi.mocked(isParentSetupRequired).mockResolvedValueOnce(true);

    const response = await call("/login");

    expect(response.status).toBe(200);
    // paritet z legacy: zwykły JSON bez cache-control
    expect(response.headers.get("cache-control")).toBeNull();
    await expect(response.json()).resolves.toEqual({ authenticated: false, setupRequired: true });
    expect(isParentSetupRequired).toHaveBeenCalledWith(services);
  });

  it("GET /login z ważną sesją raportuje authenticated", async () => {
    const response = await call("/login", { headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true, setupRequired: false });
  });

  it("GET /login z nieważną sesją nie wywala granicy (authenticated false)", async () => {
    vi.mocked(requireParent).mockRejectedValueOnce(new AppError("unauthorized"));

    const response = await call("/login", { headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: false, setupRequired: false });
  });

  it("POST /login ustawia cookie bajt w bajt jak loginAndBuildCookie i zwraca {expiresAt} — bez sesji", async () => {
    const token = "raw-session-token";
    vi.mocked(loginParent).mockResolvedValueOnce({ token, expiresAt: instant });

    const response = await call("/login", authInit(secret));

    expect(response.status).toBe(200);
    // oczekiwane ciastko buduje TEN SAM helper (HttpOnly, SameSite=Lax, Max-Age)
    const expected = buildSessionCookie(new Request("http://localhost"), token);
    expect(response.headers.get("set-cookie")).toBe(expected);
    expect(expected).toContain("HttpOnly");
    expect(expected).toContain("SameSite=Lax");
    await expect(response.json()).resolves.toEqual({ expiresAt: instant });
    expect(loginParent).toHaveBeenCalledWith(services, "1234");
  });

  it("POST /login za proxy https dostaje Secure — atrybuty dalej jak w helperze", async () => {
    vi.mocked(loginParent).mockResolvedValueOnce({ token: "https-token", expiresAt: instant });

    const response = await call("/login", authInit(secret, { "x-forwarded-proto": "https" }));

    expect(response.status).toBe(200);
    const expected = buildSessionCookie(
      new Request("http://localhost", { headers: { "x-forwarded-proto": "https" } }),
      "https-token",
    );
    expect(response!.headers.get("set-cookie")).toBe(expected);
    expect(expected).toContain("Secure");
  });

  it("POST /login po bezpośrednim https (bez proxy-header) dostaje Secure (CWE-614)", async () => {
    vi.mocked(loginParent).mockResolvedValueOnce({ token: "direct-https-token", expiresAt: instant });

    // Bezpośrednie HTTPS bez x-forwarded-proto: protokół czytany z URL żądania
    // przekazywanego w kontekście oRPC — atrybut Secure nie może zniknąć.
    const request = new Request(`https://umiem.test/api/v1/parent/login`, authInit(secret));
    const { matched, response } = await handler.handle(request, {
      prefix: "/api/v1/parent",
      context: { services, headers: request.headers, url: request.url },
    });
    expect(matched).toBe(true);

    const expected = buildSessionCookie(new Request("https://umiem.test"), "direct-https-token");
    expect(response!.headers.get("set-cookie")).toBe(expected);
    expect(expected).toContain("Secure");
  });

  it("POST /login ze złym PIN-em → 401 invalid_credentials bez cookie", async () => {
    vi.mocked(loginParent).mockRejectedValueOnce(new AppError("invalid_credentials"));

    const response = await call("/login", authInit({ secret: "zly-pin" }));

    expect(response.status).toBe(401);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("invalid_credentials");
    expect(body.retryable).toBe(false);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("POST /login bez setupu → 409 setup_required", async () => {
    vi.mocked(loginParent).mockRejectedValueOnce(new AppError("setup_required"));

    const response = await call("/login", authInit(secret));

    expect(response.status).toBe(409);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("setup_required");
  });

  it("POST /login z pustym sekretem → 400 validation bez wywołania loginParent", async () => {
    const response = await call("/login", authInit({ secret: "" }));

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(loginParent).not.toHaveBeenCalled();
  });

  it("POST /logout z sesją czyści cookie (204, Max-Age=0) i unieważnia token", async () => {
    vi.mocked(logoutParent).mockResolvedValueOnce(undefined);

    const response = await call("/logout", { method: "POST", headers: sessionCookie });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const expected = clearingSessionCookie(new Request("http://localhost"));
    expect(response.headers.get("set-cookie")).toBe(expected);
    expect(expected).toContain("Max-Age=0");
    expect(logoutParent).toHaveBeenCalledWith(services, "session-token");
  });

  it("POST /logout bez cookie → 401 unauthorized (paritet legacy), bez wywołania logoutParent", async () => {
    const response = await call("/logout", { method: "POST" });

    expect(response.status).toBe(401);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("unauthorized");
    expect(logoutParent).not.toHaveBeenCalled();
  });

  it("POST /setup pierwsze uruchomienie → 201 {ok:true} bez cookie i bez sesji", async () => {
    vi.mocked(setupParent).mockResolvedValueOnce(undefined);

    const response = await call("/setup", authInit(secret));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
    // setup nie loguje — cookie wystawia dopiero POST /login (paritet legacy)
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(setupParent).toHaveBeenCalledWith(services, "1234");
  });

  it("POST /setup po konfiguracji → 409 already_configured", async () => {
    vi.mocked(setupParent).mockRejectedValueOnce(new AppError("already_configured"));

    const response = await call("/setup", authInit({ secret: "inny-pin" }));

    expect(response.status).toBe(409);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("already_configured");
  });
});

describe("parent oRPC router — children", () => {
  it("listuje profile dzieci (200, bez no-store jak w legacy)", async () => {
    vi.mocked(listChildren).mockResolvedValueOnce([childDto]);

    const response = await call("/children", { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
    await expect(response.json()).resolves.toEqual([childDto]);
    expect(listChildren).toHaveBeenCalledWith(services);
  });

  it("create zwraca 201 z DTO dziecka", async () => {
    vi.mocked(createChild).mockResolvedValueOnce(childDto);

    const input = { displayName: "Ola", avatarKey: "fox", canRead: true };
    const response = await call("/children", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json", ...sessionCookie },
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(childDto);
    expect(createChild).toHaveBeenCalledWith(services, input);
  });

  it("update numeruje profil ścieżką i zwraca 200", async () => {
    vi.mocked(updateChild).mockResolvedValueOnce(childDto);

    const response = await call(`/children/${childId}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName: "Ola G." }),
      headers: { "content-type": "application/json", ...sessionCookie },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(childDto);
    expect(updateChild).toHaveBeenCalledWith(services, childId, { displayName: "Ola G." });
  });

  it("remove zwraca 204 z pustym ciałem", async () => {
    vi.mocked(deleteChild).mockResolvedValueOnce(undefined);

    const response = await call(`/children/${childId}`, { method: "DELETE", headers: sessionCookie });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(deleteChild).toHaveBeenCalledWith(services, childId);
  });

  it("getPronunciation zwraca ustawienia wymowy", async () => {
    vi.mocked(getPronunciationSettings).mockResolvedValueOnce(pronunciationSettings);

    const response = await call(`/children/${childId}/pronunciation`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(pronunciationSettings);
    expect(getPronunciationSettings).toHaveBeenCalledWith(services, childId);
  });

  it("putPronunciation zapisuje progi i zwraca 204", async () => {
    vi.mocked(updatePronunciationBands).mockResolvedValueOnce(undefined);

    const bands = { correctMinScore: 85, partialMinScore: 55 };
    const response = await call(`/children/${childId}/pronunciation`, {
      method: "PUT",
      body: JSON.stringify(bands),
      headers: { "content-type": "application/json", ...sessionCookie },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(updatePronunciationBands).toHaveBeenCalledWith(services, childId, bands);
  });
});

describe("parent oRPC router — decks", () => {
  it("listuje zestawy (200)", async () => {
    vi.mocked(listDecks).mockResolvedValueOnce([deckSummary]);

    const response = await call("/decks", { headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([deckSummary]);
  });

  it("generate enqueue'uje run i zwraca 202 {generationRunId, deckId}", async () => {
    vi.mocked(enqueueDeckGeneration).mockResolvedValueOnce({ runId: "55555555-5555-4555-8555-555555555555", deckId });

    const command = { prompt: "angielskie zwierzęta", idempotencyKey: "key-12345678", vocabularyFormat: "standard" as const };
    const response = await call("/decks/generate", jsonInit(command));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      generationRunId: "55555555-5555-4555-8555-555555555555",
      deckId,
    });
    expect(enqueueDeckGeneration).toHaveBeenCalledWith(services, command);
  });

  it("create zwraca 201 przy utworzeniu i 200 przy bezpiecznym ponowieniu (dynamiczny status)", async () => {
    vi.mocked(createEmptyDeck)
      .mockResolvedValueOnce({ deckId, created: true })
      .mockResolvedValueOnce({ deckId, created: false });
    const command = { deckId };

    const created = await call("/decks", jsonInit(command));
    const resumed = await call("/decks", jsonInit(command));

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({ deckId });
    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toEqual({ deckId });
    expect(createEmptyDeck).toHaveBeenCalledWith(services, command);
  });

  it("get zwraca widok zestawu", async () => {
    vi.mocked(readDeck).mockResolvedValueOnce(deckDto as never);

    const response = await call(`/decks/${deckId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(deckDto);
    expect(readDeck).toHaveBeenCalledWith(services, deckId);
  });

  it("updateSettings zapisuje budżet zadań ocenianych", async () => {
    vi.mocked(updateDeckSettings).mockResolvedValueOnce({ sessionTaskBudget: 7 });

    const response = await call(`/decks/${deckId}`, {
      method: "PATCH",
      body: JSON.stringify({ sessionTaskBudget: 7 }),
      headers: { "content-type": "application/json", ...sessionCookie },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sessionTaskBudget: 7 });
    expect(updateDeckSettings).toHaveBeenCalledWith(services, deckId, { sessionTaskBudget: 7 });
  });

  it("createDraft tworzy szkic z opublikowanej wersji (201)", async () => {
    vi.mocked(createDraftFromPublished).mockResolvedValueOnce(draftDto as never);

    const response = await call(`/decks/${deckId}/draft`, { method: "POST", headers: sessionCookie });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(draftDto);
    expect(createDraftFromPublished).toHaveBeenCalledWith(services, deckId);
  });

  it("archive zwraca 204", async () => {
    vi.mocked(archiveDeck).mockResolvedValueOnce(undefined);

    const response = await call(`/decks/${deckId}/archive`, { method: "POST", headers: sessionCookie });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(archiveDeck).toHaveBeenCalledWith(services, deckId);
  });
});

describe("parent oRPC router — okładka zestawu (streaming 5 MB)", () => {
  function coverInit(body: BodyInit, headers: Record<string, string> = {}): RequestInit {
    return {
      method: "POST",
      body,
      headers: { "content-type": "image/png", ...sessionCookie, ...headers },
      // undici wymaga duplex dla strumieniowego ciała (jak każdy klient HTTP).
      ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
    };
  }

  it("setCover zapisuje obraz i zwraca coverAssetId", async () => {
    vi.mocked(setDeckCover).mockResolvedValueOnce(assetId);
    const bytes = Uint8Array.from([1, 2, 3]);

    const response = await call(`/decks/${deckId}/cover`, coverInit(bytes));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ coverAssetId: assetId });
    expect(setDeckCover).toHaveBeenCalledWith(services, deckId, { bytes, declaredMimeType: "image/png" });
  });

  it("setCover odrzuca MIME inny niż PNG/JPEG/WebP bez czytania strumienia", async () => {
    const response = await call(`/decks/${deckId}/cover`, coverInit(Uint8Array.from([1]), {
      "content-type": "image/svg+xml",
    }));

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(setDeckCover).not.toHaveBeenCalled();
  });

  it("setCover ponad limit w nagłówku content-length pada przed przetwarzaniem (pre-check)", async () => {
    const response = await call(`/decks/${deckId}/cover`, coverInit(Uint8Array.from([1, 2, 3]), {
      "content-length": String(MAX_DECK_COVER_BYTES + 1),
    }));

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(body.message).toBe(messages.errors.validation);
    expect(setDeckCover).not.toHaveBeenCalled();
  });

  it("strumień ponad limit (chunked, bez content-length) → anulowany reader + validation", async () => {
    const { stream, cancelled } = coverStream([
      Uint8Array.from(new Array(3 * 1024 * 1024).fill(1)),
      Uint8Array.from(new Array(3 * 1024 * 1024).fill(2)),
    ]);

    const response = await call(`/decks/${deckId}/cover`, coverInit(stream));

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(cancelled()).toBe(true);
    expect(setDeckCover).not.toHaveBeenCalled();
  });

  it("pojedynczy chunk ponad limit też anuluje reader", async () => {
    const { stream, cancelled } = coverStream([Uint8Array.from(new Array(MAX_DECK_COVER_BYTES + 1).fill(9))]);

    const response = await call(`/decks/${deckId}/cover`, coverInit(stream));

    expect(response.status).toBe(400);
    expect(cancelled()).toBe(true);
    expect(setDeckCover).not.toHaveBeenCalled();
  });

  it("clearCover zwraca 204", async () => {
    vi.mocked(clearDeckCover).mockResolvedValueOnce(undefined);

    const response = await call(`/decks/${deckId}/cover`, { method: "DELETE", headers: sessionCookie });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(clearDeckCover).toHaveBeenCalledWith(services, deckId);
  });

  it("generateCover zwraca binarną propozycję z Content-Type obrazu i no-store", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    vi.mocked(generateDeckCover).mockResolvedValueOnce({ bytes, mimeType: "image/png" });

    const response = await call(`/decks/${deckId}/cover/generate`, { method: "POST", headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(generateDeckCover).toHaveBeenCalledWith(services, deckId);
  });

  it("generateCover mapuje not_found/conflict 1:1, a awarię providera na internal", async () => {
    vi.mocked(generateDeckCover)
      .mockRejectedValueOnce(new AppError("not_found"))
      .mockRejectedValueOnce(new AppError("conflict"))
      .mockRejectedValueOnce(new Error("provider is down"));

    const notFound = await call(`/decks/${deckId}/cover/generate`, { method: "POST", headers: sessionCookie });
    const conflict = await call(`/decks/${deckId}/cover/generate`, { method: "POST", headers: sessionCookie });
    const internal = await call(`/decks/${deckId}/cover/generate`, { method: "POST", headers: sessionCookie });

    expect(notFound.status).toBe(404);
    expect(ApiErrorSchema.parse(await notFound.json()).code).toBe("not_found");
    expect(conflict.status).toBe(409);
    expect(ApiErrorSchema.parse(await conflict.json()).code).toBe("conflict");
    expect(internal.status).toBe(500);
    expect(ApiErrorSchema.parse(await internal.json()).code).toBe("internal");
  });
});

describe("parent oRPC router — drafts", () => {
  it("get zwraca szkic", async () => {
    vi.mocked(readDraft).mockResolvedValueOnce(draftDto as never);

    const response = await call(`/drafts/${draftId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(draftDto);
    expect(readDraft).toHaveBeenCalledWith(services, draftId);
  });

  it("edit zapisuje poprawki z optimistic locking", async () => {
    vi.mocked(editDraft).mockResolvedValueOnce(draftDto as never);
    const patch = { title: "Zwierzęta domowe", expectedEditNumber: 1 };

    const response = await call(`/drafts/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
      headers: { "content-type": "application/json", ...sessionCookie },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(draftDto);
    expect(editDraft).toHaveBeenCalledWith(services, draftId, patch);
  });

  it("publish publikuje szkic i zwraca wersję", async () => {
    vi.mocked(publishDraft).mockResolvedValueOnce({ deckVersionId: "99999999-9999-4999-8999-999999999999" });

    const response = await call(`/drafts/${draftId}/publish`, jsonInit({ expectedEditNumber: 2 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deckVersionId: "99999999-9999-4999-8999-999999999999" });
    expect(publishDraft).toHaveBeenCalledWith(services, draftId, 2);
  });

  it("regenerateAsset zwraca 202 z identyfikatorem zasobu", async () => {
    vi.mocked(regenerateRevisionAsset).mockResolvedValueOnce({ assetId });

    const command = { itemRevisionId: draftId, role: "illustration" as const };
    const response = await call(`/drafts/${draftId}/assets/regenerate`, jsonInit(command));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ assetId });
    expect(regenerateRevisionAsset).toHaveBeenCalledWith(services, { draftId, ...command });
  });

  it("omitAsset pomija ilustrację i zwraca 204", async () => {
    vi.mocked(omitRevisionAsset).mockResolvedValueOnce(undefined);

    const response = await call(`/drafts/${draftId}/assets/omit`, jsonInit({ itemRevisionId: draftId }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(omitRevisionAsset).toHaveBeenCalledWith(services, { draftId, itemRevisionId: draftId });
  });
});

describe("parent oRPC router — mock-tests (dispatch lekcja/słówka)", () => {
  it("lista bez query childId/deckId kończy się validation/400 bez czytania rodzaju zestawu", async () => {
    const response = await call("/mock-tests", { headers: sessionCookie });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(readDeckKind).not.toHaveBeenCalled();
    expect(listMockTests).not.toHaveBeenCalled();
    expect(listLessonMockTests).not.toHaveBeenCalled();
  });

  it("lista dla zestawu słówek woła listMockTests z no-store", async () => {
    vi.mocked(readDeckKind).mockResolvedValueOnce("vocabulary");
    vi.mocked(listMockTests).mockResolvedValueOnce([mockTestReport]);

    const response = await call(`/mock-tests?childId=${childId}&deckId=${deckId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual([mockTestReport]);
    expect(readDeckKind).toHaveBeenCalledWith(services.db, deckId);
    expect(listMockTests).toHaveBeenCalledWith(services, childId, deckId);
    expect(listLessonMockTests).not.toHaveBeenCalled();
  });

  it("lista dla zestawu lekcji woła listLessonMockTests z no-store", async () => {
    vi.mocked(readDeckKind).mockResolvedValueOnce("lesson");
    vi.mocked(listLessonMockTests).mockResolvedValueOnce([lessonMockTestReport]);

    const response = await call(`/mock-tests?childId=${childId}&deckId=${deckId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual([lessonMockTestReport]);
    expect(listLessonMockTests).toHaveBeenCalledWith(services, childId, deckId);
    expect(listMockTests).not.toHaveBeenCalled();
  });

  it("szczegóły sesji słówek woła getMockTestReport z no-store", async () => {
    vi.mocked(mockTestKindOfSession).mockResolvedValueOnce("vocabulary");
    vi.mocked(getMockTestReport).mockResolvedValueOnce(mockTestReport);

    const response = await call(`/mock-tests/${sessionId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(mockTestReport);
    expect(mockTestKindOfSession).toHaveBeenCalledWith(services.db, sessionId);
    expect(getMockTestReport).toHaveBeenCalledWith(services, sessionId);
    expect(getLessonMockTestReport).not.toHaveBeenCalled();
  });

  it("szczegóły sesji lekcji woła getLessonMockTestReport z no-store", async () => {
    vi.mocked(mockTestKindOfSession).mockResolvedValueOnce("lesson");
    vi.mocked(getLessonMockTestReport).mockResolvedValueOnce(lessonMockTestReport);

    const response = await call(`/mock-tests/${sessionId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(lessonMockTestReport);
    expect(getLessonMockTestReport).toHaveBeenCalledWith(services, sessionId);
  });
});

describe("parent oRPC router — work-card", () => {
  it("zwraca kartę pracy dla dziecka (no-store, bez daty)", async () => {
    vi.mocked(readParentWorkCard).mockResolvedValueOnce(workCardDto);

    const response = await call(`/work-card?childId=${childId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(workCardDto);
    expect(readParentWorkCard).toHaveBeenCalledWith(services, { childId });
  });

  it("data jest opcjonalna i przechodzi do przypadku użycia", async () => {
    vi.mocked(readParentWorkCard).mockResolvedValueOnce(workCardDto);

    const response = await call(`/work-card?childId=${childId}&date=2026-10-20`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(readParentWorkCard).toHaveBeenCalledWith(services, { childId, date: "2026-10-20" });
  });

  it("bez childId kończy się validation/400", async () => {
    const response = await call("/work-card", { headers: sessionCookie });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(readParentWorkCard).not.toHaveBeenCalled();
  });
});

describe("parent oRPC router — lesson-catalog i lessons", () => {
  const catalog = { subjects: [] };
  const lessonCommand = {
    deckId,
    subjectId: "english",
    topicId: "basics",
    objectiveIds: ["obj-1"],
    material: "red blue",
    poolSize: 20,
    clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };

  it("lesson-catalog zwraca katalog przedmiotów (200)", async () => {
    vi.mocked(lessonCatalog).mockReturnValueOnce(catalog);

    const response = await call("/lesson-catalog", { headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(catalog);
    expect(lessonCatalog).toHaveBeenCalledWith(services);
  });

  it("create przyjmuje lekcję i zwraca 202 {runId, deckId}", async () => {
    vi.mocked(createLesson).mockResolvedValueOnce({ runId, deckId });

    const response = await call("/lessons", jsonInit(lessonCommand));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ runId, deckId });
    expect(createLesson).toHaveBeenCalledWith(services, lessonCommand);
  });

  it("get zwraca widok zestawu lekcji (200)", async () => {
    vi.mocked(readLessonDeck).mockResolvedValueOnce(lessonDeckDto as never);

    const response = await call(`/lessons/${deckId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(lessonDeckDto);
    expect(readLessonDeck).toHaveBeenCalledWith(services, deckId);
  });

  it("progress bez childId kończy się validation/400", async () => {
    const response = await call(`/lessons/${deckId}/progress`, { headers: sessionCookie });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(lessonObjectiveProgress).not.toHaveBeenCalled();
  });

  it("progress zwraca cele z no-store", async () => {
    vi.mocked(lessonObjectiveProgress).mockResolvedValueOnce([objectiveProgress]);

    const response = await call(`/lessons/${deckId}/progress?childId=${childId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual([objectiveProgress]);
    expect(lessonObjectiveProgress).toHaveBeenCalledWith(services, deckId, childId);
  });

  it("verdicts zwraca werdykty z no-store", async () => {
    vi.mocked(listLessonVerdicts).mockResolvedValueOnce([verdictDto]);

    const response = await call(`/lessons/${deckId}/verdicts`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual([verdictDto]);
    expect(listLessonVerdicts).toHaveBeenCalledWith(services, deckId);
  });

  it("draft tworzy szkic lekcji z opublikowanej wersji (201)", async () => {
    vi.mocked(createLessonDraftFromPublished).mockResolvedValueOnce(lessonDraftDto as never);

    const response = await call(`/lessons/${deckId}/draft`, { method: "POST", headers: sessionCookie });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(lessonDraftDto);
    expect(createLessonDraftFromPublished).toHaveBeenCalledWith(services, deckId);
  });
});

describe("parent oRPC router — lesson-verdicts", () => {
  it("decision zapisuje decyzję rodzica i zwraca werdykt (200)", async () => {
    const decided = { ...verdictDto, parentDecision: "confirmed" as const };
    vi.mocked(decideLessonVerdict).mockResolvedValueOnce(decided);

    const response = await call(`/lesson-verdicts/${verdictId}/decision`, jsonInit({ decision: "confirmed" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(decided);
    expect(decideLessonVerdict).toHaveBeenCalledWith(services, verdictId, "confirmed");
  });

  it("nieznana decyzja pada na validation/400 bez wywołania przypadku użycia", async () => {
    const response = await call(`/lesson-verdicts/${verdictId}/decision`, jsonInit({ decision: "maybe" }));

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(decideLessonVerdict).not.toHaveBeenCalled();
  });

  it("accept-as-variant dodaje wariant (200)", async () => {
    vi.mocked(acceptVerdictAsVariant).mockResolvedValueOnce({ deckVersionId: draftId, added: true });

    const response = await call(`/lesson-verdicts/${verdictId}/accept-as-variant`, { method: "POST", headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deckVersionId: draftId, added: true });
    expect(acceptVerdictAsVariant).toHaveBeenCalledWith(services, verdictId);
  });
});

describe("parent oRPC router — lesson-drafts", () => {
  it("edit zapisuje poprawki szkicu lekcji (200)", async () => {
    vi.mocked(editLessonDraft).mockResolvedValueOnce(lessonDraftDto as never);
    const patch = { title: "Lekcja 2", expectedEditNumber: 1 };

    const response = await call(`/lesson-drafts/${lessonDraftId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
      headers: { "content-type": "application/json", ...sessionCookie },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(lessonDraftDto);
    expect(editLessonDraft).toHaveBeenCalledWith(services, lessonDraftId, patch);
  });

  it("publish publikuje szkic lekcji (200)", async () => {
    vi.mocked(publishLessonDraft).mockResolvedValueOnce({ deckVersionId: draftId });

    const response = await call(`/lesson-drafts/${lessonDraftId}/publish`, jsonInit({ expectedEditNumber: 2 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deckVersionId: draftId });
    expect(publishLessonDraft).toHaveBeenCalledWith(services, lessonDraftId, 2);
  });

  it("regenerate rozwiązuje deckId z wersji i zwraca 202 {generationRunId, deckId}", async () => {
    vi.mocked(deckIdOfLessonVersion).mockResolvedValueOnce(deckId);
    vi.mocked(regenerateObjective).mockResolvedValueOnce({ runId, deckId });

    const command = {
      objectiveId: "obj-1",
      count: 4,
      expectedEditNumber: 1,
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    const response = await call(`/lesson-drafts/${lessonDraftId}/regenerate`, jsonInit(command));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ generationRunId: runId, deckId });
    // regenerateObjective bierze deckId, nie versionId — wyznaczony z wersji.
    expect(deckIdOfLessonVersion).toHaveBeenCalledWith(services, lessonDraftId);
    expect(regenerateObjective).toHaveBeenCalledWith(services, { deckId, ...command });
  });
});

describe("parent oRPC router — generation", () => {
  it("get zwraca run generacji (200)", async () => {
    vi.mocked(readGeneration).mockResolvedValueOnce(generationDto);

    const response = await call(`/generation/${runId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(generationDto);
    expect(readGeneration).toHaveBeenCalledWith(services, runId);
  });

  it("retry ponawia nieudany run (200)", async () => {
    vi.mocked(retryGeneration).mockResolvedValueOnce({ runId });

    const response = await call(`/generation/${runId}/retry`, { method: "POST", headers: sessionCookie });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ runId });
    expect(retryGeneration).toHaveBeenCalledWith(services, runId);
  });
});

describe("parent oRPC router — assignments", () => {
  it("put zapisuje przypisanie z terminem i celami (204)", async () => {
    vi.mocked(upsertAssignment).mockResolvedValueOnce(undefined);

    const response = await call(`/assignments/${childId}/${deckId}`, {
      method: "PUT",
      body: JSON.stringify({ testDate: "2026-10-30", testGoals: ["lesson"], mockTestTaskCount: 10 }),
      headers: { "content-type": "application/json", ...sessionCookie },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(upsertAssignment).toHaveBeenCalledWith(services, childId, deckId, "2026-10-30", {
      testGoals: ["lesson"],
      mockTestTaskCount: 10,
    });
  });

  it("remove usuwa przypisanie (204)", async () => {
    vi.mocked(removeAssignment).mockResolvedValueOnce(undefined);

    const response = await call(`/assignments/${childId}/${deckId}`, { method: "DELETE", headers: sessionCookie });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(removeAssignment).toHaveBeenCalledWith(services, childId, deckId);
  });
});

describe("parent oRPC router — progress", () => {
  it("zwraca postęp dla pary dziecko×zestaw (200, bez no-store jak w legacy)", async () => {
    vi.mocked(getProgress).mockResolvedValueOnce(progressDto as never);

    const response = await call(`/progress?childId=${childId}&deckId=${deckId}`, { headers: sessionCookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
    await expect(response.json()).resolves.toEqual(progressDto);
    expect(getProgress).toHaveBeenCalledWith(services, childId, deckId);
  });

  it("bez childId lub deckId kończy się validation/400", async () => {
    const missingChild = await call(`/progress?deckId=${deckId}`, { headers: sessionCookie });
    const missingDeck = await call(`/progress?childId=${childId}`, { headers: sessionCookie });

    for (const response of [missingChild, missingDeck]) {
      expect(response.status).toBe(400);
      const body = ApiErrorSchema.parse(await response.json());
      expect(body.code).toBe("validation");
    }
    expect(getProgress).not.toHaveBeenCalled();
  });
});

describe("parent oRPC router — CSRF (Origin)", () => {
  it("mutacje z obcym Origin kończą się forbidden/403 bez wywołania przypadków użycia", async () => {
    const evil = { origin: "http://evil.example" };

    const cases: Array<[string, RequestInit, Mock]> = [
      ["/login", authInit({ secret: "1234" }, evil), vi.mocked(loginParent)],
      ["/logout", { method: "POST", headers: { ...sessionCookie, ...evil } }, vi.mocked(logoutParent)],
      ["/setup", authInit({ secret: "1234" }, evil), vi.mocked(setupParent)],
      ["/children", jsonInit({ displayName: "Ola", avatarKey: "fox", canRead: true }, evil), vi.mocked(createChild)],
      [
        `/children/${childId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ displayName: "Ola G." }),
          headers: { "content-type": "application/json", ...sessionCookie, ...evil },
        },
        vi.mocked(updateChild),
      ],
      [`/children/${childId}`, { method: "DELETE", headers: { ...sessionCookie, ...evil } }, vi.mocked(deleteChild)],
      [
        `/children/${childId}/pronunciation`,
        {
          method: "PUT",
          body: JSON.stringify({ correctMinScore: 85, partialMinScore: 55 }),
          headers: { "content-type": "application/json", ...sessionCookie, ...evil },
        },
        vi.mocked(updatePronunciationBands),
      ],
      ["/decks/generate", jsonInit({ prompt: "angielskie zwierzęta", idempotencyKey: "key-12345678" }, evil), vi.mocked(enqueueDeckGeneration)],
      ["/decks", jsonInit({ deckId }, evil), vi.mocked(createEmptyDeck)],
      [
        `/decks/${deckId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sessionTaskBudget: 7 }),
          headers: { "content-type": "application/json", ...sessionCookie, ...evil },
        },
        vi.mocked(updateDeckSettings),
      ],
      [
        `/decks/${deckId}/cover`,
        {
          method: "POST",
          body: Uint8Array.from([1, 2, 3]),
          headers: { "content-type": "image/png", ...sessionCookie, ...evil },
        },
        vi.mocked(setDeckCover),
      ],
      [`/decks/${deckId}/cover`, { method: "DELETE", headers: { ...sessionCookie, ...evil } }, vi.mocked(clearDeckCover)],
      [`/decks/${deckId}/cover/generate`, { method: "POST", headers: { ...sessionCookie, ...evil } }, vi.mocked(generateDeckCover)],
      [`/decks/${deckId}/draft`, { method: "POST", headers: { ...sessionCookie, ...evil } }, vi.mocked(createDraftFromPublished)],
      [`/decks/${deckId}/archive`, { method: "POST", headers: { ...sessionCookie, ...evil } }, vi.mocked(archiveDeck)],
      [
        `/drafts/${draftId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Zwierzęta domowe", expectedEditNumber: 1 }),
          headers: { "content-type": "application/json", ...sessionCookie, ...evil },
        },
        vi.mocked(editDraft),
      ],
      [`/drafts/${draftId}/publish`, jsonInit({ expectedEditNumber: 1 }, evil), vi.mocked(publishDraft)],
      [`/drafts/${draftId}/assets/regenerate`, jsonInit({ itemRevisionId: draftId, role: "illustration" }, evil), vi.mocked(regenerateRevisionAsset)],
      [`/drafts/${draftId}/assets/omit`, jsonInit({ itemRevisionId: draftId }, evil), vi.mocked(omitRevisionAsset)],
      [
        "/lessons",
        jsonInit({
          deckId,
          subjectId: "english",
          topicId: "basics",
          objectiveIds: ["obj-1"],
          material: "red blue",
          poolSize: 20,
          clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }, evil),
        vi.mocked(createLesson),
      ],
      [`/lessons/${deckId}/draft`, { method: "POST", headers: { ...sessionCookie, ...evil } }, vi.mocked(createLessonDraftFromPublished)],
      [`/lesson-verdicts/${verdictId}/decision`, jsonInit({ decision: "confirmed" }, evil), vi.mocked(decideLessonVerdict)],
      [`/lesson-verdicts/${verdictId}/accept-as-variant`, { method: "POST", headers: { ...sessionCookie, ...evil } }, vi.mocked(acceptVerdictAsVariant)],
      [
        `/lesson-drafts/${lessonDraftId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Lekcja 2", expectedEditNumber: 1 }),
          headers: { "content-type": "application/json", ...sessionCookie, ...evil },
        },
        vi.mocked(editLessonDraft),
      ],
      [`/lesson-drafts/${lessonDraftId}/publish`, jsonInit({ expectedEditNumber: 1 }, evil), vi.mocked(publishLessonDraft)],
      [
        `/lesson-drafts/${lessonDraftId}/regenerate`,
        jsonInit({ objectiveId: "obj-1", count: 4, expectedEditNumber: 1, clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, evil),
        vi.mocked(regenerateObjective),
      ],
      [`/generation/${runId}/retry`, { method: "POST", headers: { ...sessionCookie, ...evil } }, vi.mocked(retryGeneration)],
      [
        `/assignments/${childId}/${deckId}`,
        {
          method: "PUT",
          body: JSON.stringify({ testDate: "2026-10-30", testGoals: ["lesson"], mockTestTaskCount: 10 }),
          headers: { "content-type": "application/json", ...sessionCookie, ...evil },
        },
        vi.mocked(upsertAssignment),
      ],
      [`/assignments/${childId}/${deckId}`, { method: "DELETE", headers: { ...sessionCookie, ...evil } }, vi.mocked(removeAssignment)],
    ];

    for (const [path, init, useCase] of cases) {
      const response = await call(path, init);
      expect(response.status, path).toBe(403);
      const body = ApiErrorSchema.parse(await response.json());
      expect(body.code, path).toBe("forbidden");
      expect(useCase, path).not.toHaveBeenCalled();
    }
  });

  it("odczyty z obcym Origin przechodzą (GET nie podlega CSRF)", async () => {
    vi.mocked(listDecks).mockResolvedValueOnce([deckSummary]);

    const response = await call("/decks", { headers: { ...sessionCookie, origin: "http://evil.example" } });

    expect(response.status).toBe(200);
    expect(listDecks).toHaveBeenCalled();
  });
});

describe("parent oRPC — pełne koło klient→handler (OpenAPILink)", () => {
  /** fetch sterowany handlerem oRPC: jedyna warstwa, jakiej potrzebuje klient. */
  function stubFetchWithHandler(): void {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      // Cookie sesji dokleja przeglądarka; w teście robi to stub fetcha.
      const headers = new Headers(init?.headers);
      headers.set("cookie", sessionCookie.cookie);
      const request = new Request(new URL(String(input), "http://localhost"), { ...init, headers });
      return handler
        .handle(request, { prefix: "/api/v1/parent", context: { services, headers: request.headers, url: request.url } })
        .then(({ response }) => response);
    });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch bez stuba handlera");
    });
  });

  it("upload okładki przez Blob (File) ze szczegółowym inputem trafia do setDeckCover", async () => {
    stubFetchWithHandler();
    vi.mocked(setDeckCover).mockResolvedValueOnce(assetId);
    const bytes = Uint8Array.from([1, 2, 3]);

    const result = await callParent(() => parentClient.decks.setCover({
      params: { deckId },
      headers: { "content-type": "image/png" },
      body: new File([bytes], "cover.png", { type: "image/png" }),
    }));

    expect(result).toEqual({ coverAssetId: assetId });
    expect(setDeckCover).toHaveBeenCalledWith(services, deckId, { bytes, declaredMimeType: "image/png" });
    vi.unstubAllGlobals();
  });

  it("generate przez klienta zwraca akceptację 202 {generationRunId, deckId}", async () => {
    stubFetchWithHandler();
    vi.mocked(enqueueDeckGeneration).mockResolvedValueOnce({ runId: "55555555-5555-4555-8555-555555555555", deckId });

    const acceptance = await callParent(() => parentClient.decks.generate({
      prompt: "angielskie zwierzęta",
      idempotencyKey: "key-12345678",
      vocabularyFormat: "standard",
    }));

    expect(acceptance).toEqual({
      generationRunId: "55555555-5555-4555-8555-555555555555",
      deckId,
    });
    vi.unstubAllGlobals();
  });

  it("błąd walidacji serwera normalizuje się do ApiCallError z kodem i statusem", async () => {
    stubFetchWithHandler();
    vi.mocked(createEmptyDeck).mockRejectedValueOnce(new AppError("validation"));

    const error = await callParent(() => parentClient.decks.create({ deckId })).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiCallError);
    expect((error as ApiCallError).code).toBe("validation");
    expect((error as ApiCallError).status).toBe(400);
    expect((error as ApiCallError).message).toBe(messages.errors.validation);
    vi.unstubAllGlobals();
  });

  it("create rozróżnia 201/200 w detailed output po stronie klienta", async () => {
    stubFetchWithHandler();
    vi.mocked(createEmptyDeck)
      .mockResolvedValueOnce({ deckId, created: true })
      .mockResolvedValueOnce({ deckId, created: false });

    const created = await callParent(() => parentClient.decks.create({ deckId }));
    const resumed = await callParent(() => parentClient.decks.create({ deckId }));

    expect(created.status).toBe(201);
    expect(created.body).toEqual({ deckId });
    expect(resumed.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("lessons.create przez klienta zwraca akceptację 202 {runId, deckId}", async () => {
    stubFetchWithHandler();
    vi.mocked(createLesson).mockResolvedValueOnce({ runId, deckId });

    const acceptance = await callParent(() => parentClient.lessons.create({
      deckId,
      subjectId: "english",
      topicId: "basics",
      objectiveIds: ["obj-1"],
      material: "red blue",
      poolSize: 20,
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }));

    expect(acceptance).toEqual({ runId, deckId });
    vi.unstubAllGlobals();
  });

  it("lessons.progress przez klienta: query + detailed output z no-store", async () => {
    stubFetchWithHandler();
    vi.mocked(lessonObjectiveProgress).mockResolvedValueOnce([objectiveProgress]);

    const result = await callParent(() => parentClient.lessons.progress({ deckId, childId }));

    expect(result.body).toEqual([objectiveProgress]);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(lessonObjectiveProgress).toHaveBeenCalledWith(services, deckId, childId);
    vi.unstubAllGlobals();
  });

  it("błąd bez koperty (np. proxy) zachowuje komunikat i status, jak apiFetch", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(
      JSON.stringify({ message: "Błąd raportu" }),
      { status: 500, headers: { "content-type": "application/json" } },
    )));

    const error = await callParent(() => parentClient.workCard.get({ childId })).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiCallError);
    expect((error as ApiCallError).message).toBe("Błąd raportu");
    expect((error as ApiCallError).status).toBe(500);
    expect((error as ApiCallError).code).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("auth.login przez klienta: detailed output z body {expiresAt} i nagłówkiem set-cookie", async () => {
    stubFetchWithHandler();
    vi.mocked(loginParent).mockResolvedValueOnce({ token: "client-token", expiresAt: instant });

    const result = await callParent(() => parentClient.auth.login({ secret: "1234" }));

    expect(result.body).toEqual({ expiresAt: instant });
    expect(result.headers["set-cookie"]).toContain("parent_session=client-token");
    expect(result.headers["set-cookie"]).toContain("HttpOnly");
    vi.unstubAllGlobals();
  });

  it("auth.state przez klienta zwraca stan ekranu logowania", async () => {
    stubFetchWithHandler();
    vi.mocked(isParentSetupRequired).mockResolvedValueOnce(true);

    const state = await callParent(() => parentClient.auth.state());

    // stub fetcha dokleja cookie sesji (jak przeglądarka), a requireParent
    // domyślnie przechodzi — więc stan raportuje zalogowanie.
    expect(state).toEqual({ authenticated: true, setupRequired: true });
    vi.unstubAllGlobals();
  });

  it("auth.logout przez klienta: 204 z czyszczącym cookie", async () => {
    stubFetchWithHandler();
    vi.mocked(logoutParent).mockResolvedValueOnce(undefined);

    const result = await callParent(() => parentClient.auth.logout());

    expect(result.status).toBe(204);
    expect(result.headers["set-cookie"]).toContain("Max-Age=0");
    expect(logoutParent).toHaveBeenCalledWith(services, "session-token");
    vi.unstubAllGlobals();
  });
});
