// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderKid, screen } from "../test/render-kid";
import { PEBBLE_LIMIT, SessionProgress } from "./SessionProgress";

afterEach(cleanup);

describe("SessionProgress", () => {
  it("renders one hidden pebble per assessed task with done and current states", () => {
    renderKid(<SessionProgress remaining={null} total={5} done={2} />);
    const row = screen.getByTestId("kid-progress-pebbles");
    expect(row.getAttribute("aria-hidden")).toBe("true");
    const pebbles = [...row.querySelectorAll("[data-testid='kid-progress-pebble']")];
    expect(pebbles.map((pebble) => pebble.getAttribute("data-state")))
      .toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(screen.queryByTestId("kid-remaining")).toBeNull();
    expect(screen.queryByTestId("kid-progress-fill")).toBeNull();
  });

  it("falls back to a continuous bar above the pebble limit", () => {
    expect(PEBBLE_LIMIT).toBe(24);
    renderKid(<SessionProgress remaining={null} total={25} done={5} />);
    expect(screen.queryByTestId("kid-progress-pebble")).toBeNull();
    expect(screen.getByTestId("kid-progress-fill")).toBeTruthy();
  });

  it("keeps the remaining label as the accessible text next to the pebbles", () => {
    renderKid(<SessionProgress remaining={2} total={20} done={18} />);
    const label = screen.getByTestId("kid-remaining");
    expect(label.textContent).toContain("2");
    expect(label.getAttribute("aria-hidden")).toBeNull();
    expect(screen.getAllByTestId("kid-progress-pebble")).toHaveLength(20);
    expect(screen.getByTestId("kid-progress-pebbles").contains(label)).toBe(false);
    expect(screen.queryByTestId("kid-streak-star")).toBeNull();
  });

  it("drops a hidden star when a streak milestone is reached", () => {
    renderKid(<SessionProgress remaining={null} total={5} done={3} milestone={1} />);
    const star = screen.getByTestId("kid-streak-star");
    expect(star.getAttribute("aria-hidden")).toBe("true");
    const pebbles = screen.getAllByTestId("kid-progress-pebble");
    expect(pebbles[2]!.contains(star)).toBe(true);
  });

  it("shows no current pebble when the session is done", () => {
    renderKid(<SessionProgress remaining={null} total={4} done={4} />);
    const states = screen.getAllByTestId("kid-progress-pebble").map((pebble) => pebble.getAttribute("data-state"));
    expect(states).toEqual(["done", "done", "done", "done"]);
  });

  it("shows an empty bar before the session size is known", () => {
    renderKid(<SessionProgress remaining={null} />);
    expect(screen.queryByTestId("kid-progress-pebble")).toBeNull();
    expect(screen.getByTestId("kid-progress-fill")).toBeTruthy();
  });
});
