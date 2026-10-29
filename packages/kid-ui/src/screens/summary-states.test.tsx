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

  it("renders recall and spelling counts as stat tiles with a separate number and label", () => {
    renderKid(<SummaryScreen summary={{ ...summary, independentSuccesses: { recall: 3, spelling: 1 } }} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    const recall = screen.getByTestId("kid-summary-recall");
    expect(recall.querySelector(".kid-stat__value")?.textContent).toBe("3");
    expect(recall.querySelector(".kid-stat__label")?.textContent).toBe("Samodzielne przypominanie");
    expect(recall.textContent).toContain("3 słowa");
    // Czytnik ekranu dostaje frazę „Etykieta: 3 słowa”: etykieta pierwsza w DOM, ukryty separator, potem liczba.
    expect(recall.textContent).toBe("Samodzielne przypominanie: 3 słowa");
    const spelling = screen.getByTestId("kid-summary-spelling");
    expect(spelling.querySelector(".kid-stat__value")?.textContent).toBe("1");
    expect(spelling.querySelector(".kid-stat__label")?.textContent).toBe("Samodzielna pisownia");
    expect(spelling.textContent).toContain("1 słowo");
  });

  it("shows only the tile with a positive count and no neutral hint", () => {
    renderKid(<SummaryScreen summary={{ ...summary, independentSuccesses: { recall: 2, spelling: 0 } }} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    expect(screen.getByTestId("kid-summary-recall")).toBeTruthy();
    expect(screen.queryByTestId("kid-summary-spelling")).toBeNull();
    expect(screen.queryByTestId("kid-summary-neutral")).toBeNull();
  });

  it("keeps the neutral hint and no tiles when there are no independent successes", () => {
    renderKid(<SummaryScreen summary={{ ...summary, independentSuccesses: { recall: 0, spelling: 0 } }} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    expect(screen.getByTestId("kid-summary-neutral")).toBeTruthy();
    expect(screen.queryByTestId("kid-summary-recall")).toBeNull();
    expect(screen.queryByTestId("kid-summary-spelling")).toBeNull();
    expect(document.querySelector(".kid-stat")).toBeNull();
  });

  it("uses the band header as the first child of the screen", () => {
    renderKid(<SummaryScreen summary={summary} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    expect(screen.getByRole("main").firstElementChild?.getAttribute("data-kid-header")).toBe("band");
  });

  it("renders practice items and lesson objectives as named lists", () => {
    renderKid(<SummaryScreen
      summary={{
        ...summary,
        practiceItems: [{ itemId: "10000000-0000-4000-8000-000000000101", target: "cat", skills: ["recall", "spelling"] }],
        objectives: [
          { objectiveId: "10000000-0000-4000-8000-000000000201", titlePl: "-s w 3. osobie" },
          { objectiveId: "10000000-0000-4000-8000-000000000202", titlePl: "have got" },
        ],
      } as SessionSummaryDto}
      profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    const practice = screen.getByRole("list", { name: "Jeszcze poćwiczymy" });
    expect(practice.querySelectorAll("li")).toHaveLength(1);
    expect(practice.textContent).toContain("cat");
    expect(practice.textContent).toContain("przypominanie, pisownia");
    const objectives = screen.getByRole("list", { name: "Ćwiczyłeś reguły" });
    expect(objectives.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getAllByTestId("kid-summary-objective")).toHaveLength(2);
    // Cele lekcji nie są wynikiem: neutralna ikona książki, nie znacznik sukcesu.
    for (const row of screen.getAllByTestId("kid-summary-objective")) {
      const icon = row.querySelector("svg.kid-summary-row-icon");
      expect(icon).toBeTruthy();
      expect(icon!.innerHTML).toContain("M4 5.5A2.5");
      expect(icon!.innerHTML).not.toContain("m5 12 4 4L19 6");
    }
  });
});
