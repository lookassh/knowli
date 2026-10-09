import { expect, test, type Page, type Route } from "@playwright/test";

async function enterParent(page: Page): Promise<void> {
  const request = page.request;
  await request.post("/api/v1/parent/setup", { data: { secret: "1234" } });
  const login = await request.post("/api/v1/parent/login", { data: { secret: "1234" } });
  expect(login.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByTestId("tab-decks")).toBeVisible();
  await page.getByTestId("tab-decks").click();
}

test("polling conflict sends the form's base edit number and keeps local correction", async ({ page }) => {
  const pageB = await page.context().newPage();
  let holdNextGet = false;
  let releaseHeldGet: (() => void) | undefined;
  let notifyHeldGet: (() => void) | undefined;
  const heldGet = new Promise<void>((resolve) => { notifyHeldGet = resolve; });
  const releaseGet = new Promise<void>((resolve) => { releaseHeldGet = resolve; });
  await page.route("**/api/v1/parent/decks/*", async (route: Route) => {
    if (route.request().method() === "GET" && holdNextGet) {
      holdNextGet = false;
      notifyHeldGet?.();
      await releaseGet;
    }
    await route.continue();
  });

  await enterParent(page);
  await page.getByTestId("create-empty-submit").click();
  await page.getByTestId("add-item").click();
  await page.getByTestId("item-source-0").fill("kot");
  await page.getByTestId("item-target-0").fill("cat");
  await page.getByTestId("item-visual-0").selectOption("none");
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/v1/parent/drafts/"));
  await page.getByTestId("save-items").click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId("item-audio-state-0")).toContainText("generowanie");
  const title = await page.getByTestId("editor-title").inputValue();
  const localValue = "local correction";
  await page.getByTestId("item-source-0").fill(localValue);

  await enterParent(pageB);
  await pageB.getByTestId("deck-row-0").filter({ hasText: title }).click();
  await expect(pageB.getByTestId("item-source-0")).toHaveValue("kot");

  holdNextGet = true;
  const deckGet = heldGet;
  const remoteRead = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET" || !response.url().includes("/api/v1/parent/decks/")) return false;
    const body = await response.json().catch(() => null) as { draft?: { editNumber?: number } } | null;
    return body?.draft?.editNumber === 3;
  });
  await deckGet;

  await pageB.getByTestId("editor-title").fill("remote version");
  const remoteSave = pageB.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/drafts/"),
  );
  await pageB.getByTestId("save-items").click();
  expect((await remoteSave).status()).toBe(200);
  releaseHeldGet?.();
  await remoteRead;

  let conflictStatus: number | undefined;
  const localSave = page.waitForResponse((response) => {
    if (response.request().method() !== "PATCH" || !response.url().includes("/drafts/")) return false;
    conflictStatus = response.status();
    return true;
  });
  await page.getByTestId("save-items").click();
  await localSave;
  expect(conflictStatus).toBe(409);
  await expect(page.getByTestId("item-source-0")).toHaveValue(localValue);
  await expect(page.getByTestId("editor-title")).toHaveValue(title);
  await pageB.close();
});

test("successful save with a failed refresh stays clean and is not sent again", async ({ page }) => {
  let failNextDeckGet = false;
  await page.route("**/api/v1/parent/decks/*", async (route: Route) => {
    if (route.request().method() === "GET" && failNextDeckGet) {
      failNextDeckGet = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "internal", message: "refresh unavailable" }) });
      return;
    }
    await route.continue();
  });
  await enterParent(page);
  await page.getByTestId("create-empty-submit").click();
  await page.getByTestId("editor-title").fill("Zapisany szkic");

  let patchCount = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/v1/parent/drafts/")) patchCount += 1;
  });
  failNextDeckGet = true;
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/v1/parent/drafts/"));
  const refreshFailed = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/api/v1/parent/decks/") && response.status() === 503);
  await page.getByTestId("save-items").click();
  expect((await saved).status()).toBe(200);
  await refreshFailed;
  await expect(page.getByTestId("api-error")).toContainText("Zapisano, ale nie udało się odświeżyć szkicu.");
  await expect(page.getByTestId("editor-title")).toHaveValue("Zapisany szkic");

  await page.getByTestId("save-items").click();
  await page.waitForTimeout(100);
  expect(patchCount).toBe(1);
});

test("delayed save locks the entire editor until the PATCH completes", async ({ page }) => {
  let releasePatch: (() => void) | undefined;
  let notifyPatch: (() => void) | undefined;
  const patchStarted = new Promise<void>((resolve) => { notifyPatch = resolve; });
  const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
  await page.route("**/api/v1/parent/drafts/*", async (route: Route) => {
    if (route.request().method() === "PATCH") {
      notifyPatch?.();
      await patchGate;
    }
    await route.continue();
  });
  await enterParent(page);
  await page.getByTestId("create-empty-submit").click();
  await page.getByTestId("add-item").click();
  await page.getByTestId("item-source-0").fill("kot");
  await page.getByTestId("item-target-0").fill("cat");
  await page.getByTestId("item-visual-0").selectOption("none");
  await page.getByTestId("add-item").click();
  await page.getByTestId("item-source-1").fill("pies");
  await page.getByTestId("item-target-1").fill("dog");
  await page.getByTestId("item-visual-1").selectOption("none");
  const saveResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/v1/parent/drafts/"));
  await page.getByTestId("save-items").click();
  await patchStarted;

  await expect(page.getByTestId("editor-title")).toBeDisabled();
  await expect(page.getByTestId("item-source-0")).toBeDisabled();
  await expect(page.getByTestId("item-target-1")).toBeDisabled();
  await expect(page.getByTestId("item-visual-0")).toBeDisabled();
  await expect(page.getByTestId("item-remove-1")).toBeDisabled();
  await expect(page.getByTestId("add-item")).toBeDisabled();
  await expect(page.getByTestId("save-items")).toBeDisabled();

  releasePatch?.();
  expect((await saveResponse).status()).toBe(200);
});

test("leaving a dirty editor asks first and Stay preserves the local text", async ({ page }) => {
  await enterParent(page);
  await page.getByTestId("create-empty-submit").click();
  await page.getByTestId("add-item").click();
  await page.getByTestId("item-source-0").fill("kot");
  await page.getByTestId("item-target-0").fill("local correction");
  await page.getByTestId("item-visual-0").selectOption("none");
  let patchCount = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/v1/parent/drafts/")) patchCount += 1;
  });

  await page.getByTestId("editor-back").click();
  await expect(page.getByTestId("leave-editor-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("leave-editor-dialog")).not.toBeVisible();
  await expect(page.getByTestId("editor-back")).toBeFocused();
  await expect(page.getByTestId("item-target-0")).toHaveValue("local correction");

  await page.getByTestId("editor-back").click();
  await expect(page.getByTestId("leave-editor-dialog")).toBeVisible();
  await page.getByTestId("leave-editor-stay").click();
  await expect(page.getByTestId("leave-editor-dialog")).not.toBeVisible();
  await expect(page.getByTestId("item-target-0")).toHaveValue("local correction");
  expect(patchCount).toBe(0);

  await page.getByTestId("editor-back").click();
  await expect(page.getByTestId("leave-editor-dialog")).toBeVisible();
  await page.getByTestId("leave-editor-leave").click();
  await expect(page.getByTestId("editor-back")).toHaveCount(0);
  expect(patchCount).toBe(0);
});

test("tab and logout are guarded; busy save drops the leave request", async ({ page }) => {
  let releasePatch: (() => void) | undefined;
  let notifyPatch: (() => void) | undefined;
  const patchStarted = new Promise<void>((resolve) => { notifyPatch = resolve; });
  const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
  await page.route("**/api/v1/parent/drafts/*", async (route: Route) => {
    if (route.request().method() === "PATCH") {
      notifyPatch?.();
      await patchGate;
    }
    await route.continue();
  });
  await enterParent(page);
  await page.getByTestId("create-empty-submit").click();
  await page.getByTestId("add-item").click();
  await page.getByTestId("item-source-0").fill("kot");
  await page.getByTestId("item-target-0").fill("cat");
  await page.getByTestId("item-visual-0").selectOption("none");
  await page.getByTestId("tab-progress").click();
  await expect(page.getByTestId("leave-editor-dialog")).toBeVisible();
  await page.getByTestId("leave-editor-stay").click();
  await expect(page.getByTestId("item-source-0")).toHaveValue("kot");
  await page.getByTestId("parent-logout").click();
  await expect(page.getByTestId("leave-editor-dialog")).toBeVisible();
  await page.getByTestId("leave-editor-stay").click();

  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/v1/parent/drafts/"));
  await page.getByTestId("save-items").click();
  await patchStarted;
  await page.getByTestId("parent-logout").click();
  await expect(page.getByTestId("leave-editor-dialog")).not.toBeVisible();
  await expect(page.getByTestId("editor-title")).toBeVisible();
  releasePatch?.();
  expect((await saved).status()).toBe(200);
  await page.getByTestId("parent-logout").click();
  await expect(page.getByTestId("auth-secret")).toBeVisible();
});

test("beforeunload warns only while the editor has unsaved changes", async ({ page }) => {
  await enterParent(page);
  await page.getByTestId("create-empty-submit").click();
  await page.getByTestId("editor-title").fill("Niezapisane");
  const dirtyBeforeUnload = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(dirtyBeforeUnload).toBe(true);
  await expect(page.getByTestId("editor-title")).toHaveValue("Niezapisane");

  const savedResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/v1/parent/drafts/"));
  await page.getByTestId("save-items").click();
  expect((await savedResponse).status()).toBe(200);
  await expect(page.getByTestId("api-error")).toHaveCount(0);
  const cleanBeforeUnload = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(cleanBeforeUnload).toBe(false);
  await page.reload();
  await expect(page.getByTestId("tab-decks")).toBeVisible();
});
