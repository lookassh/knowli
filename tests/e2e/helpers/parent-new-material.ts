import type { Page } from "@playwright/test";

/**
 * Otwiera modal „Nowy materiał" i wybiera ścieżkę tworzenia.
 * `lesson` klika istniejący testid (opcja menu od razu otwiera formularz lekcji);
 * `generate`/`empty` przechodzą do kroku formularza w modalu.
 */
export async function openNewMaterial(page: Page, option: "generate" | "empty" | "lesson"): Promise<void> {
  await page.getByTestId("new-material-open").click();
  if (option === "generate" || option === "empty") {
    await page.getByTestId(`new-material-${option}`).click();
  } else {
    await page.getByTestId("new-lesson-submit").click();
  }
}
