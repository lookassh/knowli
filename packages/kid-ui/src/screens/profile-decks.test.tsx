// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import type { KidDeckDto, KidProfileDto } from "@learning/contracts";
import { DeckCard, DeckScreen } from "./DeckScreen";
import { ProfileScreen } from "./ProfileScreen";

afterEach(cleanup);

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const profile = (avatarKey: string, n: number): KidProfileDto => ({
  childId: id(n), displayName: `Dziecko ${n}`, avatarKey, recordingMode: "hold", rewardPoints: n,
});
const deck = (n: number, overrides: Partial<KidDeckDto> = {}): KidDeckDto => ({
  deckId: id(n), title: `Zestaw ${n}`, itemCount: 7, independentlyRecalledCount: n % 7,
  testDate: null, recommended: n % 2 === 0, mockTestAvailable: false, activeSession: null,
  ...overrides,
});

describe("profile and deck Mantine screens", () => {
  it("renders all avatar keys, points, non-reader state and selection callbacks", () => {
    const avatars = ["fox", "bear", "cat", "dog", "owl", "rabbit"];
    const profiles = avatars.map((avatar, index) => ({ ...profile(avatar, index + 1), canRead: index !== 2 }));
    const onSelect = vi.fn();
    renderKid(<ProfileScreen profiles={profiles} onSelect={onSelect} />);
    expect(screen.getAllByTestId("kid-profile")).toHaveLength(6);
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByTestId("kid-profile")[2]!.className).toContain("mantine-UnstyledButton-root");
    expect(screen.getAllByTestId("kid-profile-points").map((badge) => badge.textContent)).toContain("Punkty: 1");
    expect(screen.getAllByText("Uczę się bez czytania")).toHaveLength(1);
    fireEvent.click(screen.getAllByTestId("kid-profile")[2]!);
    expect(onSelect).toHaveBeenCalledWith(id(3));
  });

  it("shows the no-profile state without an empty profile list", () => {
    renderKid(<ProfileScreen profiles={[]} onSelect={vi.fn()} />);
    expect(screen.getByText("Poproś rodzica o dodanie profilu w panelu\.")).toBeTruthy();
    expect(screen.queryByTestId("kid-profile")).toBeNull();
  });

  it("keeps recommended and other assigned decks, their real metadata and actions", () => {
    const assigned = [
      deck(10, { recommended: true, mockTestAvailable: true, testDate: "2026-11-02", independentlyRecalledCount: 4 }),
      deck(11, { recommended: false, resumeOnly: true, activeSession: { sessionId: id(30), mode: "training" } }),
      deck(12, { recommended: false, kind: "lesson", subjectTitle: "Język angielski" }),
    ];
    const onStart = vi.fn();
    const onMockTest = vi.fn();
    const onEndActive = vi.fn();
    renderKid(<DeckScreen decks={assigned} childName="Ola" microphone={false} micDenied onToggleMicrophone={vi.fn()} onStart={onStart} onMockTest={onMockTest} onEndActive={onEndActive} />);
    expect(screen.getAllByTestId("kid-deck-card")).toHaveLength(3);
    expect(screen.getByTestId("kid-section-recommended")).toBeTruthy();
    expect(screen.getByTestId("kid-section-other")).toBeTruthy();
    expect(screen.getByText(/2 lis/)).toBeTruthy();
    expect(screen.getAllByTestId("kid-deck-title")[2]!.textContent).toContain("Język angielski");
    expect(screen.getAllByTestId("kid-deck")[0]!.className).toContain("mantine-UnstyledButton-root");
    screen.getAllByTestId("kid-deck").forEach(button => fireEvent.click(button));
    fireEvent.click(screen.getByTestId("kid-mock-start"));
    fireEvent.click(screen.getByTestId("kid-resume-session"));
    fireEvent.click(screen.getByTestId("kid-end-active-session"));
    expect(onStart).toHaveBeenCalledWith(id(10));
    expect(onStart).toHaveBeenCalledWith(id(11));
    expect(onStart).toHaveBeenCalledWith(id(12));
    expect(onMockTest).toHaveBeenCalledWith(id(10));
    expect(onEndActive).toHaveBeenCalledWith(id(11));
    expect(screen.getByTestId("kid-mic-denied-hint")).toBeTruthy();
  });

  it("distinguishes approved activity from unavailable data and preserves microphone callback", () => {
    const onToggleMicrophone = vi.fn();
    const props: ComponentProps<typeof DeckScreen> = {
      decks: [deck(10)], childName: "Ola", todayActivitySeconds: 125, microphone: false,
      micDenied: false, onToggleMicrophone, onStart: vi.fn(),
    };
    const view = renderKid(<DeckScreen {...props} />);
    expect(screen.getByTestId("kid-daily-activity").textContent).toContain("2 min 5 s");
    const toggle = screen.getByTestId("kid-mic-toggle");
    expect(toggle.className).toContain("mantine-Switch-input");
    fireEvent.click(toggle);
    expect(onToggleMicrophone).toHaveBeenCalledWith(true);
    view.rerender(<DeckScreen {...props} todayActivitySeconds={undefined} todayActivityUnavailable />);
    expect(screen.getByTestId("kid-daily-activity").textContent).toContain("—");
  });

  it("renders an empty deck state and keeps a long title visible", () => {
    const props = { decks: [], childName: "Ola", microphone: false, micDenied: false, onToggleMicrophone: vi.fn(), onStart: vi.fn() };
    const view = renderKid(<DeckScreen {...props} />);
    expect(screen.getByTestId("kid-no-decks")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    view.rerender(<DeckScreen {...props} decks={[deck(20, { title: "Bardzo długi tytuł zestawu do nauki słownictwa" })]} />);
    expect(screen.getByTestId("kid-deck-title").textContent).toContain("Bardzo długi tytuł zestawu do nauki słownictwa");
  });

  it("renders the assigned cover visual when there is no media cover", () => {
    renderKid(<DeckCard deck={deck(21, { coverVisual: { kind: "color", color: "#ff0000" } })} mediaUrl={() => ""} onStart={vi.fn()} />);
    expect(document.querySelector(".kid-visual")).toBeTruthy();
  });
  it("shows progress stars without inventing per-deck points", () => {
    renderKid(<DeckCard deck={deck(10, { independentlyRecalledCount: 5 })} mediaUrl={() => ""} onStart={vi.fn()} />);
    expect(screen.getByTestId("kid-deck-stars").getAttribute("aria-label")).toContain("4 z 6 gwiazdek");
    expect(screen.queryByText(/Punkty:/)).toBeNull();
  });
});







