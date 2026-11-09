import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalMediaStore,
  deterministicBytes,
  FakeImageProvider,
  FakeLlmProvider,
  FakeTtsProvider,
  fakeMediaSettings,
  type GenerationDeps,
  type MediaSettings,
  type MediaStore,
  type UsageFeature,
  type UsageRecorder,
} from "@learning/server/testing";
import {
  FakeExerciseChecker,
  FakeLessonPoolAgent,
  type FakeLessonPoolAgentOptions,
  type FakePacketStep,
} from "../../packages/server/src/providers/fake-lesson-agent";
import type { ClosedCheckInput, RunCostSink } from "../../packages/server/src/ports/ai";
import type { LessonAgentPolicy } from "../../packages/server/src/modules/materials/lessons/lesson-pool-agent-policy";

// Klasy fake'ów żyją w packages/server (współdzielone z trybem
// UMIEM_FAKE_PROVIDERS=1); testy tylko konfigurują zachowania.
export {
  deterministicBytes,
  FakeImageProvider,
  FakeLlmProvider,
  FakeTtsProvider,
  fakeMediaSettings,
  type LlmBehavior,
} from "@learning/server/testing";

export interface FakeGeneration {
  llm: FakeLlmProvider;
  /** Agent puli lekcji składany zawsze (etap 3: jedyny generator lekcji). */
  agent: FakeLessonPoolAgent;
  tts: FakeTtsProvider;
  image: FakeImageProvider;
  store: MediaStore;
  settings: MediaSettings;
  deps: GenerationDeps;
  root: string;
  dispose: () => Promise<void>;
}

export interface FakeGenerationOptions {
  /** Opcje fake'a agenta, nadpisują domyślne `generate: {}`. */
  agent?: FakeLessonPoolAgentOptions;
  /** Checker zamiast domyślnego „niedostępnego”. */
  checker?: FakeExerciseChecker;
  policy?: Partial<LessonAgentPolicy>;
}

export async function fakeGeneration(options: FakeGenerationOptions = {}): Promise<FakeGeneration> {
  const root = await mkdtemp(join(tmpdir(), "knowli-media-"));
  const store = createLocalMediaStore(root);
  const llm = new FakeLlmProvider();
  const tts = new FakeTtsProvider();
  const image = new FakeImageProvider();
  const settings = fakeMediaSettings;
  const agent = new FakeLessonPoolAgent({ generate: {}, ...options.agent });
  return {
    llm,
    tts,
    image,
    store,
    settings,
    agent,
    deps: {
      llm,
      tts,
      image,
      mediaStore: store,
      lessonAgent: {
        agent,
        checker: options.checker ?? new FakeExerciseChecker(),
        policy: options.policy ?? {},
      },
    },
    root,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * Fake providera, który przy każdym wywołaniu metody zwracającej obietnicę zapisuje
 * zdarzenie kosztu — jak prawdziwy adapter, ale bez HTTP. Metoda jest wołana na
 * oryginale (`Reflect.apply(fn, target, args)`): fake'i mają pola `#private`, a
 * `this` równe proxy rzuciłoby TypeError. Wartości niebędące obietnicą (nazwa,
 * wersja promptu) nie są wywołaniami płatnej usługi i niczego nie zapisują.
 */
export function recordingProvider<T extends object>(provider: T, usage: UsageRecorder, feature: UsageFeature): T {
  return new Proxy(provider, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        if (result !== null && typeof result === "object" && typeof (result as { then?: unknown }).then === "function") {
          usage.record({ feature, provider: "fake", outcome: "ok" });
        }
        return result;
      };
    },
  });
}

/**
 * Ten sam krok (albo krok z fabryki, wołanej dla każdej paczki) dla `length` kolejnych paczek slugu: licznik
 * wywołań fake'a biegnie przez próby i runy, a po wyczerpaniu listy fake wraca do generatora.
 */
export function everyPacket(step: FakePacketStep | (() => FakePacketStep), length = 100): FakePacketStep[] {
  return Array.from({ length }, () => (typeof step === "function" ? step() : step));
}

/** Typ ćwiczenia rekordu scenariusza (`undefined` dla rekordów bez typu, np. `null`). */
const typeOf = (exercise: unknown): string | undefined => (exercise as { exerciseType?: unknown } | null)?.exerciseType as string | undefined;

/**
 * Paczki zagadnienia z ręcznymi rekordami: każda paczka dostaje rekordy swojego typu (i towarzysza), rekordy bez
 * typu trafiają do paczki typu pierwszego rekordu, pierwsza paczka (`withExamples`) — przykłady, gdy podane.
 */
export function packetRecords(exercises: readonly unknown[], examples?: readonly unknown[], length = 100): FakePacketStep[] {
  const fallback = exercises.map(typeOf).find((type) => type !== undefined);
  return everyPacket({
    build: (input) => ({
      exercises: exercises.filter((exercise) => input.pool.exerciseTypes.includes(typeOf(exercise) ?? fallback ?? "")),
      ...(input.withExamples && examples !== undefined ? { examples: [...examples] } : {}),
    }),
  }, length);
}

/**
 * Kontrola zamkniętych znająca klucze ręcznych rekordów scenariusza (konwencja fake'a ich nie zna):
 * pozycja ze zdaniem (`stem`) rekordu w widoku dostaje jego odpowiedź, pozostałe — wynik fake'a.
 */
export class KeyedChecker extends FakeExerciseChecker {
  constructor(private readonly known: readonly unknown[]) {
    super();
  }

  override async checkClosed(input: ClosedCheckInput, cost: RunCostSink, signal: AbortSignal): Promise<{ results: unknown[] }> {
    const checked = await super.checkClosed(input, cost, signal);
    const records = this.known.filter((exercise): exercise is { stem: string; answer: string } => typeof (exercise as { stem?: unknown } | null)?.stem === "string");
    return {
      results: input.items.map((item, index) => {
        const lines = item.view.split("\n");
        const record = records.find((exercise) => lines.includes(exercise.stem));
        return record === undefined ? checked.results[index] : { answers: [record.answer] };
      }),
    };
  }
}

export interface Gate {
  readonly step: FakePacketStep;
  readonly reached: Promise<void>;
  open(): void;
}

/** Wywołanie „w locie”: `reached` po dojściu fake'a do kroku, `open()` kończy krok (przerwanie sygnału też). */
export function gate(): Gate {
  let open!: () => void;
  let reach!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  return { step: { gate: opened, onReached: reach }, reached, open };
}

/** Znacznik "obcego" właściciela lease symulowany w testach awarii workera. */
export function staleLeaseToken(): string {
  return randomUUID();
}
