import { describe, expect, it } from "vitest";
import { renderCard } from "./card";

/**
 * `renderCard` (design „Typy ćwiczeń i etapy” — karta): czysta funkcja domeny
 * składająca publiczną treść karty `{ title, body, examples }` z karty tematu
 * i przykładów lekcji. `{{examples}}` w treści karty jest usuwane (przykłady
 * trafiają do osobnego pola `examples`), reszta tekstu zostaje niezmieniona.
 */
describe("renderCard", () => {
  it("usuwa placeholder {{examples}} i wystawia przykłady osobno", () => {
    const card = renderCard(
      { title: "Przykłady z lekcji", body: "Popatrz: {{examples}}" },
      ["He plays football.", "She works."],
    );
    expect(card).toEqual({
      title: "Przykłady z lekcji",
      body: "Popatrz:",
      examples: ["He plays football.", "She works."],
    });
  });

  it("karta bez placeholdera zachowuje treść i dostaje puste przykłady", () => {
    const card = renderCard({ title: "Dodaj -s", body: "Przy he, she, it dodajemy -s." }, []);
    expect(card).toEqual({
      title: "Dodaj -s",
      body: "Przy he, she, it dodajemy -s.",
      examples: [],
    });
  });

  it("placeholder w środku zdania zwija nadmiarowe spacje", () => {
    const card = renderCard({ title: "T", body: "A {{examples}} B" }, ["x"]);
    expect(card.body).toBe("A B");
    expect(card.examples).toEqual(["x"]);
  });

  it("przykłady są przycinane i puste odrzucane", () => {
    const card = renderCard({ title: "T", body: "B {{examples}}" }, ["  he plays  ", "", "   "]);
    expect(card.examples).toEqual(["he plays"]);
  });
});
