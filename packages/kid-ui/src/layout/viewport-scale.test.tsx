// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { stubFinePointer } from "../test/fine-pointer-stub";
import { act, cleanup, renderKid, screen } from "../test/render-kid";
import { useKidPageViewport } from "./viewport";
import { KidPage } from "./KidPage";

const originalMatchMedia = window.matchMedia;
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  if (originalInnerWidth) Object.defineProperty(window, "innerWidth", originalInnerWidth);
  if (originalInnerHeight) Object.defineProperty(window, "innerHeight", originalInnerHeight);
});

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function ScaleProbe() {
  const viewport = useKidPageViewport();
  return <output data-testid="scale-probe">{viewport.scale}</output>;
}

function renderProbe() {
  return renderKid(
    <KidPage mode="flow">
      <ScaleProbe />
    </KidPage>,
  );
}

const scaleText = () => screen.getByTestId("scale-probe").textContent;

describe("KidPage viewport scale", () => {
  it("shares the measured scale with descendants when the pointer is fine", () => {
    setWindowSize(2560, 1300);
    stubFinePointer(true);
    renderProbe();
    expect(scaleText()).toBe("1.44");
  });

  it("keeps the scale at 1 on touch devices regardless of the window size", () => {
    setWindowSize(3440, 1440);
    stubFinePointer(false);
    renderProbe();
    expect(scaleText()).toBe("1");
  });

  it("defaults to a scale of 1 outside KidPage", () => {
    renderKid(<ScaleProbe />);
    expect(scaleText()).toBe("1");
  });

  it("recomputes when the window is resized", () => {
    setWindowSize(1536, 730);
    stubFinePointer(true);
    renderProbe();
    expect(scaleText()).toBe("1");

    act(() => {
      setWindowSize(3440, 1440);
      window.dispatchEvent(new Event("resize"));
    });
    expect(scaleText()).toBe("1.6");
  });

  it("recomputes when the pointer capability changes and stops listening on unmount", () => {
    setWindowSize(1920, 1080);
    const pointer = stubFinePointer(false);
    const { unmount } = renderProbe();
    expect(scaleText()).toBe("1");
    expect(pointer.listeners.size).toBe(1);

    act(() => pointer.setFine(true));
    expect(scaleText()).toBe("1.2");

    unmount();
    expect(pointer.listeners.size).toBe(0);
  });
});
