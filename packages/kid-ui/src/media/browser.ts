import type { AudioPlayer, PlatformMedia, RecordedAudio, SpeechRecorder } from "./platform";

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
  };
}

const defaultTimers = {
  set: (handler: () => void, ms: number) => setTimeout(handler, ms),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

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

  constructor(deps: BrowserRecorderDeps = {}) {
    // globalne API czytamy przez globalThis — konstruktor działa też poza przeglądarką
    const globalRecorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    this.#getUserMedia =
      deps.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    this.#MediaRecorder = deps.mediaRecorder ?? globalRecorder!;
    this.#isTypeSupported = deps.isTypeSupported ?? ((mime) => this.#MediaRecorder.isTypeSupported(mime));
    this.#timers = deps.timers ?? defaultTimers;
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
    let stream: MediaStream;
    try {
      stream = await this.#getUserMedia({ audio: true });
    } catch (error) {
      throw new Error("microphone permission denied", { cause: error });
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
      this.#teardown();
      this.#pendingReject?.(new Error("recording failed"));
    };
    recorder.onstop = () => {
      void this.#assemble();
    };
    this.#state = "recording";
    recorder.start(250);
    this.#timeoutHandle = this.#timers.set(() => {
      if (this.#state === "recording") {
        this.#state = "finalizing";
        this.#recorder?.stop();
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
    this.#recorder!.stop();
    return this.#waitForCapture();
  }

  cancel(): void {
    const pending = this.#pendingReject;
    this.#teardown();
    this.#pendingStop = null;
    this.#pendingReject = null;
    this.#state = "idle";
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
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (this.#cancelled) {
        // nagranie anulowane w trakcie składania — bufor zostaje porzucony
        this.#state = "idle";
        this.#captured = null;
        return;
      }
      const resolve = this.#pendingStop;
      this.#pendingStop = null;
      this.#pendingReject = null;
      if (resolve) {
        this.#state = "idle";
        resolve({ bytes, mimeType: this.#mimeType });
        return;
      }
      // automatyczne domknięcie limitem — nagranie czeka na stop() klienta
      this.#state = "captured";
      this.#captured = { bytes, mimeType: this.#mimeType };
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
    if (this.#recorder && this.#recorder.state !== "inactive") {
      this.#recorder.stop();
    }
    this.#recorder = null;
    this.#releaseStream();
    this.#chunks = [];
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

  async play(url: string): Promise<void> {
    this.stop();
    const AudioCtor = (globalThis as { Audio?: typeof Audio }).Audio;
    if (!AudioCtor) {
      throw new Error("audio playback is unavailable");
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`media request failed: ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const audio = new AudioCtor(objectUrl);
    this.#audio = { element: audio, objectUrl };
    return new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("audio decode failed"));
      audio.play().catch((error: unknown) => reject(error instanceof Error ? error : new Error("playback blocked")));
    });
  }

  stop(): void {
    if (this.#audio !== null) {
      this.#audio.element.pause();
      URL.revokeObjectURL(this.#audio.objectUrl);
      this.#audio = null;
    }
  }
}

/** Adaptery przeglądarkowe za portami PlatformMedia (plan zadania 9). */
export function createBrowserMedia(): PlatformMedia {
  return {
    createRecorder: () => new BrowserRecorder(),
    player: new BrowserAudioPlayer(),
  };
}
