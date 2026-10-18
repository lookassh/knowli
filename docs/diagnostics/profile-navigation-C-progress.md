# Profil → zestawy: postęp etapu C1/C2

Data: 2026-10-18. Zakres: rozdzielenie wyboru kartkówki od materializacji oraz
zbiorczy, lekki czytnik wartości lekcji. Zmiany nie podłączają jeszcze czytnika
do `listKidDecks`; specyfikacja pozostawia tę integrację agentowi głównemu po B.

## Wynik

- Dostępność kartkówki korzysta bezpośrednio z `planLessonMockTest` na lekkiej
  puli rewizji. Nie pobiera audio i nie wywołuje `createLessonMockTestPlan`, więc
  nie tworzy UUID, promptów ani kluczy odpowiedzi.
- Start nadal odczytuje aktualną pulę i ekspozycje w istniejącej transakcji,
  selekcjonuje tym samym planerem, a dopiero potem materializuje sloty.
- Nowy `readLessonDeckOverviews` przyjmuje wersje, cele i konteksty lekcji oraz
  jedno dziecko i `now`. Grupuje odczyt rewizji, postępu i ekspozycji. Funkcję
  zbiorczego odczytu ekspozycji można podmienić; domyślny fallback czyta tylko
  sealed events dla kluczy z bieżących pul.
- Pola rewizji są pobierane bez audio i pełnych payloadów. Kolejność puli jest
  `position, id`, zgodna między planerem startowym, dostępnością i listą.
- Wynik pozostaje wewnętrzną mapą per `deckId`; publiczne DTO/API się nie zmieniają.

## Dowody

- RED na starej ścieżce: test równej liczby SELECT-ów zawiódł: 1 lekcja miała
  4 SELECT-y, 10 lekcji miało 40. Test tymczasowy baseline usunięto po pomiarze.
- GREEN: nowy test sprawdza równą liczbę SELECT-ów dla 1/10/30 lekcji tego samego
  przedmiotu, zgodność liczników/rekomendacji z dotychczasową funkcją, brak
  odczytu tabel mediów w sprawdzaniu dostępności, brak celu kartkówki oraz
  zmianę preferowanej porcji po ujawnieniu odpowiedzi między startami.
- Interpretacja edge case „wszystkie targetKey ujawnione”: po konsultacji
  nadzorcy zachowano dotychczasową regułę selektora — niewidziane pozycje mają
  pierwszeństwo, ale widziane są dopuszczalnym fallbackiem. Brak porcji oznacza
  brak kwalifikujących ćwiczeń (np. pula zawiera tylko `lesson_notice`) lub brak
  celu kartkówki. Nie zmieniono reguł wyboru w ramach optymalizacji odczytu.
- `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/mock-test-plan.test.ts` — 10/10.
- `UMIEM_TEST_RUN_ID=lesson-c-green-verified-20261018 corepack pnpm exec vitest run --config vitest.integration.config.ts tests/integration/lesson-deck-overview.test.ts tests/integration/lesson-mock-tests.test.ts tests/integration/lesson-sessions.test.ts` — 37/37, w tym końcowe porównanie z dotychczasowymi wartościami lekcji.
- `corepack pnpm exec tsc --noEmit -p packages/server/tsconfig.json` — PASS
  przed późniejszymi równoległymi zmianami schematu. Przy końcowym ponowieniu
  kompilacja zgłosiła błąd poza zakresem C: `skill-projections.ts:44` wymaga
  `policyId` po zmianie schematu przez równoległy etap.

## Ograniczenia

- `listKidDecks` nadal korzysta z dotychczasowej ścieżki, dopóki nadzorca nie
  zintegruje tego modułu po etapie B. Nie deklarować poprawy rzeczywistego GET.
- Liczba odczytów została sprawdzona deterministycznie w lokalnym PostgreSQL;
  nie wykonano benchmarku czasu ani pomiaru produkcyjnego.
- Końcowy typecheck pakietu serwera nie jest zielony z powodu opisanego wyżej
  błędu w równoległej zmianie `skill-projections.ts`; wymaga ponowienia po jej
  integracji. Bieżący diff C przeszedł wcześniej typecheck pakietu.
