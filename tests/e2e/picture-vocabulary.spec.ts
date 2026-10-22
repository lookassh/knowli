import { expect, test } from "@playwright/test";
import { assertKidLayout, installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureVocabularyFixture } from "./helpers/picture-fixtures";

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
test(`dziecko nieczytające uczy się bez pola tekstowego (${viewport.width}x${viewport.height})`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await installKidUiFixture(page, pictureVocabularyFixture());
  await page.goto("/");
  await expect(page.getByText("Uczę się bez czytania")).toBeVisible();
  await page.getByTestId("kid-profile").click();
  await expect(page.getByTestId("kid-deck-card").locator(".kid-visual")).toHaveCount(2);
  await expect(page.getByTestId("kid-deck-card").nth(0).locator(".kid-visual")).toHaveAttribute("aria-label", "Kolor");
  await expect(page.getByTestId("kid-deck-card").nth(1).locator(".kid-visual")).toHaveAttribute("aria-label", "4 elementy");
  await page.getByTestId("kid-deck").first().click();
  await assertKidLayout(page);
  await page.screenshot({ path: testInfo.outputPath("picture-task.png") });
  await expect(page.getByTestId("kid-illustration").or(page.locator(".kid-visual"))).toBeVisible();
  await expect(page.getByTestId("kid-done").locator("svg")).toHaveCount(1);
  await expect(page.getByTestId("kid-input")).toHaveCount(0);
  await page.getByTestId("kid-done").click();

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("czerwony");
  await expect(options.first()).not.toContainText("red");
  await options.first().click();
  await assertKidLayout(page);
  await page.screenshot({ path: testInfo.outputPath("picture-feedback.png") });
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await expect(page.getByTestId("kid-again")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("picture-summary.png") });
});
}

test("karta wznowienia używa trybu aktywnej sesji i nie pokazuje nowych startów", async ({ page }) => {
  const fixture = pictureVocabularyFixture();
  fixture.decks = [
    { ...fixture.decks[0]!, resumeOnly: true, activeSession: { sessionId: fixture.session.sessionId, mode: "training" } },
  ];
  fixture.session.resumed = true;
  const startRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/kid/sessions") && request.method() === "POST");
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await expect(page.getByTestId("kid-deck")).toHaveCount(0);
  await expect(page.getByTestId("kid-mock-start")).toHaveCount(0);
  await expect(page.getByTestId("kid-end-active-session")).toBeVisible();
  await page.getByTestId("kid-resume-session").click();
  const request = await startRequest;
  expect(request.postDataJSON()).toMatchObject({ mode: "training", supportsPictureVocabulary: true });
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_exposure");
});

test("mówione instrukcje prowadzą od profilu przez ćwiczenia i feedback do podsumowania", async ({ page }) => {
  const fixture = pictureVocabularyFixture();
  const attempts = fixture.attempts;
  if (!attempts?.[0]) throw new Error("picture attempt fixture missing");
  const listening = fixture.tasks[1];
  if (!listening || listening.prompt.kind !== "picture_listening") throw new Error("picture listening fixture missing");
  const recall = {
    ...listening,
    taskId: "10000000-0000-4000-8000-000000000015",
    ordinal: 2,
    exerciseType: "recall" as const,
    prompt: { kind: "picture_recall" as const, visual: { kind: "color" as const, color: "#ff0000" } },
    remainingAssessed: 1,
  };
  const skipAttempt = {
    ...attempts[0],
    taskId: recall.taskId,
    modality: "skip" as const,
    feedback: { kind: "not_assessed" as const },
    stepId: "step-2",
  };
  fixture.tasks = [fixture.tasks[0]!, listening, recall, null];
  fixture.attempts = [attempts[0], skipAttempt];
  fixture.session.microphoneEnabled = true;
  const keys = ["profile_select", "deck_select", "exposure", "listening", "speech", "recall", "correct", "partial", "incorrect", "unevaluated", "skip", "dont_remember", "end", "retry", "mic_unavailable", "audio_unavailable", "summary"] as const;
  const audioIds = Object.fromEntries(keys.map((key, index) => [key, `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));
  fixture.uiAudio = { ready: true, assets: audioIds };
  const requested: string[] = [];
  let completedPlaybackCount = 0;
  page.on("request", (request) => {
    const match = request.url().match(/\/api\/v1\/media\/([^/?]+)/);
    if (match) requested.push(match[1]!);
  });
  // Kid UI fixture serwuje krótki, dekodowalny WAV; przeglądarka sama go
  // pobiera, dekoduje i emituje rzeczywiste zdarzenie `ended`.
  await page.addInitScript(() => {
    const play = HTMLAudioElement.prototype.play;
    HTMLAudioElement.prototype.play = function () {
      this.addEventListener("ended", () => {
        const count = Number(sessionStorage.getItem("test.guidanceEnded") ?? "0");
        sessionStorage.setItem("test.guidanceEnded", String(count + 1));
      }, { once: true });
      return play.call(this);
    };
  });
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  const waitForCompletedPlayback = async () => {
    completedPlaybackCount += 1;
    await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("test.guidanceEnded") ?? "0")))
      .toBe(completedPlaybackCount);
  };

  await page.getByTestId("kid-profile-guidance").click();
  await expect.poll(() => requested).toContain(audioIds.profile_select);
  await waitForCompletedPlayback();
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck-guidance").click();
  await expect.poll(() => requested).toContain(audioIds.deck_select);
  await waitForCompletedPlayback();
  await page.getByTestId("kid-deck").first().click();

  await page.getByTestId("kid-guidance-play").click();
  await expect.poll(() => requested).toContain(audioIds.exposure);
  await waitForCompletedPlayback();
  await page.getByTestId("kid-done").click();
  await page.getByTestId("kid-guidance-play").click();
  await expect.poll(() => requested).toContain(audioIds.listening);
  await waitForCompletedPlayback();
  await page.getByTestId("kid-option").first().click();
  await page.getByTestId("kid-guidance-play").click();
  await expect.poll(() => requested).toContain(audioIds.correct);
  await waitForCompletedPlayback();
  await page.getByTestId("kid-next").click();

  await page.getByTestId("kid-guidance-play").click();
  await expect.poll(() => requested).toContain(audioIds.recall);
  await waitForCompletedPlayback();
  await page.getByTestId("kid-skip").click();
  await page.getByTestId("kid-guidance-play").click();
  await expect.poll(() => requested).toContain(audioIds.skip);
  await waitForCompletedPlayback();
  await page.getByTestId("kid-next").click();
  await page.getByTestId("kid-summary-guidance").click();
  await expect.poll(() => requested).toContain(audioIds.summary);
  await waitForCompletedPlayback();
});

test("awaria pliku dźwiękowego pokazuje ponowienie i pozwala zakończyć sesję", async ({ page }) => {
  const fixture = pictureVocabularyFixture();
  const badAudioId = "30000000-0000-4000-8000-000000000001";
  const [exposure, ...rest] = fixture.tasks;
  if (!exposure || exposure.prompt.kind !== "picture_exposure") throw new Error("picture exposure fixture missing");
  fixture.tasks = [{ ...exposure, prompt: { ...exposure.prompt, audioAssetId: badAudioId } }, ...rest];
  await installKidUiFixture(page, fixture);
  await page.route(`**/api/v1/media/${badAudioId}`, (route) => route.fulfill({ status: 500, body: "audio unavailable" }));
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await expect(page.getByTestId("kid-task-audio-error")).toContainText("Nagranie jest chwilowo niedostępne");
  await expect(page.getByTestId("kid-task-audio-retry")).toBeVisible();
  await page.getByTestId("kid-task-audio-error").getByText("Koniec").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
});

test("mówione ćwiczenie obrazkowe można świadomie pominąć bez mikrofonu", async ({ page }) => {
  const fixture = pictureVocabularyFixture();
  const source = fixture.tasks[0];
  if (!source || source.prompt.kind !== "picture_exposure") throw new Error("picture exposure fixture missing");
  const taskId = "10000000-0000-4000-8000-000000000016";
  const attempts = fixture.attempts;
  const attempt = attempts?.[0];
  if (!attempt) throw new Error("skip attempt fixture missing");
  fixture.session.microphoneEnabled = true;
  fixture.tasks = [{
    ...source,
    taskId,
    exerciseType: "speech",
    prompt: { kind: "picture_speech", audioAssetId: "10000000-0000-4000-8000-000000000014", visual: source.prompt.visual },
  }, null];
  fixture.attempts = [{ ...attempt, taskId, modality: "skip" }];
  // WR-02: uprawnienie "prompt" (nienadane) blokuje auto-start próby — zgodnie
  // z intencją testu dziecko jest na tym ekranie bez działającego mikrofonu
  // i świadomie używa „Pomiń”, bez żadnego nagrywania.
  await page.addInitScript(() => {
    let calls = 0;
    (window as unknown as { __gumCalls: () => number }).__gumCalls = () => calls;
    const devices = navigator.mediaDevices;
    const original = devices?.getUserMedia?.bind(devices);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          calls += 1;
          if (original) return original(constraints);
          throw new DOMException("Unexpected getUserMedia call", "NotAllowedError");
        },
      },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "prompt" }) },
    });
  });
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();

  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_speech");
  await expect(page.getByTestId("kid-input")).toHaveCount(0);
  // bez nadanego uprawnienia auto-start nie rusza — przycisk pozostaje w idle
  await expect(page.getByTestId("kid-record")).toHaveAttribute("data-phase", "idle");
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => (window as unknown as { __gumCalls: () => number }).__gumCalls())).toBe(0);
  await expect(page.getByTestId("kid-record")).toHaveAttribute("data-phase", "idle");
  // hint uprawnień w slocie nagrywania jest widoczny PRZED pominięciem; po
  // „Pomiń” LearnScreen podmienia cały widok ćwiczenia na feedback, więc
  // asercja elementów ćwiczenia po kliknięciu byłaby wyścigiem z odpowiedzią
  await expect(page.getByTestId("kid-record-status")).toBeVisible();
  await page.getByTestId("kid-skip").click();
  // deterministyczna asercja przejścia na widok feedbacku (z #110); „Dalej”
  // pojawia się w tym widoku — klik sam oczekuje na podmianę
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
});
