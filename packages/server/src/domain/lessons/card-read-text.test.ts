import { describe, expect, it } from "vitest";
import { renderCard } from "./card";
import { CARD_READ_MAX_LENGTH, cardReadText, hasMathNotation } from "./card-read-text";

describe("cardReadText — tekst nagrania „Posłuchaj karty” (design szkoły §12.1)", () => {
  it("tytuł, treść i przykłady w kolejności z ekranu, bez dopowiadanych słów", () => {
    const card = renderCard(
      { title: "Fotosynteza", body: "Rośliny  wytwarzają pokarm {{examples}} dzięki światłu." },
      [" Liść jest zielony ", "", "Korzeń pobiera wodę!"],
    );
    expect(cardReadText(card)).toBe("Fotosynteza. Rośliny wytwarzają pokarm dzięki światłu. Liść jest zielony. Korzeń pobiera wodę!");
  });

  it("wypunktowanie to granica zdania; numeracja i myślniki bez zmian", () => {
    expect(cardReadText({ title: "Czego potrzebuje roślina?", body: "Roślina potrzebuje: • wody, • światła ▪ powietrza", examples: [] }))
      .toBe("Czego potrzebuje roślina? Roślina potrzebuje: wody. światła. powietrza.");
    expect(cardReadText({ title: "Etapy", body: "1. Kiełkowanie – nasiono pęcznieje. 2) Wzrost.", examples: [] }))
      .toBe("Etapy. 1. Kiełkowanie – nasiono pęcznieje. 2) Wzrost.");
  });

  it("karta z zapisem matematycznym nie ma nagrania", () => {
    for (const body of ["Połowa to 1/2 całości.", "Pole kwadratu to a².", "Woda to H₂O.", "2 · 3 to sześć.", "Wzór: v = s / t", "x=5", "Skala 1:100.", "Woda wrze w 100°C."]) {
      expect(cardReadText({ title: "Matematyka", body, examples: [] }), body).toBeNull();
    }
    expect(cardReadText({ title: "Ułamki", body: "Ułamek to część całości.", examples: ["3/4 pizzy"] })).toBeNull();
    expect(cardReadText({ title: "x² w tytule", body: "Treść.", examples: [] })).toBeNull();
  });

  it("daty, liczby, procenty i zwykła interpunkcja nie blokują nagrania", () => {
    for (const text of ["W 1410 roku odbyła się bitwa.", "25% klasy to 6 osób.", "Uwaga: to ważne.", "Godzina dziewiąta, 3 lekcje.", "Słowo „równa się” po polsku."]) {
      expect(hasMathNotation(text), text).toBe(false);
    }
  });

  it("tekst ponad limit albo pusty — brak nagrania", () => {
    expect(cardReadText({ title: "T", body: "a".repeat(CARD_READ_MAX_LENGTH), examples: [] })).toBeNull();
    expect(cardReadText({ title: " ", body: " • ", examples: [] })).toBeNull();
  });
});
