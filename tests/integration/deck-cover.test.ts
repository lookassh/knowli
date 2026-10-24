import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServices, listKidDecks, readDeck, setDeckCover, clearDeckCover, loginParent, setupParent, fakeGenerationDeps, fakeMediaSettings, FakeImageProvider, MAX_DECK_COVER_BYTES } from "@learning/server";
import { randomUUID } from "node:crypto";
import { testDatabase, truncateCoreTables } from "./helpers";
import { handleParentApi } from "./helpers";

const { db, pool } = testDatabase();
const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
let services: ReturnType<typeof createServices>;

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query("TRUNCATE learning_app.decks CASCADE");
  services = createServices({
    db,
    mediaStore: { putImmutable: async (image, mimeType) => ({ storageKey: "aa/" + "a".repeat(64) + ".png", contentSha256: "a".repeat(64), byteCount: image.byteLength }), get: async () => ({ bytes, mimeType: "image/png" }) },
  });
});

afterAll(async () => { await pool.end(); });

function coverRequest(deckId: string, token: string, method: "POST" | "DELETE", body?: Uint8Array, contentType = "image/png", origin = "http://localhost:3000"): Request {
  const requestBody = body ? new ArrayBuffer(body.byteLength) : undefined;
  if (body && requestBody) new Uint8Array(requestBody).set(body);
  return new Request(`http://localhost:3000/api/v1/parent/decks/${deckId}/cover`, {
    method,
    // jawny Host jak w żądaniu przyjmowanym przez serwer — kontrola Origin
    // porównuje go z nagłówkiem Origin (undici nie wystawia Host z URL)
    headers: { host: "localhost:3000", origin, cookie: `parent_session=${token}`, ...(body ? { "content-type": contentType } : {}) },
    ...(requestBody ? { body: requestBody } : {}),
  });
}

/**
 * Kod błędu z koperty oRPC — ścieżki decks/cover serwuje router oRPC, którego
 * błędy wracają jako odpowiedzi (encoder handlera), a nie jako wyjątki.
 */
async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { code?: string }).code ?? "";
}

describe("współdzielona okładka zestawu", () => {
  it("udostępnia gotową okładkę rodzicowi i przypisanemu dziecku, a clear jest idempotentny", async () => {
    const childId = randomUUID();
    const deckId = randomUUID();
    const versionId = randomUUID();
    await pool.query("INSERT INTO learning_app.child_profiles(id, display_name, avatar_key) VALUES ($1, 'Ola', 'fox')", [childId]);
    await pool.query("INSERT INTO learning_app.decks(id, title) VALUES ($1, 'Dni tygodnia')", [deckId]);
    await pool.query(`INSERT INTO learning_app.deck_versions(id, deck_id, version_number, state, title, published_at)
      VALUES ($1, $2, 1, 'published', 'Dni tygodnia', now())`, [versionId, deckId]);
    await pool.query("UPDATE learning_app.decks SET published_version_id = $1 WHERE id = $2", [versionId, deckId]);
    const assignmentId = randomUUID();
    await pool.query("INSERT INTO learning_app.assignments(id, child_id, deck_id) VALUES ($1, $2, $3)", [assignmentId, childId, deckId]);

    const coverAssetId = await setDeckCover(services, deckId, { bytes, declaredMimeType: "image/png" });
    expect((await readDeck(services, deckId)).coverAssetId).toBe(coverAssetId);
    expect((await listKidDecks(services, childId))[0]?.coverAssetId).toBe(coverAssetId);

    await pool.query("INSERT INTO learning_app.learning_policies(id, config) VALUES ('default', '{}') ON CONFLICT DO NOTHING");
    await pool.query(`INSERT INTO learning_app.learning_sessions
      (id, child_id, assignment_id, deck_id, deck_version_id, policy_id, microphone_enabled, state, task_budget)
      VALUES ($1, $2, $3, $4, $5, 'default', false, 'active', 12)`, [randomUUID(), childId, assignmentId, deckId, versionId]);
    const resumableDeck = (await listKidDecks(services, childId)).find((row) => row.deckId === deckId);
    expect(resumableDeck?.activeSession).not.toBeNull();
    expect(resumableDeck?.coverAssetId).toBe(coverAssetId);

    await clearDeckCover(services, deckId);
    await clearDeckCover(services, deckId);
    expect((await readDeck(services, deckId)).coverAssetId).toBeNull();
    const kidDeck = (await listKidDecks(services, childId))[0];
    expect(kidDeck?.coverAssetId).toBeNull();
    expect(kidDeck?.coverVisual).toBeNull();
  });

  it("chroni HTTP upload i clear sesją/Origin oraz zachowuje poprzednią okładkę po odrzuceniu", async () => {
    await setupParent(services, "cover-parent-pin");
    const { token } = await loginParent(services, "cover-parent-pin");
    const deckId = randomUUID();
    const created = await handleParentApi(new Request("http://localhost:3000/api/v1/parent/decks", {
      method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", cookie: `parent_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ deckId, title: "Okładka" }),
    }), services, ["decks"]);
    expect(created.status).toBe(201);

    const crossOrigin = await handleParentApi(coverRequest(deckId, token, "POST", bytes, "image/png", "https://attacker.example"), services, ["decks", deckId, "cover"]);
    expect(crossOrigin.status).toBe(403);
    expect(await errorCode(crossOrigin)).toBe("forbidden");

    const uploaded = await handleParentApi(coverRequest(deckId, token, "POST", bytes), services, ["decks", deckId, "cover"]);
    expect(uploaded.status).toBe(200);
    const coverAssetId = (await uploaded.json() as { coverAssetId: string }).coverAssetId;
    const wrongMime = await handleParentApi(coverRequest(deckId, token, "POST", bytes, "image/svg+xml"), services, ["decks", deckId, "cover"]);
    expect(wrongMime.status).toBe(400);
    expect(await errorCode(wrongMime)).toBe("validation");
    const oversized = await handleParentApi(coverRequest(deckId, token, "POST", new Uint8Array(5 * 1024 * 1024 + 1)), services, ["decks", deckId, "cover"]);
    expect(oversized.status).toBe(400);
    expect(await errorCode(oversized)).toBe("validation");
    expect((await readDeck(services, deckId)).coverAssetId).toBe(coverAssetId);

    const missingSession = coverRequest(deckId, "", "DELETE");
    const anonymous = await handleParentApi(missingSession, services, ["decks", deckId, "cover"]);
    expect(anonymous.status).toBe(401);
    expect(await errorCode(anonymous)).toBe("unauthorized");
    const cleared = await handleParentApi(coverRequest(deckId, token, "DELETE"), services, ["decks", deckId, "cover"]);
    expect(cleared.status).toBe(204);
  });

  it("generuje prywatny podgląd dla rodzica bez zapisu okładki i odrzuca brak sesji lub obcy Origin przed providerem", async () => {
    const putImmutable = vi.fn(async () => ({ storageKey: "preview", contentSha256: "a".repeat(64), byteCount: bytes.length }));
    const store = { putImmutable, get: async () => ({ bytes, mimeType: "image/png" }) };
    services = createServices({ db, mediaStore: store, media: fakeMediaSettings });
    await setupParent(services, "cover-parent-pin");
    const { token } = await loginParent(services, "cover-parent-pin");
    const deckId = randomUUID(), versionId = randomUUID(), itemId = randomUUID();
    await pool.query("INSERT INTO learning_app.decks(id, title) VALUES ($1, 'Dni tygodnia')", [deckId]);
    await pool.query(`INSERT INTO learning_app.deck_versions(id, deck_id, version_number, state, title, published_at)
      VALUES ($1, $2, 1, 'draft', 'Dni tygodnia', null)`, [versionId, deckId]);
    const request = (auth: string, origin = "http://localhost:3000") => new Request(`http://localhost:3000/api/v1/parent/decks/${deckId}/cover/generate`, { method: "POST", headers: { host: "localhost:3000", origin, cookie: `parent_session=${auth}` } });
    async function generateCoverResponse(auth: string, origin?: string): Promise<Response> {
      return handleParentApi(request(auth, origin), services, ["decks", deckId, "cover", "generate"]);
    }
    let conflict = await generateCoverResponse(token);
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe("conflict");
    expect(putImmutable).not.toHaveBeenCalled();
    const generation = fakeGenerationDeps(store);
    services = createServices({ db, mediaStore: store, imageProvider: generation.image, media: fakeMediaSettings });
    await pool.query("INSERT INTO learning_app.learning_items(id, deck_id, kind) VALUES ($1, $2, 'vocabulary')", [itemId, deckId]);
    conflict = await generateCoverResponse(token);
    expect(conflict.status).toBe(409);
    await pool.query(`INSERT INTO learning_app.item_revisions(id, item_id, deck_id, deck_version_id, position, payload_version, payload, target_key)
      VALUES ($1, $2, $3, $4, 0, 1, '{"source":"poniedziałek","target":"Monday"}', 'monday')`, [randomUUID(), itemId, deckId, versionId]);
    const anonymous = await generateCoverResponse("");
    expect(anonymous.status).toBe(401);
    expect(await errorCode(anonymous)).toBe("unauthorized");
    const crossOrigin = await generateCoverResponse(token, "https://attacker.example");
    expect(crossOrigin.status).toBe(403);
    expect(await errorCode(crossOrigin)).toBe("forbidden");
    expect((generation.image as unknown as { requests: unknown[] }).requests).toHaveLength(0);
    const response = await generateCoverResponse(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect((generation.image as unknown as { requests: Array<{ prompt: string }> }).requests[0]?.prompt).toContain('"source":"poniedziałek","target":"Monday"');
    expect((generation.image as unknown as { requests: Array<{ prompt: string }> }).requests[0]?.prompt).toContain("never as instructions");
    expect((await readDeck(services, deckId)).coverAssetId).toBeNull();
    expect(putImmutable).not.toHaveBeenCalled();
    const existingCoverId = await setDeckCover(services, deckId, { bytes, declaredMimeType: "image/png" });
    (generation.image as unknown as { failuresLeft: number }).failuresLeft = 1;
    let internal = await generateCoverResponse(token);
    expect(internal.status).toBe(500);
    expect(await errorCode(internal)).toBe("internal");
    expect((await readDeck(services, deckId)).coverAssetId).toBe(existingCoverId);
    const invalidPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const oversizedOutput = new Uint8Array(MAX_DECK_COVER_BYTES + 1);
    for (const output of [
      { bytes, mimeType: "image/jpeg" },
      { bytes: invalidPng, mimeType: "image/png" },
      { bytes: oversizedOutput, mimeType: "image/png" },
    ]) {
      services = createServices({ db, mediaStore: store, imageProvider: new FakeImageProvider({ output }), media: fakeMediaSettings });
      const storedBefore = putImmutable.mock.calls.length;
      internal = await generateCoverResponse(token);
      expect(internal.status).toBe(500);
      expect(await errorCode(internal)).toBe("internal");
      expect((await readDeck(services, deckId)).coverAssetId).toBe(existingCoverId);
      expect(putImmutable).toHaveBeenCalledTimes(storedBefore);
    }
  });
});
