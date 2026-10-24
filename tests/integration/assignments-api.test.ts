import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createChild,
  createDraft,
  createServices,
  editDraft,
  loginParent,
  publishDraft,
  runDueGenerationWork,
  setupParent,
  type Services,
} from "@learning/server";
import { ManualClock, testDatabase, truncateCoreTables } from "./helpers";
import { fakeGeneration } from "./fakes";
import { handleParentApi } from "./helpers";
import { errorResponse } from "../../apps/web/src/http/errors";

const { pool } = testDatabase();
const BASE = "http://localhost:3000";

async function dispatchParentApi(request: Request, services: Services, segments: string[]): Promise<Response> {
  return handleParentApi(request, services, segments).catch((error) => errorResponse(error));
}

function parentRequest(method: string, path: string, cookie: string, body?: unknown): Request {
  return new Request(`${BASE}/api/v1/parent/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      cookie: `parent_session=${cookie}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("Parent API usuwania przypisań (DELETE /api/v1/parent/assignments/:childId/:deckId)", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
       learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
       learning_app.learning_items, learning_app.deck_versions, learning_app.decks,
       learning_app.assignments cascade`,
    );
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) {
      await dispose();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("DELETE usuwa przypisanie ze statusem 204, a powtórzenie zwraca 404", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const { db } = testDatabase();
    const services = createServices({ db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps });
    await setupParent(services, "parent-assign-pin");
    const { token } = await loginParent(services, "parent-assign-pin");

    const child = await createChild(services, { displayName: "Zosia", avatarKey: "cat" });
    const draft = await createDraft(services, {
      title: "Kolory",
      items: [{ source: "czerwony", target: "red", acceptedAnswers: [], visualType: "none", locales: { source: "pl-PL", target: "en-GB" } }],
    });
    await editDraft(services, draft.id, { title: "Kolory", expectedEditNumber: draft.editNumber });
    await runDueGenerationWork(services);
    await runDueGenerationWork(services);
    await publishDraft(services, draft.id, draft.editNumber + 1);

    // 1. Przypisanie przez PUT
    const putRes = await dispatchParentApi(
      parentRequest("PUT", `assignments/${child.id}/${draft.deckId}`, token, { testDate: "2026-10-30" }),
      services,
      ["assignments", child.id, draft.deckId],
    );
    expect(putRes.status).toBe(204);

    // 2. Pierwsze DELETE -> 204
    const delRes = await dispatchParentApi(
      parentRequest("DELETE", `assignments/${child.id}/${draft.deckId}`, token),
      services,
      ["assignments", child.id, draft.deckId],
    );
    expect(delRes.status).toBe(204);

    // Weryfikacja bazy: wiersz został usunięty (brak sesji)
    const checkDb = await pool.query(
      `select id from learning_app.assignments where child_id = $1 and deck_id = $2`,
      [child.id, draft.deckId],
    );
    expect(checkDb.rows).toHaveLength(0);

    // 3. Drugie DELETE -> 404
    const delRetry = await dispatchParentApi(
      parentRequest("DELETE", `assignments/${child.id}/${draft.deckId}`, token),
      services,
      ["assignments", child.id, draft.deckId],
    );
    expect(delRetry.status).toBe(404);
  });
});
