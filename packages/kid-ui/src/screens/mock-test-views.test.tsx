// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderKid, screen, cleanup } from "../test/render-kid";
import type { SessionDto } from "@learning/contracts";
import { LessonMockTestSummaryScreen } from "./LessonMockTestSummaryScreen";
import { MockTestReadyScreen, MockTestSummaryScreen, SessionConflictScreen } from "./MockTestSummaryScreen";

afterEach(cleanup);

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session: SessionDto = {
  mode: "mock_test", sessionId: id(1), childId: id(2), deckId: id(3), deckVersionId: id(4), policyId: "default",
  microphoneEnabled: false, state: "active", taskBudget: 3, tasksIssued: 0, assessedTasksIssued: 0,
  startedAt: "2026-10-24T10:00:00.000Z", resumed: false,
};
const summary: ComponentProps<typeof MockTestSummaryScreen>["summary"] = {
  sessionId: id(1), deckId: id(3), state: "ended", complete: false, taskBudget: 3, answeredCount: 2,
  solutions: [
    { taskId: id(5), source: "kot", target: "cat", audioAssetId: id(8), results: [{ skill: "recall", outcome: "correct" }] },
    { taskId: id(6), source: "pies", target: "dog", audioAssetId: null, results: [{ skill: "spelling", outcome: "incorrect" }] },
    { taskId: id(7), source: "ptak", target: "bird", audioAssetId: null, results: [{ skill: "recall", outcome: "skipped" }] },
  ],
};

describe("mock test screens", () => {
  it("shows the API task budget and starts or cancels through existing callbacks", () => {
    const props: ComponentProps<typeof MockTestReadyScreen> = { session, onStart: vi.fn(async () => {}), onCancel: vi.fn(async () => {}) };
    renderKid(<MockTestReadyScreen {...props} />);
    expect(screen.getByTestId("kid-mock-budget").textContent).toContain("3");
    expect(screen.getByTestId("kid-mock-confirm").tagName).toBe("BUTTON");
    fireEvent.click(screen.getByTestId("kid-mock-confirm"));
    fireEvent.click(screen.getByText(/Koniec/));
    expect(props.onStart).toHaveBeenCalledOnce();
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("keeps verdicts in the summary and wires details, audio, practice and profile callbacks", () => {
    const onRetryDetails = vi.fn(async () => {});
    const onPlay = vi.fn(async () => {});
    const onPractice = vi.fn(async () => {});
    const onSwitchProfile = vi.fn(async () => {});
    renderKid(<MockTestSummaryScreen summary={summary} activity={null} detailsLoading={false} detailsError onRetryDetails={onRetryDetails} onPlay={onPlay} onPractice={onPractice} onSwitchProfile={onSwitchProfile} />);
    expect(screen.getAllByTestId("kid-mock-solution").map((row) => row.getAttribute("data-status"))).toEqual(["correct", "incorrect", "notAssessed"]);
    const retry = screen.getByRole("button", { name: "Spróbuj ponownie" });
    expect(retry.style.minHeight).toBe("48px");
    fireEvent.click(retry);
    expect(onRetryDetails).toHaveBeenCalledOnce();
    const audio = screen.getByRole("button", { name: "Posłuchaj" });
    expect(audio.tagName).toBe("BUTTON");
    fireEvent.click(audio);
    fireEvent.click(screen.getByTestId("kid-mock-practice"));
    fireEvent.click(screen.getByRole("button", { name: "Kto się dziś uczy?" }));
    expect(onPlay).toHaveBeenCalledWith(id(5));
    expect(onPractice).toHaveBeenCalledOnce();
    expect(onSwitchProfile).toHaveBeenCalledOnce();
    expect(screen.getByTestId("kid-mock-practice").tagName).toBe("BUTTON");
  });

  it("wires conflict resume and close", () => {
    const onResume = vi.fn(async () => {});
    const onClose = vi.fn(async () => {});
    renderKid(<SessionConflictScreen onResume={onResume} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Wróć do sesji" }));
    fireEvent.click(screen.getByRole("button", { name: "Zakończ rozpoczętą sesję" }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders lesson mock answers and keeps practice callback available", () => {
    const props: ComponentProps<typeof LessonMockTestSummaryScreen> = {
      summary: {
        sessionId: id(1), deckId: id(3), state: "ended", complete: false, taskBudget: 2, answeredCount: 1,
        solutions: [{ taskId: id(5), objectiveId: "objective-1", titlePl: "Present Simple", exerciseType: "lesson_choice", prompt: "He ___ .", childAnswer: "play", correctAnswer: "plays", outcome: "incorrect" }],
      },
      activity: null, detailsLoading: true, detailsError: false,
      onRetryDetails: vi.fn(async () => {}), onPractice: vi.fn(async () => {}), onSwitchProfile: vi.fn(async () => {}),
    };
    const view = renderKid(<LessonMockTestSummaryScreen {...props} />);
    expect(screen.getByTestId("kid-lesson-mock-details-loading")).toBeTruthy();
    expect(screen.getByTestId("kid-lesson-mock-solution").textContent).toContain("play");
    expect(screen.getByTestId("kid-lesson-mock-solution").querySelector(".kid-mock-row__detail--answers")).toBeTruthy();
    expect(screen.getByTestId("kid-lesson-mock-solution").textContent).toContain("plays");
    expect(screen.getByTestId("kid-lesson-mock-practice").tagName).toBe("BUTTON");
    fireEvent.click(screen.getByTestId("kid-lesson-mock-practice"));
    expect(props.onPractice).toHaveBeenCalledOnce();
    view.rerender(<LessonMockTestSummaryScreen {...props} detailsLoading={false} detailsError />);
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" }).style.minHeight).toBe("48px");
  });

  it("shows the school precision hint and objectives worth reviewing only when present", () => {
    const base: ComponentProps<typeof LessonMockTestSummaryScreen> = {
      summary: {
        sessionId: id(1), deckId: id(3), state: "completed", complete: true, taskBudget: 1, answeredCount: 1,
        solutions: [{ taskId: id(5), objectiveId: "o1", titlePl: "Fotosynteza", exerciseType: "lesson_open_answer", prompt: "Co to jest fotosynteza?", childAnswer: "Długa odpowiedź…", correctAnswer: "Roślina wytwarza cukry.", outcome: "correct", hintPl: "Dobrze! Następnym razem spróbuj krócej." }],
        reviewObjectives: [{ objectiveId: "o2", titlePl: "Skala mapy" }],
      },
      activity: null, detailsLoading: false, detailsError: false,
      onRetryDetails: vi.fn(async () => {}), onPractice: vi.fn(async () => {}), onSwitchProfile: vi.fn(async () => {}),
    };
    const view = renderKid(<LessonMockTestSummaryScreen {...base} />);
    expect(screen.getByTestId("kid-lesson-mock-hint").textContent).toBe("Dobrze! Następnym razem spróbuj krócej.");
    expect(screen.getByRole("region", { name: "Warto powtórzyć" }).textContent).toContain("Skala mapy");
    const { reviewObjectives: _omit, ...plain } = base.summary;
    view.rerender(<LessonMockTestSummaryScreen {...base} summary={{ ...plain, solutions: plain.solutions.map(({ hintPl: _hint, ...rest }) => rest) }} />);
    expect(screen.queryByTestId("kid-lesson-mock-hint")).toBeNull();
    expect(screen.queryByTestId("kid-lesson-mock-review")).toBeNull();
  });
});
