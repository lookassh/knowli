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

describe("profile and deck screens", () => {
  it("renders all avatar keys, points, non-reader state and selection callbacks", () => {
    const avatars = ["fox", "bear", "cat", "dog", "owl", "rabbit"];
    const profiles = avatars.map((avatar, index) => ({ ...profile(avatar, index + 1), canRead: index !== 2 }));
    const onSelect = vi.fn();
    renderKid(<ProfileScreen profiles={profiles} onSelect={onSelect} />);
    expect(screen.getAllByTestId("kid-profile")).toHaveLength(6);
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getAllByTestId("kid-profile")[2]!.tagName).toBe("BUTTON");
    expect(screen.getAllByTestId("kid-profile-points").map((badge) => badge.textContent)).toContain("Punkty: 1");
    expect(screen.getAllByText("Uczę się bez czytania")).toHaveLength(1);
    fireEvent.click(screen.getAllByTestId("kid-profile")[2]!);
    expect(onSelect).toHaveBeenCalledWith(id(3));
  });

  it("draws the avatar illustration instead of an emoji and keeps the points chip", () => {
    renderKid(<ProfileScreen profiles={[profile("owl", 1)]} onSelect={vi.fn()} />);
    const tile = screen.getByTestId("kid-profile");
    expect(tile.querySelector('svg[data-avatar="owl"]')).toBeTruthy();
    expect(tile.textContent).not.toContain("🦉");
    expect(screen.getByTestId("kid-profile-points").textContent).toBe("Punkty: 1");
    expect(tile.closest("ul")?.className).toContain("kid-profile-grid");
    expect(document.querySelector('[data-kid-header="band"]')).toBeTruthy();
  });

  it("shows the no-profile state with the bay scene and without a profile list", () => {
    renderKid(<ProfileScreen profiles={[]} onSelect={vi.fn()} />);
    const hint = screen.getByText("Poproś rodzica o dodanie profilu w panelu\.");
    expect(hint.className).toContain("kid-hint");
    expect(hint.parentElement?.querySelector("svg[aria-hidden]")).toBeTruthy();
    expect(screen.queryByTestId("kid-profile")).toBeNull();
    expect(document.querySelector("ul.kid-profile-grid")).toBeNull();
  });

  it("keeps recommended and other assigned decks, their real metadata and actions", async () => {
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
    expect(screen.getAllByTestId("kid-deck-title").map((title) => title.textContent)).toEqual(["Zestaw 11", "Zestaw 10", "Zestaw 12"]);
    expect(screen.getAllByTestId("kid-deck-meta").map((meta) => meta.textContent)).toEqual(["7 słów", "7 słów", "Lekcja: Język angielski"]);
    expect(screen.getAllByTestId("kid-deck")[0]!.tagName).toBe("BUTTON");
    expect(screen.getByTestId("kid-section-recommended").closest("article")?.getAttribute("data-deck-id")).toBe(id(11));
    screen.getAllByTestId("kid-deck").forEach(button => fireEvent.click(button));
    fireEvent.click(screen.getByTestId("kid-mock-start"));
    fireEvent.click(screen.getByTestId("kid-resume-session"));
    fireEvent.click(screen.getByTestId("kid-end-active-session"));
    expect(onStart).toHaveBeenCalledWith(id(10));
    expect(onStart).toHaveBeenCalledWith(id(11));
    expect(onStart).toHaveBeenCalledWith(id(12));
    expect(onMockTest).toHaveBeenCalledWith(id(10));
    expect(onEndActive).toHaveBeenCalledWith(id(11));
    fireEvent.click(screen.getByTestId("kid-mic-settings"));
    expect(await screen.findByTestId("kid-mic-denied-hint")).toBeTruthy();
  });

  it("distinguishes approved activity from unavailable data and preserves microphone callback", async () => {
    const onToggleMicrophone = vi.fn();
    const props: ComponentProps<typeof DeckScreen> = {
      decks: [deck(10)], childName: "Ola", todayActivitySeconds: 125, microphone: false,
      micDenied: false, onToggleMicrophone, onStart: vi.fn(),
    };
    const view = renderKid(<DeckScreen {...props} />);
    expect(screen.getByTestId("kid-daily-activity").textContent).toContain("2 min 5 s");
    const settings = screen.getByTestId("kid-mic-settings");
    expect(settings.closest("header")).toBeTruthy();
    expect(screen.queryByTestId("kid-mic-toggle")).toBeNull();
    fireEvent.click(settings);
    const toggle = await screen.findByTestId("kid-mic-toggle");
    expect(toggle.className).toContain("kid-toggle");
    fireEvent.click(toggle);
    expect(onToggleMicrophone).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("kid-deck-microphone")).toBeNull();
    view.rerender(<DeckScreen {...props} todayActivitySeconds={undefined} todayActivityUnavailable />);
    expect(screen.getByTestId("kid-daily-activity").textContent).toContain("—");
  });

  it("renders an empty deck state and keeps a long title visible", () => {
    const props = { decks: [], childName: "Ola", microphone: false, micDenied: false, onToggleMicrophone: vi.fn(), onStart: vi.fn() };
    const view = renderKid(<DeckScreen {...props} />);
    expect(screen.getByTestId("kid-no-decks")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(document.querySelector('[data-kid-header="band"]')).toBeTruthy();
    expect(screen.getByTestId("kid-no-decks").parentElement?.querySelector("svg[aria-hidden]")).toBeTruthy();
    view.rerender(<DeckScreen {...props} decks={[deck(20, { title: "Bardzo długi tytuł zestawu do nauki słownictwa" })]} />);
    expect(screen.getByTestId("kid-deck-title").textContent).toBe("Bardzo długi tytuł zestawu do nauki słownictwa");
  });

  it("greets the child inside the band without an emoji", () => {
    renderKid(<DeckScreen decks={[deck(10)]} childName="Ola" microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} onStart={vi.fn()} />);
    const band = document.querySelector('[data-kid-header="band"]')!;
    expect(band.querySelector(".kid-greeting")?.textContent).toBe("Cześć, Ola!");
    expect(band.querySelector("h1")?.textContent).toBe("Co dziś robimy?");
    expect(band.querySelector("[data-testid='kid-daily-activity']")).toBeTruthy();
    expect(band.querySelector("[data-testid='kid-mic-settings']")).toBeTruthy();
  });

  it("puts the section label inside the first recommended card and keeps other decks in one divided list", () => {
    renderKid(<DeckScreen decks={[deck(10, { recommended: true }), deck(11, { recommended: false }), deck(12, { recommended: false })]} childName="Ola" microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} onStart={vi.fn()} />);
    const recommended = screen.getByTestId("kid-section-recommended");
    expect(recommended.closest("article")?.getAttribute("data-testid")).toBe("kid-deck-card");
    expect(recommended.closest("article")?.getAttribute("data-deck-id")).toBe(id(10));
    const rows = screen.getByTestId("kid-section-other").closest("section")!.querySelectorAll("ul > li");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("data-testid")).toBe("kid-deck-card");
    expect(rows[0]!.getAttribute("data-deck-id")).toBe(id(11));
    expect(rows[0]!.getAttribute("data-kind")).toBe("vocabulary");
  });

  it("shows the Rekomendowane label on every recommended card with one heading and one testid", () => {
    renderKid(<DeckScreen decks={[deck(10, { recommended: true }), deck(12, { recommended: true })]} childName="Ola" microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} onStart={vi.fn()} />);
    const cards = screen.getAllByTestId("kid-deck-card");
    expect(cards).toHaveLength(2);
    for (const card of cards) expect(card.querySelector(".kid-deck-card__label")?.textContent).toBe("Rekomendowane");
    expect(screen.getAllByTestId("kid-section-recommended")).toHaveLength(1);
    expect(document.querySelectorAll("section[data-kind='recommended'] h2")).toHaveLength(1);
    expect(cards[1]!.querySelector(".kid-deck-card__label")?.tagName).toBe("P");
  });

  it("names each row's arrow button after its deck and runs the row's own actions", () => {
    const onStart = vi.fn();
    const onMockTest = vi.fn();
    renderKid(<DeckScreen decks={[deck(11, { recommended: false, mockTestAvailable: true })]} childName="Ola" microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} onStart={onStart} onMockTest={onMockTest} />);
    expect(screen.queryByTestId("kid-section-recommended")).toBeNull();
    const start = screen.getByRole("button", { name: "Ucz się: Zestaw 11" });
    expect(start.getAttribute("data-testid")).toBe("kid-deck");
    fireEvent.click(start);
    fireEvent.click(screen.getByTestId("kid-mock-start"));
    expect(onStart).toHaveBeenCalledWith(id(11));
    expect(onMockTest).toHaveBeenCalledWith(id(11));
    expect(screen.getByTestId("kid-mock-start").closest("li")?.getAttribute("data-deck-id")).toBe(id(11));
  });

  it("shows a deck with an active session as the first full card with a filled resume action even when nothing is recommended", () => {
    const onStart = vi.fn();
    const onEndActive = vi.fn();
    const assigned = [
      deck(11, { recommended: false }),
      deck(12, { recommended: false, resumeOnly: true, activeSession: { sessionId: id(30), mode: "training" } }),
    ];
    renderKid(<DeckScreen decks={assigned} childName="Ola" microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} onStart={onStart} onEndActive={onEndActive} />);
    const cards = document.querySelectorAll("section[data-kind='recommended'] article");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.getAttribute("data-deck-id")).toBe(id(12));
    expect(screen.getByTestId("kid-section-recommended").closest("article")).toBe(cards[0]);
    const resume = screen.getByTestId("kid-resume-session");
    expect(resume.closest("article")).toBe(cards[0]);
    expect(resume.getAttribute("data-variant")).toBe("filled");
    expect(resume.textContent).toContain("Wznów naukę");
    expect(screen.getByTestId("kid-end-active-session").getAttribute("data-variant")).toBe("tonal");
    expect(screen.getByTestId("kid-end-active-session").closest("article")).toBe(cards[0]);
    // The other deck stays a row; the resume deck is not duplicated there.
    const rows = screen.getByTestId("kid-section-other").closest("section")!.querySelectorAll("ul > li");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-deck-id")).toBe(id(11));
    expect(document.activeElement).toBe(resume);
    fireEvent.click(resume);
    fireEvent.click(screen.getByTestId("kid-end-active-session"));
    expect(onStart).toHaveBeenCalledWith(id(12));
    expect(onEndActive).toHaveBeenCalledWith(id(12));
  });

  it("puts the active-session card before recommended cards and focuses its main action", () => {
    const assigned = [
      deck(10, { recommended: true }),
      deck(12, { recommended: false, resumeOnly: true, activeSession: { sessionId: id(30), mode: "training" } }),
    ];
    renderKid(<DeckScreen decks={assigned} childName="Ola" microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} onStart={vi.fn()} onEndActive={vi.fn()} />);
    const cards = Array.from(document.querySelectorAll("section[data-kind='recommended'] article"));
    expect(cards.map((card) => card.getAttribute("data-deck-id"))).toEqual([id(12), id(10)]);
    expect(document.activeElement).toBe(screen.getByTestId("kid-resume-session"));
    expect(screen.getAllByTestId("kid-section-recommended")).toHaveLength(1);
  });

  it("shows the test date as a warm chip and the real stars on a recommended card", () => {
    renderKid(<DeckScreen decks={[deck(10, { recommended: true, testDate: "2026-11-02", independentlyRecalledCount: 4 })]} childName="Ola" microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} onStart={vi.fn()} />);
    const card = screen.getByTestId("kid-deck-card");
    expect(card.querySelector('[data-tone="warm"]')?.textContent).toContain("Sprawdzian: 2 lis");
    expect(screen.getByTestId("kid-deck-stars").textContent).toBe("★★★☆☆☆");
    expect(screen.getByRole("button", { name: /Ucz się/ }).getAttribute("data-testid")).toBe("kid-deck");
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







