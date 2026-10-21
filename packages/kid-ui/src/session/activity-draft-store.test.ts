import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserActivityDraftStore, createMemoryActivityDraftStore, type SessionActivityDraft } from "./activity-draft-store";

class FakeStorage implements Storage {
  #values = new Map<string, string>();
  get length() { return this.#values.size; }
  clear() { this.#values.clear(); }
  getItem(key: string) { return this.#values.get(key) ?? null; }
  key(index: number) { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string) { this.#values.delete(key); }
  setItem(key: string, value: string) { this.#values.set(key, value); }
}

const state = { version: 1 as const, startedAtMs: 0, lastActivityAtMs: 0, lastEventAtMs: 0, activeStartMs: null, openPlayback: null, pendingPause: null, currentTaskId: null, compacted: false, incomplete: undefined, tasks: [] };

describe("browser activity draft store", () => {
  const original = globalThis.localStorage;
  afterEach(() => { vi.stubGlobal("localStorage", original); });

  it("removes an expired key without skipping the following fresh final payload", () => {
    const storage = new FakeStorage();
    vi.stubGlobal("localStorage", storage);
    const now = 10_000_000;
    const expired: SessionActivityDraft = { sessionId: "expired", childId: "child", savedAtMs: now - 7 * 24 * 60 * 60_000 - 1, state };
    const fresh: SessionActivityDraft = { sessionId: "fresh", childId: "child", savedAtMs: now, state, finalPayload: { version: 1, elapsedMs: 1, activeMs: 0, compacted: false, tasks: [] } };
    storage.setItem("umiem.activity-draft.expired", JSON.stringify(expired));
    storage.setItem("umiem.activity-draft.fresh", JSON.stringify(fresh));
    const store = createBrowserActivityDraftStore(() => now);
    expect(store.listForChild("child")).toEqual([fresh]);
    expect(store.load("fresh")).toEqual(fresh);
  });
});

describe("pending activity result store", () => {
  it("keeps only a versioned session and child marker after the report is accepted", () => {
    const store = createMemoryActivityDraftStore();
    store.savePendingResult({ version: 1, sessionId: "session-1", childId: "child-1", savedAtMs: 100 });

    expect(store.load("session-1")).toEqual({ version: 1, sessionId: "session-1", childId: "child-1", savedAtMs: 100 });
    expect(store.listPendingResults()).toEqual([{ version: 1, sessionId: "session-1", childId: "child-1", savedAtMs: 100 }]);
  });
});
