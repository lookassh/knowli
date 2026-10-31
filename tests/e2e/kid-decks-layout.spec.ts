import { expect as baseExpect, test } from "@playwright/test";
import { makeDeck, openDeckScreen, sessionId } from "./helpers/kid-fixtures";
import { expectBandSpansRoot, expectInsideRoot, resizeAndSettle } from "./helpers/kid-layout";

const expect = baseExpect.configure({ timeout: 1_500 });
test.use({ viewport: { width: 390, height: 844 } });

test("deck card actions address the same deck", async ({ page }) => {
  const decks = [makeDeck(0), makeDeck(1)];
  await openDeckScreen(page, decks);
  await page.route("**/api/v1/kid/sessions", async (route) => route.abort());
  const card = page.getByTestId("kid-deck-card").filter({ hasText: decks[1]!.title });
  const learningRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/kid/sessions" && request.method() === "POST");
  await card.getByRole("button", { name: "Ucz się" }).click();
  expect((await learningRequest).postDataJSON()).toMatchObject({ deckId: decks[1]!.deckId, mode: "training" });

  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  const sameCard = page.getByTestId("kid-deck-card").filter({ hasText: decks[1]!.title });
  const mockRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/kid/sessions" && request.method() === "POST");
  await sameCard.getByRole("button", { name: "Próbna kartkówka" }).click();
  expect((await mockRequest).postDataJSON()).toMatchObject({ deckId: decks[1]!.deckId, mode: "mock_test" });
});

test("all assigned decks render in one scrollable list in group order", async ({ page }) => {
  const decks = Array.from({ length: 4 }, (_, index) => makeDeck(index));
  const expectedOrder = [decks[0]!, decks[2]!, decks[1]!, decks[3]!];
  await openDeckScreen(page, decks);

  await expect(page.getByTestId("kid-deck-card")).toHaveCount(4);
  await expect(page.getByTestId("kid-deck-title")).toHaveText(expectedOrder.map((deck) => deck.title));
  await expect(page.getByTestId("kid-deck-meta")).toHaveText(expectedOrder.map(() => "12 słów"));
  await expect(page.getByTestId("kid-section-recommended")).toBeVisible();
  await expect(page.getByTestId("kid-section-other")).toBeVisible();
  await expect(page.getByTestId("kid-decks-next")).toHaveCount(0);
  await expect(page.getByTestId("kid-decks-previous")).toHaveCount(0);
  await expect(page.getByTestId("kid-decks-page")).toHaveCount(0);
});

test("short phone viewport reaches lower decks with microphone settings in the header", async ({ page }) => {
  const decks = [
    makeDeck(0, { recommended: true, title: "Dni tygodnia i pory roku" }),
    makeDeck(1, { recommended: true }),
    makeDeck(2, { recommended: false }),
    makeDeck(3, { recommended: false }),
  ];
  await page.setViewportSize({ width: 360, height: 640 });
  await openDeckScreen(page, decks);
  await expect(page.getByTestId("kid-deck-card")).toHaveCount(4);
  const layout = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
  }));
  expect(layout.documentHeight, JSON.stringify(layout)).toBeGreaterThan(layout.viewportHeight);
  await expect(page.getByTestId("kid-mic-settings")).toBeInViewport();
  const microphoneButton = await page.getByTestId("kid-mic-settings").boundingBox();
  expect(microphoneButton?.width ?? 0).toBeGreaterThanOrEqual(48);
  expect(microphoneButton?.height ?? 0).toBeGreaterThanOrEqual(48);
  await page.getByTestId("kid-mic-settings").click();
  await expect(page.getByTestId("kid-mic-toggle")).not.toBeChecked();
  await expect(page.getByTestId("kid-microphone-hint")).toBeVisible();
  await page.getByTestId("kid-mic-settings").click();

  const lastCard = page.getByTestId("kid-deck-card").filter({ hasText: decks[3]!.title });
  const lastDeckAction = lastCard.getByRole("button", { name: "Ucz się" });
  await lastDeckAction.scrollIntoViewIfNeeded();
  const actionBox = await lastDeckAction.boundingBox();
  expect(actionBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((actionBox?.y ?? Infinity) + (actionBox?.height ?? 0)).toBeLessThanOrEqual(640);

  // Ten test sprawdza dane żądania startu. Nie uruchamia sesji z pustą
  // kolejką zadań fixture (następny request /next nie jest tu skonfigurowany).
  await page.route("**/api/v1/kid/sessions", async (route) => route.abort());
  const learningRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/kid/sessions" && request.method() === "POST");
  await lastCard.getByRole("button", { name: "Ucz się" }).click();
  expect((await learningRequest).postDataJSON()).toMatchObject({ deckId: decks[3]!.deckId, mode: "training", microphoneEnabled: false });
});

test("unavailable mock test is omitted", async ({ page }) => {
  await openDeckScreen(page, [makeDeck(0, { mockTestAvailable: false })]);
  await expect(page.getByTestId("kid-deck-card")).toBeVisible();
  await expect(page.getByTestId("kid-deck-card")).toContainText("Sprawdzian: 23 paź");
  await expect(page.getByTestId("kid-mock-start")).toHaveCount(0);
});

test("long deck titles and actions remain available", async ({ page }) => {
  const title = `Słownictwo ${"bardzo-długa-nazwa-".repeat(8)}`;
  await openDeckScreen(page, [makeDeck(0, { title, mockTestAvailable: false })]);
  const card = page.getByTestId("kid-deck-card");
  await expect(card.getByTestId("kid-deck-title")).toHaveText(title);
  await expect(card.getByTestId("kid-deck-meta")).toHaveText("12 słów");
  const titleFits = await card.getByTestId("kid-deck-title").evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  expect(titleFits, "long title wraps instead of being clipped").toBe(true);
  const microphoneButton = page.getByTestId("kid-mic-settings");
  await microphoneButton.click();
  const microphonePanel = page.getByTestId("kid-mic-settings-panel");
  await expect(microphonePanel).toBeVisible();
  const panelBox = await microphonePanel.boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(390);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(844);
  await microphoneButton.click();
  const start = card.getByRole("button", { name: "Ucz się" });
  await start.scrollIntoViewIfNeeded();
  await expect(start).toBeVisible();
});

test("empty decks and a denied microphone still offer recovery", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("umiem.micDenied", "1"));
  await openDeckScreen(page, []);
  await expect(page.getByText("Nie masz jeszcze zestawów do nauki.")).toBeVisible();
  await page.getByTestId("kid-mic-settings").click();
  await expect(page.getByTestId("kid-mic-denied-hint")).toBeVisible();
  const micBottom = await page.getByTestId("kid-mic-toggle").boundingBox();
  expect(micBottom?.y ?? 0).toBeGreaterThan(0);
  await page.getByTestId("kid-mic-toggle").check();
  await expect(page.getByTestId("kid-mic-denied-hint")).toHaveCount(0);
  await expect(page.getByTestId("kid-parent-link")).toBeVisible();
});

test("deck cards and rows fit portrait, landscape, tablet and desktop", async ({ page }, testInfo) => {
  const longTitle = `Słownictwo ${"bardzo-długa-nazwa-".repeat(4)}`;
  const decks = [
    makeDeck(0, { recommended: true, title: "Dni tygodnia i pory roku" }),
    makeDeck(2, { recommended: false, title: longTitle, resumeOnly: true, activeSession: { sessionId, mode: "training" } }),
    makeDeck(1, { recommended: false }),
    makeDeck(3, { recommended: false, testDate: null, mockTestAvailable: false }),
    makeDeck(5, { recommended: false, title: longTitle }),
  ];
  await openDeckScreen(page, decks);
  await expect(page.getByTestId("kid-deck-card")).toHaveCount(5);

  const cases = [
    { width: 360, height: 800 },
    { width: 844, height: 390 },
    { width: 820, height: 1180 },
    { width: 1440, height: 900 },
  ];
  for (const viewport of cases) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const layout = await page.evaluate(() => {
      const rect = (element: Element) => {
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        root: rect(document.querySelector("[data-kid-screen]")!),
        band: rect(document.querySelector("[data-kid-header='band']")!),
        cards: [...document.querySelectorAll("[data-testid='kid-deck-card']")].map((card) => ({
          ...rect(card),
          overflowX: card.scrollWidth > card.clientWidth + 1,
          buttons: [...card.querySelectorAll("button")].map((button) => ({ testId: button.dataset.testid ?? "", ...rect(button) })),
          title: (() => { const title = card.querySelector("[data-testid='kid-deck-title']")!; return title.scrollWidth > title.clientWidth + 1; })(),
        })),
      };
    });
    expect(layout.scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expectBandSpansRoot(layout, name);
    for (const [index, card] of layout.cards.entries()) {
      expectInsideRoot(card, layout.root, `card ${index}: ${name}`);
      expect(card.right, `card ${index} in viewport: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
      expect(card.overflowX, `card ${index} content overflow: ${name}`).toBe(false);
      expect(card.title, `card ${index} title clipped: ${name}`).toBe(false);
      for (const button of card.buttons) {
        expect(button.height, `card ${index} ${button.testId} height: ${name}`).toBeGreaterThanOrEqual(48);
        expect(button.width, `card ${index} ${button.testId} width: ${name}`).toBeGreaterThanOrEqual(48);
        expect(button.right, `card ${index} ${button.testId} right: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
        if (index < 2 && button.testId !== "kid-mock-start" && button.testId !== "kid-end-active-session") {
          expect(button.height, `recommended ${index} main action height: ${name}`).toBeGreaterThanOrEqual(54);
        }
      }
    }
    // Karta rekomendowana nie dzieli się na kolumny: kolumna ekranu jest ograniczona do 560 px.
    expect(layout.cards[0]!.top, `recommended cards stack: ${name}`).toBeLessThan(layout.cards[1]!.top);
    expect(Math.abs(layout.cards[0]!.left - layout.cards[1]!.left), `recommended cards share a column: ${name}`).toBeLessThanOrEqual(1);
    if (viewport.width === 360 || viewport.width === 844) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("li:has([data-testid='kid-deck-card'])")].every((item) => getComputedStyle(item).opacity === "1"))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`decks-${name}.png`) });
    }
    const last = page.getByTestId("kid-deck-card").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last, `last deck reachable: ${name}`).toBeInViewport({ ratio: 0.98 });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
});

test("a deck with an active session is the first card with a prominent resume action when nothing is recommended", async ({ page }, testInfo) => {
  // Kształt z serwera: wznawiany zestaw nie jest rekomendowany (reporting/kid.ts).
  const resumeDeck = makeDeck(1, { recommended: false, resumeOnly: true, mockTestAvailable: false, activeSession: { sessionId, mode: "training" } });
  const decks = [makeDeck(0, { recommended: false }), resumeDeck, makeDeck(2, { recommended: false })];
  await openDeckScreen(page, decks);

  const cards = page.getByTestId("kid-deck-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toHaveAttribute("data-deck-id", resumeDeck.deckId);
  await expect(page.getByTestId("kid-section-recommended")).toBeVisible();
  const resume = cards.first().getByTestId("kid-resume-session");
  await expect(resume).toBeFocused();
  await expect(resume).toContainText("Wznów naukę");
  await expect(resume).toHaveAttribute("data-variant", "filled");
  await expect(cards.first().getByTestId("kid-end-active-session")).toHaveAttribute("data-variant", "tonal");
  await expect(cards.nth(1).getByTestId("kid-resume-session")).toHaveCount(0);

  for (const viewport of [{ width: 360, height: 800 }, { width: 844, height: 390 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const resumeBox = (await resume.boundingBox())!;
    const endBox = (await cards.first().getByTestId("kid-end-active-session").boundingBox())!;
    expect(resumeBox.height, `resume main action height: ${name}`).toBeGreaterThanOrEqual(54);
    expect(resumeBox.height, `resume is taller than end session: ${name}`).toBeGreaterThan(endBox.height);
    expect(resumeBox.x + resumeBox.width, `resume inside viewport: ${name}`).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal overflow: ${name}`).toBe(true);
    const firstTop = (await cards.first().boundingBox())!.y;
    expect(firstTop, `resume card is first: ${name}`).toBeLessThan((await cards.nth(1).boundingBox())!.y);
    if (viewport.width === 360) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("li:has([data-testid='kid-deck-card'])")].every((item) => getComputedStyle(item).opacity === "1"))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`decks-resume-${name}.png`) });
    }
  }
});

test("microphone settings stay inside portrait, landscape, tablet and desktop viewports", async ({ page }) => {
  const viewports = [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      Object.defineProperty(window, "microphonePermissionRequests", { configurable: true, writable: true, value: 0 });
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = async () => {
          (window as unknown as Window & { microphonePermissionRequests: number }).microphonePermissionRequests++;
          throw new DOMException("Unexpected microphone request", "NotAllowedError");
        };
      }
    });
    await openDeckScreen(page, [makeDeck(0), makeDeck(1)]);
    const button = page.getByTestId("kid-mic-settings");
    const buttonBox = await button.boundingBox();
    expect(buttonBox?.width ?? 0, JSON.stringify(viewport)).toBeGreaterThanOrEqual(48);
    expect(buttonBox?.height ?? 0, JSON.stringify(viewport)).toBeGreaterThanOrEqual(48);
    expect(buttonBox!.x, JSON.stringify(viewport)).toBeGreaterThanOrEqual(0);
    expect(buttonBox!.x + buttonBox!.width, JSON.stringify(viewport)).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(viewport)).toBe(true);

    await button.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("kid-mic-settings-panel");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("kid-mic-toggle").locator("input")).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as Window & { microphonePermissionRequests: number }).microphonePermissionRequests)).toBe(0);
    await page.getByTestId("kid-daily-activity").click();
    await expect(panel).toHaveCount(0);
    await button.click();
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox!.x, JSON.stringify(viewport)).toBeGreaterThanOrEqual(0);
    expect(panelBox!.x + panelBox!.width, JSON.stringify(viewport)).toBeLessThanOrEqual(viewport.width);
    expect(panelBox!.y, JSON.stringify(viewport)).toBeGreaterThanOrEqual(0);
    expect(panelBox!.y + panelBox!.height, JSON.stringify(viewport)).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
    await page.goto("/");
  }
});

test("microphone settings respect safe-area insets", async ({ page }) => {
  const viewport = { width: 844, height: 390 };
  await page.setViewportSize(viewport);
  await openDeckScreen(page, [makeDeck(0)]);
  await page.addStyleTag({ content: ".kid-ui { --kid-safe-left: 32px; --kid-safe-right: 47px; --kid-safe-top: 12px; --kid-safe-bottom: 21px; }" });

  await page.getByTestId("kid-mic-settings").click();
  const panel = page.getByTestId("kid-mic-settings-panel");
  const panelBox = await panel.boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(32);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width - 47);
  expect(panelBox!.y).toBeGreaterThanOrEqual(12);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport.height - 21);
});

test("microphone settings remain inside a short viewport when denial details appear", async ({ page }) => {
  const viewport = { width: 360, height: 320 };
  await page.setViewportSize(viewport);
  await openDeckScreen(page, [makeDeck(0)]);

  const settingsButton = page.getByTestId("kid-mic-settings");
  await settingsButton.click();
  const toggle = page.getByTestId("kid-mic-toggle");
  await toggle.check();
  await expect(settingsButton).toHaveAccessibleName("Odpowiedzi głosowe włączone");
  await toggle.uncheck();
  await expect(page.getByTestId("kid-mic-denied-hint")).toBeVisible();

  const panel = page.getByTestId("kid-mic-settings-panel");
  const panelBox = await panel.boundingBox();
  expect(panelBox!.y).toBeGreaterThanOrEqual(0);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport.height);
});
