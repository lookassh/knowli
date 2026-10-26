import type { SessionActivityReport } from "@learning/contracts";
import {
  AttemptDtoSchema,
  DisclosureDtoSchema,
  FeedbackAudioDtoSchema,
  KidDeckDtoSchema,
  KidProfileDtoSchema,
  MockTestSummaryDtoSchema,
  LessonMockTestSummaryDtoSchema,
  PresentationCompletionDtoSchema,
  SessionDtoSchema,
  SessionSummaryDtoSchema,
  TaskDtoSchema,
  UiAudioCatalogDtoSchema,
  type AttemptDto,
  type DisclosureDto,
  type FeedbackAudioDto,
  type KidDeckDto,
  type KidProfileDto,
  type MockTestSummaryDto,
  type LessonMockTestSummaryDto,
  type PresentationCompletionDto,
  type SessionDto,
  type SessionSummaryDto,
  type TaskDto,
  type UiAudioCatalogDto,
} from "@learning/contracts";
import { expect, type Page } from "@playwright/test";

export interface KidUiFixture {
  profiles: KidProfileDto[];
  decks: KidDeckDto[];
  session: SessionDto;
  tasks: readonly (TaskDto | null)[];
  attempts?: readonly AttemptDto[];
  disclosure?: DisclosureDto;
  presentation?: PresentationCompletionDto;
  summary?: SessionSummaryDto;
  /** Test transport ACK loss and idempotent redelivery without simulating a pre-acceptance failure. */
  dropFirstEndResponse?: boolean;
  endActivityResults?: NonNullable<SessionSummaryDto["activity"]>[];
  /** Kolejne trwałe odpowiedzi GET statusu aktywności po zaakceptowaniu raportu. */
  activityResultResults?: NonNullable<SessionSummaryDto["activity"]>[];
  mockSummary?: MockTestSummaryDto;
  lessonMockSummary?: LessonMockTestSummaryDto;
  feedbackAudio?: FeedbackAudioDto;
  uiAudio?: UiAudioCatalogDto;
  /** Obserwuje raport aktywności dostarczony przy końcu sesji (jeden na sesję). */
  onEndSession?: (report: SessionActivityReport) => void;
}

export async function installKidUiFixture(page: Page, fixture: KidUiFixture): Promise<void> {
  KidProfileDtoSchema.array().parse(fixture.profiles);
  KidDeckDtoSchema.array().parse(fixture.decks);
  SessionDtoSchema.parse(fixture.session);
  fixture.tasks.forEach((task) => { if (task !== null) TaskDtoSchema.parse(task); });
  fixture.attempts?.forEach((attempt) => AttemptDtoSchema.parse(attempt));
  if (fixture.disclosure) DisclosureDtoSchema.parse(fixture.disclosure);
  if (fixture.presentation) PresentationCompletionDtoSchema.parse(fixture.presentation);
  if (fixture.summary) SessionSummaryDtoSchema.parse(fixture.summary);
  if (fixture.mockSummary) MockTestSummaryDtoSchema.parse(fixture.mockSummary);
  if (fixture.lessonMockSummary) LessonMockTestSummaryDtoSchema.parse(fixture.lessonMockSummary);
  if (fixture.feedbackAudio) FeedbackAudioDtoSchema.parse(fixture.feedbackAudio);
  if (fixture.uiAudio) UiAudioCatalogDtoSchema.parse(fixture.uiAudio);

  let taskIndex = 0;
  let sessionStartCount = 0;
  let attemptPostIndex = 0;
  let endRequestCount = 0;
  let activityResultReadCount = 0;
  const attemptReadIndex = new Map<string, number>();
  await page.route("**/api/v1/kid/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const missing = async (description: string) => {
      await route.abort("failed");
      throw new Error(`Kid UI fixture is missing a response for ${method} ${path}: ${description}`);
    };

    if (method === "GET" && path === "/api/v1/kid/profiles") return json(fixture.profiles);
    if (method === "GET" && path === "/api/v1/kid/ui-audio") return json(fixture.uiAudio ?? { ready: false, assets: {} });
    if (method === "GET" && path === "/api/v1/kid/decks") return json(fixture.decks);
    if (method === "POST" && path === "/api/v1/kid/sessions") {
      if (sessionStartCount > 0) { taskIndex = 0; attemptPostIndex = 0; }
      sessionStartCount += 1;
      return json(fixture.session);
    }
    if (method === "POST" && path === `/api/v1/kid/sessions/${fixture.session.sessionId}/disable-microphone`) return json({ ...fixture.session, microphoneEnabled: false });
    if (method === "POST" && path === `/api/v1/kid/sessions/${fixture.session.sessionId}/next`) {
      // Wyczerpana kolejka = koniec sesji (204 jak prawdziwe API): kontroler
      // pobiera następne zadanie w tle już przy feedbacku (prefetch), więc
      // specyfikacje samego feedbacku nie muszą dokładać pustego zadania.
      if (taskIndex >= fixture.tasks.length) return route.fulfill({ status: 204 });
      const task = fixture.tasks[taskIndex++];
      if (task === null) return route.fulfill({ status: 204 });
      return json(task);
    }
    if (method === "POST" && /\/tasks\/[^/]+\/events$/.test(path)) return route.fulfill({ status: 204 });
    if (method === "POST" && /\/tasks\/[^/]+\/disclosures$/.test(path)) {
      if (!fixture.disclosure) return missing("disclosure is not configured");
      return json(fixture.disclosure);
    }
    if (method === "POST" && /\/complete-presentation$/.test(path)) {
      if (!fixture.presentation) return missing("presentation completion is not configured");
      return json(fixture.presentation);
    }
    if (method === "POST" && /\/tasks\/[^/]+\/attempts$/.test(path)) {
      const attempt = fixture.attempts?.[attemptPostIndex];
      if (!attempt) return missing("attempt queue exhausted");
      attemptPostIndex += 1;
      attemptReadIndex.set(attempt.attemptId, attemptPostIndex);
      return json(attempt);
    }
    if (method === "GET" && /\/attempts\/[^/]+$/.test(path)) {
      const attemptId = path.split("/").at(-1)!;
      const start = attemptReadIndex.get(attemptId);
      if (start === undefined || !fixture.attempts?.[start]) return missing("attempt read is not configured");
      const attempt = fixture.attempts[start]!;
      attemptReadIndex.set(attemptId, start + 1);
      return json(attempt);
    }
    if (method === "POST" && /\/feedback-audio$/.test(path)) {
      if (!fixture.feedbackAudio) return missing("feedback audio is not configured");
      return json(fixture.feedbackAudio);
    }
    if (method === "POST" && path === `/api/v1/kid/sessions/${fixture.session.sessionId}/end`) {
      if (!fixture.summary) return missing("session summary is not configured");
      const body = request.postDataJSON() as { activityReport?: unknown } | null;
      if (body?.activityReport !== undefined) fixture.onEndSession?.(body.activityReport as SessionActivityReport);
      endRequestCount += 1;
      if (fixture.dropFirstEndResponse && endRequestCount === 1) return route.abort("failed");
      const activity = fixture.endActivityResults?.[endRequestCount - (fixture.dropFirstEndResponse ? 2 : 1)];
      return json(activity ? { ...fixture.summary, activity } : fixture.summary);
    }
    if (method === "GET" && path === `/api/v1/kid/sessions/${fixture.session.sessionId}/activity-result`) {
      const activity = fixture.activityResultResults?.[activityResultReadCount++];
      if (!activity) return missing("activity-result is not configured");
      return json(activity);
    }
    if (method === "GET" && path === `/api/v1/kid/sessions/${fixture.session.sessionId}/mock-test-summary`) {
      if (fixture.lessonMockSummary) return json(fixture.lessonMockSummary);
      if (!fixture.mockSummary) return missing("mock-test summary is not configured");
      return json(fixture.mockSummary);
    }
    return missing("no matching fixture route");
  });
  await page.route("**/api/v1/media/**", async (route) => {
    if (fixture.uiAudio?.ready) {
      // Krótki, prawidłowy WAV ciszy używany wyłącznie do sprawdzenia pobrania,
      // dekodowania i zdarzenia ended. Nie jest dowodem jakości TTS.
      const samples = 80;
      const bytes = Buffer.alloc(44 + samples * 2);
      bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
      bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
      bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
      bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
      await route.fulfill({ status: 200, contentType: "audio/wav", body: bytes });
      return;
    }
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="#96a8ef"/></svg>' });
  });
}

export async function assertKidLayout(
  page: Page,
  options: { allowDetailsScroll?: boolean } = {},
): Promise<void> {
  const frame = page.getByTestId("kid-session-frame");
  await expect(frame).toBeVisible();
  const bounds = await frame.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width + 1);
  if (!options.allowDetailsScroll) {
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height + 1);
  }
  await expect(page.getByTestId("kid-end")).toBeInViewport();
}
