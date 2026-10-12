import { describe, expect, it } from "vitest";
import type { LessonItem } from "@learning/contracts";
import { addBlock, blockState, isComplete, placedIds, removeAt, type BlockState } from "./block-order";

const items: LessonItem[] = [
  { id: "10000000-0000-4000-8000-000000000001", text: "She" },
  { id: "10000000-0000-4000-8000-000000000002", text: "plays" },
  { id: "10000000-0000-4000-8000-000000000003", text: "football" },
];

describe("block-order — stan układania klocków (lesson_order)", () => {
  it("startowy stan ma pustą ułożoną listę i wszystkie klocki w puli", () => {
    const state = blockState(items);
    expect(placedIds(state)).toEqual([]);
    expect(state.pool.map((item) => item.id)).toEqual(items.map((item) => item.id));
    expect(isComplete(state)).toBe(false);
  });

  it("dotknięcie klocka przenosi go z puli do zdania, zachowując kolejność dotknięć", () => {
    let state: BlockState = blockState(items);
    state = addBlock(state, items[1]!.id); // plays
    state = addBlock(state, items[0]!.id); // She
    expect(placedIds(state)).toEqual([items[1]!.id, items[0]!.id]);
    expect(state.pool.map((item) => item.id)).toEqual([items[2]!.id]);
  });

  it("dotknięcie klocka już ułożonego nic nie zmienia (idempotentne wobec puli)", () => {
    let state: BlockState = blockState(items);
    state = addBlock(state, items[0]!.id);
    const again = addBlock(state, items[0]!.id);
    expect(placedIds(again)).toEqual([items[0]!.id]);
    expect(again.pool).toHaveLength(2);
  });

  it("dotknięcie w zdaniu cofa klocek z powrotem do puli na jego pierwotną pozycję", () => {
    let state: BlockState = blockState(items);
    state = addBlock(state, items[0]!.id); // She
    state = addBlock(state, items[1]!.id); // plays
    state = addBlock(state, items[2]!.id); // football
    state = removeAt(state, 1); // cofnij „plays”
    expect(placedIds(state)).toEqual([items[0]!.id, items[2]!.id]);
    // pula zachowuje kolejność katalogową
    expect(state.pool.map((item) => item.id)).toEqual([items[1]!.id]);
  });

  it("kompletność dopiero po ułożeniu wszystkich kloców", () => {
    let state: BlockState = blockState(items);
    expect(isComplete(state)).toBe(false);
    for (const item of items) state = addBlock(state, item.id);
    expect(isComplete(state)).toBe(true);
    expect(placedIds(state)).toEqual(items.map((item) => item.id));
  });

  it("usunięcie poza zakresem nic nie zmienia", () => {
    const state = blockState(items);
    expect(removeAt(state, 5)).toEqual(state);
  });
});
