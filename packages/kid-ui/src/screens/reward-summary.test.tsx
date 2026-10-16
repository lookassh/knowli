import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { KidDeckDto, KidProfileDto, SessionSummaryDto } from "@learning/contracts";
import { ProfileScreen } from "./ProfileScreen";
import { DeckCard } from "./DeckScreen";
import { SummaryScreen } from "./SummaryScreen";

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

const profile: KidProfileDto = {
  childId: "10000000-0000-4000-8000-000000000001", displayName: "Ola", avatarKey: "cat", recordingMode: "hold",
  rewards: { earnedPoints: 9, pointsToUse: 9, readyXboxPacks: 1, todayCreditedSeconds: 1799, dailyGoalSeconds: 1800 },
};

const deck: KidDeckDto = {
  deckId: "10000000-0000-4000-8000-000000000002", title: "Kolory", itemCount: 4, independentlyRecalledCount: 2,
  testDate: null, recommended: false, mockTestAvailable: false, activeSession: null, earnedPoints: 3,
};

const summary: SessionSummaryDto = {
  sessionId: "10000000-0000-4000-8000-000000000003", state: "completed", tasksIssued: 1, assessedTasksIssued: 1,
  endedAt: "2026-10-16T10:00:00.000Z", independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
  reward: { creditedSeconds: 30, pointsEarned: 0 },
};

describe("kid reward views", () => {
  it("shows the precise daily threshold and earned profile totals", () => {
    const before = textNodes(<ProfileScreen profiles={[profile]} onSelect={vi.fn()} />).join(" ");
    expect(before).toContain("Zdobyte: 9 pkt");
    expect(before).toContain("29 z 30 min");
    expect(before).not.toContain("30 min osiągnięte");
    const reached = textNodes(<ProfileScreen profiles={[{ ...profile, rewards: { ...profile.rewards!, todayCreditedSeconds: 1800 } }]} onSelect={vi.fn()} />).join(" ");
    expect(reached).toContain("30 min osiągnięte");
  });

  it("uses Polish Xbox pack forms and separates identity from wrapping reward details", () => {
    const requestXbox = vi.fn();
    const one = <ProfileScreen profiles={[profile]} onSelect={vi.fn()} onRequestXbox={requestXbox} />;
    expect(textNodes(one).join(" ")).toContain("Xbox: 1 pakiet po 15 minut");
    expect(textNodes(one).join(" ")).toContain("Zgłoś pakiet Xbox · 30 pkt");
    const requestButton = ProfileScreen({ profiles: [profile], onSelect: vi.fn(), onRequestXbox: requestXbox })
      .props.children[2].props.children[0].props.children[4];
    requestButton.props.onClick();
    expect(requestXbox).toHaveBeenCalledWith(profile.childId);
    const two = <ProfileScreen profiles={[{ ...profile, rewards: { ...profile.rewards!, readyXboxPacks: 2 } }]} onSelect={vi.fn()} />;
    expect(textNodes(two).join(" ")).toContain("Xbox: 2 pakiety po 15 minut");
    const pending = { ...profile, rewards: { ...profile.rewards!, xboxRequest: {
      requestId: "10000000-0000-4000-8000-000000000003", status: "pending" as const,
      requestedAt: "2026-10-16T10:00:00.000Z", localDate: "2026-10-15", blockNumber: 1,
      pointsCost: 30 as const, xboxMinutes: 15 as const,
    } } };
    expect(textNodes(<ProfileScreen profiles={[pending]} onSelect={vi.fn()} onRequestXbox={vi.fn()} />).join(" "))
      .toContain("Zgłoszenie czeka na rodzica.");
    expect(textNodes(<ProfileScreen profiles={[pending]} onSelect={vi.fn()} onRequestXbox={vi.fn()} />).join(" "))
      .not.toContain("Zgłoś pakiet Xbox");
    const tree = ProfileScreen({ profiles: [profile], onSelect: vi.fn() }).props.children[2].props.children[0].props.children[0].props.children;
    expect(tree[0].props.className).toBe("kid-profile-identity");
    expect(tree[1].props.className).toBe("kid-profile-rewards");
  });

  it("shows deck points independently from mastery stars", () => {
    const rendered = textNodes(<DeckCard deck={deck} mediaUrl={() => ""} onStart={vi.fn()} />).join(" ");
    expect(rendered).toContain("Zdobyte tutaj: 3 pkt");
    expect(rendered).toContain("★★★ ☆☆☆");
  });

  it("shows the actual session reward delta, including partial minutes", () => {
    const rendered = textNodes(<SummaryScreen summary={summary} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} />).join(" ");
    expect(rendered).toContain("Zdobyto 0 pkt");
    expect(rendered).toContain("30 s");
  });

  it("ends a daily-round summary with a return to decks instead of another round", () => {
    const rendered = textNodes(<SummaryScreen summary={summary} profiles={[profile]} onAgain={vi.fn()} onSwitchProfile={vi.fn()} dailyRound />).join(" ");
    expect(rendered).toContain("Podsumowanie rundy dnia");
    expect(rendered).toContain("Wróć do zestawów");
    expect(rendered).not.toContain("Jeszcze raz");
  });
});
