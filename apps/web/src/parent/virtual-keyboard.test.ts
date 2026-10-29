import { describe, expect, it } from "vitest";
import { KEYBOARD_MIN_SHRINK_PX, viewportShrunk, virtualKeyboardOpen } from "./virtual-keyboard";

const base = { textEntryFocused: true, coarsePointer: false, shrunk: false, dismissed: false };

describe("viewportShrunk", () => {
  it("próg ubytku widocznego obszaru", () => {
    expect(viewportShrunk(844, { height: 844 - KEYBOARD_MIN_SHRINK_PX, scale: 1 })).toBe(true);
    expect(viewportShrunk(844, { height: 844 - KEYBOARD_MIN_SHRINK_PX + 1, scale: 1 })).toBe(false);
  });

  it("powiększenie gestem i brak visualViewport nie udają klawiatury", () => {
    expect(viewportShrunk(844, { height: 300, scale: 2 })).toBe(false);
    expect(viewportShrunk(844, null)).toBe(false);
  });
});

describe("virtualKeyboardOpen", () => {
  it("bez fokusu w polu tekstowym klawiatury nie ma", () => {
    expect(virtualKeyboardOpen({ ...base, textEntryFocused: false, coarsePointer: true, shrunk: true })).toBe(false);
  });

  it("zmniejszony widoczny obszar rozstrzyga także bez dotyku", () => {
    expect(virtualKeyboardOpen({ ...base, shrunk: true })).toBe(true);
    expect(virtualKeyboardOpen(base)).toBe(false);
  });

  it("telefon: fokus w polu wystarczy, dopóki klawiatura nie zostanie schowana przy aktywnym polu", () => {
    expect(virtualKeyboardOpen({ ...base, coarsePointer: true })).toBe(true);
    expect(virtualKeyboardOpen({ ...base, coarsePointer: true, dismissed: true })).toBe(false);
    // ponowne stuknięcie w pole wysuwa klawiaturę — obszar znów zmniejszony
    expect(virtualKeyboardOpen({ ...base, coarsePointer: true, dismissed: true, shrunk: true })).toBe(true);
  });
});
