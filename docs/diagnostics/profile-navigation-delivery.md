# Dostarczenie planu profil → lista zestawów

Status: implementacja w toku, nie wdrożono. Gałąź: `feature/profile-navigation-performance`.
Baseline: `5356529150a92bd782c6118ab52b49e4fcd905ae` (zweryfikowane HEAD i origin/main).

## Autoryzacja i nadzór

Właściciel zlecił pełne dostarczenie planu do PR z zielonymi checks, implementację
przez GPT Luna medium, nadzór agenta głównego, niezależne code review,
RED–GREEN i weryfikację przyspieszenia. Push gałęzi i PR są autoryzowane.
Merge i wdrożenie produkcyjne nie są częścią tego zlecenia.

Współdzielone worktree ma rozłączne przydziały; zmiany innych aktywnych agentów
są zamierzone i nie wymagają ponownej zgody właściciela.

## Rejestr nadzoru

- 2026-10-18: nowa gałąź, fetch origin/main; node_modules i .env już istnieją.
- Uruchomiono wymagany bmad-build; brakujący lokalny runtime odtworzono
  oficjalnym setupem (brak pytań konfiguracyjnych); `_bmad` pozostaje ignorowany.
- Audyt Luna: potwierdzony brak policy_id w projekcji i fallback snapshotu
  do obcej polityki. Decyzja nadzorcy: lista/planer wymagają własnej polityki;
  raport rodzica zachowuje jawnie ostatnią wiarygodną ocenę. Osobne regresje.
- Audyt Luna: czysty planLessonMockTest już istnieje; dostępność kartkówki
  niepotrzebnie materializuje prompty i UUID, lista lekcji czyta N razy audio/pule.
- Niezależny szybki baseline nadzorcy: 12/12 unit (projection-evidence,
  lesson mock-test planner). Brak pełnego monorepo baseline.
- A1: nadzorca wymaga testów rzeczywistej kwalifikacji reading, nie tylko
  zgodności kształtu SQL i testu listening, którego audio nie pozbawia samodzielności.
- C: nadzorca wskazał potrzebę stabilnej kolejności puli oraz odróżnienia
  pozytywnego testu starego kosztu od rzeczywiście zaobserwowanego RED.
- C: zweryfikowano requirements grammar-module §9.3: niewidziane ćwiczenia
  mają pierwszeństwo, widziane są fallbackiem. Skorygowano zbyt mocny skrót
  w macierzy wykonawczej; nie zmieniamy semantyki kartkówek przy refaktorze.
- A2 (nadzorca): test exact triples/duplikaty/puste/400 nieistniejących zakresów
  dał RED na rozmiarze SQL 64974 znaków (limit 5000 dla stałego kształtu).
  Zastąpiono OR typowanym parametryzowanym UNNEST dokładnych trójek; GREEN
  integration/history 11/11. Kolejność received_at/attempt_id/skill stabilna.
- Niezależne code review A/C: GPT 6.1 Sol wskazał dwa potwierdzone problemy
  skalowania. Audio IN mogło przekroczyć limit parametrów PostgreSQL — nadzorca
  zmienił je na ANY(uuid[]). Pomocniczy odczyt ekspozycji lekcji zwracał duplikaty
  historii — nadzorca dodał deduplikację w SQL przez GROUP BY. Oba wymagają
  końcowego ponowienia testów po stabilizacji B. Reviewer uruchomił unit 12/12.

## Stan etapów

| Etap | Stan |
| --- | --- |
| P0/A1 | implementacja Luna, testy granic w toku |
| A2 | przygotowanie przydziału |
| B1–B4 | spec przygotowany, czeka na zwolnienie współdzielonych plików |
| C1–C2 | implementacja helperów Luna, integracja listy po B |
| Benchmark | przygotowanie fikcyjnego fixture i opt-in pomiaru Luna |
| Końcowe review | oczekuje stabilnego diffu; wymagane przed PR |
| CI / PR | niewykonane |

## Dowody i ograniczenia

Szczegóły etapów, komendy i RED/GREEN są w osobnych dziennikach.
Dotychczasowe 9,10 s → 295 ms dotyczy wyłącznie kontrolnego odczytu podczas
diagnozy. Nie jest wynikiem wdrożonej implementacji. Finalny raport musi zawierać
rzeczywiste pomiary nowego kodu, macierz AC01–AC18, wyniki CI i review.
