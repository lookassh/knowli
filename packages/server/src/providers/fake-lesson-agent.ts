import type { ClosedCheckInput, ClosedExerciseChecker, LessonPacketGenerator, LessonPacketInput, RunCostSink } from "../ports/ai";
import type { UsageRecorder } from "../ports/usage";
import { FAKE_SLOW_DELAY_MS, FAKE_SLOW_MARKER, fakeClosedAnswer, fakePacketExercises } from "./fake-lesson-pool";
import { recordResponse } from "./usage/record-http";

/**
 * Deterministyczne fake'i generatora paczek i kontroli zadań zamkniętych przebiegu bazowego: sterowane
 * scenariuszem, bez sieci i modeli. Służą testom i trybowi `UMIEM_FAKE_PROVIDERS=1`; nie są adapterem
 * żadnej usługi. Scenariusze rozpoznają zagadnienia po slugu z identyfikatora celu.
 */

/**
 * Krok scenariusza paczki przebiegu bazowego (`generatePacket`). Kolejne wywołania paczek celu biorą kolejne
 * kroki (w kolejności wejścia do semafora); po ich końcu — generator ({@link fakePacketExercises}). Koszt
 * paczki jest zapisany przed krokiem.
 */
export type FakePacketStep =
  | { throw: Error }
  /** „Wywołanie w locie”: `onReached`, potem czekanie na `gate` (dalej generator); przerwanie odrzuca `signal.reason`. */
  | { gate: Promise<void>; onReached?: () => void }
  /** Czeka do przerwania sygnału i odrzuca `signal.reason`. */
  | { hang: true }
  /** Dostawca ignorujący przerwanie: krok nigdy się nie kończy. */
  | { stall: true }
  /** Wynik zbudowany z wejścia paczki. */
  | { build: (input: LessonPacketInput) => { exercises: unknown[]; examples?: unknown[] } };

export interface FakeLessonPoolAgentOptions {
  /** Koszt jednej paczki zapisywany w `RunCostSink`; brak = `null` (koszt nieznany). */
  stepCostUsd?: number | null;
  /** Dziennik kosztów: jeden `recordResponse` na paczkę (jak adapter na żądanie HTTP), `provider` `"openrouter"`, operacja `packet_generate`. */
  usage?: UsageRecorder;
  /** `delayMs` opóźnia każdą paczkę, a `FAKE_SLOW_MARKER` w materiale — do co najmniej `FAKE_SLOW_DELAY_MS`; sen przerywa sygnał. */
  generate?: { delayMs?: number };
  /** Scenariusze paczek per slug zagadnienia (kolejne wywołania — kolejne kroki). */
  packets?: Record<string, FakePacketStep[]>;
  /** Zapis historii `packetCalls` (domyślnie `true`); proces workera wyłącza go, żeby nie rosła. */
  record?: boolean;
}

/**
 * Czeka na przerwanie sygnału i odrzuca `signal.reason`; przerwany wcześniej odrzuca od razu.
 * `dispose` zdejmuje nasłuch, więc wyścig z innym zdarzeniem nie zostawia listenerów na wspólnym sygnale.
 */
function rejectOnAbort(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let onAbort: (() => void) | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    promise,
    dispose: () => {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    },
  };
}

/** Sen przerywany sygnałem: przerwanie odrzuca `signal.reason`, a timer i nasłuch są zdejmowane zawsze. */
async function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  const abort = rejectOnAbort(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
      abort.promise,
    ]);
  } finally {
    clearTimeout(timer);
    abort.dispose();
  }
}

/** Obietnica, która nigdy się nie rozstrzyga (dostawca ignorujący `signal`). */
function stalled(): Promise<never> {
  return new Promise<never>(() => undefined);
}

/** Śledzi największą liczbę jednocześnie trwających wywołań. */
class ConcurrencyMeter {
  private active = 0;
  max = 0;

  async track<T>(run: () => Promise<T>): Promise<T> {
    this.active += 1;
    this.max = Math.max(this.max, this.active);
    try {
      return await run();
    } finally {
      this.active -= 1;
    }
  }
}

export class FakeLessonPoolAgent implements LessonPacketGenerator {
  readonly name = "fake-lesson-agent";
  readonly model = "fake-lesson-agent-model";
  /** Zapis wywołań `generatePacket` (przy `record !== false`). */
  readonly packetCalls: LessonPacketInput[] = [];
  /** Kolejne pasmo numeracji paczek: każda paczka (także „+N” i wznowienie w tym procesie) ma inne odpowiedzi. */
  private packetBand = 0;
  private readonly packetCounts = new Map<string, number>();
  private readonly meter = new ConcurrencyMeter();

  constructor(private readonly options: FakeLessonPoolAgentOptions = {}) {}

  /** Największa liczba jednocześnie trwających wywołań `generatePacket`. */
  get maxConcurrent(): number {
    return this.meter.max;
  }

  /**
   * Paczka przebiegu bazowego: awaria ze scenariusza `packets` albo generator ({@link fakePacketExercises}) w nowym
   * paśmie numeracji. Opóźnienie jak krok generatora (`delayMs`, `FAKE_SLOW_MARKER` w każdej paczce — biegną
   * równolegle); koszt zapisany przed wynikiem jako `packet_generate`.
   */
  async generatePacket(input: LessonPacketInput, cost: RunCostSink, signal: AbortSignal): Promise<{ exercises: unknown[]; examples?: unknown[] }> {
    if (this.options.record !== false) this.packetCalls.push(input);
    const slug = input.objective.id.split(".").at(-1) ?? input.objective.id;
    const call = this.packetCounts.get(slug) ?? 0;
    this.packetCounts.set(slug, call + 1);
    const band = this.packetBand;
    this.packetBand += 1000;
    return this.meter.track(async () => {
      signal.throwIfAborted();
      const base = this.options.generate?.delayMs ?? 0;
      const ms = input.pool.material.includes(FAKE_SLOW_MARKER) ? Math.max(base, FAKE_SLOW_DELAY_MS) : base;
      if (ms > 0) await sleepUnlessAborted(ms, signal);
      this.recordStep(cost);
      const step = this.options.packets?.[slug]?.[call];
      if (step === undefined) return fakePacketExercises(input, band);
      if ("throw" in step) throw step.throw;
      if ("build" in step) return step.build(input);
      if ("stall" in step) return stalled();
      if ("gate" in step) step.onReached?.();
      const abort = rejectOnAbort(signal);
      try {
        await Promise.race(["gate" in step ? step.gate : abort.promise, abort.promise]);
      } finally {
        abort.dispose();
      }
      return fakePacketExercises(input, band);
    });
  }

  /** Koszt „wywołania modelu”: licznik runu i dziennik kosztów z tego samego zdarzenia (jak adapter). */
  private recordStep(cost: RunCostSink): void {
    const usd = this.options.stepCostUsd ?? null;
    cost.record(usd);
    recordResponse(
      this.options.usage,
      { feature: "lesson_generation", operation: "packet_generate", provider: "openrouter", model: this.model },
      200,
      { usage: usd === null ? {} : { cost: usd } },
    );
  }
}

export interface FakeExerciseCheckerOptions {
  /** Koszt jednego wywołania; domyślnie 0, `null` = nieznany. */
  costUsd?: number | null;
  /** Wywołania czekają na tę obietnicę (testy równoległości); przerwanie sygnału przerywa oczekiwanie. */
  gate?: Promise<void>;
}

export class FakeExerciseChecker implements ClosedExerciseChecker {
  readonly name = "fake-lesson-checker";
  readonly model = "fake-lesson-checker-model";
  readonly closedCalls: ClosedCheckInput[] = [];
  private readonly meter = new ConcurrencyMeter();

  constructor(private readonly options: FakeExerciseCheckerOptions = {}) {}

  /** Największa liczba jednocześnie trwających wywołań `checkClosed`. */
  get maxConcurrent(): number {
    return this.meter.max;
  }

  /**
   * Kontrola zamkniętych przebiegu bazowego: rozsypanka `yes`, wybór — klucz ćwiczenia fake'a odczytany
   * z widoku ({@link fakeClosedAnswer}).
   */
  checkClosed(input: ClosedCheckInput, cost: RunCostSink, signal: AbortSignal): Promise<{ results: unknown[] }> {
    this.closedCalls.push(input);
    return this.meter.track(async () => {
      await this.admit(cost, signal);
      return {
        results: input.items.map((item) => {
          if (input.contract === "order") return { verdict: "yes" };
          return { answers: fakeClosedAnswer(item.view) };
        }),
      };
    });
  }

  /** Czeka na `gate` (z przerwaniem), potem zapisuje koszt żądania — także gdy wynik będzie wyjątkiem. */
  private async admit(cost: RunCostSink, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.options.gate) {
      const abort = rejectOnAbort(signal);
      try {
        await Promise.race([this.options.gate, abort.promise]);
      } finally {
        abort.dispose();
      }
    }
    cost.record(this.options.costUsd === undefined ? 0 : this.options.costUsd);
  }
}
