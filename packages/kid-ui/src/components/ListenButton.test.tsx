// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderKid, screen } from "../test/render-kid";
import { ListenButton } from "./ListenButton";

afterEach(cleanup);

describe("ListenButton", () => {
  it("draws the speaker by default and no failure marks", () => {
    renderKid(<ListenButton data-testid="listen" aria-label="Posłuchaj" />);
    const button = screen.getByTestId("listen");
    expect(button.querySelector("svg")?.getAttribute("data-icon")).toBe("volume");
    expect(button.hasAttribute("data-audio-failed")).toBe(false);
    expect(button.querySelector("[data-fail-key]")).toBeNull();
  });

  it("draws the turtle for the slow replay", () => {
    renderKid(<ListenButton data-testid="listen" aria-label="Posłuchaj wolniej" icon="turtle" />);
    expect(screen.getByTestId("listen").querySelector("svg")?.getAttribute("data-icon")).toBe("turtle");
  });

  it("remounts the icon wrapper with each new failKey and marks the button", () => {
    const { rerender } = renderKid(<ListenButton data-testid="listen" aria-label="Posłuchaj" failKey={1} />);
    const button = screen.getByTestId("listen");
    const first = button.querySelector("[data-fail-key]");
    expect(first?.getAttribute("data-fail-key")).toBe("1");
    expect(button.getAttribute("data-audio-failed")).toBe("1");
    // Ikona siedzi w opakowaniu, nie przycisk: ActionButton sam steruje swoją transformacją.
    expect(first?.contains(button.querySelector("svg"))).toBe(true);

    rerender(<ListenButton data-testid="listen" aria-label="Posłuchaj" failKey={2} />);
    const second = screen.getByTestId("listen").querySelector("[data-fail-key]");
    expect(second?.getAttribute("data-fail-key")).toBe("2");
    expect(second).not.toBe(first);
    expect(screen.getByTestId("listen").getAttribute("data-audio-failed")).toBe("2");
  });
});
