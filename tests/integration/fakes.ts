import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalMediaStore,
  type GenerationDeps,
  type LlmGeneratedItem,
  type LlmGenerateDeckInput,
  type LlmProvider,
  type ImageProvider,
  type MediaSettings,
  type MediaStore,
  type TtsProvider,
  type TtsSynthesizeInput,
} from "@learning/server";

/** Deterministyczne bajty: ten sam seed → te same bajty (content-addressed store je deduplikuje). */
export function deterministicBytes(seed: string): Uint8Array {
  const digest = createHash("sha256").update(seed).digest();
  return Uint8Array.from(Buffer.concat([digest, digest]));
}

export type LlmBehavior =
  | { items: Array<Record<string, unknown>> }
  | { error: string; retryable: boolean };

export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake-llm";
  readonly model = "fake-llm-1";
  readonly requests: LlmGenerateDeckInput[] = [];
  #behaviors: LlmBehavior[] = [];

  /** Zastępuje plan zachowań: kolejne wywołania zjadają elementy z kolejki, ostatni się powtarza. */
  queue(...behaviors: LlmBehavior[]): void {
    this.#behaviors = behaviors;
  }

  async generateDeck(input: LlmGenerateDeckInput): Promise<{ items: LlmGeneratedItem[] }> {
    this.requests.push(input);
    const behavior = this.#behaviors.length > 1 ? this.#behaviors.shift()! : this.#behaviors[0]!;
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

  async synthesize(input: TtsSynthesizeInput): Promise<{ bytes: Uint8Array; mimeType: string }> {
    this.requests.push(input);
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
  readonly requests: Array<{ prompt: string; size: string }> = [];

  async generate(input: { prompt: string; size: string }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    this.requests.push(input);
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("image unavailable");
    }
    return {
      bytes: deterministicBytes(`img|${input.prompt}|${input.size}`),
      mimeType: "image/png",
    };
  }
}

export const fakeMediaSettings: MediaSettings = {
  tts: { provider: "fake-tts", model: "fake-tts-1", voice: "fake-voice", format: "mp3" },
  image: { provider: "fake-image", model: "fake-image-1", size: "512x512" },
};

export interface FakeGeneration {
  llm: FakeLlmProvider;
  tts: FakeTtsProvider;
  image: FakeImageProvider;
  store: MediaStore;
  settings: MediaSettings;
  deps: GenerationDeps;
  root: string;
  dispose: () => Promise<void>;
}

export async function fakeGeneration(): Promise<FakeGeneration> {
  const root = await mkdtemp(join(tmpdir(), "knowli-media-"));
  const store = createLocalMediaStore(root);
  const llm = new FakeLlmProvider();
  const tts = new FakeTtsProvider();
  const image = new FakeImageProvider();
  const settings = fakeMediaSettings;
  return {
    llm,
    tts,
    image,
    store,
    settings,
    deps: { llm, tts, image, mediaStore: store },
    root,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

/** Znacznik "obcego" właściciela lease symulowany w testach awarii workera. */
export function staleLeaseToken(): string {
  return randomUUID();
}
