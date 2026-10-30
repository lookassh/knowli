import type { AnswerNormalizer } from "../../types";
import { baseNormalizer } from "../../normalize";
import { CONTRACTIONS } from "./contractions";

/**
 * Normalizator przedmiotu `english_grammar` (design „Normalizacja”). Dekoruje
 * `baseNormalizer` (kompozycja, nie kopia): bierze jego sekwencję tokenów, a
 * potem rozwija skróty angielskie z zamkniętej tabeli `contractions.ts`.
 *
 * Skrót jednoznaczny podmienia token na swoje rozwinięcie. Skrót wieloznaczny
 * (`he's`, `I'd`, `can't`) tworzy iloczyn kartezjański wariantów sekwencji —
 * dziecko mogło mieć na myśli każde rozwinięcie, więc wszystkie są równoważne.
 *
 * Wynik jest deterministyczny i bez duplikatów. Przy wielu skrótach
 * wieloznacznych liczba kombinacji rośnie wykładniczo, więc ograniczamy ją do
 * `MAX_NORMALIZER_VARIANTS` — po przekroczeniu bierzemy pierwsze warianty w
 * deterministycznej kolejności zamiast wysadzać pamięć/czas (ocena i tak
 * potrzebuje tylko jednego trafienia, a przycięcie zostawia najczęstsze
 * rozwinięcia na początku).
 */

/**
 * Limit liczby wariantów sekwencji zwracanych przez normalizator. 32 = 2^5:
 * pokrywa do pięciu niezależnych skrótów dwuznacznych w jednym zdaniu, co z
 * zapasem wystarcza dla zdań 8-latka, a jednocześnie twardo odcina wybuch
 * kombinatoryczny (6 skrótów = 64 kombinacje). Przycięcie jest deterministyczne.
 */
export const MAX_NORMALIZER_VARIANTS = 32;

/** Rozwinięcia tokenu: tabela skrótów albo on sam (jako jednoelementowa sekwencja). */
function expansionsFor(token: string): readonly (readonly string[])[] {
  const mapped = CONTRACTIONS[token];
  return mapped ?? [[token]];
}

/**
 * Buduje warianty sekwencji przez iloczyn kartezjański rozwinięć kolejnych
 * tokenów, z twardym limitem liczby wariantów. Kolejność jest deterministyczna:
 * warianty tokenu w kolejności z tabeli, nowe tokeny doklejane na końcu.
 */
function expandSequence(tokens: readonly string[]): string[][] {
  let variants: string[][] = [[]];
  for (const token of tokens) {
    const options = expansionsFor(token);
    const next: string[][] = [];
    for (const variant of variants) {
      for (const option of options) {
        next.push([...variant, ...option]);
        if (next.length >= MAX_NORMALIZER_VARIANTS) {
          break;
        }
      }
      if (next.length >= MAX_NORMALIZER_VARIANTS) {
        break;
      }
    }
    variants = next;
  }
  return variants;
}

/** Usuwa duplikaty sekwencji zachowując pierwszą kolejność wystąpienia. */
function dedupeSequences(sequences: readonly string[][]): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const sequence of sequences) {
    const key = sequence.join("\u0000");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(sequence);
    }
  }
  return result;
}

export const englishNormalizer: AnswerNormalizer = {
  normalize(text: string): string[][] {
    // Dekorator: najpierw bazowa tokenizacja (jedna sekwencja), potem rozwinięcie.
    const base = baseNormalizer.normalize(text);
    const expanded = base.flatMap((tokens) => expandSequence(tokens));
    const deduped = dedupeSequences(expanded);
    // Twardy limit także po deduplikacji (iloczyn z wielu sekwencji bazowych).
    return deduped.slice(0, MAX_NORMALIZER_VARIANTS);
  },
};
