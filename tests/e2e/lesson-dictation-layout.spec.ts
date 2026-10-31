import { expect, test, type Page } from "@playwright/test";
import type { AttemptDto, DictationDto, TaskDto } from "@learning/contracts";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { expectFrameFillsViewport } from "./helpers/kid-frame";

/**
 * Dyktowanie odpowiedzi otwartej w interfejsie dziecka (Etap 3 przedmiotów
 * szkolnych, API i mikrofon zaślepione w przeglądarce): mikrofon obok pola
 * wieloliniowego, rozpoznany tekst trafia do
 * pola przed „Sprawdź”, a odpowiedź idzie jako tekst z `inputMethod: "speech"`.
 * Dyktowanie to osobny multipart bez klucza próby. W portrecie, niskim
 * landscape (<480 px), na tablecie i desktopie pole, mikrofon i akcje są
 * osiągalne, bez poziomego przepełnienia, z celami ≥48 px i główną akcją
 * ≥54 px. Symulacja nie zastępuje odbioru na fizycznym urządzeniu.
 */

const childId = "10000000-0000-4000-8000-000000000701";
const deckId = "10000000-0000-4000-8000-000000000702";
const sessionId = "10000000-0000-4000-8000-000000000703";
const versionId = "10000000-0000-4000-8000-000000000704";
const openTaskId = "10000000-0000-4000-8000-000000000711";
const shortenTaskId = "10000000-0000-4000-8000-000000000712";

const QUESTION = "Co to jest poziomica i do czego służy na mapie hipsometrycznej?";
const HEARD = "Poziomica to linia na mapie, która łączy punkty położone na tej samej wysokości nad poziomem morza.";
const EDITED = "Poziomica to linia łącząca punkty o tej samej wysokości nad poziomem morza.";
const ORIGINAL = "Wczoraj na wycieczce pani pokazała nam mapę i powiedziała, że poziomica łączy punkty o tej samej wysokości.";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const base = (taskId: string) => ({
  taskId, sessionId, ordinal: 0, exerciseType: "lesson_open_answer" as const, direction: null, state: "issued" as const, remainingAssessed: 4,
});

const openTask: TaskDto = {
  ...base(openTaskId),
  prompt: { kind: "lesson_open_answer", instructionPl: "Odpowiedz własnymi słowami.", prompt: QUESTION, promptLocale: "pl-PL", speechInput: { maxSeconds: 45 } },
};

const shortenTask: TaskDto = {
  ...base(shortenTaskId),
  prompt: {
    kind: "lesson_shorten",
    instructionPl: "Skróć odpowiedź. Usuń zaznaczone fragmenty, zostaw to, co najważniejsze.",
    prompt: QUESTION,
    originalAnswer: ORIGINAL,
    answerSegments: [
      { text: "Wczoraj na wycieczce pani pokazała nam mapę i powiedziała, że ", state: "pill" },
      { text: "poziomica łączy punkty o tej samej wysokości.", state: "plain" },
    ],
    speechInput: { maxSeconds: 45 },
  },
};

const attempt = (attemptId: string, taskId: string): AttemptDto => ({
  attemptId, taskId, state: "completed", modality: "text", feedback: { kind: "great" }, taskState: "answered", stepId: "s1",
  receivedAt: "2026-10-29T10:00:01.000Z", completedAt: "2026-10-29T10:00:01.000Z",
});

function fixture(tasks: TaskDto[], attempts: AttemptDto[] = []): KidUiFixture {
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "owl", recordingMode: "hold" }],
    decks: [{ deckId, title: "Mapa", itemCount: 6, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null, kind: "lesson", subjectTitle: "Geografia" }],
    session: { mode: "training", sessionId, childId, deckId, deckVersionId: versionId,
      policyId: "lesson-default", microphoneEnabled: true, state: "active", taskBudget: 4, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-29T10:00:00.000Z", resumed: false },
    tasks,
    attempts,
  };
}

interface DictationCall { path: string; contentType: string; body: string }

/**
 * Deterministyczny mikrofon (jak w speech-recording-ux): zgoda nadana, strumień
 * liczy zatrzymane ścieżki, MediaRecorder oddaje krótki WebM, a Web Audio
 * dekoduje go do 2 s ciszy — bez zależności od urządzenia hosta CI.
 */
async function installFakeMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as unknown as { __microphoneTrackStops?: number };
    state.__microphoneTrackStops = 0;
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "granted" }) },
    });
    const track = { kind: "audio", stop: () => { state.__microphoneTrackStops = (state.__microphoneTrackStops ?? 0) + 1; }, addEventListener: () => undefined };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
    class FakeMediaRecorder {
      static isTypeSupported(type: string): boolean { return type.includes("webm"); }
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start(): void { this.state = "recording"; }
      stop(): void {
        this.state = "inactive";
        const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67]);
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob([webm]) });
          this.onstop?.();
        });
      }
    }
    (window as unknown as { MediaRecorder: typeof FakeMediaRecorder }).MediaRecorder = FakeMediaRecorder;
    const decoded = (length: number, sampleRate: number) => ({
      duration: length / sampleRate, length, sampleRate, numberOfChannels: 1, getChannelData: () => new Float32Array(length),
    });
    class FakeAudioContext {
      readonly state = "running";
      async decodeAudioData(): Promise<AudioBuffer> { return decoded(96_000, 48_000) as unknown as AudioBuffer; }
      createMediaStreamSource() { return { connect: () => undefined }; }
      createAnalyser() { return { fftSize: 256, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.05), disconnect: () => undefined }; }
      async close(): Promise<void> {}
    }
    class FakeOfflineAudioContext {
      readonly destination = {};
      constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {}
      createBufferSource() { return { buffer: null as AudioBuffer | null, connect: () => undefined, start: () => undefined }; }
      async startRendering(): Promise<AudioBuffer> { return decoded(this.length, this.sampleRate) as unknown as AudioBuffer; }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, "OfflineAudioContext", { configurable: true, value: FakeOfflineAudioContext });
  });
}

async function microphoneTrackStops(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __microphoneTrackStops?: number }).__microphoneTrackStops ?? 0);
}

async function open(page: Page, kidFixture: KidUiFixture, results: DictationDto[]): Promise<DictationCall[]> {
  await installFakeMicrophone(page);
  await installKidUiFixture(page, kidFixture);
  const calls: DictationCall[] = [];
  // po fixture, więc ma pierwszeństwo przed jego trasą „brak dopasowania”
  await page.route("**/api/v1/kid/tasks/*/dictation", async (route) => {
    const request = route.request();
    calls.push({
      path: new URL(request.url()).pathname,
      contentType: request.headers()["content-type"] ?? "",
      body: request.postDataBuffer()?.toString("latin1") ?? "",
    });
    const result = results.shift() ?? { status: "unavailable" };
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(result) });
  });
  await page.setViewportSize(VIEWPORTS[0]!);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-lesson-input")).toBeVisible();
  return calls;
}

/** Dotknij — mów — dotknij: pierwsze dotknięcie włącza mikrofon, kolejne startuje i kończy nagranie. */
async function dictate(page: Page): Promise<void> {
  const record = page.getByTestId("kid-record");
  if ((await record.getAttribute("data-ready")) !== "true") {
    await record.click();
    await expect(record).toHaveAttribute("data-ready", "true");
  }
  await record.click();
  await expect(record).toHaveAttribute("data-phase", "recording");
  await page.waitForTimeout(700);
  await record.click();
  await expect(record).toHaveAttribute("data-phase", "idle");
}

interface Target { testId: string; minHeight?: number }

async function expectReachable(page: Page, viewport: { width: number; height: number }, targets: readonly Target[]): Promise<void> {
  const label = `${viewport.width}x${viewport.height}`;
  await expectFrameFillsViewport(page, viewport);
  const frame = (await page.getByTestId("kid-session-frame").boundingBox())!;
  const material = (await page.getByTestId("kid-material").boundingBox())!;
  expect(material.x, `material left at ${label}`).toBeGreaterThanOrEqual(frame.x - 1);
  expect(material.x + material.width, `material right at ${label}`).toBeLessThanOrEqual(frame.x + frame.width + 1);
  for (const target of targets) {
    const element = page.getByTestId(target.testId);
    await element.scrollIntoViewIfNeeded();
    const bounds = (await element.boundingBox())!;
    const name = `${target.testId} at ${label}`;
    expect(bounds.x, name).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width, name).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y, name).toBeGreaterThanOrEqual(-1);
    expect(bounds.y + bounds.height, name).toBeLessThanOrEqual(viewport.height + 1);
    // w kontenerze materiału, nie tylko w viewporcie
    expect(bounds.x, `${name} inside material`).toBeGreaterThanOrEqual(material.x - 1);
    expect(bounds.x + bounds.width, `${name} inside material`).toBeLessThanOrEqual(material.x + material.width + 1);
    if (target.minHeight !== undefined) {
      expect(bounds.height, name).toBeGreaterThanOrEqual(target.minHeight);
      expect(bounds.width, name).toBeGreaterThanOrEqual(48);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `page overflow at ${label}`).toBe(false);
  expect(await page.getByTestId("kid-material").evaluate((element) => element.scrollWidth > element.clientWidth + 1), `material overflow at ${label}`).toBe(false);
}

const FIELD_TARGETS: Target[] = [
  { testId: "kid-lesson-source" },
  { testId: "kid-lesson-input", minHeight: 48 },
  { testId: "kid-record", minHeight: 48 },
  { testId: "kid-lesson-check", minHeight: 54 },
];

test("open answer: microphone, multi-line field and check fit every form factor", async ({ page }, testInfo) => {
  await open(page, fixture([openTask]), []);
  await expect(page.getByTestId("kid-lesson-source")).toHaveText(QUESTION);
  expect(await page.getByTestId("kid-lesson-input").evaluate((element) => element.tagName)).toBe("TEXTAREA");
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectReachable(page, viewport, [...FIELD_TARGETS, { testId: "kid-not-remember", minHeight: 48 }]);
    await page.screenshot({ path: testInfo.outputPath(`dictation-open-${viewport.width}x${viewport.height}.png`) });
  }
});

test("open answer: heard text lands in the field, can be corrected and is sent as speech", async ({ page }, testInfo) => {
  const posted: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/tasks\/[^/]+\/attempts$/.test(path)) posted.push(request.postDataJSON() as Record<string, unknown>);
  });
  const calls = await open(page, fixture([openTask], [attempt("10000000-0000-4000-8000-000000000721", openTaskId)]), [{ status: "heard", text: HEARD }]);

  await dictate(page);
  await expect(page.getByTestId("kid-lesson-input")).toHaveValue(HEARD);
  await expect(page.getByTestId("kid-record-status")).toHaveText("Sprawdź, czy dobrze cię usłyszałem. Możesz poprawić.");
  expect(calls).toHaveLength(1);
  expect(calls[0]!.path).toBe(`/api/v1/kid/tasks/${openTaskId}/dictation`);
  expect(calls[0]!.contentType).toContain("multipart/form-data");
  expect(calls[0]!.body).toContain('name="audio"');
  expect(calls[0]!.body).not.toContain("clientAttemptId");
  expect(calls[0]!.body).toContain("audio/wav");
  // mikrofon zwolniony po nagraniu (przygotowanie + nagranie zatrzymują swoje ścieżki)
  expect(await microphoneTrackStops(page)).toBeGreaterThanOrEqual(1);
  // nagranie nie tworzy próby
  expect(posted).toEqual([]);

  // długi rozpoznany tekst: pole rośnie albo przewija się, akcje dalej osiągalne
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectReachable(page, viewport, [...FIELD_TARGETS, { testId: "kid-record-status" }]);
    await page.screenshot({ path: testInfo.outputPath(`dictation-heard-${viewport.width}x${viewport.height}.png`) });
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByTestId("kid-lesson-input").fill(EDITED);
  await expectReachable(page, { width: 844, height: 390 }, [{ testId: "kid-lesson-check", minHeight: 54 }]);
  await page.getByTestId("kid-lesson-check").click();
  await expect(page.locator("#kid-feedback-title")).toHaveText("Świetnie!");
  expect(posted).toEqual([expect.objectContaining({ modality: "text", text: EDITED, inputMethod: "speech" })]);
});

test("open answer: failed dictations leave the field untouched and point to typing", async ({ page }) => {
  await open(page, fixture([openTask]), [{ status: "uncertain" }, { status: "no_speech" }]);
  await page.getByTestId("kid-lesson-input").fill("Moja odpowiedź");
  await dictate(page);
  await expect(page.getByTestId("kid-record-status")).toHaveText("Nie usłyszałem wyraźnie. Powiedz jeszcze raz.");
  await expect(page.getByTestId("kid-lesson-input")).toHaveValue("Moja odpowiedź");
  await dictate(page);
  await expect(page.getByTestId("kid-record-status")).toHaveText("Nie usłyszałem wyraźnie. Powiedz jeszcze raz. Napisz odpowiedź w polu.");
  await expect(page.getByTestId("kid-lesson-input")).toBeFocused();
  await expect(page.getByTestId("kid-lesson-input")).toHaveValue("Moja odpowiedź");
});

test("shorten: dictation replaces the field while the marked original stays visible", async ({ page }, testInfo) => {
  await open(page, fixture([shortenTask]), [{ status: "heard", text: EDITED }]);
  await expect(page.getByTestId("kid-lesson-input")).toHaveValue(ORIGINAL);
  await dictate(page);
  await expect(page.getByTestId("kid-lesson-input")).toHaveValue(EDITED);
  await expect(page.getByTestId("kid-lesson-shorten-original")).toBeVisible();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectReachable(page, viewport, [
      { testId: "kid-lesson-shorten-original" },
      { testId: "kid-lesson-input", minHeight: 48 },
      { testId: "kid-record", minHeight: 48 },
      { testId: "kid-lesson-check", minHeight: 54 },
      { testId: "kid-skip", minHeight: 48 },
    ]);
    await page.screenshot({ path: testInfo.outputPath(`dictation-shorten-${viewport.width}x${viewport.height}.png`) });
  }
});
