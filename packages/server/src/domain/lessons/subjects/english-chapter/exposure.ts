import { fillCloze } from "../../cloze";
import type { LessonExposureSource } from "../../types";
import { trimTrailing } from "./text";

/**
 * Tekst ekspozycji ćwiczenia rozdziału (design „Angielski — rozdział” §4.5).
 * Lekcja sprawdza użycie słowa w zdaniu, więc dziecko „widzi rozwiązane”
 * całe zdanie, a nie pojedyncze słowo: wybór i luka dają zdanie ze wstawioną
 * odpowiedzią, tekst z lukami — cały uzupełniony tekst, układanka
 * i tłumaczenie — odpowiedź, pary i grupy — złączoną odpowiedź jak dotąd.
 * Wynik jest znormalizowany `normalizeChapterExposureText`, więc „It's
 * snowing.” i „It’s snowing” to ta sama ekspozycja; małe litery dokłada
 * `computeTargetKey`.
 */

/** Luka w zdaniu: ciąg 2+ podkreśleń (ta sama reguła co `cloze.ts` i Kid UI). */
const GAP = /_{2,}/u;
/** Końcowa interpunkcja ekspozycji; białe znaki są już zredukowane do spacji. */
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set([".", "!", "?", "…", " "]);
/** Typograficzne apostrofy i pojedyncze cudzysłowy → `'`. */
const SINGLE_QUOTES = /[‘’‚‛]/gu;
/** Typograficzne cudzysłowy (także polski „) → `"`. */
const DOUBLE_QUOTES = /[“”„‟]/gu;

/**
 * Normalizacja tekstu ekspozycji przedmiotu (`SubjectModule.normalizeExposureText`):
 * NFC, prosty apostrof i cudzysłów zamiast typograficznych, jedna spacja
 * zamiast białych znaków, bez zewnętrznych spacji i bez końcowej interpunkcji
 * `.!?…`. Ta sama funkcja obsługuje ćwiczenia (`chapterExposureText`) i
 * przykłady kart, więc przykład „I’m wearing a pink coat.” i luka rozwiązana
 * do „I'm wearing a pink coat” mają jeden klucz. Idempotentna. Kontrakt
 * utrwalony w `target_key` — zmiana wymaga decyzji o migracji kluczy.
 */
export function normalizeChapterExposureText(text: string): string {
  const collapsed = text
    .normalize("NFC")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/\s+/gu, " ")
    .trim();
  return trimTrailing(collapsed, TRAILING_PUNCTUATION);
}

/** Zdanie ze wstawionym słowem w miejscu luki; zdanie bez luki daje samo słowo. */
function fillStem(stem: string | undefined, word: string): string {
  return stem !== undefined && GAP.test(stem) ? stem.replace(GAP, () => word) : word;
}

/** Tekst poprawnej opcji wyboru; bez niej — odpowiedź kanoniczna. */
function correctOptionText(draft: LessonExposureSource): string {
  return draft.options?.find((option) => option.id === draft.correctOption)?.text ?? draft.answer;
}

export function chapterExposureText(draft: LessonExposureSource): string {
  switch (draft.exerciseType) {
    case "lesson_choice":
    case "lesson_listen_choice":
      return normalizeChapterExposureText(fillStem(draft.stem, correctOptionText(draft)));
    case "lesson_gap":
      return normalizeChapterExposureText(fillStem(draft.stem, draft.answer));
    case "lesson_cloze":
      return normalizeChapterExposureText(draft.clozeText === undefined ? draft.answer : fillCloze(draft.clozeText, draft.gapAnswers ?? []));
    default:
      return normalizeChapterExposureText(draft.answer);
  }
}

/** Podział linii karty na części: „ — ” i „ / ” (słówko — tłumaczenie / przykład). */
const CARD_PART_SEPARATOR = /\s+[—/]\s+/u;
/** Zdanie angielskie: litery ASCII, apostrof, spacje i interpunkcja zdania. */
const CARD_SENTENCE = /^[A-Za-z][A-Za-z' ,.?!]*$/u;

/**
 * Teksty z treści kart rozdziału, które dziecko widzi jako gotowe rozwiązania
 * (`SubjectModule.cardExposureTexts`): zdania angielskie z przykładów kart.
 * Linie dzielą się na części po „ — ” i „ / ”, a część zostaje, gdy jest
 * zdaniem: bez wielokropka (rama do uzupełnienia), złożona z liter ASCII,
 * apostrofu, spacji i interpunkcji zdania (polska część odpada na znakach
 * diakrytycznych, cudzysłów typograficzny też) oraz zakończona `.?!` albo
 * licząca ≥ 3 słowa (samo słówko nie jest zdaniem). Świadomy koszt: polskie
 * zdanie bez znaków diakrytycznych przechodzi. Apostrof typograficzny → `'`,
 * duplikaty usunięte. Używane tylko przy generowaniu.
 */
export function chapterCardExposureTexts(cards: readonly { readonly body: string }[]): string[] {
  const sentences: string[] = [];
  for (const card of cards) {
    for (const rawLine of card.body.split(/\r?\n/u)) {
      for (const part of rawLine.split(CARD_PART_SEPARATOR)) {
        const text = part.trim().replace(/[’‘]/gu, "'");
        if (text === "" || /…|\.\.\./u.test(text) || !CARD_SENTENCE.test(text)) continue;
        if (/[.?!]$/u.test(text) || text.split(/\s+/u).length >= 3) sentences.push(text);
      }
    }
  }
  return [...new Set(sentences)];
}
