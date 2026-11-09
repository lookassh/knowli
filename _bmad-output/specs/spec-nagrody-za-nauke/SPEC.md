---
id: SPEC-nagrody-za-nauke
status: ready-for-story-planning
companions:
  - reward-rules.md
  - activity-policy.md
  - daily-round.md
  - xbox-rewards.md
  - brownfield.md
  - acceptance-scenarios.md
  - ../../../docs/SPEC.md
  - ../../../docs/architecture.md
sources: []
---

# Nauka na czas Xboxa

Kontrakt aktualny na 2026-10-16. SPEC i companions zastępują poprzednie warianty nagród. Gotowe do planowania małych stories; parametry pomiaru wymagają odbioru story 1 przed implementacją. To dokumentacja, nie wykonana funkcja.

## Why

Dziecko otrzymuje prostą zachętę za pracę w Umiem!, także gdy popełnia błędy. Krótkie sesje sumują się do minimum 30 minut w lokalnym dniu; każde kolejne 30 minut umożliwia zdobycie następnych 15 minut Xboxa. Aplikacja zbiera informacje o pracy, rodzic zatwierdza i ręcznie realizuje nagrodę. Gwiazdki nadal informują o wiedzy lub wyniku próby.

## Capabilities

- **CAP-1**
  - **intent:** Dziecko zdobywa punkty za zaliczony czas pracy.
  - **success:** Każde pełne 60 sekund daje 1 punkt; części minut sumują się między sesjami, bez stałej premii za zakończenie.
- **CAP-2**
  - **intent:** Nagroda pozostaje niezależna od opanowania materiału.
  - **success:** Przy tej samej zaliczonej aktywności błędy, pomoc i brak mikrofonu nie zmieniają punktów; punkty nie zmieniają gwiazdek, ocen ani harmonogramu.
- **CAP-3**
  - **intent:** Dziecko widzi dorobek zestawu i profilu oraz saldo do wymiany.
  - **success:** Suma punktów zestawów odpowiada dorobkowi dziecka; rezerwacja i wymiana zmniejszają saldo dostępne, zachowując dorobek.
- **CAP-4**
  - **intent:** Dziecko rozumie swój cel dnia i rezultat sesji.
  - **success:** Widzi zaliczony czas względem 30 minut, przyrost po sesji i dostępne pakiety Xbox; nie musi obserwować punktów naliczanych co sekundę.
- **CAP-5**
  - **intent:** Praca i nagroda są rozliczane jednokrotnie.
  - **success:** Retry, reload, opóźnione pakiety i dwa klienty nie podwajają sekund, punktów, rezerwacji ani realizacji.
- **CAP-6**
  - **intent:** Dorobek pozostaje trwały mimo zmian materiału i przerw.
  - **success:** Publikacja wersji, archiwizacja i przerwa nie zerują punktów; usunięcie dziecka usuwa jego czas nagrodowy, przyznania, rundy i wymiany.
- **CAP-8**
  - **intent:** Dziecko wymienia wypracowane punkty na czas Xboxa.
  - **success:** Każdy pełny blok 1800 zaliczonych sekund w jednym lokalnym dniu daje uprawnienie do pakietu 15 minut za 30 punktów; 60 minut daje dwa pakiety, a ten sam blok nie jest wykorzystywany ponownie.
- **CAP-9**
  - **intent:** Rodzic przyznaje nagrodę właściwemu dziecku.
  - **success:** Po przeglądzie pracy dodaje czas ręcznie w Xbox Family i potwierdza go raz w Umiem!; aplikacja nie loguje się do Microsoft i nie steruje blokadą konsoli.
- **CAP-10**
  - **intent:** Dziecko zbiera czas aktywności związanej z wykonywaniem nauki.
  - **success:** Tło, bezczynność, same kliknięcia i oczekiwanie techniczne nie tworzą zaliczonych minut; odcinki są powiązane z zadaniem i wykonanym krokiem według `activity-policy.md`.
- **CAP-11**
  - **intent:** Krótka runda dostarcza dodatkowych przykładów dzisiejszej pracy.
  - **success:** Aplikacja dobiera zapowiedzianą porcję z dzisiejszego materiału; jej poprawność nie stanowi progu nagrody i nie wydłuża wcześniej obiecanej sesji.
- **CAP-12**
  - **intent:** Rodzic ocenia przebieg pracy przed nagrodą.
  - **success:** Widzi czas, sesje, zestawy, odpowiedzi i braki oraz rundę; ma możliwość rozmowy i decyzji, bez automatycznej etykiety oszustwa.

## Constraints

- Pomiar jest heurystyką aktywności, nie dowodem uwagi lub tożsamości. Bez kamery, trwałego audio, modelu wykrywającego oszustwa i automatycznych kar za trudności.
- Nie używamy raportowego `learningTime` jako czasu nagrody; jego znaczenie, filtr lekcji i kontrakt MCP pozostają niezmienione.
- Nie zmieniamy budżetów sesji, obietnicy końca, planu kartkówki, kwalifikacji samodzielności ani granic modułów przedmiotowych.
- Serwer jest źródłem naliczeń i salda; brak potwierdzenia nie tworzy lokalnego sukcesu. Rozliczenia są odtwarzalne, bez ujemnego salda.
- Parent Mode autoryzuje przegląd i realizację; wybór profilu dziecka nie daje tych uprawnień. Kontrakty podlegają sprawdzeniu API → MCP → skill.

## Non-goals

- Automatyczne dodawanie minut, sterowanie zasilaniem Xboxa, integracja Home Assistant i logowanie do Microsoft z Umiem!.
- Ogólny sklep, cele rodzinne, rankingi, serie dni, losowe nagrody i konfigurator antyoszustw.
- Wymagany procent poprawności, uzależnienie nagrody od gwiazdek i nieomylne wykrywanie oszustwa.
- Przeliczanie historii sprzed uruchomienia funkcji, pełny offline oraz implementacja lub wdrożenie podczas pisania specyfikacji.

## Success signal

Na fikcyjnym profilu kilka krótkich sesji daje łącznie 30 zaliczonych minut, 30 punktów i jeden pakiet; 60 minut w dniu daje dwa. Rodzic ogląda fakty i rundę, realizuje czas ręcznie, a retry nie powiela nagrody. Tło i bezczynność nie nabijają czasu; błędna wiedza sama nie blokuje nagrody. Scenariusze w `acceptance-scenarios.md`.

## Assumptions

- **A1:** Parametry startowe pomiaru: sygnał co 15 s, tolerancja utraty łączności 30 s i bezczynność po 60 s. Wymagają oceny w planie i odbiorze story 1, szczególnie przy wolnym czytaniu i słuchaniu.
- **A2:** Runda obejmuje do 3 zadań z wybranego zestawu ćwiczonego dziś; liczbę skracamy do bezpiecznie dostępnego materiału. Brak materiału jest jawny rodzicowi i nie jest błędem dziecka.
- **A3:** Gotowe uprawnienia i punkty można wykorzystać później; nie wygasają o północy. Niepełnych bloków czasu z różnych dni nie łączymy do uprawnienia, choć punkty pozostają dorobkiem.

CAP-7 pozostaje wycofany; nie używać ponownie. Dawne kwoty za sesję i poprzednie pytania o przelicznik/automat nie obowiązują. Nie ma otwartych pytań produktowych blokujących podział; A1–A3 pozostają jawne do odbioru.
