# Diagnoza opóźnienia profil → lista zestawów

Data: 2026-10-18. Gałąź: `feature/profile-navigation-diagnosis`.
Kod lokalny i obraz produkcyjny: `5356529150a92bd782c6118ab52b49e4fcd905ae`.

## Wniosek

Główne opóźnienie powoduje `readSkillHistories` wywoływane przez
`listKidDecks` → `readLearningSnapshot`. W zmierzonym przypadku jedno
zapytanie historii pochłaniało 8,84 s z 9,10 s całego przypadku użycia (97%).
Skorelowane sprawdzanie audio wielokrotnie skanuje `learning_events`, a wysoki
koszt planu uruchamia kosztowną kompilację JIT PostgreSQL. Nie jest to wyłącznie
hipoteza na podstawie kodu: potwierdzono rzeczywiste plany i odczyty produkcyjne.

## Sposób pomiaru i ograniczenia

- Publiczny GET API: pięć profili, dwa kolejne pomiary każdego profilu.
- Następnie wykonanie wdrożonego `listKidDecks` z procesu diagnostycznego w
  kontenerze worker, na tej samej produkcyjnej bazie PostgreSQL 17.11.
- Połączenia diagnostyczne miały `default_transaction_read_only=on` i limit
  czasu zapytania. Nie zmieniano konfiguracji globalnej, indeksów ani aplikacji.
- Wyłącznie w procesie diagnostycznym pominięto dwa idempotentne INSERT-y
  `ensureLearningPolicy`; wcześniej potwierdzono istnienie obu polityk.
- Zmierzono zapytania `pool.query`, pobrano `EXPLAIN (ANALYZE, BUFFERS,
  FORMAT JSON)` dla najwolniejszych odczytów i porównano warianty w transakcji
  `READ ONLY`. `SET LOCAL jit` dotyczył tylko tej transakcji.
- Kontrolna zmiana SQL istniała wyłącznie w pamięci procesu diagnostycznego.
  Nie została wdrożona. Czasy przypadku użycia nie są czasami HTTP ani testem
  przeglądarki. Wyniki opisują bieżący zbiór danych, nie gwarancję przyszłej latencji.
- Raport nie zawiera identyfikatorów profili, transkrypcji ani odpowiedzi dzieci.
  Numery profili oznaczają kolejność odczytu po `created_at`.

## Pomiary

Lista profili HTTP: 201 ms. Lista zestawów HTTP:

| Profil | Pierwszy GET | Drugi GET | Zestawy widoczne |
| --- | ---: | ---: | ---: |
| 1 | 7839 ms | 7653 ms | 4 słówkowe |
| 2 | 1893 ms | 1856 ms | 6 słówkowych, 1 lekcja |
| 3 | 2446 ms | 2446 ms | 5 słówkowych |
| 4 | 8952 ms | 8975 ms | 4 słówkowe |
| 5 | 4070 ms | 4108 ms | 4 słówkowe |

Instrumentacja profilu 4: 22 odczyty SQL; zapytanie historii 9072 ms,
cały przypadek użycia 9337 ms. Pozostałe zapytania trwały po 1–22 ms
(część wykonywana równolegle). Dla profilu 1: historia 7570 ms z 7768 ms całości.

## Potwierdzone przyczyny

1. **Pełny skan zdarzeń powtarzany dla każdej oceny.**
   `packages/server/src/modules/skill-history.ts` zawiera `EXISTS` sprawdzające
   `task_id`, `kind='audio_issued'`, `sealed=true` i czas zdarzenia nie późniejszy
   niż odpowiedź. Na produkcji brak indeksu rozpoczynającego się od `task_id`
   w `learning_events` (potwierdzone w `pg_indexes`). Plan profilu 4 wykonuje
   2204 skany po około 18462 wiersze: około 40,7 mln sprawdzeń, 945516 trafień
   bloków bufora dla samego podzapytania. `Shared Read Blocks=0`: dane są
   już w pamięci, więc rozgrzanie cache nie usuwa problemu.

2. **Kompilacja JIT dokłada kolejne sekundy.**
   Zapytanie buduje 450 alternatyw OR (90 rewizji × 5 umiejętności), a
   szacowany koszt całego planu wynosi 570370,59. Przekracza progi JIT:
   `jit_above_cost=100000`, `jit_inline_above_cost=500000`,
   `jit_optimize_above_cost=500000`. Plan potwierdza włączenie optymalizacji
   i inliningu. Odczyt kontrolny: oryginał 8562 ms; identyczny SQL z JIT
   wyłączonym lokalnie 4313 ms. Samo wyłączenie JIT pozostawia koszt skanów.
   Raportowany łączny czas JIT sumuje pracę procesów równoległych i nie jest
   czasem oczekiwania użytkownika.

3. **Lista używa pełnego odtworzenia historii.**
   `listKidDecks` czyta projekcję postępu, a następnie `readLearningSnapshot`
   ponownie pobiera historię i przelicza postęp. Pobiera też dane o pomyłkach,
   kierunkach czytania i prezentacjach, których DTO listy bezpośrednio nie używa.
   To rozszerza pracę i uzależnia jej koszt od rosnącej historii. W obecnym
   pomiarze jest to koszt wtórny wobec punktów 1–2. Nie należy usuwać odtwarzania
   bez zachowania semantyki polityki, rekomendacji i kwalifikacji dowodów.

## Eksperyment potwierdzający rozwiązanie głównego problemu

Zastąpiono wyłącznie wyrażenie `EXISTS` zbiorczym złączeniem po `task_id`:

```sql
LEFT JOIN (
  SELECT task_id, min(occurred_at) AS first_audio_at
  FROM learning_app.learning_events
  WHERE kind = 'audio_issued' AND sealed = true
  GROUP BY task_id
) audio ON audio.task_id = attempts.task_id
-- Pole wyniku:
coalesce(audio.first_audio_at <= attempts.received_at, false)
```

Istnienie zdarzenia do czasu odpowiedzi odpowiada sprawdzeniu, czy najwcześniejsze
takie zdarzenie jest nie późniejsze niż odpowiedź. Złączenie daje maksymalnie
jeden wiersz na zadanie, więc nie mnoży ocen. Identyfikatory zadań są globalnie
unikalne, a istniejący filtr dziecka w głównym zapytaniu pozostaje zachowany.

Zapytanie w `EXPLAIN ANALYZE`: **8562 → 51 ms**, koszt planu **570370 → 14567**.
Znosi powtarzane skany i nie uruchamia JIT przy bieżących progach.

Ponowny pomiar całego przypadku użycia dla profilu 4: **9100 → 295 ms**;
zapytanie historii **8838 → 94 ms**. Potwierdzono identyczne wszystkie 2204
wiersze historii po normalizacji kolejności oraz identyczny kompletny wynik
`KidDeckDto[]`, przy tym samym zegarze. Sortowanie SQL nie rozstrzyga kolejności
umiejętności wewnątrz tej samej próby, dlatego porównanie historii traktowało
wiersze jako multizbiór.

Kontrolny wariant całego przypadku użycia dla pozostałych profili:
232, 219, 238 i 200 ms. Dla nich nie wykonywano pełnego porównania DTO
oryginał–wariant. To nadal eksperyment diagnostyczny, nie gotowa poprawka.

## Pozostałe ustalenia i zalecana kolejność

- Nagrody korzystają z projekcji i nie są głównym kosztem tej ścieżki.
- Odświeżanie profili uruchamia się po pokazaniu zestawów; nie blokuje ich listy.
- Lekcje wykonują dodatkowe odczyty sekwencyjnie i ponownie ładują ćwiczenia
  do planera kartkówki. To osobne miejsce do optymalizacji przy większej liczbie
  lekcji; nie odpowiada za zmierzone wielosekundowe opóźnienie profili słówkowych.
- W planach nie było odczytów z dysku. W punktowym odczycie `pg_stat_activity`
  nie stwierdzono oczekiwania na blokady; nie jest to ciągły monitoring obciążenia.
- Najpierw zmienić sprawdzanie audio na operację zbiorczą i przetestować regresje
  kwalifikacji historii (audio przed/po odpowiedzi, brak audio, zdarzenia
  niezapieczętowane, różne zadania/dzieci, wielokrotne audio, wszystkie umiejętności).
- Następnie uprościć 450 alternatyw OR do filtrowania dokładnych żądanych zakresów
  w relacji/tabeli wartości. Nie tworzyć przypadkiem iloczynu kombinacji zakresów.
- Rozważyć indeks częściowy `(task_id, occurred_at)` dla zapieczętowanych
  `audio_issued`, szczególnie dla innych odczytów. Nie sprawdzono go eksperymentalnie;
  zmierzony wariant zbiorczy już usuwa główne opóźnienie bez nowego indeksu.
- Dopiero potem rozważyć węższy snapshot listy i grupowanie odczytów lekcji.
  Globalne wyłączenie JIT nie jest konieczne do uzyskania zmierzonego przyspieszenia.
- Po implementacji wykonać testy historii i list zestawów oraz ponowić pomiar
  prawdziwego API po wdrożeniu. Ta diagnoza nie zmienia API, MCP ani skilla.
