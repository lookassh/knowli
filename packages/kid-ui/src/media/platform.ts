/**
 * Adapter platformowy mediów w interfejsie dziecka (plan zadania 8). Pakiet
 * jest przenośny: nie importuje Next.js, serwera ani typów Node — mikrofon,
 * odtwarzacz i lokalne ustawienia żyją za tymi interfejsami, aby przyszły host
 * Capacitor mógł je podmienić.
 */

/** Krótkie nagranie mowy dziecka: bajty opuszczają przeglądarkę, nie zostają. */
export interface RecordedAudio {
  bytes: Uint8Array;
  mimeType: string;
}

/** Rejestrator jednokrotnego użycia: start → stop albo cancel. */
export interface SpeechRecorder {
  /** Prosi o mikrofon i zaczyna nagrywanie; odrzuca przy braku uprawnienia. */
  start(): Promise<void>;
  /** Kończy nagranie i zwraca bajty; zwalnia mikrofon i bufory także po błędzie. */
  stop(): Promise<RecordedAudio>;
  /** Porzuca nagranie: zatrzymuje strumień, wyrzuca bufory, odrzuca oczekujący stop. */
  cancel(): void;
  readonly active: boolean;
}

export interface RecorderOptions {
  /** Transient RMS level in the range 0–1; raw samples never leave the adapter. */
  onLevel?: (level: number) => void;
  onLimitReached?: () => void;
  /** Awaria urządzenia podczas aktywnego nagrania; nie jest próbą dziecka. */
  onError?: () => void;
  /**
   * Sygnał „teraz mów” (quick 261021-lsw, D-04): wołany PO udanym
   * getUserMedia i PRZED rozpoczęciem przechwytywania, żeby bip startu
   * zagrał dopiero po gotowości mikrofonu i nie trafił do nagrania.
   * Odrzucenie jest połykane przez rejestrator — sygnał jest opcjonalny,
   * nagrywanie obowiązkowe.
   */
  onMicrophoneReady?: () => Promise<void> | void;
}

/** Odtwarzacz wzorca z cache media; stop zwalnia zasoby audio. */
export interface AudioPlayer {
  /** Odtwarza do końca; rzuca przy błędzie odtwarzania/sieci. */
  play(url: string, onStarted?: (durationMs: number | null) => void): Promise<void>;
  stop(): void;
}

/** Rodzaj sygnału dźwiękowego dla dziecka: „teraz mów” / „koniec”. */
export type BeepKind = "start" | "end";

/** Adaptery platformowe za portami — domena UI ich nie zna (plan zadania 9). */
export interface PlatformMedia {
  /** Request permission without recording; every acquired track is released. */
  prepareMicrophone(): Promise<void>;
  createRecorder(options?: RecorderOptions): SpeechRecorder;
  player: AudioPlayer;
  /**
   * Krótki sygnał dźwiękowy (WebAudio po stronie adaptera — kontroler nie zna
   * Web Audio). Bip jest opcjonalny: brak konstruktorów, kontekst suspended
   * albo awaria rozstrzygają się po cichu i nigdy nie blokują nagrywania.
   */
  playBeep(kind: BeepKind): Promise<void>;
}
