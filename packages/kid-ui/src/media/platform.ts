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
  /**
   * Limit długości tego nagrania (ms). Brak = limit słówek `MAX_RECORDING_MS`;
   * dyktowanie odpowiedzi lekcji podaje limit z `speechInput.maxSeconds`.
   */
  maxDurationMs?: number;
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
  /**
   * Wymaga sprawnego monitora poziomów (PR #109, P1 #2): tryb automatyczny nie
   * może nagrywać „głuchy” — bez poziomów VAD słyszy ciszę i limit 15 s anuluje
   * dobrą wypowiedź. Gdy inicjalizacja monitora (AudioContext + AnalyserNode,
   * z jedną próbą resume dla kontekstu suspended) nie powiedzie się, start()
   * odrzuca LevelMonitorUnavailableError PRZED sygnałem „teraz mów” i przed
   * MediaRecorder — strumień mikrofonu zostaje zwolniony, próba nie powstaje.
   * Tryb ręczny nie ustawia flagi: monitor pozostaje best-effort (miernik
   * poziomu), bo ręczne domknięcie nie zależy od VAD.
   */
  requireLevelMonitor?: boolean;
}

/**
 * Monitor poziomów niedostępny (PR #109, P1 #2): brak konstruktora
 * AudioContext, awaria konstrukcji albo kontekst pozostający suspended po
 * jednej próbie resume. Kontroler rozpoznaje ten błąd i przerywa próbę
 * automatyczną bez próby i bez zapamiętania odmowy — ścieżka ręczna działa
 * bez analizatora.
 */
export class LevelMonitorUnavailableError extends Error {
  constructor(message = "level monitor unavailable") {
    super(message);
    this.name = "LevelMonitorUnavailableError";
  }
}

/** Opcje odtwarzania; brak opcji = tempo 1. */
export interface AudioPlaybackOptions {
  /** Tempo odtwarzania (1 = normalne); wysokość głosu pozostaje zachowana. */
  rate?: number;
}

/** Tempo wolnego odsłuchu zdania. */
export const SLOW_PLAYBACK_RATE = 0.75;

/** Odtwarzacz wzorca z cache media; stop zwalnia zasoby audio. */
export interface AudioPlayer {
  /**
   * Odtwarza do końca; rzuca przy błędzie odtwarzania/sieci. `onStarted`
   * dostaje rzeczywisty czas trwania odsłuchu (z uwzględnieniem tempa).
   */
  play(url: string, onStarted?: (durationMs: number | null) => void, options?: AudioPlaybackOptions): Promise<void>;
  stop(): void;
}

/** Rodzaj sygnału dźwiękowego dla dziecka: „teraz mów” / „koniec”. */
export type BeepKind = "start" | "end";

/**
 * Stan uprawnienia mikrofonu (WR-02, decyzja właściciela 2026-10-21):
 * “granted” — zgoda już nadana, getUserMedia nie wywoła promptu;
 * “prompt” — zgody jeszcze nie ma, pierwsze nadanie wymaga gestu użytkownika
 * (świadome naciśnięcie przycisku nagrywania); “denied” — zgoda odrzucona;
 * “unknown” — API stanu uprawnień niedostępne (np. Firefox) — traktowane
 * jak brak zgody dla ścieżki automatycznej.
 */
export type MicrophonePermission = "granted" | "prompt" | "denied" | "unknown";

/** Adaptery platformowe za portami — domena UI ich nie zna (plan zadanie 9). */
export interface PlatformMedia {
  /** Request permission without recording; every acquired track is released. */
  prepareMicrophone(): Promise<void>;
  createRecorder(options?: RecorderOptions): SpeechRecorder;
  player: AudioPlayer;
  /**
   * Krótki sygnał dźwiękowy (WebAudio po stronie adaptera — kontroler nie zna
   * Web Audio). Bip jest opcjonalny: brak konstruktorów, kontekst suspended
   * albo awaria rozstrzygają się po cichu i nigdy nie blokują nagrywania.
   * Sygnał anulowania przerywa oczekujące wznowienie i odtwarzanie bipa.
   */
  playBeep(kind: BeepKind, signal?: AbortSignal): Promise<void>;
  /**
   * Wyłącznie zapytanie o stan uprawnienia mikrofonu (Permissions API po
   * stronie adaptera) — bez getUserMedia, bez efektów ubocznych, bez promptu.
   * Awaria lub brak API rozstrzyga się jako “unknown” (bezpieczne domyślnie).
   */
  getMicrophonePermission(): Promise<MicrophonePermission>;
  /**
   * Wstępne pobranie obrazu następnego zadania w tle (gdy host to potrafi):
   * kontroler woła je WYŁĄCZNIE dla już wydanego zadania, którego treść i tak
   * trafi do dziecka po kliknięciu „Dalej” — pobranie tylko ogrzewa cache
   * przeglądarki, niczego nie ujawnia na ekranie. Awaria jest cicha: obraz
   * pobierze się ponownie przy wyświetleniu zadania.
   */
  preloadImage?(url: string): Promise<void>;
}
