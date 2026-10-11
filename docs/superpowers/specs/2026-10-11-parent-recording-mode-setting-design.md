# Ustawienie sposobu nagrywania w profilu dziecka

**Status:** Projekt do przeglądu właściciela.

## Cel

Rodzic wybiera sposób obsługi mikrofonu osobno dla każdego profilu. Dziecko nie zmienia tego ustawienia podczas ćwiczenia i nie widzi linku „Wolisz nacisnąć raz? Zmień tryb”. Wybór działa na wszystkich urządzeniach korzystających z tego profilu.

## Zachowanie

- Obsługiwane tryby pozostają takie jak w projekcie UX mowy: `hold` oznacza przytrzymanie przycisku podczas mówienia, a `toggle` oznacza osobne naciśnięcie, aby rozpocząć i zatrzymać nagranie.
- Nowe i istniejące profile domyślnie używają `hold`, zgodnie z obecnym widokiem dziecka.
- Rodzic zmienia tryb w edycji profilu dziecka w panelu rodzica. Opisy opcji są po polsku i wyjaśniają gest.
- Widok dziecka dostaje tryb z profilu pobranego przez Kid API. Nie zapisuje ani nie zmienia trybu lokalnie.
- Usuwamy link zmiany trybu z ćwiczeń. Pozostają widoczny przycisk nagrywania, jego działanie zgodne z trybem profilu oraz istniejące zachowanie mikrofonu.
- Wartość `toggle`, która była wcześniej zapisana w `localStorage` urządzenia, nie jest importowana. Po wdrożeniu obowiązuje wartość profilu; rodzic może ustawić `toggle` dla wybranego dziecka.

## Architektura i dane

- Dodajemy `recording_mode` do `learning_app.child_profiles`, z ograniczeniem do `hold | toggle` i wartością domyślną `hold`.
- Dodajemy przeglądaną migrację Drizzle. Schemat TypeScript pozostaje autorytatywny; nie modyfikujemy osobno `docs/schema.sql` poza aktualizacją dokumentacji kontraktu, jeżeli wymaga tego przyjęta konwencja migracji.
- Kontrakt rodzica zwraca tryb w `ChildDto`; `ChildPatch` przyjmuje go przy edycji. Tworzenie profilu nie wymaga nowego pola, bo serwer i baza stosują domyślne `hold`.
- Kontrakt dziecka zwraca tryb w `KidProfileDto` z istniejącego `GET /api/v1/kid/profiles`; nie dodajemy endpointu ani nie zmieniamy kontraktu sesji.
- Logika nagrywania nadal obsługuje oba tryby w istniejącym `SpeechRecordButton`. Tryb przekazuje kontroler sesji na podstawie aktualnie wybranego profilu.
- Migracja wsteczna ani przepisywanie historii prób nie są potrzebne. Zmiana dotyczy wyłącznie przyszłej obsługi nagrywania.

## Interfejs rodzica i dziecka

- W edycji profilu rodzic wybiera jedną z opisanych opcji: „Przytrzymaj, aby mówić” albo „Naciśnij, aby rozpocząć i zatrzymać”.
- Zapis przebiega przez istniejący `PATCH /api/v1/parent/children/:id`, z walidacją kontraktu i autoryzacją rodzica.
- Ekran dziecka nie zawiera ustawień nagrywania ani tekstu zachęcającego do zmiany trybu. Przycisk i stany nagrywania pozostają dostępne dotykiem i klawiaturą.
- Ustawienie nie zmienia oceny odpowiedzi, kwalifikacji, ujawnień, limitu czasu nagrania ani przechowywania audio.

## Prywatność i zgodność

- `recording_mode` jest niesekretną preferencją profilu. Nie zapisujemy dodatkowych danych mikrofonu ani odpowiedzi.
- Audio dziecka nadal jest przetwarzane krótkotrwale w pamięci zgodnie z dotychczasowymi wymaganiami.
- Kid UI konsumuje wyłącznie publiczny DTO; nie importuje kodu serwerowego ani Next.js.
- Etykiety trafiają do współdzielonego katalogu komunikatów `packages/contracts/src/messages.ts`.

## Kryteria akceptacji

1. Rodzic może odczytać i zmienić tryb nagrywania konkretnego profilu; zmiana pozostaje po odświeżeniu i działa na innym urządzeniu.
2. Nieustawiony profil używa `hold`; niepoprawna wartość odrzucona przez API lub bazę nie zmienia trybu na niejawny wariant.
3. Dla profilu `hold` nagrywanie kończy się po puszczeniu zgodnie z obecnym kontrolerem; dla `toggle` osobne kliknięcie rozpoczyna, a kolejne zatrzymuje nagrywanie.
4. Po przełączeniu profilu w tej samej przeglądarce dziecko używa trybu przypisanego do wybranego profilu, bez wpływu ustawienia drugiego profilu.
5. Link „Wolisz nacisnąć raz? Zmień tryb” znika z ćwiczeń; link nie pojawia się po rozpoczęciu nowej sesji ani po odświeżeniu.
6. Ustawienie nie zmienia ścieżki bez mikrofonu, obsługi odmowy uprawnienia ani prywatności nagrań.

## Weryfikacja

- Kontrakt i jednostki: walidacja `ChildPatch`, mapowanie profili i wybór trybu kontrolera dla profilu.
- Integracja PostgreSQL: domyślna wartość, zapis/odczyt, ograniczenie wartości i edycja profilu.
- E2E: ustawienie rodzica dla dwóch profili, zachowanie `hold` i `toggle` w UI dziecka oraz brak linku zmiany trybu.
- `pnpm typecheck`, adekwatne testy jednostkowe/integracyjne/E2E, `pnpm build` i `git diff --check` zgodnie ze skryptami repozytorium.

## Zakres poza tą zmianą

Nie dodajemy preferencji globalnej, synchronizacji wielu rodzin, nowych metod oceny mowy, zmian w mikrofonie dla `mock_test` ani migracji starych wartości z `localStorage`.
