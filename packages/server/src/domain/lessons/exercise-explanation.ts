/**
 * Wyjaśnienie błędu dla dziecka (`explanationPl`, spec 2026-11-01-lesson-error-explanation):
 * jedno zdanie po polsku, które dziecko widzi po błędnej odpowiedzi w treningu. Czysta domena —
 * bez bazy, sieci i zegara.
 */

import { sentenceCount } from "../tts-style";
import { normalizeTargetText } from "../target-key";
import type { SubjectModule } from "./types";

/**
 * Maksymalna długość wyjaśnienia (znaki) — jak pozostałe pola tekstowe ćwiczenia
 * (`MAX_TEXT_LENGTH` w `pool-validation.ts`, tu osobno, by uniknąć cyklu importów).
 */
export const MAX_EXPLANATION_LENGTH = 120;

/**
 * Błędy treści wyjaśnienia (pusta lista = poprawne). Tekst jest zwykły i czytany głosem:
 * po przycięciu niepusty, ≤ 120 znaków, bez łamania wiersza i znaczników `*`/`_`, dokładnie
 * jedno zdanie. Komunikaty (po polsku, dla rodzica) mają prefiks `explanationPl:`.
 */
export function explanationTextErrors(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return ["explanationPl: wyjaśnienie nie może być puste"];
  const errors: string[] = [];
  if ([...trimmed].length > MAX_EXPLANATION_LENGTH) {
    errors.push(`explanationPl: przekracza ${MAX_EXPLANATION_LENGTH} znaków`);
  }
  if (/[\r\n]/u.test(trimmed)) {
    errors.push("explanationPl: wyjaśnienie nie może zawierać łamania wiersza");
  }
  if (/[*_]/u.test(trimmed)) {
    errors.push("explanationPl: zwykły tekst bez znaczników (* i _)");
  }
  if (sentenceCount(trimmed) !== 1) {
    errors.push("explanationPl: wyjaśnienie ma mieć dokładnie jedno zdanie");
  }
  return errors;
}

/** Tekst ekspozycji i klucz `target_key` ćwiczenia, jak w `exposure-key.ts`. */
export interface ExposureTarget {
  readonly exposureText: string;
  readonly targetKey: string;
}

/** Normalizacja przedmiotu (gdy ją ma), potem jak w `computeTargetKey`: NFC, przycięcie, małe litery. */
function normalizedExposure(
  subject: Pick<SubjectModule, "normalizeExposureText">,
  text: string,
): string {
  return normalizeTargetText(subject.normalizeExposureText?.(text) ?? text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Tekst na granicach słów: litera lub cyfra tuż obok wyklucza trafienie. */
function wordBounded(text: string, flags: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(text)}(?![\\p{L}\\p{N}])`, flags);
}

/**
 * Klucze `target_key` innych ćwiczeń tej samej wersji lekcji, których tekst ekspozycji
 * występuje w wyjaśnieniu (spec §4.4): wyjaśnienie, które cytuje cudzą odpowiedź, ujawnia ją
 * dziecku, więc musi zostać zapisane jako ekspozycja. Obie strony przechodzą normalizację
 * ekspozycji przedmiotu i `normalizeTargetText`; z wyjaśnienia usuwamy wcześniej własny tekst
 * ćwiczenia (jego ujawnia sam feedback), a dopasowanie wymaga granic słów. Własny klucz jest
 * pomijany. Wynik bez duplikatów, w kolejności `others`. Fałszywe trafienie kosztuje najwyżej
 * dodatkową ekspozycję — nic nie jest blokowane.
 */
export function explanationExposureKeys(
  explanation: string,
  own: ExposureTarget,
  others: readonly ExposureTarget[],
  subject: Pick<SubjectModule, "normalizeExposureText">,
): string[] {
  let remaining = normalizedExposure(subject, explanation);
  const ownText = normalizedExposure(subject, own.exposureText);
  if (ownText !== "") remaining = remaining.replace(wordBounded(ownText, "gu"), " ");
  const keys: string[] = [];
  for (const other of others) {
    if (other.targetKey === own.targetKey || keys.includes(other.targetKey)) continue;
    const text = normalizedExposure(subject, other.exposureText);
    if (text !== "" && wordBounded(text, "u").test(remaining)) keys.push(other.targetKey);
  }
  return keys;
}
