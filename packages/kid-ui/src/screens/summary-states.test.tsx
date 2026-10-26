// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KidProfileDto, SessionSummaryDto } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { SummaryScreen } from "./SummaryScreen";

afterEach(cleanup);

const profile: KidProfileDto = {
  childId: "10000000-0000-4000-8000-000000000001", displayName: "Ola", avatarKey: "cat", recordingMode: "hold", rewardPoints: 3,
};
const summary: SessionSummaryDto = {
  sessionId: "10000000-0000-4000-8000-000000000003", state: "completed", tasksIssued: 1, assessedTasksIssued: 1,
  endedAt: "2026-10-16T10:00:00.000Z", independentSuccesses: { recall: 1, spelling: 0 }, practiceItems: [],
};

const activityCases = [
  { name: "pending", activity: { status: "already_started" as const, pointsAwarded: 0, errorCode: null }, message: "Punkty z tej nauki są jeszcze liczone." },
  { name: "evaluated", activity: { status: "evaluated" as const, pointsAwarded: 5, approvedSeconds: 125, errorCode: null }, message: "Zdobyto 5 pkt" },
  { name: "error", activity: { status: "error" as const, pointsAwarded: 0, errorCode: "model_timeout" as const }, message: "Nauka zapisana. Nie udało się naliczyć punktów." },
];

describe("summary screen states", () => {
  it.each(activityCases)("renders the $name result and usable summary actions", ({ activity, message }) => {
    const onAgain = vi.fn();
    const onSwitchProfile = vi.fn();
    renderKid(<SummaryScreen summary={{ ...summary, activity }} profiles={[profile, { ...profile, childId: "10000000-0000-4000-8000-000000000002" }]} onAgain={onAgain} onSwitchProfile={onSwitchProfile} />);
    expect(screen.getByRole("main").getAttribute("data-kid-screen")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain(message);
    expect(screen.getByTestId("kid-summary").tagName).toBe("H1");
    fireEvent.click(screen.getByTestId("kid-again"));
    fireEvent.click(screen.getByTestId("kid-switch-profile"));
    expect(onAgain).toHaveBeenCalledTimes(1);
    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
  });

  it("renders a summary without activity as a kid screen and does not invent a reward", () => {
    renderKid(<SummaryScreen summary={summary} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    expect(screen.getByRole("main").getAttribute("data-kid-screen")).toBe("true");
    expect(screen.queryByTestId("kid-summary-reward")).toBeNull();
    expect(screen.queryByTestId("kid-switch-profile")).toBeNull();
  });
});
