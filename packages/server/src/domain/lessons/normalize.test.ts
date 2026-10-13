import { describe, expect, it } from "vitest";
import { baseNormalizer, normalizeTokens } from "./normalize";

describe("normalizeTokens", () => {
  it("tokenizuje tekst po spacjach", () => {
    expect(normalizeTokens("he plays football")).toEqual(["he", "plays", "football"]);
  });

  it("sprowadza do małych liter niezależnie od locale", () => {
    expect(normalizeTokens("He PLAYS")).toEqual(["he", "plays"]);
  });

  it("ujednolica apostrofy typograficzne do zwykłego", () => {
    expect(normalizeTokens("don\u2019t can\u2018t it\u02bcs a\u00b4b")).toEqual([
      "don't",
      "can't",
      "it's",
      "a'b",
    ]);
  });

  it("zachowuje apostrof wewnątrz słowa", () => {
    expect(normalizeTokens("I don't know")).toEqual(["i", "don't", "know"]);
  });

  it("usuwa interpunkcję poza apostrofem wewnątrz słowa", () => {
    expect(normalizeTokens("Hello, world! (yes) — 'quote'")).toEqual([
      "hello",
      "world",
      "yes",
      "quote",
    ]);
  });

  it("zwija wielokrotne spacje i białe znaki", () => {
    expect(normalizeTokens("  he   \t plays\n football ")).toEqual(["he", "plays", "football"]);
  });

  it("zachowuje polskie znaki diakrytyczne (przedmioty polskojęzyczne)", () => {
    expect(normalizeTokens("Zażółć gęślą jaźń")).toEqual(["zażółć", "gęślą", "jaźń"]);
  });

  it("zachowuje cyfry", () => {
    expect(normalizeTokens("rok 1385")).toEqual(["rok", "1385"]);
  });

  it("normalizuje do Unicode NFC (zdekomponowane = złożone)", () => {
    const decomposed = "a\u0328"; // a + ogonek → ą
    expect(normalizeTokens(decomposed)).toEqual(normalizeTokens("ą"));
  });

  it("pusty tekst daje pustą listę tokenów", () => {
    expect(normalizeTokens("")).toEqual([]);
    expect(normalizeTokens("   ")).toEqual([]);
  });
});

describe("baseNormalizer", () => {
  it("zwraca jedną sekwencję tokenów", () => {
    expect(baseNormalizer.normalize("He plays")).toEqual([["he", "plays"]]);
  });

  it("pusty tekst → [[]]", () => {
    expect(baseNormalizer.normalize("")).toEqual([[]]);
  });

  it("nie usuwa apostrofu-separatora skrótów (należy do przedmiotu, nie silnika)", () => {
    // Bazowy normalizator nie rozwija skrótów — to robi normalizator przedmiotu.
    expect(baseNormalizer.normalize("doesn't")).toEqual([["doesn't"]]);
  });
});
