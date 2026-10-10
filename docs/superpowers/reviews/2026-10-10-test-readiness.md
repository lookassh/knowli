# Niezależny review #30 — przygotowanie do sprawdzianu

Recenzent: dedykowany agent `review_test_readiness`, read-only, według `requesting-code-review/code-reviewer.md`. Zakres: cała gałąź `e2db65104842e417e4d422dbc29a8044156a3f9b..67a98672d4d85a22f717156b5799b0e1bd0ab671`, specyfikacja, zatwierdzony plan i dziennik, nie tylko ostatni commit. Review przerwany limitem użycia wznowiono tym samym agentem i dokończono.

Recenzent potwierdził mocne strony: niezmienny plan/raport, wspólna blokada, brak ujawnień przez submit/read/retry/finalize, pełny mianownik, oddzielne Recall i pisownia, ekspozycje omówienia przed HTTP oraz konfiguracja, migracja, autoryzacja i CASCADE.

## Werdykt dla przeglądanego SHA

Critical: brak. Important: pięć. Minor: jedna. `Declined to judge`: puste. Werdykt przed poprawkami: **No — najpierw rozwiązać Important i sprawdzić regresje**. Recenzent nie uruchamiał pełnych suite'ów ponownie; reprodukował planowanie i oceny w pamięci, przeglądał kod i `git diff --check`.

## Obsługa Important przez wykonawcę

1. **Ekran bez wyjścia przy pustej kartkówce.** Potwierdzono: server zwracał validation, HTTP usuwał szczegółowy komunikat, initError nie miał nawigacji. RED: E2E `unknown material explains unavailable mock test and allows returning to learning`. Poprawka: jawny `mock_test_unavailable` z bezpiecznym polskim katalogiem komunikatów i powrót do zestawów bez automatycznego ponawiania nieudanej kartkówki. GREEN: ten sam E2E.
2. **Niejednoznaczne opcje słuchowe.** Potwierdzono `nietoperz→bat` oraz `kij→bat`, także nakładanie przez acceptedAnswers. RED: dwa testy mock-test-plan. Poprawka: wykluczenie dystraktorów z nakładającymi się znormalizowanymi zatwierdzonymi odpowiedziami; brak opcji pozostaje insufficient_options. GREEN: 10 testów planowania.
3. **Pominięte ujawnienie zatwierdzonego wariantu.** Potwierdzono na rzeczywistym PostgreSQL: colour ujawnione w drugim zestawie zaliczało przedwcześnie samodzielny sukces dla color. RED: granice 299/300 sekund, również confirmation_eligible. Poprawka: maksimum ekspozycji wszystkich zatwierdzonych odpowiedzi przy received_at oraz uwzględnienie ich kontaktów między zestawami w migawce poprzednich sesji. Nie zmieniono zakończonych ocen. GREEN: oba testy PostgreSQL; przy 300 sekundach niezależność może wrócić, lecz 12-godzinne potwierdzenie nadal nie jest spełnione.
4. **Brak wygasłej częściowej próby w liście rodzica.** Potwierdzono filtrowanie active przed lazy close. RED: `lists and closes an expired partial test without another child request`. Poprawka: lista wybiera także próby starsze niż limit i przekazuje je do istniejącego odczytu/zamknięcia pod blokadą sesji. GREEN: test PostgreSQL.
5. **Jakość dowodu ukryta przy błędzie.** Potwierdzono brak etykiety independent w UI i nadpisywanie przyczyny przez kapitalizację. RED: PostgreSQL `retains recent exposure reason separately from capitalization and wrong-word evidence`, E2E jakości dowodu. Poprawka: osobne independenceReason dla ocen poprawnych i błędnych; UI rozdziela poprawność/kapitalizację, samodzielność/przyczynę i brak wiarygodnego dowodu. GREEN: test PostgreSQL i E2E `parent sees evidence quality separately from a spelling mistake after a recent model`.

Wykonawca uznał pięć uwag Important za technicznie zasadne i rozwiązał wszystkie. Nie pozostały otwarte Critical ani Important; Minor odłożona poniżej. Werdykt recenzenta dotyczy SHA przed poprawkami; powyższe potwierdzenia pochodzą z rzeczywistych RED→GREEN wykonawcy, nie są deklaracją ponownego niezależnego review.

Przyczyny źródłowe zweryfikowano w `receiving-code-review`; nie przyjęto uwag wyłącznie na podstawie etykiety recenzenta. Poprawki stanowią jeden końcowy przebieg, każda z własnym RED→GREEN. Dalszy niezależny re-review nie zastępuje testów i nie był zlecany; pierwsze przerwane review zostało dokończone.

## Odłożona Minor

`session-controller.ts`: `answerSaved` pozostaje przy następnym zadaniu. Komunikat odnosi się do ostatnio zapisanego wyniku, lecz jego zakres można doprecyzować/wyczyścić przy następnej próbie. Nie wpływa na zapis serwera, ocenę, budżet ani kwalifikację. Nie włączono tej kosmetycznej poprawki do końcowej tury zgodnie z executing-plans.

## Dowody i ograniczenia

Przed poprawkami: unit 374/374, PostgreSQL 168/168, E2E 64/64, typecheck i build PASS. Pełne wyniki po poprawkach oraz końcowa decyzja wykonawcy znajdują się w `../progress/2026-10-10-test-readiness.md`. Fizycznego telefonu/tabletu rodziny ani wdrożenia produkcyjnego nie sprawdzano; przegląd nie zastępuje tych dowodów.
`nPo pięciu poprawkach: pełne unit376/376, PostgreSQL172/172 i E2E66/66, typecheck/build/diff-check PASS. PR: https://github.com/lookassh/knowli/pull/33. Wykonawca zakończył bramkę obsługi review; właściciel podejmuje decyzję o squash merge.
