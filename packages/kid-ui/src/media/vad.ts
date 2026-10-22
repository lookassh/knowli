/**
 * Czysta maszyna stanów detekcji aktywności głosowej (quick 261021-lsw, D-03).
 * Wzorcem jest exercises/recording-gesture.ts: reducer + fabryka, zero DOM,
 * zero timerów — próbki poziomu dostarcza wywołujący.
 *
 * Założenie próbkowania: onLevel z BrowserRecorder emituje poziom co ~100 ms
 * (AnalyserNode, fftSize 256). Przy tej kadencji sustain 2 próbki ≈ 200 ms
 * potwierdzenia mowy, a 12 próbek ciszy ≈ 1,2 s końca wypowiedzi. Skala
 * poziomów to rms×4 z browser.ts (0–1); progi są stałymi eksportowanymi do
 * kalibracji.
 *
 * Bez martwej strefy na start (PR #109, P1 #1): bip startu kończy się PRZED
 * rozpoczęciem przechwytywania (onMicrophoneReady jest awaitowane przed
 * konstrukcją MediaRecorder w BrowserRecorder.start), więc tłumienie echa
 * bipu nie wymaga żadnych ignorowanych próbek — krótkie słowo (~200 ms =
 * 2 próbki) wypowiedziane od razu po sygnale musi być wykrywalne od pierwszej
 * próbki. Pojedynczy impuls szumu odsiewa dopiero próg sustain (2 kolejne
 * próbki mowy).
 *
 * Cisza bez wykrytej mowy NIE stopuje nigdy — wtedy nagrywanie domyka limit
 * czasu (onLimitReached), a kontroler anuluje próbę: milczenie nie jest
 * dowodem błędnej wiedzy (SPEC §15, AGENTS.md).
 */

/** Poziom rms×4, od którego próbka liczy się jako mowa. */
export const VAD_SPEECH_LEVEL_THRESHOLD = 0.09;
/** Poziom rms×4, poniżej którego próbka liczy się jako cisza. */
export const VAD_SILENCE_LEVEL_THRESHOLD = 0.05;
/**
 * Próbki ignorowane po starcie; 0 — bip startu kończy się przed rozpoczęciem
 * przechwytywania, więc tłumienie echa bipu nie wymaga martwej strefy
 * (PR #109, P1 #1). Wartość > 0 pozostaje kalibracyjna dla przyszłych hostów.
 */
export const VAD_GRACE_SAMPLES = 0;
/** Kolejne próbki mowy wymagane do wykrycia wypowiedzi. */
export const VAD_SUSTAIN_SAMPLES = 2;
/** Kolejne cisze po wypowiedzi domykające nagranie (~1,2 s). */
export const VAD_TRAILING_SILENCE_SAMPLES = 12;

export type VadPhase = "arming" | "listening" | "spoken" | "stopped";
export type VadAction = "none" | "auto_stop";

export interface VadState {
  phase: VadPhase;
  /** Próbki zużyte w fazie arming. */
  graceUsed: number;
  /** Bieżąca seria kolejnych próbek mowy w fazie listening. */
  sustainCount: number;
  /** Bieżąca seria kolejnych cisz w fazie spoken. */
  silenceCount: number;
}

export function createInitialVadState(): VadState {
  return { phase: "arming", graceUsed: 0, sustainCount: 0, silenceCount: 0 };
}

/**
 * Redukuje jedną próbkę poziomu. Stan "stopped" jest terminalny — dalsze
 * próbki nie zmieniają fazy ani nie powtarzają akcji auto_stop.
 */
export function reduceVadSample(state: VadState, level: number): { state: VadState; action: VadAction } {
  if (state.phase === "stopped") return { state, action: "none" };
  if (state.phase === "arming") {
    const graceUsed = state.graceUsed + 1;
    if (graceUsed < VAD_GRACE_SAMPLES) {
      return { state: { ...state, graceUsed }, action: "none" };
    }
    // grace wyczerpany: próbka PRZEJŚCIA podlega już ocenie w listening
    // (fall-through, PR #109 P1 #1) — przy GRACE=0 ocena zaczyna się od
    // próbki #0, więc krótkie słowo od t=0 nie wpada w martwą strefę
    return reduceVadSample({ phase: "listening", graceUsed, sustainCount: 0, silenceCount: 0 }, level);
  }
  if (state.phase === "listening") {
    if (level >= VAD_SPEECH_LEVEL_THRESHOLD) {
      const sustainCount = state.sustainCount + 1;
      if (sustainCount >= VAD_SUSTAIN_SAMPLES) {
        return { state: { phase: "spoken", graceUsed: state.graceUsed, sustainCount, silenceCount: 0 }, action: "none" };
      }
      return { state: { ...state, sustainCount }, action: "none" };
    }
    // cisza lub półgłos przerywa serię — nadal czekamy na wyraźną mowę
    return { state: { ...state, sustainCount: 0 }, action: "none" };
  }
  // spoken: domykamy po ~1,2 s ciszy; dźwięk nad progiem ciszy przedłuża wypowiedź
  if (level < VAD_SILENCE_LEVEL_THRESHOLD) {
    const silenceCount = state.silenceCount + 1;
    if (silenceCount >= VAD_TRAILING_SILENCE_SAMPLES) {
      return { state: { phase: "stopped", graceUsed: state.graceUsed, sustainCount: state.sustainCount, silenceCount }, action: "auto_stop" };
    }
    return { state: { ...state, silenceCount }, action: "none" };
  }
  return { state: { ...state, silenceCount: 0 }, action: "none" };
}

export interface SpeechVad {
  /** Podaje kolejną próbkę poziomu; zwraca akcję dla wywołującego. */
  sample(level: number): VadAction;
  /** True po osiągnięciu fazy spoken (także po terminalnym auto_stop). */
  readonly speechDetected: boolean;
  readonly phase: VadPhase;
}

/** Kapsułka nad reducerem — jedna wypowiedź na instancję; re-arm = nowa instancja. */
export function createSpeechVad(): SpeechVad {
  let state = createInitialVadState();
  return {
    sample(level: number): VadAction {
      const result = reduceVadSample(state, level);
      state = result.state;
      return result.action;
    },
    get speechDetected(): boolean {
      return state.phase === "spoken" || state.phase === "stopped";
    },
    get phase(): VadPhase {
      return state.phase;
    },
  };
}
