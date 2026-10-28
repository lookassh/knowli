// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderKid, screen } from "../test/render-kid";
import { SessionProgress } from "./SessionProgress";

afterEach(cleanup);

describe("SessionProgress", () => {
  it("shows a decorative bar until the remaining label is due", () => {
    renderKid(<SessionProgress remaining={null} fraction={0.5} />);
    expect(screen.getByTestId("kid-progress-bar").getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByTestId("kid-remaining")).toBeNull();
    expect(screen.getByTestId("kid-progress-fill")).toBeTruthy();
  });

  it("keeps the remaining label as the accessible text over the fill", () => {
    renderKid(<SessionProgress remaining={2} fraction={0.8} />);
    const pill = screen.getByTestId("kid-remaining");
    expect(pill.textContent).toContain("2");
    expect(pill.querySelector("[aria-hidden='true'] [data-testid='kid-progress-fill']")).not.toBeNull();
    expect(screen.queryByTestId("kid-streak-star")).toBeNull();
  });

  it("drops a hidden star when a streak milestone is reached", () => {
    renderKid(<SessionProgress remaining={null} fraction={0.3} milestone={1} />);
    expect(screen.getByTestId("kid-streak-star").getAttribute("aria-hidden")).toBe("true");
  });
});
