# Niezależne review: redesign Kid UI

Data: 2026-10-11  
Zakres: `3efdc168181d1922cadcf8c0042dbdb548d6ba7b..b234f116296cc4428cddace7df0c47c58704bb96`  
Spec: `docs/superpowers/specs/2026-10-11-kid-ui-redesign-design.md`  
Plan: `docs/superpowers/plans/2026-10-11-kid-ui-redesign.md`

Review przeprowadził niezależny recenzent `gpt-6.1-sol` z reasoning effort `ultra`. Recenzent sprawdził pełny zakres gałęzi i reprodukował ustalenia w aktualnym Chromium. Ostateczny werdykt: **Critical 0, Important 0, Minor 1; Ready to merge: Yes**. Review nie uruchamiał pełnych suites; wyniki testów poniżej pochodzą z wykonania implementera.

## Findingi i obsługa

- **Important — niski kontrast kontrolek w ciemnym motywie.** Początkowe poprawki naprawiły pole tekstowe, „Koniec”, notices oraz materiał, ale recenzent wykrył jeszcze biały tekst na jasnym tle w „Posłuchaj wzorca”, „Pomiń” i „Zmień profil”. Dodano tokenowe kolory i tła ograniczone do Kid UI. Testy najpierw odtworzyły kontrast 1,14:1. Po poprawce recenzent potwierdził 9,52:1 dla działań mowy i 12,05:1 dla zmiany profilu. E2E mierzy próg WCAG 4,5:1 dla obu ekranów.
- **Important — zmierzona wysokość visual viewportu przegrywała z `min-height`.** Usunięto ograniczenie `min-height: 100dvh` ramy sesji. E2E dla wysokości visual viewportu 350 px i offsetu 24 px potwierdza ramę `y=24`, `height=350`, `bottom=374`.
- **Important — długi materiał był obcięty od początku albo znikał przy krótkim widoku.** Bezpieczne centrowanie oraz minimalna wysokość materiału zachowują początek długiego słowa w widocznym obszarze; źródło i przykład można osiągnąć przewinięciem, a działania pozostają w zasięgu. Reading na krótkim viewportcie zachowuje niezerowy obszar pytania.
- **Important — globalne rozmiary SVG zmniejszały grafiki dydaktyczne.** Reguła rozmiaru dotyczy teraz jawnych ikon `KidIcon`; deterministyczne grafiki zachowują własny rozmiar. Dodatkowa reguła przywraca dużemu odsłuchowi ikonę 48×48 px. E2E sprawdza rzeczywisty bounding box.
- **Minor — macierz wszystkich ośmiu rodzajów zadań, viewportów i motywów nie jest pełna.** Obecne E2E sprawdzają wszystkie rodzaje instrukcji oraz newralgiczne rozmiary, przewijanie, dark mode, kontrolki, grafiki i działania. Nie każdy rodzaj przechodzi jednak każdą kombinację rozmiaru i motywu z kontrolą materiału i akcji. Pozostaje to udokumentowanym zakresem do rozszerzenia; recenzent uznał, że nie blokuje obecnego PR.

Recenzent nie znalazł innych regresji funkcjonalnych, kontraktów, oceniania, ujawnień ani prywatności. Zakres nie zmienia API/DTO, schematu bazy, oceniania, ekspozycji ani obsługi serwera.

## Weryfikacja implementera

- Kid UI, Karty zestawów i ekrany przepływu: `test:e2e tests/e2e/kid-ui-layout.spec.ts tests/e2e/kid-decks-layout.spec.ts tests/e2e/kid-flow-screens.spec.ts` — **52/52 passed**.
- Dark-mode feedback mowy z działaniami odsłuchu/pominięcia — **1/1 passed**.
- Świeże `typecheck` — exit 0.
- Świeże `build` — exit 0.
- W poprzedniej fazie po zmianach bazowego layoutu: `test:unit` — 54 pliki / 481 testów; `test:integration` PostgreSQL — 20 plików / 179 testów. Późniejsze poprawki dotyczyły wyłącznie CSS i E2E.
- `git diff --check` — czysto.

## Odbiór urządzenia

Fizyczny Galaxy S25, PWA, paski systemowe/przeglądarki, klawiatura i gest pinch-zoom nie zostały przetestowane. W środowisku brak `adb`, SDK i podłączonego telefonu. Automatyczne testy viewportu nie są dowodem odbioru na tym urządzeniu. PR i opis zadania muszą zachować tę lukę jako otwartą; nie deklarować zweryfikowanej responsywności na S25.

## Zakres review

Pełna gałąź od wspólnej bazy `3efdc168` przez finalny commit `b234f11`, włącznie z poprawkami znalezionymi podczas ponownego review. Końcowe poprawki zamknęły wszystkie Important. Checkout był czysty podczas review. Odbiór rzeczywistych providerów mowy pozostaje poza zakresem UX redesignu.
