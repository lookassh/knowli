import { describe, expect, it, vi } from "vitest";
import { runOnce } from "./run-once";

describe("runOnce", () => {
  it("runs the confirmed action only on the first call", () => {
    const action = vi.fn();
    const confirm = runOnce(action);
    confirm();
    confirm();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("guards each confirmation separately", () => {
    const action = vi.fn();
    runOnce(action)();
    runOnce(action)();
    expect(action).toHaveBeenCalledTimes(2);
  });
});
