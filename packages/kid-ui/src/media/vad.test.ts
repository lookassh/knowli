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
} from "./vad";

/**
 * Czysta maszyna stanów VAD (quick 261021-lsw): sekwencje próbek poziomu,
 * zero DOM i zero timerów — próbki przychodziłyby z onLevel co ~100 ms.
 * Skala poziomów to rms×4 z browser.ts (0–1).
 */

describe("reduceVadSample — fazy i progi", () => {
  it("eksportuje stałe kalibracyjne zgodne z decyzją D-03", () => {
    expect(VAD_SPEECH_LEVEL_THRESHOLD).toBe(0.09);
    expect(VAD_SILENCE_LEVEL_THRESHOLD).toBe(0.05);
    expect(VAD_GRACE_SAMPLES).toBe(3);
    expect(VAD_SUSTAIN_SAMPLES).toBe(2);
    expect(VAD_TRAILING_SILENCE_SAMPLES).toBe(12);
  });

  it("próbki grace ignorują poziomy, także głośne (tłumienie echa bipu startu)", () => {
    let state = createInitialVadState();
    const loud = reduceVadSample(state, 1);
    expect(loud.action).toBe("none");
    expect(loud.state.phase).toBe("arming");
    state = loud.state;
    const second = reduceVadSample(state, 0.9);
    expect(second.state.phase).toBe("arming");
    state = second.state;
    // trzecia próbka wyczerpuje grace — nadal ignorowana, ale faza przechodzi w listening
    const third = reduceVadSample(state, 1);
    expect(third.action).toBe("none");
    expect(third.state.phase).toBe("listening");
    expect(createSpeechVad().speechDetected).toBe(false);
  });

  it("mowa = próg mowy przez 2 kolejne próbki → faza spoken", () => {
    let state = { ...createInitialVadState(), phase: "listening" as const };
    const first = reduceVadSample(state, VAD_SPEECH_LEVEL_THRESHOLD);
    expect(first.state.phase).toBe("listening");
    const second = reduceVadSample(first.state, VAD_SPEECH_LEVEL_THRESHOLD);
    expect(second.action).toBe("none");
    expect(second.state.phase).toBe("spoken");
  });

  it("poziom poniżej progu mowy w listening zeruje licznik sustain", () => {
    let state = { ...createInitialVadState(), phase: "listening" as const };
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
    let state = { ...createInitialVadState(), phase: "listening" as const };
    for (let index = 0; index < 200; index += 1) {
      const result = reduceVadSample(state, index % 2 === 0 ? 0 : VAD_SILENCE_LEVEL_THRESHOLD - 0.001);
      expect(result.action).toBe("none");
      expect(result.state.phase).toBe("listening");
      state = result.state;
    }
  });

  it("po mowie 12 kolejnych cisz daje auto_stop i stan terminalny", () => {
    let state = { ...createInitialVadState(), phase: "spoken" as const };
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
    let state = { ...createInitialVadState(), phase: "spoken" as const };
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
  it("pełny cykl: grace → mowa → cisza → auto_stop, speechDetected od faz spoken/stopped", () => {
    const vad = createSpeechVad();
    // grace
    expect(vad.sample(1)).toBe("none");
    expect(vad.sample(1)).toBe("none");
    expect(vad.sample(1)).toBe("none");
    expect(vad.speechDetected).toBe(false);
    // mowa
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

  it("reset po auto_stop: świeża instancja zaczyna od grace z pustą historią", () => {
    const first = createSpeechVad();
    first.sample(1); first.sample(1); first.sample(1);
    first.sample(0.2); first.sample(0.2);
    for (let index = 0; index < VAD_TRAILING_SILENCE_SAMPLES; index += 1) first.sample(0);
    const second = createSpeechVad();
    expect(second.speechDetected).toBe(false);
    // pierwsza próbka nowej instancji to grace — nie słucha jeszcze mowy
    expect(second.sample(0.5)).toBe("none");
    expect(second.speechDetected).toBe(false);
  });
});
