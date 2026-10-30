import { expect, type Page } from "@playwright/test";

/** Ends the running session from the header ✕, through its confirmation sheet. */
export async function endSessionFromHeader(page: Page): Promise<void> {
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-end-confirm")).toBeVisible();
  await page.getByTestId("kid-end-confirm-end").click();
}
