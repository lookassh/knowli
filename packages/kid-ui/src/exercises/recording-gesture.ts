export type GestureOwner = { kind: "pointer"; id: number } | { kind: "key"; key: "Space" | "Enter" };

export interface GestureState {
  owner: GestureOwner | null;
  /** True until the controller reports that recording has settled. */
  active: boolean;
}

export type GestureEvent =
  | { type: "start"; owner: GestureOwner; repeat?: boolean }
  | { type: "release"; owner: GestureOwner }
  | { type: "cancel"; owner?: GestureOwner }
  | { type: "escape" }
  | { type: "toggle" }
  | { type: "settled" };

export type GestureAction = "none" | "start" | "stop" | "cancel";

function sameOwner(left: GestureOwner | null, right: GestureOwner | undefined): boolean {
  if (left === null || right === undefined || left.kind !== right.kind) return false;
  return left.kind === "pointer" ? left.id === (right as Extract<GestureOwner, { kind: "pointer" }>).id
    : left.key === (right as Extract<GestureOwner, { kind: "key" }>).key;
}

export function reduceRecordingGesture(state: GestureState, event: GestureEvent): { state: GestureState; action: GestureAction } {
  if (event.type === "settled") return { state: { owner: null, active: false }, action: "none" };
  if (event.type === "escape") {
    return state.active
      ? { state: { owner: null, active: true }, action: "cancel" }
      : { state, action: "none" };
  }
  if (event.type === "toggle") {
    if (state.owner !== null) return { state, action: "none" };
    return state.active
      ? { state: { owner: null, active: false }, action: "stop" }
      : { state: { owner: null, active: true }, action: "start" };
  }
  if (event.type === "start") {
    if (event.repeat || state.active || state.owner !== null) return { state, action: "none" };
    return { state: { owner: event.owner, active: true }, action: "start" };
  }
  if (!sameOwner(state.owner, event.owner)) return { state, action: "none" };
  return {
    state: { owner: null, active: true },
    action: event.type === "release" ? "stop" : "cancel",
  };
}
