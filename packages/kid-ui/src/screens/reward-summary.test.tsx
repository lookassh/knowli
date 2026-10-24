import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { KidDeckDto, KidProfileDto, SessionSummaryDto } from "@learning/contracts";
import { ProfileScreen } from "./ProfileScreen";
import { DeckCard, DeckScreen } from "./DeckScreen";
import { SummaryScreen } from "./SummaryScreen";
import { SessionActivityResultView } from "./SessionActivityResultView";

function textNodes(element: React.ReactNode): string[] {
  if (Array.isArray(element)) return element.flatMap(textNodes);
  if (typeof element === "string" || typeof element === "number") return [String(element)];
  if (!React.isValidElement(element)) return [];
  const node = element as React.ReactElement<{ children?: React.ReactNode }>;
  const rendered = typeof node.type === "function"
    ? (node.type as (props: Record<string, unknown>) => React.ReactNode)(node.props)
    : node.props.children;
  return textNodes(rendered);
}

function buttons(element: React.ReactNode): React.ReactElement<{ disabled?: boolean }>[] {
  if (Array.isArray(element)) return element.flatMap(buttons);
  if (!React.isValidElement(element)) return [];
  const node = element as React.ReactElement<{ children?: React.ReactNode }>;
  if (node.type === "button") return [node as React.ReactElement<{ disabled?: boolean }>];
  const rendered = typeof node.type === "function"
    ? (node.type as (props: Record<string, unknown>) => React.ReactNode)(node.props)
    : node.props.children;
  return buttons(rendered);
}

const profile: KidProfileDto = {
  childId: "10000000-0000-4000-8000-000000000001", displayName: "Ola", avatarKey: "cat", recordingMode: "hold",
  rewardPoints: 9,
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
  it("shows today's approved time at the top of the selected child's deck screen", () => {
    const screen = (todayActivitySeconds?: number, todayActivityUnavailable = false) => (
      <DeckScreen
        decks={[]}
        childName={profile.displayName}
        todayActivitySeconds={todayActivitySeconds}
        todayActivityUnavailable={todayActivityUnavailable}
        microphone={false}
        micDenied={false}
        onToggleMicrophone={vi.fn()}
        onStart={vi.fn()}
      />
    );
    expect(textNodes(screen(25 * 60)).join(" ")).toContain("Zatwierdzono dziś: 25 min");
    expect(textNodes(screen(125)).join(" ")).toContain("Zatwierdzono dziś: 2 min 5 s");
    expect(textNodes(screen(0)).join(" ")).toContain("Zatwierdzono dziś: 0 s");
    expect(textNodes(screen()).join(" ")).toContain("Zatwierdzono dziś: 0 s");
    expect(textNodes(screen(undefined, true)).join(" ")).toContain("Zatwierdzony czas: —");
  });

  it("shows a single general points counter without balances, packs and daily goals", () => {
    const rendered = textNodes(<ProfileScreen profiles={[profile]} onSelect={vi.fn()} />).join(" ");
    expect(rendered).toContain("Punkty: 9");
    expect(rendered).not.toContain("Xbox");
    expect(rendered).not.toContain("Do wykorzystania");
    expect(rendered).not.toContain("30 min");
  });

  it("keeps mastery stars on deck cards without per-deck points", () => {
    const rendered = textNodes(<DeckCard deck={deck} mediaUrl={() => ""} onStart={vi.fn()} />).join(" ");
    expect(rendered).toContain("★★★ ☆☆☆");
    expect(rendered).not.toContain("Zdobyte tutaj");
  });

  it("shows the session points or an explicit no-rating message", () => {
    const awarded = textNodes(<SummaryScreen summary={{ ...summary, activity: { status: "evaluated", pointsAwarded: 7, approvedSeconds: 125, errorCode: null } }} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />).join(" ");
    expect(awarded).toContain("Zdobyto 7 pkt");
    expect(awarded).toContain("Zatwierdzony czas nauki: 2 min 5 s");
    const failed = textNodes(<SummaryScreen summary={{ ...summary, activity: { status: "error", pointsAwarded: 0, errorCode: "model_timeout" } }} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />).join(" ");
    expect(failed).toContain("Nauka zapisana. Nie udało się naliczyć punktów.");
    const inProgress = textNodes(<SummaryScreen summary={{ ...summary, activity: { status: "already_started", pointsAwarded: 0, errorCode: null } }} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />).join(" ");
    expect(inProgress).toContain("Punkty z tej nauki są jeszcze liczone.");
    const pendingView = <SessionActivityResultView activity={{ status: "already_started", pointsAwarded: 0, errorCode: null }} />;
    expect(textNodes(pendingView).join(" ")).toContain("Punkty z tej nauki są jeszcze liczone.");
    const pendingStatus = (pendingView.type as (props: { activity: unknown }) => React.ReactElement)(pendingView.props);
    expect(pendingStatus.props).toMatchObject({ role: "status", "aria-live": "polite" });
    const pendingActions = buttons(<SummaryScreen summary={{ ...summary, activity: { status: "already_started", pointsAwarded: 0, errorCode: null } }} profiles={[profile, { ...profile, childId: "other" }]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />);
    expect(pendingActions).toHaveLength(2);
    expect(pendingActions.map(button => button.props.disabled)).not.toContain(true);
    const missing = textNodes(<SummaryScreen summary={summary} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />).join(" ");
    expect(missing).not.toContain("Zdobyto");
    expect(textNodes(<SessionActivityResultView activity={null} />).join(" ")).toBe("");
  });
});
