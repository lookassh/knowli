import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createDatabase } from "@learning/server";

/**
 * Pełny przepływ dziecka (zadanie 9): ekran profilu/zestawu/nauki/końca,
 * ćwiczenia exposure → rozpoznawanie → Recall z pisownią, przyciski
 * „Nie pamiętam — pokaż” i „Pomiń”, manifest PWA oraz regresje RF5:
 * odmowa mikrofonu, utrata sieci bez fałszywego sukcesu, opuszczenie
 * widoku zatrzymuje nagrywanie.
 */

type NavigatorWithServiceWorker = Navigator & {
  serviceWorker: { getRegistrations(): Promise<unknown[]> };
};

type WorldPool = ReturnType<typeof createDatabase>["pool"];
let worldPool: WorldPool | null = null;

async function pool(): Promise<WorldPool> {
  if (worldPool === null) {
    const world = JSON.parse(
      await readFile(join(process.cwd(), "tests/e2e/.world.json"), "utf8"),
    ) as { databaseUrl: string };
    worldPool = createDatabase(world.databaseUrl).pool;
  }
  return worldPool;
}

test.afterAll(async () => {
  await worldPool?.end();
});

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await (await pool()).query(sql, params);
  return result.rows as T[];
}

async function parentSession(page: Page): Promise<APIRequestContext> {
  const request = page.request;
  await request.post("/api/v1/parent/setup", { data: { secret: "1234" } });
  const login = await request.post("/api/v1/parent/login", { data: { secret: "1234" } });
  expect(login.status()).toBe(200);
  return request;
}

async function createChild(
  parent: APIRequestContext,
  displayName: string,
  avatarKey: string,
): Promise<{ id: string }> {
  const child = await (
    await parent.post("/api/v1/parent/children", { data: { displayName, avatarKey } })
  ).json();
  expect(child.id).toBeDefined();
  return child;
}

async function createAssignedDeck(
  parent: APIRequestContext,
  childId: string,
  title: string,
  idempotencyKey: string,
): Promise<{ deckId: string; publishedVersionId: string }> {
  const generate = await parent.post("/api/v1/parent/decks/generate", {
    data: { prompt: "angielskie dni tygodnia dla początkującego dziecka", idempotencyKey, title },
  });
  expect(generate.status()).toBe(202);
  const { deckId } = await generate.json();

  let draftId: string | null = null;
  for (let attempt = 0; attempt < 120 && draftId === null; attempt++) {
    const deck = await (await parent.get(`/api/v1/parent/decks/${deckId}`)).json();
    if (deck.generation?.state === "succeeded" && deck.draft) {
      draftId = deck.draft.id;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  expect(draftId).not.toBeNull();

  let published = false;
  let editNumber = 0;
  for (let attempt = 0; attempt < 90 && !published; attempt++) {
    const draft = await (await parent.get(`/api/v1/parent/drafts/${draftId}`)).json();
    editNumber = draft.editNumber;
    const audioPending = draft.assets.some(
      (asset: { role: string; state: string }) => asset.role === "target_audio" && asset.state !== "approved",
    );
    if (!audioPending) {
      const result = await parent.post(`/api/v1/parent/drafts/${draftId}/publish`, {
        data: { expectedEditNumber: editNumber },
      });
      published = result.status() === 200;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  expect(published).toBe(true);

  const assign = await parent.put(`/api/v1/parent/assignments/${childId}/${deckId}`, {
    data: { testDate: null },
  });
  expect(assign.status()).toBe(204);

  const deck = await (await parent.get(`/api/v1/parent/decks/${deckId}`)).json();
  return { deckId, publishedVersionId: deck.published.id };
}

interface TaskRow {
  answer_key: { target: string; correctOptionId?: string };
  public_prompt: { options?: { id: string; text: string }[] };
}

async function taskRow(taskId: string): Promise<TaskRow> {
  return (
    await query<TaskRow>(`select answer_key, public_prompt from learning_app.session_tasks where id = $1`, [taskId])
  )[0]!;
}

async function answerTarget(taskId: string): Promise<string> {
  return (await taskRow(taskId)).answer_key.target;
}

async function correctOptionText(taskId: string): Promise<string> {
  const row = await taskRow(taskId);
  const correct = row.public_prompt.options!.find((o) => o.id === row.answer_key.correctOptionId);
  return correct!.text;
}

/** Fixture: należne sprawdzenie danej umiejętności dla elementu o indeksie. */
async function seedDue(childId: string, versionId: string, itemIndex: number, skill: string): Promise<void> {
  const revision = (
    await query<{ id: string }>(
      `select id from learning_app.item_revisions
        where deck_version_id = $1 order by position offset $2 limit 1`,
      [versionId, itemIndex],
    )
  )[0]!;
  const skillVersions = await query<{ skill_version_id: string }>(
    `select skill_version_id from learning_app.item_revision_skills
      where item_revision_id = $1 and skill = $2`,
    [revision.id, skill],
  );
  for (const { skill_version_id } of skillVersions) {
    await query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
       values ($1,$2,'needs_confirmation',3,'2026-10-01T00:00:00Z','test')
       on conflict (child_id, skill_version_id) do update
         set status = 'needs_confirmation', independent_success_streak = 3,
             next_review_at = '2026-10-01T00:00:00Z'`,
      [childId, skill_version_id],
    );
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


/**
 * Wejście w naukę: świat współdzieli bazę między testami, więc przy wielu
 * profilach wybieramy własny; przy pojedynczym ekran wyboru nie istnieje.
 * Czekamy na hydratację — zaraz po goto widać jeszcze ekran ładowania.
 */
async function openLearn(page: Page, childName: string): Promise<void> {
  await page.goto("/learn");
  await page.waitForSelector('[data-testid="kid-profile"], [data-testid="kid-deck"]', { timeout: 30_000 });
  if ((await page.getByTestId("kid-profile").count()) > 0) {
    await page.getByTestId("kid-profile").filter({ hasText: childName }).first().click();
  }
}

async function currentTaskId(page: Page): Promise<string> {
  const id = await page.locator("[data-task-id]").getAttribute("data-task-id");
  expect(id).not.toBeNull();
  return id!;
}

/**
 * Czeka, aż przejście między zadaniami się zakończy: podczas zmiany kroku
 * stara karta zostaje z nieaktywnymi przyciskami, więc czytanie stanu w tym
 * momencie złapałoby poprzednie zadanie.
 */
async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const disabled = [...document.querySelectorAll("[data-testid][disabled]")];
        const input = document.querySelector('[data-testid="kid-input"]');
        if (input !== null && !input.hasAttribute("disabled")) {
          // aktywne pole pisemne: „Sprawdź” czeka tylko na wpisaną treść
          return disabled.every((el) => el.getAttribute("data-testid") === "kid-submit");
        }
        return disabled.length === 0;
      },
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => undefined);
}

/** Prowadzi UI przez prezentacje i zadania z wyborem do momentu spełnienia warunku. */
async function driveUntil(page: Page, stop: () => Promise<boolean>): Promise<void> {
  for (let step = 0; step < 40; step++) {
    await page.waitForSelector('[data-task-id], [data-testid="kid-summary"]', { timeout: 30_000 });
    await settled(page);
    if (await stop()) return;
    if (await page.getByTestId("kid-summary").isVisible()) return;
    if (await page.getByTestId("kid-done").isVisible()) {
      await page.getByTestId("kid-done").click();
      continue;
    }
    if ((await page.getByTestId("kid-option").count()) > 0) {
      const taskId = await currentTaskId(page);
      const correct = await correctOptionText(taskId);
      await page
        .getByTestId("kid-option")
        .filter({ hasText: new RegExp(`^\\s*${escapeRegex(correct)}\\s*$`) })
        .first()
        .click();
      await expect(page.getByTestId("kid-feedback")).toBeVisible();
      await page.getByTestId("kid-next").click();
      continue;
    }
    if ((await page.getByTestId("kid-record").count()) > 0) {
      // ćwiczenie wymowy: nagranie i zatrzymanie domyka zadanie
      await page.getByTestId("kid-record").click();
      await expect(page.getByTestId("kid-recording")).toBeVisible();
      await page.getByTestId("kid-stop-record").click();
      await expect(page.getByTestId("kid-fragment").first()).toHaveClass(/kid-fragment--good/);
      await expect(page.getByTestId("kid-feedback")).toBeVisible();
      await page.getByTestId("kid-next").click();
      continue;
    }
    if ((await page.getByTestId("kid-input").count()) === 0 && (await page.getByTestId("kid-skip").count()) > 0) {
      // wymowa bez mikrofonu — pominięcie bez oceny
      await page.getByTestId("kid-skip").click();
      await expect(page.getByTestId("kid-feedback")).toBeVisible();
      await page.getByTestId("kid-next").click();
      continue;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("driveUntil: przekroczono liczbę kroków");
}

test("jeden profil pomija wybór i prowadzi sesję do obiecanego końca", async ({ page }) => {
  test.slow();
  // sesja z mikrofonem wprowadza też ćwiczenie wymowy (SPEC §13) — fake media
  // podmienia tylko getUserMedia/MediaRecorder, odpowiedź przechodzi prawdziwy kod
  await injectFakeMediaPlatform(page);
  const parent = await parentSession(page);
  // Global setup runs once per E2E process. Earlier tests may leave profiles
  // behind, so make the single-profile scenario independent of test order.
  const existingChildren = (await (await parent.get("/api/v1/parent/children")).json()) as { id: string }[];
  for (const existingChild of existingChildren) {
    const deleted = await parent.delete(`/api/v1/parent/children/${existingChild.id}`);
    expect(deleted.status()).toBe(204);
  }
  const child = await createChild(parent, "Ola", "fox");
  await createAssignedDeck(parent, child.id, "Dni tygodnia", `kid-flow-1-${randomUUID()}`);

  // manifest PWA: polska nazwa, start z ekranu nauki, ikony; brak service
  // workera — aplikacja nie obiecuje nauki offline ani nie cache'uje API
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("Umiem!");
  expect(manifest.lang).toBe("pl-PL");
  expect(manifest.start_url).toBe("/learn");
  const icon192 = manifest.icons.find((icon: { sizes: string }) => icon.sizes.includes("192"));
  expect(icon192).toBeDefined();
  expect((await page.request.get(icon192.src)).status()).toBe(200);
  await page.goto("/learn");
  expect(
    await page.evaluate(() =>
      (navigator as unknown as NavigatorWithServiceWorker).serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.length),
    ),
  ).toBe(0);

  // pojedynczy profil pomija ekran wyboru — od razu zestawy
  await expect(page.getByTestId("kid-deck").first()).toBeVisible();
  await expect(page.getByTestId("kid-profile")).toHaveCount(0);
  await page.getByTestId("kid-deck").first().click();

  let sawRemaining = false;
  let sawIllustration = false;
  let sawExampleAudio = false;
  let sawSpeech = false;
  for (let step = 0; step < 90; step++) {
    await page.waitForSelector('[data-task-id], [data-testid="kid-summary"]', { timeout: 30_000 });
    await settled(page);
    if (await page.getByTestId("kid-summary").isVisible()) break;
    if (await page.getByTestId("kid-remaining").isVisible()) sawRemaining = true;
    if (await page.getByTestId("kid-done").isVisible()) {
      // prezentacja niesie zatwierdzoną ilustrację (SPEC §12.1); karty bez
      // obrazu (sobota/niedziela w fake providerze) pokazują placeholder
      if (await page.getByTestId("kid-illustration").isVisible()) {
        sawIllustration = true;
      }
      // karta ze zdaniem przykładowym ma przycisk jego odsłuchu (SPEC §22)
      if (await page.getByTestId("kid-play-example").isVisible()) {
        await page.getByTestId("kid-play-example").click();
        sawExampleAudio = true;
      }
      await page.getByTestId("kid-done").click();
      continue;
    }
    const taskId = await currentTaskId(page);
    if ((await page.getByTestId("kid-option").count()) > 0) {
      const correct = await correctOptionText(taskId);
      try {
        await page
          .getByTestId("kid-option")
          .filter({ hasText: new RegExp(`^\\s*${escapeRegex(correct)}\\s*$`) })
          .first()
          .click({ timeout: 15_000 });
      } catch {
        console.error(
          "WEDGE-DIAG",
          JSON.stringify({
            taskId,
            correct,
            dom: await page.evaluate(() =>
              [...document.querySelectorAll("[data-testid]")].map((el) => ({
                id: el.getAttribute("data-testid"),
                disabled: el.hasAttribute("disabled"),
                text: el.textContent?.slice(0, 40),
              })),
            ),
            body: await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 200)),
          }),
        );
        throw new Error("wedge on option click");
      }
    } else if ((await page.getByTestId("kid-input").count()) > 0) {
      await page.getByTestId("kid-input").fill(await answerTarget(taskId));
      await page.getByTestId("kid-submit").click();
    } else if ((await page.getByTestId("kid-record").count()) > 0) {
      // ćwiczenie wymowy po sukcesie rozpoznawania (SPEC §12.6, §13): fake
      // mikrofon nagrywa 2 s webm, odpowiedź ustna domyka zadanie
      sawSpeech = true;
      await page.getByTestId("kid-record").click();
      await expect(page.getByTestId("kid-recording")).toBeVisible();
      await page.getByTestId("kid-stop-record").click();
    } else {
      // wymowa bez działającego mikrofonu — świadome pominięcie bez oceny
      await page.getByTestId("kid-skip").click();
    }
    await expect(page.getByTestId("kid-feedback")).toBeVisible();
    await page.getByTestId("kid-next").click();
  }
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  expect(sawRemaining).toBe(true);
  expect(sawIllustration).toBe(true);
  expect(sawSpeech).toBe(true);
  expect(sawExampleAudio).toBe(true);
  // obiecany koniec jest też końcem po stronie serwera
  const sessions = await query<{ state: string }>(
    `select state from learning_app.learning_sessions where child_id = $1 order by started_at`,
    [child.id],
  );
  expect(sessions.at(-1)!.state).toBe("completed");
});

test("popup wyniku mieści się w ekranie telefonu bez przewijania", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 360, height: 640 });
  const parent = await parentSession(page);
  const child = await createChild(parent, "Popup", "fox");
  const { publishedVersionId } = await createAssignedDeck(parent, child.id, "Popup", `popup-${randomUUID()}`);
  await seedDue(child.id, publishedVersionId, 0, "recall");
  await openLearn(page, "Popup");
  await page.getByTestId("kid-deck").first().click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
  const taskId = await currentTaskId(page);
  await page.getByTestId("kid-input").fill("wrong");
  await page.getByTestId("kid-submit").click();

  const feedback = page.getByTestId("kid-feedback");
  const next = page.getByTestId("kid-next");
  async function assertVisibleWithoutScrolling() {
    await expect(feedback).toBeVisible();
    // toBeVisible() alone allows elements below the viewport. Bounding boxes
    // are read before click(), which otherwise scrolls automatically.
    for (const locator of [feedback, next]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    await expect(next).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  }

  await assertVisibleWithoutScrolling();
  await expect(feedback).toHaveClass(/kid-feedback--retry/);
  await page.keyboard.press("Escape");
  await expect(feedback).toBeVisible();
  await next.click();
  await expect(feedback).toHaveCount(0);
  await expect(page.getByTestId("kid-input")).toBeEnabled();
  expect(await currentTaskId(page)).toBe(taskId);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  await page.getByTestId("kid-input").fill(await answerTarget(taskId));
  await page.getByTestId("kid-input").press("Enter");
  await expect(feedback).toContainText("Świetnie");
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 },
    { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await assertVisibleWithoutScrolling();
  }

  // Stress only the rendered content: a long transcript must scroll inside
  // the popup, while the continuation action stays in the viewport.
  await page.setViewportSize({ width: 360, height: 640 });
  await page.locator(".kid-feedback-content").evaluate((element) => {
    const transcript = document.createElement("p");
    transcript.textContent = "Długi tekst odpowiedzi. ".repeat(150);
    element.append(transcript);
  });
  await assertVisibleWithoutScrolling();
  await page.screenshot({ path: test.info().outputPath("feedback-mobile-long.png") });
  expect(await page.locator(".kid-feedback-content").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(5, 5);
  await page.mouse.wheel(0, 600);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await page.keyboard.press("Tab");
  // Chromium may move Tab to browser chrome after the sole modal control.
  // The contract is that focus cannot reach the inert exercise/header.
  expect(await page.evaluate(() =>
    [document.querySelector(".kid-task"), document.querySelector(".kid-header")]
      .some((element) => element?.contains(document.activeElement)),
  )).toBe(false);

  // An unavailable next step must expose the existing recovery action,
  // rather than leave an inert error panel behind the modal.
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route("**/api/v1/kid/sessions/*/next", async (route) => {
    await requestGate;
    await route.abort();
  });
  await next.click();
  await expect(next).toBeDisabled();
  releaseRequest();
  await expect(page.getByTestId("kid-offline")).toBeVisible();
  await expect(feedback).toHaveCount(0);
  await page.unroute("**/api/v1/kid/sessions/*/next");
  await page.getByTestId("kid-retry").click();
  await driveUntil(page, async () => (await page.getByTestId("kid-option").count()) > 0);
  await page.setViewportSize({ width: 360, height: 640 });
  const choiceId = await currentTaskId(page);
  await page.getByTestId("kid-option").filter({ hasText: new RegExp(`^\\s*${escapeRegex(await correctOptionText(choiceId))}\\s*$`) }).first().click();
  await expect(feedback).toContainText("Świetnie");
  await assertVisibleWithoutScrolling();
  await next.click();
  await expect(feedback).toHaveCount(0);
});

test("dwa profile mają osobne sesje", async ({ page }) => {
  test.slow();
  const parent = await parentSession(page);
  const ola = await createChild(parent, "Zosia", "fox");
  const ewa = await createChild(parent, "Ewa", "bear");
  const { deckId } = await createAssignedDeck(parent, ola.id, "Dni tygodnia dla Oli", `kid-flow-2a-${randomUUID()}`);
  const assign = await parent.put(`/api/v1/parent/assignments/${ewa.id}/${deckId}`, { data: { testDate: null } });
  expect(assign.status()).toBe(204);

  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "Kto się dziś uczy?" })).toBeVisible();
  expect(await page.getByTestId("kid-profile").count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("kid-profile").filter({ hasText: "Zosia" })).toHaveCount(1);
  await expect(page.getByTestId("kid-profile").filter({ hasText: "Ewa" })).toHaveCount(1);

  // Bezpośredni link rodzica wybiera Zosię i pomija wybór profilu.
  await page.goto(`/kids/${ola.id}/learn`);
  await expect(page.getByTestId("kid-profile")).toHaveCount(0);
  await expect(page.getByTestId("kid-deck").filter({ hasText: "Dni tygodnia dla Oli" })).toHaveCount(1);

  // Zosia: krótka sesja zakończona wcześniej przez dziecko
  await page.getByTestId("kid-deck").first().click();
  await expect(page.locator("[data-task-id]")).toBeVisible();
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();

  // Ewa: własna, świeża sesja tego samego zestawu
  await page.getByTestId("kid-switch-profile").click();
  await page.getByTestId("kid-profile").filter({ hasText: "Ewa" }).click();
  await page.getByTestId("kid-deck").first().click();
  await expect(page.locator("[data-task-id]")).toBeVisible();

  const olaSessions = await query<{ state: string }>(
    `select state from learning_app.learning_sessions where child_id = $1 order by started_at`,
    [ola.id],
  );
  const ewaSessions = await query<{ state: string }>(
    `select state from learning_app.learning_sessions where child_id = $1 order by started_at`,
    [ewa.id],
  );
  expect(olaSessions.at(-1)!.state).toBe("completed");
  expect(ewaSessions.at(-1)!.state).toBe("active");
});

test("recall z należnego sprawdzenia: pisemna pisownia, Nie pamiętam i Pomiń", async ({ page }) => {
  test.slow();
  const parent = await parentSession(page);
  const child = await createChild(parent, "Cezary", "fox");
  const { publishedVersionId } = await createAssignedDeck(
    parent,
    child.id,
    "Dni tygodnia dla Cezarego",
    `kid-flow-3-${randomUUID()}`,
  );
  await seedDue(child.id, publishedVersionId, 0, "recall");
  await seedDue(child.id, publishedVersionId, 1, "recall");
  await seedDue(child.id, publishedVersionId, 2, "recall");

  await openLearn(page, "Cezary");
  await page.getByTestId("kid-deck").first().click();

  // zadanie 1: samodzielne przypomnienie wpisane z klawiaturą ocenia
  // przypomnienie i pisownię jedną odpowiedzią (SPEC §12.5, §12.8)
  await expect(page.getByTestId("kid-input")).toBeVisible();
  const taskId1 = await currentTaskId(page);
  await page.getByTestId("kid-input").fill(await answerTarget(taskId1));
  await page.getByTestId("kid-submit").click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie");
  await expect(page.getByTestId("kid-feedback")).toHaveClass(/kid-feedback--correct/);
  const grades1 = await query<{ skill: string }>(
    `select skill from learning_app.assessments where attempt_id in
       (select id from learning_app.attempts where task_id = $1)`,
    [taskId1],
  );
  expect(grades1.map((g) => g.skill).sort()).toEqual(["recall", "spelling"]);
  await page.getByTestId("kid-next").click();

  // zadanie 2: „Nie pamiętam — pokaż” ujawnia własne słowo, potem zapisuje
  // zadeklarowaną trudność (nie błąd techniczny, nie mylona para)
  await driveUntil(page, () => page.getByTestId("kid-input").isVisible());
  const taskId2 = await currentTaskId(page);
  const target2 = await answerTarget(taskId2);
  await page.getByTestId("kid-not-remember").click();
  await expect(page.getByTestId("kid-reveal")).toContainText(target2);
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  // zadeklarowana trudność dostaje tło pomyłki, nie sukcesu (SPEC §16)
  await expect(page.getByTestId("kid-feedback")).toHaveClass(/kid-feedback--retry/);
  const modality2 = await query<{ modality: string }>(
    `select modality from learning_app.attempts where task_id = $1`,
    [taskId2],
  );
  expect(modality2[0]!.modality).toBe("dont_remember");
  await page.getByTestId("kid-next").click();

  // zadanie 3: „Pomiń” zamyka zadanie bez oceny wiedzy
  await driveUntil(page, () => page.getByTestId("kid-input").isVisible());
  const taskId3 = await currentTaskId(page);
  await page.getByTestId("kid-skip").click();
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  // brak oceny wiedzy nie jest ani sukcesem, ani pomyłką — tło neutralne
  expect(await page.getByTestId("kid-feedback").getAttribute("class")).not.toContain("kid-feedback--");
  const task3 = await query<{ state: string }>(
    `select state from learning_app.session_tasks where id = $1`,
    [taskId3],
  );
  expect(task3[0]!.state).toBe("skipped");

  // A22: rodzic widzi osobno przypominanie, pisownię i brak oceny wymowy
  await page.goto("/");
  await page.getByTestId("tab-progress").click();
  await page.getByTestId("progress-child").selectOption({ label: "Cezary" });
  await page.getByTestId("progress-deck").selectOption({ label: "Dni tygodnia dla Cezarego" });
  await page.getByTestId("progress-load").click();
  await expect(page.getByTestId("progress-heading")).toContainText("Cezary");
  await expect(page.getByTestId("progress-skill-recall")).toContainText("w trakcie nauki: 2");
  await expect(page.getByTestId("progress-skill-spelling")).toContainText("w trakcie nauki: 2");
  await expect(page.getByTestId("progress-pronunciation")).toContainText("Nie sprawdzono");
});

test("odmowa mikrofonu przełącza na tryb bez nagrywania", async ({ page }) => {
  test.slow();
  const parent = await parentSession(page);
  const child = await createChild(parent, "Darek", "fox");
  const { publishedVersionId } = await createAssignedDeck(
    parent,
    child.id,
    "Dni tygodnia dla Darka",
    `kid-flow-4-${randomUUID()}`,
  );
  await seedDue(child.id, publishedVersionId, 0, "recall");

  await openLearn(page, "Darek");
  await page.getByTestId("kid-deck").first().click();
  await expect(page.getByTestId("kid-record")).toBeVisible();

  // brak zgody na mikrofon: komunikat i kontynuacja bez nagrywania (A12)
  await page.getByTestId("kid-record").click();
  await expect(page.getByTestId("kid-mic-denied")).toBeVisible();
  const taskId = await currentTaskId(page);
  await page.getByTestId("kid-input").fill(await answerTarget(taskId));
  await page.getByTestId("kid-submit").click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie");

  // odmowa zapamiętana lokalnie: kolejna sesja startuje bez mikrofonu
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-feedback")).toHaveCount(0);
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await page.getByTestId("kid-again").click();
  await page.getByTestId("kid-deck").first().click();
  await expect(page.locator("[data-task-id]")).toBeVisible();
  const mic = await query<{ microphone_enabled: boolean }>(
    `select microphone_enabled from learning_app.learning_sessions where child_id = $1 order by started_at`,
    [child.id],
  );
  expect(mic.map((row) => row.microphone_enabled)).toEqual([true, false]);
});

test("błąd sieci pokazuje brak połączenia i nie dopisuje sukcesu", async ({ page }) => {
  test.slow();
  const parent = await parentSession(page);
  const child = await createChild(parent, "Ewelina", "fox");
  await createAssignedDeck(parent, child.id, "Dni tygodnia dla Eweliny", `kid-flow-5-${randomUUID()}`);

  await openLearn(page, "Ewelina");
  await page.getByTestId("kid-deck").first().click();

  // dojdź do pierwszego zadania ocenianego z wyborem odpowiedzi
  await driveUntil(page, () => page.getByTestId("kid-option").first().isVisible());
  const taskId = await currentTaskId(page);
  const correct = await correctOptionText(taskId);

  // utrata sieci: karta zadania znika (ukrycie wzorców), próby zablokowane
  await page.context().setOffline(true);
  await expect(page.getByTestId("kid-offline")).toBeVisible();
  await expect(page.getByTestId("kid-feedback")).toHaveCount(0);
  await expect(page.getByTestId("kid-option")).toHaveCount(0);
  expect(await query(`select id from learning_app.attempts where task_id = $1`, [taskId])).toHaveLength(0);

  // powrót sieci: automatyczne ponowienie odtwarza krok; odpowiedź idzie
  // raz — bez dublowania próby (A20)
  await page.context().setOffline(false);
  await expect(page.getByTestId("kid-option").first()).toBeVisible({ timeout: 30_000 });
  await page
    .getByTestId("kid-option")
    .filter({ hasText: new RegExp(`^\\s*${escapeRegex(correct)}\\s*$`) })
    .first()
    .click();
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  const attempts = await query<{ client_attempt_id: string }>(
    `select client_attempt_id from learning_app.attempts where task_id = $1`,
    [taskId],
  );
  expect(attempts).toHaveLength(1);
});

/**
 * Headless-shell Chromium nie udostępnia urządzeń medialnych, więc polyfill
 * zastępuje API platformowe (getUserMedia/MediaRecorder/Web Audio) fałszywym
 * strumieniem i dekoderem — reszta (kontroler, BrowserRecorder, cykl życia
 * UI i wysyłka PCM WAV) działa na prawdziwym kodzie.
 */
async function injectFakeMediaPlatform(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("test.trackStops") === null) {
      sessionStorage.setItem("test.trackStops", "0");
    }
    const stopTrack = (): void => {
      sessionStorage.setItem("test.trackStops", String(Number(sessionStorage.getItem("test.trackStops") ?? "0") + 1));
    };
    const fakeTrack = {
      kind: "audio",
      label: "fake-mic",
      stop: stopTrack,
      addEventListener: (): void => undefined,
    };
    const fakeStream = {
      getTracks: () => [fakeTrack],
      getAudioTracks: () => [fakeTrack],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    // minimalny ważny webm: EBML header + Segment→Info→Duration 2000 (2 s) —
    // serwer czyta czas trwania z metadanych i odrzuca nagrania bez niego
    const webm = new Uint8Array([
      0x1a, 0x45, 0xdf, 0xa3, 0x80,
      0x18, 0x53, 0x80, 0x67, 0x8c,
      0x15, 0x49, 0xa9, 0x66, 0x87,
      0x44, 0x89, 0x84, 0x44, 0x7a, 0x00, 0x00,
    ]);
    class FakeMediaRecorder {
      static isTypeSupported(mimeType: string): boolean {
        return mimeType.includes("webm");
      }
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start(): void {
        this.state = "recording";
      }
      stop(): void {
        this.state = "inactive";
        // BrowserRecorder składa bajty z ondataavailable i domyka się na onstop
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob([webm]) });
          this.onstop?.();
        });
      }
    }
    (window as unknown as { MediaRecorder: typeof FakeMediaRecorder }).MediaRecorder = FakeMediaRecorder;

    const decodedBuffer = (length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      length,
      sampleRate,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(length),
    });
    class FakeAudioContext {
      async decodeAudioData(): Promise<AudioBuffer> {
        return decodedBuffer(96_000, 48_000) as unknown as AudioBuffer;
      }
      async close(): Promise<void> {}
    }
    class FakeOfflineAudioContext {
      readonly destination = {};
      constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {}
      createBufferSource() {
        return { buffer: null as AudioBuffer | null, connect: () => undefined, start: () => undefined };
      }
      async startRendering(): Promise<AudioBuffer> {
        return decodedBuffer(this.length, this.sampleRate) as unknown as AudioBuffer;
      }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, "OfflineAudioContext", { configurable: true, value: FakeOfflineAudioContext });
  });
}

test("opuszczenie widoku w trakcie nagrywania zatrzymuje strumień", async ({ page }) => {
  test.slow();
  await injectFakeMediaPlatform(page);
  const parent = await parentSession(page);
  const child = await createChild(parent, "Filip", "fox");
  const { publishedVersionId } = await createAssignedDeck(
    parent,
    child.id,
    "Dni tygodnia dla Filipa",
    `kid-flow-6-${randomUUID()}`,
  );
  await seedDue(child.id, publishedVersionId, 0, "recall");

  await openLearn(page, "Filip");
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-record").click();
  await expect(page.getByTestId("kid-recording")).toBeVisible();

  // zakończenie sesji w trakcie nagrywania zatrzymuje strumień mikrofonu
  // (RF5); pełne przejście między dokumentami zwalnia strumień sam browser
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  expect(await page.evaluate(() => Number(sessionStorage.getItem("test.trackStops") ?? "0"))).toBeGreaterThanOrEqual(1);

  // nowa sesja startuje czysto: nagrywanie ponownie dostępne
  await page.getByTestId("kid-again").click();
  await page.getByTestId("kid-deck").first().click();
  await expect(page.locator("[data-task-id]")).toBeVisible();
  await expect(page.getByTestId("kid-recording")).toHaveCount(0);
  await page.getByTestId("kid-record").click();
  await expect(page.getByTestId("kid-recording")).toBeVisible();
});

test("szczegółowe podsumowanie pokazuje samodzielne wyniki i słowa do ćwiczenia na telefonie i tablecie", async ({ page }, testInfo) => {
  const parent = await parentSession(page);
  const child = await createChild(parent, "Podsumowanie", "fox");
  try {
    const { deckId, publishedVersionId } = await createAssignedDeck(parent, child.id, "Podsumowanie słów", `summary-${randomUUID()}`);
    await seedDue(child.id, publishedVersionId, 0, "recall");
    await seedDue(child.id, publishedVersionId, 0, "spelling");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/kids/${child.id}/learn`);
    await expect(page.getByTestId("kid-deck")).toBeVisible();
    await page.getByTestId("kid-mic-toggle").uncheck();
    await page.getByTestId("kid-deck").filter({ hasText: "Podsumowanie słów" }).click();
    await expect(page.getByTestId("kid-input")).toBeVisible();
    const target = await answerTarget(await currentTaskId(page));
    // Fake materiał akceptuje monday i Monday; MONDAY zalicza treść, ale nie pisownię.
    await page.getByTestId("kid-input").fill(target.toUpperCase());
    await page.getByTestId("kid-submit").click();
    await expect(page.getByTestId("kid-feedback")).toBeVisible();
    await page.getByTestId("kid-next").click();
    await expect(page.getByTestId("kid-feedback")).toHaveCount(0);
    await page.getByTestId("kid-end").click();
    await expect(page.getByTestId("kid-summary-recall")).toContainText("1 słowo");
    await expect(page.getByTestId("kid-summary-spelling")).toHaveCount(0);
    await expect(page.getByTestId("kid-summary-practice")).toContainText(target);
    await expect(page.getByTestId("kid-summary-practice")).toContainText("pisownia");
    await expect(page.getByTestId("kid-summary-practice")).not.toContainText("przypominanie");
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 1024 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`summary-${width}.png`), fullPage: true });
    }
    // Kolejna sesja z prezentacją nie dziedziczy poprzedniego sukcesu.
    await page.getByTestId("kid-again").click();
    await expect(page.getByTestId("kid-deck")).toBeVisible();
    await page.getByTestId("kid-deck").filter({ hasText: "Podsumowanie słów" }).click();
    await expect(page.locator("[data-task-id]")).toBeVisible();
    await page.getByTestId("kid-end").click();
    await expect(page.getByTestId("kid-summary-neutral")).toBeVisible();
    await expect(page.getByTestId("kid-summary-recall")).toHaveCount(0);
    await expect(page.getByTestId("kid-summary-practice")).toHaveCount(0);
  } finally {
    // Sprzątanie syntetycznego profilu izoluje kolejne testy.
    expect((await parent.delete(`/api/v1/parent/children/${child.id}`)).status()).toBe(204);
  }
});
