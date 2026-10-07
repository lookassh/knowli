import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRecorder, MAX_RECORDING_MS } from "./browser";

/** Fałszywy MediaRecorder — sterowany z testu, bez prawdziwego DOM. */
class FakeMediaRecorder {
  static supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  static instances: FakeMediaRecorder[] = [];
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  state: "inactive" | "recording" = "inactive";
  chunksDelivered = false;

  constructor(
    public stream: { getTracks: () => { stop: () => void }[] },
    public options: MediaRecorderOptions | undefined,
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  static isTypeSupported(mime: string): boolean {
    return FakeMediaRecorder.supported.has(mime);
  }

  start(): void {
    this.state = "recording";
    this.deliverChunks();
  }

  stop(): void {
    this.state = "inactive";
    this.deliverChunks();
    this.onstop?.();
  }

  deliverChunks(): void {
    if (this.chunksDelivered) return;
    this.chunksDelivered = true;
    this.ondataavailable?.({ data: new Blob(["Cze"], { type: "audio/webm" }) });
    this.ondataavailable?.({ data: new Blob(["scik"], { type: "audio/webm" }) });
  }
}

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] }, stop };
}

function fakeTimers() {
  let fired: (() => void) | null = null;
  return {
    timers: {
      set: (fn: () => void) => {
        fired = fn;
        return 1;
      },
      clear: () => {
        fired = null;
      },
    },
    fire: () => fired?.(),
  };
}

function deps(stream: { getTracks: () => { stop: () => void }[] }, timers = fakeTimers()) {
  const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
  return {
    getUserMedia,
    timers,
    deps: {
      getUserMedia,
      mediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
      timers: timers.timers,
    },
  };
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
});

describe("BrowserRecorder — nagrywanie bez pozostawiania strumienia (arch §11)", () => {
  it("zwraca nagrane bajty z typem MIME i zwalnia mikrofon po stop", async () => {
    const { stream, stop } = fakeStream();
    const recorder = new BrowserRecorder(deps(stream).deps);
    await recorder.start();
    expect(recorder.active).toBe(true);
    const audio = await recorder.stop();
    expect(new TextDecoder().decode(audio.bytes)).toBe("Czescik");
    expect(audio.mimeType).toBe("audio/webm;codecs=opus");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(recorder.active).toBe(false);
  });

  it("cancel zatrzymuje strumień, porzuca bufory i odrzuca oczekujący stop", async () => {
    const { stream, stop } = fakeStream();
    const recorder = new BrowserRecorder(deps(stream).deps);
    await recorder.start();
    const pending = recorder.stop();
    recorder.cancel();
    await expect(pending).rejects.toThrowError(/cancel/i);
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(recorder.stop()).rejects.toThrowError(/cancel/i);
  });

  it("odmowa mikrofonu odrzuca start i nie tworzy rejestratora", async () => {
    const getUserMedia = vi.fn(async (): Promise<MediaStream> => {
      throw new Error("NotAllowedError");
    });
    const recorder = new BrowserRecorder({
      getUserMedia,
      mediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
      timers: fakeTimers().timers,
    });
    await expect(recorder.start()).rejects.toThrowError(/microphone|NotAllowed/i);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(recorder.active).toBe(false);
    // po błędzie można spróbować ponownie albo przejść w tryb bez mikrofonu
    recorder.cancel();
  });

  it("limit 15 sekund kończy nagranie automatycznie i zwalnia mikrofon", async () => {
    const { stream, stop } = fakeStream();
    const timers = fakeTimers();
    const recorder = new BrowserRecorder(deps(stream, timers).deps);
    await recorder.start();
    timers.fire();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(recorder.active).toBe(false);
    const audio = await recorder.stop();
    expect(audio.bytes.byteLength).toBeGreaterThan(0);
  });

  it("podwójny start i stop bez nagrywania są błędami", async () => {
    const { stream } = fakeStream();
    const recorder = new BrowserRecorder(deps(stream).deps);
    await recorder.start();
    await expect(recorder.start()).rejects.toThrowError(/recording/i);
    await recorder.stop();
    await expect(recorder.stop()).rejects.toThrowError(/recording/i);
  });

  it("przyjmowany limit nagrywania odpowiada limitowi serwera", () => {
    expect(MAX_RECORDING_MS).toBe(15_000);
  });
});
