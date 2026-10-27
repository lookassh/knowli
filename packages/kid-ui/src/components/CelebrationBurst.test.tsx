// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderKid, screen } from "../test/render-kid";
import { CelebrationBurst } from "./CelebrationBurst";

afterEach(cleanup);

describe("CelebrationBurst", () => {
  it("stays quiet without tasks and bursts decoratively after a real session", () => {
    const { rerender } = renderKid(
      <CelebrationBurst active={false}><h1>Koniec</h1></CelebrationBurst>,
    );
    expect(screen.getByText("Koniec")).toBeTruthy();
    expect(screen.queryByTestId("kid-celebration")).toBeNull();

    rerender(
      <CelebrationBurst active><h1>Koniec</h1></CelebrationBurst>,
    );
    const burst = screen.getByTestId("kid-celebration");
    expect(burst.getAttribute("aria-hidden")).toBe("true");
    expect(burst.children).toHaveLength(10);
  });
});
