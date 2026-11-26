import { expect, test, type Page } from "@playwright/test";
import { messages } from "@learning/contracts";

/**
 * Zmiana PIN-u rodzica (#400) z zaślepionym API: prawdziwa zmiana usunęłaby
 * wszystkie sesje rodzica i wywróciła równoległe specy.
 */

type SecretReply = { status: number; json?: unknown };
const NO_CONTENT: SecretReply = { status: 204 };

/** Koperta błędu jak z serwera: {code, message, retryable, requestId}. */
function apiError(code: string, message: string): SecretReply {
  return { status: 401, json: { code, message, retryable: false, requestId: "e2e-request" } };
}

async function openSignedInPanel(page: Page, reply: SecretReply = NO_CONTENT): Promise<string[]> {
  const secretBodies: string[] = [];
  await page.route("**/api/v1/parent/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) {
      return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    }
    if (url.pathname.endsWith("/secret")) {
      secretBodies.push(route.request().postData() ?? "");
      return reply.json === undefined
        ? route.fulfill({ status: reply.status, headers: { "set-cookie": "parent_session=; Path=/; Max-Age=0" } })
        : route.fulfill({ status: reply.status, json: reply.json });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/parent/decks");
  await expect(page.getByTestId("tab-decks")).toBeVisible();
  return secretBodies;
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`zmiana PIN-u @${viewport.width}: niezgodne powtórzenie bez żądania, sukces → ekran logowania`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const secretBodies = await openSignedInPanel(page);

    if (viewport.width < 600) await page.getByTestId("parent-menu").click();
    const trigger = page.getByTestId("change-secret");
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await trigger.click();
    await expect(page.getByTestId("change-secret-dialog")).toBeVisible();

    await page.getByTestId("change-secret-current").fill("stary-pin");
    await page.getByTestId("change-secret-new").fill("nowy-pin");
    await page.getByTestId("change-secret-repeat").fill("inny-pin");
    await page.getByTestId("change-secret-submit").click();
    await expect(page.getByTestId("change-secret-error")).toHaveText(messages.auth.secretMismatch);
    expect(secretBodies).toEqual([]);

    await page.getByTestId("change-secret-repeat").fill("nowy-pin");
    await page.getByTestId("change-secret-submit").click();
    await expect(page.getByTestId("auth-secret")).toBeVisible();
    await expect(page.getByTestId("change-secret-dialog")).toHaveCount(0);
    expect(secretBodies.map((body) => JSON.parse(body) as unknown)).toEqual([{ currentSecret: "stary-pin", newSecret: "nowy-pin" }]);
  });
}

async function submitChange(page: Page): Promise<void> {
  await page.getByTestId("change-secret").click();
  await page.getByTestId("change-secret-current").fill("zly-pin");
  await page.getByTestId("change-secret-new").fill("nowy-pin");
  await page.getByTestId("change-secret-repeat").fill("nowy-pin");
  await page.getByTestId("change-secret-submit").click();
}

test("zły obecny PIN: błąd w oknie, rodzic zostaje zalogowany", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSignedInPanel(page, apiError("invalid_credentials", messages.errors.invalid_credentials));
  await submitChange(page);

  await expect(page.getByTestId("change-secret-error")).toHaveText(messages.errors.invalid_credentials);
  await expect(page.getByTestId("change-secret-dialog")).toBeVisible();
  await expect(page.getByTestId("auth-secret")).toHaveCount(0);
});

test("sesja usunięta w międzyczasie (unauthorized): ekran logowania", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSignedInPanel(page, apiError("unauthorized", messages.errors.unauthorized));
  await submitChange(page);

  await expect(page.getByTestId("auth-secret")).toBeVisible();
  await expect(page.getByTestId("change-secret-dialog")).toHaveCount(0);
});
