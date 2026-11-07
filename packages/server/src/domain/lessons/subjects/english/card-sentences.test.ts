import { describe, expect, it } from "vitest";
import { englishCardSentences } from "./card-sentences";

describe("englishCardSentences — zdania z kart widoczne jako gotowe rozwiązania", () => {
  it("zdania z kropką/pytajnikiem albo ≥ 3 słowa", () => {
    expect(englishCardSentences([{ body: "There is a bed in my room.\nWhere is the lamp?" }])).toEqual([
      "There is a bed in my room.",
      "Where is the lamp?",
    ]);
  });

  it("słówka nie; części po „ — ” i „ / ” osobno; polska część odpada", () => {
    expect(englishCardSentences([{ body: "living room — salon\nbed — łóżko / I have a big bed.\nPokój — my room is big." }])).toEqual([
      "I have a big bed.",
      "my room is big.",
    ]);
  });

  it("rama z wielokropkiem i zdanie z polskimi znakami odpadają", () => {
    expect(englishCardSentences([{ body: "There's a … in the …\nTo jest mój pokój.\nIt's ... today" }])).toEqual([]);
  });

  it("części po „: ” i „; ”, kilka zdań w linii, punktory i numeracja, cudzysłowy na brzegach", () => {
    expect(englishCardSentences([{
      body: [
        "Example: It's sunny.",
        "It's very cold; I'm wearing a coat.",
        "It's raining. Where is my umbrella? I'm wet!",
        "• There is a lamp.",
        "* I like my room.",
        "1. Where is the bed?",
        "2) The bed is big.",
        "\"Where's the box?\"",
        "«I can see it.»",
        "“It's under the bed.”",
        "What's the weather like? It's ...",
      ].join("\n"),
    }])).toEqual([
      "It's sunny.",
      "It's very cold",
      "I'm wearing a coat.",
      "It's raining.",
      "Where is my umbrella?",
      "I'm wet!",
      "There is a lamp.",
      "I like my room.",
      "Where is the bed?",
      "The bed is big.",
      "Where's the box?",
      "I can see it.",
      "It's under the bed.",
      "What's the weather like?",
    ]);
  });

  it("apostrof typograficzny → ', duplikaty usunięte", () => {
    expect(englishCardSentences([{ body: "There’s a bed." }, { body: "There's a bed." }])).toEqual(["There's a bed."]);
  });

  it("świadomy koszt: polskie zdanie bez znaków diakrytycznych jest uznane za zdanie", () => {
    expect(englishCardSentences([{ body: "To jest kot." }])).toEqual(["To jest kot."]);
  });

  it("łącznik wewnątrz słowa należy do zdania („T-shirt”), samotny łącznik nie", () => {
    expect(englishCardSentences([{ body: "I'm wearing a T-shirt.\nIt's a well-known park." }])).toEqual([
      "I'm wearing a T-shirt.",
      "It's a well-known park.",
    ]);
    expect(englishCardSentences([{ body: "It is - cold." }])).toEqual([]);
  });

  it("zdania zakończone cudzysłowem zamykającym dzielą się na granicy zdania", () => {
    expect(englishCardSentences([{ body: "„There is a bed.” „I like it.”" }])).toEqual(["There is a bed.", "I like it."]);
    expect(englishCardSentences([{ body: "\"Where is it?\" \"It is here.\"" }])).toEqual(["Where is it?", "It is here."]);
  });

  it("cyfry wewnątrz zdania należą do zdania", () => {
    expect(englishCardSentences([{ body: "I have 2 cats.\nThere are 10 books in my room." }])).toEqual([
      "I have 2 cats.",
      "There are 10 books in my room.",
    ]);
  });

  it("długi ciąg spacji i cudzysłowów nie wywołuje nawrotów (czas liniowy)", () => {
    const started = performance.now();
    const result = englishCardSentences([{ body: `${" ".repeat(50_000)}x${"”".repeat(50_000)}y` }]);
    expect(performance.now() - started).toBeLessThan(500);
    expect(result).toEqual([]);
    expect(englishCardSentences([{ body: "„There is a bed.”” — „I like it.”" }])).toEqual(["There is a bed.", "I like it."]);
  });

  it("prawdziwa karta ramy (format `objectivesRules`): wzór po polsku, przykłady po etykiecie, punktor, cudzysłów", () => {
    const frameCard = {
      body: [
        "Wzór: I'm wearing (a) … — mówimy, co mamy na sobie.",
        "Na przykład: I'm wearing a red hat. I'm wearing boots.",
        "- It's sunny today.",
        "„What's the weather like?”",
        "weather — pogoda",
      ].join("\n"),
    };
    expect(englishCardSentences([frameCard])).toEqual([
      "I'm wearing a red hat.",
      "I'm wearing boots.",
      "It's sunny today.",
      "What's the weather like?",
    ]);
  });

  it("bez kropki zdaniem jest część z ≥ 3 słowami (granica: 2 słowa odpadają); linie z \\r\\n", () => {
    expect(englishCardSentences([{ body: "living room\r\nI like my bed\r\nWhere is it" }])).toEqual(["I like my bed", "Where is it"]);
  });
});
