import { expect, type Page } from "@playwright/test";

/** Przygotowuje sesję bez UI, gdy uwierzytelnianie nie jest przedmiotem testu. */
export async function loginParent(page: Page, secret = "1234"): Promise<void> {
  const setup = await page.request.post("/api/v1/parent/setup", { data: { secret } });
  expect([201, 409]).toContain(setup.status());
  const login = await page.request.post("/api/v1/parent/login", { data: { secret } });
  expect(login.status()).toBe(200);
}
