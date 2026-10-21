import { describe, expect, it } from "vitest";
import {
  createSpeechVad,
  createInitialVadState,
  reduceVadSample,
  VAD_GRACE_SAMPLES,
  VAD_SILENCE_LEVEL_THRESHOLD,
  VAD_SPEECH_LEVEL_THRESHOLD,
  VAD_SUSTAIN_SAMPLES,
  VAD_TRAILING_SILENCE_SAMPLES,
  type VadState,
} from "./vad";

/**
 * Czysta maszyna stanów VAD (quick 261021-lsw): sekwencje próbek poziomu,
 * zero DOM i zero timerów — próbki przychodziłyby z onLevel co ~100 ms.
 * Skala poziomów to rms×4 z browser.ts (0–1).
 */

describe("reduceVadSample — fazy i progi", () => {
  it("eksportuje stałe kalibracyjne zgodne z decyzją D-03 i PR #109 P1 #1", () => {
    expect(VAD_SPEECH_LEVEL_THRESHOLD).toBe(0.09);
    expect(VAD_SILENCE_LEVEL_THRESHOLD).toBe(0.05);
    // zero martwej strefy: bip startu kończy się przed przechwytywaniem
    expect(VAD_GRACE_SAMPLES).toBe(0);
    expect(VAD_SUSTAIN_SAMPLES).toBe(2);
    expect(VAD_TRAILING_SILENCE_SAMPLES).toBe(12);
  });

  it("pierwsza próbka od t=0 podlega ocenie — brak martwej strefy na start (PR #109 P1 #1)", () => {
    let state = createInitialVadState();
    // bip startu kończy się przed przechwytywaniem, więc próg mowy liczy się
    // od próbki #0: sustain rośnie od pierwszej głośnej próbki
    const first = reduceVadSample(state, 1);
    expect(first.action).toBe("none");
    expect(first.state.phase).toBe("listening");
    expect(first.state.sustainCount).toBe(1);
    state = first.state;
    const second = reduceVadSample(state, 0.9);
    expect(second.action).toBe("none");
    expect(second.state.phase).toBe("spoken");
    expect(createSpeechVad().speechDetected).toBe(false);
  });

  it("krótkie słowo od t=0 (~200 ms = 2 próbki) jest wykrywane", () => {
    const vad = createSpeechVad();
    expect(vad.sample(VAD_SPEECH_LEVEL_THRESHOLD)).toBe("none");
    expect(vad.sample(VAD_SPEECH_LEVEL_THRESHOLD)).toBe("none");
    expect(vad.speechDetected).toBe(true);
  });

  it("początek wypowiedzi po ~150 ms ciszy też jest wykrywany", () => {
    const vad = createSpeechVad();
    expect(vad.sample(0)).toBe("none");
    // słowo zaczyna się ~150 ms po starcie przechwytywania
    expect(vad.sample(0.2)).toBe("none");
    expect(vad.sample(0.2)).toBe("none");
    expect(vad.speechDetected).toBe(true);
  });

  it("pojedynczy impuls szumu od t=0 nie wykrywa mowy (strażnik sustain)", () => {
    const vad = createSpeechVad();
    expect(vad.sample(0.5)).toBe("none");
    expect(vad.speechDetected).toBe(false);
    // dalsza cisza: sustain nieosiągalny, auto_stop nigdy — domknie limit czasu
    for (let index = 0; index < 50; index += 1) {
      expect(vad.sample(0)).toBe("none");
    }
    expect(vad.speechDetected).toBe(false);
  });

  it("mowa = próg mowy przez 2 kolejne próbki → faza spoken", () => {
    let state: VadState = { ...createInitialVadState(), phase: "listening" };
    const first = reduceVadSample(state, VAD_SPEECH_LEVEL_THRESHOLD);
    expect(first.state.phase).toBe("listening");
    const second = reduceVadSample(first.state, VAD_SPEECH_LEVEL_THRESHOLD);
    expect(second.action).toBe("none");
    expect(second.state.phase).toBe("spoken");
  });

  it("poziom poniżej progu mowy w listening zeruje licznik sustain", () => {
    let state: VadState = { ...createInitialVadState(), phase: "listening" };
    state = reduceVadSample(state, VAD_SPEECH_LEVEL_THRESHOLD).state;
    // przerwanie serii: poziom nachylenia między progami nie jest mową
    state = reduceVadSample(state, 0.06).state;
    expect(state.phase).toBe("listening");
    state = reduceVadSample(state, VAD_SPEECH_LEVEL_THRESHOLD).state;
    expect(state.phase).toBe("listening");
    state = reduceVadSample(state, VAD_SPEECH_LEVEL_THRESHOLD).state;
    expect(state.phase).toBe("spoken");
  });

  it("cisza w fazie listening nie stopuje nigdy — czeka na mowę bezterminowo", () => {
    let state: VadState = { ...createInitialVadState(), phase: "listening" };
    for (let index = 0; index < 200; index += 1) {
      const result = reduceVadSample(state, index % 2 === 0 ? 0 : VAD_SILENCE_LEVEL_THRESHOLD - 0.001);
      expect(result.action).toBe("none");
      expect(result.state.phase).toBe("listening");
      state = result.state;
    }
  });

  it("po mowie 12 kolejnych cisz daje auto_stop i stan terminalny", () => {
    let state: VadState = { ...createInitialVadState(), phase: "spoken" };
    for (let index = 1; index < VAD_TRAILING_SILENCE_SAMPLES; index += 1) {
      const result = reduceVadSample(state, 0.01);
      expect(result.action).toBe("none");
      expect(result.state.phase).toBe("spoken");
      state = result.state;
    }
    const stop = reduceVadSample(state, 0.01);
    expect(stop.action).toBe("auto_stop");
    expect(stop.state.phase).toBe("stopped");
    // stan terminalny: dalsze próbki nie zmieniają fazy ani nie powtarzają akcji
    const after = reduceVadSample(stop.state, 1);
    expect(after.action).toBe("none");
    expect(after.state.phase).toBe("stopped");
  });

  it("poziom ≥ progu ciszy w fazie spoken resetuje licznik ciszy", () => {
    let state: VadState = { ...createInitialVadState(), phase: "spoken" };
    for (let index = 0; index < VAD_TRAILING_SILENCE_SAMPLES - 1; index += 1) {
      state = reduceVadSample(state, 0.01).state;
    }
    // mowa przedłużona: 11 cisz, potem dźwięk nad progiem ciszy — licznik od zera
    state = reduceVadSample(state, VAD_SILENCE_LEVEL_THRESHOLD).state;
    expect(state.phase).toBe("spoken");
    for (let index = 0; index < VAD_TRAILING_SILENCE_SAMPLES - 1; index += 1) {
      const result = reduceVadSample(state, 0.01);
      expect(result.action).toBe("none");
      state = result.state;
    }
    const stop = reduceVadSample(state, 0.01);
    expect(stop.action).toBe("auto_stop");
  });

  it("reducer jest czysty — nie mutuje stanu wejściowego", () => {
    const input = { ...createInitialVadState(), phase: "listening" as const, sustainCount: 1 };
    const frozen = { ...input };
    const result = reduceVadSample(input, VAD_SPEECH_LEVEL_THRESHOLD);
    expect(input).toEqual(frozen);
    expect(result.state).not.toBe(input);
  });
});

describe("createSpeechVad — kapsułka nad reducerem", () => {
  it("pełny cykl: mowa → cisza → auto_stop, speechDetected od faz spoken/stopped", () => {
    const vad = createSpeechVad();
    // mowa od pierwszej próbki (brak martwej strefy, PR #109 P1 #1)
    expect(vad.sample(0.1)).toBe("none");
    expect(vad.sample(0.1)).toBe("none");
    expect(vad.speechDetected).toBe(true);
    // cisza
    for (let index = 0; index < VAD_TRAILING_SILENCE_SAMPLES - 1; index += 1) {
      expect(vad.sample(0)).toBe("none");
    }
    expect(vad.sample(0)).toBe("auto_stop");
    // terminalnie: nic już nie zmienia stanu
    expect(vad.sample(1)).toBe("none");
    expect(vad.speechDetected).toBe(true);
  });

  it("reset po auto_stop: świeża instancja zaczyna z pustą historią", () => {
    const first = createSpeechVad();
    first.sample(1); first.sample(1);
    first.sample(0.2); first.sample(0.2);
    for (let index = 0; index < VAD_TRAILING_SILENCE_SAMPLES; index += 1) first.sample(0);
    const second = createSpeechVad();
    expect(second.speechDetected).toBe(false);
    // pierwsza próbka nowej instancji liczy się do sustain, ale jedna nie
    // wystarcza do wykrycia mowy
    expect(second.sample(0.5)).toBe("none");
    expect(second.speechDetected).toBe(false);
  });
});
