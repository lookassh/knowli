// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderKid } from "../test/render-kid";

afterEach(cleanup);

describe("KidThemeProvider", () => {
  it("scopes the fixed night theme to the child UI", () => {
    const { container, unmount } = renderKid(<button type="button">Test</button>);

    const root = container.querySelector(".kid-theme");
    expect(root?.getAttribute("data-kid-theme")).toBe("night");
    expect(document.documentElement.classList.contains("kid-theme")).toBe(false);
    unmount();
    expect(container.querySelector(".kid-theme")).toBeNull();
  });
});
