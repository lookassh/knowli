// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { MicrophoneSettingsButton } from "./MicrophoneSettingsButton";

afterEach(cleanup);

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
});
