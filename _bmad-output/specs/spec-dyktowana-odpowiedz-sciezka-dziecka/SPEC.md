---
id: SPEC-dyktowana-odpowiedz-sciezka-dziecka
companions:
  - acceptance-scenarios.md
  - brownfield.md
  - ../../../docs/agents/lessons.md
  - ../../../docs/agents/kid-ui.md
  - ../../../docs/agents/providers-privacy.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Dyktowana odpowiedź w lekcjach — poprawki ścieżki dziecka

## Why

Ból do usunięcia przed pierwszym użyciem. Lekcje szkolne pozwalają dziecku podyktować odpowiedź otwartą, a model ocenia wiedzę i precyzję (zwięźle / rozwlekle / nie na temat) i proponuje krok „Skróć odpowiedź”. Funkcji nie używało jeszcze żadne dziecko. Przegląd kodu z 2026-11-10 nie znalazł fałszywych ocen ani ujawnień klucza, ale znalazł miejsca, w których dziecko trafi na pętlę „Nie udało się ocenić”, polecenie bez przedmiotu albo ocenę nieuwzględniającą tego, że mówiło, a nie pisało.

## Capabilities

- **CAP-1**
  - **intent:** Właściciel może zmierzyć, jak model oceniający traktuje odpowiedzi mówione, w tym precyzję.
  - **success:** Zestaw kalibracyjny zawiera przypadki mówione (wypełniacze, restart, autokorekta, przekręcona nazwa, dygresja), a raport z przebiegu podaje dla nich osobno trafność wiedzy i precyzji oraz liczbę werdyktów odrzuconych przez walidację.
- **CAP-2**
  - **intent:** Odpowiedź podyktowana jest oceniana z tolerancją dla cech mowy i bez wymogu jednego zdania.
  - **success:** Na przypadkach mówionych z CAP-1 autokorekta („Kraków, nie, Warszawa”) nie daje błędnego stwierdzenia, a same wypełniacze nie dają `verbose`; wyniki przypadków pisanych nie pogarszają się względem pomiaru sprzed zmiany.
- **CAP-3**
  - **intent:** Usterka formalna fragmentów w werdykcie modelu nie odbiera dziecku oceny wiedzy.
  - **success:** Werdykt z fragmentem niedosłownym, nadmiarowym lub nachodzącym kończy się oceną wiedzy bez tego fragmentu, a nie „Nie udało się ocenić”.
- **CAP-4**
  - **intent:** Po nieudanej ocenie dziecko nie traci swojej odpowiedzi.
  - **success:** Po „Nie udało się ocenić” i ponowieniu pole zawiera poprzedni tekst, gotowy do ponownego wysłania.
- **CAP-5**
  - **intent:** Krok skracania pojawia się tylko wtedy, gdy dziecko widzi, co usunąć.
  - **success:** Każde wydane zadanie „Skróć odpowiedź” ma co najmniej jeden zaznaczony fragment; bez niego dziecko dostaje zwykłe „Świetnie!” i idzie dalej.
- **CAP-6**
  - **intent:** Gdy przy skracaniu zginie ważna informacja, dziecko widzi, co się zmieniło.
  - **success:** Feedback po takiej poprawce pokazuje obie wersje odpowiedzi dziecka; żaden komunikat nie odsyła do treści, której nie ma na ekranie.
- **CAP-7**
  - **intent:** Sterowanie mikrofonem przy dyktowaniu odpowiedzi mówi o odpowiedzi i o tym, jak skończyć.
  - **success:** Przy dyktowaniu nie pojawia się „Nagraj”, „przytrzymaj” ani „powiedz słowo”; etykieta to „Powiedz odpowiedź”, a w trakcie nagrania widać, że drugie dotknięcie kończy.
- **CAP-8**
  - **intent:** Dziecko może dopowiedzieć ciąg dalszy pierwszej odpowiedzi kolejnym dyktowaniem.
  - **success:** Drugie udane dyktowanie do niepustego pola pierwszej odpowiedzi dopisuje tekst po istniejącym; w kroku skracania dyktowanie nadal zastępuje tekst.
- **CAP-9**
  - **intent:** Dziecko wie, dlaczego jego nagranie zniknęło.
  - **success:** Po przerwaniu nagrania przez utratę fokusu, ukrycie karty lub brak sieci widać krótki komunikat z zachętą do powtórzenia; nie liczy się to jako nieudane dyktowanie.
- **CAP-10**
  - **intent:** Dziecko widzi, że odpowiedź jest sprawdzana.
  - **success:** Od dotknięcia „Sprawdź” do pojawienia się feedbacku widoczny jest stan oczekiwania z tekstem właściwym dla odpowiedzi pisanej i mówionej.

## Constraints

- Precyzja nigdy nie obniża wiedzy; rozwlekła poprawna odpowiedź pozostaje sukcesem z zachętą.
- Tolerancja mowy żyje wyłącznie w prompcie modelu. Kod nie rozpoznaje ani nie usuwa wypełniaczy i nie dostaje nowych reguł rozumiejących język.
- Zmiana promptu modelu oceniającego podnosi wersję promptu (klucz cache werdyktów). Do modelu trafia najwyżej znacznik sposobu wprowadzenia; żadnych danych dziecka ani nagrań.
- CAP-2 wchodzi do implementacji dopiero po pomiarze z CAP-1 i odbiorze właściciela.
- Przebiegi na prawdziwym modelu wymagają zgody właściciela (`pnpm bench` dodatkowo `--cap-usd`); wyników różnych modeli się nie porównuje.
- Przypadki mówione zestawu kalibracyjnego są raportowane osobno i nie wchodzą do jego bramki przed story 2.
- Kid DTO nie zawiera klucza, kryteriów, notatki modelu ani etykiety precyzji. Feedback skracania pokazuje wyłącznie tekst dziecka, więc nie tworzy ekspozycji klucza; pozostałe ujawnienia są zamykane przed wysłaniem.
- Nieocenione próby, cisza, niepewne rozpoznanie i przerwane nagranie nie są dowodem błędnej wiedzy.
- Ekrany dziecka powstają ze wspólnych komponentów i katalogu komunikatów; zmiana layoutu ma test geometrii Playwright.

## Non-goals

- Kalibracja progu pewności rozpoznawania mowy na głosie dziecka.
- Zmiana tego, że odpowiedź częściowa przerywa serię (zachowanie celowe).
- Usuwanie zaznaczonych fragmentów dotknięciem.
- Zmiana czasu życia tekstu odpowiedzi w cache werdyktów (patrz Open Questions).
- Deklaracja gotowości na urządzeniu: odbiór na prawdziwym tablecie i głosie dziecka jest osobnym krokiem.

## Success signal

- Dziecko dyktuje odpowiedź z „yyy” i poprawieniem się w pół zdania, dostaje ocenę wiedzy za pierwszym razem, a jeśli trafi na krok skracania, widzi zaznaczony fragment i kończy krok bez komunikatu odsyłającego do niczego. Wszystkie wiersze `AC-xx` przechodzą na fikcyjnych danych.

## Assumptions

- CAP-5: gdy jedynym powodem jest forma zdania, skracania się nie proponuje (zamiast osobnego polecenia).
- CAP-6: obie wersje są pokazane bez dodatkowej próby, bo kolejna kosztowałaby wywołanie modelu.
- CAP-8 dotyczy tylko pierwszej odpowiedzi; serwer nadal sam rozstrzyga, czy tekst z dyktowania poprawiono.

## Open Questions

- Czy tekst odpowiedzi w `lesson_verdicts` ma znikać razem z profilem albo wygasać po czasie? Dziś celowo przeżywa usunięcie profilu, a przy swobodnej mowie może zawierać imiona i sprawy domowe.
- CAP-10: przegląd nie potwierdził, czy wyłączony przycisk ma już własną animację. Sprawdzić przed implementacją; jeśli stan jest widoczny, zostaje tylko tekst.
