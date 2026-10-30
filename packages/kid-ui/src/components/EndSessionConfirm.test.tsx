// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { EndSessionConfirm } from "./EndSessionConfirm";

afterEach(cleanup);

function renderConfirm(overrides: Partial<Parameters<typeof EndSessionConfirm>[0]> = {}) {
  const props = { open: true, mockTest: false, busy: false, onContinue: vi.fn(), onEnd: vi.fn(), ...overrides };
  return { props, ...renderKid(<EndSessionConfirm {...props} />) };
}

describe("EndSessionConfirm", () => {
  it("renders nothing while closed", () => {
    renderConfirm({ open: false });
    expect(screen.queryByTestId("kid-end-confirm")).toBeNull();
  });

  it("asks before ending, with continuing as the focused main action", () => {
    renderConfirm();
    const dialog = screen.getByRole("alertdialog", { name: "Kończymy na dziś?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Twoje odpowiedzi są już zapisane.");
    const continueButton = screen.getByTestId("kid-end-continue");
    expect(continueButton.textContent).toBe("Ćwiczę dalej");
    expect(continueButton.getAttribute("data-variant")).toBe("filled");
    expect(document.activeElement).toBe(continueButton);
    const end = screen.getByTestId("kid-end-confirm-end");
    expect(end.textContent).toBe("Zakończ");
    expect(end.getAttribute("data-variant")).toBe("outlined");
  });

  it("tells a mock test that unanswered tasks stay unchecked", () => {
    renderConfirm({ mockTest: true });
    expect(screen.getByRole("alertdialog").textContent).toContain("Niezrobione zadania zostaną niesprawdzone.");
    expect(screen.getByRole("alertdialog").textContent).not.toContain("zapisane");
  });

  it("ends only from the end button, which waits while the session is busy", () => {
    const { props, rerender } = renderConfirm({ busy: true });
    const end = screen.getByTestId("kid-end-confirm-end") as HTMLButtonElement;
    expect(end.disabled).toBe(true);
    rerender(<EndSessionConfirm {...props} busy={false} />);
    fireEvent.click(screen.getByTestId("kid-end-confirm-end"));
    expect(props.onEnd).toHaveBeenCalledTimes(1);
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it("continues on the button, Escape and a tap on the scrim, but not on the sheet itself", () => {
    const { props } = renderConfirm();
    fireEvent.click(screen.getByTestId("kid-end-confirm"));
    expect(props.onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("kid-end-confirm-scrim"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.click(screen.getByTestId("kid-end-continue"));
    expect(props.onContinue).toHaveBeenCalledTimes(3);
    expect(props.onEnd).not.toHaveBeenCalled();
  });

  it("keeps Tab focus inside the sheet", () => {
    renderConfirm();
    const continueButton = screen.getByTestId("kid-end-continue");
    const end = screen.getByTestId("kid-end-confirm-end");
    end.focus();
    fireEvent.keyDown(end, { key: "Tab" });
    expect(document.activeElement).toBe(continueButton);
    fireEvent.keyDown(continueButton, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(end);
  });

  it("keeps the exercise's window shortcuts from acting under the open sheet", () => {
    const windowKeys = vi.fn();
    window.addEventListener("keydown", windowKeys);
    try {
      const { props, rerender } = renderConfirm();
      fireEvent.keyDown(document.activeElement!, { key: "1" });
      fireEvent.keyDown(document.activeElement!, { key: " " });
      expect(windowKeys).not.toHaveBeenCalled();
      rerender(<EndSessionConfirm {...props} open={false} />);
      fireEvent.keyDown(document.body, { key: "1" });
      expect(windowKeys).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", windowKeys);
    }
  });
});
