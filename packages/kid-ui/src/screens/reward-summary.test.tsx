// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KidDeckDto, KidProfileDto, SessionSummaryDto } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { ProfileScreen } from "./ProfileScreen";
import { DeckCard, DeckScreen } from "./DeckScreen";
import { SummaryScreen } from "./SummaryScreen";
import { SessionActivityResultView } from "./SessionActivityResultView";

afterEach(cleanup);

const profile: KidProfileDto = {
  childId: "10000000-0000-4000-8000-000000000001", displayName: "Ola", avatarKey: "cat", recordingMode: "hold", rewardPoints: 9,
};
const deck: KidDeckDto = {
  deckId: "10000000-0000-4000-8000-000000000002", title: "Kolory", itemCount: 4, independentlyRecalledCount: 2,
  testDate: null, recommended: false, mockTestAvailable: false, activeSession: null,
};
const summary: SessionSummaryDto = {
  sessionId: "10000000-0000-4000-8000-000000000003", state: "completed", tasksIssued: 1, assessedTasksIssued: 1,
  endedAt: "2026-10-16T10:00:00.000Z", independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
};

describe("kid reward views", () => {
  it("shows approved daily time and unavailable state in the rendered deck screen", () => {
    const props = { decks: [], childName: "Ola", microphone: false, micDenied: false, onToggleMicrophone: vi.fn(), onStart: vi.fn() };
    const view = renderKid(<DeckScreen {...props} todayActivitySeconds={25 * 60} />);
    expect(screen.getByTestId("kid-daily-activity").textContent).toContain("Zatwierdzono dziś: 25 min");
    view.rerender(<DeckScreen {...props} todayActivitySeconds={125} />);
    expect(screen.getByTestId("kid-daily-activity").textContent).toContain("2 min 5 s");
    view.rerender(<DeckScreen {...props} todayActivitySeconds={0} />);
    expect(screen.getByTestId("kid-daily-activity").textContent).toContain("0 s");
    view.rerender(<DeckScreen {...props} />);
    expect(screen.getByTestId("kid-daily-activity").textContent).toContain("Zatwierdzony czas: —");
    view.rerender(<DeckScreen {...props} todayActivityUnavailable />);
    expect(screen.getByTestId("kid-daily-activity").textContent).toContain("Zatwierdzony czas: —");
  });

  it("shows one earned-points counter without spending or daily-goal language", () => {
    renderKid(<ProfileScreen profiles={[profile]} onSelect={vi.fn()} />);
    expect(screen.getByText("Punkty: 9")).toBeTruthy();
    expect(screen.queryByText(/Xbox|Do wykorzystania|30 min/)).toBeNull();
  });

  it("keeps mastery stars on deck cards without per-deck points", () => {
    renderKid(<DeckCard deck={deck} mediaUrl={() => ""} onStart={vi.fn()} />);
    expect(screen.getByTestId("kid-deck-stars").textContent).toContain("★★★");
    expect(screen.queryByText(/Zdobyte tutaj/)).toBeNull();
  });

  it("shows evaluated reward time and points in the real summary DOM", () => {
    renderKid(<SummaryScreen summary={{ ...summary, activity: { status: "evaluated", pointsAwarded: 7, approvedSeconds: 125, errorCode: null } }} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    expect(screen.getByTestId("kid-summary-reward").textContent).toContain("Zdobyto 7 pkt");
    expect(screen.getByTestId("kid-summary-reward").textContent).toContain("Zatwierdzony czas nauki: 2 min 5 s");
  });

  it("renders the reward as a neutral chip that stays a polite status region", () => {
    renderKid(<SummaryScreen summary={{ ...summary, activity: { status: "evaluated", pointsAwarded: 7, approvedSeconds: 125, errorCode: null } }} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    const reward = screen.getByTestId("kid-summary-reward");
    expect(reward.getAttribute("data-tone")).toBe("neutral");
    expect(reward.getAttribute("role")).toBe("status");
    expect(reward.getAttribute("aria-live")).toBe("polite");
  });

  it.each([
    ["error", "Nauka zapisana. Nie udało się naliczyć punktów."],
    ["already_started", "Punkty z tej nauki są jeszcze liczone."],
  ] as const)("shows %s activity status", (status, message) => {
    const activity = status === "error"
      ? { status, pointsAwarded: 0, errorCode: "model_timeout" as const }
      : { status, pointsAwarded: 0, errorCode: null };
    renderKid(<SessionActivityResultView activity={activity} />);
    const result = screen.getByRole("status");
    expect(result.textContent).toContain(message);
    expect(result.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps summary actions usable while reward calculation is pending", () => {
    const onAgain = vi.fn();
    const onSwitchProfile = vi.fn();
    renderKid(<SummaryScreen summary={{ ...summary, activity: { status: "already_started", pointsAwarded: 0, errorCode: null } }} profiles={[profile, { ...profile, childId: "other" }]} onAgain={onAgain} onSwitchProfile={onSwitchProfile} />);
    fireEvent.click(screen.getByTestId("kid-again"));
    fireEvent.click(screen.getByTestId("kid-switch-profile"));
    expect(onAgain).toHaveBeenCalledTimes(1);
    expect(onSwitchProfile).toHaveBeenCalledTimes(1);
  });

  it("hides reward content when activity is missing or explicitly null", () => {
    const view = renderKid(<SummaryScreen summary={summary} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    expect(screen.queryByTestId("kid-summary-reward")).toBeNull();
    view.rerender(<SessionActivityResultView activity={null} />);
    expect(screen.queryByTestId("kid-summary-reward")).toBeNull();
  });
});
