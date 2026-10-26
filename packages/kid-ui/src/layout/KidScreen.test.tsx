// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { KidScreen } from "./KidScreen";

afterEach(cleanup);

describe("KidScreen", () => {
  it("keeps primary and secondary action slots even when the primary is empty", () => {
    renderKid(
      <KidScreen data-active="true">
        <KidScreen.Header>Nagłówek</KidScreen.Header>
        <KidScreen.Content>Treść</KidScreen.Content>
        <KidScreen.Actions secondary={<button type="button">Pomiń</button>} />
      </KidScreen>,
    );

    expect(screen.getByTestId("kid-primary-slot").textContent).toBe("");
    expect(screen.getByTestId("kid-secondary-slot").textContent).toContain("Pomiń");
    expect(screen.getByTestId("kid-screen").getAttribute("data-kid-screen")).toBe("true");
    expect(screen.getByTestId("kid-screen").hasAttribute("data-active")).toBe(true);
  });

  it("preserves child state, refs and classes across rerenders", () => {
    const ref = { current: null as HTMLInputElement | null };
    const contentRef = createRef<HTMLDivElement>();
    const rootRef = createRef<HTMLDivElement>();
    const view = (heading: string) => (
      <KidScreen ref={rootRef}>
        <KidScreen.Header>{heading}</KidScreen.Header>
        <KidScreen.Content ref={contentRef} className="probe-content">
          <input ref={ref} aria-label="Wpis" defaultValue="" />
        </KidScreen.Content>
        <KidScreen.Actions />
      </KidScreen>
    );
    const { rerender, container } = renderKid(view("Pierwszy nagłówek"));
    fireEvent.change(screen.getByLabelText("Wpis"), { target: { value: "ca" } });
    const inputBefore = screen.getByLabelText("Wpis");

    rerender(view("Drugi nagłówek"));

    expect(screen.getByText("Drugi nagłówek")).toBeTruthy();
    expect(screen.getByLabelText("Wpis")).toBe(inputBefore);
    expect((screen.getByLabelText("Wpis") as HTMLInputElement).value).toBe("ca");
    expect(ref.current).toBe(inputBefore);
    expect(rootRef.current).toBe(screen.getByTestId("kid-screen"));
    expect(contentRef.current).toBe(screen.getByTestId("kid-content"));
    expect(container.querySelector(".probe-content")).toBe(screen.getByTestId("kid-content"));
  });

  it("passes className and style through to the screen root", () => {
    renderKid(
      <KidScreen className="probe-screen" style={{ color: "rgb(1, 2, 3)" }}>
        <KidScreen.Header />
        <KidScreen.Content />
        <KidScreen.Actions />
      </KidScreen>,
    );

    const root = screen.getByTestId("kid-screen");
    expect(root.classList.contains("probe-screen")).toBe(true);
    expect((root as HTMLElement).style.color).toBe("rgb(1, 2, 3)");
    expect(screen.getByTestId("kid-primary-slot")).toBeTruthy();
    expect(screen.getByTestId("kid-secondary-slot")).toBeTruthy();
  });
});
