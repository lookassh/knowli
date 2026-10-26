// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { SpeechRecordButton } from "./SpeechRecordButton";

afterEach(cleanup);

function renderControl(overrides: Partial<ComponentProps<typeof SpeechRecordButton>> = {}) {
  const handlers = { onPrepare: vi.fn(), onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn() };
  renderKid(<SpeechRecordButton phase="idle" ready={true} disabled={false} level={null} mode="hold" {...handlers} {...overrides} />);
  return handlers;
}

describe("SpeechRecordButton", () => {
  it("starts and stops a hold gesture on pointer down and up", () => {
    const handlers = renderControl();
    const button = screen.getByTestId("kid-record");
    fireEvent.pointerDown(button, { pointerId: 7, pointerType: "touch", button: 0 });
    expect(handlers.onStart).toHaveBeenCalledOnce();
    fireEvent.pointerUp(button, { pointerId: 7, pointerType: "touch" });
    expect(handlers.onStop).toHaveBeenCalledOnce();
    expect(handlers.onCancel).not.toHaveBeenCalled();
    expect(button.tagName).toBe("BUTTON");
  });

  it("cancels a cancelled hold gesture without stopping it", () => {
    const handlers = renderControl();
    const button = screen.getByTestId("kid-record");
    fireEvent.pointerDown(button, { pointerId: 9, pointerType: "touch", button: 0 });
    fireEvent.pointerCancel(button, { pointerId: 9, pointerType: "touch" });
    expect(handlers.onStart).toHaveBeenCalledOnce();
    expect(handlers.onCancel).toHaveBeenCalledOnce();
    expect(handlers.onStop).not.toHaveBeenCalled();
  });

  it("uses click to toggle start and stop only in toggle mode", () => {
    const handlers = renderControl({ mode: "toggle" });
    const button = screen.getByTestId("kid-record");
    fireEvent.click(button);
    expect(handlers.onStart).toHaveBeenCalledOnce();
    cleanup();
    renderKid(<SpeechRecordButton phase="recording" ready={true} disabled={false} level={null} mode="toggle" {...handlers} />);
    fireEvent.click(screen.getByTestId("kid-record"));
    expect(handlers.onStop).toHaveBeenCalledOnce();
  });

  it.each([
    { disabled: true },
    { phase: "preparing" as const },
    { phase: "stopping" as const },
  ])("does not start when blocked: %o", (overrides) => {
    const handlers = renderControl(overrides);
    fireEvent.pointerDown(screen.getByTestId("kid-record"), { pointerId: 1, pointerType: "touch", button: 0 });
    fireEvent.click(screen.getByTestId("kid-record"));
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it("keeps an accessible name for the microphone control", () => {
    renderControl();
    expect(screen.getByRole("button", { name: /powiedz/i })).toBeTruthy();
  });
});
