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
