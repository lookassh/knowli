/**
 * Składanie publicznej treści karty lekcji (design „Typy ćwiczeń i etapy” —
 * karta). Czysta, deterministyczna funkcja: żadnej bazy, SDK ani zegara.
 *
 * Karta tematu (`LearningObjective.cards[i]`) ma `{{examples}}` w miejscu, gdzie
 * powinny trafić przykłady z materiału lekcji (`lesson_context.examples`).
 * Przykłady są jednak osobnym polem kontraktu (`CardPrompt.examples`), żeby
 * widok dziecka mógł je wyróżnić i ewentualnie odtworzyć audio — dlatego treść
 * karty traci placeholder, a przykłady wychodzą obok. Nadmiarowe spacje po
 * usunięciu placeholdera są zwijane; przykłady przycinane, puste odrzucane.
 */

/** Karta tematu — podzbiór `LearningObjective.cards[i]` czytany przez render. */
export interface CardSource {
  readonly title: string;
  readonly body: string;
}

/** Publiczna treść karty dla dziecka (odpowiednik gałęzi `lesson_card`). */
export interface RenderedCard {
  readonly title: string;
  readonly body: string;
  readonly examples: string[];
}

const EXAMPLES_PLACEHOLDER = "{{examples}}";

export function renderCard(card: CardSource, examples: readonly string[]): RenderedCard {
  const body = card.body
    .split(EXAMPLES_PLACEHOLDER)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: card.title,
    body,
    examples: examples.map((example) => example.trim()).filter((example) => example !== ""),
  };
}
