import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createDatabase } from "@learning/server";
import { readTestRunConfig } from "../test-run-config";

test.use({ trace: "off", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

type Pool = ReturnType<typeof createDatabase>["pool"];
let databasePool: Pool | null = null;

async function pool(): Promise<Pool> {
  if (databasePool === null) {
    const world = JSON.parse(await readFile(join(process.cwd(), readTestRunConfig(process.env).worldFile), "utf8")) as { databaseUrl: string };
    databasePool = createDatabase(world.databaseUrl).pool;
  }
  return databasePool;
}

test.afterAll(async () => { await databasePool?.end(); });

async function query<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  return (await (await pool()).query(sql, values)).rows as T[];
}

async function createLearningTask(page: Page, name: string): Promise<void> {
  const parent: APIRequestContext = page.request;
  await parent.post("/api/v1/parent/setup", { data: { secret: "1234" } });
  expect((await parent.post("/api/v1/parent/login", { data: { secret: "1234" } })).status()).toBe(200);
  const child = await (await parent.post("/api/v1/parent/children", { data: { displayName: name, avatarKey: "fox" } })).json() as { id: string };
  const idempotencyKey = `speech-ux-${randomUUID()}`;
  const generated = await parent.post("/api/v1/parent/decks/generate", {
    data: { prompt: "angielskie dni tygodnia dla początkującego dziecka", idempotencyKey, title: `Dni dla ${name}` },
  });
  expect(generated.status()).toBe(202);
  const { deckId } = await generated.json() as { deckId: string };
  let draftId: string | null = null;
  for (let attempt = 0; attempt < 120 && draftId === null; attempt += 1) {
    const deck = await (await parent.get(`/api/v1/parent/decks/${deckId}`)).json();
    if (deck.generation?.state === "succeeded" && deck.draft) draftId = deck.draft.id;
    else await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  expect(draftId).not.toBeNull();
  let publishedVersionId: string | null = null;
  for (let attempt = 0; attempt < 90 && publishedVersionId === null; attempt += 1) {
    const draft = await (await parent.get(`/api/v1/parent/drafts/${draftId}`)).json();
    const pending = draft.assets.some((asset: { role: string; state: string }) => asset.role === "target_audio" && asset.state !== "approved");
    if (!pending) {
      const result = await parent.post(`/api/v1/parent/drafts/${draftId}/publish`, { data: { expectedEditNumber: draft.editNumber } });
      if (result.status() === 200) {
        const updated = await (await parent.get(`/api/v1/parent/decks/${deckId}`)).json();
        publishedVersionId = updated.published.id;
      }
    } else await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  expect(publishedVersionId).not.toBeNull();
  expect((await parent.put(`/api/v1/parent/assignments/${child.id}/${deckId}`, { data: { testDate: null } })).status()).toBe(204);
  const revisions = await query<{ id: string }>(
    "select id from learning_app.item_revisions where deck_version_id = $1 order by position offset 0 limit 1",
    [publishedVersionId],
  );
  const skills = await query<{ skill_version_id: string }>(
    "select skill_version_id from learning_app.item_revision_skills where item_revision_id = $1 and skill = 'recall'",
    [revisions[0]!.id],
  );
  for (const { skill_version_id } of skills) {
    await query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, status, independent_success_streak, next_review_at, projection_version)
       values ($1,$2,'needs_confirmation',3,'2026-10-01T00:00:00Z','test')
       on conflict (child_id, skill_version_id) do update set status='needs_confirmation', independent_success_streak=3, next_review_at='2026-10-01T00:00:00Z'`,
      [child.id, skill_version_id],
    );
  }
  await page.goto(`/kids/${child.id}/learn`);
  await expect(page.getByTestId("kid-deck")).toBeVisible();
  await page.getByTestId("kid-mic-toggle").check();
  await page.getByTestId("kid-deck").filter({ hasText: `Dni dla ${name}` }).click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
}

async function installFakeMicrophone(page: Page, deny = false): Promise<void> {
  await page.addInitScript((shouldDeny) => {
    const track = { kind: "audio", stop: () => undefined, addEventListener: () => undefined };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => {
        if (shouldDeny) throw new DOMException("Permission denied", "NotAllowedError");
        return stream;
      } },
    });
    class FakeMediaRecorder {
      static isTypeSupported(type: string): boolean { return type.includes("webm"); }
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start(): void { this.state = "recording"; }
      stop(): void {
        this.state = "inactive";
        const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x8c, 0x15, 0x49, 0xa9, 0x66, 0x87, 0x44, 0x89, 0x84, 0x44, 0x7a, 0x00, 0x00]);
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob([webm]) });
          this.onstop?.();
        });
      }
    }
    (window as unknown as { MediaRecorder: typeof FakeMediaRecorder }).MediaRecorder = FakeMediaRecorder;
    const decodedBuffer = (length: number, sampleRate: number) => ({
      duration: length / sampleRate, length, sampleRate, numberOfChannels: 1,
      getChannelData: () => new Float32Array(length),
    });
    class FakeAudioContext {
      async decodeAudioData(): Promise<AudioBuffer> { return decodedBuffer(96_000, 48_000) as unknown as AudioBuffer; }
      async close(): Promise<void> {}
    }
    class FakeOfflineAudioContext {
      readonly destination = {};
      constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {}
      createBufferSource() { return { buffer: null as AudioBuffer | null, connect: () => undefined, start: () => undefined }; }
      async startRendering(): Promise<AudioBuffer> { return decodedBuffer(this.length, this.sampleRate) as unknown as AudioBuffer; }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, "OfflineAudioContext", { configurable: true, value: FakeOfflineAudioContext });
  }, deny);
}

test("hold gesture handles keyboard, capture loss and release outside the button", async ({ page }) => {
  test.slow();
  await installFakeMicrophone(page);
  await createLearningTask(page, `Gest ${randomUUID().slice(0, 6)}`);
  const button = page.getByTestId("kid-record");
  await expect(button).toHaveText(/Włącz mikrofon/);
  await button.click();
  await expect(button).toHaveAttribute("data-ready", "true");

  let releaseMicrophoneStart!: () => void;
  await page.evaluate(() => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (window as unknown as { __releaseMicrophoneStart?: () => void }).__releaseMicrophoneStart = release;
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    let delayNext = true;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { ...devices, getUserMedia: async (constraints: MediaStreamConstraints) => {
        if (delayNext) { delayNext = false; await gate; }
        return original(constraints);
      } },
    });
  });
  releaseMicrophoneStart = () => page.evaluate(() => (window as unknown as { __releaseMicrophoneStart?: () => void }).__releaseMicrophoneStart?.());
  await button.focus();
  await page.keyboard.down("Space");
  await expect(button).toHaveAttribute("data-phase", "starting");
  expect(await button.evaluate((element) => (element as HTMLButtonElement).disabled)).toBe(false);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("kid-record");
  await releaseMicrophoneStart();
  await expect(button).toHaveAttribute("data-phase", "recording");
  await page.keyboard.up("Space");
  await expect(button).toHaveAttribute("data-phase", "idle");

  const mode = page.getByTestId("kid-record-mode");
  await mode.click();
  await expect(mode).toHaveAttribute("aria-pressed", "true");
  await mode.click();
  await expect(mode).toHaveAttribute("aria-pressed", "false");
  await mode.focus();
  await page.keyboard.press("Space");
  await expect(mode).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(mode).toHaveAttribute("aria-pressed", "false");

  await button.focus();
  await page.keyboard.down("Space");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.up("Space");
  await expect(button).toHaveAttribute("data-phase", "idle");

  await button.focus();
  await page.keyboard.down("Enter");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.up("Enter");
  await expect(button).toHaveAttribute("data-phase", "idle");

  await page.setViewportSize({ width: 768, height: 1024 });
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(48);
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(150);
  await page.mouse.move(8, 8);
  await page.mouse.up();
  await expect(button).toHaveAttribute("data-phase", "idle");

  const touchX = box!.x + box!.width / 2;
  const touchY = box!.y + box!.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchY, id: 2 }] });
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(350);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 8, y: 8, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await cdp.detach();
});

test("microphone denial leaves the written learning path available", async ({ page }) => {
  await installFakeMicrophone(page, true);
  await createLearningTask(page, `Bez mikrofonu ${randomUUID().slice(0, 6)}`);
  await page.getByTestId("kid-record").click();
  await expect(page.getByTestId("kid-mic-denied")).toBeVisible();
  await expect(page.getByTestId("kid-input")).toBeEnabled();
  await page.getByTestId("kid-input").fill("Monday");
  await expect(page.getByTestId("kid-submit")).toBeEnabled();
});

test("speech feedback stays inline, explains fragments and exposes only the available actions", async ({ page }) => {
  await createLearningTask(page, `Wynik ${randomUUID().slice(0, 6)}`);
  const taskId = await page.locator("[data-task-id]").getAttribute("data-task-id");
  expect(taskId).toBeTruthy();
  const attemptId = randomUUID();
  let submitCount = 0;
  await page.evaluate(() => {
    class FakeAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly src: string) {}
      play(): Promise<void> { setTimeout(() => this.onended?.(), 0); return Promise.resolve(); }
      pause(): void {}
    }
    (window as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;
  });
  await page.route("**/api/v1/kid/tasks/*/attempts", async (route) => {
    submitCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        attemptId,
        taskId,
        state: "completed",
        modality: "audio",
        feedback: {
          kind: "almost",
          heardText: "Thursday ".repeat(10).trim(),
          fragments: [{ text: "Thurs", verdict: "almost" }, { text: "day", verdict: "unknown" }],
          speech: { recognition: "matched", pronunciation: "practice", referenceText: "Thursday" },
          referenceAudioAvailable: true,
        },
        taskState: submitCount === 1 ? "issued" : "answered",
        stepId: "speech-feedback-e2e",
        receivedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }),
    });
  });
  let authorizationCount = 0;
  await page.route("**/api/v1/kid/attempts/*/feedback-audio", async (route) => {
    authorizationCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ attemptId, taskId, stepId: "feedback-audio-e2e", audioAssetId: randomUUID() }),
    });
  });
  await page.route("**/api/v1/media/*", (route) => route.fulfill({ status: 200, contentType: "audio/mpeg", body: Buffer.from([1, 2, 3]) }));

  const input = page.getByTestId("kid-input");
  await input.fill("Thursday");
  await page.getByTestId("kid-submit").click();
  const card = page.getByTestId("kid-speech-feedback");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Usłyszałem:");
  await expect(page.getByTestId("kid-reference-text")).toContainText("Thursday");
  await expect(page.getByRole("list", { name: "Legenda wymowy" })).toContainText("poćwicz go");
  await expect(page.locator("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("kid-speech-feedback-title");

  await page.getByTestId("kid-play-reference").click();
  await expect.poll(() => authorizationCount).toBe(1);
  await page.getByTestId("kid-feedback-retry").click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("kid-record")).toHaveAttribute("data-phase", "idle");
  await input.fill("Thursday");
  await page.getByTestId("kid-submit").click();
  await expect(card).toBeVisible();
  await expect(page.getByTestId("kid-feedback-retry")).toHaveCount(0);
  await expect(page.getByTestId("kid-feedback-skip")).toHaveCount(0);
  await expect(page.getByTestId("kid-next")).toBeVisible();
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByTestId("kid-next")).toBeInViewport();
  }
});
