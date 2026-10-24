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
