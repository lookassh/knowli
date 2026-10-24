import { expect, test } from "@playwright/test";

test("Mantine child theme stays scoped while navigating between child and parent", async ({ page }) => {
  await page.goto("/parent");
  await expect(page.getByTestId("auth-secret")).toBeVisible();
  const parentBefore = await page.evaluate(() => {
    const input = document.querySelector<HTMLElement>("[data-testid='auth-secret']")!;
    const style = getComputedStyle(input);
    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      fontFamily: style.fontFamily,
      color: style.color,
      borderColor: style.borderColor,
      padding: style.padding,
      lineHeight: style.lineHeight,
      rootScheme: document.documentElement.getAttribute("data-mantine-color-scheme"),
    };
  });

  await page.getByTestId("to-learning").click();
  await expect(page.locator(".kid-theme[data-mantine-color-scheme='dark']")).toBeAttached();
  await page.getByTestId("kid-parent-link").click();
  await expect(page.getByTestId("auth-secret")).toBeVisible();

  const parentAfter = await page.evaluate(() => {
    const input = document.querySelector<HTMLElement>("[data-testid='auth-secret']")!;
    const style = getComputedStyle(input);
    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      fontFamily: style.fontFamily,
      color: style.color,
      borderColor: style.borderColor,
      padding: style.padding,
      lineHeight: style.lineHeight,
      rootScheme: document.documentElement.getAttribute("data-mantine-color-scheme"),
    };
  });

  expect(parentAfter).toEqual(parentBefore);

  await page.getByTestId("to-learning").click();
  await expect(page.locator(".kid-theme[data-mantine-color-scheme='dark']")).toBeAttached();
  await page.goBack();
  await expect(page.getByTestId("auth-secret")).toBeVisible();
  const parentAfterHistory = await page.evaluate(() => {
    const input = document.querySelector<HTMLElement>("[data-testid='auth-secret']")!;
    const style = getComputedStyle(input);
    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      fontFamily: style.fontFamily,
      color: style.color,
      borderColor: style.borderColor,
      padding: style.padding,
      lineHeight: style.lineHeight,
      rootScheme: document.documentElement.getAttribute("data-mantine-color-scheme"),
    };
  });
  expect(parentAfterHistory).toEqual(parentBefore);
});

import type { SessionSummaryDto } from "@learning/contracts";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

test("parent styles remain unchanged after loading a full child session", async ({ page }) => {
  const fixture = pictureChoiceLayoutFixture();
  const secondChildId = "10000000-0000-4000-8000-000000000199";
  fixture.profiles = [...fixture.profiles, {
    ...fixture.profiles[0]!, childId: secondChildId, displayName: "Maja", avatarKey: "fox",
  }];
  fixture.summary = {
    sessionId: fixture.session.sessionId, state: "completed", tasksIssued: 1, assessedTasksIssued: 1,
    endedAt: "2026-10-24T10:01:00.000Z", independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
  } satisfies SessionSummaryDto;
  await installKidUiFixture(page, fixture);
  await page.goto("/parent");
  await expect(page.getByTestId("auth-secret")).toBeVisible();
  const parentBefore = await page.getByTestId("auth-secret").evaluate((input) => {
    const style = getComputedStyle(input);
    return { body: getComputedStyle(document.body).backgroundColor, font: style.fontFamily, color: style.color, border: style.borderColor, padding: style.padding };
  });

  await page.getByTestId("to-learning").click();
  await page.getByTestId("kid-profile").first().click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await page.getByTestId("kid-switch-profile").click();
  await page.getByTestId("kid-parent-link").click();
  await expect(page.getByTestId("auth-secret")).toBeVisible();

  const parentAfter = await page.getByTestId("auth-secret").evaluate((input) => {
    const style = getComputedStyle(input);
    return { body: getComputedStyle(document.body).backgroundColor, font: style.fontFamily, color: style.color, border: style.borderColor, padding: style.padding };
  });
  expect(parentAfter).toEqual(parentBefore);
});
