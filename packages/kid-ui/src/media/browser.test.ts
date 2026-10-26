import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAudioPlayer, BrowserRecorder, createBrowserMedia, LEVEL_MONITOR_RESUME_TIMEOUT_MS, MAX_RECORDING_MS, preloadImage, queryMicrophonePermission } from "./browser";
import { LevelMonitorUnavailableError } from "./platform";

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
  it("synchroniczny błąd hooka nie przerywa nagrania i pozwala zwolnić mikrofon", async () => {
    const { stream, stop } = fakeStream();
    const recorder = new BrowserRecorder(deps(stream).deps, {
      onMicrophoneReady: () => { throw new Error("beep failed synchronously"); },
    });
    await expect(recorder.start()).resolves.toBeUndefined();
    expect(recorder.active).toBe(true);
    recorder.cancel();
    expect(stop).toHaveBeenCalledOnce();
  });

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

describe("BrowserRecorder — wymagany monitor poziomów w trybie auto (PR #109, P1 #2)", () => {
  it("brak AudioContext: auto odrzuca start przed bipem i przechwytywaniem, strumień zwolniony", async () => {
    const { stream, stop } = fakeStream();
    const onMicrophoneReady = vi.fn(async () => undefined);
    const recorder = new BrowserRecorder(deps(stream).deps, {
      onLevel: vi.fn(),
      onMicrophoneReady,
      requireLevelMonitor: true,
    });
    await expect(recorder.start()).rejects.toBeInstanceOf(LevelMonitorUnavailableError);
    expect(onMicrophoneReady).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("awaria konstrukcji AudioContext: auto odrzuca start bez bipu i nagrania", async () => {
    const { stream, stop } = fakeStream();
    const broken = class {
      constructor() { throw new Error("audio context broken"); }
    } as unknown as typeof AudioContext;
    const onMicrophoneReady = vi.fn(async () => undefined);
    const recorder = new BrowserRecorder({
      ...deps(stream).deps,
      audioContext: broken,
    }, { onLevel: vi.fn(), onMicrophoneReady, requireLevelMonitor: true });
    await expect(recorder.start()).rejects.toBeInstanceOf(LevelMonitorUnavailableError);
    expect(onMicrophoneReady).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("kontekst suspended po jednej próbie resume: auto odrzuca start, resume wołane raz", async () => {
    const { stream, stop } = fakeStream();
    const resume = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const suspended = class {
      state = "suspended";
      resume = resume;
      close = close;
    } as unknown as typeof AudioContext;
    const onMicrophoneReady = vi.fn(async () => undefined);
    const recorder = new BrowserRecorder({
      ...deps(stream).deps,
      audioContext: suspended,
    }, { onLevel: vi.fn(), onMicrophoneReady, requireLevelMonitor: true });
    await expect(recorder.start()).rejects.toBeInstanceOf(LevelMonitorUnavailableError);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledOnce();
    expect(onMicrophoneReady).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("kontekst suspended z udanym resume: auto-przepływ przebiega normalnie", async () => {
    const { stream } = fakeStream();
    const timer = fakeTimers();
    const disconnect = vi.fn();
    const resumable = class {
      state = "suspended";
      async resume(): Promise<void> { this.state = "running"; }
      createAnalyser() {
        return { fftSize: 4, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.5), disconnect };
      }
      createMediaStreamSource() { return { connect: vi.fn() }; }
      close = vi.fn(async () => undefined);
    } as unknown as typeof AudioContext;
    const onLevel = vi.fn();
    const onMicrophoneReady = vi.fn(async () => undefined);
    const recorder = new BrowserRecorder({
      ...deps(stream, timer).deps,
      audioContext: resumable,
    }, { onLevel, onMicrophoneReady, requireLevelMonitor: true });
    await expect(recorder.start()).resolves.toBeUndefined();
    expect(onMicrophoneReady).toHaveBeenCalledOnce();
    expect(recorder.active).toBe(true);
    timer.fireInterval();
    expect(onLevel).toHaveBeenCalledWith(1);
  });

  it("tryb ręczny bez flagi: niedostępny monitor nie blokuje nagrywania (best-effort)", async () => {
    const { stream } = fakeStream();
    const recorder = new BrowserRecorder(deps(stream).deps, { onLevel: vi.fn() });
    await expect(recorder.start()).resolves.toBeUndefined();
    expect(recorder.active).toBe(true);
  });

  it("runda 2 #1: resume() wiecznie oczekujące — tryb ręczny startuje nagrywanie bez czekania", async () => {
    const { stream } = fakeStream();
    const timer = fakeTimers();
    const hanging = class {
      state = "suspended";
      resume(): Promise<void> { return new Promise<void>(() => undefined); }
      createAnalyser() {
        return { fftSize: 4, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0), disconnect: vi.fn() };
      }
      createMediaStreamSource() { return { connect: vi.fn() }; }
      close = vi.fn(async () => undefined);
    } as unknown as typeof AudioContext;
    const recorder = new BrowserRecorder({
      ...deps(stream, timer).deps,
      audioContext: hanging,
    }, { onLevel: vi.fn() });
    // start rozstrzyga się bez czekania na resume (fire-and-forget, r2 #1)
    await expect(recorder.start()).resolves.toBeUndefined();
    expect(recorder.active).toBe(true);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it("runda 2 #1: resume() wiecznie oczekujące — auto przerywa po limicie na wstrzykniętych timerach", async () => {
    const { stream, stop } = fakeStream();
    const timer = fakeTimers();
    const resume = vi.fn((): Promise<void> => new Promise<void>(() => undefined));
    const close = vi.fn(async () => undefined);
    const hanging = class {
      state = "suspended";
      resume = resume;
      close = close;
    } as unknown as typeof AudioContext;
    const onMicrophoneReady = vi.fn(async () => undefined);
    const recorder = new BrowserRecorder({
      ...deps(stream, timer).deps,
      audioContext: hanging,
    }, { onLevel: vi.fn(), onMicrophoneReady, requireLevelMonitor: true });
    const starting = recorder.start();
    // przepuszczamy mikrozadania getUserMedia — limit resume jest już uzbrojony
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    timer.fire();
    await expect(starting).rejects.toBeInstanceOf(LevelMonitorUnavailableError);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(onMicrophoneReady).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledOnce();
    // limit czasowy resume jest eksportowany i krótki (nie zawiesza ekranu)
    expect(LEVEL_MONITOR_RESUME_TIMEOUT_MS).toBeLessThanOrEqual(1_000);
  });

  it("runda 2 #2: stan „interrupted” — auto odrzuca czysto, ręczny nagrywa z best-effort", async () => {
    const onMicrophoneReady = vi.fn(async () => undefined);
    {
      // auto: interrupted nie dostarcza próbek — tylko "running" jest akceptowane
      const { stream, stop } = fakeStream();
      const close = vi.fn(async () => undefined);
      const interrupted = class {
        state = "interrupted";
        resume = vi.fn(async () => undefined);
        close = close;
      } as unknown as typeof AudioContext;
      const recorder = new BrowserRecorder({
        ...deps(stream).deps,
        audioContext: interrupted,
      }, { onLevel: vi.fn(), onMicrophoneReady, requireLevelMonitor: true });
      await expect(recorder.start()).rejects.toBeInstanceOf(LevelMonitorUnavailableError);
      expect(onMicrophoneReady).not.toHaveBeenCalled();
      expect(FakeMediaRecorder.instances).toHaveLength(0);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledOnce();
    }
    {
      // ręczny: monitor best-effort, nagrywanie niezależne od stanu kontekstu
      const { stream } = fakeStream();
      const interrupted = class {
        state = "interrupted";
        createAnalyser() {
          return { fftSize: 4, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0), disconnect: vi.fn() };
        }
        createMediaStreamSource() { return { connect: vi.fn() }; }
        close = vi.fn(async () => undefined);
      } as unknown as typeof AudioContext;
      const recorder = new BrowserRecorder({
        ...deps(stream).deps,
        audioContext: interrupted,
      }, { onLevel: vi.fn() });
      await expect(recorder.start()).resolves.toBeUndefined();
      expect(recorder.active).toBe(true);
      expect(FakeMediaRecorder.instances).toHaveLength(1);
    }
  });

  it("runda 2 #3: awaria createAnalyser — kontekst zamknięty dokładnie raz, strumień zwolniony", async () => {
    const { stream, stop } = fakeStream();
    const close = vi.fn(async () => undefined);
    const broken = class {
      state = "running";
      createAnalyser(): AnalyserNode { throw new Error("analyser broken"); }
      close = close;
    } as unknown as typeof AudioContext;
    const onMicrophoneReady = vi.fn(async () => undefined);
    const recorder = new BrowserRecorder({
      ...deps(stream).deps,
      audioContext: broken,
    }, { onLevel: vi.fn(), onMicrophoneReady, requireLevelMonitor: true });
    await expect(recorder.start()).rejects.toBeInstanceOf(LevelMonitorUnavailableError);
    // bez zbiegania kontekstów audio: close dokładnie raz na próbę (r2 #3)
    expect(close).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onMicrophoneReady).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("runda 2 #3: awaria createMediaStreamSource(…).connect — kontekst zamknięty dokładnie raz", async () => {
    const { stream, stop } = fakeStream();
    const close = vi.fn(async () => undefined);
    const broken = class {
      state = "running";
      createAnalyser() {
        return { fftSize: 4, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0), disconnect: vi.fn() };
      }
      createMediaStreamSource() { return { connect(): void { throw new Error("connect broken"); } }; }
      close = close;
    } as unknown as typeof AudioContext;
    const recorder = new BrowserRecorder({
      ...deps(stream).deps,
      audioContext: broken,
    }, { onLevel: vi.fn(), requireLevelMonitor: true });
    await expect(recorder.start()).rejects.toBeInstanceOf(LevelMonitorUnavailableError);
    expect(close).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("createBrowserMedia — bip WebAudio (sygnały: teraz mów / koniec)", () => {
  it("anulowanie podczas resume nie pozwala zagrać spóźnionemu bipowi", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const oscillator = vi.fn();
    const close = vi.fn(async () => undefined);
    class Context {
      state = "suspended";
      async resume() { await gate; this.state = "running"; }
      createOscillator = oscillator;
      close = close;
    }
    const media = createBrowserMedia({ audioContext: Context as unknown as typeof AudioContext });
    const cancellation = new AbortController();
    const beep = media.playBeep("start", cancellation.signal);
    cancellation.abort();
    release();
    await beep;
    expect(oscillator).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  function fakeBeepContext(state: AudioContextState = "running", resumeState: AudioContextState | "pending" = state) {
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
      resume = vi.fn(async () => {
        events.push("context:resume");
        if (resumeState === "pending") await new Promise<void>(() => undefined);
        else this.state = resumeState;
      });
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
    // obwiednia (PR #109 runda 3): atak ~10 ms do szczytu 0.3, plate do
    // 130−50 ms, decay ~50 ms dopiero na KOŃCU — bip słyszalny niemal 130 ms
    // (currentTime fake'a = 0)
    expect(start.gain.gain.setValueAtTime).toHaveBeenNthCalledWith(1, 0.0001, 0);
    expect(start.gain.gain.exponentialRampToValueAtTime).toHaveBeenNthCalledWith(1, 0.3, 0.01);
    expect(start.gain.gain.setValueAtTime).toHaveBeenNthCalledWith(2, 0.3, 0.13 - 0.05);
    expect(start.gain.gain.exponentialRampToValueAtTime).toHaveBeenNthCalledWith(2, 0.0001, 0.13);
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

  it("getMicrophonePermission mapuje stan Permissions API, a awaria daje unknown (WR-02)", async () => {
    const permissionsOf = (state: string): Permissions =>
      ({ query: async () => ({ state }) } as unknown as Permissions);
    // wyłącznie zapytanie o stan — bez getUserMedia i bez efektów ubocznych
    await expect(queryMicrophonePermission(permissionsOf("granted"))).resolves.toBe("granted");
    await expect(queryMicrophonePermission(permissionsOf("prompt"))).resolves.toBe("prompt");
    await expect(queryMicrophonePermission(permissionsOf("denied"))).resolves.toBe("denied");
    await expect(queryMicrophonePermission(permissionsOf("coś-innego"))).resolves.toBe("unknown");
    // niewspierana nazwa / awaria API (np. Firefox) — bezpieczne "unknown"
    const throwing: Permissions = {
      query: async () => { throw new TypeError("unsupported permission"); },
    } as unknown as Permissions;
    await expect(queryMicrophonePermission(throwing)).resolves.toBe("unknown");
    await expect(queryMicrophonePermission(undefined)).resolves.toBe("unknown");
    // deps przez createBrowserMedia także działa i nie dotyka getUserMedia
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
    const media = createBrowserMedia({ getUserMedia, permissions: permissionsOf("granted") });
    await expect(media.getMicrophonePermission()).resolves.toBe("granted");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("kontekst pozostaje suspended po resume — bez grania, z zamknięciem kontekstu", async () => {
    const fake = fakeBeepContext("suspended");
    await expect(fake.media.playBeep("end")).resolves.toBeUndefined();
    expect(fake.oscillator.start).not.toHaveBeenCalled();
    expect(fake.events).toContain("context:close");
  });

  it("wznawia nowy zawieszony kontekst przed zagraniem bipa", async () => {
    const fake = fakeBeepContext("suspended", "running");
    await fake.media.playBeep("start");
    expect(fake.events.indexOf("context:resume")).toBeLessThan(fake.events.indexOf("createOscillator"));
    expect(fake.oscillator.start).toHaveBeenCalledOnce();
    expect(fake.events.filter((event) => event === "context:close")).toHaveLength(1);
  });

  it("wiszące resume bipa kończy się po limicie i zamyka kontekst", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeBeepContext("suspended", "pending");
      const beep = fake.media.playBeep("start");
      await vi.advanceTimersByTimeAsync(LEVEL_MONITOR_RESUME_TIMEOUT_MS - 1);
      expect(fake.events).toContain("context:resume");
      expect(fake.events).not.toContain("context:close");
      await vi.advanceTimersByTimeAsync(1);
      await beep;
      expect(fake.oscillator.start).not.toHaveBeenCalled();
      expect(fake.events).toContain("context:close");
    } finally {
      vi.useRealTimers();
    }
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

describe("preloadImage — ogrzanie cache obrazu następnego zadania", () => {
  it("ustawia src i rozstrzyga się przy błędzie pobrania bez odrzucenia", async () => {
    let image!: { onload: (() => void) | null; onerror: (() => void) | null; src: string; decode?: () => Promise<void> };
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      constructor() { image = this; }
    }
    vi.stubGlobal("Image", FakeImage);
    const pending = preloadImage("https://media.test/asset-1");
    expect(image.src).toBe("https://media.test/asset-1");
    image.onerror?.();
    await expect(pending).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("rozstrzyga się od razu bez konstruktora Image", async () => {
    vi.stubGlobal("Image", undefined);
    await expect(preloadImage("https://media.test/asset-2")).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
