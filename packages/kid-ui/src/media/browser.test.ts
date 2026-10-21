import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAudioPlayer, BrowserRecorder, createBrowserMedia, MAX_RECORDING_MS } from "./browser";

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
  const intervals: (() => void)[] = [];
  return {
    timers: {
      set: (fn: () => void) => {
        fired = fn;
        return 1;
      },
      clear: () => {
        fired = null;
      },
      setInterval: (fn: () => void) => { intervals.push(fn); return intervals.length; },
      clearInterval: () => undefined,
    },
    fire: () => fired?.(),
    fireInterval: () => intervals.forEach((fn) => fn()),
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

  it("zwalnia mikrofon i wraca do idle, jeśli MediaRecorder.start rzuci błąd", async () => {
    const { stream, stop } = fakeStream();
    const brokenRecorder = class extends FakeMediaRecorder {
      override start(): void {
        throw new Error("device start failed");
      }
    };
    const recorder = new BrowserRecorder({
      getUserMedia: async () => stream as unknown as MediaStream,
      mediaRecorder: brokenRecorder as unknown as typeof MediaRecorder,
    });

    await expect(recorder.start()).rejects.toThrowError(/start/i);
    expect(stop).toHaveBeenCalledOnce();
    expect(recorder.active).toBe(false);
  });

  it("zwalnia mikrofon i wyłącza stan nagrywania po asynchronicznym błędzie MediaRecorder", async () => {
    const { stream, stop } = fakeStream();
    const recorder = new BrowserRecorder(deps(stream).deps);
    await recorder.start();

    FakeMediaRecorder.instances[0]!.onerror?.();

    expect(stop).toHaveBeenCalledOnce();
    expect(recorder.active).toBe(false);
  });

  it("DOMException z getUserMedia wychodzi nieopakowany, z nienaruszonym name", async () => {
    // controller rozróżnia odmowę uprawnienia (NotAllowedError) od awarii
    // urządzenia po name — opakowanie z policymakerskim tekstem by ją ukryło
    const getUserMedia = vi.fn(async (): Promise<MediaStream> => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });
    const recorder = new BrowserRecorder({
      getUserMedia,
      mediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
      timers: fakeTimers().timers,
    });
    const failure = recorder.start();
    await expect(failure).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(FakeMediaRecorder.instances).toHaveLength(0);
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

  it("zamyka spóźniony strumień, jeśli recorder anulowano podczas getUserMedia", async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { resolveStream = resolve; }));
    const recorder = new BrowserRecorder({ getUserMedia, mediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder });
    const starting = recorder.start();
    recorder.cancel();
    const { stream, stop } = fakeStream();
    resolveStream(stream as unknown as MediaStream);
    await expect(starting).rejects.toThrowError(/cancel/i);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("prepareMicrophone prosi o zgodę i od razu zwalnia próbny strumień", async () => {
    const { stream, stop } = fakeStream();
    const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
    const media = createBrowserMedia({ getUserMedia });
    await media.prepareMicrophone();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("publikuje wyłącznie skończony poziom 0–1 najwyżej raz na 100 ms i zamyka analizator", async () => {
    const { stream } = fakeStream();
    const timer = fakeTimers();
    let now = 0;
    const close = vi.fn(async () => undefined);
    const disconnect = vi.fn();
    const audioContext = class {
      createAnalyser() {
        return { fftSize: 4, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.5), disconnect };
      }
      createMediaStreamSource() { return { connect: vi.fn() }; }
      close = close;
    } as unknown as typeof AudioContext;
    const onLevel = vi.fn();
    const recorder = new BrowserRecorder({
      ...deps(stream, timer).deps,
      audioContext,
      now: () => now,
    }, { onLevel });
    await recorder.start();
    timer.fireInterval();
    timer.fireInterval();
    expect(onLevel).toHaveBeenCalledWith(1);
    expect(onLevel).toHaveBeenCalledOnce();
    now = 100;
    timer.fireInterval();
    expect(onLevel).toHaveBeenCalledTimes(2);
    expect(onLevel.mock.calls.every(([level]) => Number.isFinite(level) && level >= 0 && level <= 1)).toBe(true);
    await recorder.stop();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("limit wywołuje callback raz i pozwala pobrać już zamknięte nagranie", async () => {
    const { stream } = fakeStream();
    const timer = fakeTimers();
    const onLimitReached = vi.fn();
    const recorder = new BrowserRecorder(deps(stream, timer).deps, { onLimitReached });
    await recorder.start();
    timer.fire();
    expect(onLimitReached).toHaveBeenCalledOnce();
    await expect(recorder.stop()).resolves.toMatchObject({ mimeType: "audio/webm;codecs=opus" });
    expect(onLimitReached).toHaveBeenCalledOnce();
  });
});

describe("BrowserRecorder — hook onMicrophoneReady (sygnał: teraz mów)", () => {
  it("woła hook PO udanym getUserMedia i PRZED konstrukcją MediaRecorder oraz startem przechwytywania", async () => {
    const { stream } = fakeStream();
    const log: string[] = [];
    const getUserMedia = vi.fn(async () => {
      await Promise.resolve();
      log.push("getUserMedia");
      return stream as unknown as MediaStream;
    });
    const hooked = class extends FakeMediaRecorder {
      override start(): void {
        log.push("recorder.start");
        super.start();
      }
    };
    const onMicrophoneReady = vi.fn(async () => {
      log.push("hook");
    });
    const recorder = new BrowserRecorder({
      getUserMedia,
      mediaRecorder: hooked as unknown as typeof MediaRecorder,
      timers: fakeTimers().timers,
    }, { onMicrophoneReady });
    await recorder.start();
    expect(log).toEqual(["getUserMedia", "hook", "recorder.start"]);
    expect(onMicrophoneReady).toHaveBeenCalledOnce();
  });

  it("odrzucenie hooka jest połykane — start nagrywania mimo to kończy się sukcesem", async () => {
    const { stream } = fakeStream();
    const onMicrophoneReady = vi.fn(async () => {
      throw new Error("beep failed");
    });
    const recorder = new BrowserRecorder(deps(stream).deps, { onMicrophoneReady });
    await expect(recorder.start()).resolves.toBeUndefined();
    expect(recorder.active).toBe(true);
    expect(onMicrophoneReady).toHaveBeenCalledOnce();
  });

  it("brak opcji — hook nie jest wołany i start przebiega jak dotychczas", async () => {
    const { stream } = fakeStream();
    const recorder = new BrowserRecorder(deps(stream).deps);
    await recorder.start();
    expect(recorder.active).toBe(true);
  });
});

describe("createBrowserMedia — bip WebAudio (sygnały: teraz mów / koniec)", () => {
  function fakeBeepContext(state: AudioContextState = "running") {
    const events: string[] = [];
    let onended: (() => void) | null = null;
    const oscillator = {
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(() => events.push("oscillator:start")),
      stop: vi.fn(() => {
        events.push("oscillator:stop");
        onended?.();
      }),
      set onended(handler: (() => void) | null) { onended = handler; },
    };
    const gain = {
      gain: {
        setValueAtTime: vi.fn(() => events.push("gain:setValueAtTime")),
        exponentialRampToValueAtTime: vi.fn(() => events.push("gain:ramp")),
      },
      connect: vi.fn(),
    };
    const Ctor = class {
      state = state;
      currentTime = 0;
      destination = {};
      createOscillator() { events.push("createOscillator"); return oscillator; }
      createGain() { events.push("createGain"); return gain; }
      close = vi.fn(async () => { events.push("context:close"); });
    };
    const stream = fakeStream();
    const getUserMedia = vi.fn(async () => stream.stream as unknown as MediaStream);
    const media = createBrowserMedia({ getUserMedia, audioContext: Ctor as unknown as typeof AudioContext });
    return { events, oscillator, gain, media, Ctor, stream };
  }

  it("playBeep start i end grają oscylator przez GainNode z obwiednią i zamykają kontekst", async () => {
    const start = fakeBeepContext();
    await start.media.playBeep("start");
    // oscylator podłączony do gain, gain do destination, obwiednia przeciw klikowi
    expect(start.oscillator.connect).toHaveBeenCalledWith(start.gain);
    expect(start.gain.connect).toHaveBeenCalled();
    expect(start.gain.gain.setValueAtTime).toHaveBeenCalled();
    expect(start.gain.gain.exponentialRampToValueAtTime).toHaveBeenCalled();
    expect(start.oscillator.start).toHaveBeenCalled();
    expect(start.oscillator.stop).toHaveBeenCalled();
    // krótkotrwały kontekst zamykany po zagraniu (limit równoczesnych kontekstów)
    expect(start.events.filter((event) => event === "context:close")).toHaveLength(1);

    const end = fakeBeepContext();
    await end.media.playBeep("end");
    expect(end.oscillator.start).toHaveBeenCalled();
    expect(end.events.filter((event) => event === "context:close")).toHaveLength(1);
    // bip startu wyższy niż bip końca — rozróżnialne sygnały dla dziecka
    expect(start.oscillator.frequency.value).toBeGreaterThan(end.oscillator.frequency.value);
    expect(start.oscillator.frequency.value).toBeGreaterThan(0);
  });

  it("brak AudioContext w otoczeniu — obietnica rozstrzyga się natychmiast, bez rzucania", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
    const media = createBrowserMedia({ getUserMedia });
    await expect(media.playBeep("start")).resolves.toBeUndefined();
  });

  it("kontekst suspended (polityka autoplay) — bez grania, bez czekania na resume", async () => {
    const fake = fakeBeepContext("suspended");
    await expect(fake.media.playBeep("end")).resolves.toBeUndefined();
    expect(fake.oscillator.start).not.toHaveBeenCalled();
    expect(fake.events).toContain("context:close");
  });

  it("awaria Web Audio w trakcie — bip degraduje się po cichu (nagrywanie obowiązkowe)", async () => {
    const broken = class {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator(): OscillatorNode { throw new Error("web audio broken"); }
      close = vi.fn(async () => undefined);
    };
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
    const media = createBrowserMedia({ getUserMedia, audioContext: broken as unknown as typeof AudioContext });
    await expect(media.playBeep("start")).resolves.toBeUndefined();
  });
});

describe("BrowserAudioPlayer — anulowanie także oczekującego pobrania", () => {
  it("przekazuje rzeczywistą długość dopiero po rozpoczęciu odtwarzania", async () => {
    let audio!: { onplaying: (() => void) | null; onended: (() => void) | null; onerror: (() => void) | null; duration: number };
    class FakeAudio {
      onplaying: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      duration = 2;
      constructor(_url: string) { audio = this; }
      async play() { audio.onplaying?.(); audio.onended?.(); }
      pause() {}
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["audio"]) })));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:duration");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const started = vi.fn();
    await new BrowserAudioPlayer().play("/media", started);
    expect(started).toHaveBeenCalledWith(2_000);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["fetch", "blob"] as const)("stop przed zakończeniem %s nie uruchamia audio.play", async (stage) => {
    let resolveFetch!: (response: Response) => void;
    let resolveBlob!: (blob: Blob) => void;
    const blobGate = new Promise<Blob>((resolve) => { resolveBlob = resolve; });
    const fetchGate = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetchMock = vi.fn(async () => fetchGate);
    vi.stubGlobal("fetch", fetchMock);
    const play = vi.fn(async () => undefined);
    class FakeAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {}
      play = play;
      pause() {}
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const player = new BrowserAudioPlayer();
    const pending = player.play("/media");
    if (stage === "fetch") {
      player.stop();
      resolveFetch({ ok: true, blob: () => blobGate } as unknown as Response);
    } else {
      resolveFetch({ ok: true, blob: () => blobGate } as unknown as Response);
      await Promise.resolve();
      player.stop();
      resolveBlob(new Blob(["audio"]));
    }
    await pending;
    expect(play).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stop kończy neutralnie Promise rozpoczętego odtwarzania i zwalnia URL", async () => {
    let finishPlay!: () => void;
    const play = vi.fn(() => new Promise<void>((resolve) => { finishPlay = resolve; }));
    class FakeAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {}
      play = play;
      pause() {}
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["audio"]) })));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:playing");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const player = new BrowserAudioPlayer();
    const pending = player.play("/media");
    await Promise.resolve();
    await Promise.resolve();
    player.stop();
    await expect(pending).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledWith("blob:playing");
    finishPlay();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
