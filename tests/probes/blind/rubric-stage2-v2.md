# Rubryka ślepej oceny — etap 2 epiku #358 (przebieg bazowy kontra agent), wersja 2

Wersja 2 z 2026-11-08, po decyzji właściciela w #370 (karty katalogu gramatyki pokazują odpowiedzi
ćwiczeń pisowni). Wersja 1 (`rubric-stage2.md`, zamrożona 2026-11-07 przed pierwszym płatnym biegiem
etapu 2) zostaje bez zmian i obowiązuje dla wykonanych już biegów etapu 2; tej wersji używają
przyszłe sondy. Zmienia się wyłącznie czytanie klasy W6: forma słowa wypisana na karcie nadal jest
wadą W6, a podpowiedź z formą podstawową wadą nie jest (rozstrzygnięcia niżej). Klasy, ich typy
i mianowniki w `score.cjs` są bez zmian, więc wyniki są porównywalne poza samym czytaniem W6.
Po pierwszym płatnym biegu z tą wersją pliku nie zmieniamy; poprawka = kolejna wersja pliku
z datą i uzasadnieniem.
Spec: `docs/superpowers/specs/2026-11-07-llm-content-judgment-stage2-baseline-design.md` §7.

## Co dostaje oceniający

Tylko katalog sędziego: ten plik, `material.txt` (materiał lekcji) i `sheet.csv` (wiersze wymieszane,
bez źródła). Nie dostaje klucza źródeł, kosztów, wyników innych ocen ani informacji, który generator
napisał wiersz. Nie zgaduje źródła — ocenia treść.

## Kolumny arkusza

| Kolumna | Znaczenie |
| --- | --- |
| `rowId` | identyfikator wiersza (prefiks = temat) |
| `subject` | przedmiot (`english_grammar`) |
| `objective` | kontekst: tytuł i opis zagadnienia, karty, przykłady kart widoczne dla dziecka w tej lekcji |
| `exercise` | ćwiczenie (JSON: pola w porządku alfabetycznym; `objectiveId` = człon zagadnienia) |

Do wypełnienia: `verdict`, `criterion`, `level`, `adjudicatorNote`.

## Klasy wad

| Klasa | Wada | Dotyczy typów |
| --- | --- | --- |
| W1 | błędny klucz w zadaniu zamkniętym: opcja / słowo klucza nie jest poprawną odpowiedzią; w rozsypance (`lesson_order`) `answer` nie jest poprawną odpowiedzią na polecenie | choice, listen_choice, short_answer, notice, order |
| W2 | błędny klucz albo błędny wariant (`answer` lub pozycja `acceptedAnswers` nie jest poprawną odpowiedzią) w zadaniu tekstowym | gap, error_fix, transform, open_answer |
| W3 | druga poprawna opcja albo drugie poprawne słowo do wskazania (dziecko wybierające ją dostałoby „źle”) | choice, short_answer, notice |
| W4 | dwuznaczne zadanie tekstowe: polecenie i widoczny kontekst pozwalają poprawnie odpowiedzieć BEZ ćwiczonej formy | gap, error_fix, transform, open_answer |
| W5 | poza zakresem zagadnienia: nie ćwiczy zagadnienia albo wymaga form spoza tematu | wszystkie |
| W6 | zdradzona odpowiedź: rozwiązanie widać w bodźcu, podpowiedzi (`hint`), karcie albo przykładzie karty z kolumny `objective`; także pojedyncza forma słowa wypisana na karcie (np. pisownia) | wszystkie |
| W7 | `explanationPl` nieprawdziwe albo niezgodne z kluczem | ćwiczenia z `explanationPl` |
| W8 | opcje nie do odróżnienia ze słuchu: zdania z różnymi opcjami brzmią tak samo (ocena z zapisu, nie z nagrania) | listen_choice |
| W9 | błąd językowy w treści widocznej dla dziecka (angielskiej albo polskiej) | wszystkie |

Rozstrzygnięcia:

- brak równoważnego wariantu (np. formy ze skrótem albo innego poprawnego szyku) = `ok` — inną odpowiedź ocenia model w sesji;
- w rozsypance inny poprawny szyk (np. przestawialne „now”) NIE jest wadą;
- zadanie zamknięte z błędnym kluczem liczy się tylko jako W1, nie W3;
- inna poprawna odpowiedź zadania tekstowego, która używa ćwiczonej formy = `ok`; bez ćwiczonej formy = W4;
- dokładne powtórzenia rozwiązań między ćwiczeniami lekcji sprawdza kod; W6 dotyczy tylko tego, co widać w wierszu i w kolumnie `objective`;
- forma słowa, którą wypisuje karta z kolumny `objective` (np. karta `swim → swimming` albo `goes`), użyta jako sprawdzana forma ćwiczenia = W6, także gdy reszta zdania różni się od karty;
- podpowiedź (`hint`) z formą podstawową, którą dziecko ma przekształcić (np. „We ___ a cake (make)”), NIE jest W6: forma podstawowa jest daną zadania, nie odpowiedzią; W6 jest dopiero widoczna forma docelowa albo całe rozwiązanie.

## Jak oceniać wiersz

- `verdict`: `ok` albo `defect`.
- `criterion`: przy `defect` klasa albo klasy rozdzielone `|` (np. `W2|W9`), wyłącznie z typów, których klasa dotyczy; przy `ok` puste.
- `level`: opcjonalnie `too_hard` albo `too_easy` dla dziecka ok. 8 lat na początku nauki (poza klasami, nie jest wadą); zwykle puste.
- `adjudicatorNote`: przy `defect` jedno zdanie po polsku z konkretem (druga poprawna opcja, konkretny błąd, miejsce zdradzenia); przy `ok` puste.

Wada musi być **wykazywalna**: da się wskazać konkretną drugą poprawną odpowiedź, konkretny błąd albo konkretne miejsce. „Mogłoby być lepiej” = `ok`; trudność sama w sobie nie jest wadą. Oceniaj każdy wiersz niezależnie, bez porównywania wierszy; przy wątpliwości, czy wada jest wykazywalna, wybierz `ok` i opisz wątpliwość w notatce.
