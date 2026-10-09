# Ręczne tworzenie zestawu od zera — projekt

Data: 2026-10-09. Stan bazowy: `875869f`. Ścieżka Superpowers: architectural
(nowa operacja Parent API i współpraca klient–serwer). Projekt przedstawiony
w rozmowie został zatwierdzony przez właściciela. Ten dokument wymaga osobnego
przeglądu przed przygotowaniem planu implementacji.

## 1. Cel i zakres

Rodzic może utworzyć pusty zestaw Umiem! i wpisać własne słówka bez generowania
treści przez LLM. Sukces oznacza przejście z listy zestawów prosto do istniejącego
edytora, zapis ręcznego materiału, przygotowanie mediów oraz zwykłą publikację
i przypisanie dziecku. Treść pozostaje materiałem vocabulary `pl-PL → en-GB`.

Wybrano trwały pusty szkic w bazie. Formularz wyłącznie lokalny wymagałby
osobnego trybu edytora i zwiększał ryzyko utraty pracy. Rozszerzanie operacji
generowania o tryb ręczny mieszałoby tworzenie szkicu z zadaniami AI.

Zakres nie obejmuje importu list, OCR, autosave, zmiany reguł uczenia ani
nowej ścieżki publikacji. Ręczna treść nie wymaga LLM, ale zapis słówek nadal
przygotowuje wymagany TTS oraz ilustracje zgodnie z wyborem rodzica.

## 2. Obecny stan

- `apps/web/src/parent/DecksPanel.tsx` tworzy zestawy wyłącznie przez
  `POST /api/v1/parent/decks/generate`, wymagające promptu.
- `DeckEditor.tsx` już dodaje nowe słówka, zapisuje je przez PATCH i obsługuje media.
  Pusty `DraftDto.items` jest poprawnym DTO, lecz formularz zapisu wysyła wszystkie
  elementy, a `DraftPatchSchema` wymaga co najmniej jednego elementu.
- `createDraft` w `packages/server/src/modules/decks.ts` wymaga niepustego
  `DraftInput` i odczytuje locale pierwszego elementu. Nie służy do pustej inicjalizacji.
- Generowanie AI już tworzy pustą wersję w bazie przed wykonaniem workera.
  Obecny model danych potrafi przechować taki stan.
- `publishDraft` odrzuca wersję bez elementów i sprawdza wymagane media.
- Router API znajduje się w `apps/web/src/parent/parent-router.ts`;
  mutacje wymagają sesji rodzica i poprawnego Origin.

## 3. Przepływ rodzica

1. W karcie tworzenia zestawu obok „Generuj” pojawia się przycisk
   „Utwórz pusty zestaw”. Nie wymaga promptu i ignoruje jego zawartość.
2. Wpisany tytuł zostaje użyty po usunięciu zewnętrznych spacji. Brak tytułu
   oznacza „Nowy zestaw”. Obowiązuje limit 200 znaków.
3. Podczas tworzenia oba przyciski tworzenia są zablokowane. Sukces otwiera
   `DeckEditor` dla zwróconego identyfikatora; stan listy jest odświeżany.
   Odświeżenie listy nie jest warunkiem otwarcia już utworzonego zestawu.
4. Pusty edytor pokazuje „Dodaj pierwsze słówko” i istniejący przycisk
   „Dodaj słówko”. Nie dodaje automatycznie fikcyjnej karty do bazy.
5. Pusty szkic można ponownie otworzyć z listy po powrocie lub przeładowaniu.
   Pola jeszcze niezapisanych słówek nie są utrwalane przy przeładowaniu;
   jest to obecny model jawnego zapisu.
6. Rodzic dodaje karty i zapisuje je obecnym PATCH. Nowe karty korzystają
   z obecnych domyślnych locale i wyboru wizualizacji.
7. Publikacja pustego szkicu jest zablokowana w UI oraz odrzucona przez serwer.
   Publikacja przy niezapisanych zmianach jest zablokowana z komunikatem
   „Najpierw zapisz zmiany”, aby rodzic nie opublikował starszej zapisanej treści.
8. Po zapisie i przygotowaniu wymaganych mediów działa zwykła publikacja
   i przypisanie. Szkic pozostaje niedostępny w Kid API.

Zapis samego tytułu pustego szkicu jest dozwolony: klient wysyła PATCH z tytułem
i `expectedEditNumber`, bez `items`. Po dodaniu kart ich zapis nadal wymaga
niepustych słów i tłumaczeń. Nie zmieniamy ograniczenia minimum jednego elementu
w `DraftInputSchema` ani `DraftPatchSchema.items`; usunięcie ostatniej karty
z zapisanego zestawu pozostaje zablokowane zgodnie z obecnym edytorem.

## 4. API i domena

Nowa operacja: `POST /api/v1/parent/decks`.

Wejście `CreateEmptyDeckCommand`: `{ deckId: UUID, title?: string }`.
Tytuł po trim musi mieć 1–200 znaków, jeśli jest podany. Klient pomija pusty
tytuł; serwer stosuje domyślny tytuł z katalogu komunikatów. Locale tej operacji
są stałe: `pl-PL` i `en-GB`. Nie przyjmuje promptu ani elementów.

Odpowiedź: `{ deckId: UUID }`, status 201 dla nowego zestawu i 200 przy
powtórzeniu wcześniej zakończonego żądania z tym samym identyfikatorem.
Kontrakt polecenia i odpowiedzi jest walidowany w `packages/contracts`.

`createEmptyDeck(services, command)` w module decks tworzy w jednej transakcji:

- deck o wskazanym UUID i tytule;
- wersję numer 1, `editNumber = 1`, `state = draft`, z tym samym tytułem
  oraz początkową parą locale;
- żadnych learning_items, rewizji, kluczy umiejętności, mediów, generation_run
  ani zadań Graphile Worker.

UUID generowany przez klienta stanowi identyfikator zasobu i klucz bezpiecznego
ponowienia. Dla równoległych żądań serwer korzysta z unikalnego klucza deck.id
i transakcyjnej obsługi konfliktu, tak aby powstał jeden zestaw i jedna wersja.
Istniejący deck o tym UUID powoduje zwrot identyfikatora bez edycji jego treści,
tytułu lub stanu, także jeśli rodzic zdążył go edytować lub opublikować.
Nie tworzymy sztucznego generation_run w celu deduplikacji.

Klient zachowuje ten sam UUID przy ponowieniu po błędzie sieciowym. Nowe
intencjonalne tworzenie po sukcesie otrzymuje nowy UUID. Ponowienie jest
kontynuacją poprzedniej próby, a nie zmianą jej parametrów.

Nowa trasa przechodzi przez istniejącą autoryzację sesji i kontrolę Origin.
Reguły błędów pozostają zgodne z aktualnym API. Nie jest potrzebna migracja bazy.
Istniejące `createDraft`, generowanie AI i kopiowanie opublikowanej wersji
zachowują swoje kontrakty.

## 5. Edycja, media i błędy

Istniejący `editDraft` tworzy learning_item, rewizje i klucze umiejętności
dla nowych kart oraz uzgadnia media w tej samej transakcji. Wykorzystujemy tę
ścieżkę bez alternatywnego modelu danych. Obowiązuje optimistic locking
`expectedEditNumber`, limit 50 elementów i obecna walidacja słówek.

Utworzenie pustego szkicu nie potrzebuje konfiguracji providerów. Zapis
kompletnych kart może zlecać zadania mediów; awaria providera nie usuwa szkicu
i nie pozwala ominąć obowiązkowego audio podczas publikacji. Ilustracje
zachowują obecną możliwość świadomego pominięcia.

Błąd tworzenia wyświetla polski komunikat i pozostawia dane formularza.
Jeśli serwer zapisał szkic, ale odpowiedź zaginęła, ponowienie z tym samym UUID
otwiera ten sam zestaw. Nieudane odświeżenie listy nie sugeruje, że utworzenie
szkicu się nie powiodło. Konflikty edycji obsługuje istniejący przepływ edytora.

Wszystkie nowe etykiety i komunikaty trafiają do
`packages/contracts/src/messages.ts`. UI nie zawiera technicznych informacji
o zadaniach, kluczach deduplikacji ani providerach.

## 6. Kryteria akceptacji i weryfikacja

- Bez promptu można utworzyć pusty zestaw i od razu otworzyć edytor.
- Tytuł jest zachowany; brak tytułu daje „Nowy zestaw”.
- W bazie powstaje dokładnie jeden deck i jedna wersja draft bez kart,
  generation_run, mediów i zadań kolejki; fake LLM nie jest wywołany.
- Powtórzenie oraz dwa równoległe żądania z tym samym UUID nie tworzą duplikatów
  i nie nadpisują istniejącego zestawu.
- Brak sesji i niepoprawny Origin uniemożliwiają utworzenie zestawu.
- Pusty szkic można odczytać, odnaleźć na liście i zmienić jego tytuł.
- Pustego szkicu nie da się opublikować bezpośrednio przez API ani przez UI.
- Ręcznie wpisane słówka zapisują się wraz z kluczami umiejętności i zadaniami
  mediów. Niepełne karty nie zapisują się; niezapisane zmiany blokują publikację.
- Publikację blokuje brak wymaganego TTS; po przygotowaniu mediów i zatwierdzeniu
  rodzic może przypisać zestaw, a dziecko korzysta z opublikowanej wersji.
- Ścieżka generowania AI nadal działa.

Testy kontraktów obejmą UUID, tytuł i odpowiedź. Testy integracyjne z docelowym
PostgreSQL i fake-providerami obejmą atomowość, równoległe tworzenie, pustą
publikację, zapis kart oraz media. Testy HTTP obejmą autoryzację i Origin.
Playwright obejmie ręczne tworzenie, powrót do szkicu, edycję, publikację
i przypisanie oraz regresję ścieżki AI. Widoki sprawdzimy na desktopie,
tablecie i telefonie. Odpowiednia regresja istniejącego planu to R06:
edycja zachowuje zgodne audio i zleca nowe dla zmienionego tekstu.

W planie implementacji należy wskazać konkretne testy RED przed zmianami,
następnie uruchomić adekwatne istniejące skrypty: test:unit, test:integration,
test:e2e, typecheck i build. Ten dokument nie stanowi dowodu wykonania testów.

## 7. Dokumentacja i stan workflow

Implementacja zaktualizuje SPEC (ręczne tworzenie od zera), architecture
(nowy endpoint i przepływ), folder-structure (rzeczywiste lokalizacje plików
objętych zadaniem) oraz implementation-plan (kryteria nowej ścieżki).
Nie rozwija niezależnie początkowego schema.sql, ponieważ model bazy się nie zmienia.

- [x] Rozpoznanie aktualnego kodu, dokumentacji i stanu Git.
- [x] Przedstawienie opcji oraz projektu w rozmowie.
- [x] Zatwierdzenie projektu przez właściciela.
- [x] Pisemna specyfikacja.
- [x] Przegląd specyfikacji: zakres, spójność, brak placeholderów,
  rozróżnienie pustego szkicu i gotowego materiału, bezpieczeństwo ponowienia.
- [x] Przegląd i zatwierdzenie tego dokumentu przez właściciela (2026-10-09).
- [x] Pisemny plan implementacji i jego własny przegląd.
- [ ] Writing-plans: pisemny plan, przegląd właściciela i wybór wykonania.
- [ ] Executing-plans oraz TDD z dowodem RED.
- [ ] Weryfikacja implementacji i końcowy przegląd checklisty.

Nie stosowano delegacji. Companion wizualny nie był potrzebny do decyzji
o tej ścieżce; nie pominięto wymaganego etapu zatwierdzenia.
