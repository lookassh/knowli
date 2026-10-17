import type { AudioPlayer, PlatformMedia, RecordedAudio, RecorderOptions, SpeechRecorder } from "./platform";

/** Limit nagrania po stronie klienta — odpowiada limitowi serwera (arch §11). */
export const MAX_RECORDING_MS = 15_000;

/** Preferowane kodeki w kolejności; pierwszy wspierany wygrywa. */
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm"] as const;

export interface BrowserRecorderDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  mediaRecorder?: typeof MediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
  timers?: {
    set: (handler: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
    setInterval?: (handler: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
  };
  audioContext?: typeof AudioContext;
  now?: () => number;
}

const defaultTimers = {
  set: (handler: () => void, ms: number) => setTimeout(handler, ms),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Azure speech endpoints accept PCM WAV reliably; MediaRecorder WebM blobs do
 * not carry a Duration element, which the server needs for its duration cap.
 * Decode and resample in memory, then send mono 16 kHz PCM WAV.
 */
async function convertToWav(bytes: Uint8Array, mimeType: string): Promise<RecordedAudio> {
  const AudioContextCtor = globalThis.AudioContext;
  const OfflineAudioContextCtor = globalThis.OfflineAudioContext;
  // Non-browser unit harnesses may not provide Web Audio APIs. Real browsers
  // that support MediaRecorder also provide these constructors.
  if (!AudioContextCtor || !OfflineAudioContextCtor) return { bytes, mimeType };

  const decoder = new AudioContextCtor();
  try {
    const decoded = await decoder.decodeAudioData(bytes.slice().buffer);
    if (decoded.duration <= 0 || decoded.duration > MAX_RECORDING_MS / 1000 + 0.5) {
      throw new Error("recording duration is outside the supported limit");
    }
    const sampleRate = 16_000;
    const frameCount = Math.ceil(decoded.duration * sampleRate);
    const offline = new OfflineAudioContextCtor(1, frameCount, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const dataBytes = samples.length * 2;
    const wav = new Uint8Array(44 + dataBytes);
    const view = new DataView(wav.buffer);
    const writeAscii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true);
    writeAscii(36, "data");
    view.setUint32(40, dataBytes, true);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]!));
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return { bytes: wav, mimeType: "audio/wav" };
  } finally {
    await decoder.close().catch(() => undefined);
  }
}

/**
 * Rejestrator mowy na MediaRecorder (plan zadania 8). Jednorazowy: start →
 * stop (bajty) albo cancel (porzucenie). Mikrofon i bufory zwalniane są na
 * KAŻDEJ ścieżce wyjścia — końcu, błędzie i anulowaniu — także po automatycznym
 * domknięciu limitem 15 sekund.
 */
export class BrowserRecorder implements SpeechRecorder {
  readonly #getUserMedia: NonNullable<BrowserRecorderDeps["getUserMedia"]>;
  readonly #MediaRecorder: NonNullable<BrowserRecorderDeps["mediaRecorder"]>;
  readonly #isTypeSupported: NonNullable<BrowserRecorderDeps["isTypeSupported"]>;
  readonly #timers: NonNullable<BrowserRecorderDeps["timers"]>;
  readonly #options: RecorderOptions;
  readonly #AudioContext: typeof AudioContext | undefined;
  readonly #now: () => number;

  #stream: MediaStream | null = null;
  #recorder: MediaRecorder | null = null;
  #chunks: Blob[] = [];
  #timeoutHandle: unknown = null;
  #mimeType = "";
  #state: "idle" | "recording" | "finalizing" | "captured" = "idle";
  #pendingStop: ((audio: RecordedAudio) => void) | null = null;
  #pendingReject: ((error: Error) => void) | null = null;
  #captured: RecordedAudio | null = null;
  #cancelled = false;
  #generation = 0;
  #lastLevelAt = Number.NEGATIVE_INFINITY;
  #levelHandle: unknown = null;
  #levelContext: AudioContext | null = null;
  #analyser: AnalyserNode | null = null;
  #samples: Float32Array<ArrayBuffer> | null = null;

  constructor(deps: BrowserRecorderDeps = {}, options: RecorderOptions = {}) {
    // globalne API czytamy przez globalThis — konstruktor działa też poza przeglądarką
    const globalRecorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    this.#getUserMedia =
      deps.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    this.#MediaRecorder = deps.mediaRecorder ?? globalRecorder!;
    this.#isTypeSupported = deps.isTypeSupported ?? ((mime) => this.#MediaRecorder.isTypeSupported(mime));
    this.#timers = deps.timers ?? defaultTimers;
    this.#options = options;
    this.#AudioContext = deps.audioContext ?? globalThis.AudioContext;
    this.#now = deps.now ?? (() => performance.now());
  }

  get active(): boolean {
    return this.#state === "recording";
  }

  async start(): Promise<void> {
    if (this.#cancelled) {
      throw new Error("recorder was already used");
    }
    if (this.#state !== "idle") {
      throw new Error("recording already started");
    }
    const mimeType = PREFERRED_MIME_TYPES.find((candidate) => this.#isTypeSupported(candidate));
    if (!mimeType) {
      throw new Error("audio recording is not supported in this browser");
    }
    const generation = ++this.#generation;
    let stream: MediaStream;
    try {
      stream = await this.#getUserMedia({ audio: true });
    } catch (error) {
      // DOMException przechodzi nieopakowana — controller rozpoznaje po name
      // świadomą odmowę uprawnienia (NotAllowedError) i tylko ją zapamiętuje
      if (error instanceof DOMException) {
        throw error;
      }
      throw new Error("microphone permission denied", { cause: error });
    }
    if (this.#cancelled || generation !== this.#generation) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("recording cancelled");
    }
    this.#stream = stream;
    let recorder: MediaRecorder;
    try {
      recorder = new this.#MediaRecorder(stream, { mimeType });
    } catch (error) {
      this.#releaseStream();
      throw new Error("failed to start recording", { cause: error });
    }
    this.#recorder = recorder;
    this.#mimeType = mimeType;
    this.#chunks = [];
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    };
    recorder.onerror = () => {
      const reject = this.#pendingReject;
      this.#pendingStop = null;
      this.#pendingReject = null;
      // Błąd urządzenia może przyjść przed stop(); pomijamy onstop/data z
      // uszkodzonej sesji, ale zawsze zamykamy rejestrator i strumień.
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      this.#teardown();
      this.#state = "idle";
      this.#options.onError?.();
      reject?.(new Error("recording failed"));
    };
    recorder.onstop = () => {
      void this.#assemble();
    };
    this.#state = "recording";
    try {
      recorder.start(250);
    } catch (error) {
      // start może rzucić już po uzyskaniu MediaStream; nie zostawiamy wtedy
      // aktywnego tracka ani callbacku, który mógłby złożyć porzucone audio.
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      this.#teardown();
      this.#state = "idle";
      throw new Error("failed to start recording", { cause: error });
    }
    this.#startLevelMonitor(stream);
    this.#timeoutHandle = this.#timers.set(() => {
      if (this.#state === "recording") {
        this.#state = "finalizing";
        this.#stopLevelMonitor();
        this.#recorder?.stop();
        this.#options.onLimitReached?.();
      }
    }, MAX_RECORDING_MS);
  }

  async stop(): Promise<RecordedAudio> {
    if (this.#state === "captured" && this.#captured) {
      const captured = this.#captured;
      this.#captured = null;
      this.#state = "idle";
      return captured;
    }
    if (this.#cancelled) {
      throw new Error("recording was cancelled");
    }
    if (this.#state === "finalizing") {
      return this.#waitForCapture();
    }
    if (this.#state !== "recording") {
      throw new Error("recording is not active");
    }
    this.#state = "finalizing";
    this.#clearTimeout();
    this.#stopLevelMonitor();
    this.#recorder!.stop();
    return this.#waitForCapture();
  }

  cancel(): void {
    const pending = this.#pendingReject;
    this.#teardown();
    this.#pendingStop = null;
    this.#pendingReject = null;
    this.#state = "idle";
    this.#generation += 1;
    this.#cancelled = true;
    this.#captured = null;
    // odrzucenie po teardown, żeby bufory były już porzucone
    pending?.(new Error("recording cancelled"));
  }

  #waitForCapture(): Promise<RecordedAudio> {
    return new Promise<RecordedAudio>((resolve, reject) => {
      this.#pendingStop = resolve;
      this.#pendingReject = reject;
    });
  }

  async #assemble(): Promise<void> {
    this.#clearTimeout();
    const chunks = this.#chunks;
    this.#chunks = [];
    this.#releaseStream();
    try {
      const blob = new Blob(chunks, { type: this.#mimeType });
      const webmBytes = new Uint8Array(await blob.arrayBuffer());
      let audio: RecordedAudio;
      try {
        audio = await convertToWav(webmBytes, this.#mimeType);
      } catch (error) {
        webmBytes.fill(0);
        throw error;
      }
      if (audio.bytes !== webmBytes) webmBytes.fill(0);
      if (this.#cancelled) {
        // nagranie anulowane w trakcie składania — bufor zostaje porzucony
        audio.bytes.fill(0);
        this.#state = "idle";
        this.#captured = null;
        return;
      }
      const resolve = this.#pendingStop;
      this.#pendingStop = null;
      this.#pendingReject = null;
      if (resolve) {
        this.#state = "idle";
        resolve(audio);
        return;
      }
      // automatyczne domknięcie limitem — nagranie czeka na stop() klienta
      this.#state = "captured";
      this.#captured = audio;
    } catch (error) {
      const reject = this.#pendingReject;
      this.#pendingStop = null;
      this.#pendingReject = null;
      this.#state = "idle";
      reject?.(new Error("failed to read recording", { cause: error }));
    }
  }

  #releaseStream(): void {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
  }

  #clearTimeout(): void {
    if (this.#timeoutHandle !== null) {
      this.#timers.clear(this.#timeoutHandle);
      this.#timeoutHandle = null;
    }
  }

  #teardown(): void {
    this.#clearTimeout();
    this.#stopLevelMonitor();
    if (this.#recorder && this.#recorder.state !== "inactive") {
      this.#recorder.stop();
    }
    this.#recorder = null;
    this.#releaseStream();
    this.#chunks = [];
  }

  #startLevelMonitor(stream: MediaStream): void {
    if (!this.#AudioContext || !this.#options.onLevel) return;
    try {
      const context = new this.#AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      this.#levelContext = context;
      this.#analyser = analyser;
      this.#samples = new Float32Array(analyser.fftSize);
      const setInterval = this.#timers.setInterval ?? ((handler: () => void, ms: number) => globalThis.setInterval(handler, ms));
      this.#levelHandle = setInterval(() => {
        if (!this.#analyser || !this.#samples) return;
        const now = this.#now();
        if (now - this.#lastLevelAt < 100) return;
        this.#lastLevelAt = now;
        this.#analyser.getFloatTimeDomainData(this.#samples);
        let sum = 0;
        for (const sample of this.#samples) sum += sample * sample;
        const rms = Math.sqrt(sum / this.#samples.length);
        const level = Math.max(0, Math.min(1, rms * 4));
        if (Number.isFinite(level) && this.#state === "recording") this.#options.onLevel?.(level);
      }, 100);
    } catch {
      void this.#levelContext?.close().catch(() => undefined);
      this.#levelContext = null;
      this.#analyser = null;
      this.#samples = null;
      this.#levelHandle = null;
    }
  }

  #stopLevelMonitor(): void {
    if (this.#levelHandle !== null) {
      const clearInterval = this.#timers.clearInterval ?? ((handle: unknown) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
      clearInterval(this.#levelHandle);
      this.#levelHandle = null;
    }
    this.#analyser?.disconnect();
    this.#analyser = null;
    this.#samples = null;
    const context = this.#levelContext;
    this.#levelContext = null;
    void context?.close().catch(() => undefined);
  }
}

/**
 * Odtwarzacz na elemencie Audio: plik wzorca pobierany fetchem sięga w
 * immutable cache media, więc ponowny odsłuch nie wywołuje TTS (SPEC A19).
 * Awaria sieci jest zwykłym TypeError; błąd dekodowania lub zablokowany
 * autoplay odrzucamy jako zwykły Error — to nie jest utrata połączenia
 * i nie zamyka sesji ekranem offline.
 */
export class BrowserAudioPlayer implements AudioPlayer {
  #audio: { element: HTMLAudioElement; objectUrl: string } | null = null;
  #generation = 0;
  #abort: AbortController | null = null;
  #settle: (() => void) | null = null;

  async play(url: string, onStarted?: () => void): Promise<void> {
    this.stop();
    const generation = ++this.#generation;
    const abort = new AbortController();
    this.#abort = abort;
    const AudioCtor = (globalThis as { Audio?: typeof Audio }).Audio;
    if (!AudioCtor) {
      this.#abort = null;
      throw new Error("audio playback is unavailable");
    }
    try {
      const response = await fetch(url, { signal: abort.signal });
      if (generation !== this.#generation) return;
      if (!response.ok) throw new Error(`media request failed: ${response.status}`);
      const blob = await response.blob();
      if (generation !== this.#generation) return;
      const objectUrl = URL.createObjectURL(blob);
      if (generation !== this.#generation) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      const audio = new AudioCtor(objectUrl);
      this.#audio = { element: audio, objectUrl };
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          this.#settle = null;
          if (error) reject(error);
          else resolve();
        };
        this.#settle = () => finish();
        audio.onplaying = () => onStarted?.();
        audio.onended = () => finish();
        audio.onerror = () => finish(new Error("audio decode failed"));
        audio.play().catch((error: unknown) => finish(error instanceof Error ? error : new Error("playback blocked")));
      });
      if (generation === this.#generation) this.#releaseAudio();
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#releaseAudio();
      throw error;
    } finally {
      if (generation === this.#generation) this.#abort = null;
    }
  }

  stop(): void {
    this.#generation += 1;
    this.#abort?.abort();
    this.#abort = null;
    this.#settle?.();
    this.#settle = null;
    this.#releaseAudio();
  }

  #releaseAudio(): void {
    if (this.#audio !== null) {
      this.#audio.element.pause();
      URL.revokeObjectURL(this.#audio.objectUrl);
      this.#audio = null;
    }
  }
}

export interface BrowserMediaDeps extends BrowserRecorderDeps {}

/** Adaptery przeglądarkowe za portami PlatformMedia. */
export function createBrowserMedia(deps: BrowserMediaDeps = {}): PlatformMedia {
  const getUserMedia = deps.getUserMedia ?? ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
  return {
    prepareMicrophone: async () => {
      const stream = await getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    },
    createRecorder: (options) => new BrowserRecorder({ ...deps, getUserMedia }, options),
    player: new BrowserAudioPlayer(),
  };
}
