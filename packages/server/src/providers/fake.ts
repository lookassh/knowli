import { createHash } from "node:crypto";
import type { GenerationDeps } from "../config";
import type {
  ImageProvider,
  LlmGeneratedItem,
  LlmGenerateDeckInput,
  LlmProvider,
  TtsProvider,
  TtsSynthesizeInput,
} from "../ports/ai";
import type { MediaStore } from "../ports/media";

/**
 * Deterministyczni providerzy bez sieci: te same dane wejściowe dają te same
 * bajty, więc content-addressed store naturalnie deduplikuje wyniki. Służą
 * testom integracyjnym/E2E i trybowi UMIEM_FAKE_PROVIDERS=1 (środowisko bez
 * kluczy API); nie są adapterem żadnego serwisu produkcyjnego.
 */

/** Deterministyczne bajty: ten sam seed → te same bajty. */
export function deterministicBytes(seed: string): Uint8Array {
  const digest = createHash("sha256").update(seed).digest();
  return Uint8Array.from(Buffer.concat([digest, digest]));
}

/**
 * Domyślny zestaw fake LLM: siedem dni tygodnia pl→en z celową literówką
 * „thirsday" do poprawienia przez rodzica oraz wariantami odpowiedzi.
 */
export const DEFAULT_FAKE_DECK_ITEMS: Array<Record<string, unknown>> = [
  {
    source: "poniedziałek",
    target: "monday",
    acceptedAnswers: ["Monday"],
    example: "I go to school on monday.",
    visualType: "image",
  },
  { source: "wtorek", target: "tuesday", acceptedAnswers: [], visualType: "image" },
  { source: "środa", target: "wednesday", acceptedAnswers: [], visualType: "image" },
  { source: "czwartek", target: "thirsday", acceptedAnswers: [], visualType: "image" },
  {
    source: "piątek",
    target: "friday",
    acceptedAnswers: ["Friday", "Fri."],
    example: "Friday is my favourite day.",
    visualType: "image",
  },
  { source: "sobota", target: "saturday", acceptedAnswers: [], visualType: "none" },
  { source: "niedziela", target: "sunday", acceptedAnswers: ["Sunday"], visualType: "none" },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type LlmBehavior =
  | { items: Array<Record<string, unknown>> }
  | { error: string; retryable: boolean };

export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake-llm";
  readonly model = "fake-llm-1";
  readonly requests: LlmGenerateDeckInput[] = [];
  #behaviors: LlmBehavior[] = [];
  readonly #delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.#delayMs = options.delayMs ?? 0;
  }

  /** Zastępuje plan zachowań: kolejne wywołania zjadają elementy z kolejki, ostatni się powtarza. */
  queue(...behaviors: LlmBehavior[]): void {
    this.#behaviors = behaviors;
  }

  async generateDeck(input: LlmGenerateDeckInput): Promise<{ items: LlmGeneratedItem[] }> {
    this.requests.push(input);
    if (this.#delayMs > 0) {
      await sleep(this.#delayMs);
    }
    const behavior =
      this.#behaviors.length > 1 ? this.#behaviors.shift()! : this.#behaviors[0] ?? null;
    if (!behavior) {
      return { items: DEFAULT_FAKE_DECK_ITEMS as unknown as LlmGeneratedItem[] };
    }
    if ("error" in behavior) {
      const error = new Error(behavior.error) as Error & { retryable?: boolean };
      error.retryable = behavior.retryable;
      throw error;
    }
    return { items: behavior.items as unknown as LlmGeneratedItem[] };
  }
}

export class FakeTtsProvider implements TtsProvider {
  readonly name = "fake-tts";
  readonly model = "fake-tts-1";
  readonly voice = "fake-voice";
  readonly requests: TtsSynthesizeInput[] = [];
  failuresLeft = 0;
  readonly #delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.#delayMs = options.delayMs ?? 0;
  }

  async synthesize(input: TtsSynthesizeInput): Promise<{ bytes: Uint8Array; mimeType: string }> {
    this.requests.push(input);
    if (this.#delayMs > 0) {
      await sleep(this.#delayMs);
    }
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("tts unavailable");
    }
    return {
      bytes: deterministicBytes(`tts|${input.text}|${input.locale}|${input.voice}|${input.format}`),
      mimeType: "audio/mpeg",
    };
  }

  callsFor(text: string): number {
    return this.requests.filter((r) => r.text === text).length;
  }
}

export class FakeImageProvider implements ImageProvider {
  readonly name = "fake-image";
  readonly model = "fake-image-1";
  failuresLeft = 0;
  readonly requests: Array<{
    prompt: string;
    model: string;
    size: string;
    quality: string;
    format: string;
  }> = [];
  readonly #delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.#delayMs = options.delayMs ?? 0;
  }

  async generate(input: {
    prompt: string;
    model: string;
    size: string;
    quality: string;
    format: string;
  }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    this.requests.push(input);
    if (this.#delayMs > 0) {
      await sleep(this.#delayMs);
    }
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("image unavailable");
    }
    const mimeType =
      input.format === "webp" ? "image/webp" : input.format === "jpeg" ? "image/jpeg" : "image/png";
    return {
      bytes: deterministicBytes(`img|${input.prompt}|${input.size}`),
      mimeType,
    };
  }
}

/** Fake'owe ustawienia medialne — muszą zgadzać się z fingerprintami fake'ów. */
export const fakeMediaSettings = {
  tts: { provider: "fake-tts", model: "fake-tts-1", voice: "fake-voice", format: "mp3" },
  image: { provider: "fake-image", model: "fake-image-1", size: "512x512", quality: "low", format: "webp" },
} as const;

/** Komplet zależności generacji na fake'ach dla wskazanego magazynu mediów. */
export function fakeGenerationDeps(
  mediaStore: MediaStore,
  options: { delayMs?: number } = {},
): GenerationDeps {
  return {
    llm: new FakeLlmProvider(options),
    tts: new FakeTtsProvider(options),
    image: new FakeImageProvider(options),
    mediaStore,
  };
}
