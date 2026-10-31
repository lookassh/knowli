// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { KidViewportProvider } from "../layout/viewport";
import { MicrophoneSettingsButton } from "./MicrophoneSettingsButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, "currentCSSZoom");
});

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
});

describe("MicrophoneSettingsButton", () => {
  it("opens settings without changing the microphone choice", async () => {
    const onToggleMicrophone = vi.fn();
    renderKid(<MicrophoneSettingsButton microphone={false} micDenied={false} onToggleMicrophone={onToggleMicrophone} />);

    const button = screen.getByTestId("kid-mic-settings");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Odpowiedzi głosowe wyłączone");
    expect(screen.queryByTestId("kid-mic-toggle")).toBeNull();

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByTestId("kid-mic-toggle")).toBeTruthy();
    expect(screen.getByTestId("kid-microphone-hint").textContent).toContain("bez nagrywania");
    expect(onToggleMicrophone).not.toHaveBeenCalled();
  });

  it("reports the selected setting and shows microphone denial details only when opened", async () => {
    renderKid(<MicrophoneSettingsButton microphone={true} micDenied={true} onToggleMicrophone={vi.fn()} />);

    const button = screen.getByTestId("kid-mic-settings");
    expect(button.getAttribute("aria-label")).toBe("Odpowiedzi głosowe włączone");
    expect(screen.queryByTestId("kid-mic-denied-hint")).toBeNull();

    fireEvent.click(button);
    expect(await screen.findByTestId("kid-mic-denied-hint")).toBeTruthy();
  });

  it("forwards both explicit switch choices", async () => {
    const onToggleMicrophone = vi.fn();
    const { rerender } = renderKid(
      <MicrophoneSettingsButton microphone={false} micDenied={false} onToggleMicrophone={onToggleMicrophone} />,
    );
    fireEvent.click(screen.getByTestId("kid-mic-settings"));
    fireEvent.click(await screen.findByTestId("kid-mic-toggle"));
    expect(onToggleMicrophone).toHaveBeenLastCalledWith(true);

    rerender(<MicrophoneSettingsButton microphone={true} micDenied={false} onToggleMicrophone={onToggleMicrophone} />);
    fireEvent.click(await screen.findByTestId("kid-mic-toggle"));
    expect(onToggleMicrophone).toHaveBeenLastCalledWith(false);
  });

  it("closes on Escape and returns focus to the settings button", async () => {
    renderKid(<MicrophoneSettingsButton microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} />);
    const button = screen.getByTestId("kid-mic-settings");
    fireEvent.click(button);
    await screen.findByTestId("kid-mic-toggle");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("kid-mic-settings-panel")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("repositions the open panel when the visible viewport offset changes", async () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const addViewportListener = vi.fn();
    const removeViewportListener = vi.fn();
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        addEventListener: addViewportListener,
        removeEventListener: removeViewportListener,
      } as unknown as VisualViewport,
    });
    const renderSettings = (offsetTop: number) => (
      <KidViewportProvider viewport={{ width: 360, height: 640, offsetTop, zoomed: false, scale: 1 }}>
        <MicrophoneSettingsButton microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} />
      </KidViewportProvider>
    );
    const { rerender } = renderKid(renderSettings(0));
    fireEvent.click(screen.getByTestId("kid-mic-settings"));
    const panel = await screen.findByTestId("kid-mic-settings-panel");
    expect(panel.style.top).toBe("16px");
    expect(addViewportListener).toHaveBeenCalledWith("scroll", expect.any(Function));

    rerender(renderSettings(24));

    expect(panel.style.top).toBe("40px");
    expect(removeViewportListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    if (originalVisualViewport) Object.defineProperty(window, "visualViewport", originalVisualViewport);
    else Reflect.deleteProperty(window, "visualViewport");
  });

  it("places the panel in inner pixels under a 1.6 zoom", async () => {
    // jsdom has no CSS zoom: report 1.6 for every element, as a large window under KidPage does.
    Object.defineProperty(Element.prototype, "currentCSSZoom", { configurable: true, get: () => 1.6 });
    // Rectangles are screen pixels: a button at the right edge of a narrow window and a panel wider than the room left of it.
    const screenSize = { width: 600, height: 800 };
    const buttonRect = rect(540, 20, 48, 48);
    const panelRect = rect(0, 0, 400, 200);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const testId = this.getAttribute("data-testid");
      return testId === "kid-mic-settings" ? buttonRect : testId === "kid-mic-settings-panel" ? panelRect : rect(0, 0, 0, 0);
    });
    // --kid-safe-* are not set in jsdom, so the component's 16 px floor applies on every side.
    renderKid(
      <KidViewportProvider viewport={{ ...screenSize, offsetTop: 0, zoomed: false, scale: 1.6 }}>
        <MicrophoneSettingsButton microphone={false} micDenied={false} onToggleMicrophone={vi.fn()} />
      </KidViewportProvider>,
    );

    fireEvent.click(screen.getByTestId("kid-mic-settings"));
    const panel = await screen.findByTestId("kid-mic-settings-panel");

    // The 8 px gap and the 16 px margin are inner pixels, so they grow with the zoom; the result is divided back,
    // because the zoom multiplies the left/top of a fixed element once more when painting.
    expect(Number.parseFloat(panel.style.top)).toBeCloseTo((buttonRect.bottom + 8 * 1.6) / 1.6, 5);
    expect(Number.parseFloat(panel.style.left)).toBeCloseTo((screenSize.width - panelRect.width - 16 * 1.6) / 1.6, 5);
  });
});
