import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { loginParent, setupParent } from "@learning/server";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { handleParentApi } from "./helpers";
import { errorResponse } from "../../apps/web/src/http/errors";

const { pool } = testDatabase();
const BASE = "http://localhost:3000";

function request(body: unknown, cookie: string | null, origin = BASE): Request {
  return new Request(`${BASE}/api/v1/parent/decks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // jawny Host jak w żądaniu przyjmowanym przez serwer (undici nie
      // materializuje go z URL), żeby kontrola Origin widziała własnego hosta
      host: "localhost:3000",
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

// Poziom pliku: pula współdzielona przez oba bloki describe, zamykana raz na końcu.
afterAll(async () => {
  await pool.end();
});

describe("Parent API ręcznego tworzenia zestawu", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
       learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
       learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
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
      // walidacja granicy idzie z encodera oRPC jako odpowiedź 400/validation
      const response = await handleParentApi(request(body, token), services, ["decks"]);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code?: string }).code).toBe("validation");
    }
    expect(await deckCount()).toBe(1);
  });

  it("requires a parent session and same origin before creating a deck", async () => {
    const { services } = buildTestServices();
    await setupParent(services, "manual-deck-security-pin");
    const deckId = randomUUID();

    const anonymous = await handleParentApi(request({ deckId }, null), services, ["decks"]);
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { code?: string }).code).toBe("unauthorized");
    const { token } = await loginParent(services, "manual-deck-security-pin");
    const crossOrigin = await handleParentApi(request({ deckId }, token, "https://attacker.example"), services, ["decks"]);
    expect(crossOrigin.status).toBe(403);
    expect(((await crossOrigin.json()) as { code?: string }).code).toBe("forbidden");
    expect(await deckCount()).toBe(0);
  });
});

describe("Parent API ustawień sesji zestawu (PATCH /api/v1/parent/decks/:id)", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
       learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
       learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  async function parentWithDeck(pin: string): Promise<{ services: ReturnType<typeof buildTestServices>["services"]; token: string; deckId: string }> {
    const { services } = buildTestServices();
    await setupParent(services, pin);
    const { token } = await loginParent(services, pin);
    const deckId = randomUUID();
    const created = await handleParentApi(
      new Request(`${BASE}/api/v1/parent/decks`, {
        method: "POST", headers: { "content-type": "application/json", host: "localhost:3000", origin: BASE, cookie: `parent_session=${token}` },
        body: JSON.stringify({ deckId, title: "Zwierzęta" }),
      }),
      services, ["decks"],
    );
    expect(created.status).toBe(201);
    return { services, token, deckId };
  }

  function patchRequest(deckId: string, token: string, body: unknown): Request {
    return new Request(`${BASE}/api/v1/parent/decks/${deckId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", host: "localhost:3000", origin: BASE, cookie: `parent_session=${token}` },
      body: JSON.stringify(body),
    });
  }

  async function dispatch(request: Request, services: ReturnType<typeof buildTestServices>["services"], segments: string[]): Promise<Response> {
    return handleParentApi(request, services, segments).catch((error) => errorResponse(error));
  }

  async function budgetOf(deckId: string): Promise<number | null> {
    const row = (await pool.query<{ session_task_budget: number }>(
      "select session_task_budget from learning_app.decks where id=$1", [deckId],
    )).rows[0];
    return row?.session_task_budget ?? null;
  }

  it("zapisuje budżet sesji i zwraca go w DeckDto; wartości poza zakresem nie zmieniają bazy", async () => {
    const { services, token, deckId } = await parentWithDeck("deck-settings-pin");
    expect(await budgetOf(deckId)).toBe(20);

    const saved = await dispatch(patchRequest(deckId, token, { sessionTaskBudget: 7 }), services, ["decks", deckId]);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ sessionTaskBudget: 7 });
    expect(await budgetOf(deckId)).toBe(7);
    const detail = await dispatch(new Request(`${BASE}/api/v1/parent/decks/${deckId}`, {
      headers: { host: "localhost:3000", origin: BASE, cookie: `parent_session=${token}` },
    }), services, ["decks", deckId]);
    expect(detail.status).toBe(200);
    expect((await detail.json()).sessionTaskBudget).toBe(7);

    // Walidacja granicy Zod (wzorzec assignments): błąd walidacji API (status
    // 400 wg wspólnego formatu błędu §12) i brak zmiany w bazie.
    for (const invalid of [0, 101, 7.5, "7"]) {
      const response = await dispatch(patchRequest(deckId, token, { sessionTaskBudget: invalid }), services, ["decks", deckId]);
      expect(response.status, `sessionTaskBudget=${String(invalid)}`).toBe(400);
      expect(((await response.json()) as { code?: string }).code).toBe("validation");
    }
    const missing = await dispatch(patchRequest(deckId, token, {}), services, ["decks", deckId]);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { code?: string }).code).toBe("validation");
    expect(await budgetOf(deckId)).toBe(7);
  });

  it("404 dla nieznanego zestawu i 409 dla zarchiwizowanego", async () => {
    const { services, token, deckId } = await parentWithDeck("deck-settings-state-pin");
    const unknown = randomUUID();
    const notFound = await dispatch(patchRequest(unknown, token, { sessionTaskBudget: 7 }), services, ["decks", unknown]);
    expect(notFound.status).toBe(404);

    await pool.query("update learning_app.decks set archived_at=now() where id=$1", [deckId]);
    const conflict = await dispatch(patchRequest(deckId, token, { sessionTaskBudget: 7 }), services, ["decks", deckId]);
    expect(conflict.status).toBe(409);
    expect(await budgetOf(deckId)).toBe(20);
  });
});
