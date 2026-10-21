import type { AudioPlayer, BeepKind, MicrophonePermission, PlatformMedia, RecordedAudio, RecorderOptions, SpeechRecorder } from "./platform";
import { LevelMonitorUnavailableError } from "./platform";

/** Limit nagrania po stronie klienta — odpowiada limitowi serwera (arch §11). */
export const MAX_RECORDING_MS = 15_000;

/**
 * Limit jednej próby resume() AudioContext w trybie auto (PR #109, runda 2,
 * finding 1): przeglądarka może wstrzymać odblokowanie audio — bez limitu
 * start wisiałby w „starting” z nieuzbrojonym limitem nagrania.
 */
export const LEVEL_MONITOR_RESUME_TIMEOUT_MS = 750;

/** Preferowane kodeki w kolejności; pierwszy wspierany wygrywa. */
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm"] as const;

/** Wysokości bipów (Hz): start wyraźnie wyższy, koniec niższy (quick 261021-lsw). */
const BEEP_FREQUENCY_HZ: Record<BeepKind, number> = { start: 880, end: 590 };
const BEEP_DURATION_S = 0.13;
const BEEP_ATTACK_S = 0.01;
const BEEP_DECAY_S = 0.05;
const BEEP_PEAK_GAIN = 0.3;

/**
 * Krótki sygnał dźwiękowy WebAudio: krótkotrwały AudioContext zamykany po
 * zagraniu (limit równoczesnych kontekstów na iOS), obwiednia ataku/decay
 * przeciw klikowi. Bip jest opcjonalny — brak konstruktorów, kontekst
 * suspended (polityka autoplay) albo awaria rozstrzygają się po cichu,
 * bez rzucania i bez czekania na resume() (nagrywanie obowiązkowe).
 */
async function playBeepViaWebAudio(AudioContextCtor: typeof AudioContext | undefined, kind: BeepKind): Promise<void> {
  if (!AudioContextCtor) return;
  let context: AudioContext | null = null;
  try {
    context = new AudioContextCtor();
    if (context.state === "suspended") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = BEEP_FREQUENCY_HZ[kind];
    oscillator.connect(gain);
    gain.connect(context.destination);
    const startAt = context.currentTime;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(BEEP_PEAK_GAIN, startAt + BEEP_ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + BEEP_DECAY_S);
    oscillator.start(startAt);
    oscillator.stop(startAt + BEEP_DURATION_S);
    // onended normalnie domyka grę; czasomierz zabezpiecza środowiska, które
    // zdarzenia nie dostarczą, żeby bip nigdy nie wstrzymał obiegu nagrywania
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      oscillator.onended = finish;
      globalThis.setTimeout(finish, Math.round((BEEP_DURATION_S + 0.1) * 1000));
    });
  } catch {
    // bip degraduje się po cichu (T-261021-02)
  } finally {
    try {
      await context?.close();
    } catch {
      // zamykanie porzuconego kontekstu nie może rzucić observable
    }
  }
}

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
  permissions?: Permissions;
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
  #resumeTimeoutHandle: unknown = null;
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
    // Monitor poziomów PRZED sygnałem „teraz mów” i PRZED przechwytywaniem
    // (PR #109, P1 #2): w trybie auto niedostępny monitor przerywa start —
    // bez poziomów VAD słyszy ciszę i limit anuluje dobrą wypowiedź. W trybie
    // ręcznym monitor pozostaje best-effort (tylko miernik poziomu).
    const monitor = await this.#initializeLevelMonitor(stream);
    if (this.#cancelled || generation !== this.#generation) {
      this.#stopLevelMonitor();
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("recording cancelled");
    }
    if (monitor !== "running" && this.#options.requireLevelMonitor) {
      this.#stopLevelMonitor();
      this.#releaseStream();
      throw new LevelMonitorUnavailableError();
    }
    // Sygnał „teraz mów” (quick 261021-lsw, D-04): bip startu gra dopiero PO
    // udanym getUserMedia (i sprawnym monitorze poziomów) i PRZED rozpoczęciem
    // przechwytywania — szybka reakcja dziecka nie wyprzedza gotowości
    // rejestratora, a bip nie trafia do nagrania. Odrzucenie hooka połykamy:
    // bip opcjonalny, nagrywanie obowiązkowe (T-261021-02). Przycinanie
    // ewentualnego echa bipu z nagrania rozważono i odrzucono jako
    // nieproporcjonalne (PR #109, P2 #4) — bip w całości poprzedza capture.
    await Promise.resolve(this.#options.onMicrophoneReady?.()).catch(() => undefined);
    if (this.#cancelled || generation !== this.#generation) {
      this.#stopLevelMonitor();
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("recording cancelled");
    }
    let recorder: MediaRecorder;
    try {
      recorder = new this.#MediaRecorder(stream, { mimeType });
    } catch (error) {
      this.#stopLevelMonitor();
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
    // monitor poziomów żyje już od przed sygnałem „teraz mów” (P1 #2)
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

  /**
   * Inicjalizuje monitor poziomów (PR #109, P1 #2 + runda 2) i zwraca jego stan:
   * "running" — AnalyserNode podłączony i odświeżany; "unavailable" — brak
   * konstruktora AudioContext, awaria konstrukcji/podłączenia albo (tylko w
   * trybie auto) kontekst, który po ograniczonej czasowo próbie resume nie
   * osiąga stanu "running" (suspended/interrupted/…). Wywoływane przed
   * sygnałem „teraz mów”; przy requireLevelMonitor stan inny niż running
   * przerywa start (LevelMonitorUnavailableError).
   *
   * Runda 2, finding 1: w trybie RĘCZNYM nigdy nie czekamy na resume() —
   * monitor podłączamy best-effort jak przed PR #109 (odblokowanie audio
   * zostawiamy przeglądarce, fire-and-forget), bo ręczne nagrywanie nie zależy
   * od poziomów i nie może wisieć w „starting”. W trybie AUTO resume()
   * ścigamy z krótkim limitem na wstrzykniętych timerach — przeglądarka może
   * wstrzymać odblokowanie audio (polityka autoplay) i bez limitu start
   * wisiałby bezterminowo, z nieuzbrojonym limitem 15 s.
   *
   * Runda 2, finding 3: kontekst przypisujemy do #levelContext NATYCHMIAST po
   * konstrukcji — sprzątanie (catch/#stopLevelMonitor) zamyka go na każdej
   * ścieżce awarii (createAnalyser/connect/…), więc kolejne próby nie zbiegają
   * kontekstów audio.
   */
  async #initializeLevelMonitor(stream: MediaStream): Promise<"running" | "unavailable"> {
    if (!this.#AudioContext || !this.#options.onLevel) return "unavailable";
    try {
      const context = new this.#AudioContext();
      this.#levelContext = context;
      if (this.#options.requireLevelMonitor) {
        // AUTO przyjmuje WYŁĄCZNIE stan "running" (runda 2, finding 2):
        // "suspended", "interrupted" (Safari/iOS) i każdy inny stan nie dostarcza
        // próbek — VAD usłyszałby ciszę i limit 15 s anulował dobrą wypowiedź
        if (context.state !== "running") {
          const resumed = await this.#resumeWithinTimeout(context);
          // resume() mutuje stan kontekstu — asercja rozwija zawężenie z gorętszego
          // warunku, bo kontrola przepływu nie śledzi mutacji przez resume()
          const stateAfterResume = context.state as AudioContextState;
          if (!resumed || stateAfterResume !== "running") {
            this.#stopLevelMonitor();
            return "unavailable";
          }
        }
      } else if (context.state === "suspended") {
        // ręcznie: fire-and-forget, bez blokowania startu nagrywania
        void context.resume().catch(() => undefined);
      }
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
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
      return "running";
    } catch {
      this.#stopLevelMonitor();
      return "unavailable";
    }
  }

  /**
   * Jedna próba resume() ścigana z limitem czasu na wstrzykniętych timerach
   * (runda 2, finding 1): zwraca false przy odrzuceniu; upłynięcie limitu
   * rozstrzyga się po stronie wywołującego przez ponowny test stanu kontekstu.
   */
  async #resumeWithinTimeout(context: AudioContext): Promise<boolean> {
    try {
      await Promise.race([
        context.resume(),
        new Promise<void>((resolve) => {
          this.#resumeTimeoutHandle = this.#timers.set(() => resolve(), LEVEL_MONITOR_RESUME_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return false;
    } finally {
      if (this.#resumeTimeoutHandle !== null) {
        this.#timers.clear(this.#resumeTimeoutHandle);
        this.#resumeTimeoutHandle = null;
      }
    }
    return true;
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

  async play(url: string, onStarted?: (durationMs: number | null) => void): Promise<void> {
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
        audio.onplaying = () => {
          const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : null;
          onStarted?.(duration);
        };
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

/**
 * Zapytanie o stan uprawnienia mikrofonu (WR-02, decyzja właściciela
 * 2026-10-21): wyłącznie Permissions API — bez getUserMedia, bez promptu i bez
 * efektów ubocznych. Brak API (np. Firefox), niewspierana nazwa uprawnienia
 * albo awaria rozstrzygają się bezpiecznie jako "unknown".
 */
export async function queryMicrophonePermission(
  permissions: Permissions | undefined,
): Promise<MicrophonePermission> {
  if (!permissions?.query) return "unknown";
  try {
    const status = await permissions.query({ name: "microphone" } as PermissionDescriptor);
    if (status.state === "granted" || status.state === "prompt" || status.state === "denied") {
      return status.state;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export interface BrowserMediaDeps extends BrowserRecorderDeps {}

/** Adaptery przeglądarkowe za portami PlatformMedia. */
export function createBrowserMedia(deps: BrowserMediaDeps = {}): PlatformMedia {
  const getUserMedia = deps.getUserMedia ?? ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
  const AudioContextCtor = deps.audioContext ?? globalThis.AudioContext;
  const permissions = deps.permissions ?? (globalThis as { navigator?: Navigator }).navigator?.permissions;
  return {
    prepareMicrophone: async () => {
      const stream = await getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    },
    createRecorder: (options) => new BrowserRecorder({ ...deps, getUserMedia }, options),
    player: new BrowserAudioPlayer(),
    playBeep: (kind) => playBeepViaWebAudio(AudioContextCtor, kind),
    getMicrophonePermission: () => queryMicrophonePermission(permissions),
  };
}
