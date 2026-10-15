import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createServices, listKidDecks, readDeck, setDeckCover, clearDeckCover, loginParent, setupParent } from "@learning/server";
import { randomUUID } from "node:crypto";
import { testDatabase, truncateCoreTables } from "./helpers";
import { handleParentApi } from "../../apps/web/src/parent/parent-router";

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
    headers: { origin, cookie: `parent_session=${token}`, ...(body ? { "content-type": contentType } : {}) },
    ...(requestBody ? { body: requestBody } : {}),
  });
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
      method: "POST", headers: { origin: "http://localhost:3000", cookie: `parent_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ deckId, title: "Okładka" }),
    }), services, ["decks"]);
    expect(created.status).toBe(201);

    await expect(handleParentApi(coverRequest(deckId, token, "POST", bytes, "image/png", "https://attacker.example"), services, ["decks", deckId, "cover"]))
      .rejects.toMatchObject({ code: "forbidden" });

    const uploaded = await handleParentApi(coverRequest(deckId, token, "POST", bytes), services, ["decks", deckId, "cover"]);
    expect(uploaded.status).toBe(200);
    const coverAssetId = (await uploaded.json() as { coverAssetId: string }).coverAssetId;
    await expect(handleParentApi(coverRequest(deckId, token, "POST", bytes, "image/svg+xml"), services, ["decks", deckId, "cover"]))
      .rejects.toMatchObject({ code: "validation" });
    await expect(handleParentApi(coverRequest(deckId, token, "POST", new Uint8Array(5 * 1024 * 1024 + 1)), services, ["decks", deckId, "cover"]))
      .rejects.toMatchObject({ code: "validation" });
    expect((await readDeck(services, deckId)).coverAssetId).toBe(coverAssetId);

    const missingSession = coverRequest(deckId, "", "DELETE");
    await expect(handleParentApi(missingSession, services, ["decks", deckId, "cover"]))
      .rejects.toMatchObject({ code: "unauthorized" });
    const cleared = await handleParentApi(coverRequest(deckId, token, "DELETE"), services, ["decks", deckId, "cover"]);
    expect(cleared.status).toBe(204);
  });
});
