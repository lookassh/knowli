import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDatabase } from "@learning/server";
import { expect, test, type Page } from "@playwright/test";
import { messages } from "@learning/contracts";
import { readTestRunConfig } from "../test-run-config";

type WorldPool = ReturnType<typeof createDatabase>["pool"];
let worldPool: WorldPool | null = null;

async function pool(): Promise<WorldPool> {
  if (!worldPool) {
    const world = JSON.parse(
      await readFile(join(process.cwd(), readTestRunConfig(process.env).worldFile), "utf8"),
    ) as { databaseUrl: string };
    worldPool = createDatabase(world.databaseUrl).pool;
  }
  return worldPool;
}

async function enterParent(page: Page): Promise<void> {
  await page.goto("/parent");
  await page.getByTestId("auth-secret").fill("1234");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tab-decks")).toBeVisible();
  await page.getByTestId("tab-decks").click();
}

async function expectSingleGeneration(command: Record<string, unknown>, acceptance: { generationRunId: string; deckId: string }) {
  const sql = await (await pool()).query<{
    run_count: string;
    deck_count: string;
    run_id: string | null;
    deck_id: string | null;
  }>(
    `select count(*)::text as run_count,
            count(distinct d.id)::text as deck_count,
            min(gr.id::text) as run_id,
            min(d.id::text) as deck_id
       from learning_app.generation_runs gr
       join learning_app.deck_versions dv on dv.id = gr.deck_version_id
       join learning_app.decks d on d.id = dv.deck_id
      where gr.kind = 'deck' and gr.dedupe_key = $1`,
    [`deck:${command.idempotencyKey as string}`],
  );
  expect(sql.rows[0]?.run_count).toBe("1");
  expect(sql.rows[0]?.deck_count).toBe("1");
  expect(sql.rows[0]?.run_id).toBe(acceptance.generationRunId);
  expect(sql.rows[0]?.deck_id).toBe(acceptance.deckId);
}

test.afterAll(async () => {
  await worldPool?.end();
});

test("lost 202 response retries the same command and opens its single deck", async ({ page }, testInfo) => {
  const title = `Ponowienie ${randomUUID().slice(0, 8)}`;
  const prompt = "angielskie kolory i liczby dla początkującego dziecka";
  const bodies: Record<string, unknown>[] = [];
  let loseFirstResponse = true;
  let acceptance: { generationRunId: string; deckId: string } | null = null;
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch();
    if (loseFirstResponse) {
      loseFirstResponse = false;
      await route.abort("failed");
      return;
    }
    acceptance = await response.json() as { generationRunId: string; deckId: string };
    await route.fulfill({ response });
  });

  await enterParent(page);
  await page.getByTestId("deck-prompt").fill(prompt);
  await page.getByTestId("deck-title").fill(title);
  await page.getByTestId("deck-vocabulary-format").selectOption("picture");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("api-error")).toHaveText(messages.decks.generationUncertain);
  await expect(page.getByTestId("deck-title")).toBeDisabled();
  await expect(page.getByTestId("deck-prompt")).toBeDisabled();
  await expect(page.getByTestId("create-empty-submit")).toBeDisabled();
  await expect(page.getByTestId("generate-submit")).toHaveText(messages.decks.retryGenerationRequest);
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.evaluate(() => window.innerWidth));
    await page.screenshot({ path: testInfo.outputPath(`uncertain-${viewport.width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("generation-banner")).toContainText(messages.decks.generating);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({ vocabularyFormat: "picture" });

  const command = bodies[0]!;
  const idempotencyKey = command.idempotencyKey as string;
  expect(idempotencyKey).toBeTruthy();
  await expectSingleGeneration(command, acceptance!);
  await expect(page.getByTestId("editor-title")).toHaveValue(title);
});

test("malformed 202 response stays uncertain and retries the original command", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  let acceptance: { generationRunId: string; deckId: string } | null = null;
  let malformed = true;
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch();
    if (malformed) {
      malformed = false;
      await route.fulfill({ status: 202, contentType: "application/json", body: "{" });
      return;
    }
    acceptance = await response.json() as { generationRunId: string; deckId: string };
    await route.fulfill({ response });
  });

  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie kolory dla dziecka");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("api-error")).toHaveText(messages.decks.generationUncertain);
  await expect(page.getByTestId("editor-title")).toHaveCount(0);
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("generation-banner")).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  await expectSingleGeneration(bodies[0]!, acceptance!);
});

test("a 202 with a malformed deck ID is not opened before retry", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  let malformed = true;
  let acceptance: { generationRunId: string; deckId: string } | null = null;
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch();
    if (malformed) {
      malformed = false;
      const json = await response.json() as { generationRunId: string; deckId: string };
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ...json, deckId: "bad-id" }) });
      return;
    }
    acceptance = await response.json() as { generationRunId: string; deckId: string };
    await route.fulfill({ response });
  });

  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie zwierzęta dla dziecka");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("api-error")).toHaveText(messages.decks.generationUncertain);
  await expect(page.getByTestId("editor-title")).toHaveCount(0);
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("generation-banner")).toBeVisible();
  expect(bodies[1]).toEqual(bodies[0]);
  await expectSingleGeneration(bodies[0]!, acceptance!);
});

test("a 500 after acceptance can be retried with one logical generation", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  let failOnce = true;
  let acceptance: { generationRunId: string; deckId: string } | null = null;
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch();
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "internal", message: "server error" }) });
      return;
    }
    acceptance = await response.json() as { generationRunId: string; deckId: string };
    await route.fulfill({ response });
  });

  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie jedzenie dla dziecka");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("api-error")).toHaveText(messages.decks.generationUncertain);
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("generation-banner")).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  await expectSingleGeneration(bodies[0]!, acceptance!);
});

test("two synchronous clicks issue only one generation request", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    requestCount += 1;
    await route.continue();
  });
  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie kolory dla dziecka");
  await page.getByTestId("generate-submit").evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.getByTestId("generation-banner")).toBeVisible();
  expect(requestCount).toBe(1);
});

test("validation unlocks correction while authorization failure sends the parent to login", async ({ page }) => {
  let requestCount = 0;
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    requestCount += 1;
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requestCount === 1) {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "validation", message: "invalid" }) });
      return;
    }
    await route.continue();
  });
  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie kolory dla dziecka");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("api-error")).toHaveText("invalid");
  await expect(page.getByTestId("deck-prompt")).toBeEnabled();
  await page.getByTestId("deck-prompt").fill("angielskie owoce dla dziecka");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("generation-banner")).toBeVisible();
  expect(bodies[0]?.idempotencyKey).not.toBe(bodies[1]?.idempotencyKey);
  expect(bodies[1]?.prompt).toBe("angielskie owoce dla dziecka");
});

test("401 clears the pending command and returns the parent to login", async ({ page }) => {
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "unauthorized", message: "login" }) });
  });
  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie kolory dla dziecka");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("auth-secret")).toBeVisible();
});

test("403 is definitive and allows a corrected generation", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "forbidden", message: "denied" }) });
      return;
    }
    await route.continue();
  });
  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie kolory dla dziecka");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("api-error")).toHaveText("denied");
  await expect(page.getByTestId("deck-prompt")).toBeEnabled();
  await expect(page.getByTestId("generate-submit")).toHaveText(messages.decks.generate);
});

test("a failed list refresh after acceptance keeps the created editor open", async ({ page }) => {
  let failNextList = false;
  let command: Record<string, unknown> | null = null;
  let acceptance: { generationRunId: string; deckId: string } | null = null;
  let postCount = 0;
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    postCount += 1;
    command = route.request().postDataJSON() as Record<string, unknown>;
    const response = await route.fetch();
    acceptance = await response.json() as { generationRunId: string; deckId: string };
    await route.fulfill({ response });
  });
  await page.route("**/api/v1/parent/decks", async (route) => {
    if (route.request().method() === "POST") {
      const response = await route.fetch();
      failNextList = true;
      await route.fulfill({ response });
      return;
    }
    if (route.request().method() === "GET" && failNextList) {
      failNextList = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });
  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie kolory dla dziecka");
  await page.getByTestId("deck-title").fill("Lista może się odświeżyć później");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("editor-title")).toHaveValue("Lista może się odświeżyć później");
  await expect(page.getByTestId("generation-banner")).toBeVisible();
  expect(postCount).toBe(1);
  await expectSingleGeneration(command!, acceptance!);
});

test("a new conscious generation after success uses a new idempotency key", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.continue();
  });
  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie kolory dla dziecka");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("generation-banner")).toBeVisible();
  await page.getByTestId("editor-back").click();
  await page.getByTestId("deck-prompt").fill("angielskie owoce dla dziecka");
  await page.getByTestId("generate-submit").click();
  await expect(page.getByTestId("generation-banner")).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]?.idempotencyKey).not.toBe(bodies[0]?.idempotencyKey);
});

test("a late acceptance after leaving the decks tab does not open an editor", async ({ page }) => {
  let releaseResponse: (() => void) | undefined;
  let notifyResponse: (() => void) | undefined;
  const responseReceived = new Promise<void>((resolve) => { notifyResponse = resolve; });
  const responseRelease = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await page.route("**/api/v1/parent/decks/generate", async (route) => {
    const response = await route.fetch();
    notifyResponse?.();
    await responseRelease;
    await route.fulfill({ response });
  });
  await enterParent(page);
  await page.getByTestId("deck-prompt").fill("angielskie kolory dla dziecka");
  await page.getByTestId("generate-submit").click();
  await responseReceived;
  await page.getByTestId("tab-children").click();
  releaseResponse?.();
  await expect(page.getByTestId("child-name")).toBeVisible();
  await expect(page.getByTestId("editor-title")).toHaveCount(0);
});
