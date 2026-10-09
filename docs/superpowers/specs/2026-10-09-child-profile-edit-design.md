# Edycja profilu dziecka w panelu rodzica

Data: 2026-10-09. Stan bazowy: `875869f`, czysty worktree.
Ścieżka workflow: architectural, ponieważ zmiana obejmuje kontrakt API i współpracę klient–serwer.
Projekt i niniejsza pisemna specyfikacja zatwierdzone przez właściciela w rozmowie. Plan implementacji także zatwierdzony przez właściciela; wybrano wykonanie samodzielne w tej rozmowie, bez delegacji.

## 1. Cel i zakres

Rodzic poprawia imię lub awatar istniejącego dziecka bez usuwania profilu. Sukces oznacza zachowanie identyfikatora, historii prób i ocen, ekspozycji, sesji, postępu, przypisań zestawów i ustawień wymowy.

Zakres obejmuje formularz rozwijany przy profilu, nową operację aktualizacji i znaczące testy. Rok urodzenia pozostaje bez zmian. Nie dodajemy własnych obrazów, nowych awatarów ani osobnego ekranu profilu.

SPEC §4 przewiduje edycję profilu. Obecnie `ChildEditor.tsx` oraz moduł `profiles.ts` udostępniają tworzenie i usuwanie. Usuwanie uruchamia CASCADE historii. Trwałe UUID jest już używane w linkach `/kids/{childId}/learn`.

## 2. Wybrane podejście

Formularz otwierany przy istniejącym profilu daje bezpośredni kontekst i korzysta z obecnego ekranu dzieci. Alternatywny osobny ekran wymaga dodatkowej nawigacji; wspólny formularz dodawania i edycji utrudnia rozróżnienie operacji. Właściciel zatwierdził formularz przy profilu.

## 3. Kontrakt API i walidacja

`PATCH /api/v1/parent/children/{id}` przyjmuje JSON z co najmniej jednym polem:

```json
{ "displayName": "Krzyś", "avatarKey": "fox" }
```

- Nowy `ChildPatchSchema` i typ `ChildPatch` w `packages/contracts/src/decks.ts`.
- `displayName`: opcjonalny string, usunięcie białych znaków na krańcach, następnie długość 1–80. Imię złożone z samych białych znaków jest błędne.
- `avatarKey`: opcjonalny string o długości 1–40, zgodnie z obecnym kontraktem profili. Formularz oferuje dotychczasowe cztery wartości: `fox`, `cat`, `owl`, `panda`. Nie zawężamy globalnego kontraktu tworzenia profilu do tej listy.
- Schemat odrzuca pusty obiekt, `null`, nieprawidłowe typy i nieznane pola. Nie można przesłać `id`, `birthYear` ani `policyId` jako aktualizowanych danych.
- UUID ścieżki waliduje `UuidSchema`. Pominięte pole zachowuje obecną wartość.
- Sukces: HTTP 200, aktualny `ChildDto` przez `toChildDto`, z tym samym UUID. Brak bezpośredniej serializacji rekordu bazy.
- Błędy: 400 `validation`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`; pozostałe według wspólnego mechanizmu błędów API. Niepoprawny JSON również daje 400.

Handler w istniejącym `apps/web/src/app/api/v1/parent/children/[id]/route.ts` używa `withApi`, `assertSameOrigin`, `requireParentSession` i `readJson`. Zachowuje obecną obsługę DELETE.

## 4. Aktualizacja i spójność danych

`updateChild(services, childId, input: ChildPatch): Promise<ChildDto>` w `packages/server/src/modules/profiles.ts` waliduje identyfikator i wejście oraz wykonuje pojedyncze `UPDATE ... WHERE id = ... RETURNING`.

Jawna lista aktualizowanych kolumn obejmuje wyłącznie dostarczone `displayName` i `avatarKey`. Brak wyniku aktualizacji oznacza `not_found`. Nie zmieniamy UUID, roku urodzenia, daty utworzenia, polityki ani żadnych tabel nauki. Nie jest potrzebna migracja bazy.

Dwie aktualizacje różnych pól nie nadpisują pól pominiętych. Przy konkurujących zapisach tego samego pola obowiązuje ostatni zapis wykonany w bazie; nie wprowadzamy wersjonowania profili. Formularz wysyła tylko pola zmienione względem wartości z chwili otwarcia. Równoległe usunięcie i edycja nie może odtworzyć profilu: aktualizacja wykonana po usunięciu zwraca 404.

Aktywna sesja nauki zachowuje przypięte treści i politykę. Nowe odczyty listy dzieci otrzymują aktualną nazwę i awatar; nie dodajemy synchronizacji w czasie rzeczywistym pomiędzy przeglądarkami.

## 5. Formularz i obsługa błędów

- Każdy profil ma przycisk „Edytuj” z `aria-expanded`. Otwarty jest najwyżej jeden formularz edycji; przejście do innego profilu odrzuca niezapisane zmiany.
- Formularz w obrębie karty inicjalizuje imię i awatar danymi wybranego dziecka. Formularz dodawania pozostaje osobną operacją.
- Etykiety i komunikaty pochodzą z `packages/contracts/src/messages.ts`: „Edytuj”, „Zapisz”, „Anuluj”, „Zapisano zmiany”.
- Pola mają dostępne etykiety; fokus po otwarciu trafia do imienia, a po zamknięciu wraca do przycisku edycji, jeżeli profil nadal istnieje.
- Zapis jest niedostępny przy pustym imieniu po trimowaniu, braku zmian lub trwającym żądaniu. Formularz używa semantycznego submit, także przez Enter.
- Podczas zapisu pola oraz akcje mogące odrzucić lub usunąć edytowany profil są zablokowane. Nie wykonujemy optymistycznej aktualizacji.
- „Anuluj” zamyka formularz bez żądania API. Kolejne otwarcie pobiera bieżące wartości z listy.
- Błąd zapisu pozostawia formularz i wpisane wartości, pokazując komunikat z `role="alert"` przy edytowanym profilu. Ponowny zapis jest możliwy.
- Po sukcesie zamykamy formularz, pokazujemy potwierdzenie przez `role="status"` i odświeżamy listę przez istniejące `onChanged`. Błąd odświeżenia po udanym PATCH ma osobny komunikat „Zapisano zmiany, ale nie udało się odświeżyć listy. Odśwież stronę.”; nie przedstawiamy go jako nieudanego zapisu.
- Jeśli odświeżona lista nie zawiera edytowanego profilu, jego formularz zostaje zamknięty.
- Awatar spoza czterech opcji, jeśli taki profil istnieje, jest zachowany jako bieżąca opcja z neutralną ikoną. Sama edycja imienia nie zmienia awatara.

Formularz ma czytelny układ na telefonie i tablecie. Nie wprowadzamy dodatkowej biblioteki formularzy ani modali.

## 6. Granice i pliki

| Plik | Zmiana |
| --- | --- |
| `packages/contracts/src/decks.ts` | Schemat i typ polecenia aktualizacji |
| `packages/contracts/src/messages.ts` | Polskie etykiety i potwierdzenia |
| `packages/server/src/modules/profiles.ts` | Przypadek użycia aktualizacji |
| `packages/server/src/index.ts` | Eksport przypadku użycia |
| `apps/web/src/app/api/v1/parent/children/[id]/route.ts` | Cienki handler PATCH |
| `apps/web/src/parent/ChildEditor.tsx` | Formularz i stan edycji |
| `tests/integration/auth-profiles.test.ts` | Walidacja, bezpieczeństwo, operacja i dane |
| `tests/integration/history.test.ts` | Zachowanie istniejącej historii podczas edycji |
| `tests/e2e/parent-flow.spec.ts` | Zapis, anulowanie, błąd i trwałość danych |
| `docs/architecture.md`, `docs/folder-structure.md`, `docs/implementation-plan.md` | Uzupełnienie kontraktu, odpowiedzialności i regresji podczas implementacji |

Jeśli zachowanie API wymaga testu schematu poza integracją, test jednostkowy kontraktu należy umieścić zgodnie z aktualną konfiguracją Vitest. Nie rozbudowujemy niezależnie projektowego `schema.sql`.

## 7. Weryfikacja i kryteria akceptacji

Przed kodem implementacji test nowego zachowania musi zostać uruchomiony i zakończyć się oczekiwaną porażką RED.

1. Aktualizacja imienia, awatara i obu pól zwraca poprawne DTO oraz zachowuje UUID. Pominięte pola, rok urodzenia i `policyId` pozostają identyczne.
2. Przy profilu z istniejącymi sesjami, zadaniami, próbami, ocenami, ekspozycjami, projekcją postępu i przypisaniami porównać powiązane dane przed i po edycji w docelowym PostgreSQL. Wspólny materiał i dane drugiego dziecka pozostają identyczne. Test rozszerza ochronę obszaru R03; istniejący test kasowania historii przez DELETE nadal przechodzi.
3. Niepoprawny UUID, puste imię, zbyt długie wartości, puste body, błędny JSON i próba zmiany pól chronionych są odrzucane bez zmiany danych. Brak profilu daje 404.
4. PATCH bez sesji rodzica jest odrzucony. Żądanie ze sprzecznym Origin lub cross-site jest odrzucone także przy poprawnej sesji.
5. Dwa klienty aktualizujące różne pola zachowują oba wyniki. Aktualizacja po zakończonym usunięciu zwraca 404 i nie tworzy nowego profilu.
6. E2E: otwarcie z aktualnymi wartościami, anulowanie bez mutacji, zmiana imienia i awatara, zachowanie href nauki, trwałość po reload oraz zachowanie wpisanych wartości po błędzie API. Osobny przypadek potwierdza komunikat przy udanym zapisie i nieudanym odświeżeniu listy.
7. Sprawdzić formularz w wypełnionym widoku telefonu i tabletu, dostępność etykiet oraz klawiaturę.

Istniejące skrypty to `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck` i `pnpm build`. Plan implementacji dobierze wywołania do aktualnej konfiguracji i środowiska. Specyfikacja nie jest dowodem uruchomienia testów aplikacji.

## 8. Checklista workflow

- [x] Rozpoznanie repozytorium, dokumentów, kontraktów, skryptów i stanu Git.
- [x] Klasyfikacja architectural oraz odzwierciedlenie celu właściciela.
- [x] Przedstawienie alternatyw i konkretnego projektu.
- [x] Zatwierdzenie projektu w rozmowie.
- [x] Zapis specyfikacji i przegląd własny: zakres, spójność, kompletność i jednoznaczność.
- [x] Przegląd i zatwierdzenie tej specyfikacji przez właściciela.
- [x] Writing-plans: pisemny plan oraz wybór wykonania przez właściciela.
- [x] Executing-plans, TDD z dowodem RED oraz końcowa weryfikacja.

Companion wizualny nie był potrzebny do rozstrzygnięcia wariantu. Nie delegowano pracy. Implementacja zakończona; wyniki i odstępstwa workflow opisano w planie implementacji.
