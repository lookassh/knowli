import { describe, expect, it } from "vitest";
import {
  addToGroup, groupAssignments, groupComplete, groupPool, groupState, itemsIn, matchAssignments, matchComplete, matchPool,
  matchState, placeRight, removeFromGroup, rightOf, selectGroup, selectSlot,
} from "./assignment-state";

const item = (id: string) => ({ id, text: id.toUpperCase() });

describe("stan „Połącz w pary”", () => {
  const start = matchState([item("l1"), item("l2"), item("l3")], [item("r1"), item("r2"), item("r3"), item("rx")]);

  it("pierwsze miejsce aktywne; wstawienie przesuwa aktywne do następnego pustego", () => {
    expect(start.active).toBe("l1");
    const next = placeRight(start, "r2");
    expect(rightOf(next, "l1")?.id).toBe("r2");
    expect(next.active).toBe("l2");
    expect(matchPool(next).map((entry) => entry.id)).toEqual(["r1", "r3", "rx"]);
  });

  it("dotknięcie zajętego miejsca oddaje element i czyni miejsce aktywnym; po końcu wraca do pierwszego pustego", () => {
    let state = placeRight(placeRight(placeRight(start, "r1"), "r2"), "r3");
    expect(matchComplete(state)).toBe(true);
    expect(state.active).toBeNull();
    state = selectSlot(state, "l2");
    expect(state.active).toBe("l2");
    expect(rightOf(state, "l2")).toBeNull();
    expect(matchComplete(state)).toBe(false);
    state = placeRight(state, "rx");
    expect(matchAssignments(state)).toEqual([
      { itemId: "l1", targetId: "r1" }, { itemId: "l2", targetId: "rx" }, { itemId: "l3", targetId: "r3" },
    ]);
  });

  it("ignoruje element spoza puli i brak aktywnego miejsca", () => {
    const placed = placeRight(start, "r1");
    expect(placeRight(placed, "r1")).toBe(placed);
    const full = placeRight(placeRight(placed, "r2"), "r3");
    expect(placeRight(full, "rx")).toBe(full);
  });
});

describe("stan „Pogrupuj”", () => {
  const start = groupState([item("g1"), item("g2")], [item("a"), item("b"), item("c"), item("d")]);

  it("dodaje do aktywnej grupy, przełącza grupę i oddaje element do puli", () => {
    let state = addToGroup(start, "a");
    state = addToGroup(selectGroup(state, "g2"), "c");
    expect(itemsIn(state, "g1").map((entry) => entry.id)).toEqual(["a"]);
    expect(itemsIn(state, "g2").map((entry) => entry.id)).toEqual(["c"]);
    state = removeFromGroup(state, "a");
    expect(groupPool(state).map((entry) => entry.id)).toEqual(["a", "b", "d"]);
  });

  it("komplet przypisań w kolejności elementów zadania", () => {
    let state = addToGroup(addToGroup(start, "b"), "a");
    state = addToGroup(addToGroup(selectGroup(state, "g2"), "d"), "c");
    expect(groupComplete(state)).toBe(true);
    expect(groupAssignments(state)).toEqual([
      { itemId: "a", targetId: "g1" }, { itemId: "b", targetId: "g1" }, { itemId: "c", targetId: "g2" }, { itemId: "d", targetId: "g2" },
    ]);
  });
});
