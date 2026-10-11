import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messages } from "@learning/contracts";
import { LearnScreen } from "../../../../packages/kid-ui/src/screens/LearnScreen";
import type { LearningScreen, LearningSessionController } from "../../../../packages/kid-ui/src/session/session-controller";

const screen: LearningScreen = {
  kind: "learning",
  session: {
    mode: "training", sessionId: "10000000-0000-4000-8000-000000000001",
    childId: "10000000-0000-4000-8000-000000000002",
    deckId: "10000000-0000-4000-8000-000000000003",
    deckVersionId: "10000000-0000-4000-8000-000000000004",
    policyId: "default", microphoneEnabled: true, state: "active",
    taskBudget: 10, tasksIssued: 0, assessedTasksIssued: 0,
    startedAt: "2026-10-11T10:00:00.000Z", resumed: false,
  },
  task: null, feedback: null, reveal: null, offline: false, busy: false,
  micDenied: false, microphoneReady: false, recordingPhase: "idle", inputLevel: null,
  recordingNotice: null, recordingMode: "hold", recording: false, processing: false, error: null,
};

function render(overrides: Partial<LearningScreen> = {}) {
  // Rendering does not execute handlers; only the remaining counter is read.
  const controller = { remainingFor: () => null } as unknown as LearningSessionController;
  return renderToStaticMarkup(createElement(LearnScreen, { screen: { ...screen, ...overrides }, controller }));
}

describe("status mikrofonu w nagłówku sesji", () => {
  it("odmowa pokazuje nazwany wskaźnik i zwijane wyjaśnienie zamiast stałego banera", () => {
    const html = render({ micDenied: true });
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).toContain('aria-label="Mikrofon niedostępny"');
    expect(header).toContain('data-microphone-state="unavailable"');
    expect(header).toContain("<details");
    expect(header).not.toMatch(/<details[^>]* open/);
    expect(html).not.toContain(messages.kid.micDenied);
  });

  it("nie obiecuje gotowości przed uzyskaniem dostępu", () => {
    expect(render()).toContain('aria-label="Mikrofon wymaga włączenia"');
    expect(render()).not.toContain('data-microphone-state="ready"');
  });

  it("gotowy mikrofon ma nazwę i stan dostępności", () => {
    const html = render({ microphoneReady: true });
    expect(html).toContain('aria-label="Mikrofon gotowy"');
    expect(html).toContain('data-microphone-state="ready"');
  });

  it("wyłączone nagrywanie nie jest przedstawione jako awaria", () => {
    // The deck toggle stores micDenied=true even when switching off intentionally.
    const html = render({ session: { ...screen.session, microphoneEnabled: false }, micDenied: true });
    expect(html).toContain('aria-label="Nagrywanie wyłączone"');
    expect(html).toContain('data-microphone-state="off"');
    expect(html).not.toContain('data-microphone-state="unavailable"');
  });

  it("pisemna kartkówka nie przedstawia zapamiętanej odmowy jako problemu", () => {
    const html = render({ session: { ...screen.session, mode: "mock_test", microphoneEnabled: false }, micDenied: true });
    expect(html).toContain('aria-label="Nagrywanie wyłączone"');
    expect(html).not.toContain('data-microphone-state="unavailable"');
  });

  it("awaria urządzenia nie jest przedstawiona jako oczekiwanie na zgodę", () => {
    const html = render({ recordingNotice: messages.kid.recordingUnavailable });
    expect(html).toContain('data-microphone-state="unavailable"');
  });
});
