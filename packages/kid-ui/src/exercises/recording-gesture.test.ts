import { describe, expect, it } from "vitest";
import { reduceRecordingGesture, type GestureState } from "./recording-gesture";

const idle: GestureState = { owner: null, active: false };

describe("reduceRecordingGesture", () => {
  it("starts one pointer owner and ignores another pointer until release", () => {
    const started = reduceRecordingGesture(idle, { type: "start", owner: { kind: "pointer", id: 7 } });
    expect(started).toEqual({ state: { owner: { kind: "pointer", id: 7 }, active: true }, action: "start" });
    expect(reduceRecordingGesture(started.state, { type: "start", owner: { kind: "pointer", id: 8 } }))
      .toEqual({ state: started.state, action: "none" });
    expect(reduceRecordingGesture(started.state, { type: "release", owner: { kind: "pointer", id: 8 } }))
      .toEqual({ state: started.state, action: "none" });
  });

  it("stops once on the owner's release and treats capture loss afterward as harmless", () => {
    const started = reduceRecordingGesture(idle, { type: "start", owner: { kind: "pointer", id: 3 } });
    const stopped = reduceRecordingGesture(started.state, { type: "release", owner: { kind: "pointer", id: 3 } });
    expect(stopped).toEqual({ state: { owner: null, active: true }, action: "stop" });
    expect(reduceRecordingGesture(stopped.state, { type: "cancel", owner: { kind: "pointer", id: 3 } }))
      .toEqual({ state: stopped.state, action: "none" });
    expect(reduceRecordingGesture(stopped.state, { type: "settled" }))
      .toEqual({ state: idle, action: "none" });
  });

  it("cancels unexpected capture loss and Escape for the active gesture", () => {
    const started = reduceRecordingGesture(idle, { type: "start", owner: { kind: "key", key: "Space" } });
    expect(reduceRecordingGesture(started.state, { type: "cancel", owner: { kind: "key", key: "Space" } }))
      .toEqual({ state: { owner: null, active: true }, action: "cancel" });
    expect(reduceRecordingGesture(started.state, { type: "escape" }))
      .toEqual({ state: { owner: null, active: true }, action: "cancel" });
    expect(reduceRecordingGesture({ owner: null, active: true }, { type: "escape" }))
      .toEqual({ state: { owner: null, active: true }, action: "cancel" });
  });

  it("ignores key repeat and second activation while the first key owns the gesture", () => {
    const started = reduceRecordingGesture(idle, { type: "start", owner: { kind: "key", key: "Enter" } });
    expect(reduceRecordingGesture(started.state, { type: "start", owner: { kind: "key", key: "Enter" }, repeat: true }))
      .toEqual({ state: started.state, action: "none" });
    expect(reduceRecordingGesture(started.state, { type: "start", owner: { kind: "key", key: "Space" } }))
      .toEqual({ state: started.state, action: "none" });
  });

  it("toggles once for click or keyboard activation", () => {
    const started = reduceRecordingGesture(idle, { type: "toggle" });
    expect(started).toEqual({ state: { owner: null, active: true }, action: "start" });
    expect(reduceRecordingGesture(started.state, { type: "toggle" }))
      .toEqual({ state: { owner: null, active: false }, action: "stop" });
  });
});
