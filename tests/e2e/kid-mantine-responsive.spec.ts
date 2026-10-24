import { expect, test } from "@playwright/test";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

test("Mantine picture choices keep their geometry until the server verdict", async ({ page }) => {
  const fixture = pictureChoiceLayoutFixture();
  const attempt = fixture.attempts![0]!;
  let releaseAttempt!: () => void;
  const pendingAttempt = new Promise<void>((resolve) => { releaseAttempt = resolve; });
  let postCount = 0;

  await installKidUiFixture(page, fixture);
  await page.route("**/api/v1/kid/tasks/*/attempts", async (route) => {
    postCount += 1;
    await pendingAttempt;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(attempt) });
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");

  await expect(page.locator(".kid-theme")).toBeVisible();
  await expect(page.locator("[data-kid-screen='true']")).toBeVisible();
  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  const geometry = async () => page.evaluate(() => {
    const rect = (selector: string) => {
      const { x, y, width, height } = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      options: [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")].map((item) => {
        const { x, y, width, height } = item.getBoundingClientRect();
        return { x, y, width, height };
      }),
      instruction: rect("[data-testid='kid-instruction']"),
      content: rect(".kid-material-content"),
      primary: rect("[data-testid='kid-primary-slot']"),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  const before = await geometry();
  expect(before.overflow).toBe(false);
  expect(before.options[2]!.x).toBe(before.options[0]!.x);
  expect(before.options[2]!.y).toBeGreaterThan(before.options[0]!.y);

  await options.first().click();
  await expect.poll(() => postCount).toBe(1);
  await expect(options.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("kid-outcome-correct")).toHaveCount(0);
  const pending = await geometry();
  for (const key of ["instruction", "content", "primary"] as const) {
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(pending[key][dimension] - before[key][dimension]), `${key}.${dimension} moved before feedback`).toBeLessThanOrEqual(1);
    }
  }
  releaseAttempt();
  await expect(page.getByTestId("kid-outcome-correct")).toBeVisible();
  const after = await geometry();
  for (const key of ["instruction", "content", "primary"] as const) {
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(after[key][dimension] - before[key][dimension]), `${key}.${dimension} moved after feedback`).toBeLessThanOrEqual(1);
    }
  }
  for (let index = 0; index < before.options.length; index += 1) {
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(after.options[index]![dimension] - before.options[index]![dimension]), `option ${index}.${dimension} moved`).toBeLessThanOrEqual(1);
    }
  }
});
