# Rubryka ślepej oceny — etap 5 epiku #358 (rozdział i szkoła: przebieg bazowy kontra agent), zamrożona

Zamrożona 2026-11-08, przed pierwszym płatnym biegiem etapu 5 (SHA-256 w opisie PR). Po pierwszym
płatnym biegu tego pliku nie zmieniamy; poprawka = nowa wersja pliku z datą i uzasadnieniem.
Spec: `docs/superpowers/specs/2026-11-08-llm-content-judgment-stage5-chapter-school-design.md` §7.4.
Klasy W1–W9 mają te same identyfikatory co w `rubric-stage2.md`; zmienia się zakres typów.

## Co dostaje oceniający

Tylko katalog sędziego: ten plik (jako `rubric.md`), `material.txt` (materiał lekcji) i `sheet.csv`
(wiersze wymieszane, bez źródła). Nie dostaje klucza źródeł, kosztów, wyników innych ocen ani
informacji, który generator napisał wiersz. Nie zgaduje źródła — ocenia treść.

## Kolumny arkusza

| Kolumna | Znaczenie |
| --- | --- |
| `rowId` | identyfikator wiersza (prefiks = materiał) |
| `subject` | przedmiot (`english_chapter` albo `school`) |
| `objective` | kontekst: tytuł i opis zagadnienia, karty, przykłady kart widoczne dla dziecka w tej lekcji |
| `exercise` | ćwiczenie (JSON: pola w porządku alfabetycznym; `objectiveId` = człon zagadnienia) |

Do wypełnienia: `verdict`, `criterion`, `level`, `adjudicatorNote`.

## Klasy wad

| Klasa | Wada | Dotyczy typów |
| --- | --- | --- |
| W1 | błędny klucz w zadaniu zamkniętym: opcja / para / grupa / słowo luki / pojęcie kluczowe z klucza nie jest poprawną odpowiedzią (w którymkolwiek polu); w rozsypance (`lesson_order`, także kroki procesu) `answer` nie jest poprawną odpowiedzią na polecenie | choice, listen_choice, match, group, cloze, keywords, order |
| W2 | błędny klucz albo błędny wariant (`answer` lub pozycja `acceptedAnswers` nie jest poprawną odpowiedzią) w zadaniu tekstowym; w szkole także element wymagany (`requiredElements`) albo odpowiedź wzorcowa sprzeczne z materiałem | gap, open_answer |
| W3 | druga poprawna odpowiedź w zadaniu zamkniętym: druga poprawna opcja; prawa strona (także z `extraRight`) pasująca do drugiego elementu lewej strony; element pasujący do dwóch grup; słowo banku (także z `extraWords`) pasujące do innej luki albo dwie luki, których słowa można zamienić; pojęcie spoza klucza, które też jest kluczowe dla odpowiedzi | choice, match, group, cloze, keywords |
| W4 | dwuznaczne zadanie tekstowe — rozdział: polecenie i widoczny kontekst pozwalają poprawnie odpowiedzieć BEZ sprawdzanego słowa albo ramy zagadnienia; szkoła: istnieje poprawna według materiału odpowiedź, której nie pokrywają elementy wymagane | gap, open_answer |
| W5 | poza zakresem — rozdział: sprawdzana część ćwiczenia używa słowa treści spoza materiału albo słowa / ramy innego zagadnienia; szkoła: ćwiczenie wymaga faktu spoza materiału; oba: ćwiczenie nie ćwiczy swojego zagadnienia | wszystkie |
| W6 | zdradzona odpowiedź: rozwiązanie widać w bodźcu, polskim zdaniu polecenia (poza samym tłumaczeniem, które dziecko ma przełożyć), podpowiedzi (`hint`), karcie albo przykładzie karty z kolumny `objective` | wszystkie |
| W6h | to samo co W6, gdy źródłem zdradzenia jest podpowiedź (`hint`) pytania otwartego szkoły; wiersz z W6h ma też W6 | open_answer (szkoła) |
| W7 | `explanationPl` nieprawdziwe albo niezgodne z kluczem | ćwiczenia z `explanationPl` |
| W8 | opcje nie do odróżnienia ze słuchu: zdania z różnymi opcjami brzmią tak samo (ocena z zapisu, nie z nagrania) | listen_choice |
| W9 | błąd językowy w treści widocznej dla dziecka (angielskiej albo polskiej) | wszystkie |

Rozstrzygnięcia:

- brak równoważnego wariantu (np. formy ze skrótem albo innego poprawnego szyku) = `ok` — inną odpowiedź ocenia model w sesji;
- w rozsypance inny poprawny szyk NIE jest wadą;
- zadanie zamknięte z błędnym kluczem liczy się tylko jako W1, nie W3;
- inna poprawna odpowiedź zadania tekstowego, która używa sprawdzanego słowa albo ramy = `ok`; bez nich = W4;
- karta z parą „słowo — znaczenie” NIE zdradza ćwiczenia z tym słowem (karta uczy słowa); W6 to zdanie odpowiedzi widoczne wcześniej (w karcie, przykładzie karty albo bodźcu tego samego ćwiczenia);
- w zagadnieniu ramy zdaniowej słowo wypełniające ramę (np. kolor, ubranie z innej listy tego rozdziału) NIE jest „słowem innego zagadnienia” w sensie W5, o ile pochodzi z materiału;
- słowa funkcyjne (a, the, is, I, you, my, and, in, on…) nie są „słowami treści spoza materiału”;
- dokładne powtórzenia rozwiązań między ćwiczeniami lekcji sprawdza kod; W6 dotyczy tylko tego, co widać w wierszu i w kolumnie `objective`.

## Jak oceniać wiersz

- `verdict`: `ok` albo `defect`.
- `criterion`: przy `defect` klasa albo klasy rozdzielone `|` (np. `W2|W9`), wyłącznie z typów, których klasa dotyczy; przy `ok` puste.
- `level`: opcjonalnie `too_hard` albo `too_easy` dla dziecka ok. 8 lat na początku nauki (poza klasami, nie jest wadą); zwykle puste.
- `adjudicatorNote`: przy `defect` jedno zdanie po polsku z konkretem (druga poprawna opcja, konkretny błąd, miejsce zdradzenia, słowo spoza materiału); przy `ok` puste.

Wada musi być **wykazywalna**: da się wskazać konkretną drugą poprawną odpowiedź, konkretny błąd albo konkretne miejsce. „Mogłoby być lepiej” = `ok`; trudność sama w sobie nie jest wadą. Oceniaj każdy wiersz niezależnie, bez porównywania wierszy; przy wątpliwości, czy wada jest wykazywalna, wybierz `ok` i opisz wątpliwość w notatce.
