import { describe, expect, it } from "vitest";
import { classifyDictation, comparableDictationText, DEFAULT_DICTATION_POLICY, resolveInputMethod } from "./dictation";

describe("classifyDictation", () => {
  it("awaria STT to brak tekstu z powodu technicznego, nie wynik dziecka", () => {
    expect(classifyDictation({ status: "failed", text: null, confidence: null })).toEqual({ status: "unavailable" });
  });

  it("cisza i pusty tekst po normalizacji to no_speech", () => {
    expect(classifyDictation({ status: "no_speech", text: null, confidence: null })).toEqual({ status: "no_speech" });
    expect(classifyDictation({ status: "ok", text: "  \n ", confidence: 0.99 })).toEqual({ status: "no_speech" });
    expect(classifyDictation({ status: "ok", text: null, confidence: 0 })).toEqual({ status: "no_speech" });
  });

  it("niska pewność nie zwraca tekstu", () => {
    expect(classifyDictation({ status: "ok", text: "When do we?", confidence: 0.1 })).toEqual({ status: "uncertain" });
    expect(classifyDictation({ status: "ok", text: "Mapa to obraz", confidence: DEFAULT_DICTATION_POLICY.minConfidence })).toEqual({
      status: "heard",
      text: "Mapa to obraz",
    });
  });

  it("brak confidence u providera nie blokuje tekstu", () => {
    expect(classifyDictation({ status: "ok", text: "Południk zero przechodzi przez Paryż", confidence: null })).toEqual({
      status: "heard",
      text: "Południk zero przechodzi przez Paryż",
    });
  });

  it("tekst ponad limit odpowiedzi otwartej to too_long, a nie przycięta odpowiedź", () => {
    const long = "a".repeat(DEFAULT_DICTATION_POLICY.maxLength + 1);
    expect(classifyDictation({ status: "ok", text: long, confidence: 0.9 })).toEqual({ status: "too_long" });
    const exact = "a".repeat(DEFAULT_DICTATION_POLICY.maxLength);
    expect(classifyDictation({ status: "ok", text: exact, confidence: 0.9 })).toEqual({ status: "heard", text: exact });
  });

  it("zwraca tekst w postaci porównywalnej (NFC, pojedyncze odstępy)", () => {
    const decomposed = "Równik  to\n najdłuższy".normalize("NFD");
    expect(classifyDictation({ status: "ok", text: ` ${decomposed} `, confidence: 0.9 })).toEqual({
      status: "heard",
      text: "Równik to najdłuższy",
    });
    expect(comparableDictationText(decomposed)).toBe("Równik to najdłuższy");
  });
});

describe("resolveInputMethod", () => {
  it("deklaracja mowy bez dyktowania w tym zadaniu zapisuje klawiaturę", () => {
    expect(resolveInputMethod({ declared: "speech", answerFingerprint: "a", dictatedFingerprint: undefined })).toEqual({ inputMethod: "keyboard" });
  });

  it("brak deklaracji to klawiatura, nawet po dyktowaniu", () => {
    expect(resolveInputMethod({ declared: undefined, answerFingerprint: "a", dictatedFingerprint: "a" })).toEqual({ inputMethod: "keyboard" });
    expect(resolveInputMethod({ declared: "keyboard", answerFingerprint: "a", dictatedFingerprint: "a" })).toEqual({ inputMethod: "keyboard" });
  });

  it("mowa z niezmienionym tekstem i po poprawce", () => {
    expect(resolveInputMethod({ declared: "speech", answerFingerprint: "a", dictatedFingerprint: "a" })).toEqual({ inputMethod: "speech", edited: false });
    expect(resolveInputMethod({ declared: "speech", answerFingerprint: "b", dictatedFingerprint: "a" })).toEqual({ inputMethod: "speech", edited: true });
  });
});
