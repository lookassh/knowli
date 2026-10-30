import { describe, expect, it } from "vitest";
import { checkElement, FUNCTION_WORDS, materialLexicon } from "./lexicon";

const MATERIAL = "Monday, T-shirt, It's raining. boots, I'm wearing a coat.";

describe("słownik materiału rozdziału", () => {
  const lexicon = materialLexicon(MATERIAL);

  it.each([
    ["monday", "wielka litera w materiale"],
    ["T-shirt", "wyraz z łącznikiem w całości"],
    ["shirt", "część wyrazu z łącznikiem"],
    ["rain", "odmiana: raining → rain"],
    ["boot", "odmiana: boots → boot"],
    ["boots", "dokładne słowo"],
    ["It is raining", "skrót z materiału rozwinięty"],
    ["It's raining", "skrót po obu stronach"],
    ["a coat", "wiodący rodzajnik pominięty"],
    ["I am wearing a coat.", "zdanie z interpunkcją"],
  ])("przyjmuje „%s” (%s)", (text) => {
    expect(checkElement(text, lexicon)).toEqual({ ok: true });
  });

  it("odrzuca słowo spoza materiału i podaje je małymi literami", () => {
    expect(checkElement("snowing", lexicon)).toEqual({ ok: false, unknown: "snowing" });
    expect(checkElement("It's Snowing", lexicon)).toEqual({ ok: false, unknown: "snowing" });
  });

  it("odrzuca element bez słowa treści (same słowa funkcyjne)", () => {
    expect(checkElement("the", lexicon)).toMatchObject({ ok: false, unknown: "the", noContentWord: true });
    expect(checkElement("I am", lexicon)).toMatchObject({ ok: false, noContentWord: true });
    expect(checkElement("", lexicon)).toMatchObject({ ok: false, noContentWord: true });
  });

  it("słowa funkcyjne spoza materiału nie odrzucają elementu ze słowem treści", () => {
    expect(checkElement("She is wearing her boots today", lexicon)).toEqual({ ok: true });
  });

  it("apostrof typograficzny ’ jest zwykłym apostrofem po obu stronach", () => {
    const typographic = materialLexicon("It’s raining.");
    expect(typographic.has("it's")).toBe(true);
    expect(checkElement("it's raining", typographic)).toEqual({ ok: true });
    expect(checkElement("It’s raining", lexicon)).toEqual({ ok: true });
  });

  it("słownik zawiera wyraz z łącznikiem w całości i jego części", () => {
    expect([...["t-shirt", "t", "shirt"]].every((token) => lexicon.has(token))).toBe(true);
  });

  it("odmiana działa w obu kierunkach, także z podwojoną spółgłoską i -ies → -y", () => {
    const material = materialLexicon("swim, running, dresses, party, stopped, skate, rained, boxes");
    for (const text of ["swimming", "run", "dress", "parties", "stop", "skating", "rain", "raining", "box"]) {
      expect(checkElement(text, material), text).toEqual({ ok: true });
    }
    expect(checkElement("dance", material)).toEqual({ ok: false, unknown: "dance" });
  });

  // Regresja (review Task 5): rdzenie 2-znakowe i rdzenie będące słowami funkcyjnymi
  // przepuszczały nowe słownictwo przez kolizję („thing” przez „the”, „wing” przez „we”).
  const CHAPTER = "Unit 1. Clothes and weather\n" +
    "coat – płaszcz, hat – czapka, boots – kozaki, T-shirt – koszulka, red, pink, green\n" +
    "It's sunny. It's raining. It's cold. What's the weather like? I'm wearing (a) ... She's wearing a red hat. " +
    "We're happy. Put on your coat. I can see the sun. Don't forget!";
  const chapter = materialLexicon(CHAPTER);

  it.each([
    ["thing", "rdzeń „the” to słowo funkcyjne"],
    ["wing", "rdzeń „we” jest za krótki i funkcyjny"],
    ["wed", "rdzeń „we”"],
    ["shed", "rdzeń „she”"],
    ["ones", "rdzeń „on”"],
    ["cans", "rdzeń „can”"],
    ["canned", "rdzeń „can” po podwojonej spółgłosce"],
    ["noted", "rdzeń „not” z rozwinięcia „don't”"],
    ["ring", "rdzeń „re” z „red”"],
    ["reed", "rdzeń „re” z „red”"],
  ])("odrzuca „%s” (%s)", (text) => {
    expect(checkElement(text, chapter)).toEqual({ ok: false, unknown: text });
  });

  it("w tym samym materiale nadal przyjmuje odmianę słów treści", () => {
    for (const text of ["hats", "coats", "rains", "wears", "I'm wearing T-shirts", "They're wearing coats"]) {
      expect(checkElement(text, chapter), text).toEqual({ ok: true });
    }
  });

  it("posiłkowe z rozwinięć skrótów (has, have, will…) nie są słowem treści", () => {
    // Bez skrótów 's w materiale „It's” nie jest „słowem spoza materiału: has”.
    expect(checkElement("It's", materialLexicon("coat, hat"))).toEqual({ ok: false, unknown: "it's", noContentWord: true });
    // Ze skrótami 's w materiale opcja „He's” nie dostaje słowa treści „has”.
    expect(checkElement("He's", chapter)).toEqual({ ok: false, unknown: "he's", noContentWord: true });
    expect(checkElement("It's sunny", materialLexicon("sunny"))).toEqual({ ok: true });
    expect(checkElement("I've got a hat", chapter)).toEqual({ ok: false, unknown: "got" });
  });
});

describe("FUNCTION_WORDS", () => {
  it("to stała lista około 60 słów funkcyjnych bez słownictwa treści", () => {
    expect(FUNCTION_WORDS.size).toBeGreaterThanOrEqual(55);
    expect(FUNCTION_WORDS.size).toBeLessThanOrEqual(80);
    for (const word of ["i", "my", "the", "an", "am", "were", "doesn't", "can't", "i'm", "what's", "and", "those", "with", "how", "today", "very"]) {
      expect(FUNCTION_WORDS.has(word), word).toBe(true);
    }
    // Rozwinięcia skrótów normalizatora (can't → cannot, it's → it has, I'll → I will…).
    for (const word of ["cannot", "has", "have", "had", "will", "would", "did"]) {
      expect(FUNCTION_WORDS.has(word), word).toBe(true);
    }
    for (const word of ["coat", "rain", "monday", "wear"]) {
      expect(FUNCTION_WORDS.has(word), word).toBe(false);
    }
    // Słowa zapisane w postaci znormalizowanej (małe litery, zwykły apostrof).
    expect([...FUNCTION_WORDS].every((word) => word === word.toLowerCase() && !word.includes("’"))).toBe(true);
  });
});
