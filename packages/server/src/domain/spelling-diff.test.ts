import { describe, expect, it } from "vitest";
import { compareSpelling } from "./spelling-diff";
import type { AnswerKey } from "./types";

function key(target: string, acceptedAnswers: readonly string[] = []): AnswerKey {
  return { exerciseType: "spelling", target, acceptedAnswers };
}

describe("compareSpelling — porównanie zapisu z zatwierdzonym wariantem (issue #9)", () => {
  it("brakująca litera: pigułka na brakującym fragmencie wzorca", () => {
    const result = compareSpelling("Wenesday", key("Wednesday"))!;
    expect(result.variant).toBe("Wednesday");
    expect(result.distance).toBe(1);
    expect(result.withinThreshold).toBe(true);
    expect(result.given).toEqual([{ text: "Wenesday", state: "plain" }]);
    expect(result.expected).toEqual([
      { text: "We", state: "plain" },
      { text: "d", state: "pill" },
      { text: "nesday", state: "plain" },
    ]);
    expect(result.capitalizationHint).toBe(false);
  });

  it("nadmiarowa litera: pigułka na nadmiarowym fragmencie wpisu", () => {
    const result = compareSpelling("Wedneseday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.given).toEqual([
      { text: "Wednes", state: "plain" },
      { text: "e", state: "pill" },
      { text: "day", state: "plain" },
    ]);
    expect(result.expected).toEqual([{ text: "Wednesday", state: "plain" }]);
  });

  it("zamieniona litera: pigułki w obu wierszach", () => {
    const result = compareSpelling("Widnesday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.given).toEqual([
      { text: "W", state: "plain" },
      { text: "i", state: "pill" },
      { text: "dnesday", state: "plain" },
    ]);
    expect(result.expected).toEqual([
      { text: "W", state: "plain" },
      { text: "e", state: "pill" },
      { text: "dnesday", state: "plain" },
    ]);
  });

  it("przestawiona para sąsiednich liter liczy się jako jedna operacja", () => {
    const result = compareSpelling("Wendesday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.given).toEqual([
      { text: "We", state: "plain" },
      { text: "nd", state: "pill" },
      { text: "esday", state: "plain" },
    ]);
    expect(result.expected).toEqual([
      { text: "We", state: "plain" },
      { text: "dn", state: "pill" },
      { text: "esday", state: "plain" },
    ]);
  });

  it("wielkość liter nie liczy się do odległości, ale ustawia wskazówkę", () => {
    const result = compareSpelling("wendsday", key("Wednesday"))!;
    // brakujące „e” + przestawienie „nd”/„dn” = 2 operacje liter (wciąż w progu)
    expect(result.distance).toBe(2);
    expect(result.capitalizationHint).toBe(true);
  });

  it("próg: maksymalnie 2 operacje dla długich słów, 1 dla krótkich", () => {
    expect(compareSpelling("Wednsdya", key("Wednesday"))!.withinThreshold).toBe(true); // 2 przestawienia
    expect(compareSpelling("Wdnsdy", key("Wednesday"))!.withinThreshold).toBe(false); // 3 operacje
    expect(compareSpelling("cta", key("cat"))!.withinThreshold).toBe(true); // 1 (słowo ≤4 znaki)
    expect(compareSpelling("abt", key("cat"))!.withinThreshold).toBe(false); // 2 (słowo ≤4 znaki)
  });

  it("wybiera najbliższy wariant; remis rozstrzyga kanoniczny target", () => {
    const result = compareSpelling("colour", key("color", ["colour", "colourful"]))!;
    expect(result.variant).toBe("colour");
    expect(result.distance).toBe(0);
    const tie = compareSpelling("abc", key("abd", ["abe"]))!;
    expect(tie.variant).toBe("abd"); // target pierwszy wśród kandydatów
  });

  it("pusta odpowiedź i sam odstęp dają null", () => {
    expect(compareSpelling("", key("Wednesday"))).toBeNull();
    expect(compareSpelling("   ", key("Wednesday"))).toBeNull();
  });

  it("litera zmieniająca długość przy toLowerCase (İ) wyłącza diagnozę zamiast produkować śmieciowe segmenty", () => {
    // „İ”.toLowerCase() ma dwa punkty kodowe — indeksy alignmentu rozeszłyby się z oryginałem
    expect(compareSpelling("İaturday", key("Saturday"))).toBeNull();
    expect(compareSpelling("Saturday", key("İaturday"))).toBeNull();
  });

  it("brakujące litery (niedokończone lub urwane słowo): akceptuje sensowny fragment bez błędnych liter", () => {
    // Mon dla Monday (brak końcówki "day", 3 litery brakujące, ale wpisano 50% poprawnego słowa)
    const mon = compareSpelling("Mon", key("Monday"))!;
    expect(mon.withinThreshold).toBe(true);
    expect(mon.given).toEqual([{ text: "Mon", state: "plain" }]);
    expect(mon.expected).toEqual([
      { text: "Mon", state: "plain" },
      { text: "day", state: "pill" },
    ]);

    // day dla Monday (brak początku "Mon", wpisano 50% poprawnego słowa)
    const day = compareSpelling("day", key("Monday"))!;
    expect(day.withinThreshold).toBe(true);
    expect(day.given).toEqual([{ text: "day", state: "plain" }]);
    expect(day.expected).toEqual([
      { text: "Mon", state: "pill" },
      { text: "day", state: "plain" },
    ]);

    // Wednes dla Wednesday (brak "day", wpisano 6 z 9 liter)
    const wednes = compareSpelling("Wednes", key("Wednesday"))!;
    expect(wednes.withinThreshold).toBe(true);
    expect(wednes.given).toEqual([{ text: "Wednes", state: "plain" }]);
    expect(wednes.expected).toEqual([
      { text: "Wednes", state: "plain" },
      { text: "day", state: "pill" },
    ]);

    // ca dla cat (2 z 3 liter)
    const ca = compareSpelling("ca", key("cat"))!;
    expect(ca.withinThreshold).toBe(true);

    // mon dla Monday pisane małą literą: wielkość liter nie blokuje brakujących liter
    const monLower = compareSpelling("mon", key("Monday"))!;
    expect(monLower.withinThreshold).toBe(true);
    expect(monLower.capitalizationHint).toBe(true);
    expect(monLower.expected).toEqual([
      { text: "Mon", state: "plain" },
      { text: "day", state: "pill" },
    ]);

    // Fragment z literówką nie jest czystym urwanym słowem:
    // "Mun" dla "Monday" (zamiana o->u i brak day = 4 operacje)
    expect(compareSpelling("Mun", key("Monday"))!.withinThreshold).toBe(false);

    // Zbyt krótki fragment nie kwalifikuje się:
    // samo "M" dla "Monday" (1 litera)
    expect(compareSpelling("M", key("Monday"))!.withinThreshold).toBe(false);
    // samo "c" dla "cat" (1 litera)
    expect(compareSpelling("c", key("cat"))!.withinThreshold).toBe(false);
    // samo "We" dla "Wednesday" (2 litery na 9-literowe słowo, < 3 i < 50%)
    expect(compareSpelling("We", key("Wednesday"))!.withinThreshold).toBe(false);
  });

  it("brakujące litery w środku: dziura w środku i wpisany środek słowa też kwalifikują się do diagnozy", () => {
    // dnes dla Wednesday: dziecko wpisało środek słowa, brakuje obu końców
    // (4 z 9 liter ≥ 3, brak błędnych liter)
    const dnes = compareSpelling("dnes", key("Wednesday"))!;
    expect(dnes.withinThreshold).toBe(true);
    expect(dnes.given).toEqual([{ text: "dnes", state: "plain" }]);
    expect(dnes.expected).toEqual([
      { text: "We", state: "pill" },
      { text: "dnes", state: "plain" },
      { text: "day", state: "pill" },
    ]);

    // Wenesday dla Wednesday: brakująca litera w środku bez błędnych liter
    const wenesday = compareSpelling("Wenesday", key("Wednesday"))!;
    expect(wenesday.withinThreshold).toBe(true);
    expect(wenesday.expected).toEqual([
      { text: "We", state: "plain" },
      { text: "d", state: "pill" },
      { text: "nesday", state: "plain" },
    ]);

    // Dwie dziury w środku (Weay) i braki rozproszone (Wdnsdy) pozostają poza diagnozą
    expect(compareSpelling("Weay", key("Wednesday"))!.withinThreshold).toBe(false);
    expect(compareSpelling("Wdnsdy", key("Wednesday"))!.withinThreshold).toBe(false);
  });
});
