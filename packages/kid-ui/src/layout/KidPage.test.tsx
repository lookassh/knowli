// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { stubFinePointer } from "../test/fine-pointer-stub";
import { act, cleanup, renderKid, screen } from "../test/render-kid";
import { KidPage } from "./KidPage";

// jsdom does not serialise `zoom` into the style attribute; the real zoom is checked by kid-large-screen.spec.ts.
const originalMatchMedia = window.matchMedia;
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  if (originalInnerWidth) Object.defineProperty(window, "innerWidth", originalInnerWidth);
  if (originalInnerHeight) Object.defineProperty(window, "innerHeight", originalInnerHeight);
  if (originalVisualViewport) Object.defineProperty(window, "visualViewport", originalVisualViewport);
  else Reflect.deleteProperty(window, "visualViewport");
});

function stubWindow(width: number, height: number, visual: { height?: number; offsetTop?: number; scale?: number } = {}) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  const listeners = new Set<EventListener>();
  const viewport = {
    height: visual.height ?? height,
    offsetTop: visual.offsetTop ?? 0,
    scale: visual.scale ?? 1,
    addEventListener: (type: string, listener: EventListener) => {
      if (type === "resize") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      if (type === "resize") listeners.delete(listener);
    },
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport as unknown as VisualViewport });
  return {
    pinch(scale: number) {
      viewport.scale = scale;
      for (const listener of [...listeners]) listener(new Event("resize"));
    },
  };
}

function renderSession() {
  renderKid(<KidPage mode="session"><p>Zadanie</p></KidPage>);
  return screen.getByTestId("kid-session-frame");
}

const kidZoom = (element: HTMLElement) => element.style.getPropertyValue("--kid-zoom");

describe("KidPage zoom", () => {
  it("zooms a large window and sizes the session frame in inner pixels", () => {
    stubWindow(3440, 1440);
    stubFinePointer(true);
    const frame = renderSession();
    expect(frame.getAttribute("data-kid-scale")).toBe("1.6");
    expect(kidZoom(frame)).toBe("1.6");
    // zoom multiplies inline lengths, so 900px renders as the whole 1440px window
    expect(frame.style.height).toBe("900px");
    expect(frame.getAttribute("data-viewport-short")).toBeNull();
  });

  it("divides the frame offset by the scale as well", () => {
    stubWindow(3440, 1440, { height: 1360, offsetTop: 80 });
    stubFinePointer(true);
    const frame = renderSession();
    expect(frame.style.height).toBe("850px");
    expect(frame.style.top).toBe("50px");
  });

  it("leaves a phone window unzoomed", () => {
    stubWindow(390, 750);
    stubFinePointer(false);
    const frame = renderSession();
    expect(frame.getAttribute("data-kid-scale")).toBe("1");
    expect(kidZoom(frame)).toBe("");
    expect(frame.style.height).toBe("750px");
  });

  it("zooms flow pages too", () => {
    stubWindow(3440, 1440);
    stubFinePointer(true);
    const { container } = renderKid(<KidPage mode="flow"><p>Profile</p></KidPage>);
    const page = container.querySelector<HTMLElement>(".kid-page")!;
    expect(page.getAttribute("data-kid-scale")).toBe("1.6");
    expect(kidZoom(page)).toBe("1.6");
    expect(page.style.height).toBe("");
  });

  it("pinch zoom keeps scale", () => {
    const viewport = stubWindow(3440, 1440);
    stubFinePointer(true);
    const frame = renderSession();
    act(() => viewport.pinch(2));
    expect(frame.getAttribute("data-zoomed")).toBe("true");
    expect(frame.getAttribute("data-kid-scale")).toBe("1.6");
    expect(kidZoom(frame)).toBe("1.6");
    // The zoomed session flows naturally, without a fixed frame height.
    expect(frame.style.height).toBe("");
  });

  it("fine pointer change rescales", () => {
    stubWindow(3440, 1440);
    const pointer = stubFinePointer(false);
    const frame = renderSession();
    expect(frame.getAttribute("data-kid-scale")).toBe("1");
    expect(kidZoom(frame)).toBe("");
    expect(frame.style.height).toBe("1440px");

    act(() => pointer.setFine(true));
    expect(frame.getAttribute("data-kid-scale")).toBe("1.6");
    expect(kidZoom(frame)).toBe("1.6");
    expect(frame.style.height).toBe("900px");

    // Back to a coarse pointer: the zoom goes away and the frame is the whole window again.
    act(() => pointer.setFine(false));
    expect(frame.getAttribute("data-kid-scale")).toBe("1");
    expect(kidZoom(frame)).toBe("");
    expect(frame.style.height).toBe(`${window.innerHeight}px`);
  });
});
