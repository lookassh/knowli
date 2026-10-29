import { describe, expect, it } from "vitest";
import { KEYBOARD_MIN_SHRINK_PX, NEW_FIELD_TRACKING, trackViewport, viewportShrunk, virtualKeyboardOpen } from "./virtual-keyboard";

const base = { textEntryFocused: true, coarsePointer: false, shrunk: false, dismissed: false };

describe("viewportShrunk", () => {
  it("próg ubytku widocznego obszaru", () => {
    expect(viewportShrunk(844, { height: 844 - KEYBOARD_MIN_SHRINK_PX, scale: 1 })).toBe(true);
    expect(viewportShrunk(844, { height: 844 - KEYBOARD_MIN_SHRINK_PX + 1, scale: 1 })).toBe(false);
  });

  it("powiększenie gestem i brak visualViewport dają pomiar nieporównywalny", () => {
    expect(viewportShrunk(844, { height: 300, scale: 2 })).toBeNull();
    expect(viewportShrunk(844, null)).toBeNull();
  });
});

describe("trackViewport", () => {
  const sequence = (...measurements: Array<boolean | null>) => measurements.reduce(trackViewport, NEW_FIELD_TRACKING);

  it("powrót do pełnej wysokości po zmniejszeniu oznacza schowaną klawiaturę", () => {
    expect(sequence(true, false)).toEqual({ shrunk: false, keyboardSeen: true, dismissed: true });
    // ponowne wysunięcie w tym samym polu
    expect(sequence(true, false, true)).toEqual({ shrunk: true, keyboardSeen: true, dismissed: false });
  });

  it("bez wcześniejszego zmniejszenia pełna wysokość nie jest schowaniem (klawiatura dopiero się wysuwa)", () => {
    expect(sequence(false, false).dismissed).toBe(false);
  });

  it("powiększenie gestem przy otwartej klawiaturze nie jest jej schowaniem", () => {
    const zoomed = sequence(true, null);
    expect(zoomed).toEqual({ shrunk: true, keyboardSeen: true, dismissed: false });
    expect(virtualKeyboardOpen({ ...base, shrunk: zoomed.shrunk, dismissed: zoomed.dismissed })).toBe(true);
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
  });
});
