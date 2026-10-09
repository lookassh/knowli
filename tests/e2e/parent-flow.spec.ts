import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { messages } from "@learning/contracts";

/**
 * Pełny obieg rodzica z zadania 4: generuj → preview/edit → publikuj → przypisz.
 * Świat (baza, web, worker z fake providerami) stawia global-setup i jest
 * współdzielony z innymi specami — własne wiersze lokalizujemy po treści.
 */

const DECK_TITLE = "Dni tygodnia — obieg rodzica";

function deckRow(page: Page) {
  return page.locator('[data-testid^="deck-row"]').filter({ hasText: DECK_TITLE });
}

function isoDate(daysAhead: number): string {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function profileForEditing(page: Page, avatarKey = "fox") {
  await page.goto("/");
  await page.getByTestId("auth-secret").fill("1234");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tab-children")).toBeVisible();
  const name = `Edycja-${randomUUID()}`;
  const response = await page.request.post("/api/v1/parent/children", {
    data: { displayName: name, avatarKey, birthYear: 2018 },
  });
  expect(response.status()).toBe(201);
  const child = await response.json() as { id: string; displayName: string; avatarKey: string; birthYear: number };
  await page.reload();
  await page.getByTestId("tab-children").click();
  const href = `/kids/${child.id}/learn`;
  const row = page.locator('li[data-testid^="child-row-"]').filter({ has: page.locator(`a[href="${href}"]`) });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("child-edit")).toBeVisible({ timeout: 5_000 });
  return { child, row, href, path: `/api/v1/parent/children/${child.id}` };
}

test("edycja profilu: anulowanie, zapis Enter i trwałość danych", async ({ page }) => {
  const { child, row, href, path } = await profileForEditing(page);
  let patches = 0;
  let patchBody: unknown;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && new URL(request.url()).pathname === path) {
      patches++;
      patchBody = request.postDataJSON();
    }
  });
  await row.getByTestId("child-edit").click();
  await expect(row.getByTestId("child-edit-name")).toHaveValue(child.displayName);
  await expect(row.getByTestId("child-edit-avatar")).toHaveValue("fox");
  await expect(row.getByTestId("child-edit-name")).toBeFocused();
  await expect(row.getByTestId("child-edit-save")).toBeDisabled();
  await row.getByTestId("child-edit-name").fill("  ");
  await expect(row.getByTestId("child-edit-save")).toBeDisabled();
  await row.getByTestId("child-edit-cancel").click();
  await expect(row.getByTestId("child-edit")).toBeFocused();
  expect(patches).toBe(0);
  await row.getByTestId("child-edit").click();
  await expect(row.getByTestId("child-edit-name")).toHaveValue(child.displayName);
  const newName = `Nowe-${randomUUID()}`;
  await row.getByTestId("child-edit-name").fill(` ${newName} `);
  await row.getByTestId("child-edit-avatar").selectOption("cat");
  await row.getByTestId("child-edit-name").press("Enter");
  await expect(row).toContainText(newName);
  await expect(row.getByTestId("child-edit")).toBeFocused();
  expect(patches).toBe(1);
  expect(patchBody).toEqual({ displayName: newName, avatarKey: "cat" });
  await expect(row.getByTestId("child-learn-link")).toHaveAttribute("href", href);
  await page.reload();
  await page.getByTestId("tab-children").click();
  await row.getByTestId("child-edit").click();
  await expect(row.getByTestId("child-edit-name")).toHaveValue(newName);
  await expect(row.getByTestId("child-edit-avatar")).toHaveValue("cat");
  const saved = await (await page.request.get("/api/v1/parent/children")).json();
  expect(saved.find((value: { id: string }) => value.id === child.id)).toEqual({ ...child, displayName: newName, avatarKey: "cat" });
});

test("edycja profilu: nieznany awatar i przełączanie formularzy", async ({ page }) => {
  const { child, row, path } = await profileForEditing(page, "legacy");
  const otherResponse = await page.request.post("/api/v1/parent/children", { data: { displayName: `Inne-${randomUUID()}`, avatarKey: "owl" } });
  const other = await otherResponse.json();
  await page.reload();
  await page.getByTestId("tab-children").click();
  const otherRow = page.locator('li[data-testid^="child-row-"]').filter({ has: page.locator(`a[href="/kids/${other.id}/learn"]`) });
  await row.getByTestId("child-edit").click();
  await expect(row.getByTestId("child-edit-avatar")).toHaveValue("legacy");
  await row.getByTestId("child-edit-name").fill("Niezapisane");
  await otherRow.getByTestId("child-edit").click();
  await expect(page.getByTestId("child-edit-name")).toHaveCount(1);
  await row.getByTestId("child-edit").click();
  await expect(row.getByTestId("child-edit-name")).toHaveValue(child.displayName);
  await row.getByTestId("child-edit-name").fill("Poprawione");
  const request = page.waitForRequest((request) => request.method() === "PATCH" && new URL(request.url()).pathname === path);
  await row.getByTestId("child-edit-save").click();
  expect((await request).postDataJSON()).toEqual({ displayName: "Poprawione" });
  await expect(row).toContainText("Poprawione");
  const children = await (await page.request.get("/api/v1/parent/children")).json();
  expect(children.find((value: { id: string }) => value.id === child.id).avatarKey).toBe("legacy");
});

test("edycja profilu: błąd zapisu zachowuje wartości i pozwala ponowić", async ({ page }) => {
  const { row, path } = await profileForEditing(page);
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === "PATCH") await route.fulfill({ status: 500, json: { code: "internal", message: "Błąd zapisu" } });
    else await route.continue();
  });
  await row.getByTestId("child-edit").click();
  await row.getByTestId("child-edit-name").fill("Retry");
  await row.getByTestId("child-edit-avatar").selectOption("panda");
  await row.getByTestId("child-edit-save").click();
  await expect(row.getByRole("alert")).toContainText("Błąd zapisu");
  await expect(row.getByTestId("child-edit-name")).toHaveValue("Retry");
  await expect(row.getByTestId("child-edit-avatar")).toHaveValue("panda");
  await page.unroute(`**${path}`);
  await row.getByTestId("child-edit-save").click();
  await expect(row).toContainText("Retry");
  await expect(row.getByTestId("child-edit-name")).toHaveCount(0);
});

test("edycja profilu: udany zapis i błąd odświeżenia mają osobny komunikat", async ({ page }) => {
  const { child, row } = await profileForEditing(page);
  await row.getByTestId("child-edit").click();
  await row.getByTestId("child-edit-name").fill("Zapisane");
  await page.route("**/api/v1/parent/children", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ status: 500, json: { code: "internal", message: "Błąd listy" } });
    else await route.continue();
  });
  await row.getByTestId("child-edit-save").click();
  await expect(page.getByRole("status")).toContainText("Zapisano zmiany, ale nie udało się odświeżyć listy");
  await expect(row.getByTestId("child-edit-name")).toHaveCount(0);
  await page.unroute("**/api/v1/parent/children");
  const list = await (await page.request.get("/api/v1/parent/children")).json();
  expect(list.find((value: { id: string }) => value.id === child.id).displayName).toBe("Zapisane");
});

test("edycja profilu: blokada podczas żądania i usunięcie w drugim kliencie", async ({ page }) => {
  const { row, path } = await profileForEditing(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let patches = 0;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === "PATCH") { patches++; await gate; }
    await route.continue();
  });
  await row.getByTestId("child-edit").click();
  await row.getByTestId("child-edit-name").fill("Usunięte");
  try {
    await row.getByTestId("child-edit-name").press("Enter");
    await expect(row.getByTestId("child-edit-name")).toBeDisabled();
    await expect(row.getByTestId("child-edit-avatar")).toBeDisabled();
    await expect(row.getByTestId("child-edit-save")).toBeDisabled();
    await expect(row.getByTestId("child-edit-cancel")).toBeDisabled();
    await expect(row.getByRole("button", { name: "Usuń", exact: true })).toBeDisabled();
    await row.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect((await page.request.delete(path)).status()).toBe(204);
  } finally { release(); }
  await expect(row.getByRole("alert")).toBeVisible();
  expect(patches).toBe(1);
  await expect(row.getByTestId("child-edit-name")).toHaveValue("Usunięte");
  await page.reload();
  await page.getByTestId("tab-children").click();
  await expect(row).toHaveCount(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
  test(`edycja profilu: układ ${viewport.width}px i zniknięcie po odświeżeniu`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { row, child } = await profileForEditing(page);
    await row.getByTestId("child-edit").click();
    await expect(row.getByLabel("Imię", { exact: true })).toBeVisible();
    await expect(row.getByLabel("Obrazek", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await row.screenshot({ path: testInfo.outputPath(`profile-edit-${viewport.width}.png`) });
    expect((await page.request.delete(`/api/v1/parent/children/${child.id}`)).status()).toBe(204);
    // Dodanie innego profilu wywołuje istniejące onChanged bez reload.
    await page.getByTestId("child-name").fill(`Nowe-${randomUUID()}`);
    await page.getByTestId("child-add").click();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("child-edit-name")).toHaveCount(0);
  });
}

test("pełny obieg rodzica: generuj, popraw, publikuj, przypisz", async ({ page, request }) => {
  test.slow();

  // Pierwsze uruchomienie w czystym świecie: setup PIN rodzica; w świecie
  // współdzielonym z innymi specami ten sam formularz loguje istniejącym PIN-em.
  await page.goto("/");
  await page.getByTestId("auth-secret").fill("1234");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tab-decks")).toBeVisible();

  // Profile dwojga dzieci — świat współdzieli bazę z innymi specami,
  // więc szukamy wierszy po imieniu, a nie po indeksie.
  await page.getByTestId("tab-children").click();
  await page.getByTestId("child-name").fill("Ala");
  await page.getByTestId("child-year").fill("2018");
  await page.getByTestId("child-add").click();
  const alaRow = page.locator('[data-testid^="child-row"]').filter({ hasText: "Ala" });
  await expect(alaRow).toHaveCount(1);
  const alaLearnLink = alaRow.getByTestId("child-learn-link");
  await expect(alaLearnLink).toHaveAttribute("href", /^\/kids\/[0-9a-f-]{36}\/learn$/);
  await page.getByTestId("child-name").fill("Bartek");
  await page.getByTestId("child-add").click();
  const bartekRow = page.locator('[data-testid^="child-row"]').filter({ hasText: "Bartek" });
  await expect(bartekRow).toHaveCount(1);
  const bartekLearnLink = bartekRow.getByTestId("child-learn-link");
  await expect(bartekLearnLink).toHaveAttribute("href", /^\/kids\/[0-9a-f-]{36}\/learn$/);
  expect(await alaLearnLink.getAttribute("href")).not.toBe(await bartekLearnLink.getAttribute("href"));

  // Nowy zestaw o znanym terminie sprawdzianu (za siedem dni).
  await page.getByTestId("tab-decks").click();
  await page.getByTestId("deck-prompt").fill("angielskie dni tygodnia dla początkującego dziecka");
  await page.getByTestId("deck-title").fill(DECK_TITLE);
  await page.getByTestId("generate-submit").click();
  // panel pokazuje nowy zestaw od razu po przyjęciu polecenia (202)
  await expect(deckRow(page)).toContainText(DECK_TITLE);

  // Odświeżenie strony w trakcie generowania: panel dalej prowadzi przegląd.
  await page.reload();
  await expect(deckRow(page)).toContainText(DECK_TITLE);
  await deckRow(page).click();
  await expect(page.getByTestId("generation-banner")).toContainText(messages.decks.generating);
  await expect(page.getByTestId("item-card-0")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("item-card-6")).toBeVisible();
  await expect(page.getByTestId("item-target-0")).toHaveValue("monday");
  await expect(page.getByTestId("item-accepted-4")).toHaveValue("Friday, Fri.");

  // Odtworzenie audio celu przed edycją.
  await expect(page.getByTestId("item-audio-state-0")).toContainText("gotowe", { timeout: 60_000 });
  const firstAudio = page.waitForResponse((r) => r.url().includes("/api/v1/media/"));
  await page.getByTestId("item-play-0").click();
  const firstAudioResponse = await firstAudio;
  expect(firstAudioResponse.status()).toBe(200);
  expect(firstAudioResponse.headers()["content-type"]).toContain("audio/mpeg");

  // Popraw słowo i wariant; kosztowna regeneracja dopiero po jawnym zapisie.
  await page.getByTestId("item-target-3").fill("thursday");
  await page.getByTestId("item-accepted-3").fill("Thursday");
  await page.getByTestId("save-items").click();
  await expect(page.getByTestId("item-target-3")).toHaveValue("thursday");
  await expect(page.getByTestId("item-audio-state-3")).toContainText("generowanie");

  // Publikacja zablokowana, dopóki obowiązkowe TTS nie jest gotowe.
  await page.getByTestId("publish-deck").click();
  await expect(page.getByTestId("api-error")).toContainText(messages.errors.validation);

  // Nowe audio gotowe → odtworzenie nowego zasobu.
  await expect(page.getByTestId("item-audio-state-3")).toContainText("gotowe", { timeout: 60_000 });
  const fixedAudio = page.waitForResponse((r) => r.url().includes("/api/v1/media/"));
  await page.getByTestId("item-play-3").click();
  const fixedAudioResponse = await fixedAudio;
  expect(fixedAudioResponse.status()).toBe(200);
  expect(fixedAudioResponse.headers()["content-type"]).toContain("audio/mpeg");

  // Zły obraz świadomie pominięty — publikacja bez niego jest dozwolona.
  await page.getByTestId("item-omit-image-3").click();
  await expect(page.getByTestId("item-image-state-3")).toContainText("pominięty");

  for (const index of [0, 1, 2, 4]) {
    await expect(page.getByTestId(`item-image-state-${index}`)).toContainText("gotowy", {
      timeout: 60_000,
    });
  }
  await page.getByTestId("publish-deck").click();
  await expect(page.getByTestId("publish-status")).toContainText(messages.decks.published);

  // Przypisanie dwojgu dzieciom z różnymi terminami sprawdzianu.
  const alaDate = isoDate(7);
  const bartekDate = isoDate(14);
  const alaAssignRow = page.locator('[data-testid^="assign-row-"]').filter({ hasText: "Ala" });
  await alaAssignRow.locator('[data-testid^="assign-date-"]').fill(alaDate);
  await alaAssignRow.locator('[data-testid^="assign-submit-"]').click();
  await expect(page.getByTestId("assignment-row-0")).toContainText(alaDate);
  const bartekAssignRow = page.locator('[data-testid^="assign-row-"]').filter({ hasText: "Bartek" });
  await bartekAssignRow.locator('[data-testid^="assign-date-"]').fill(bartekDate);
  await bartekAssignRow.locator('[data-testid^="assign-submit-"]').click();
  await expect(page.getByTestId("assignment-row-1")).toContainText(bartekDate);

  // Przypisania przeżywają odświeżenie strony.
  await page.reload();
  await deckRow(page).click();
  await expect(page.getByTestId("assignment-row-0")).toContainText(alaDate);
  await expect(page.getByTestId("assignment-row-1")).toContainText(bartekDate);

  // Nowa wersja opublikowanego materiału (SPEC §84): wgląd w opublikowane
  // elementy, szkic v2 z kopią treści i mediów, zmiana znaczenia słowa,
  // ponowna publikacja. Opublikowana wersja pozostaje niezmieniona.
  await expect(page.getByTestId("item-target-0")).toHaveValue("monday");
  await expect(page.getByTestId("item-source-0")).toBeDisabled();
  await page.getByTestId("new-version").click();
  await expect(page.getByTestId("item-source-0")).toBeEnabled();
  const mondaySource = await page.getByTestId("item-source-0").inputValue();
  await page.getByTestId("item-source-0").fill(`${mondaySource} (dzień)`);

  // Klik nie czeka na PATCH: stan mediów weryfikujemy w odpowiedzi zapisu,
  // a nie na DOM, który chwilę po kliknięciu pokazuje jeszcze stan przed zapisem.
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/drafts/"),
  );
  await page.getByTestId("save-items").click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  const savedDraft = (await savedResponse.json()) as {
    items: { revisionId: string }[];
    assets: { itemRevisionId: string; role: string; state: string }[];
  };
  const mondayRevision = savedDraft.items[0]!.revisionId;
  // niezmieniony angielski cel zachowuje gotowe audio bez regeneracji
  const mondayAudio = savedDraft.assets.find(
    (asset) => asset.role === "target_audio" && asset.itemRevisionId === mondayRevision,
  );
  expect(mondayAudio?.state).toBe("approved");
  // obraz ilustruje znaczenie — zmiana źródła planuje nową generację
  const mondayImage = savedDraft.assets.find(
    (asset) => asset.role === "illustration" && asset.itemRevisionId === mondayRevision,
  );
  expect(mondayImage?.state).toBe("pending");

  // publikacja dopiero, gdy nowy obraz dojrzeje w workerze (fake delay 3 s)
  await expect(page.getByTestId("item-image-state-0")).toContainText("generowanie");
  await expect(page.getByTestId("item-image-state-0")).toContainText("gotowy", { timeout: 60_000 });
  await page.getByTestId("publish-deck").click();
  await expect(page.getByTestId("publish-status")).toContainText(messages.decks.published);

  // Nieopublikowana treść nie jest dostępna w Kid API.
  const kid = await request.get("/api/v1/kid/decks?childId=00000000-0000-0000-0000-000000000000");
  expect(kid.status()).toBe(404);
});

const MANUAL_DECK_TITLE = "Dni tygodnia — edycja ręczna";

test("ręczna edycja zestawu: dodaj element, usuń element, zmień tytuł", async ({ page }) => {
  test.slow();

  await page.goto("/");
  await page.getByTestId("auth-secret").fill("1234");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tab-decks")).toBeVisible();

  await page.getByTestId("deck-prompt").fill("angielskie dni tygodnia dla początkującego dziecka");
  await page.getByTestId("deck-title").fill(MANUAL_DECK_TITLE);
  await page.getByTestId("generate-submit").click();
  const manualRow = page.locator('[data-testid^="deck-row"]').filter({ hasText: MANUAL_DECK_TITLE });
  await expect(manualRow).toContainText(MANUAL_DECK_TITLE);
  await manualRow.click();
  await expect(page.getByTestId("item-card-0")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("item-card-6")).toBeVisible();

  // Nowa, pusta karta na końcu listy — dopóki rodzic nie wypełni pól.
  await page.getByTestId("add-item").click();
  await expect(page.getByTestId("item-card-7")).toBeVisible();
  await expect(page.getByTestId("item-source-7")).toHaveValue("");

  // Pusta karta blokuje zapis całości: polski komunikat zanim PATCH poleci na serwer.
  await page.getByTestId("save-items").click();
  await expect(page.getByTestId("api-error")).toContainText(messages.decks.itemIncomplete);

  // Uzupełniona karta zapisuje się jako nowy element; serwer zleca jej media.
  await page.getByTestId("item-source-7").fill("gruszka");
  await page.getByTestId("item-target-7").fill("pear");
  const added = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/drafts/"),
  );
  await page.getByTestId("save-items").click();
  const addedResponse = await added;
  expect(addedResponse.status()).toBe(200);
  const addedDraft = (await addedResponse.json()) as { items: { source: string }[] };
  expect(addedDraft.items).toHaveLength(8);
  expect(addedDraft.items[7]!.source).toBe("gruszka");
  await expect(page.getByTestId("item-audio-state-7")).toContainText("generowanie");
  await expect(page.getByTestId("item-audio-state-7")).toContainText("gotowe", { timeout: 60_000 });

  // Usunięcie karty jest częścią formularza: znika po zapisie jako element wersji.
  await page.getByTestId("item-remove-0").click();
  await expect(page.getByTestId("item-card-7")).toHaveCount(0);
  await expect(page.getByTestId("item-source-0")).toHaveValue("wtorek");
  const removed = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/drafts/"),
  );
  await page.getByTestId("save-items").click();
  const removedResponse = await removed;
  expect(removedResponse.status()).toBe(200);
  const removedDraft = (await removedResponse.json()) as { items: { source: string }[] };
  expect(removedDraft.items).toHaveLength(7);
  expect(removedDraft.items.map((item) => item.source)).not.toContain("poniedziałek");

  // Tytuł edytujemy w tym samym formularzu; wiersz zestawu na liście podąży
  // dopiero po publikacji, więc trwałość sprawdzamy w polu szkicu.
  await page.getByTestId("editor-title").fill(`${MANUAL_DECK_TITLE} v2`);
  const retitled = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/drafts/"),
  );
  await page.getByTestId("save-items").click();
  expect((await retitled).status()).toBe(200);

  await page.reload();
  await manualRow.click();
  await expect(page.getByTestId("editor-title")).toHaveValue(`${MANUAL_DECK_TITLE} v2`);
  await expect(page.getByTestId("item-card-6")).toBeVisible();
  await expect(page.getByTestId("item-card-7")).toHaveCount(0);
  await expect(page.getByTestId("item-source-6")).toHaveValue("gruszka");
  await expect(page.getByTestId("item-target-0")).toHaveValue("tuesday");
});

test("rodzic edytuje progi wymowy i otwiera listę kalibracyjną", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("auth-secret").fill("1234");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tab-children")).toBeVisible();
  await page.getByTestId("tab-children").click();

  const childIndex = await page.locator('[data-testid^="child-row-"]').count();
  const childName = `Kalibracja-${randomUUID().slice(0, 8)}`;
  await page.getByTestId("child-name").fill(childName);
  await page.getByTestId("child-add").click();
  const row = page.locator('[data-testid^="child-row"]').filter({ hasText: childName });
  await expect(row).toBeVisible();
  await page.getByTestId(`child-settings-${childIndex}`).click();
  await expect(page.getByTestId("child-threshold-good")).toHaveValue("70");
  await expect(page.getByTestId("child-threshold-almost")).toHaveValue("50");
  await expect(page.getByTestId("child-attempts")).toBeVisible();

  await page.getByTestId("child-threshold-good").fill("75");
  await page.getByTestId("child-threshold-almost").fill("55");
  const saved = page.waitForResponse(
    (response) => response.url().includes("/pronunciation") && response.request().method() === "PUT" && response.status() === 204,
  );
  await page.getByTestId("child-settings-save").click();
  await saved;
  await page.reload();
  await page.getByTestId("tab-children").click();
  await page.getByTestId(`child-settings-${childIndex}`).click();
  await expect(page.getByTestId("child-threshold-good")).toHaveValue("75");
  await expect(page.getByTestId("child-threshold-almost")).toHaveValue("55");
});
