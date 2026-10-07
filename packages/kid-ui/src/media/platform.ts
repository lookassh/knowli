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
  /** Prosi o mikrofon i zaczyna nagrywać; odrzuca przy braku uprawnienia. */
  start(): Promise<void>;
  /** Kończy nagranie i zwraca bajty; zwalnia mikrofon i bufory także po błędzie. */
  stop(): Promise<RecordedAudio>;
  /** Porzuca nagranie: zatrzymuje strumień, wyrzuca bufory, odrzuca oczekujący stop. */
  cancel(): void;
  readonly active: boolean;
}
