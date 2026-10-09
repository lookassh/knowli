import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { loginParent, setupParent } from "@learning/server";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { handleParentApi } from "../../apps/web/src/parent/parent-router";

const { pool } = testDatabase();
const BASE = "http://localhost:3000";

function request(body: unknown, cookie: string | null, origin = BASE): Request {
  return new Request(`${BASE}/api/v1/parent/decks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie: `parent_session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function deckCount(): Promise<number> {
  const result = await pool.query("select count(*)::int as count from learning_app.decks");
  return result.rows[0]!.count as number;
}

describe("Parent API ręcznego tworzenia zestawu", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
       learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
       learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates once, returns its public DTO and treats retry as idempotent", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "manual-deck-api-pin");
    const { token } = await loginParent(services, "manual-deck-api-pin");
    const deckId = randomUUID();

    const first = await handleParentApi(request({ deckId, title: "  Zwierzęta  " }, token), services, ["decks"]);
    const retry = await handleParentApi(request({ deckId, title: "Nowa nazwa" }, token), services, ["decks"]);

    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ deckId });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ deckId });
    expect(await deckCount()).toBe(1);
  });

  it("serializes simultaneous requests and rejects invalid command fields", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "manual-deck-race-pin");
    const { token } = await loginParent(services, "manual-deck-race-pin");
    const deckId = randomUUID();
    const responses = await Promise.all([
      handleParentApi(request({ deckId, title: "Zwierzęta" }, token), services, ["decks"]),
      handleParentApi(request({ deckId, title: "Kolory" }, token), services, ["decks"]),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(await deckCount()).toBe(1);
    for (const body of [
      { deckId: "bad" },
      { deckId: randomUUID(), title: " " },
      { deckId: randomUUID(), title: "a".repeat(201) },
      { deckId: randomUUID(), prompt: "Do not accept AI prompts here" },
      { deckId: randomUUID(), items: [] },
    ]) {
      await expect(handleParentApi(request(body, token), services, ["decks"])).rejects.toBeDefined();
    }
    expect(await deckCount()).toBe(1);
  });

  it("requires a parent session and same origin before creating a deck", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "manual-deck-security-pin");
    const deckId = randomUUID();

    await expect(handleParentApi(request({ deckId }, null), services, ["decks"]))
      .rejects.toMatchObject({ code: "unauthorized" });
    const { token } = await loginParent(services, "manual-deck-security-pin");
    await expect(handleParentApi(request({ deckId }, token, "https://attacker.example"), services, ["decks"]))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(await deckCount()).toBe(0);
  });
});
