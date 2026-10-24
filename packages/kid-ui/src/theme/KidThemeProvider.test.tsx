// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderKid } from "../test/render-kid";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("KidThemeProvider", () => {
  it("scopes dark color scheme to the child UI", () => {
    const originalScheme = document.documentElement.getAttribute("data-mantine-color-scheme");
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    const { container, unmount } = renderKid(<button type="button">Test</button>);

    expect(container.querySelector(".kid-theme")?.getAttribute("data-mantine-color-scheme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe(originalScheme);
    unmount();
    expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe(originalScheme);
  });
});
