import { ApiErrorSchema, messages } from "@learning/contracts";
import {
  AppError,
  MAX_DECK_COVER_BYTES,
  archiveDeck,
  clearDeckCover,
  createChild,
  createDraftFromPublished,
  createEmptyDeck,
  deleteChild,
  editDraft,
  enqueueDeckGeneration,
  generateDeckCover,
  getPronunciationSettings,
  listChildren,
  listDecks,
  omitRevisionAsset,
  publishDraft,
  readDeck,
  readDraft,
  regenerateRevisionAsset,
  requireParent,
  setDeckCover,
  updateChild,
  updateDeckSettings,
  updatePronunciationBands,
  type Services,
} from "@learning/server";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiCallError, callParent, parentClient } from "../parent/api";
import { createOpenApiHandler } from "./handler";
import { parentORpcRouter } from "./parent-router";

vi.mock("@learning/server", async (importActual) => {
  const actual = await importActual<typeof import("@learning/server")>();
  return {
    ...actual,
    requireParent: vi.fn(),
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
  };
});

const services = { db: {} } as unknown as Services;
const handler = createOpenApiHandler(parentORpcRouter);

const childId = "11111111-1111-4111-8111-111111111111";
const deckId = "44444444-4444-4444-8444-444444444444";
const draftId = "88888888-8888-4888-8888-888888888888";
const assetId = "77777777-7777-4777-8777-777777777777";
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
    context: { services, headers: request.headers },
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

beforeEach(() => {
  vi.clearAllMocks();
  // Sesja rodzica istnieje domyślnie (requireParent zwraca void — token byłby
  // tylko w cookie); testy 401 podmieniają oczekiwanie na odrzucenie.
  vi.mocked(requireParent).mockResolvedValue(undefined);
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

describe("parent oRPC router — CSRF (Origin)", () => {
  it("mutacje z obcym Origin kończą się forbidden/403 bez wywołania przypadków użycia", async () => {
    const evil = { origin: "http://evil.example" };

    const cases: Array<[string, RequestInit, Mock]> = [
      ["/children", jsonInit({ displayName: "Ola", avatarKey: "fox", canRead: true }, evil), vi.mocked(createChild)],
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
      [`/decks/${deckId}/archive`, { method: "POST", headers: { ...sessionCookie, ...evil } }, vi.mocked(archiveDeck)],
      [`/drafts/${draftId}/publish`, jsonInit({ expectedEditNumber: 1 }, evil), vi.mocked(publishDraft)],
      [`/drafts/${draftId}/assets/omit`, jsonInit({ itemRevisionId: draftId }, evil), vi.mocked(omitRevisionAsset)],
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
        .handle(request, { prefix: "/api/v1/parent", context: { services, headers: request.headers } })
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
});
