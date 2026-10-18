# Niezależne review poprawek PR #93

Data: 2026-10-18. Zakres: poprawki po commicie
`54ffcd05cad80c1b2ac3234b154dbf14ca9b0ea8`, zgodnie z
[planem implementacji](2026-10-18-profile-navigation-review-fixes-plan.md).
Implementację i testy wykonał subagent GPT Luna medium; poniższy przegląd
wykonał agent prowadzący po odczytaniu zmian i powiązanych kontraktów.

## Zakres przeglądu

- `skill-projections.ts` i `progress-rebuild.ts`: tryb dokładnego zapisu jest
  wywoływany wyłącznie przez odbudowę, w istniejącej transakcji i pod blokadą
  profilu. Domyślny zapis online zachowuje MIN/MAX/OR. Dokładna odbudowa
  zastępuje również `NULL` i `false`; porównanie obejmuje też
  `delayed_confirmation_at`. Nie zmienia źródłowych prób ani ocen.
- `published-progress.ts`: wybór ostatniej wiarygodnej projekcji odbywa się
  osobno dla wersji umiejętności i w zakresie dziecka. Nowsza ocena wygrywa
  niezależnie od aktywnej polityki; remis rozstrzyga rosnący `policy_id`.
  Samo wydanie bez oceny nie maskuje wcześniejszego wyniku. Powiązania z
  bieżącą wersją materiału i poprzednikami pozostają zachowane. Lista dziecka
  i planer nadal używają własnego zakresu polityki.
- `capturePoolQueries`: przechwytywanie działa na `client.query`, przez oba
  warianty `pool.connect` (callback i Promise). Obejmuje klientów ponownie
  wypożyczonych z rozgrzanej puli, nie liczy osobno tej samej operacji na
  poziomie `pool.query` i przywraca metody w `finally`.
- Regresje PostgreSQL: uszkodzenie wszystkich faktów projekcji, obecność
  wartości pustych i fałszywych, ponowna idempotentna odbudowa; zmiana polityki,
  nowszy wynik z każdej polityki i remis; raport `currentProgress`; dodatnia
  liczba SELECT oraz dokładne liczenie i sprzątanie instrumentacji po błędzie.
- API → MCP → skill: kształt DTO, schemat v1 i parametry narzędzia nie zmieniają
  się. Nota skilla opisuje zachowanie `currentProgress`, odróżnia je od
  `practiceItems` i zachowuje wyłączenie lekcji. Manifest uwzględnia nowy hash
  skilla. Aktualizacja zainstalowanego pakietu Hermesa pozostaje osobnym
  działaniem operacyjnym.

## Wynik przeglądu kodu

Nie stwierdzono nowych uwag blokujących w poprawkach. Podczas przeglądu
rozszerzono początkową regresję odbudowy, aby nie zależała od arbitralnie
wybranego jednego wiersza, dodano sprawdzenia nowszych wyników obu polityk
oraz raportu Hermesa i sprzątania instrumentacji.

## Weryfikacja i ograniczenia

- Pełne testy jednostkowe: 1285 zaliczonych.
- Pełne testy integracyjne PostgreSQL: 52 pliki, 462 zaliczone, dwa benchmarki
  opt-in pominięte.
- Typecheck, build produkcyjny i osiem testów MCP: zaliczone.
- Pełny lokalny przebieg E2E: 197 zaliczonych, jedna porażka w `kid-flow`.
  Fixture `seedDue` ustawiało `needs_confirmation` bez `last_reviewed_at`,
  przez co raport słusznie pomijał ten wiersz jako dowód oceny. Uzupełniono
  datę w INSERT i UPSERT, zachowując asercje oraz kod produkcyjny.
  Ponowny pełny przebieg `kid-flow.spec.ts`: 10/10 zaliczonych.
- Końcową bramką całego PR jest pełne CI dla wypchniętego commita, wraz ze
  wszystkimi shardami E2E. Jego aktualny wynik znajduje się w checkach PR #93.

## Ocena końcowa poprawek

Poprawki zaakceptowane po niezależnym przeglądzie; brak otwartych uwag
blokujących. Korekta fixture E2E została przejrzana osobno: uzupełnia dowód
oceny wymagany przez cel scenariusza i nie osłabia oczekiwanego licznika.
Gotowość całego PR do scalenia wymaga zielonej bramki CI wskazanej powyżej.

Ciężkiego benchmarku 1×/10× nie powtarzano w ramach tych poprawek. Testy
potwierdzają poprawność licznika SQL, a nie nowe mediany/p95. Wyniki dawnych
pomiarów pozostają historycznym dowodem opisanym w raporcie benchmarku.
Nie wykonywano wdrożenia ani aktualizacji zainstalowanej integracji Hermesa.
