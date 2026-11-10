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

  describe("dyktowanie odpowiedzi (CAP-7)", () => {
    const button = () => screen.getByTestId("kid-record").textContent;
    const status = () => screen.queryByTestId("kid-record-status")?.textContent ?? null;
    const forbidden = /nagraj|przytrzymaj|słowo/i;

    it.each([
      ["gotowy, bezczynny", { phase: "idle", ready: true }, "Powiedz odpowiedź", null],
      ["przed zgodą na mikrofon", { phase: "idle", ready: false }, "Włącz mikrofon", null],
      ["zgoda w toku", { phase: "preparing", ready: false }, "Powiedz odpowiedź", "Włącz mikrofon, a potem powiedz odpowiedź."],
      ["start", { phase: "starting", ready: true }, "Włączam mikrofon…", "Włączam mikrofon…"],
      ["nagrywanie", { phase: "recording", ready: true }, "Dotknij, gdy skończysz", "Słucham — mów teraz"],
      ["kończenie", { phase: "stopping", ready: true }, "Powiedz odpowiedź", "Zapisuję twoją odpowiedź…"],
    ] as const)("%s: teksty mówią o odpowiedzi, bez „Nagraj”, „przytrzymaj” i „słowo” (AC-23, AC-24)", (_name, props, label, line) => {
      renderControl({ mode: "toggle", dictation: true, ...props });
      expect(button()).toBe(label);
      expect(status()).toBe(line);
      expect(screen.getByTestId("kid-record-controls").textContent).not.toMatch(forbidden);
    });

    it("w fazie kończenia nie pokazuje już „Nagrywam…”", () => {
      renderControl({ mode: "toggle", dictation: true, phase: "stopping" });
      expect(screen.queryByTestId("kid-recording")).toBeNull();
    });

    it.each([
      ["hold, gotowy", { mode: "hold", phase: "idle", ready: true }, "Przytrzymaj i powiedz", null],
      ["toggle, gotowy", { mode: "toggle", phase: "idle", ready: true }, "Nagraj", null],
      ["hold, przed zgodą", { mode: "hold", phase: "idle", ready: false }, "Włącz mikrofon", "Przytrzymaj przycisk, aby włączyć mikrofon i zacząć."],
      ["hold, zgoda w toku", { mode: "hold", phase: "preparing", ready: false }, "Przytrzymaj i powiedz", "Włącz mikrofon, a potem przytrzymaj przycisk i powiedz słowo."],
      ["toggle, nagrywanie", { mode: "toggle", phase: "recording", ready: true }, "Słucham — mów teraz", "Słucham — mów teraz"],
      ["toggle, kończenie", { mode: "toggle", phase: "stopping", ready: true }, "Nagraj", "Kończę nagrywanie…"],
    ] as const)("ćwiczenie słówek bez zmian — %s (AC-25)", (_name, props, label, line) => {
      renderControl(props);
      expect(button()).toBe(label);
      expect(status()).toBe(line);
    });
  });

  it("keeps an accessible name for the microphone control", () => {
    renderControl();
    expect(screen.getByRole("button", { name: /powiedz/i })).toBeTruthy();
  });
});
