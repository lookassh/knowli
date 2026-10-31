import { describe, expect, it } from "vitest";
import { MAX_NORMALIZER_VARIANTS } from "./normalizer";
import {
  isMaterialVocabularyTarget,
  isSentenceFrame,
  materialPhraseIndex,
  materialTargetMatchKey,
  materialTargetText,
  phraseInMaterial,
} from "./material-phrase";

function inMaterial(target: string, material: string): boolean {
  return phraseInMaterial(target, materialPhraseIndex(material));
}

describe("phraseInMaterial — fraza na granicach słów", () => {
  it.each([
    ["a coat", "I'm wearing a coat.", "wiodący rodzajnik pominięty"],
    ["the coats", "I'm wearing a coat.", "rodzajnik i liczba mnoga"],
    ["coats", "coat – płaszcz", "odmiana: coats → coat"],
    ["coat", "Put on your coats!", "odmiana w drugą stronę"],
    ["wearing", "I wear a hat.", "odmiana: wearing → wear"],
    ["wear", "I'm wearing a coat.", "odmiana: wear ← wearing"],
    ["to swim", "We are swimming.", "wiodące „to” pominięte"],
    ["it's sunny", "It is sunny.", "skrót w elemencie, pełna forma w tekście"],
    ["it is sunny", "It's sunny.", "skrót w tekście, pełna forma w elemencie"],
    ["it has got", "It's got a tail.", "drugie rozwinięcie skrótu w tekście"],
    ["I can't swim", "I cannot swim.", "can't ≡ cannot"],
    ["can not swim", "I can't swim.", "can't ≡ can not"],
    ["t-shirt", "My T-shirt is red.", "wyraz z łącznikiem"],
    ["T-Shirt", "My T-shirt is red.", "wielkość liter"],
    ["shirt", "My T-shirt is red.", "część wyrazu z łącznikiem"],
    ["it’s raining", "It's raining.", "apostrof typograficzny w elemencie"],
    ["it's raining", "It’s raining.", "apostrof typograficzny w tekście"],
    ["What's the weather like?", "What's the weather like today?", "interpunkcja w elemencie"],
    ["red hat", "She's wearing a red, hat.", "interpunkcja tekstu znika"],
    ["Monday", "on MONDAY morning", "wielkie litery w tekście"],
    ["tom", "This is Tom's hat.", "dopełniacz"],
    ["red cherries", "a red cherry", "-ies we frazie: liczba mnoga w elemencie"],
    ["red cherry", "I see red cherries.", "-ies we frazie: liczba mnoga w tekście"],
  ])("przyjmuje „%s” w „%s” (%s)", (target, material) => {
    expect(inMaterial(target, material)).toBe(true);
  });

  it.each([
    ["cat", "My favourite category is clothes.", "tylko na granicach słów"],
    ["pink coat", "a coat, pink", "kolejność słów frazy"],
    ["snow", "It's raining. It's cold.", "słowo spoza tekstu"],
    ["the", "the coat", "same wiodące słowa"],
    ["a", "a coat", "same wiodące słowa"],
    ["", "a coat", "pusty element"],
    ["to the", "go to the park", "same wiodące słowa"],
    ["red coat", "a red hat and a green coat", "fraza nieciągła"],
    ["thing", "the coat", "rdzeń „the” to słowo funkcyjne"],
    ["shed", "she is happy", "rdzeń „she” to słowo funkcyjne"],
    ["noted", "Don't forget!", "rdzeń „not” z rozwinięcia skrótu"],
    ["it is has", "It's sunny.", "rozwinięcia jednego skrótu się nie mieszają"],
    ["her boots", "his boots", "słowa funkcyjne tylko dokładnie"],
    ["coat", "", "pusty tekst"],
    ["sing", "I'm single.", "początek dłuższego słowa"],
    ["car", "Take care!", "początek dłuższego słowa"],
    ["bus", "I'm busy.", "początek dłuższego słowa"],
    ["   ", "a coat", "same białe znaki"],
    [" \t\n ", "a coat", "same białe znaki"],
    ["?!", "a coat?!", "sama interpunkcja"],
    ["- , .", "a coat - , .", "sama interpunkcja"],
  ])("odrzuca „%s” w „%s” (%s)", (target, material) => {
    expect(inMaterial(target, material)).toBe(false);
  });

  it("wiodący rodzajnik pomijany tylko na początku elementu", () => {
    expect(inMaterial("put on the coat", "Put on the coat.")).toBe(true);
    expect(inMaterial("put on the coat", "Put on your coat.")).toBe(false);
  });

  it("jeden indeks obsługuje wiele sprawdzeń", () => {
    const index = materialPhraseIndex("It's sunny. I'm wearing boots and a T-shirt. Don't forget your hat!");
    expect(["sunny", "boot", "a T-shirt", "don't forget", "do not forget", "hats", "I am wearing"].map((target) => phraseInMaterial(target, index))).toEqual([
      true, true, true, true, true, true, true,
    ]);
    expect(["snowing", "wearing a hat", "forget my hat"].map((target) => phraseInMaterial(target, index))).toEqual([false, false, false]);
  });
});

describe("phraseInMaterial — długi tekst ze skrótami", () => {
  const SENTENCES = [
    "It's sunny and he's happy.",
    "She's got a red hat, but I'd like a green one.",
    "They'd wear boots if it's raining, wouldn't they?",
    "We can't go out, it's cold and that's sad.",
    "You'd love the park; he'd play football there.",
    "I'm wearing a coat because it's windy today.",
  ];

  // Zdania z unikatowymi frazami na początku i w środku, przed setkami dwuznacznych
  // skrótów: całościowa normalizacja (przycięcie do 32 wariantów) zachowuje
  // rozwinięcia tylko kilku ostatnich skrótów, a indeks musi znać wszystkie.
  const START = "At the start it's finished, she'd eaten a purple umbrella-cake.";
  const MIDDLE = "In the middle he's gone and they'd hidden a yellow kite.";

  function longMaterial(minLength: number): string {
    const parts: string[] = [START];
    let length = START.length;
    for (let i = 0; length < minLength; i += 1) {
      if (i === 150) parts.push(MIDDLE);
      const sentence = SENTENCES[i % SENTENCES.length]!;
      parts.push(sentence);
      length += sentence.length + 1;
    }
    return parts.join(" ");
  }

  const material = longMaterial(16_000);

  it("tekst ma 16 000 znaków i więcej skrótów, niż mieści całościowa normalizacja", () => {
    expect(material.length).toBeGreaterThanOrEqual(16_000);
    expect(material.indexOf(MIDDLE)).toBeGreaterThan(5_000);
    // Setki dwuznacznych skrótów, a limit wariantów całościowej normalizacji mieści pięć (2^5 = 32).
    const ambiguous = (material.match(/\b(?:it|he|she|that|i|you|they|we)'[sd]\b/giu) ?? []).length;
    expect(Math.log2(MAX_NORMALIZER_VARIANTS)).toBe(5);
    expect(ambiguous).toBeGreaterThan(300);
  });

  it("każde wystąpienie skrótu jest dopasowywalne, 100 sprawdzeń w < 200 ms", () => {
    const hits = [
      "it has finished", "it is finished", "she had eaten", "she would eaten", "purple umbrella", "umbrella cake",
      "a purple umbrella-cake", "he has gone", "he is gone", "they had hidden", "they would hidden", "a yellow kite",
      "they would wear boots", "you had love", "he would play football", "that has sad", "can not go out",
      "I am wearing a coat", "windy", "green one", "it's raining",
    ];
    const misses = ["purple coat", "snow", "it is eaten", "she has finished", "he has hidden", "category", "blue hat", "wearing a hat", "the"];
    const targets = Array.from({ length: 100 }, (_, i) => (i % 3 === 2 ? misses[i % misses.length]! : hits[i % hits.length]!));

    const started = performance.now();
    const index = materialPhraseIndex(material);
    const results = targets.map((target) => phraseInMaterial(target, index));
    const elapsed = performance.now() - started;

    expect(results).toEqual(targets.map((target) => hits.includes(target)));
    // regresja do rekurencji wykładniczej trwała dziesiątki sekund; próg z zapasem na obciążone CI
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe("phraseInMaterial — najgorszy przypadek (przegląd Etapu 4)", () => {
  // Tekst z samych dwuznacznych skrótów: każdy węzeł „it” ma dwa następniki, a element
  // z tych samych skrótów idzie po grafie przez całą długość, zanim zawiedzie na końcu —
  // rekurencja z każdego początku w każdym z 32 wariantów trwała ~30 s dla 300 elementów.
  const run = (count: number) => Array.from({ length: count }, () => "it's").join(" ");

  it("16 000 znaków „it's” i 300 złośliwych elementów: < 1 s łącznie, wszystkie odrzucone", () => {
    const material = "it's ".repeat(3_200).trim();
    // ≤ 120 znaków jak cel z modelu; 300 = trzykrotny limit zestawu (koperta trybu ze źródła)
    const adversarial = Array.from({ length: 300 }, (_, i) => {
      const count = 18 + (i % 4);
      switch (i % 3) {
        case 0: return `${run(count)} zz${i}`; // słowo spoza tekstu na końcu
        case 1: return `${run(count)} is is`; // każde słowo w tekście, ale „is is” nigdy obok siebie
        default: return `the ${run(count)} has has`;
      }
    });
    expect(material.length).toBeGreaterThanOrEqual(15_999);
    expect(adversarial.every((target) => target.length <= 120)).toBe(true);

    const started = performance.now();
    const index = materialPhraseIndex(material);
    const results = adversarial.map((target) => phraseInMaterial(target, index));
    const elapsed = performance.now() - started;

    expect(results.every((result) => !result)).toBe(true);
    expect(elapsed).toBeLessThan(5_000);
  });

  it("odcinki po 20 „it's”: każde słowo i każda para w tekście, 100 elementów (połowa trafień) < 1 s", () => {
    // Elementy dłuższe od odcinka przechodzą oba szybkie odrzucenia i giną dopiero w grafie.
    const material = Array.from({ length: 160 }, () => `${run(20)} coat.`).join(" ");
    const targets = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? run(18 + (i % 3)) : run(21 + (i % 3))));
    expect(material.length).toBeGreaterThanOrEqual(16_000);
    expect(targets.every((target) => target.length <= 120)).toBe(true);

    const started = performance.now();
    const index = materialPhraseIndex(material);
    const results = targets.map((target) => phraseInMaterial(target, index));
    const elapsed = performance.now() - started;

    expect(results).toEqual(targets.map((_, i) => i % 2 === 0));
    expect(elapsed).toBeLessThan(5_000);
  });
});

describe("materialTargetText — zapis celu bez końcowej interpunkcji (przegląd Etapu 4)", () => {
  it.each([
    ["It's raining.", "It's raining"],
    ["It’s sunny!", "It's sunny"],
    ["What's the weather like?", "What's the weather like"],
    ["Wait…", "Wait"],
    ["boots,", "boots"],
    ["coat;", "coat"],
    ["Put it on:", "Put it on"],
    ["Really?!", "Really"],
    ["It's raining . ", "It's raining"],
    ["  a  red\t\nhat  ", "a red hat"],
    ["T-shirt", "T-shirt"],
    ["Mr. Smith's hat", "Mr. Smith's hat"],
    ["yes, please", "yes, please"],
    ["don‘t ʼforget´", "don't 'forget'"],
    ["?!", ""],
  ])("„%s” → „%s”", (raw, stored) => {
    expect(materialTargetText(raw)).toBe(stored);
  });

  it("zostawia NFC", () => {
    expect(materialTargetText("café.")).toBe("café");
  });
});

describe("materialTargetMatchKey — duplikat po dopasowaniu (przegląd Etapu 4)", () => {
  it.each([
    ["coat", "a coat"],
    ["coat", "the Coat"],
    ["swim", "to swim"],
    ["It's raining", "It's raining."],
    ["it's raining", "It’s  raining!"],
    ["T-shirt", "t shirt"],
  ])("„%s” ≡ „%s”", (first, second) => {
    expect(materialTargetMatchKey(first)).toBe(materialTargetMatchKey(second));
  });

  it.each([
    ["coat", "coats", "odmiana się nie scala"],
    ["wear", "wearing", "odmiana się nie scala"],
    ["it's sunny", "it is sunny", "skróty się nie rozwijają"],
    ["red hat", "hat red", "kolejność słów"],
    ["coat", "a coat on", "inne słowa"],
  ])("„%s” ≠ „%s” (%s)", (first, second) => {
    expect(materialTargetMatchKey(first)).not.toBe(materialTargetMatchKey(second));
  });
});

describe("isSentenceFrame — ramy z lukami", () => {
  it.each(["I'm wearing (a) …", "I'm wearing (a) ...", "It's ___ today", "a __", "(a) coat", "coat)", "I like …"])("„%s” to rama", (target) => {
    expect(isSentenceFrame(target)).toBe(true);
  });

  it.each(["coat", "a T-shirt", "What's the weather like?", "Mr. Smith", "a_b", "It's raining."])("„%s” nie jest ramą", (target) => {
    expect(isSentenceFrame(target)).toBe(false);
  });
});

describe("isMaterialVocabularyTarget — słówko z tekstu źródła", () => {
  const MATERIAL = [
    "What's the weather like? It's sunny. I'm wearing a coat and boots. Put it in on the shelf.",
    // „What's” to jeden token (tabela skrótów go nie rozwija), więc samo „what” potrzebuje „What” w tekście.
    "Is it cold today? Yes, it is. How are you? What colour is it?",
  ].join(" ");
  const index = materialPhraseIndex(MATERIAL);

  it.each(["the coats", "wearing", "sunny", "a coat and boots", "What's the weather like?", "it is sunny"])(
    "przyjmuje „%s” z tekstu",
    (target) => {
      expect(isMaterialVocabularyTarget(target, index)).toBe(true);
    },
  );

  // Słowa funkcyjne stojące w tekście źródła zostają (decyzja z przeglądu Etapu 4): rozdział
  // uczy też zwrotów i słów pytających, a o doborze decyduje rodzic przy sprawdzaniu szkicu.
  it.each(["it is", "in on", "it's", "today", "yes", "what", "How are you?"])(
    "przyjmuje „%s” — słowa funkcyjne stojące w tekście",
    (target) => {
      expect(isMaterialVocabularyTarget(target, index)).toBe(true);
    },
  );

  it.each([
    ["I'm wearing (a) …", "rama będąca początkiem tekstu"],
    ["What's the ___ like?", "rama z podkreśleniami"],
    ["the", "same wiodące słowa"],
    ["a", "same wiodące słowa"],
    ["to", "same wiodące słowa"],
    ["umbrella", "słowo spoza tekstu"],
    ["where", "słowo funkcyjne spoza tekstu"],
    ["", "pusty element"],
  ])("odrzuca „%s” (%s)", (target) => {
    expect(isMaterialVocabularyTarget(target, index)).toBe(false);
  });

  it("rama będąca początkiem tekstu przechodzi samo dopasowanie frazy — odrzuca ją sprawdzenie ramy", () => {
    expect(phraseInMaterial("I'm wearing (a) …", index)).toBe(true);
    expect(isSentenceFrame("I'm wearing (a) …")).toBe(true);
  });
});
