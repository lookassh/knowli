# Wyświetlanie liczb jako cyfr zamiast ilustracji z jabłkami — Design

## Kontekst i cel
W aplikacji Umiem! zestawy słownictwa obrazkowego (`vocabularyFormat: "picture"`) dla małych dzieci umożliwiają naukę liczb (np. od 0 do 20).
Dotychczasowy renderer liczb (`NumberVisual`) rysował określoną liczbę jabłek (np. 2 jabłka dla liczby 2). Dodatkowo obsługa liczb była ograniczona do zakresu 1–50, co wykluczało reprezentację liczby 0 jako wizualizacji liczbowej i zmuszało do traktowania zera jako ilustracji z generatora obrazów.

Cel:
1. Zastąpić wizualizację jabłek czytelną cyfrą/liczbą (numerałem) we wszystkich widokach interfejsu dziecka (ekspozycja, powtórka, mowa, kafelki wyboru odsłuchu, okładka zestawu).
2. Rozszerzyć dopuszczalny zakres liczb w kontraktach, walidacji i promptach na 0–50, w pełni obsługując liczbę 0 (`"zero"`, count: 0).

## Decyzje projektowe

1. **Prezentacja liczb w Kid UI**:
   - `NumberVisual` renderuje element SVG z klasami `kid-visual kid-visual-number kid-visual-number--digit`, `viewBox="0 0 160 120"`, `role="img"`, zachowując polską etykietę dostępności `aria-label`.
   - Wewnątrz SVG renderowany jest element `<text x="80" y="84" textAnchor="middle" fontSize="88" fontWeight="800" fill="currentColor">{count}</text>`.
   - Kod kalkulacji układu i rysowania jabłek zostaje całkowicie usunięty.
   - Komponent zachowuje opcjonalny parametr `display?: "apples" | "digit"` dla pełnej kompatybilności wstecznej (działający jako no-op, zawsze wyświetlający cyfrę).

2. **Kontrakty i walidacja**:
   - `NumberVisualDataSchema` w `packages/contracts/src/decks.ts`: zmiana z `min(1)` na `min(0)` (zakres 0–50).
   - `MeaningVisualSchema` w `packages/contracts/src/kid.ts`: wariant `number` z `count: z.number().int().min(0).max(50)`.
   - `ENGLISH_NUMBER_VALUES`: dodanie klucza `"zero": 0`.
   - `knownEnglishNumber`: dopuszczenie wartości numerycznych `>= 0` oraz bezpieczna obsługa `exact !== undefined` (ponieważ `0 !== undefined` jest prawdziwe).
   - `Visual.tsx`: `countValue` dopuszcza `count >= 0`.

3. **Prompty LLM**:
   - W `packages/server/src/providers/openai/llm.ts`: aktualizacja instrukcji dla liczb na `{count: integer 0-50}`.

4. **Dostępność i teksty**:
   - `formatVisualCountLabel(0)` zwraca `"0 elementów"`, co jest poprawną formą w języku polskim.
