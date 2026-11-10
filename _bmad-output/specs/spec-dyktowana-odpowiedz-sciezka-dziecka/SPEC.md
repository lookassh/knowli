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
  - **success:** Zestaw kalibracyjny zawiera przypadki mówione, część sparowana z pisanym odpowiednikiem; raport podaje dla nich osobno trafność wiedzy i precyzji, werdykty odrzucone przez walidację, błędy dostawcy i niepotrzebnie wywołane skracanie, a wynik rozstrzyga zapisana z góry reguła decyzyjna.
- **CAP-2**
  - **intent:** Odpowiedź podyktowana i niepoprawiona jest oceniana z tolerancją dla cech mowy i bez wymogu jednego zdania.
  - **success:** Po zmianie żaden przypadek mówiony zestawu nie jest stabilnie błędny według reguły z CAP-1, przypadki częściowe i błędne nie są zawyżone, a bramka przypadków pisanych nadal przechodzi.
- **CAP-3**
  - **intent:** Wadliwy fragment zbędny lub nie na temat w werdykcie modelu nie odbiera dziecku oceny wiedzy.
  - **success:** Werdykt z takim fragmentem niedosłownym, nadmiarowym lub nachodzącym kończy się oceną wiedzy bez tego fragmentu, a nie „Nie udało się ocenić”.
- **CAP-4**
  - **intent:** Po nieudanej ocenie dziecko nie traci swojej odpowiedzi.
  - **success:** Po „Nie udało się ocenić” i ponowieniu pole zawiera poprzedni tekst, gotowy do ponownego wysłania.
- **CAP-5**
  - **intent:** Krok skracania pojawia się tylko wtedy, gdy dziecko widzi, co usunąć.
  - **success:** Każde wydane zadanie „Skróć odpowiedź” ma co najmniej jeden zaznaczony fragment; bez niego dziecko dostaje zwykłe „Świetnie!” i idzie dalej.
- **CAP-6**
  - **intent:** Gdy przy skracaniu zginie ważna informacja, dziecko widzi, co się zmieniło.
  - **success:** Ekran z feedbackiem po takiej poprawce pokazuje obie wersje odpowiedzi dziecka (widok skracania zostaje nad panelem wyniku); żaden komunikat nie odsyła do treści, której nie ma na ekranie.
- **CAP-7**
  - **intent:** Sterowanie mikrofonem przy dyktowaniu odpowiedzi mówi o odpowiedzi i o tym, jak skończyć.
  - **success:** Przy dyktowaniu nie pojawia się „Nagraj”, „przytrzymaj” ani „powiedz słowo”; etykieta to „Powiedz odpowiedź”, a w trakcie nagrania widać, że drugie dotknięcie kończy.
- **CAP-9**
  - **intent:** Dziecko wie, dlaczego jego nagranie zniknęło.
  - **success:** Po przerwaniu nagrania przez utratę fokusu, ukrycie karty lub brak sieci widać krótki komunikat z zachętą do powtórzenia; nie liczy się to jako nieudane dyktowanie.
- **CAP-10**
  - **intent:** Tekst stanu oczekiwania pasuje do odpowiedzi pisanej i mówionej.
  - **success:** Po „Sprawdź” przy odpowiedzi otwartej widoczny komunikat oczekiwania nie mówi o nagraniu.

CAP-8 (dopisywanie przy kolejnym dyktowaniu) wycofano po przeglądzie; ID nie będzie użyte ponownie.

## Constraints

- Precyzja nigdy nie obniża wiedzy; rozwlekła poprawna odpowiedź pozostaje sukcesem z zachętą.
- Tolerancja mowy żyje wyłącznie w prompcie modelu. Kod nie rozpoznaje ani nie usuwa wypełniaczy i nie dostaje nowych reguł rozumiejących język.
- Zmiana promptu modelu oceniającego podnosi wersję promptu. Sposób wprowadzenia wchodzi do klucza cache werdyktów: ta sama treść mową i klawiaturą nie dzieli wpisu. Mowa poprawiona ręcznie jest oceniana jak klawiatura.
- Do modelu trafia najwyżej znacznik sposobu wprowadzenia; żadnych danych dziecka ani nagrań.
- CAP-2 wchodzi do implementacji dopiero po pomiarze z CAP-1 i odbiorze właściciela. Stan 2026-11-10 (`speech-baseline.md`): pomiar na przypadkach syntetycznych nie wskazał problemu; CAP-2 jest wstrzymane do transkryptów z odbioru rodzinnego, decyzja należy do właściciela.
- Etykiety przypadków mówionych to oczekiwanie docelowe właściciela. Przypadki sporne są oznaczone i nie wchodzą do reguły decyzyjnej.
- Przypadki mówione są raportowane osobno i nie wchodzą do bramki zestawu przed story 2.
- Przebiegi na prawdziwym modelu wymagają zgody właściciela (`pnpm bench` dodatkowo `--cap-usd`); wyników różnych modeli się nie porównuje.
- CAP-3: błędne stwierdzenia liczą się jako luka w wiedzy przed pominięciem fragmentu; reguły wiedzy w walidacji pozostają odrzucające. Werdykt `incorrect`, któremu po pominięciu nie zostaje żadna widoczna luka, pozostaje nieoceniony. Werdykt po pominięciu fragmentów trafia do cache.
- Kid DTO nie zawiera klucza, kryteriów, notatki modelu ani etykiety precyzji. Feedback skracania pokazuje wyłącznie tekst dziecka, więc nie tworzy ekspozycji klucza; pozostałe ujawnienia są zamykane przed wysłaniem.
- Nieocenione próby, cisza, niepewne rozpoznanie i przerwane nagranie nie są dowodem błędnej wiedzy.
- Ekrany dziecka powstają ze wspólnych komponentów i katalogu komunikatów; zmiana layoutu ma test geometrii Playwright.
- Odbiór rodzinny na tablecie nie rusza przed decyzją właściciela z Open Questions.

## Non-goals

- Dopisywanie tekstu przy kolejnym dyktowaniu (dawne CAP-8): kolejne dyktowanie nadal zastępuje tekst, co służy też poprawieniu złego rozpoznania. Wrócić po odbiorze rodzinnym, jeśli dziecko będzie tego potrzebować.
- Kalibracja progu pewności rozpoznawania mowy na głosie dziecka.
- Zmiana tego, że odpowiedź częściowa przerywa serię (zachowanie celowe).
- Usuwanie zaznaczonych fragmentów dotknięciem.
- Deklaracja gotowości na urządzeniu: odbiór na prawdziwym tablecie i głosie dziecka jest osobnym krokiem.

## Success signal

- Dziecko dyktuje odpowiedź z „yyy” i poprawieniem się w pół zdania, dostaje ocenę wiedzy za pierwszym razem, a jeśli trafi na krok skracania, widzi zaznaczony fragment i kończy krok bez komunikatu odsyłającego do niczego. Wiersze `AC-xx` przechodzą na fikcyjnych danych; wiersze o zachowaniu modelu są rozstrzygane regułą z AC-03.

## Assumptions

- CAP-5: gdy jedynym powodem jest forma zdania, skracania się nie proponuje (zamiast osobnego polecenia).
- CAP-6: obie wersje są pokazane bez dodatkowej próby, bo kolejna kosztowałaby wywołanie modelu.
- Wynik CAP-1 dotyczy ręcznie napisanych przypadków, nie prawdziwych transkryptów dziecka.
- CAP-1: nie zweryfikowano, czy rozpoznawanie mowy zapisuje „yyy”. Jeśli je wycina, przypadki z wypełniaczami mierzą rzadszy problem.

## Open Questions

- Czy tekst odpowiedzi w `lesson_verdicts` ma znikać razem z profilem albo wygasać? Dziś celowo przeżywa usunięcie profilu, a przy swobodnej mowie może zawierać imiona i sprawy domowe. Najtańszy wariant do rozważenia: nie zapisywać do cache niepoprawionej mowy.
