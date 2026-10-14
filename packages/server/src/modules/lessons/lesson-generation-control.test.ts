import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationProviderError } from "../../ports/generation-error";
import { assertLessonGenerationFinalizationAllowed, LessonGenerationCancelledError, withLessonGenerationControl } from "./lesson-generation-control";

afterEach(() => vi.useRealTimers());

describe("withLessonGenerationControl", () => {
  it("rejects finalization after shutdown or the whole-run deadline", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => assertLessonGenerationFinalizationAllowed(100, controller.signal, () => 50)).toThrow(LessonGenerationCancelledError);
    expect(() => assertLessonGenerationFinalizationAllowed(100, undefined, () => 100)).toThrow(GenerationProviderError);
  });

  it("przerywa zawieszony request po deadline i nie czeka na provider ignorujący abort", async () => {
    vi.useFakeTimers();
    let resolveLate!: (value: string) => void;
    let signal!: AbortSignal;
    const pending = new Promise<string>((resolve) => { resolveLate = resolve; });
    const run = withLessonGenerationControl({ requestTimeoutMs: 25, runTimeoutMs: 200, cancelPollMs: 100, assertCurrent: async () => true },
      (control) => control.call((requestSignal) => { signal = requestSignal; return pending; }));
    const assertion = expect(run).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(26);
    await assertion;
    expect(signal.aborted).toBe(true);
    resolveLate("late result");
    await Promise.resolve();
  });

  it("cały run ma jeden wspólny budget dla wielu requestów", async () => {
    vi.useFakeTimers();
    const run = withLessonGenerationControl({ requestTimeoutMs: 100, runTimeoutMs: 20, cancelPollMs: 100, assertCurrent: async () => true }, async (control) => {
      await control.call((signal) => new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 15);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      }));
      await control.call(() => new Promise<void>(() => undefined));
    });
    const assertion = expect(run).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
  });

  it("anuluje wszystkie requesty po zmianie tożsamości runu", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const run = withLessonGenerationControl({ requestTimeoutMs: 200, runTimeoutMs: 500, cancelPollMs: 10, assertCurrent: async () => ++calls < 2 },
      (control) => control.call((signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))));
    const assertion = expect(run).rejects.toThrow(/superseded/);
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
  });
});
