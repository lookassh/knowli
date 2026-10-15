# Redesign panelu rodzica — spec projektowy (design)

Data: 2026-10-14. Stan: design zaakceptowany przez właściciela na podstawie interaktywnej makiety (przełącznik „Jak jest teraz ↔ Propozycja", zakładki Zestawy/Dzieci/Postępy, modal „Nowy materiał"). Plan implementacji: `docs/superpowers/plans/2026-10-14-parent-panel-redesign.md`.

## 1. Cel i zakres

Panel rodzica jest funkcjonalny, ale nieczytelny: płaska hierarchia jednakowych białych kart, listy tekstowe zamiast wizualizacji, formularz tworzenia zestawu wypycha listę w dół, tabela słów to 35 chipów tekstowych. Redesign zmienia wyłącznie warstwę prezentacji panelu rodzica (`apps/web/src/parent/**`, style panelu) oraz — jedną, jawnie wydzieloną zmianą — rozszerza `DeckSummaryDto` o opcjonalne pola meta dla wiersza zestawu.

Poza zakresem: jakiekolwiek zmiany domeny nauki, reguł ocen, ekspozycji, schedulerа, polityk samodzielności; Kid UI; endpointy `/api/v1/kid`; edytory `DeckEditor`/`LessonEditor` (dostają tylko spójność tokenów wizualnych, bez zmian struktury); MCP `learning-overview` (nie konsumuje `DeckSummaryDto` — brak wpływu, uzasadnienie w PR).

## 2. Decyzje designu (zatwierdzone)

### 2.1 Rama aplikacji

- Pasek górny: logo „U!" (zaokrąglony kwadrat, gradient indygo→fiolet), nazwa „Umiem!", podpis „Panel rodzica"; po prawej „Do nauki" i „Wyloguj się" jako przyciski ghost.
- Nawigacja: zakładki z ikonami (Zestawy/warstwy, Dzieci/użytkownicy, Postępy/trend) z aktywnym podkreśleniem w kolorze akcentu; `aria-current` zachowane.
- Szerokość treści 960 px na desktopze (obecnie 720 px z wyjątkiem 1040 px dla tabeli słów — wyjątek znika, tabela wraca do wspólnej szerokości, bo kropki statusów wymagają mniej miejsca niż chipy tekstowe), mobile-first bez zmian; duże pola dotykowe ≥ 44 px.

### 2.2 Zestawy

- Tworzenie materiału schowane do przycisku głównego „+ Nowy materiał"; otwiera modal (natywny `<dialog>`, wzorzec `LeaveEditorDialog`) z trzema opcjami: Generuj z opisem / Pusty zestaw / Nowa lekcja. Wybór „Generuj z opisem" pokazuje w tym samym modalu formularz (Nazwa, „Czego ma się nauczyć?", Generuj). Logika idempotencji i ponawiania (`pendingGenerationCommand`, `isDefinitiveGenerationRejection`, `pendingEmptyCommand`) przeniesiona bez zmian semantyki.
- Lista pogrupowana wg stanu: „Wymaga Twojej uwagi" (review) → „Gotowe do nauki" (published) → „Szkice" (draft) → „Archiwum" (archived, zwinięte do przełącznika jak dziś). Kolejność `deck-row-N` zachowana: grupy w tej kolejności, wewnątrz grupy dotychczasowa kolejność listy.
- Wiersz zestawu: ikona rodzaju (słówka=książka, lekcja=czapka), tytuł, meta (liczba pozycji, przypisane dzieci, termin sprawdzianu), chip stanu kolorowy (Szkic=szare, Do sprawdzenia=bursztyn, Opublikowany=zielone, Archiwum=wyciszone), chevron. Lekcje zachowują przycisk „Usuń z listy".
- Filtr rodzaju (Wszystkie/Słówka/Lekcje) jako segmented control — wyłącznie prezentacyjny filtr klienta.

### 2.3 Dzieci

- Siatka kart (auto-fill, min 280 px): duży avatar (emoji z `avatarKey`), imię, meta (rok urodzenia, tryb mówienia), „Rozpocznij naukę" jako przycisk główny, „Edytuj"/„Wymowa" drugorzędne.
- „+ Dodaj dziecko" jako karta z przerywaną ramką rozwijająca istniejący formularz dodawania; panel ustawień wymowy bez zmian funkcjonalnych.

### 2.4 Postępy

- Filtry: przełącznik dziecka jako kafelki z avatarami (zastępuje select; `progress-child` przeniesiony na grupę), select zestawu (`progress-deck` bez zmian), odznaka „Sprawdzian: dd.mm.rrrr" z `testDate`. Ładowanie automatyczne przy zmianie filtra i przy wejściu (przycisk „Pokaż postępy" znika).
- Karta „Opanowanie": 5 wierszy umiejętności; każdy z paskiem segmentowanym (opanowane=zieleń, do potwierdzenia=bursztyn, w trakcie=niebieski, nie sprawdzono=szare) i wynikiem `x/N` (liczba „znane" wg dotychczasowej reguły `knownCount`). Jedna wspólna legenda.
- Karta „Aktywność": kafelki 7 dni (istniejąca funkcja, odświeżony wygląd) + 4 liczby kluczowe (czas, dni z nauką, podejścia, odpowiedzi) zamiast sześciu wierszy listy; rozkład per zestaw zachowany jako drobny wiersz.
- Karta „Próbna kartkówka": wynik jako nagłówek (`9/12 · 75%`, gwiazdki), wybór próby, kompaktowe wiersze słów z ikoną wyniku i chipami per umiejętność; nota „nie jest szkolną oceną" zachowana.
- „Do ćwiczeń" jako chipy (słowo + umiejętność), „Najczęstsze pomyłki" jako wiersze z licznikiem, „Ostatnie odpowiedzi" jako wiersze z ikoną wyniku (dobrze/błąd/bez oceny) i znacznikiem czasu z `receivedAt` oraz tagiem „z wsparciem".
- „Wszystkie słowa": statusy jako kolorowe kropki + legenda (zamiast chipów tekstowych); układ mobilny kart bez zmian; flaga „zmieniono materiał" jako drobne ostrzeżenie.
- „Ostatnie próby wymowy": wiersz = słowo, pasek wyniku, wartość, chip pasma; nota o usłudze zachowana.

### 2.5 Język wizualny

- Palette: tło `#f3f4fa`, powierzchnie białe, linie `#e8eaf2`, akcent indygo `#4356e0` (rodzina obecnego `#3b5bdb`), stanowe: zieleń `#157a47`/`#dff2e8`, bursztyn `#8a6212`/`#fbf0cf`, niebieski `#2d5fc9`/`#e5eefc`, szary `#5c5f74`/`#eef0f6`, czerwony `#bf3a4a`/`#fdebee`, fiolet lekcji `#6b3fbf`/`#f0eafc`.
- Karty: promień 16 px, cień `0 1px 2px rgba(23,25,48,.05), 0 6px 18px rgba(23,25,48,.05)`, bez twardych ramek. Typografia systemowa (bez webfontów), liczby tabularne dla wyników.
- Ikony: zamknięty zestaw inline SVG w `ParentIcon.tsx` (wzorzec `KidIcon.tsx`); bez nowych zależności produkcyjnych.

## 3. Zmiana kontraktu: `DeckSummaryDto` (opcjonalne pola)

Dla meta wiersza zestawu (§2.2) DTO dostaje pola **opcjonalne** (zgodność wsteczna):

- `itemCount?: number` — liczba pozycji wersji reprezentatywnej (published ?? editable; 0 gdy brak),
- `assignedChildren?: { childId: string; displayName: string; testDate: string | null }[]` — aktywne przypisania.

Źródło: licznik `item_revisions` per `version_id` (wspólne dla słówek i ćwiczeń lekcji) + join `assignments`×`child_profiles` (`active = true`). `listDecks` wykonuje te zapytania batchowo (dwa zapytania zbiorcze, bez N+1). Widok szczegółu zestawu (`DeckDto.assignments` z `AssignmentDto`) już istnieje — kształt pola listy jest z nim spójny (podzbiór childId/displayName/testDate), a kolejność jak w istniejącym `deckAssignments` (sort po `child_profiles.created_at, id`). MCP `learning-overview` nie konsumuje tego DTO; regeneracja JSON Schema dla konsumenta MCP nie jest wymagana (pole nie wchodzi do tego kontraktu) — decyzję odnotować w PR.

## 4. Zasady nienaruszalne

- Wszystkie istniejące `data-testid` zachowane lub jawnie przeniesione z aktualizacją speców; żadnej regresji asercji e2e bez wymiany na równoważną.
- Teksty PL wyłącznie w `packages/contracts/src/messages.ts` (nowe: grupy listy, modal, legenda, liczby kluczowe, etykiety pasków).
- Semantyka danych bez zmian: te same statusy, te same zastrzeżenia (nota o ocenie, „z wsparciem", „zmieniono materiał"); nie dodajemy procentów/ocen, których nie ma.
- Bez zmian autoryzacji: PIN, sesja, `onAuthExpired`, leave-guard i logika konfliktów działają jak dotąd.
- Dostępność: cele dotykowe ≥ 44 px, kontrast ≥ 4,5:1 tekstu, `aria-current`/`aria-selected` zakładek, modal z pułapką fokusu natywnego `<dialog>`, paski z `role="img"` i etykietą aria.
- Bez nowego systemu stylowania: rozszerzenie istniejącej strategii plików CSS (nowe tokeny i komponenty w CSS panelu rodzica), zero zależności.
